/**
 * 后端接口调用封装（k6 起：会话由后端 /auth/* 承载）。
 * - 写请求自动回传 CSRF 同步 token：ll_csrf（可读 Cookie）→ X-CSRF-Token（后端 CsrfGuard 校验）。
 * - 401 统一跳 SSO 登录，并带 returnTo 回跳当前页面。
 * 契约来源：shared/src/modules/identity.ts。
 */

const CSRF_COOKIE = "ll_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

/** fetch 封装：同源 Cookie + CSRF 头 + Accept: application/json。 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (!SAFE_METHODS.has(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token !== null && token !== "") {
      headers.set(CSRF_HEADER, token);
    }
  }
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}

/** 跳 SSO 登录（带 returnTo，登录后回到当前页面）。 */
export function redirectToLogin(): void {
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  window.location.replace("/auth/login?returnTo=" + encodeURIComponent(returnTo));
}
