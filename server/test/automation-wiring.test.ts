/**
 * S7-4 规则接线门禁（不连库）：事件消费（命中产出 / 冷启动保护 / 渠道护栏 / 无规则订阅 / 主体不可解析）+
 * 调度产出（窗口命中 / 事务内落库 / 重放幂等键稳定 / 群收件人缺失 / 空主体）+ 载荷字段口径。
 * 真机链路（事件 → notify.message → 站内信行）见 server/scripts/s7-4-automation-wiring-replay.mjs。
 */
import { describe, expect, it } from "vitest";
import type { AutomationRule, OutboxTopic } from "@libiaolink/contracts";
import type { Env } from "../src/config/env.js";
import type { DbClient } from "../src/db/db-client.js";
import type { JobRow } from "../src/db/jobs.store.js";
import type { OutboxClaimedRow } from "../src/db/outbox.store.js";
import type { OutboxEventInput } from "../src/db/outbox.js";
import {
  AUTOMATION_SCHEDULE_JOB_KIND,
  BUILTIN_RULES,
  toIssueSubject,
  toTaskSubject,
  toReportMemberSubject,
  type ReplaySubject,
  type ReplayTask,
} from "../src/modules/automation/index.js";
import { atShanghaiTime, calendarWindow } from "../src/modules/calendar/index.js";
import type { JobRunContext } from "../src/outbox/scheduler.js";
import {
  createAutomationScheduleHandler,
  createRuleEventConsumers,
  type AutomationSubjectPort,
  type AutomationWiringDeps,
} from "../src/outbox/automation-wiring.js";

/** 固定时钟：上海 2026-09-24 09:30（A03 T+1 触发时刻 = 09-24 09:00，已过）。 */
const NOW = new Date(atShanghaiTime("2026-09-24", "09:30"));
const CALENDAR = calendarWindow("2026-09-01", "2026-09-30", []);
const DB = { marker: "db" } as unknown as DbClient;
const TX = { marker: "tx" } as unknown as JobRunContext["tx"];

function task(overrides: Partial<ReplayTask> = {}): ReplayTask {
  return {
    id: "t-1",
    title: "安装摄像头",
    version: 5,
    displayStatus: "active",
    urgency: "高",
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    ownerId: "u-1",
    ownerName: "张三",
    managerId: "u-9",
    managerName: "李四",
    projectId: "p-1",
    projectProgress: 50,
    projectGroupId: null,
    deliverableTypes: ["施工方案"],
    fileCount: 0,
    ...overrides,
  };
}

/** 主体端口替身：按主题给事件主体 / 按窗口给主体池，并记录调用（无规则订阅时不得读主体）。 */
class FakeSubjectPort implements AutomationSubjectPort {
  eventSubjects = new Map<string, ReplaySubject | null>();
  windowSubjects: ReplaySubject[] = [];
  readonly eventCalls: string[] = [];
  windowCalls = 0;

  async eventSubject(topic: string, _payload: Record<string, unknown>): Promise<ReplaySubject | null> {
    this.eventCalls.push(topic);
    return this.eventSubjects.get(topic) ?? null;
  }

  async loadWindow(): Promise<{ subjects: ReplaySubject[]; calendar: typeof CALENDAR }> {
    this.windowCalls += 1;
    return { subjects: this.windowSubjects, calendar: CALENDAR };
  }
}

interface Harness {
  deps: AutomationWiringDeps;
  subjects: FakeSubjectPort;
  appended: { client: DbClient; event: OutboxEventInput }[];
  logs: { log: string[]; warn: string[]; error: string[] };
}

function makeHarness(overrides: Partial<AutomationWiringDeps> = {}): Harness {
  const subjects = new FakeSubjectPort();
  const appended: Harness["appended"] = [];
  const logs: Harness["logs"] = { log: [], warn: [], error: [] };
  const deps: AutomationWiringDeps = {
    env: { AUTOMATION_EVENT_MAX_AGE_MS: 6 * 3_600_000 } as unknown as Env,
    subjects,
    append: async (client, event) => {
      appended.push({ client, event });
    },
    db: DB,
    rules: async () => [...BUILTIN_RULES],
    now: () => NOW,
    shift: async () => ({ reminderShiftEnabled: false, shiftDirection: "forward" }),
    logger: {
      log: (message) => logs.log.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
    },
    ...overrides,
  };
  return { deps, subjects, appended, logs };
}

