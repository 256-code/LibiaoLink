/**
 * A02 项目日报聚合门禁（不连库）：summarizeProjectDay 纯函数 —— 计数口径（headcount 求和 / 现场发现问题非空计数）
 * 与 summaryText 逐字拼装（「作者名：当日完成工作」换行拼接）。SQL 读取层由接线门禁（automation-wiring.test）
 * 与 M5-03-2 群接线回放共同取证。
 */
import { describe, expect, it } from "vitest";
import { summarizeProjectDay, type ReportDayRow } from "../src/outbox/automation-subjects.js";

function reportRow(overrides: Partial<ReportDayRow> = {}): ReportDayRow {
  return {
    projectId: "p-1",
    authorId: "u-1",
    reportDate: "2026-09-24",
    state: "submitted",
    headcount: 4,
    doneWork: "安装摄像头 3 台",
    foundIssue: null,
    submittedAt: new Date("2026-09-24T10:00:00Z"),
    createdAt: new Date("2026-09-24T09:00:00Z"),
    ...overrides,
  };
}

describe("A02 项目日报聚合（summarizeProjectDay）", () => {
  it("计数与逐字拼装：headcount 求和 / 问题非空计数 / 逐条「作者：当日完成工作」换行拼接", () => {
    const names: Record<string, string> = { "u-1": "张三", "u-2": "李四", "u-3": "王五" };
    const result = summarizeProjectDay(
      [
        reportRow({ authorId: "u-1", headcount: 4, doneWork: "安装摄像头 3 台" }),
        reportRow({ authorId: "u-2", headcount: null, doneWork: "现场勘查完毕", foundIssue: "缺接地线" }),
        reportRow({ authorId: "u-3", headcount: 2, doneWork: "整理验收资料", foundIssue: "  " }),
      ],
      (userId) => names[userId] ?? "",
    );
    expect(result.entryCount).toBe(3);
    expect(result.headcountTotal).toBe(6);
    // 空白串不算问题（与 A3-09 生成口径同源）；headcount null 按 0 计（与 reports/summary 同口径）。
    expect(result.issueCount).toBe(1);
    expect(result.summaryText).toBe("张三：安装摄像头 3 台\n李四：现场勘查完毕\n王五：整理验收资料");
  });

  it("空列表：全零 + 空正文（entry_count = 0 → 引擎按 not_matched 不播报）", () => {
    expect(summarizeProjectDay([], () => "")).toEqual({ entryCount: 0, headcountTotal: 0, issueCount: 0, summaryText: "" });
  });
});