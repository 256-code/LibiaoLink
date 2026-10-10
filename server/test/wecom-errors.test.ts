/**
 * 企微错误分类回归（M5-03-1 · S8-1）：errcode 表（app / group）、HTTP 状态兜底、网络错误描述掩码。
 * 口径：docs/M5-03-实施方案(企微通道).md §五；错误码集合为初始集（M5-03-4 实测锁定的回归基线）。
 */
import { describe, expect, it } from "vitest";
import {
  classifyWecomErrcode,
  classifyWecomHttpStatus,
  describeNetworkError,
} from "../src/modules/notify/wecom.errors.js";

describe("企微错误分类（M5-03-1 · S8-1）", () => {
  it("app：凭据 / 配置 / 接收人 / 内容类 → permanent", () => {
    for (const code of [40001, 40013, 40056, 41002, 41004, 60011, 45002]) {
      expect(classifyWecomErrcode("wecom_app", code)).toBe("permanent");
    }
  });

  it("app：token 失效族（41001 缺失 / 40014 非法 / 42001 过期）→ token_invalid", () => {
    for (const code of [40014, 41001, 42001]) {
      expect(classifyWecomErrcode("wecom_app", code)).toBe("token_invalid");
    }
  });

  it("app：45009 → rate_limited；-1 系统繁忙 → retryable", () => {
    expect(classifyWecomErrcode("wecom_app", 45009)).toBe("rate_limited");
    expect(classifyWecomErrcode("wecom_app", -1)).toBe("retryable");
  });

  it("group：93000 webhook 失效 → permanent；45009 / -1 同表", () => {
    expect(classifyWecomErrcode("wecom_group", 93000)).toBe("permanent");
    expect(classifyWecomErrcode("wecom_group", 45009)).toBe("rate_limited");
    expect(classifyWecomErrcode("wecom_group", -1)).toBe("retryable");
  });

  it("group：token 失效族不适用（按未收录兜底 retryable）", () => {
    expect(classifyWecomErrcode("wecom_group", 42001)).toBe("retryable");
  });

  it("未收录 errcode 一律 retryable 兜底（有界重试，不误杀）", () => {
    expect(classifyWecomErrcode("wecom_app", 123456)).toBe("retryable");
    expect(classifyWecomErrcode("wecom_group", 987654)).toBe("retryable");
  });

  it("HTTP 状态兜底：429 → rate_limited；408 / 5xx → retryable；其余 4xx → permanent", () => {
    expect(classifyWecomHttpStatus(429)).toBe("rate_limited");
    expect(classifyWecomHttpStatus(408)).toBe("retryable");
    expect(classifyWecomHttpStatus(500)).toBe("retryable");
    expect(classifyWecomHttpStatus(502)).toBe("retryable");
    expect(classifyWecomHttpStatus(401)).toBe("permanent");
    expect(classifyWecomHttpStatus(404)).toBe("permanent");
  });

  it("describeNetworkError：key / secret / access_token 一律掩码，不回显明文", () => {
    const error = new TypeError(
      "fetch failed: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdef123456&secret=s3cr3t&access_token=tok-9",
    );
    const text = describeNetworkError(error);
    expect(text).toContain("TypeError");
    expect(text).not.toContain("abcdef123456");
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("tok-9");
    expect(text).toContain("key=***");
  });

  it("describeNetworkError：非 Error 输入给占位描述", () => {
    expect(describeNetworkError("boom")).toBe("unknown error");
  });
});
