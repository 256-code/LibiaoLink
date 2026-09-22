/**
 * 库侧枚举字面量 ↔ 契约枚举一致性（M4-05 · 数据层守卫）。
 * check:db-schema 只比对 CHECK 约束「名字」，不比取值 —— 枚举扩值时最容易漏的就是「契约加了、库侧 literals 没加」
 * （或反向），而这类漂移只在写库时才炸。本测试对三类值集逐值比对（顺序也一致，便于人工核对）。
 * 不连库：纯常量比对。
 */
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, PREVIEW_STATUSES, PREVIEW_TARGETS } from "@libiaolink/contracts";
import {
  AUDIT_ACTION_KEYS,
  PREVIEW_STATUS_KEYS,
  PREVIEW_TARGET_KEYS,
} from "../src/db/schema/literals.js";

describe("库侧枚举字面量与契约一致（schema literals ↔ contracts）", () => {
  it("审计动作：AUDIT_ACTION_KEYS = AUDIT_ACTIONS（含 M4-05 的 preview）", () => {
    expect([...AUDIT_ACTION_KEYS]).toEqual([...AUDIT_ACTIONS]);
  });

  it("预览渲染通道：PREVIEW_TARGET_KEYS = PREVIEW_TARGETS", () => {
    expect([...PREVIEW_TARGET_KEYS]).toEqual([...PREVIEW_TARGETS]);
  });

  it("预览产物状态：PREVIEW_STATUS_KEYS = PREVIEW_STATUSES", () => {
    expect([...PREVIEW_STATUS_KEYS]).toEqual([...PREVIEW_STATUSES]);
  });
});
