/**
 * M6-01 ~ M6-03 日报 / 问题回归（A3）：一人一项目一天一条（重复 409 REPORT_ALREADY_EXISTS）、草稿 / 提交 / 补填（A3-02）、
 * 未来日期 400（A3-04）、提交自动生成问题 + 回写任务进展（A3-08 / A3-09，均幂等）、问题四态允许回退且留痕（A3-10 / A3-13）、
 * 乐观锁 409、归档项目 409、跨项目 / 不存在 404、空更新 400。
 * 真机口径见 server/README.md「M6-01 ~ M6-03」与 server/src/modules/report-issue/README.md。
 */
import { describe, expect, it } from "vitest";
import type { AuditService } from "../src/modules/admin/index.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { DbClient } from "../src/db/db-client.js";
import type { IssueRepository, IssueRow } from "../src/modules/report-issue/issue.repository.js";
import { IssueService } from "../src/modules/report-issue/issue.service.js";
import type { DailyReportRow, ReportRepository } from "../src/modules/report-issue/report.repository.js";
import { ReportService } from "../src/modules/report-issue/report.service.js";
import { shanghaiToday } from "../src/modules/task/task.rules.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const OTHER_ACTOR = "66666666-6666-4666-8666-666666666666";
const TASK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPORT_1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const REPORT_2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const ISSUE_1 = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const ISSUE_2 = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";
const PAST_DATE = "2026-01-05";
const FUTURE_DATE = "2099-01-01";
const AT = new Date("2026-09-22T08:00:00Z");
const TODAY = shanghaiToday(AT);

interface OutboxRow {
  topic: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
}

interface AuditEntry {
  action: string;
  objectType: string;
  objectId: string;
  projectId: string | null;
  changes: unknown;
}

class FakeDatabase {
  outbox: OutboxRow[] = [];
  tx = {
    insert: () => ({
      values: (value: OutboxRow) => {
        this.outbox.push(value);
        return Promise.resolve();
      },
    }),
  } as unknown as DbClient;
  readonly db = {
    transaction: (callback: (tx: DbClient) => Promise<unknown>) => callback(this.tx),
    insert: this.tx.insert,
  } as unknown as DatabaseService["db"];
}

class FakeAuditService {
  entries: AuditEntry[] = [];
  record = async (_client: DbClient, input: AuditEntry): Promise<void> => {
    this.entries.push(input);
  };
}

function makeReport(id: string, overrides: Partial<DailyReportRow> = {}): DailyReportRow {
  return {
    id,
    projectId: PROJECT,
    authorId: ACTOR,
    authorName: "填报人",
    reportDate: PAST_DATE,
    state: "submitted",
    headcount: 3,
    doneWork: "完成设备安装",
    plan: null,
    foundIssue: null,
    issueCategory: null,
    suggestion: null,
    taskIds: [],
    submittedAt: AT,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    ...overrides,
  };
}

function makeIssue(id: string, overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id,
    projectId: PROJECT,
    taskId: null,
    sourceReportId: null,
    title: "现场发现问题",
    category: "机械部",
    state: "unassigned",
    reporterId: ACTOR,
    reporterName: "填报人",
    ownerDepartment: "机械部",
    ownerId: null,
    ownerName: null,
    dueAt: null,
    raisedAt: PAST_DATE,
    solution: null,
    closedBy: null,
    closedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    ...overrides,
  };
}
/** 日报仓储替身：镜像真仓储的读面过滤（项目 + 筛选）、唯一键判重、乐观锁与 A3-08 回写幂等（标记判重）。 */
class FakeReportRepository {
  project: { id: string; status: string } | null = { id: PROJECT, status: "active" };
  reports = new Map<string, DailyReportRow>();
  tasks = new Map<string, string>([
    [TASK_A, "安装设备"],
    [TASK_B, "调试产线"],
  ]);
  taskNotes = new Map<string, string>();
  taskEvents: { taskId: string; eventType: string; afterValue: string | null }[] = [];
  inserted: DailyReportRow[] = [];
  nextReportId = REPORT_2;

