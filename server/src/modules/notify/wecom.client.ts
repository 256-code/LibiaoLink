/**
 * 企微客户端内核（M5-03-1）：自建应用消息（token + 限速）与群机器人 webhook（限速）两个发送面。
 *
 * 行为口径（实施方案 §五 · 处置三分类）：
 *   - 分类结果**不抛业务异常**：ok / permanent / retryable / rate_limited / token_invalid 由返回载荷承载；
 *   - token_invalid（40014 / 41001 / 42001）→ `token.refreshAfterInvalid()` 后**重发恰一次**
 *     （失效重取一次；重取后仍 token_invalid → 原样返回，调用方按配置类处置）；
 *   - 限速：发送前 `limiter.tryConsume`；本地桶拒绝 → 不发 HTTP，返回 rate_limited + retryAt
 *     （调用方延期重排、**不消耗重试次数**）；errcode 45009 由分类表归 rate_limited（retryAt = null，
 *     退避落点由消费侧策略定）；
 *   - 超时（WECOM_TIMEOUT_MS）走 AbortSignal.timeout；传输层异常统一 retryable，错误文本过掩码；
 *   - 安全：不日志、不回显 webhook 明文与 token（计数键只出 URL 摘要；错误描述过掩码）。
 *
 * 接线边界：本刀只交付内核（无 outbox / 投递接线）—— 消费侧接线随 M5-03-2 / M5-03-3；
 * 装配入口 `createWecomClientFromEnv(env, overrides?)`（单测 / stub 回放注入 fetcher / 内存计数 / 时钟）。
 */
import type { Env } from "../../config/env.js";
import {
  classifyWecomErrcode,
  classifyWecomHttpStatus,
  describeNetworkError,
  type WecomChannel,
  type WecomFailureKind,
} from "./wecom.errors.js";
import {
  InMemoryRateWindowStore,
  WECOM_APP_BUCKET_ID,
  WecomRateLimiter,
  webhookBucketId,
  type RateWindowStore,
} from "./wecom.rate.js";
import { WecomTokenError, WecomTokenManager, type WecomTokenInfo } from "./wecom.token.js";

export type WecomSendResult =
  | { ok: true; retriedToken: boolean; attempts: number }
  | {
      ok: false;
      kind: WecomFailureKind;
      errcode: number | null;
      errmsg: string | null;
      httpStatus: number | null;
      /** 本地限速桶拒绝时为「下一窗口起点」；errcode 45009 / 传输层失败为 null（退避由消费侧定）。 */
      retryAt: Date | null;
      retriedToken: boolean;
      /** 实际发出的 HTTP 次数（本地限速拒绝 = 0；token 重发路径最多 2）。 */
      attempts: number;
    };

/** HTTP 层归一化结果：ok = errcode 0；errcode = 业务错误码；http_error / network_error = 传输层。 */
interface WecomHttpOutcome {
  status: "ok" | "errcode" | "http_error" | "network_error";
  errcode: number | null;
  errmsg: string | null;
  httpStatus: number | null;
  raw: unknown;
}

async function requestJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<WecomHttpOutcome> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { status: "network_error", errcode: null, errmsg: describeNetworkError(error), httpStatus: null, raw: null };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const errcode = readErrcode(payload);
  if (errcode !== null) {
    return {
      status: errcode === 0 ? "ok" : "errcode",
      errcode,
      errmsg: readErrmsg(payload),
      httpStatus: response.status,
      raw: payload,
    };
  }
  return { status: "http_error", errcode: null, errmsg: "HTTP " + String(response.status), httpStatus: response.status, raw: payload };
}

function readErrcode(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const value = (payload as Record<string, unknown>)["errcode"];
  return typeof value === "number" ? value : null;
}

function readErrmsg(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const value = (payload as Record<string, unknown>)["errmsg"];
  return typeof value === "string" ? value : null;
}

function readTokenInfo(payload: unknown): WecomTokenInfo | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const token = record["access_token"];
  const expiresIn = record["expires_in"];
  if (typeof token !== "string" || token === "") {
    return null;
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }
  return { token, expiresInSeconds: expiresIn };
}