function row(topic: OutboxTopic, payload: Record<string, unknown>, overrides: Partial<OutboxClaimedRow> = {}): OutboxClaimedRow {
  return {
    id: 7,
    topic,
    payload,
    dedupeKey: topic + ":" + String(payload.taskId ?? payload.issueId ?? "-"),
    attempts: 0,
    availableAt: NOW,
    lockedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function jobContext(from: Date, to: Date): JobRunContext {
  const job: JobRow = {
    id: 3,
    kind: AUTOMATION_SCHEDULE_JOB_KIND,
    payload: {},
    cron: "0 9 * * *",
    runAt: to,
    lastRunAt: from,
    status: "processing",
    attempts: 0,
    lastError: null,
    lockedBy: "test",
    lockedAt: NOW,
  };
  return { job, windowFrom: from, windowTo: to, fireTimes: [], tx: TX };
}
describe("规则事件消费（S7-4 接线 · evaluateEventMessages → notify.message）", () => {
  it("R02 命中：产出 notify.message（载荷字段与幂等键 = 规则 + 实体 + 版本窗口）", async () => {
    const h = makeHarness();
    h.subjects.eventSubjects.set("task.completed", toTaskSubject(task({ displayStatus: "done" })));

    const outcome = await createRuleEventConsumers(h.deps).get("task.completed")?.handle(row("task.completed", { taskId: "t-1" }));

    expect(outcome).toEqual({ outcome: "done" });
    expect(h.appended).toHaveLength(1);
    const event = h.appended[0];
    expect(event?.client).toBe(DB);
    expect(event?.event.topic).toBe("notify.message");
    expect(event?.event.dedupeKey).toBe("R02:t-1:v5");
    const payload = event?.event.payload as Record<string, unknown>;
    expect(payload.recipientId).toBe("u-1");
    expect(payload.type).toBe("reminder");
    expect(payload.channel).toBe("inbox");
    expect(payload.refType).toBe("task");
    expect(payload.refId).toBe("t-1");
    expect(payload.templateCode).toBe("R02_INBOX");
    expect(payload.mergeKey).toBe("R02:t-1:v5");
    expect(String(payload.body)).toContain("安装摄像头");
    // 同规则第二条动作（wecom_app）不产行：渠道护栏 warn 留痕（与投递层「非 inbox → dead」配对）。
    expect(h.logs.warn.some((line) => line.includes("wecom_app"))).toBe(true);
  });

  it("冷启动保护：事件行创建时刻过旧 → 零产出且按 event_too_old 留痕", async () => {
    const h = makeHarness();
    h.subjects.eventSubjects.set("task.completed", toTaskSubject(task({ displayStatus: "done" })));

    const outcome = await createRuleEventConsumers(h.deps)
      .get("task.completed")
      ?.handle(row("task.completed", { taskId: "t-1" }, { createdAt: new Date(NOW.getTime() - 7 * 3_600_000) }));

    expect(outcome).toEqual({ outcome: "done" });
    expect(h.appended).toHaveLength(0);
    expect(h.logs.log.some((line) => line.includes("event_too_old"))).toBe(true);
  });

  it("条件不命中（缺件条件不满足）：消费完成、零产出", async () => {
    const h = makeHarness();
    h.subjects.eventSubjects.set("task.completed", toTaskSubject(task({ displayStatus: "done", fileCount: 2 })));

    const outcome = await createRuleEventConsumers(h.deps).get("task.completed")?.handle(row("task.completed", { taskId: "t-1" }));

    expect(outcome).toEqual({ outcome: "done" });
    expect(h.appended).toHaveLength(0);
  });

  it("无事件型规则订阅的主题：不读主体、直接消费完成", async () => {
    const h = makeHarness();

    const outcome = await createRuleEventConsumers(h.deps).get("change.applied")?.handle(row("change.applied", { projectId: "p-1" }));

    expect(outcome).toEqual({ outcome: "done" });
    expect(h.subjects.eventCalls).toHaveLength(0);
    expect(h.appended).toHaveLength(0);
  });

  it("主体不可解析（载荷缺实体 / 行不存在）：确定性失败 → dead", async () => {
    const h = makeHarness();
    h.subjects.eventSubjects.set("task.completed", null);

    const outcome = await createRuleEventConsumers(h.deps).get("task.completed")?.handle(row("task.completed", { taskId: "t-1" }));

    expect(outcome?.outcome).toBe("dead");
    expect(h.appended).toHaveLength(0);
  });
});

describe("调度生产者（automation-schedule.job → notify.message）", () => {
  const FROM = new Date(atShanghaiTime("2026-09-23", "09:00"));
  const TO = new Date(atShanghaiTime("2026-09-24", "09:15"));

  it("A03 T+1 命中：产出 notify.message 且落在 JobRunContext.tx", async () => {
    const rules = BUILTIN_RULES.filter((rule) => rule.code === "A03" && rule.name.includes("T+1"));
    const h = makeHarness({ rules: async () => [...rules] });
    h.subjects.windowSubjects = [
      toIssueSubject({
        issueId: "i-1",
        title: "现场漏水",
        state: "open",
        dueAt: "2026-09-23",
        ownerId: "u-1",
        ownerName: "张三",
        managerId: "u-9",
        managerName: "李四",
      }),
    ];

    const result = await createAutomationScheduleHandler(h.deps).run(jobContext(FROM, TO));

    expect(result?.produced).toBe(1);
    expect(h.appended).toHaveLength(1);
    expect(h.appended[0]?.client).toBe(TX);
    expect(h.appended[0]?.event.dedupeKey).toBe("A03:i-1:2026-09-24");
    const payload = h.appended[0]?.event.payload as Record<string, unknown>;
    expect(payload.refType).toBe("issue");
    expect(payload.refId).toBe("i-1");
    expect(payload.templateCode).toBe("A03_T1_INBOX");
    expect(payload.recipientId).toBe("u-1");
    expect(String(payload.body)).toContain("现场漏水");
  });

  it("同窗口重放：幂等键稳定（outbox 唯一约束兜底不重发）", async () => {
    const rules = BUILTIN_RULES.filter((rule) => rule.code === "A03" && rule.name.includes("T+1"));
    const h = makeHarness({ rules: async () => [...rules] });
    h.subjects.windowSubjects = [
      toIssueSubject({
        issueId: "i-1",
        title: "现场漏水",
        state: "open",
        dueAt: "2026-09-23",
        ownerId: "u-1",
        ownerName: "张三",
        managerId: "u-9",
        managerName: "李四",
      }),
    ];
    const handler = createAutomationScheduleHandler(h.deps);

    await handler.run(jobContext(FROM, TO));
    await handler.run(jobContext(FROM, TO));

    expect(h.appended).toHaveLength(2);
    expect(h.appended[0]?.event.dedupeKey).toBe(h.appended[1]?.event.dedupeKey);
  });

  it("A01 站内信合并：同一人多项目合并一条（收件人粒度幂等键 + 项目清单）", async () => {
    const rules = BUILTIN_RULES.filter((rule) => rule.code === "A01");
    const late = new Date(atShanghaiTime("2026-09-24", "19:45"));
    const h = makeHarness({ rules: async () => [...rules], now: () => late });
    h.subjects.windowSubjects = [
      toReportMemberSubject({ date: "2026-09-24", isWorkday: true, submitted: false, userId: "u-1", userName: "张三", projectId: "p-1", projectName: "临港数据中心" }),
      toReportMemberSubject({ date: "2026-09-24", isWorkday: true, submitted: false, userId: "u-1", userName: "张三", projectId: "p-2", projectName: "张江机房" }),
    ];

    const result = await createAutomationScheduleHandler(h.deps).run(
      jobContext(new Date(atShanghaiTime("2026-09-24", "19:00")), new Date(atShanghaiTime("2026-09-24", "19:40"))),
    );

    expect(result?.produced).toBe(1);
    expect(h.appended).toHaveLength(1);
    expect(h.appended[0]?.event.dedupeKey).toBe("A01:u-1:2026-09-24");
    const payload = h.appended[0]?.event.payload as Record<string, unknown>;
    expect(payload.templateCode).toBe("A01_INBOX_MERGED");
    expect(payload.refType).toBeNull();
    expect(payload.refId).toBeNull();
    expect(String(payload.body)).toContain("临港数据中心、张江机房");
    expect(h.logs.warn.some((line) => line.includes("wecom_app"))).toBe(true);
  });

  it("群收件人缺失（project.group 无绑定列）：零产出 + recipient_missing 留痕", async () => {
    const rules = BUILTIN_RULES.filter((rule) => rule.code === "R03");
    const h = makeHarness({ rules: async () => [...rules] });
    h.subjects.windowSubjects = [toTaskSubject(task({ plannedEnd: "2026-09-25" }))];

    const result = await createAutomationScheduleHandler(h.deps).run(jobContext(FROM, TO));

    expect(result?.produced).toBe(0);
    expect(h.appended).toHaveLength(0);
    expect(h.logs.log.some((line) => line.includes("recipient_missing"))).toBe(true);
  });

  it("空主体池：零产出 + note 留痕", async () => {
    const h = makeHarness({ rules: async () => BUILTIN_RULES.filter((rule) => rule.trigger.kind === "schedule") });

    const result = await createAutomationScheduleHandler(h.deps).run(jobContext(FROM, TO));

    expect(result?.produced).toBe(0);
    expect(String(result?.note)).toContain("主体 0");
  });

  it("无启用中的调度型规则：零产出 + note 留痕", async () => {
    const h = makeHarness({ rules: async () => [] });

    const result = await createAutomationScheduleHandler(h.deps).run(jobContext(FROM, TO));

    expect(result?.produced).toBe(0);
    expect(String(result?.note)).toContain("无启用中的调度型规则");
  });
});