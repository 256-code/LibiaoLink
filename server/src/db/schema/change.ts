import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projectNodes } from "./flow.js";
import { STAGE_KEYS, sqlValueList } from "./literals.js";
import { projects } from "./projects.js";

/** change_requests（一期：申请即通过、平权、全程留痕，状态只有 applied）。 */
export const changeRequests = pgTable(
  "change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    nodeId: uuid("node_id").references(() => projectNodes.id),
    stageKey: text("stage_key"),
    reason: text("reason").notNull(),
    beforeSummary: text("before_summary"),
    afterSummary: text("after_summary"),
    status: text("status").notNull(),
    appliedBy: uuid("applied_by").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_change_project").on(table.projectId, desc(table.createdAt)),
    check(
      "ck_change_requests_stage_key",
      sql`${table.stageKey} is null or ${table.stageKey} in ${sql.raw(sqlValueList(STAGE_KEYS))}`,
    ),
    check("ck_change_requests_status", sql`${table.status} in ${sql.raw(sqlValueList(["applied"]))}`),
  ],
);