export interface WecomClientOptions {
  /** 企微 API 基址（联调 / stub 可替换；生产 = https://qyapi.weixin.qq.com）。 */
  baseUrl: string;
  /** 单次 HTTP 超时（毫秒）。 */
  timeoutMs: number;
  /** 自建应用 AgentId（进 message/send 包体）。 */
  agentId: number;
  fetcher: typeof fetch;
  token: WecomTokenManager;
  limiter: WecomRateLimiter;
  now?: () => number;
}

export class WecomClient {
  constructor(private readonly options: WecomClientOptions) {}

  /** 自建应用文本消息：限速（app 桶）→ token → `message/send`；token_invalid → 失效重取一次并重发一次。 */
  async sendAppText(params: { toUser: readonly string[]; content: string }): Promise<WecomSendResult> {
    const rate = await this.options.limiter.tryConsume("app", WECOM_APP_BUCKET_ID, this.now());
    if (!rate.ok) {
      return {
        ok: false,
        kind: "rate_limited",
        errcode: null,
        errmsg: "本地限速桶已满（" + String(rate.count) + "/" + String(rate.limit) + "）",
        httpStatus: null,
        retryAt: rate.retryAt,
        retriedToken: false,
        attempts: 0,
      };
    }
    let token: string;
    try {
      token = await this.options.token.getToken();
    } catch (error) {
      return this.tokenFailure(error, false, 0);
    }
    const body = {
      touser: params.toUser.join("|"),
      msgtype: "text",
      agentid: this.options.agentId,
      text: { content: params.content },
    };
    const first = await this.post(token, body);
    if (first.status === "ok") {
      return { ok: true, retriedToken: false, attempts: 1 };
    }
    if (first.status === "errcode" && first.errcode !== null && classifyWecomErrcode("wecom_app", first.errcode) === "token_invalid") {
      let refreshed: string;
      try {
        refreshed = await this.options.token.refreshAfterInvalid();
      } catch (error) {
        return this.tokenFailure(error, true, 1);
      }
      const second = await this.post(refreshed, body);
      if (second.status === "ok") {
        return { ok: true, retriedToken: true, attempts: 2 };
      }
      return this.failure(second, "wecom_app", true, 2);
    }
    return this.failure(first, "wecom_app", false, 1);
  }

