/** 会话 Cookie：HttpOnly，值为不透明令牌（DB 只存 sha256 哈希）。 */
export const SESSION_COOKIE = "ll_sid";
/** 登录转场 Cookie：state + verifier + returnTo（PKCE 往返，10 分钟有效）。 */
export const TRANSIENT_COOKIE = "ll_oidc";
/** CSRF 同步 Token Cookie（可读；写接口需回传 X-CSRF-Token，见 CsrfGuard）。 */
export const CSRF_COOKIE = "ll_csrf";
export const TRANSIENT_MAX_AGE_SECONDS = 600;
