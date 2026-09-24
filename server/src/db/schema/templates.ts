import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * task_nodes（0032 · M3-05 余）：任务节点库 —— 任务模板页「任务节点」左列的节点来源（阶段 + 中英文名 + 库内排序）。
 * 与流程节点（project_nodes / 蓝图）区分：本表回答「任务从哪来」，不被 tasks 引用（tasks.node_id 仍指向 project_nodes）。
 * 删除 = 物理删行（审计快照 action=delete）；模板引用守卫随模板接口那一刀追加。
 */
export const taskNodes = pgTable(
  "task_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageKey: text("stage_key").notNull(),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    titleEn: text("title_en"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_task_nodes_stage_title").on(table.stageKey, table.title),
    index("ix_task_nodes_stage_seq").on(table.stageKey, table.seq, table.id),
    check("ck_task_nodes_stage_key", sql`${table.stageKey} in ('presale', 'design', 'purchase', 'assembly', 'install', 'deploy', 'trial', 'production', 'acceptance')`),
    check("ck_task_nodes_seq", sql`${table.seq} > 0`),
    check("ck_task_nodes_title", sql`char_length(btrim(${table.title})) between 1 and 200`),
    check("ck_task_nodes_version", sql`${table.version} >= 0`),
  ],
);
