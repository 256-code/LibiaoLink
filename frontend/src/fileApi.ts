/**
 * 文件库客户端（Push 216 · 日报 / 问题附图上传与预览接线；Push 226 · 任务「文件」列 / 抽屉上传接线）。
 * Push 226 续：任务文件删除（recycleFile —— 先读 version 再移入回收站）与图片点击预览（isImageFileName + ensurePreviewUrl）。
 * Push 226 续二：文件改名（renameFile —— PATCH /files/{id}，先读 version 再写）与列表「文件」列
 *   显示文件名所需的项目文件名单（fetchTaskFileNames —— 列表接口不带文件名，这里按项目一次拉全量，免 N+1）。
 * Push 226 续三：PDF / Office / 文本点击预览（previewKindOf —— 与 server preview.targets.ts 同口径，走浏览器内置 PDF 查看器）。
 * Push 226 续四：原文件下载（fetchDownloadUrl + triggerDownload —— 版本短时签名 attachment + 原文件名；
 *   与预览转换件区分：Office / 文本的预览浮层里是转换出的 PDF，下载始终拿原文件）。
 * 上传链路（D2 分片直传，契约 shared/src/modules/files.ts；参考实现 server/scripts/m4-upload-replay.mjs）：
 *   POST /api/v1/files/uploads（intent=version，contentHash = SHA-256）
 *   → POST /api/v1/files/{fileId}/uploads/{uploadId}/parts 取预签名分片 URL
 *   → 对预签名 URL **原样 PUT**（不带任何额外请求头，与浏览器直传同口径）
 *   → POST /api/v1/files/{fileId}/uploads/{uploadId}/complete { contentHash }
 * 预览：GET /api/v1/files/{fileId}/preview → ready 时短时签名 URL（模块级缓存 + 订阅，供附图懒取）。
 */
import { useEffect, useSyncExternalStore } from "react";
import { apiRequest, apiSend } from "./api";

type UploadCreateResponse = {
  file: { id: string; name: string };
  upload: { id: string; partSizeBytes: number; totalParts: number };
};

type UploadPartsResponse = { parts: Array<{ partNumber: number; url: string }> };

type UploadCompleteResponse = { file: { id: string; name: string } };

/** 预览状态响应（契约 FilePreviewResponse 子集）：ready 才有签名地址。 */
type FilePreviewResponse = { status: string; url: string | null };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 上传文件的可选关联（taskId 给出时文件挂到该任务；file_links 同事务建立）。 */
export type UploadFileOptions = { taskId?: string };

/**
 * 上传一个文件 / Blob 到站内文件库（M4-01 分片直传；任务成果文件与日报附图共用一条链路）。
 * name 单独传：剪贴板图片的 File 名与业务名不一致（见 uploadPhoto）；options.taskId 关联任务。返回新文件的 id。
 */
export async function uploadFile(projectId: string, file: Blob, name: string, options: UploadFileOptions = {}): Promise<string> {
  const buffer = await file.arrayBuffer();
  const contentHash = await sha256Hex(buffer);
  const created = await apiSend<UploadCreateResponse>("/api/v1/files/uploads", "POST", {
    projectId,
    name,
    sizeBytes: file.size,
    mime: file.type === "" ? undefined : file.type,
    contentHash,
    intent: "version",
    taskId: options.taskId,
  });
  const fileId = created.file.id;
  const uploadId = created.upload.id;
  const partNumbers: number[] = [];
  for (let index = 1; index <= created.upload.totalParts; index += 1) {
    partNumbers.push(index);
  }
  const signed = await apiSend<UploadPartsResponse>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/uploads/" + encodeURIComponent(uploadId) + "/parts",
    "POST",
    { partNumbers },
  );
  const partSize = created.upload.partSizeBytes;
  for (const part of signed.parts) {
    const start = (part.partNumber - 1) * partSize;
    const slice = buffer.slice(start, Math.min(start + partSize, buffer.byteLength));
    const response = await fetch(part.url, { method: "PUT", body: slice });
    if (!response.ok) {
      throw new Error("文件上传失败（第 " + String(part.partNumber) + " 片，HTTP " + String(response.status) + "）");
    }
  }
  await apiSend<UploadCompleteResponse>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/uploads/" + encodeURIComponent(uploadId) + "/complete",
    "POST",
    { contentHash },
  );
  return fileId;
}

/** 批量上传（任务「文件」列 / 抽屉共用）：逐份直传；每份完成回调一次（done = 已完成份数）。 */
export async function uploadFiles(
  projectId: string,
  files: readonly File[],
  options: UploadFileOptions & { onProgress?: (done: number, total: number) => void } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) {
    ids.push(await uploadFile(projectId, file, file.name, options));
    options.onProgress?.(ids.length, files.length);
  }
  return ids;
}

/** 上传一张图片 / 文件（粘贴与选文件共用）：返回 file_links 用的文件 id。 */
export function uploadPhoto(projectId: string, blob: Blob, name: string): Promise<string> {
  return uploadFile(projectId, blob, name);
}

/** 图片扩展名判定（TaskFileBrief 不带 mime）：抽屉里只有图片给「点击预览」。（Push 226 续） */
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"];
export function isImageFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** PDF 查看器族（Push 226 续三 · 业务口径「这个pdf我也打不开啊」）：PDF 源直通、Office / 文本经转换器出 PDF
 *  （与 server preview.targets.ts 同一口径），统一走浏览器内置查看器预览。 */
const PDF_PREVIEW_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".csv", ".html", ".htm"];

/** 可视预览通道：image = 浏览器直渲染（40×40 缩略图 + img 浮层）；pdf = 浏览器内置查看器（iframe 浮层）；
 *  判不出 = null（抽屉里没有预览入口，只有改名 / 删除）。 */