  async list(
    projectId: string,
    filter: { dateFrom: string | null; dateTo: string | null; states: string[] | null; authorId: string | null },
  ): Promise<{ rows: DailyReportRow[]; total: number }> {
    const rows = [...this.reports.values()]
      .filter((row) => row.projectId === projectId)
      .filter((row) => filter.dateFrom === null || row.reportDate >= filter.dateFrom)
      .filter((row) => filter.dateTo === null || row.reportDate <= filter.dateTo)
      .filter((row) => filter.states === null || filter.states.includes(row.state))
      .filter((row) => filter.authorId === null || row.authorId === filter.authorId)
      .sort((left, right) => (left.reportDate < right.reportDate ? 1 : -1));
    return { rows, total: rows.length };
  }

  async findById(projectId: string, reportId: string): Promise<DailyReportRow | null> {
    const row = this.reports.get(reportId);
    return row !== undefined && row.projectId === projectId ? row : null;
  }

  async findByAuthorDate(projectId: string, authorId: string, reportDate: string): Promise<DailyReportRow | null> {
    return (
      [...this.reports.values()].find(
        (row) => row.projectId === projectId && row.authorId === authorId && row.reportDate === reportDate,
      ) ?? null
    );
  }

  async insert(input: Omit<DailyReportRow, "id" | "authorName" | "version" | "createdAt" | "updatedAt">, at: Date): Promise<DailyReportRow> {
    const row = makeReport(this.nextReportId, { ...input, version: 1, createdAt: at, updatedAt: at });
    this.inserted.push(row);
    this.reports.set(row.id, row);
    return row;
  }

  async updateWithVersion(
    reportId: string,
    expectedVersion: number,
    patch: Partial<DailyReportRow>,
    at: Date,
  ): Promise<boolean> {
    const row = this.reports.get(reportId);
    if (row === undefined || row.version !== expectedVersion) return false;
    this.reports.set(reportId, { ...row, ...patch, version: row.version + 1, updatedAt: at });
    return true;
  }

  async taskTitles(_projectId: string, taskIds: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const taskId of taskIds) {
      const title = this.tasks.get(taskId);
      if (title !== undefined) result.set(taskId, title);
    }
    return result;
  }

  async findProject(projectId: string): Promise<{ id: string; status: string } | null> {
    return this.project !== null && this.project.id === projectId ? this.project : null;
  }

  /** A3-08 回写替身：与真仓储同形 —— 标记判重（同任务同日期只追加一次），返回是否真的追加。 */
  async appendTaskProgress(_projectId: string, taskId: string, reportDate: string, text: string): Promise<boolean> {
    if (!this.tasks.has(taskId)) return false;
    const before = this.taskNotes.get(taskId) ?? "";
    const marker = "【日报 " + reportDate + "】";
    if (before.includes(marker)) return false;
    const after = (before.length === 0 ? "" : before + String.fromCharCode(10)) + marker + text;
    this.taskNotes.set(taskId, after);
    this.taskEvents.push({ taskId, eventType: "note_change", afterValue: after });
    return true;
  }
}

/** 问题仓储替身：镜像 source_report_id 唯一（幂等）、乐观锁与事件表。 */
class FakeIssueRepository {
  project: { id: string; status: string } | null = { id: PROJECT, status: "active" };
  issues = new Map<string, IssueRow>();
  events: { id: string; issueId: string; eventType: string; fromState: string | null; toState: string | null; actorId: string; actorName: string | null; note: string | null; createdAt: Date }[] = [];
  nextIssueId = ISSUE_1;

  async list(projectId: string): Promise<{ rows: IssueRow[]; total: number }> {
    const rows = [...this.issues.values()].filter((row) => row.projectId === projectId);
    return { rows, total: rows.length };
  }

  async findById(projectId: string, issueId: string): Promise<IssueRow | null> {
    const row = this.issues.get(issueId);
    return row !== undefined && row.projectId === projectId ? row : null;
  }

  async insert(input: Omit<IssueRow, "id" | "reporterName" | "ownerName" | "version" | "createdAt" | "updatedAt">, at: Date): Promise<IssueRow | null> {
    if (input.sourceReportId !== null) {
      const conflict = [...this.issues.values()].some((row) => row.sourceReportId === input.sourceReportId);
      if (conflict) return null;
    }
    const row = makeIssue(this.nextIssueId, { ...input, version: 1, createdAt: at, updatedAt: at });
    this.issues.set(row.id, row);
    return row;
  }

