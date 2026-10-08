import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ONLYOFFICE 共享密钥 JWT 原语（HS256 · 安全定稿 §3.2；S3 实施）。
 *
 * 两个使用面共用一份实现：
 * - **配置签发**（PreviewReadService）：对 documentType / document / editorConfig / permissions 四段逐字
 *   签发 `viewer.token`（另附 iat / exp，TTL = ONLYOFFICE_JWT_TTL_SECONDS）；
 * - **受控端点自验**（PreviewContentService）：校验 DocServer outbox Bearer（claims = `{ payload: { url }, iat, exp }`，
 *   DocServer 逐请求现签、TTL 300s —— PoC-10 抓包 E1 / 离线复核 E2）。
 *
 * 不引入 JWT 依赖：只做 HS256 一种算法 —— 严格拒绝 `alg != "HS256"`（含 `alg=none`）、
 * 严格 base64url 解码、签名常量时间比较、`payload.url` 逐字绑定、exp 复核（C5 时钟漂移容差）。
 */

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** 严格 base64url 解码：非法字符 / 宽松解码（归一化后重编码不一致）→ null，不做容错解析。 */
function decodeSegment(segment: string): Buffer | null {
  const normalized = segment.replace(/=+$/, "");
  if (normalized.length === 0 || !BASE64URL_PATTERN.test(normalized)) {
    return null;
  }
  const decoded = Buffer.from(normalized, "base64url");
  return decoded.toString("base64url") === normalized ? decoded : null;
}

/** HS256 签发（claims 原样进载荷；调用方负责 iat / exp）。 */
export function signHs256Jwt(claims: Record<string, unknown>, secret: string): string {
  const header = encodeSegment({ alg: "HS256", typ: "JWT" });
  const body = encodeSegment(claims);
  const signature = createHmac("sha256", secret).update(header + "." + body).digest("base64url");
  return header + "." + body + "." + signature;
}

/** 校验失败原因（仅进诊断日志 —— C3：响应侧统一 401 不区分原因）。 */
export type PullTokenFailureReason =
  | "secret_missing"
  | "malformed"
  | "alg"
  | "signature"
  | "claims"
  | "expired"
  | "url_mismatch";

export type PullTokenCheck = { ok: true } | { ok: false; reason: PullTokenFailureReason };

/**
 * 校验 DocServer 拉取凭证（安全定稿 §3.2 三条校验；任一不过 fail-closed）：
 * 1. **签名**：HS256 + 共享密钥 —— `alg` 必须逐字 = "HS256"（拒绝 `none` / 其它算法），签名常量时间比较；
 * 2. **绑定**：`claims.payload.url` == `expectedUrl`（调用方以「DocServer 视角基址 + 原始请求 path/query」
 *    构造 —— C1：同源生成、不信任 Host 头）；
 * 3. **时效**：`exp > now - tolerance`（C5：容差 ≤60s 且配置化；语义 = 到期后容差秒内仍按有效处理）。
 */
export function verifyPullToken(input: {
  token: string | null;
  secret: string;
  expectedUrl: string;
  nowSeconds: number;
  clockToleranceSeconds: number;
}): PullTokenCheck {
  if (input.secret === "") {
    return { ok: false, reason: "secret_missing" };
  }
  if (input.token === null || input.token === "") {
    return { ok: false, reason: "malformed" };
  }
  const parts = input.token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed" };
  }
  const headerSegment = parts[0]!;
  const bodySegment = parts[1]!;
  const signatureSegment = parts[2]!;
  const headerBytes = decodeSegment(headerSegment);
  const bodyBytes = decodeSegment(bodySegment);
  const signature = decodeSegment(signatureSegment);
  if (headerBytes === null || bodyBytes === null || signature === null) {
    return { ok: false, reason: "malformed" };
  }
  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(headerBytes.toString("utf8"));
    claims = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof header !== "object" || header === null || (header as { alg?: unknown }).alg !== "HS256") {
    return { ok: false, reason: "alg" };
  }
  const expected = createHmac("sha256", input.secret).update(headerSegment + "." + bodySegment).digest();
  if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) {
    return { ok: false, reason: "signature" };
  }
  const payload = typeof claims === "object" && claims !== null ? (claims as { payload?: unknown }).payload : undefined;
  const url = typeof payload === "object" && payload !== null ? (payload as { url?: unknown }).url : undefined;
  const exp = typeof claims === "object" && claims !== null ? (claims as { exp?: unknown }).exp : undefined;
  if (typeof url !== "string" || url === "" || typeof exp !== "number" || !Number.isFinite(exp)) {
    return { ok: false, reason: "claims" };
  }
  // C5 语义：exp > now - tolerance（到期后容差秒内仍按未过期处理；超出即拒绝）。
  if (!(exp > input.nowSeconds - input.clockToleranceSeconds)) {
    return { ok: false, reason: "expired" };
  }
  if (url !== input.expectedUrl) {
    return { ok: false, reason: "url_mismatch" };
  }
  return { ok: true };
}

/**
 * 「DocServer 视角」绝对 URL（C1：单一配置基址 + 原始请求 path/query 的**唯一**拼接入口 —— 不信任 Host 头；
 * 签发侧（document.url / payload.url）与校验侧（本请求规范化绝对 URL）都经这里，杜绝双份配置漂移）。
 */
export function absoluteDocServerApiUrl(baseUrl: string, requestPath: string): string {
  return baseUrl.replace(/\/+$/, "") + requestPath;
}

/** 受控端点绝对 URL（签发侧入口：固定 path 经 `absoluteDocServerApiUrl` 同源生成）。 */
export function buildPreviewContentUrl(baseUrl: string, fileId: string, versionId: string): string {
  return absoluteDocServerApiUrl(baseUrl, "/api/v1/files/" + fileId + "/versions/" + versionId + "/preview-content");
}
