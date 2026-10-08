/**
 * 文件库客户端（Push 216 · 日报 / 问题附图上传与预览接线；Push 226 · 任务「文件」列 / 抽屉上传接线）。
 * Push 226 续：任务文件删除（recycleFile —— 先读 version 再移入回收站）与图片点击预览（isImageFileName + ensurePreviewUrl）。
 * Push 226 续二：文件改名（renameFile —— PATCH /files/{id}，先读 version 再写）与列表「文件」列
 *   显示文件名所需的项目文件名单（fetchTaskFiles —— 列表接口不带文件名，这里按项目一次拉全量，免 N+1；Push 246 起携 id 供「文件」列下拉预览 / 删除）。
 * Push 226 续三：PDF / Office / 文本点击预览（previewKindOf —— 与 server preview.targets.ts 同口径）。
 * Push 226 续四：原文件下载（fetchDownloadUrl + triggerDownload —— 版本短时签名 attachment + 原文件名；
 *   与预览浮层区分：下载始终拿原文件、写 download 审计）。
 * S4（ONLYOFFICE 查看器外壳 · 计划 S4 / R5）：Office / 文本族改走**查看器通道** —— ensurePreviewOutcome 按响应裁决
 *   （viewer 非空 = 查看器外壳；url 非空 = 产物浮层）；previewKindOf 增 "office"（名单与 server viewerChannelFor 对齐）。
 * 2026-10-08：PDF 并入查看器通道（业务口径「统一用onlyoffice」）—— 服务端返回 viewer，本文件按响应裁决、无分支。
 * 2026-10-08 续：文件替换（replaceFileContent —— 业务口径「增加一个替换按钮 点击替换则选择新文件代替」）：
 *   未定档（draft）直替 = intent=version + fileId（版本链追加、名称 / 归属不变）；已定档 / 已变更 = intent=change
 *   + change.reason 必填（A4-13 申请即通过，完成上传时同事务生效）。
 *   Push 251 撤销：业务口径「取消这个替换按钮」→ UI 入口与替换流程整体撤除（本函数保留、未接线；服务端变更通道不动）。
 * 2026-10-08 续二（Push 249）：定档上传（uploadFile / uploadFiles / replaceFileContent 的 finalize 选项 + finalizeFile）——
 *   业务口径「添加和替换文件要提示是否为定档文件，若是则上传文件后该任务定档不支持任何修改」：传输完成即定档该文件
 *   （POST /files/{id}/finalize），挂接任务随文件定档一并锁定（服务端同事务）：此后任务写口一律 409 TASK_FINALIZED，修改走变更。
 * 上传链路（D2 分片直传，契约 shared/src/modules/files.ts；参考实现 server/scripts/m4-upload-replay.mjs）：
 *   POST /api/v1/files/uploads（intent=version，contentHash = SHA-256）
 *   → POST /api/v1/files/{fileId}/uploads/{uploadId}/parts 取预签名分片 URL
 *   → 对预签名 URL **原样 PUT**（不带任何额外请求头，与浏览器直传同口径）
 *   → POST /api/v1/files/{fileId}/uploads/{uploadId}/complete { contentHash }
 * 预览：GET /api/v1/files/{fileId}/preview → ready 时短时签名 URL（模块级缓存 + 订阅，供附图懒取）。
 * Push 255（业务口径「文件显示 已变更 不如直接替换成变更后的啊… 变更记录也要显示 之前是什么文件 这次是什么文件… 文件可以预览在变更里面」）：
 *   变更记录行接版本链 —— fetchFileVersions（GET /files/{id}/versions）+ 版本态预览 / 下载
 *   （ensurePreviewOutcome(fileId, versionId?) / fetchDownloadUrl(fileId, versionId?)：A4-06 任意历史版本可预览与下载）。
 */
import { useEffect, useSyncExternalStore } from "react";
import { apiRequest, apiSend } from "./api";

type UploadCreateResponse = {
  file: { id: string; name: string };
  upload: { id: string; partSizeBytes: number; totalParts: number };
};

