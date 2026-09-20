/**
 * 分片计划：S3 协议对 Multipart Upload 的硬约束。
 * - 除最后一片外，每片 >= 5 MiB（小于会被 CompleteMultipartUpload 拒绝：EntityTooSmall）；
 * - 每片 <= 5 GiB；总片数 <= 10000。
 * 契约里客户端不传分片大小，`partSizeBytes` / `totalParts` 由服务端在 UploadCreateResponse 给出。
 */

export const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_PART_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_PARTS = 10_000;
/** 默认分片大小：8 MiB（重传代价与请求数的折中；大文件按需翻倍）。 */
export const DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;

export interface UploadPlan {
  partSizeBytes: number;
  totalParts: number;
}

/** 按总大小定分片（保证 totalParts <= 10000）；空文件按 1 片处理（S3 要求至少 1 片）。 */
export function planUpload(sizeBytes: number): UploadPlan {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("分片计划失败：sizeBytes 必须是 >= 0 的整数");
  }
  if (sizeBytes === 0) {
    return { partSizeBytes: DEFAULT_PART_SIZE_BYTES, totalParts: 1 };
  }
  let partSizeBytes = DEFAULT_PART_SIZE_BYTES;
  let totalParts = Math.ceil(sizeBytes / partSizeBytes);
  while (totalParts > MAX_PARTS) {
    partSizeBytes *= 2;
    totalParts = Math.ceil(sizeBytes / partSizeBytes);
  }
  return { partSizeBytes, totalParts };
}

/** 缺失分片（断点续传只补这些）：以对象存储 ListParts 结果为唯一真相。 */
export function missingPartNumbers(uploadedPartNumbers: readonly number[], totalParts: number): number[] {
  const uploaded = new Set(uploadedPartNumbers);
  const missing: number[] = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (!uploaded.has(partNumber)) {
      missing.push(partNumber);
    }
  }
  return missing;
}
