/**
 * notifications / notify_prefs 数据访问（0040 · S7-4 · j1 / M5-04 首刀）。
 * 读面只认「主行」（merged_into_id is null）：合并子行仅库内留档（C5-03），不进收件箱。
 * 投递延迟列（deliver_at / delivered_at）承载免打扰与每日上限 —— flush 循环按 deliver_at 到期重排。
 */
import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { notifications, notifyPrefs } from "../../db/schema/notify.js";

/** 通知行（写路径读回与读面共用；契约转换在服务层）。 */
export interface NotifyMessageRow {
  id: number;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  status: string;
  refType: string | null;
  refId: string | null;
  templateCode: string | null;
  mergeKey: string;
  mergedCount: number;
  mergedIntoId: number | null;
  deliverAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
}

/** 投递事件落库输入（服务层已完成载荷校验与空白归一）。 */
export interface NotifyMessageInsert {
  recipientId: string;
  type: string;
  title: string;
  body: string;
  refType: string | null;
  refId: string | null;
  sourceTopic: string;
  sourceDedupeKey: string;
  templateCode: string | null;
  mergeKey: string;
}

/** 收件箱读面过滤（服务层已做入参归一）。 */
export interface NotifyInboxFilter {
  status: string | null;
  type: string | null;
  refType: string | null;
  from: Date | null;
  to: Date | null;
  page: number;
  limit: number;
}

/** 通知偏好行（可空列 = 继承 env 缺省）。 */
export interface NotifyPrefsRow {
  userId: string;
  /** null = 继承缺省 / '' = 关闭 / 'HH:MM-HH:MM' 自定义。 */
  quietHours: string | null;
  dailyLimit: number | null;
  mergeWindowMs: number | null;
  updatedAt: Date;
}

/** 偏好局部更新（只含传入键；quietHours 见三态口径）。 */
export interface NotifyPrefsPatch {
  quietHours?: string | null;
  dailyLimit?: number | null;
  mergeWindowMs?: number | null;
}

const NOTIFY_SELECT = {
  id: notifications.id,
  recipientId: notifications.recipientId,
  type: notifications.type,
  title: notifications.title,
  body: notifications.body,
  status: notifications.status,
  refType: notifications.refType,
  refId: notifications.refId,
  templateCode: notifications.templateCode,
  mergeKey: notifications.mergeKey,
  mergedCount: notifications.mergedCount,
  mergedIntoId: notifications.mergedIntoId,
  deliverAt: notifications.deliverAt,
  deliveredAt: notifications.deliveredAt,
  createdAt: notifications.createdAt,
} as const;