  async updateWithVersion(
    issueId: string,
    expectedVersion: number,
    patch: Partial<IssueRow>,
    at: Date,
  ): Promise<boolean> {
    const row = this.issues.get(issueId);
    if (row === undefined || row.version !== expectedVersion) return false;
    this.issues.set(issueId, { ...row, ...patch, version: row.version + 1, updatedAt: at });
    return true;
  }

  async listEvents(issueId: string) {
    return this.events.filter((event) => event.issueId === issueId);
  }

  async insertEvent(
    input: { issueId: string; eventType: string; fromState: string | null; toState: string | null; note: string | null },
    actorId: string,
    at: Date,
  ): Promise<void> {
    this.events.push({
      id: "event-" + String(this.events.length + 1),
      issueId: input.issueId,
      eventType: input.eventType,
      fromState: input.fromState,
      toState: input.toState,
      actorId,
      actorName: null,
      note: input.note,
      createdAt: at,
    });
  }

  async findProject(projectId: string): Promise<{ id: string; status: string } | null> {
    return this.project !== null && this.project.id === projectId ? this.project : null;
  }
}

function makeReportService(
  db: FakeDatabase,
  reports: FakeReportRepository,
  issues: FakeIssueRepository,
  audit: FakeAuditService,
): ReportService {
  return new ReportService(
    db as unknown as DatabaseService,
    reports as unknown as ReportRepository,
    issues as unknown as IssueRepository,
    audit as unknown as AuditService,
  );
}

function makeIssueService(db: FakeDatabase, issues: FakeIssueRepository, audit: FakeAuditService): IssueService {
  return new IssueService(db as unknown as DatabaseService, issues as unknown as IssueRepository, audit as unknown as AuditService);
}

/** 当天（Asia/Shanghai，与 service 同口径）：用真实 now 求值，避免用例随日期推移失真。 */
const NOW_DAY = shanghaiToday(new Date());

