import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    /** 领取时刻（migration 0028）：worker 崩溃 / 重启后按超阈值重领，避免行永久卡在 processing。 */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("outbox_events_dedupe_key_key").on(table.dedupeKey),
    index("ix_outbox_ready").on(table.status, table.availableAt),
    index("ix_outbox_processing").on(table.lockedAt).where(sql`status = 'processing'`),
    check(
      "ck_outbox_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["pending", "processing", "done", "dead"]))}`,
    ),
    check("ck_outbox_attempts", sql`${table.attempts} >= 0`),
  ],
);

/** idempotency_keys（写接口幂等：只存 key 哈希；作用域 = 调用方 + 接口指纹）。 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull(),
    route: text("route").notNull(),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("in_progress"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("idempotency_keys_actor_id_route_key_hash_key").on(table.actorId, table.route, table.keyHash),
    index("ix_idempotency_keys_expiry").on(table.expiresAt),
    check(
      "ck_idempotency_keys_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["in_progress", "completed"]))}`,
    ),
    check("ck_idempotency_keys_expires", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "ck_idempotency_keys_response",
      sql`(${table.status} = 'completed') = (${table.responseStatus} is not null)`,
    ),
    check(
      "ck_idempotency_keys_hashes",
      sql`${table.keyHash} ~ '^[0-9a-f]{64}$' and ${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