export type FilePreviewKind = "image" | "pdf";
export function previewKindOf(name: string): FilePreviewKind | null {
  if (isImageFileName(name)) {
    return "image";
  }
  const lower = name.toLowerCase();
  return PDF_PREVIEW_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? "pdf" : null;
}

/** 删除文件 = 移入回收站（M4-02；任意状态可删、默认保留 30 天可恢复）。
 *  recycle 体要求 version 作乐观锁，而任务详情随行的 TaskFileBrief 不带 version —— 先读一次文件详情。 */
export async function recycleFile(fileId: string): Promise<void> {
  const detail = await apiRequest<{ version: number }>("/api/v1/files/" + encodeURIComponent(fileId));
  await apiSend<{ file: { id: string } }>("/api/v1/files/" + encodeURIComponent(fileId) + "/recycle", "POST", { version: detail.version });
}

/** 文件改名（Push 226 续二 · 业务口径「名称要可以修改」）：PATCH /files/{id} —— 乐观锁 version 先读详情取回。 */
export async function renameFile(fileId: string, name: string): Promise<void> {
  const detail = await apiRequest<{ version: number }>("/api/v1/files/" + encodeURIComponent(fileId));
  await apiSend<{ id: string }>("/api/v1/files/" + encodeURIComponent(fileId), "PATCH", { name, version: detail.version });
}

/** 下载签名响应（契约 FileDownloadUrlResponse 子集）。 */
type FileDownloadUrlResponse = { url: string; fileName: string; sizeBytes: number; expiresAt: string };

/**
 * 取**原文件**的短时签名下载地址（Push 226 续四 · 业务口径「下载为什么都是pdf 你是不是签名调用错了」）：
 * `GET /files/{id}/versions/{versionId}/download-url`（版本必填 —— 先读详情拿当前版本）。
 * 契约语义：签名带 `Content-Disposition: attachment` + 原文件名 → 浏览器落盘的是**原文件字节**
 * （与预览产物区分：Office / 文本的预览浮层里是转换出的 PDF）；服务端写 download 审计、判 `file.download` 权限。
 */
export async function fetchDownloadUrl(fileId: string): Promise<{ url: string; fileName: string }> {
  const detail = await apiRequest<{ currentVersion: { id: string } | null }>("/api/v1/files/" + encodeURIComponent(fileId));
  const versionId = detail.currentVersion === null ? null : detail.currentVersion.id;
  if (versionId === null) {
    throw new Error("文件还没有版本，暂时不能下载");
  }
  const signed = await apiRequest<FileDownloadUrlResponse>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/versions/" + encodeURIComponent(versionId) + "/download-url",
  );
  return { url: signed.url, fileName: signed.fileName };
}

/** 触发一次浏览器下载（attachment 签名地址 —— 地址失效时页面不跳走；原文件名由 Content-Disposition 落盘）。 */
export function triggerDownload(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** 项目文件库名单（列表「文件」列显示文件名用）：按项目分页取满（契约 limit 上限 200、默认排除 recycled），
 *  返回 taskId → 文件名数组（服务端默认序 = 最新在前）；列表接口不带文件名，逐行反查会 N+1，这里一次拉全量。 */
export async function fetchTaskFileNames(projectId: string): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  for (let page = 1; page <= 20; page += 1) {
    const list = await apiRequest<{ items: Array<{ name: string; taskId: string | null }>; total: number }>(
      "/api/v1/projects/" + encodeURIComponent(projectId) + "/files?limit=200&page=" + String(page),
    );
    for (const file of list.items) {
      if (file.taskId === null) {
        continue;
      }
      const current = names.get(file.taskId);
      if (current === undefined) {
        names.set(file.taskId, [file.name]);
      } else {
        current.push(file.name);
      }
    }
    if (list.items.length === 0 || page * 200 >= list.total) {
      break;
    }
  }
  return names;
}

/** fileId → 已就绪的预览签名（无 = 还没取到 / 取不到）。 */
const previewUrls = new Map<string, string>();
const previewLoading = new Set<string>();
const previewListeners = new Set<() => void>();

function notifyPreview(): void {
  for (const listener of previewListeners) {
    listener();
  }
}

function subscribePreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

/** 取预览签名（带缓存）。
 *  not_ready 轮询预算 = 20 秒（Push 226 续：worker 的 outbox 领取间隔默认 5 秒 —— 首次预览「点开才排队转换」，
 *  6 秒窗口在真机上会偶发拿不到；failed 立即返回，不会白等）。 */
export async function ensurePreviewUrl(fileId: string): Promise<string | null> {
  const cached = previewUrls.get(fileId);
  if (cached !== undefined) {
    return cached;
  }
  if (previewLoading.has(fileId)) {
    return null;
  }
  previewLoading.add(fileId);
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const preview = await apiRequest<FilePreviewResponse>("/api/v1/files/" + encodeURIComponent(fileId) + "/preview");
      if (preview.status === "ready" && preview.url !== null) {
        previewUrls.set(fileId, preview.url);
        notifyPreview();
        return preview.url;
      }
      if (preview.status === "failed") {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  } catch {
    return null;
  } finally {
    previewLoading.delete(fileId);
  }
}

/** 附图展示地址：本地 blob（会话内刚贴的图）优先，否则懒取服务端预览签名并订阅缓存变化。 */
export function usePhotoUrl(fileId: string, localUrl: string | null): string | null {
  const remote = useSyncExternalStore(subscribePreview, () => (fileId === "" ? null : previewUrls.get(fileId) ?? null));
  useEffect(() => {
    if (fileId !== "" && localUrl === null) {
      void ensurePreviewUrl(fileId);
    }
  }, [fileId, localUrl]);
  return localUrl ?? remote;
}
