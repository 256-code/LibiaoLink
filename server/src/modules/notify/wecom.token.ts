/**
 * 企微 access_token 单飞缓存（M5-03-1 · S8-1：「token 单飞缓存（提前刷新 / 失效重取一次）」）。
 *
 * 行为口径：
 *   ① 提前刷新：命中缓存的判定 = `now + safetyMs < expiresAt`（余量默认 WECOM_TOKEN_SAFETY_MS）；
 *   ② 单飞：并发取 token 共享同一次刷新（同一时刻最多一个 gettoken 在途）；
 *   ③ 失效重取一次：`invalidate()` 丢弃缓存并开启新代际（在途旧刷新结果不得回填 —— 代际保护），
 *      `refreshAfterInvalid()` = invalidate + getToken，客户端在 token_invalid 分类上调用后重发一次；
 *   ④ 刷新失败不缓存：下次调用重新尝试（失败分类由 fetchToken 抛 WecomTokenError 承载）。
 *
 * 边界：进程内缓存（worker 单进程 = 单缓存；多令牌面并发由单飞兜底）；token 明文不进日志（本文件不打日志）。
 */
import type { WecomFailureKind } from "./wecom.errors.js";

export interface WecomTokenInfo {
  token: string;
  /** 服务端返回的有效期（秒）。 */
  expiresInSeconds: number;
}

/** 取 token 失败（kind 复用失败分类；errcode = gettoken 响应的业务错误码，网络 / 解析层失败为 null）。 */
export class WecomTokenError extends Error {
  constructor(
    message: string,
    readonly kind: WecomFailureKind,
    readonly errcode: number | null = null,
  ) {
    super(message);
    this.name = "WecomTokenError";
  }
}

export interface WecomTokenManagerOptions {
  /** 取 token 实现（HTTP 细节在客户端工厂装配；失败抛 WecomTokenError 或任意 Error）。 */
  fetchToken: () => Promise<WecomTokenInfo>;
  /** 提前刷新余量（毫秒）：过期前多久重新获取。 */
  safetyMs: number;
  now?: () => number;
}

export class WecomTokenManager {
  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;
  private generation = 0;

  constructor(private readonly options: WecomTokenManagerOptions) {}

  /** 取有效 token：命中缓存直接返回；否则单飞刷新（并发调用共享同一次刷新）。 */
  getToken(): Promise<string> {
    const nowMs = this.now();
    if (this.cached !== null && nowMs + this.options.safetyMs < this.cached.expiresAt) {
      return Promise.resolve(this.cached.token);
    }
    if (this.inflight !== null) {
      return this.inflight;
    }
    const generation = this.generation;
    const refresh = this.options.fetchToken().then(
      (info) => {
        if (generation === this.generation) {
          this.cached = { token: info.token, expiresAt: this.now() + info.expiresInSeconds * 1000 };
          this.inflight = null;
        }
        return info.token;
      },
      (error: unknown) => {
        if (generation === this.generation) {
          this.inflight = null;
        }
        throw error;
      },
    );
    this.inflight = refresh;
    return refresh;
  }

  /** 丢弃缓存（token 判定失效时调用）：下次 getToken 强制重取；在途刷新按代际作废。 */
  invalidate(): void {
    this.generation += 1;
    this.cached = null;
    this.inflight = null;
  }

  /** 失效重取一次（客户端 token_invalid 路径）：invalidate + getToken。 */
  refreshAfterInvalid(): Promise<string> {
    this.invalidate();
    return this.getToken();
  }

  /** 观测快照（测试 / 回放）：只暴露缓存状态，不含 token 明文。 */
  snapshot(): { cached: boolean; expiresAt: number | null; inflight: boolean } {
    return {
      cached: this.cached !== null,
      expiresAt: this.cached === null ? null : this.cached.expiresAt,
      inflight: this.inflight !== null,
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