describe("日报（M6-01 / M6-02 · A3-01 ~ A3-09）", () => {
  it("提交当天日报：state=submitted；写审计 create + outbox report.submitted；无现场问题不生成问题", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const audit = new FakeAuditService();
    const service = makeReportService(db, reports, issues, audit);
    const created = await service.create(
      PROJECT,
      { date: NOW_DAY, state: "submitted", doneWork: "完成设备安装", headcount: 3 },
      ACTOR,
    );
    expect(created.state).toBe("submitted");
    expect(created.authorId).toBe(ACTOR);
    expect(created.submittedAt).not.toBeNull();
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ action: "create", objectType: "daily_report", projectId: PROJECT });
    expect(db.outbox.map((row) => row.topic)).toEqual(["report.submitted"]);
    expect(issues.issues.size).toBe(0);
  });

  it("当天暂存草稿：state=draft；submittedAt 为空；不生成问题（A3-02）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    const created = await service.create(PROJECT, { date: NOW_DAY, state: "draft", doneWork: "草稿内容" }, ACTOR);
    expect(created.state).toBe("draft");
    expect(created.submittedAt).toBeNull();
    expect(issues.issues.size).toBe(0);
  });

  it("一人一项目一天一条：重复填报 409 REPORT_ALREADY_EXISTS（明细带已存在日报 id，不插入第二行）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    reports.reports.set(REPORT_1, makeReport(REPORT_1, { reportDate: NOW_DAY }));
    const rejected = await service
      .create(PROJECT, { date: NOW_DAY, state: "submitted", doneWork: "重复" }, ACTOR)
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({ code: "REPORT_ALREADY_EXISTS", httpStatus: 409 });
    expect((rejected as { details: { meta?: Record<string, unknown> }[] }).details[0]?.meta?.["reportId"]).toBe(REPORT_1);
    expect(reports.inserted).toEqual([]);
  });

  it("补填：对过去日期首次提交 = state=supplement（服务端推导，客户端不可指定，A3-02）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    const created = await service.create(PROJECT, { date: PAST_DATE, state: "submitted", doneWork: "补填内容" }, ACTOR);
    expect(created.state).toBe("supplement");
    expect(created.date).toBe(PAST_DATE);
  });

  it("未来日期：400 VALIDATION_FAILED（A3-04 只允许当天或补填过去日期）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    await expect(
      service.create(PROJECT, { date: FUTURE_DATE, state: "submitted", doneWork: "未来" }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", httpStatus: 400 });
    expect(reports.inserted).toEqual([]);
  });

  it("关联任务必须属于本项目：跨项目 / 未知任务 400 VALIDATION_FAILED", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    await expect(
      service.create(PROJECT, { date: NOW_DAY, state: "submitted", doneWork: "带任务", taskIds: ["ffffffff-ffff-4fff-8fff-ffffffffffff"] }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", httpStatus: 400 });
    expect(reports.inserted).toEqual([]);
  });

  it("现场发现问题：提交时自动生成问题（未分组 + 按归类自动分派责任部门 + created 事件 + 审计 + outbox）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const audit = new FakeAuditService();
    const service = makeReportService(db, reports, issues, audit);
    await service.create(
      PROJECT,
      { date: PAST_DATE, state: "submitted", doneWork: "安装完成", foundIssue: "液压泵渗油", issueCategory: "机械部", taskIds: [TASK_A] },
      ACTOR,
    );
    const generated = [...issues.issues.values()];
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({
      state: "unassigned",
      category: "机械部",
      ownerDepartment: "机械部",
      sourceReportId: REPORT_2,
      reporterId: ACTOR,
      taskId: TASK_A,
      raisedAt: PAST_DATE,
    });
    expect(issues.events.map((event) => event.eventType)).toEqual(["created"]);
    expect(audit.entries.map((entry) => entry.objectType)).toEqual(["daily_report", "issue"]);
    expect(db.outbox.map((row) => row.topic)).toContain("issue.created");
  });

  it("A3-12 无匹配归类：不自动分派（ownerDepartment 为空）—— 归「未分组」兜底", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    await service.create(
      PROJECT,
      { date: PAST_DATE, state: "submitted", doneWork: "观察中", foundIssue: "客户改期", issueCategory: "客户原因" },
      ACTOR,
    );
    const generated = [...issues.issues.values()];
    expect(generated[0]?.ownerDepartment).toBeNull();
    expect(generated[0]?.state).toBe("unassigned");
  });

  it("A3-09 幂等：重编辑重复提交不重复生成问题（source_report_id 唯一兜底，事件不重复）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    const created = await service.create(
      PROJECT,
      { date: PAST_DATE, state: "submitted", doneWork: "安装完成", foundIssue: "液压泵渗油", issueCategory: "机械部" },
      ACTOR,
    );
    expect(issues.issues.size).toBe(1);
    await service.update(
      PROJECT,
      created.id,
      { version: created.version, state: "submitted", doneWork: "安装完成（补记）" },
      ACTOR,
    );
    expect(issues.issues.size).toBe(1);
    expect(issues.events).toHaveLength(1);
  });

  it("A3-08 回写：提交后任务「项目进展描述」追加【日报 日期】标记 + note_change 事件；重复提交不重复追加", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    const created = await service.create(
      PROJECT,
      { date: PAST_DATE, state: "submitted", doneWork: "完成设备安装", taskIds: [TASK_A, TASK_B] },
      ACTOR,
    );
    expect(reports.taskNotes.get(TASK_A)).toBe("【日报 " + PAST_DATE + "】完成设备安装");
    expect(reports.taskEvents.map((event) => event.taskId)).toEqual([TASK_A, TASK_B]);
    await service.update(PROJECT, created.id, { version: created.version, state: "submitted", doneWork: "完成设备安装" }, ACTOR);
    expect(reports.taskEvents).toHaveLength(2);
    expect(created.taskTitles).toEqual(["安装设备", "调试产线"]);
  });

  it("草稿 → 提交（PATCH）：state 变 submitted 且 submittedAt 落库；审计 update 一条", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const audit = new FakeAuditService();
    const service = makeReportService(db, reports, issues, audit);
    const created = await service.create(PROJECT, { date: NOW_DAY, state: "draft", doneWork: "草稿" }, ACTOR);
    const submitted = await service.update(PROJECT, created.id, { version: created.version, state: "submitted" }, ACTOR);
    expect(submitted.state).toBe("submitted");
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted.version).toBe(created.version + 1);
    expect(audit.entries.map((entry) => entry.action)).toEqual(["create", "update"]);
  });

  it("已提交行不允许退回草稿：400 VALIDATION_FAILED（A3-02）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    reports.reports.set(REPORT_1, makeReport(REPORT_1));
    await expect(
      service.update(PROJECT, REPORT_1, { version: 1, state: "draft" }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", httpStatus: 400 });
  });

  it("编辑时改出「现场发现问题」但未给归类：400 VALIDATION_FAILED（合并后校验，A3-04）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    reports.reports.set(REPORT_1, makeReport(REPORT_1));
    await expect(
      service.update(PROJECT, REPORT_1, { version: 1, foundIssue: "新问题" }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", httpStatus: 400 });
  });

  it("乐观锁：version 不匹配 409 VERSION_CONFLICT（不写审计）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const audit = new FakeAuditService();
    const service = makeReportService(db, reports, issues, audit);
    reports.reports.set(REPORT_1, makeReport(REPORT_1, { version: 2 }));
    await expect(service.update(PROJECT, REPORT_1, { version: 1, doneWork: "改" }, ACTOR)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      httpStatus: 409,
    });
    expect(audit.entries).toEqual([]);
  });

  it("归档项目：写入口一律 409 PROJECT_ARCHIVED（ADR-027）", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    reports.project = { id: PROJECT, status: "archived" };
    issues.project = { id: PROJECT, status: "archived" };
    await expect(
      service.create(PROJECT, { date: NOW_DAY, state: "submitted", doneWork: "归档后" }, ACTOR),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", httpStatus: 409 });
    reports.reports.set(REPORT_1, makeReport(REPORT_1));
    await expect(service.update(PROJECT, REPORT_1, { version: 1, doneWork: "改" }, ACTOR)).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
      httpStatus: 409,
    });
  });

  it("跨项目 / 不存在：日报详情统一 404 NOT_FOUND", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    reports.reports.set(REPORT_1, makeReport(REPORT_1));
    await expect(service.detail(PROJECT, "ffffffff-ffff-4fff-8fff-ffffffffffff")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
    await expect(service.detail(OTHER_PROJECT, REPORT_1)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("列表：日期区间与状态筛选 + 日期倒序；dateFrom > dateTo 400", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    reports.reports.set(REPORT_1, makeReport(REPORT_1, { reportDate: "2026-03-02", state: "supplement" }));
    reports.reports.set(REPORT_2, makeReport(REPORT_2, { reportDate: "2026-03-05", state: "submitted" }));
    const listed = await service.list(PROJECT, { "filter[dateFrom]": "2026-03-01", "filter[dateTo]": "2026-03-03", page: 1, limit: 20 });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe(REPORT_1);
    const all = await service.list(PROJECT, { page: 1, limit: 20 });
    expect(all.items.map((item) => item.id)).toEqual([REPORT_2, REPORT_1]);
    await expect(
      service.list(PROJECT, { "filter[dateFrom]": "2026-03-09", "filter[dateTo]": "2026-03-01", page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", httpStatus: 400 });
  });

  it("日报状态筛选取值非法：400 VALIDATION_FAILED", async () => {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const service = makeReportService(db, reports, issues, new FakeAuditService());
    await expect(service.list(PROJECT, { "filter[state]": "closed", page: 1, limit: 20 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      httpStatus: 400,
    });
  });
});

describe("问题（M6-02 / M6-03 · A3-10 ~ A3-13 / A3-16）", () => {
  function seed(): { db: FakeDatabase; reports: FakeReportRepository; issues: FakeIssueRepository; audit: FakeAuditService; service: IssueService } {
    const db = new FakeDatabase();
    const reports = new FakeReportRepository();
    const issues = new FakeIssueRepository();
    const audit = new FakeAuditService();
    issues.issues.set(ISSUE_1, makeIssue(ISSUE_1));
    return { db, reports, issues, audit, service: makeIssueService(db, issues, audit) };
  }

  it("状态流转：写一条 state_change 事件（from → to）+ 审计 update；note 随事件落库", async () => {
    const { issues, audit, service } = seed();
    const updated = await service.update(PROJECT, ISSUE_1, { version: 1, state: "in_progress", note: "已联系厂家" }, ACTOR);
    expect(updated.state).toBe("in_progress");
    expect(updated.version).toBe(2);
    expect(issues.events).toEqual([
      expect.objectContaining({ eventType: "state_change", fromState: "unassigned", toState: "in_progress", note: "已联系厂家" }),
    ]);
    expect(audit.entries[0]).toMatchObject({ action: "update", objectType: "issue", objectId: ISSUE_1, projectId: PROJECT });
  });

  it("四态允许回退且留痕：done → open 清空 closed_at / closed_by；审计 action=complete 记在关闭那一次", async () => {
    const { issues, service, audit } = seed();
    const done = await service.update(PROJECT, ISSUE_1, { version: 1, state: "done", solution: "已更换密封件" }, ACTOR);
    expect(done.state).toBe("done");
    expect(done.closedAt).not.toBeNull();
    expect(done.closedBy).toBe(ACTOR);
    expect(issues.events.map((event) => event.eventType)).toEqual(["state_change", "solution"]);
    expect(audit.entries[0]?.action).toBe("complete");
    const reopened = await service.update(PROJECT, ISSUE_1, { version: done.version, state: "open", note: "复验未通过" }, ACTOR);
    expect(reopened.state).toBe("open");
    expect(reopened.closedAt).toBeNull();
    expect(reopened.closedBy).toBeNull();
    expect(issues.events).toHaveLength(3);
    expect(issues.events[2]).toMatchObject({ eventType: "state_change", fromState: "done", toState: "open" });
  });

  it("分派与时限：ownerId / ownerDepartment / dueAt 变化写 assignment 事件（A3-12 / A3-13）", async () => {
    const { issues, service } = seed();
    const dueAt = "2026-10-01T00:00:00.000Z";
    const assigned = await service.update(
      PROJECT,
      ISSUE_1,
      { version: 1, ownerId: OTHER_ACTOR, ownerDepartment: "机械部", dueAt, note: "转机械部" },
      ACTOR,
    );
    expect(assigned.ownerId).toBe(OTHER_ACTOR);
    expect(assigned.dueAt).toBe(dueAt);
    expect(issues.events.map((event) => event.eventType)).toEqual(["assignment"]);
  });

  it("空更新防护：四个可改字段全缺省 = 400 VALIDATION_FAILED（防刷留痕）", async () => {
    const { issues, audit, service } = seed();
    await expect(service.update(PROJECT, ISSUE_1, { version: 1 }, ACTOR)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      httpStatus: 400,
    });
    expect(issues.events).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("乐观锁：version 不匹配 409 VERSION_CONFLICT（不写事件）", async () => {
    const { issues, service } = seed();
    await expect(service.update(PROJECT, ISSUE_1, { version: 9, state: "open" }, ACTOR)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      httpStatus: 409,
    });
    expect(issues.events).toEqual([]);
  });

  it("归档项目：问题写入口 409 PROJECT_ARCHIVED", async () => {
    const { issues, service } = seed();
    issues.project = { id: PROJECT, status: "archived" };
    await expect(service.update(PROJECT, ISSUE_1, { version: 1, state: "open" }, ACTOR)).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
      httpStatus: 409,
    });
  });

  it("跨项目 / 不存在：问题详情与更新统一 404 NOT_FOUND", async () => {
    const { service } = seed();
    await expect(service.detail(OTHER_PROJECT, ISSUE_1)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
    await expect(
      service.update(PROJECT, "ffffffff-ffff-4fff-8fff-ffffffffffff", { version: 1, state: "open" }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("详情：问题本体 + 处理过程留痕按写入顺序返回（时间正序）", async () => {
    const { service } = seed();
    const first = await service.update(PROJECT, ISSUE_1, { version: 1, state: "open" }, ACTOR);
    await service.update(PROJECT, ISSUE_1, { version: first.version, solution: "已修复", note: "复验通过" }, ACTOR);
    const detail = await service.detail(PROJECT, ISSUE_1);
    expect(detail.events.map((event) => event.eventType)).toEqual(["state_change", "solution"]);
    expect(detail.events[1]).toMatchObject({ actorId: ACTOR, note: "复验通过" });
  });

  it("列表：按项目返回（状态筛选由仓储承担）；问题看板与问题追踪同源", async () => {
    const { service } = seed();
    const listed = await service.list(PROJECT, { page: 1, limit: 20 });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe(ISSUE_1);
    expect(listed.items[0]?.category).toBe("机械部");
  });
});
