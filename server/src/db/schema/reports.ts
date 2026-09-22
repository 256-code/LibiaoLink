/**
 * daily_reports / issues / issue_events（0023 · M6-01 ~ M6-03 第一刀 · A3-01 / A3-02 / A3-04 / A3-09 / A3-10 / A3-13）。
 * 表口径见 database/migrations/0023_daily_reports_issues.sql；契约见 shared/src/modules/reports.ts 与 issues.ts。
 * 引用守卫（系统功能书 A2-01）：tasks 删除时检查 daily_reports.task_ids（GIN）与 issues.task_id（b-tree）。
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { DAILY_REPORT_STATE_KEYS, ISSUE_CATEGORY_KEYS, ISSUE_EVENT_TYPE_KEYS, ISSUE_STATE_KEYS, sqlValueList } from "./literals.js";
import { projects } from "./projects.js";
import { tasks } from "./tasks.js";

/** 日报（A3-01 / A3-02）：一人一项目一天一条；草稿 / 提交 / 补填共用同一行（uq_daily_reports_author_date）。 */
export const dailyReports = pgTable(
  "daily_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    authorId: uuid("author_id").notNull().references(() => users.id),
    reportDate: date("report_date").notNull(),
    state: text("state").notNull(),
    headcount: smallint("headcount"),
    doneWork: text("done_work").notNull(),
    plan: text("plan"),
    foundIssue: text("found_issue"),
    issueCategory: text("issue_category"),
    suggestion: text("suggestion"),
    /** 关联任务（A3-03 / A3-08）：多选，空数组 = 不关联；引用守卫经 GIN 索引判「任务被日报引用」。 */
    taskIds: uuid("task_ids")
      .array()
      .notNull()
      .default(sql`array[]::uuid[]`),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("uq_daily_reports_author_date").on(table.projectId, table.authorId, table.reportDate),
    index("ix_daily_reports_project_date").on(table.projectId, table.reportDate.desc()),
    index("ix_daily_reports_author_date").on(table.authorId, table.reportDate.desc()),
    index("ix_daily_reports_task_ids").using("gin", table.taskIds),
    check("ck_daily_reports_state", sql`${table.state} in ${sql.raw(sqlValueList(DAILY_REPORT_STATE_KEYS))}`),
    check("ck_daily_reports_headcount", sql`${table.headcount} is null or (${table.headcount} >= 0 and ${table.headcount} <= 100000)`),
    check("ck_daily_reports_done_work", sql`char_length(btrim(${table.doneWork})) between 1 and 2000`),
    check("ck_daily_reports_plan", sql`${table.plan} is null or char_length(btrim(${table.plan})) between 1 and 2000`),
    check("ck_daily_reports_found_issue", sql`${table.foundIssue} is null or char_length(btrim(${table.foundIssue})) between 1 and 2000`),
    check("ck_daily_reports_suggestion", sql`${table.suggestion} is null or char_length(btrim(${table.suggestion})) between 1 and 2000`),
    check("ck_daily_reports_issue_category", sql`${table.issueCategory} is null or ${table.issueCategory} in ${sql.raw(sqlValueList(ISSUE_CATEGORY_KEYS))}`),
    check("ck_daily_reports_issue_pairs", sql`${table.foundIssue} is null or ${table.issueCategory} is not null`),
    check("ck_daily_reports_task_ids", sql`array_position(${table.taskIds}, null) is null and cardinality(${table.taskIds}) <= 200`),
  ],
);
/** 问题（A3-09 / A3-10 / A3-11 / A3-12）：由日报「现场发现问题」自动生成（source_report_id 唯一 = 幂等），也可手工创建。 */
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    taskId: uuid("task_id").references(() => tasks.id),
    /** 来源日报（A3-09 幂等兜底）：uq_issues_source_report 唯一；空 = 手工创建的问题。 */
    sourceReportId: uuid("source_report_id").references(() => dailyReports.id),
    title: text("title").notNull(),
    category: text("category").notNull(),
    state: text("state").notNull(),
    reporterId: uuid("reporter_id").notNull().references(() => users.id),
    /** 责任部门 / 责任人（A3-12 自动分派）：未分派时为空。 */
    ownerDepartment: text("owner_department"),
    ownerId: uuid("owner_id").references(() => users.id),
    /** 处理时限（ADR-026）：归类 SLA 折算；一期仅落库，提醒 / 升级随规则引擎（M5）。 */
    dueAt: timestamp("due_at", { withTimezone: true }),
    raisedAt: date("raised_at").notNull(),
    solution: text("solution"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("uq_issues_source_report").on(table.sourceReportId),
    index("ix_issues_project_state").on(table.projectId, table.state, table.raisedAt.desc()),
    index("ix_issues_task").on(table.taskId),
    index("ix_issues_category").on(table.projectId, table.category),
    index("ix_issues_reporter").on(table.reporterId, table.raisedAt.desc()),
    check("ck_issues_state", sql`${table.state} in ${sql.raw(sqlValueList(ISSUE_STATE_KEYS))}`),
    check("ck_issues_category", sql`${table.category} in ${sql.raw(sqlValueList(ISSUE_CATEGORY_KEYS))}`),
    check("ck_issues_title", sql`char_length(btrim(${table.title})) between 1 and 500`),
    check("ck_issues_solution", sql`${table.solution} is null or char_length(btrim(${table.solution})) between 1 and 2000`),
    check("ck_issues_owner_department", sql`${table.ownerDepartment} is null or char_length(btrim(${table.ownerDepartment})) between 1 and 80`),
    check("ck_issues_closed_pairs", sql`(${table.state} = 'done') = (${table.closedAt} is not null)`),
  ],
);

/** 问题事件（A3-13 处理过程留痕）：创建 / 状态流转 / 解决方案 / 分派；允许回退（A3-10），回退同样写事件。 */
export const issueEvents = pgTable(
  "issue_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    eventType: text("event_type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_issue_events_issue").on(table.issueId, table.createdAt),
    check("ck_issue_events_type", sql`${table.eventType} in ${sql.raw(sqlValueList(ISSUE_EVENT_TYPE_KEYS))}`),
    check("ck_issue_events_note", sql`${table.note} is null or char_length(btrim(${table.note})) between 1 and 2000`),
  ],
);
