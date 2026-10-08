/**
 * daily_reports / issues / issue_events（0023 · M6-01 ~ M6-03 第一刀 · A3-01 / A3-02 / A3-04 / A3-09 / A3-10 / A3-13）。
 * 表口径见 database/migrations/0023_daily_reports_issues.sql（Push 215 修订见 0041：同日多条 / 关联阶段 / 归类多值 / 三态 / 删 due_at；Push 243 见 0043：删 uq_issues_source_report + 增 issue_drafts（内联问题清单），一日报可派生多条问题）。
 * 契约见 shared/src/modules/reports.ts 与 issues.ts。
 * 引用守卫（系统功能书 A2-01）：tasks 删除时只检查 issues.task_id（b-tree）；日报一侧 task_ids 守卫随「关联任务改关联阶段」删除（Push 215）。
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { DAILY_REPORT_STATE_KEYS, ISSUE_CATEGORY_KEYS, ISSUE_EVENT_TYPE_KEYS, ISSUE_STATE_KEYS, STAGE_KEYS, sqlArrayLiteral, sqlValueList } from "./literals.js";
import { projects } from "./projects.js";
import { tasks } from "./tasks.js";

/** 日报（A3-01 / A3-02）：草稿 / 提交 / 补填共用一行；同人同项目同日可多条（Push 215 删 uq_daily_reports_author_date）。 */
export const dailyReports = pgTable(
  "daily_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    authorId: uuid("author_id").notNull().references(() => users.id),
    reportDate: date("report_date").notNull(),
    state: text("state").notNull(),
    headcount: integer("headcount"),
    doneWork: text("done_work").notNull(),
    plan: text("plan"),
    foundIssue: text("found_issue"),
    /** 问题归类（Push 215 多值）：空数组 = 无问题；「现场发现问题」非空时 ≥1 项。 */
    issueCategories: text("issue_categories")
      .array()
      .notNull()
      .default(sql`array[]::text[]`),
    suggestion: text("suggestion"),
    /** 内联问题清单（Push 243）：「添加问题」逐条填的问题（描述 / 归类 / 处理人 / 解决方案 / 附图）——
     *  草稿期整体落这里；提交时逐条生成独立问题记录（原稿保留不改写）；空数组 = 旧单问题字段口径（found_issue / issue_categories / suggestion）。 */
    issueDrafts: jsonb("issue_drafts")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 关联阶段（Push 198 口径 / Push 215 落库）：空数组 = 不关联（原关联任务 task_ids 已删）。 */
    stageKeys: text("stage_keys")
      .array()
      .notNull()
      .default(sql`array[]::text[]`),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("ix_daily_reports_project_date").on(table.projectId, table.reportDate.desc()),
    index("ix_daily_reports_author_date").on(table.authorId, table.reportDate.desc()),
    check("ck_daily_reports_state", sql`${table.state} in ${sql.raw(sqlValueList(DAILY_REPORT_STATE_KEYS))}`),
    check("ck_daily_reports_headcount", sql`${table.headcount} is null or (${table.headcount} >= 0 and ${table.headcount} <= 100000)`),
    check("ck_daily_reports_done_work", sql`char_length(btrim(${table.doneWork})) between 1 and 2000`),
    check("ck_daily_reports_plan", sql`${table.plan} is null or char_length(btrim(${table.plan})) between 1 and 2000`),
    check("ck_daily_reports_found_issue", sql`${table.foundIssue} is null or char_length(btrim(${table.foundIssue})) between 1 and 2000`),
    check("ck_daily_reports_suggestion", sql`${table.suggestion} is null or char_length(btrim(${table.suggestion})) between 1 and 2000`),
    check("ck_daily_reports_issue_categories", sql`array_position(${table.issueCategories}, null) is null and cardinality(${table.issueCategories}) <= 10 and ${table.issueCategories} <@ ${sql.raw(sqlArrayLiteral(ISSUE_CATEGORY_KEYS))}`),
    check("ck_daily_reports_issue_pairs", sql`${table.foundIssue} is null or cardinality(${table.issueCategories}) >= 1`),
    check("ck_daily_reports_stage_keys", sql`array_position(${table.stageKeys}, null) is null and cardinality(${table.stageKeys}) <= 9 and ${table.stageKeys} <@ ${sql.raw(sqlArrayLiteral(STAGE_KEYS))}`),
    check("ck_daily_reports_issue_drafts", sql`jsonb_typeof(${table.issueDrafts}) = 'array'`),
  ],
);
/** 问题（A3-09 / A3-10 / A3-11 / A3-12）：由日报「现场发现问题」自动生成（Push 243 起一条日报可派生多条 —— 原 uq_issues_source_report 删除，幂等处见 report.service），也可手工创建。 */
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    taskId: uuid("task_id").references(() => tasks.id),
    /** 来源日报（A3-09）：空 = 手工创建的问题；Push 243 起非唯一（一日报可多条，幂等改由应用层按计数判断，索引见下）。 */
    sourceReportId: uuid("source_report_id").references(() => dailyReports.id),
    title: text("title").notNull(),
    /** 问题归类（Push 215 多值，≥1 项）。 */
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`array[]::text[]`),
    state: text("state").notNull(),
    reporterId: uuid("reporter_id").notNull().references(() => users.id),
    /** 责任部门 / 责任人（A3-12 自动分派）：未分派时为空。 */
    ownerDepartment: text("owner_department"),
    ownerId: uuid("owner_id").references(() => users.id),
    raisedAt: date("raised_at").notNull(),
    solution: text("solution"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("ix_issues_source_report").on(table.sourceReportId).where(sql`source_report_id is not null`),
    index("ix_issues_project_state").on(table.projectId, table.state, table.raisedAt.desc()),
    index("ix_issues_task").on(table.taskId),
    index("ix_issues_categories").using("gin", table.categories),
    index("ix_issues_reporter").on(table.reporterId, table.raisedAt.desc()),
    check("ck_issues_state", sql`${table.state} in ${sql.raw(sqlValueList(ISSUE_STATE_KEYS))}`),
    check("ck_issues_categories", sql`array_position(${table.categories}, null) is null and cardinality(${table.categories}) between 1 and 10 and ${table.categories} <@ ${sql.raw(sqlArrayLiteral(ISSUE_CATEGORY_KEYS))}`),
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
