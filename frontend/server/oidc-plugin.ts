import * as crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * 本地开发用的 OIDC 后端（BFF）。
 *
 * 浏览器侧只负责跳转与展示；令牌交换必须发生在服务端，client_secret 不能进浏览器。
 * 生产环境把下面 4 个路由搬到自己的后端即可（逻辑完全一致）：
 *   GET /auth/login     生成 PKCE 参数，302 到 Casdoor 授权页
 *   GET /auth/callback  校验 state，用 code + code_verifier + client_secret 换令牌，建立会话
 *   GET /auth/me        JWKS 验签 id_token，返回用户字段
 *   GET /auth/logout    清理本地会话，并 302 到 Casdoor 统一登出
 */

type Env = Record<string, string>;

type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
};

type TransientState = {
  state: string;
  verifier: string;
};

type TokenEndpointResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type Jwk = {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
};

type JwtHeader = {
  kid?: string;
  alg?: string;
};

const TRANSIENT_COOKIE = "ll_oidc";
const ACCESS_COOKIE = "ll_at";
const ID_TOKEN_COOKIE = "ll_idt";
const TRANSIENT_MAX_AGE = 600;
const CACHE_TTL = 10 * 60 * 1000;
const DEFAULT_EXPIRES_IN = 7200;

let discoveryCache: { jwksUri: string; expiresAt: number } | null = null;
let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

function trimTrailingSlashes(value: string): string {
  let out = value;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

function readConfig(env: Env): OidcConfig {
  return {
    issuer: trimTrailingSlashes(env.CASDOOR_ISSUER ?? "http://localhost:8000"),
    clientId: env.CASDOOR_CLIENT_ID ?? "",
    clientSecret: env.CASDOOR_CLIENT_SECRET ?? "",
    redirectUri: env.CASDOOR_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
    scope: env.CASDOOR_SCOPE ?? "openid profile email",
  };
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== "") {
      out[name] = decodeURIComponent(value);
    }
  }
  return out;
}

function cookieString(name: string, value: string, maxAgeSeconds: number): string {
  return [
    name + "=" + encodeURIComponent(value),
    "Path=/",
    "Max-Age=" + String(maxAgeSeconds),
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}

function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  if (existing === undefined) {
    res.setHeader("Set-Cookie", [cookie]);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
    return;
  }
  res.setHeader("Set-Cookie", [String(existing), cookie]);
}

function respondJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function respondText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(message);
}

function buildAuthorizeUrl(config: OidcConfig, state: string, challenge: string): string {
  const url = new URL(config.issuer + "/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function exchangeCode(config: OidcConfig, code: string, verifier: string): Promise<TokenEndpointResponse> {
  const url = new URL(config.issuer + "/api/login/oauth/access_token");
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code_verifier", verifier);
  const response = await fetch(url, { method: "POST" });
  const text = await response.text();
  try {
    return JSON.parse(text) as TokenEndpointResponse;
  } catch {
    return { error: "invalid_response", error_description: text.slice(0, 200) };
  }
}

function decodeSegment(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

function readJwtHeader(token: string): JwtHeader | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(decodeSegment(parts[0])) as JwtHeader;
  } catch {
    return null;
  }
}

