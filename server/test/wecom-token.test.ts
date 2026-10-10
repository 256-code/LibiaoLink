/**
 * 企微 token 单飞缓存回归（M5-03-1 · S8-1）：命中余量 / 提前刷新 / 单飞 / 失败不缓存 / 失效重取与代际保护。
 */
import { describe, expect, it, vi } from "vitest";
import { WecomTokenManager, type WecomTokenInfo } from "../src/modules/notify/wecom.token.js";

describe("企微 token 单飞缓存（M5-03-1 · S8-1）", () => {
  it("缓存命中：安全余量内不重复取 token", async () => {
    let now = 1_000_000;
    const fetchToken = vi.fn(async (): Promise<WecomTokenInfo> => ({ token: "t1", expiresInSeconds: 7200 }));
    const manager = new WecomTokenManager({ fetchToken, safetyMs: 300_000, now: () => now });

    expect(await manager.getToken()).toBe("t1");
    now += 7_200_000 - 300_000 - 1;
    expect(await manager.getToken()).toBe("t1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(manager.snapshot()).toEqual({ cached: true, expiresAt: 1_000_000 + 7_200_000, inflight: false });
  });

  it("提前刷新：进入安全余量即重取", async () => {
    let now = 1_000_000;
    const fetchToken = vi
      .fn<() => Promise<WecomTokenInfo>>()
      .mockResolvedValueOnce({ token: "t1", expiresInSeconds: 7200 })
      .mockResolvedValueOnce({ token: "t2", expiresInSeconds: 7200 });
    const manager = new WecomTokenManager({ fetchToken, safetyMs: 300_000, now: () => now });

    expect(await manager.getToken()).toBe("t1");
    now += 7_200_000 - 300_000;
    expect(await manager.getToken()).toBe("t2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("单飞：并发取 token 只触发一次刷新", async () => {
    let release: ((info: WecomTokenInfo) => void) | null = null;
    const gate = new Promise<WecomTokenInfo>((resolve) => {
      release = resolve;
    });
    const fetchToken = vi.fn(() => gate);
    const manager = new WecomTokenManager({ fetchToken, safetyMs: 300_000, now: () => 1_000_000 });

    const first = manager.getToken();
    const second = manager.getToken();
    expect(fetchToken).toHaveBeenCalledTimes(1);
    release!({ token: "t1", expiresInSeconds: 7200 });
    expect(await Promise.all([first, second])).toEqual(["t1", "t1"]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("刷新失败不缓存：下次调用重新尝试", async () => {
    const fetchToken = vi
      .fn<() => Promise<WecomTokenInfo>>()
      .mockRejectedValueOnce(new Error("gettoken boom"))
      .mockResolvedValueOnce({ token: "t2", expiresInSeconds: 7200 });
    const manager = new WecomTokenManager({ fetchToken, safetyMs: 300_000, now: () => 1_000_000 });

    await expect(manager.getToken()).rejects.toThrow("gettoken boom");
    expect(await manager.getToken()).toBe("t2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("失效重取一次：refreshAfterInvalid = invalidate + getToken", async () => {
    let now = 1_000_000;
    const fetchToken = vi
      .fn<() => Promise<WecomTokenInfo>>()
      .mockResolvedValueOnce({ token: "t1", expiresInSeconds: 7200 })
      .mockResolvedValueOnce({ token: "t2", expiresInSeconds: 7200 });
    const manager = new WecomTokenManager({ fetchToken, safetyMs: 300_000, now: () => now });

    expect(await manager.getToken()).toBe("t1");
    now += 1_000;
    expect(await manager.refreshAfterInvalid()).toBe("t2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
    // 重取后的缓存立即生效（无需再取）
    expect(await manager.getToken()).toBe("t2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("代际保护：失效前的在途刷新结果不得回填缓存", async () => {
    let release: ((info: WecomTokenInfo) => void) | null = null;
    const slow = new Promise<WecomTokenInfo>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const fetchToken = vi.fn<() => Promise<WecomTokenInfo>>(() => {
      call += 1;
      return call === 1 ? slow : Promise.resolve({ token: "new", expiresInSeconds: 100 });
    });
    const manager = new WecomTokenManager({ fetchToken, safetyMs: 10_000, now: () => 1_000_000 });

    const stale = manager.getToken();
    manager.invalidate();
    const fresh = manager.getToken();
    release!({ token: "stale", expiresInSeconds: 100 });

    expect(await stale).toBe("stale");
    expect(await fresh).toBe("new");
    expect(manager.snapshot()).toEqual({ cached: true, expiresAt: 1_100_000, inflight: false });
  });
});