@Injectable()
export class NotifyRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 投递事件落库：`source_dedupe_key` 唯一 —— 消费重放命中冲突返回 null（幂等，不抛错）。 */
  async insertMessage(input: NotifyMessageInsert, tx?: DbClient): Promise<NotifyMessageRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .insert(notifications)
      .values({
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        refType: input.refType,
        refId: input.refId,
        sourceTopic: input.sourceTopic,
        sourceDedupeKey: input.sourceDedupeKey,
        templateCode: input.templateCode,
        mergeKey: input.mergeKey,
      })
      .onConflictDoNothing({ target: notifications.sourceDedupeKey })
      .returning(NOTIFY_SELECT);
    return rows[0] ?? null;
  }

  /** 到期未投递行（flush 循环领取：主行、未投递、deliver_at 已到）。 */
  async listDue(now: Date, limit: number, tx?: DbClient): Promise<NotifyMessageRow[]> {
    const db = tx ?? this.database.db;
    return db
      .select(NOTIFY_SELECT)
      .from(notifications)
      .where(
        and(
          isNull(notifications.mergedIntoId),
          isNull(notifications.deliveredAt),
          lte(notifications.deliverAt, now),
        ),
      )
      .orderBy(asc(notifications.deliverAt), asc(notifications.id))
      .limit(limit);
  }

  /**
   * 合并目标：同收件人 + 同合并键、窗口内创建、未读且未合并的**更早**主行（`id < excludeId`，取最新的那条）。
   * 只并入更早的行 = 「首条为主、后续并入」：消费路径 B 并入 A；flush 路径按 id 升序处理时，
   * 早行先投递、晚行再并入早行，主行恒为最早那条（结果与处理顺序无关）。
   */
  async findMergeTarget(
    input: { recipientId: string; mergeKey: string; since: Date; excludeId: number },
    tx?: DbClient,
  ): Promise<NotifyMessageRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select(NOTIFY_SELECT)
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, input.recipientId),
          eq(notifications.mergeKey, input.mergeKey),
          isNull(notifications.mergedIntoId),
          eq(notifications.status, "unread"),
          gte(notifications.createdAt, input.since),
          lt(notifications.id, input.excludeId),
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 合并落库：子行挂主行（留档）+ 主行 merged_count 自增（同一事务内两笔）。 */
  async attachMerged(
    input: { childId: number; parentId: number; at: Date },
    tx?: DbClient,
  ): Promise<void> {
    const db = tx ?? this.database.db;
    await db
      .update(notifications)
      .set({ mergedIntoId: input.parentId, updatedAt: input.at })
      .where(eq(notifications.id, input.childId));
    await db
      .update(notifications)
      .set({ mergedCount: sql`${notifications.mergedCount} + 1`, updatedAt: input.at })
      .where(eq(notifications.id, input.parentId));
  }

  /** 投递：置 delivered_at（收件箱可见）。 */
  async markDelivered(id: number, at: Date, tx?: DbClient): Promise<void> {
    const db = tx ?? this.database.db;
    await db.update(notifications).set({ deliveredAt: at, updatedAt: at }).where(eq(notifications.id, id));
  }

  /** 延迟投递：推后 deliver_at（免打扰 / 每日上限），delivered_at 保持空。 */
  async postpone(id: number, deliverAt: Date, at: Date, tx?: DbClient): Promise<void> {
    const db = tx ?? this.database.db;
    await db.update(notifications).set({ deliverAt, updatedAt: at }).where(eq(notifications.id, id));
  }

  /** 当日已投递主行数（每人每日上限的统计口径：按 delivered_at、Asia/Shanghai 业务日起点）。 */
  async countDeliveredSince(recipientId: string, since: Date, tx?: DbClient): Promise<number> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          isNull(notifications.mergedIntoId),
          gte(notifications.deliveredAt, since),
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }

  /** 收件箱：过滤 + 分页（id 降序 = 新消息在前）+ 总数。 */
  async listInbox(
    recipientId: string,
    filter: NotifyInboxFilter,
    tx?: DbClient,
  ): Promise<{ rows: NotifyMessageRow[]; total: number }> {
    const db = tx ?? this.database.db;
    const conditions: SQL[] = [
      eq(notifications.recipientId, recipientId),
      isNull(notifications.mergedIntoId),
      // 收件箱只返回**已投递**行：delay 中的行（免打扰 / 每日上限排队）不属于收件箱可见面。
      isNotNull(notifications.deliveredAt),
    ];
    if (filter.status !== null) {
      conditions.push(eq(notifications.status, filter.status));
    }
    if (filter.type !== null) {
      conditions.push(eq(notifications.type, filter.type));
    }
    if (filter.refType !== null) {
      conditions.push(eq(notifications.refType, filter.refType));
    }
    if (filter.from !== null) {
      conditions.push(gte(notifications.deliveredAt, filter.from));
    }
    if (filter.to !== null) {
      conditions.push(lte(notifications.deliveredAt, filter.to));
    }
    const where = and(...conditions);
    const rows = await db
      .select(NOTIFY_SELECT)
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.id))
      .limit(filter.limit)
      .offset((filter.page - 1) * filter.limit);
    const totals = await db.select({ value: count() }).from(notifications).where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** 未读角标（C5-01；只算已投递主行）。 */
  async countUnread(recipientId: string, tx?: DbClient): Promise<number> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          isNull(notifications.mergedIntoId),
          eq(notifications.status, "unread"),
          isNotNull(notifications.deliveredAt),
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }

  /** 本人行回读（标记入口的归属校验；合并子行 / 未投递行同样返回，由服务层裁 404）。 */
  async findByIdForRecipient(id: number, recipientId: string, tx?: DbClient): Promise<NotifyMessageRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select(NOTIFY_SELECT)
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 标记状态（幂等：同值再标 = 0 行变更，读回原行）。 */
  async markStatus(id: number, status: string, at: Date, tx?: DbClient): Promise<NotifyMessageRow> {
    const db = tx ?? this.database.db;
    const rows = await db
      .update(notifications)
      .set({ status, updatedAt: at })
      .where(eq(notifications.id, id))
      .returning(NOTIFY_SELECT);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("notify markStatus：行不存在（id=" + id + "）");
    }
    return row;
  }

  /** 全部标记已读（只动已投递主行）：返回实际置位条数。 */
  async markAllRead(recipientId: string, at: Date, tx?: DbClient): Promise<number> {
    const db = tx ?? this.database.db;
    const rows = await db
      .update(notifications)
      .set({ status: "read", updatedAt: at })
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          isNull(notifications.mergedIntoId),
          eq(notifications.status, "unread"),
          isNotNull(notifications.deliveredAt),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  }

  /** 偏好读取（无行 = 全走 env 缺省）。 */
  async getPrefs(userId: string, tx?: DbClient): Promise<NotifyPrefsRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select({
        userId: notifyPrefs.userId,
        quietHours: notifyPrefs.quietHours,
        dailyLimit: notifyPrefs.dailyLimit,
        mergeWindowMs: notifyPrefs.mergeWindowMs,
        updatedAt: notifyPrefs.updatedAt,
      })
      .from(notifyPrefs)
      .where(eq(notifyPrefs.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 偏好落库（局部更新：只写传入键；无行则插入）。 */
  async upsertPrefs(userId: string, patch: NotifyPrefsPatch, at: Date, tx?: DbClient): Promise<NotifyPrefsRow> {
    const db = tx ?? this.database.db;
    const rows = await db
      .insert(notifyPrefs)
      .values({ userId, ...patch, updatedAt: at })
      .onConflictDoUpdate({ target: notifyPrefs.userId, set: { ...patch, updatedAt: at } })
      .returning({
        userId: notifyPrefs.userId,
        quietHours: notifyPrefs.quietHours,
        dailyLimit: notifyPrefs.dailyLimit,
        mergeWindowMs: notifyPrefs.mergeWindowMs,
        updatedAt: notifyPrefs.updatedAt,
      });
    const row = rows[0];
    if (row === undefined) {
      throw new Error("notify upsertPrefs：写入未返回行（userId=" + userId + "）");
    }
    return row;
  }
}