function verifySignedToken(token: string, key: crypto.KeyObject): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const signed = parts[0] + "." + parts[1];
  const signature = Buffer.from(parts[2], "base64url");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(signed), key, signature);
  if (!ok) {
    return null;
  }
  try {
    return JSON.parse(decodeSegment(parts[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchJwksUri(config: OidcConfig): Promise<string> {
  const now = Date.now();
  const cached = discoveryCache;
  if (cached !== null && cached.expiresAt > now) {
    return cached.jwksUri;
  }
  const response = await fetch(config.issuer + "/.well-known/openid-configuration");
  if (!response.ok) {
    throw new Error("OIDC discovery 请求失败: HTTP " + String(response.status));
  }
  const document = (await response.json()) as { jwks_uri?: string };
  if (document.jwks_uri === undefined || document.jwks_uri === "") {
    throw new Error("OIDC discovery 文档缺少 jwks_uri");
  }
  discoveryCache = { jwksUri: document.jwks_uri, expiresAt: now + CACHE_TTL };
  return document.jwks_uri;
}

async function fetchSigningKey(config: OidcConfig, kid: string | undefined): Promise<crypto.KeyObject> {
  const now = Date.now();
  let cache = jwksCache;
  if (cache === null || cache.expiresAt <= now) {
    const jwksUri = await fetchJwksUri(config);
    const response = await fetch(jwksUri);
    if (!response.ok) {
      throw new Error("JWKS 请求失败: HTTP " + String(response.status));
    }
    const document = (await response.json()) as { keys?: Jwk[] };
    cache = { keys: document.keys ?? [], expiresAt: now + CACHE_TTL };
    jwksCache = cache;
  }
  const candidates = cache.keys.filter((item) => item.kty === "RSA");
  const matched = candidates.find((item) => item.kid === kid) ?? candidates[0];
  if (matched === undefined) {
    throw new Error("JWKS 中没有可用的 RSA 公钥");
  }
  return crypto.createPublicKey({ key: matched as crypto.JsonWebKey, format: "jwk" });
}

function handleLogin(config: OidcConfig, res: ServerResponse): void {
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const transient: TransientState = { state, verifier };
  appendSetCookie(res, cookieString(TRANSIENT_COOKIE, JSON.stringify(transient), TRANSIENT_MAX_AGE));
  res.statusCode = 302;
  res.setHeader("Location", buildAuthorizeUrl(config, state, challenge));
  res.end();
}

async function handleCallback(config: OidcConfig, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const authError = url.searchParams.get("error");
  if (authError !== null) {
    respondText(res, 400, "SSO 授权失败: " + authError + " " + (url.searchParams.get("error_description") ?? ""));
    return;
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const transientRaw = parseCookies(req)[TRANSIENT_COOKIE];
  if (code === null || state === null || transientRaw === undefined) {
    respondText(res, 400, "缺少 code / state，或登录会话已过期。请从应用入口重新进入。");
    return;
  }
  let transient: TransientState;
  try {
    transient = JSON.parse(transientRaw) as TransientState;
  } catch {
    respondText(res, 400, "登录会话数据已损坏，请从应用入口重新进入。");
    return;
  }
  if (state !== transient.state) {
    respondText(res, 400, "state 校验失败（可能同时开了多个登录标签页），请从应用入口重新进入。");
    return;
  }
  const tokens = await exchangeCode(config, code, transient.verifier);
  if (tokens.error !== undefined || tokens.access_token === undefined) {
    respondText(res, 400, "换取令牌失败: " + (tokens.error ?? "") + " " + (tokens.error_description ?? ""));
    return;
  }
  const maxAge = tokens.expires_in ?? DEFAULT_EXPIRES_IN;
  appendSetCookie(res, cookieString(ACCESS_COOKIE, tokens.access_token, maxAge));
  if (tokens.id_token !== undefined) {
    appendSetCookie(res, cookieString(ID_TOKEN_COOKIE, tokens.id_token, maxAge));
  }
  appendSetCookie(res, cookieString(TRANSIENT_COOKIE, "", 0));
  res.statusCode = 302;
  res.setHeader("Location", "/");
  res.end();
}

async function handleMe(config: OidcConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = parseCookies(req)[ID_TOKEN_COOKIE];
  if (token === undefined) {
    respondJson(res, 401, { error: "unauthenticated" });
    return;
  }
  const header = readJwtHeader(token);
  const key = await fetchSigningKey(config, header?.kid);
  const claims = verifySignedToken(token, key);
  if (claims === null) {
    respondJson(res, 401, { error: "invalid_token" });
    return;
  }
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  if (exp !== null && exp * 1000 <= Date.now()) {
    respondJson(res, 401, { error: "token_expired" });
    return;
  }
  const user = {
    name: claims.name ?? null,
    displayName: claims.displayName ?? null,
    email: claims.email ?? null,
    id: claims.id ?? null,
    owner: claims.owner ?? null,
  };
  respondJson(res, 200, { user, claims, expiresAt: exp });
}

function handleLogout(config: OidcConfig, req: IncomingMessage, res: ServerResponse): void {
  const idToken = parseCookies(req)[ID_TOKEN_COOKIE];
  appendSetCookie(res, cookieString(ACCESS_COOKIE, "", 0));
  appendSetCookie(res, cookieString(ID_TOKEN_COOKIE, "", 0));
  appendSetCookie(res, cookieString(TRANSIENT_COOKIE, "", 0));
  if (idToken === undefined) {
    res.statusCode = 302;
    res.setHeader("Location", "/");
    res.end();
    return;
  }
  const url = new URL(config.issuer + "/api/logout");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", new URL(config.redirectUri).origin + "/");
  url.searchParams.set("id_token_hint", idToken);
  res.statusCode = 302;
  res.setHeader("Location", url.toString());
  res.end();
}

async function handleRequest(config: OidcConfig, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  switch (url.pathname) {
    case "/auth/login": {
      handleLogin(config, res);
      return;
    }
    case "/auth/callback": {
      await handleCallback(config, req, res, url);
      return;
    }
    case "/auth/me": {
      await handleMe(config, req, res);
      return;
    }
    case "/auth/logout": {
      handleLogout(config, req, res);
      return;
    }
    default: {
      respondText(res, 404, "Not Found");
    }
  }
}

export function oidcPlugin(env: Env): Plugin {
  const config = readConfig(env);
  return {
    name: "libiaolink-oidc-bff",
    configureServer(server) {
      if (config.clientSecret === "") {
        server.config.logger.warn("[oidc] 缺少 CASDOOR_CLIENT_SECRET：复制 .env.example 为 .env.local 并填入应用 Secret");
      }
      server.config.logger.info("[oidc] issuer=" + config.issuer + "  redirectUri=" + config.redirectUri);
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/auth/")) {
          next();
          return;
        }
        void handleRequest(config, req, res, url).catch((error: unknown) => {
          respondJson(res, 500, { error: "server_error", message: String(error) });
        });
      });
    },
  };
}