type UploadPartsResponse = { parts: Array<{ partNumber: number; url: string }> };

type UploadCompleteResponse = { file: { id: string; name: string } };

/** ONLYOFFICE 查看器配置（契约 PreviewViewer 子集 · S4 直接组装 DocEditor 配置；token = 四段逐字签发）。 */
export type PreviewViewerConfig = {
  kind: string;
  docServerUrl: string;
  documentType: "word" | "cell" | "slide";
  document: { title: string; url: string; fileType: string; key: string };
  editorConfig: { mode: "view"; lang: string; user: { id: string; name: string } };
  permissions: { edit: boolean; download: boolean; print: boolean; comment: boolean; chat: boolean; fillForms: boolean; protect: boolean };
  token: string;
};

/** 预览状态响应（契约 FilePreviewResponse 子集）：ready 才有签名地址 / 查看器配置（两通道互斥）。 */
type FilePreviewResponse = {
  status: string;
  url: string | null;
  viewer: PreviewViewerConfig | null;
  reason: string | null;
};

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 上传文件的可选关联（taskId 给出时文件挂到该任务；file_links 同事务建立）。 */
export type UploadFileOptions = {
  taskId?: string;
  /** 定档上传（Push 249 · 业务口径「若是则上传文件后该任务定档不支持任何修改」）：传输完成即对该文件定档
   *  （POST /files/{id}/finalize）—— 挂接任务随文件定档一并锁定（服务端同事务、幂等）。 */
  finalize?: boolean;
};

/**
 * 上传一个文件 / Blob 到站内文件库（M4-01 分片直传；任务成果文件与日报附图共用一条链路）。
 * name 单独传：剪贴板图片的 File 名与业务名不一致（见 uploadPhoto）；options.taskId 关联任务。返回新文件的 id。
 */
/** 分片直传公共尾段（uploadFile / replaceFileContent 共用）：取分片签名 → 逐片原样 PUT → complete。 */
async function transferChunks(
  fileId: string,
  upload: { id: string; partSizeBytes: number; totalParts: number },
  buffer: ArrayBuffer,
  contentHash: string,
): Promise<void> {
  const partNumbers: number[] = [];
  for (let index = 1; index <= upload.totalParts; index += 1) {
    partNumbers.push(index);
  }
  const signed = await apiSend<UploadPartsResponse>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/uploads/" + encodeURIComponent(upload.id) + "/parts",
    "POST",
    { partNumbers },
  );
  for (const part of signed.parts) {
    const start = (part.partNumber - 1) * upload.partSizeBytes;
    const slice = buffer.slice(start, Math.min(start + upload.partSizeBytes, buffer.byteLength));
    const response = await fetch(part.url, { method: "PUT", body: slice });
    if (!response.ok) {
      throw new Error("文件上传失败（第 " + String(part.partNumber) + " 片，HTTP " + String(response.status) + "）");
    }
  }
  await apiSend<UploadCompleteResponse>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/uploads/" + encodeURIComponent(upload.id) + "/complete",
    "POST",
    { contentHash },
  );
}

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
  await transferChunks(created.file.id, created.upload, buffer, contentHash);
  if (options.finalize === true) {
    await finalizeFile(created.file.id);
  }
  return created.file.id;
}

/**
 * 替换文件内容（2026-10-08 · 业务口径「增加一个替换按钮 点击替换则选择新文件代替」）：
 * 未定档（draft）= 直接替换 —— intent=version + fileId（A2-10「未定档文件可直接替换」；版本链追加，
 * 名称 / 归属不变 —— 契约要求给出 fileId 时 name 与目标一致）；已定档 / 已变更（final / changed）= 走变更
 * （A4-13 申请即通过）—— intent=change + change.reason 必填，完成上传时同事务生效（文件状态 → changed）。
 * 替换完成后清一次该文件的预览签名缓存（旧版本 URL 作废）。
 * finalize（Push 249）= 未定档直替后定档（任务随定档锁定）；已定档 / 已变更走变更、不定档（change 路径下忽略）。
 * Push 251 撤销（业务口径「取消这个替换按钮」）：入口与流程已从 UI 撤除，本函数保留未接线（供后续需要时复用）。
 */
