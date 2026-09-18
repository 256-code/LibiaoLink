import { sql } from "drizzle-orm";
import { bigserial, check, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sqlValueList } from "./literals.js";

/** outbox_events（外部副作用唯一出口：至少一次投递 + dedupe_key 消费幂等）。 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("outbox_events_dedupe_key_key").on(table.dedupeKey),
    index("ix_outbox_ready").on(table.status, table.availableAt),
    check(
      "ck_outbox_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["pending", "processing", "done", "dead"]))}`,
    ),
    check("ck_outbox_attempts", sql`${table.attempts} >= 0`),
  ],
);
