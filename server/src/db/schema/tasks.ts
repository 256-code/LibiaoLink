import { desc, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { changeRequests } from "./change.js";
import { projectNodes } from "./flow.js";
import { STAGE_KEYS, sqlValueList } from "./literals.js";
import { projects } from "./projects.js";

/** tasks（项目总览 15 列口径；status 为存储基础态，展示态派生，见 v0.2 §2.4）。 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    /** 可空（A15 · Push 124）：看板「＋ 添加 → 临时任务」先不带阶段，前端显示「未分组」。 */
    stageKey: text("stage_key"),
    nodeId: uuid("node_id").references(() => projectNodes.id),
    title: text("title").notNull(),
    titleEn: text("title_en"),
    /**
     * 任务负责人（A23 · Push 136）：可多位、数组顺序 = 展示顺序；空数组 = 「待分配」（A18 合法中间状态）。
     * 空默认值与「未分配」同义，存量 / 新建都不写 null。
     */
    ownerIds: uuid("owner_ids").array().notNull().default(sql`array[]::uuid[]`),
    status: text("status").notNull(),
    progress: numeric("progress", { precision: 3, scale: 2 }).notNull().default("0"),
    plannedStart: date("planned_start"),
    plannedEnd: date("planned_end"),
    actualEnd: date("actual_end"),
    estimatedDays: smallint("estimated_days"),
    headcount: smallint("headcount"),
    priority: text("priority"),
    deliverable: text("deliverable"),
    note: text("note"),
    onTime: boolean("on_time"),
    changeRef: uuid("change_ref").references((): AnyPgColumn => changeRequests.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** 组内位次（A19 / A20 · Push 124）：一组 = 同一项目 + 同一阶段（null = 未分组）；0 起、密集。 */
    sortIndex: integer("sort_index").notNull().default(0),
  },
  (table) => [
    index("ix_tasks_project_stage").on(table.projectId, table.stageKey),
    index("ix_tasks_project_stage_order").on(table.projectId, table.stageKey, table.sortIndex),
    index("ix_tasks_owner_ids").using("gin", table.ownerIds),
    index("ix_tasks_due").on(table.projectId, table.actualEnd, table.plannedEnd),
    check(
      "ck_tasks_stage_key",
      sql`${table.stageKey} in ${sql.raw(sqlValueList(STAGE_KEYS))}`,
    ),
    check("ck_tasks_status", sql`${table.status} in ${sql.raw(sqlValueList(["pending", "active", "done"]))}`),
    check("ck_tasks_progress", sql`${table.progress} in (0, 0.25, 0.5, 0.75, 1)`),
    check("ck_tasks_headcount", sql`${table.headcount} is null or ${table.headcount} >= 0`),
    check(
      "ck_tasks_estimated_days",
      sql`${table.estimatedDays} is null or ${table.estimatedDays} >= 0`,
    ),
    check("ck_tasks_sort_index", sql`${table.sortIndex} >= 0`),
    check("ck_tasks_owner_ids_no_null", sql`array_position(${table.ownerIds}, null::uuid) is null`),
  ],
);

/** task_events（字段级留痕：状态 / 日期 / 进度 / 描述变更）。 */
export const taskEvents = pgTable(
  "task_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    taskId: uuid("task_id").notNull().references(() => tasks.id),
    eventType: text("event_type").notNull(),
    beforeValue: text("before_value"),
    afterValue: text("after_value"),
    actorId: uuid("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_task_events_task").on(table.taskId, desc(table.createdAt)),
    check(
      "ck_task_events_type",
      sql`${table.eventType} in ${sql.raw(sqlValueList(["status_change", "date_change", "progress_change", "note_change"]))}`,
    ),
  ],
);