/**
 * 变更载荷（契约 ChangeIntentBody · A4-13 十三列字段面）：reason 必填（≤ 1000，承载「变更内容描述（+变更原因）」）；
 * 变更前 / 变更后摘要可空（各 ≤ 2000）；变更阶段可选（stageKey 缺省 = 服务端取文件节点所属阶段）。
 */
export type FileChangePayload = {
  reason: string;
  beforeSummary?: string;
  afterSummary?: string;
  stageKey?: string;
};

/**
 * 变更申请（A4-13 一期「申请即通过」· 抽屉「变更申请」页）：目标文件须为已定档（final / changed）——
 * Push 254 续（业务口径 2026-10-08「不是已经定档了吗 为什么变更申请里面还是未定档」）：任务已定档时，其名下
 * draft 文件同视为「定档后的文件」（taskFinalized = true 放行；服务端同口径兜底）——
 * 提交 = `intent=change` 分片直传（沿用上传管道），完成上传时同事务生成变更记录 + 新版本挂 changeRequestId +
 * 文件状态改 changed + R01 回写任务「变更关联」；**无变更后文件不允许提交**（A4-13 提交校验，本函数 file 必传）。
 * 变更后清一次该文件的预览签名缓存（旧版本 URL 作废）。
 * Push 256（业务口径「变更后文件的名字后后缀要用变更选择的 不然都不能预览」）：`name` 传**变更后文件名**（含扩展名）
 * —— 服务端完成变更时把文件更名为该名称（对象键 / 预览通道随之用新扩展名；历史版本仍按各自旧扩展名预览）。
 */
export async function applyFileChange(projectId: string, target: TaskFileRef, file: File, change: FileChangePayload, taskFinalized = false): Promise<void> {
  const taskFinalizedDraft = taskFinalized && target.status === "draft";
  if (target.status !== "final" && target.status !== "changed" && !taskFinalizedDraft) {
    throw new Error("只有已定档文件可以发起变更");
  }
  const reason = change.reason.trim();
  if (reason === "") {
    throw new Error("请填写变更原因");
  }
  const before = change.beforeSummary === undefined ? "" : change.beforeSummary.trim();
  const after = change.afterSummary === undefined ? "" : change.afterSummary.trim();
  const buffer = await file.arrayBuffer();
  const contentHash = await sha256Hex(buffer);
  const created = await apiSend<UploadCreateResponse>("/api/v1/files/uploads", "POST", {
    projectId,
    name: file.name === "" ? target.name : file.name,
    sizeBytes: file.size,
    mime: file.type === "" ? undefined : file.type,
    contentHash,
    intent: "change",
    fileId: target.id,
    change: {
      reason,
      beforeSummary: before === "" ? undefined : before,
      afterSummary: after === "" ? undefined : after,
      stageKey: change.stageKey === undefined || change.stageKey === "" ? undefined : change.stageKey,
    },
  });
  await transferChunks(created.file.id, created.upload, buffer, contentHash);
  invalidatePreview(target.id);
}

/** 变更记录详情（契约 ChangeRequestDetail · M4-04 读面 A4-15）：变更本体 + 变更后文件 + 变更后版本（本文件只需用到的字段）。 */
export type ChangeRequestDetail = {
  id: string;
  projectId: string;
  nodeId: string | null;
  stageKey: string | null;
  reason: string;
  beforeSummary: string | null;
  afterSummary: string | null;
  status: string;
  appliedBy: string;
  appliedAt: string;
  fileId: string;
  versionId: string;
  versionSeq: number;
  file: { id: string; name: string; docType: string | null; status: string };
  version: { id: string; seq: number; sizeBytes: number; uploadedAt: string };
  /** Push 256：本次变更同时更名时 = 更名前文件名称（变更记录「变更前」行显示）；未更名 = null。 */
  filePreviousName: string | null;
};

