/**
 * 对象键构造（ADR-006 工程要点 + 契约 FileVersion 描述）。
 *
 * 键形 = `projects/{projectId}/files/{fileId}/v{seq}/{contentHash}.{ext}`
 * - 版本、内容哈希都在键里：**定档不覆盖物理对象**，历史版本天然不可变；
 * - 原文件名（含中文）只进元数据，不进键（避免编码 / 超长 / 特殊字符问题）。
 *
 * 所有输入都来自服务端自身（不是客户端字符串拼接），但仍做严格校验：
 * 对象键是路径，任何未净化的片段都可能被解析成越权路径。
 */

const FALLBACK_EXTENSION = "bin";
const MAX_EXTENSION_LENGTH = 16;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

/** 取扩展名：小写、仅 `[a-z0-9]`、最长 16；无 / 非法 / 过长一律回落 `bin`。 */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) {
    return FALLBACK_EXTENSION;
  }
  const raw = fileName.slice(dot + 1).toLowerCase();
  if (raw.length > MAX_EXTENSION_LENGTH || !/^[a-z0-9]+$/.test(raw)) {
    return FALLBACK_EXTENSION;
  }
  return raw;
}

export interface ObjectKeyInput {
  projectId: string;
  fileId: string;
  /** 版本号（同一文件内递增，从 1 开始）。 */
  seq: number;
  /** 内容哈希（SHA-256 十六进制）；键里用哈希保证同版本不同内容不互相覆盖。 */
  contentHash: string;
  /** 原始文件名：只取扩展名。 */
  fileName: string;
}

export function buildObjectKey(input: ObjectKeyInput): string {
  if (!Number.isInteger(input.seq) || input.seq < 1) {
    throw new Error("对象键构造失败：seq 必须是 >= 1 的整数");
  }
  if (!SHA256_HEX.test(input.contentHash)) {
    throw new Error("对象键构造失败：contentHash 必须是 SHA-256 十六进制");
  }
  assertUuid(input.projectId, "projectId");
  assertUuid(input.fileId, "fileId");
  return `projects/${input.projectId}/files/${input.fileId}/v${input.seq}/${input.contentHash.toLowerCase()}.${extensionOf(input.fileName)}`;
}

/** 上传会话（未定版）的暂存键：同一文件可并发多个会话，按会话 id 隔离。 */
export function buildUploadStagingKey(input: { projectId: string; fileId: string; sessionId: string }): string {
  assertUuid(input.projectId, "projectId");
  assertUuid(input.fileId, "fileId");
  assertUuid(input.sessionId, "sessionId");
  return `projects/${input.projectId}/files/${input.fileId}/staging/${input.sessionId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID.test(value)) {
    throw new Error(`对象键构造失败：${field} 不是合法的 UUID`);
  }
}
