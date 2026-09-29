/**
 * 文件库客户端（Push 216 · 日报 / 问题附图上传与预览接线；后续文件库切片复用）。
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

/** 上传一张图片 / 文件（粘贴与选文件共用）：返回 file_links 用的文件 id。 */
export async function uploadPhoto(projectId: string, blob: Blob, name: string): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const contentHash = await sha256Hex(buffer);
  const created = await apiSend<UploadCreateResponse>("/api/v1/files/uploads", "POST", {
    projectId,
    name,
    sizeBytes: blob.size,
    mime: blob.type === "" ? undefined : blob.type,
    contentHash,
    intent: "version",
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
      throw new Error("图片上传失败（第 " + String(part.partNumber) + " 片，HTTP " + String(response.status) + "）");
    }
  }
  await apiSend<UploadCompleteResponse>(
    "/api/v1/files/" + encodeURIComponent(fileId) + "/uploads/" + encodeURIComponent(uploadId) + "/complete",
    "POST",
    { contentHash },
  );
  return fileId;
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

/** 取预览签名（带缓存；not_ready 轮询至多约 6 秒 —— 图片通道通常首查即 ready）。 */
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
    for (let attempt = 0; attempt < 12; attempt += 1) {
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