/** 变更详情（抽屉「变更记录」页按任务 changeLinks 逐条取全文；非成员 / 不存在统一 404）。 */
export function fetchChangeRequest(id: string): Promise<ChangeRequestDetail> {
  return apiRequest<ChangeRequestDetail>("/api/v1/change-requests/" + encodeURIComponent(id));
}

export async function replaceFileContent(projectId: string, target: TaskFileRef, file: File, reason: string | null, finalize = false): Promise<void> {
  const needsChange = target.status === "final" || target.status === "changed";
  const changeReason = reason === null ? "" : reason.trim();
  if (needsChange && changeReason === "") {
    throw new Error("已定档文件替换需填写变更原因");
  }
  const buffer = await file.arrayBuffer();
  const contentHash = await sha256Hex(buffer);
  const created = await apiSend<UploadCreateResponse>("/api/v1/files/uploads", "POST", {
    projectId,
    // Push 256：change 路径 name = 变更后文件名（完成时更名）；version 路径须与目标文件一致（直接替换 = 同一文件）
    name: needsChange ? (file.name === "" ? target.name : file.name) : target.name,
    sizeBytes: file.size,
    mime: file.type === "" ? undefined : file.type,
    contentHash,
    intent: needsChange ? "change" : "version",
    fileId: target.id,
    change: needsChange ? { reason: changeReason } : undefined,
  });
  await transferChunks(created.file.id, created.upload, buffer, contentHash);
  invalidatePreview(target.id);
  if (finalize && !needsChange) {
    await finalizeFile(target.id);
  }
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

/** PDF 查看器族（Push 226 续三 · 业务口径「这个pdf我也打不开啊」）：PDF 源直通（S4 起 Office / 文本族
 *  不再经转换器出 PDF —— 改走 ONLYOFFICE 查看器通道，这里只剩 PDF 源本身）。 */
const PDF_PREVIEW_EXTENSIONS = [".pdf"];

/** ONLYOFFICE 查看器族（S4 · 名单与 server preview.targets.ts 的 viewerChannelFor 对齐）：Office（含宏变体）
 *  + 文本族（txt / csv / html / htm）。服务端负责最终通道裁决；判不出的文件前端不出预览入口。 */
const OFFICE_VIEWER_EXTENSIONS = [".doc", ".docx", ".docm", ".odt", ".rtf", ".txt", ".html", ".htm", ".xls", ".xlsx", ".xlsm", ".ods", ".csv", ".ppt", ".pptx", ".pptm", ".odp"];

/** 可视预览通道：image = 浏览器直渲染（40×40 缩略图 + img 浮层）；pdf = 浏览器内置查看器（iframe 浮层）；
 *  office = ONLYOFFICE 查看器外壳（S4：api.js + DocEditor，超时 / 重试 / 降级「请下载」）；
 *  判不出 = null（抽屉里没有预览入口，只有改名 / 删除）。 */
export type FilePreviewKind = "image" | "pdf" | "office";
export function previewKindOf(name: string): FilePreviewKind | null {
  if (isImageFileName(name)) {
    return "image";
  }
  const lower = name.toLowerCase();
  if (PDF_PREVIEW_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return "pdf";
  }
  return OFFICE_VIEWER_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? "office" : null;
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

/** 文件定档（Push 249 · 业务口径「添加和替换文件要提示是否为定档文件，若是则上传文件后该任务定档不支持任何修改」）：
 *  POST /files/{id}/finalize —— draft → final（锁版、至少 1 个版本）；挂接任务随文件定档一并定档（服务端同事务、幂等）：
 *  此后任务不支持任何修改（写口一律 409 TASK_FINALIZED），修改走变更（A4-13 申请即通过）。
 *  乐观锁 version 先读详情取回（同 recycle / rename 口径）。 */
export async function finalizeFile(fileId: string): Promise<void> {
  const detail = await apiRequest<{ version: number }>("/api/v1/files/" + encodeURIComponent(fileId));
  await apiSend<{ id: string }>("/api/v1/files/" + encodeURIComponent(fileId) + "/finalize", "POST", { version: detail.version });
}

/** 下载签名响应（契约 FileDownloadUrlResponse 子集）。 */
type FileDownloadUrlResponse = { url: string; fileName: string; sizeBytes: number; expiresAt: string };

/**
 * 取**原文件**的短时签名下载地址（Push 226 续四 · 业务口径「下载为什么都是pdf 你是不是签名调用错了」）：
 * `GET /files/{id}/versions/{versionId}/download-url`（版本必填 —— 缺省先读详情拿当前版本）。
 * Push 255：versionId 可选给出 —— 变更记录「变更前 / 变更后」直接下对应历史版本（A4-06），不再回落到当前版本。
 * 契约语义：签名带 `Content-Disposition: attachment` + 原文件名 → 浏览器落盘的是**原文件字节**
 * （与预览区分：S4 起 Office / 文本族走 ONLYOFFICE 查看器渲染 —— 下载始终拿原文件）；服务端写 download 审计、判 `file.download` 权限。
 */
export async function fetchDownloadUrl(fileId: string, versionId?: string): Promise<{ url: string; fileName: string }> {
  let target = versionId;
  if (target === undefined) {
    const detail = await apiRequest<{ currentVersion: { id: string } | null }>("/api/v1/files/" + encodeURIComponent(fileId));
    target = detail.currentVersion === null ? undefined : detail.currentVersion.id;
  }
  if (target === undefined) {
    throw new Error("文件还没有版本，暂时不能下载");
  }
  const signed = await apiRequest<FileDownloadUrlResponse>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/versions/" + encodeURIComponent(target) + "/download-url",
  );
  return { url: signed.url, fileName: signed.fileName };
}

/** 版本链摘要（Push 255 · 变更记录「变更前 / 变更后」行）：GET /files/{id}/versions —— 只追加的版本链按 seq 反查上一版。 */
export type FileVersionBrief = { id: string; seq: number; sizeBytes: number; uploadedAt: string };

/** 取文件版本链（只追加；变更记录用 seq = 变更版本号 - 1 反查「变更前」文件版本）。 */
export async function fetchFileVersions(fileId: string): Promise<FileVersionBrief[]> {
  const list = await apiRequest<{ items: Array<{ id: string; seq: number; sizeBytes: number; uploadedAt: string }>; total: number }>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/versions",
  );
  return list.items.map((item) => ({ id: item.id, seq: item.seq, sizeBytes: item.sizeBytes, uploadedAt: item.uploadedAt }));
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

/** 任务文件引用（Push 246；2026-10-08 携 status 供「替换」裁决）：任务列表「文件」列下拉与单元格展示共用 ——
 *  id 供预览 / 删除 / 替换，name 供展示，status（draft / final / changed / archived）= 替换走直替还是变更的分支依据。 */
export type TaskFileRef = { id: string; name: string; status: string };

/** 项目文件库名单（任务「文件」列下拉 / 单元格文件名用 · Push 246 起携 id）：按项目分页取满（契约 limit 上限 200、默认排除 recycled），
 *  返回 taskId → 文件引用数组（服务端默认序 = 最新在前）；列表接口不带文件名，逐行反查会 N+1，这里一次拉全量；
 *  Push 246 起带 id（下拉里点击文件名 = 预览、行尾「删除」= 移入回收站）；2026-10-08 起带 status（行尾「替换」按状态直替 / 走变更）。 */
export async function fetchTaskFiles(projectId: string): Promise<Map<string, TaskFileRef[]>> {
  const files = new Map<string, TaskFileRef[]>();
  for (let page = 1; page <= 20; page += 1) {
    const list = await apiRequest<{ items: Array<{ id: string; name: string; taskId: string | null; status: string }>; total: number }>(
      "/api/v1/projects/" + encodeURIComponent(projectId) + "/files?limit=200&page=" + String(page),
    );
    for (const file of list.items) {
      if (file.taskId === null) {
        continue;
      }
      const current = files.get(file.taskId);
      if (current === undefined) {
        files.set(file.taskId, [{ id: file.id, name: file.name, status: file.status }]);
      } else {
        current.push({ id: file.id, name: file.name, status: file.status });
      }
    }
    if (list.items.length === 0 || page * 200 >= list.total) {
      break;
    }
  }
  return files;
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

/** 预览缓存键（Push 255）：版本态预览按 fileId + versionId 分开缓存（缺省版本沿用 fileId —— 附图 / 缩略图口径不变）。 */
function previewCacheKey(fileId: string, versionId?: string): string {
  return versionId === undefined ? fileId : fileId + "@" + versionId;
}

/** 替换 / 内容更新后清掉该文件的预览签名缓存（缓存 URL 指着旧版本；Push 255：该文件的版本态键一并清）。 */
export function invalidatePreview(fileId: string): void {
  let removed = false;
  for (const key of [...previewUrls.keys()]) {
    if (key === fileId || key.startsWith(fileId + "@")) {
      previewUrls.delete(key);
      removed = true;
    }
  }
  if (removed) {
    notifyPreview();
  }
}

/** 预览打开结果（S4 两通道裁决）：url = 产物通道短时签名；viewer = 查看器通道配置；unavailable = 未就绪超时 / 失败 / 异常。 */
export type PreviewOpenOutcome =
  | { kind: "url"; url: string }
  | { kind: "viewer"; viewer: PreviewViewerConfig }
  | { kind: "unavailable"; reason: string | null };

/** 取预览打开输入（带 URL 缓存 + 同文件并发去重；Push 255：versionId 可选 —— 变更记录按版本态取，缓存键分开）。
 *  就绪轮询预算 = 20 秒（Push 226 续：worker 的 outbox 领取间隔
 *  默认 5 秒 —— 首次预览「点开才排队转换」，6 秒窗口在真机上会偶发拿不到；failed 立即返回，不会白等；
 *  查看器通道（Office / 文本）就绪即签发、无需等待转换）。S4：外壳按响应裁决 viewer / url 两通道。 */
export async function ensurePreviewOutcome(fileId: string, versionId?: string): Promise<PreviewOpenOutcome> {
  const key = previewCacheKey(fileId, versionId);
  const cached = previewUrls.get(key);
  if (cached !== undefined) {
    return { kind: "url", url: cached };
  }
  if (previewLoading.has(key)) {
    return { kind: "unavailable", reason: null };
  }
  previewLoading.add(key);
  const endpoint =
    "/api/v1/files/" + encodeURIComponent(fileId) + "/preview" + (versionId === undefined ? "" : "?versionId=" + encodeURIComponent(versionId));
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const preview = await apiRequest<FilePreviewResponse>(endpoint);
      if (preview.status === "ready") {
        if (preview.viewer !== null) {
          return { kind: "viewer", viewer: preview.viewer };
        }
        if (preview.url !== null) {
          previewUrls.set(key, preview.url);
          notifyPreview();
          return { kind: "url", url: preview.url };
        }
        return { kind: "unavailable", reason: null };
      }
      if (preview.status === "failed") {
        return { kind: "unavailable", reason: preview.reason };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { kind: "unavailable", reason: null };
  } catch {
    return { kind: "unavailable", reason: null };
  } finally {
    previewLoading.delete(key);
  }
}

/** 取预览签名（带缓存；产物通道专用 —— 图片缩略图 / 附图懒取、PDF 浮层）。查看器通道走 ensurePreviewOutcome。 */
export async function ensurePreviewUrl(fileId: string): Promise<string | null> {
  const outcome = await ensurePreviewOutcome(fileId);
  return outcome.kind === "url" ? outcome.url : null;
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
