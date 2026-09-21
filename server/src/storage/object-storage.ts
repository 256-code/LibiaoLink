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

export interface CopyObjectInput {
  sourceKey: string;
  destinationKey: string;
  /** 目标对象的内容类型与元数据；不传则继承源对象（MetadataDirective: COPY）。 */
  contentType?: string | null;
  metadata?: Record<string, string>;
}

export interface CopyObjectResult {
  etag: string | null;
  /** 目标对象的版本号（版本化桶返回；未开启版本控制为 null）。 */
  versionId: string | null;
}

export interface PurgeObjectResult {
  /** 删掉的数据版本数（不含 delete marker）。 */
  deletedVersions: number;
  /** 顺带清掉的 delete marker 数。 */
  deleteMarkers: number;
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
  /**
   * **彻底删除**：删掉该键的所有版本（含 delete marker）。
   *
   * 不能只调 `DeleteObject`：桶开了版本控制后，不带 `versionId` 的删除只写一个 delete marker，
   * 数据版本永远留在桶里 —— 暂存对象清理与 M4-02「彻底删除」都必须按版本删（px 复核提出，
   * 2026-09-21 真机确认）。
   */
  abstract purgeObject(objectKey: string): Promise<PurgeObjectResult>;
  /**
   * 服务端复制（complete 时 `…/staging/{sessionId}` → 契约键）；源对象超过单次复制上限时
   * 抛 `object_too_large`（一期由 `UPLOAD_MAX_SIZE_MB` 校验挡在上限内）。
   */
  abstract copyObject(input: CopyObjectInput): Promise<CopyObjectResult>;

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
  /** 源对象超过单次复制上限（5 GiB）→ 500（一期由 UPLOAD_MAX_SIZE_MB 挡住，属实现 / 配置限制）。 */
  | "object_too_large"
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
  object_too_large: { code: "INTERNAL", message: "对象超过单次复制上限（5 GiB），需改用分片复制" },
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
