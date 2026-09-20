import type { ErrorCode } from "@libiaolink/contracts";
import { AppError } from "../common/errors/app-error.js";

/**
 * 对象存储端口（ADR-006：全部代码只依赖 S3 协议接口，实现可替换）。
 *
 * 约定：
 * - 调用方只消费「预签名地址」与「存储侧权威状态」，不接触任何厂商专属 API；
 * - 分片状态以对象存储 ListParts 为唯一真相（**不落 `upload_parts` 表**，2026-09-18 评审定案）；
 * - api 只签名与登记元数据，不代理大文件流量（ADR-006 工程要点）。
 *
 * 端口用抽象类而非 interface：NestJS 以类作为注入令牌，消费方无需 `@Inject`。
 */

export interface MultipartUploadRef {
  objectKey: string;
  uploadId: string;
}

export interface UploadedPart {
  partNumber: number;
  sizeBytes: number;
  etag: string;
  lastModified: Date | null;
}

export interface ObjectHead {
  objectKey: string;
  sizeBytes: number;
  etag: string | null;
  contentType: string | null;
  lastModified: Date | null;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export interface CreateMultipartUploadInput {
  objectKey: string;
  contentType?: string | null;
  /** 对象元数据（原文件名等）；S3 元数据值必须是可见 ASCII，中文由调用方编码后传入。 */
  metadata?: Record<string, string>;
}

export interface PartUploadUrlInput {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds?: number;
}

export interface MultipartUploadKeyInput {
  objectKey: string;
  uploadId: string;
}

export interface CompleteMultipartUploadInput extends MultipartUploadKeyInput {
  /** 分片清单（顺序无关，适配器按编号升序提交）。 */
  parts: readonly { partNumber: number; etag: string }[];
}

export interface DownloadUrlInput {
  objectKey: string;
  /** 原始文件名（含中文）：用于签名响应头 Content-Disposition，不参与对象键。 */
  fileName?: string;
  expiresInSeconds?: number;
}

export abstract class ObjectStorage {
  abstract readonly bucket: string;

  /** 创建分片上传会话（S3 CreateMultipartUpload）；分片状态不落库。 */
  abstract createMultipartUpload(input: CreateMultipartUploadInput): Promise<MultipartUploadRef>;
  /** 分片预签名 PUT（浏览器直传对象存储）。 */
  abstract signPartUploadUrl(input: PartUploadUrlInput): Promise<SignedUrl>;
  /** 已上传分片（断点续传的唯一真相；适配器内部处理分页与排序）。 */
  abstract listParts(input: MultipartUploadKeyInput): Promise<UploadedPart[]>;
  abstract completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<{ etag: string | null }>;
  /** 中止上传（幂等：会话已不存在时不报错）。 */
  abstract abortMultipartUpload(input: MultipartUploadKeyInput): Promise<void>;

  /** 对象元数据；对象不存在返回 null（不抛错）。 */
  abstract headObject(objectKey: string): Promise<ObjectHead | null>;
  /** 短时签名下载地址（ADR-006：对象存储禁止匿名读取）。 */
  abstract signDownloadUrl(input: DownloadUrlInput): Promise<SignedUrl>;
  abstract deleteObject(objectKey: string): Promise<void>;

  /** 就绪探针：桶可达（/readyz 使用）。 */
  abstract probe(): Promise<void>;
}

/** 存储失败分类：适配器内部口径，由 toApiError 映射到契约错误码。 */
export type StorageFailureCode =
  /** 存储侧不存在该上传会话（已中止 / 生命周期已清理）→ 410 重新发起。 */
  | "upload_not_found"
  /** 对象不存在 → 404。 */
  | "object_not_found"
  /** 分片缺失 / 编号非法 / 大小不合法（重传可解）→ 409 补传。 */
  | "part_conflict"
  /** 网络、凭据、桶配置等存储侧不可用 → 500。 */
  | "unavailable";

export class StorageError extends Error {
  readonly code: StorageFailureCode;

  constructor(code: StorageFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
  }
}

const API_ERROR_BY_FAILURE: Record<StorageFailureCode, { code: ErrorCode; message: string }> = {
  upload_not_found: { code: "UPLOAD_SESSION_EXPIRED", message: "上传会话已过期，请重新发起上传" },
  object_not_found: { code: "NOT_FOUND", message: "文件对象不存在" },
  part_conflict: { code: "UPLOAD_INCOMPLETE", message: "上传分片未齐或不可用，请补传后重试" },
  unavailable: { code: "INTERNAL", message: "对象存储暂不可用，请稍后重试" },
};

/** 存储失败 → 统一错误信封（错误码取自契约；HTTP 状态由契约映射表决定）。 */
export function toApiError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof StorageError) {
    const mapped = API_ERROR_BY_FAILURE[error.code];
    return new AppError(mapped.code, mapped.message);
  }
  return new AppError("INTERNAL", API_ERROR_BY_FAILURE.unavailable.message);
}