  /** 群机器人文本消息：限速（webhook 桶）→ POST webhook 地址；无 token 面。 */
  async sendGroupText(params: { webhookUrl: string; content: string; bucketId?: string }): Promise<WecomSendResult> {
    const bucketId = params.bucketId ?? webhookBucketId(params.webhookUrl);
    const rate = await this.options.limiter.tryConsume("group", bucketId, this.now());
    if (!rate.ok) {
      return {
        ok: false,
        kind: "rate_limited",
        errcode: null,
        errmsg: "本地限速桶已满（" + String(rate.count) + "/" + String(rate.limit) + "）",
        httpStatus: null,
        retryAt: rate.retryAt,
        retriedToken: false,
        attempts: 0,
      };
    }
    const outcome = await requestJson(
      this.options.fetcher,
      params.webhookUrl,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msgtype: "text", text: { content: params.content } }) },
      this.options.timeoutMs,
    );
    if (outcome.status === "ok") {
      return { ok: true, retriedToken: false, attempts: 1 };
    }
    return this.failure(outcome, "wecom_group", false, 1);
  }

  private post(token: string, body: Record<string, unknown>): Promise<WecomHttpOutcome> {
    const url = this.options.baseUrl + "/cgi-bin/message/send?access_token=" + encodeURIComponent(token);
    return requestJson(
      this.options.fetcher,
      url,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      this.options.timeoutMs,
    );
  }

  private failure(outcome: WecomHttpOutcome, channel: WecomChannel, retriedToken: boolean, attempts: number): WecomSendResult {
    if (outcome.status === "ok") {
      return { ok: true, retriedToken, attempts };
    }
    if (outcome.status === "errcode" && outcome.errcode !== null) {
      const kind = classifyWecomErrcode(channel, outcome.errcode);
      return {
        ok: false,
        kind,
        errcode: outcome.errcode,
        errmsg: outcome.errmsg,
        httpStatus: outcome.httpStatus,
        retryAt: null,
        retriedToken,
        attempts,
      };
    }
    const kind =
      outcome.status === "http_error" && outcome.httpStatus !== null ? classifyWecomHttpStatus(outcome.httpStatus) : "retryable";
    return {
      ok: false,
      kind,
      errcode: null,
      errmsg: outcome.errmsg,
      httpStatus: outcome.httpStatus,
      retryAt: null,
      retriedToken,
      attempts,
    };
  }

  private tokenFailure(error: unknown, retriedToken: boolean, attempts: number): WecomSendResult {
    if (error instanceof WecomTokenError) {
      return {
        ok: false,
        kind: error.kind,
        errcode: error.errcode,
        errmsg: error.message,
        httpStatus: null,
        retryAt: null,
        retriedToken,
        attempts,
      };
    }
    return {
      ok: false,
      kind: "retryable",
      errcode: null,
      errmsg: describeNetworkError(error),
      httpStatus: null,
      retryAt: null,
      retriedToken,
      attempts,
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

export interface WecomRuntimeOverrides {
  fetcher?: typeof fetch;
  now?: () => number;
  store?: RateWindowStore;
  token?: WecomTokenManager;
  limiter?: WecomRateLimiter;
}

export interface WecomRuntime {
  client: WecomClient;
  token: WecomTokenManager;
  limiter: WecomRateLimiter;
}

/** 环境装配（读 WECOM_* env；单测 / stub 回放用 overrides 注入 fetcher / 内存计数 / 时钟）。 */
export function createWecomClientFromEnv(env: Env, overrides: WecomRuntimeOverrides = {}): WecomRuntime {
  const fetcher = overrides.fetcher ?? fetch;
  const now = overrides.now ?? Date.now;
  const token =
    overrides.token ??
    new WecomTokenManager({
      safetyMs: env.WECOM_TOKEN_SAFETY_MS,
      now,
      fetchToken: async (): Promise<WecomTokenInfo> => {
        const url =
          env.WECOM_BASE_URL +
          "/cgi-bin/gettoken?corpid=" +
          encodeURIComponent(env.WECOM_CORP_ID) +
          "&corpsecret=" +
          encodeURIComponent(env.WECOM_APP_SECRET);
        const outcome = await requestJson(fetcher, url, { method: "GET" }, env.WECOM_TIMEOUT_MS);
        if (outcome.status === "ok") {
          const info = readTokenInfo(outcome.raw);
          if (info !== null) {
            return info;
          }
          throw new WecomTokenError("gettoken 响应缺 access_token / expires_in", "retryable");
        }
        if (outcome.status === "errcode" && outcome.errcode !== null) {
          const classified = classifyWecomErrcode("wecom_app", outcome.errcode);
          throw new WecomTokenError(
            "gettoken 失败：" + (outcome.errmsg ?? "errcode " + String(outcome.errcode)),
            classified === "token_invalid" ? "retryable" : classified,
            outcome.errcode,
          );
        }
        const kind =
          outcome.status === "http_error" && outcome.httpStatus !== null ? classifyWecomHttpStatus(outcome.httpStatus) : "retryable";
        throw new WecomTokenError("gettoken " + (outcome.errmsg ?? "失败"), kind);
      },
    });
  const limiter =
    overrides.limiter ??
    new WecomRateLimiter({
      store: overrides.store ?? new InMemoryRateWindowStore(),
      windowMs: env.WECOM_RATE_WINDOW_MS,
      limits: { app: env.WECOM_RATE_LIMIT_APP, group: env.WECOM_RATE_LIMIT_GROUP },
      now,
    });
  const client = new WecomClient({
    baseUrl: env.WECOM_BASE_URL,
    timeoutMs: env.WECOM_TIMEOUT_MS,
    agentId: env.WECOM_AGENT_ID,
    fetcher,
    token,
    limiter,
    now,
  });
  return { client, token, limiter };
}
