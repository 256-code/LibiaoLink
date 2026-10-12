/**
 * 企微客户端内核回归（M5-03-1 · S8-1；M5-03-2 收窄为自建应用单面）：app 发送（token / 重发一次）/
 * 分类透传 / 限速短路 / 传输层兜底。fetcher 全替身，不触外网（群通道见 wecom-aibot.test.ts）。
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryRateWindowStore, WecomRateLimiter } from "../src/modules/notify/wecom.rate.js";
import { WecomTokenManager, type WecomTokenInfo } from "../src/modules/notify/wecom.token.js";
import { WecomClient } from "../src/modules/notify/wecom.client.js";

type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeClient(
  overrides: {
    appLimit?: number;
    now?: () => number;
    fetchTokenImpl?: () => Promise<WecomTokenInfo>;
  } = {},
) {
  const fetcher = vi.fn<Fetcher>();
  let tokenFetched = 0;
  const token = new WecomTokenManager({
    safetyMs: 300_000,
    now: overrides.now,
    fetchToken: () => {
      tokenFetched += 1;
      return (overrides.fetchTokenImpl ?? (async () => ({ token: "tok-1", expiresInSeconds: 7200 })))();
    },
  });
  const limiter = new WecomRateLimiter({
    store: new InMemoryRateWindowStore(),
    windows: [{ kind: "app", windowMs: 60_000, limit: overrides.appLimit ?? 0 }],
    now: overrides.now,
  });
  const client = new WecomClient({
    baseUrl: "https://qyapi.example.test",
    timeoutMs: 1_000,
    agentId: 1000002,
    fetcher: fetcher as unknown as typeof fetch,
    token,
    limiter,
    now: overrides.now,
  });
  return { client, fetcher, tokenFetchCount: () => tokenFetched };
}

describe("企微客户端内核（M5-03-1 · S8-1）", () => {
  it("app 成功：token 进 query、包体形状正确、ok = true", async () => {
    const { client, fetcher } = makeClient();
    fetcher.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: "ok" }));

    const result = await client.sendAppText({ toUser: ["u1", "u2"], content: "你好" });

    expect(result).toEqual({ ok: true, retriedToken: false, attempts: 1 });
    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    const url = String(call![0]);
    expect(url).toContain("/cgi-bin/message/send?access_token=tok-1");
    expect(JSON.parse(String(call![1]?.body))).toEqual({
      touser: "u1|u2",
      msgtype: "text",
      agentid: 1000002,
      text: { content: "你好" },
    });
  });

  it("token_invalid：失效重取一次并重发一次（恰一次）", async () => {
    let issued = 0;
    const { client, fetcher, tokenFetchCount } = makeClient({
      fetchTokenImpl: async () => ({ token: "tok-" + String(++issued), expiresInSeconds: 7200 }),
    });
    fetcher.mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: "access_token expired" }));
    fetcher.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: "ok" }));

    const result = await client.sendAppText({ toUser: ["u1"], content: "重发" });

    expect(result).toEqual({ ok: true, retriedToken: true, attempts: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(tokenFetchCount()).toBe(2);
    expect(String(fetcher.mock.calls[1]![0])).toContain("access_token=tok-2");
  });

  it("token_invalid 连续两次：按原样返回 token_invalid（不再重发）", async () => {
    let issued = 0;
    const { client, fetcher, tokenFetchCount } = makeClient({
      fetchTokenImpl: async () => ({ token: "tok-" + String(++issued), expiresInSeconds: 7200 }),
    });
    fetcher.mockImplementation(async () => jsonResponse({ errcode: 40014, errmsg: "invalid access_token" }));

    const result = await client.sendAppText({ toUser: ["u1"], content: "再失败" });

    expect(result).toMatchObject({ ok: false, kind: "token_invalid", errcode: 40014, retriedToken: true, attempts: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(tokenFetchCount()).toBe(2);
  });

  it("业务错误透传分类：45009 → rate_limited；40001 → permanent；60011 → permanent", async () => {
    const cases: Array<[number, string]> = [
      [45009, "rate_limited"],
      [40001, "permanent"],
      [60011, "permanent"],
    ];
    for (const [errcode, kind] of cases) {
      const { client, fetcher } = makeClient();
      fetcher.mockResolvedValueOnce(jsonResponse({ errcode, errmsg: "err " + String(errcode) }));
      const result = await client.sendAppText({ toUser: ["u1"], content: "x" });
      expect(result).toMatchObject({ ok: false, kind, errcode, retriedToken: false, attempts: 1 });
      if (!result.ok) {
        expect(result.retryAt).toBeNull();
      }
    }
  });

  it("传输层兜底：5xx / 非 JSON → retryable；含 httpStatus", async () => {
    const { client, fetcher } = makeClient();
    fetcher.mockResolvedValueOnce(jsonResponse({}, 500));
    const five = await client.sendAppText({ toUser: ["u1"], content: "x" });
    expect(five).toMatchObject({ ok: false, kind: "retryable", httpStatus: 500, attempts: 1 });

    fetcher.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    const html = await client.sendAppText({ toUser: ["u1"], content: "x" });
    expect(html).toMatchObject({ ok: false, kind: "retryable", httpStatus: 502 });
  });

  it("网络 / 超时异常 → retryable（错误文本过掩码）", async () => {
    const { client, fetcher } = makeClient();
    fetcher.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    const result = await client.sendAppText({ toUser: ["u1"], content: "x" });

    expect(result).toMatchObject({ ok: false, kind: "retryable", httpStatus: null, errcode: null });
  });

  it("限速短路：本地桶满不发 HTTP，retryAt = 下一窗口起点", async () => {
    const now = () => 5_000;
    const { client, fetcher } = makeClient({ appLimit: 1, now });
    fetcher.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: "ok" }));

    expect((await client.sendAppText({ toUser: ["u1"], content: "1" })).ok).toBe(true);
    const blocked = await client.sendAppText({ toUser: ["u1"], content: "2" });

    expect(blocked).toMatchObject({ ok: false, kind: "rate_limited", attempts: 0, retriedToken: false });
    if (!blocked.ok) {
      expect(blocked.retryAt?.getTime()).toBe(60_000);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

});
