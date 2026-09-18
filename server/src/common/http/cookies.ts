export interface CookieOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
  path?: string;
}

/** 解析 Cookie 请求头（不引入额外依赖；与 Express 的 req.headers.cookie 同源）。 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined || header === "") {
    return out;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name === "") {
      continue;
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** 序列化单个 Set-Cookie（默认 HttpOnly + Path=/；SameSite / Secure 由调用方按环境给出）。 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [name + "=" + encodeURIComponent(value), "Path=" + (options.path ?? "/")];
  if (options.maxAgeSeconds !== undefined) {
    parts.push("Max-Age=" + String(Math.max(0, Math.floor(options.maxAgeSeconds))));
  }
  if (options.httpOnly ?? true) {
    parts.push("HttpOnly");
  }
  if (options.sameSite !== undefined) {
    parts.push("SameSite=" + options.sameSite);
  }
  if (options.secure === true) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
