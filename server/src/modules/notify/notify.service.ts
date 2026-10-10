import { Injectable, Logger } from "@nestjs/common";
import {
  type Notification,
  type NotificationListQuery,
  type NotificationListResponse,
  type NotificationMarkAllReadResponse,
  type NotifyMessagePayload,
  type NotifyPrefs,
  type NotifyPrefsUpdateBody,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { ClockService } from "../../common/clock/clock.service.js";
import { AppConfig } from "../../config/config.module.js";
import { DatabaseService } from "../../db/database.service.js";
import type { OutboxClaimedRow } from "../../db/outbox.store.js";
import type { DbClient } from "../../db/db-client.js";
import type { OutboxHandleOutcome } from "../../outbox/handler.js";
import {
  formatClockMinute,
  isDeliverableChannel,
  mergeKeyOf,
  parseNotifyMessage,
  parseQuietHours,
  planDelivery,
  shanghaiDayStart,
  type QuietHours,
} from "./notify.delivery.js";
import {
  NotifyRepository,
  type NotifyInboxFilter,
  type NotifyMessageInsert,
  type NotifyMessageRow,
  type NotifyPrefsPatch,
  type NotifyPrefsRow,
} from "./notify.repository.js";

/** flush 循环单轮统计（worker 日志与回放断言共用）。 */
export interface NotifyFlushStats {
  scanned: number;
  delivered: number;
  merged: number;
  postponed: number;
}

/** 生效偏好（个人配置 → env 缺省回退后）。 */
interface ResolvedNotifyPrefs {
  quiet: QuietHours | null;
  dailyLimit: number;
  mergeWindowMs: number;
}

/**
 * 通知投递服务（S7-4 · j1 / M5-04 首刀 · C5 / C2-08 / C2-09）。
 *
 * 两条入口：
 * ① `consume` —— outbox 主题 `notify.message` 消费者（worker 注册表）：一次投递事件 = 一行留档
 *    （`source_dedupe_key` 唯一兜底消费重放），随后三选一：并入同期主行（合并）/ 立即投递 / 排期（免打扰 / 每日上限）；
 * ② `flushDue` —— 延迟投递排空（worker 常驻循环）：把 `deliver_at` 到期的行重排一次（合并或投递），
 *    与 consume 共用同一决策函数 —— 不在 outbox 重试里做（重试语义是「消费失败退避」，不是「投递窗口静默」）。
 *
 * 读面（消息中心）：收件箱列表 / 未读角标 / 标记已读·已处理 / 全部已读 / 通知偏好 —— 全为**个人资源**
 * （仅会话、无功能权限键、不写审计；先例 user_preferences / project_views）。
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly repository: NotifyRepository,
    private readonly database: DatabaseService,
    private readonly config: AppConfig,
    private readonly clock: ClockService,
  ) {}

  /** 单条消费（OutboxDispatcher 调用）：分类只有 done / dead / retry；任何异常都不外抛。 */
  async consume(row: OutboxClaimedRow): Promise<OutboxHandleOutcome> {
    const message = parseNotifyMessage(row.payload);
    if (message === null) {
      this.logger.warn("通知载荷非法，转 dead：outbox#" + row.id + "（" + row.dedupeKey + "）");
      return {
        outcome: "dead",
        error: "通知载荷非法（缺 recipientId / type / title / body 或超长）：" + row.dedupeKey,
      };
    }
    if (!isDeliverableChannel(message.channel ?? "inbox")) {
      // 接线段护栏（wmj PR #197 提请）：非 inbox 渠道在 M5-03 落地前按确定性失败收口（dead + 告警），
      // 不得静默当站内信投递 —— 一次即弃，不进重试退避。
      this.logger.warn("通知渠道未落地（确定性失败转 dead）：outbox#" + row.id + " · channel=" + message.channel);
      return {
        outcome: "dead",
        error: "非 inbox 渠道未落地（M5-03 前按确定性失败收口）：channel=" + message.channel + " · " + row.dedupeKey,
      };
    }
    try {
      const result = await this.deliverOnce(message, row.topic, row.dedupeKey);
      if (result.duplicate) {
        // 消费重放（worker 崩溃超领取窗重领 / 人工重放）：source_dedupe_key 唯一命中 —— 幂等收敛为 done。
        this.logger.log("通知重复投递（source_dedupe_key 已存在），幂等跳过：" + row.dedupeKey);
      }
      return { outcome: "done" };
    } catch (error) {
      const message0 = messageOf(error);
      this.logger.error("通知投递失败（按可重试收敛）：outbox#" + row.id + " —— " + message0);
      return { outcome: "retry", error: message0 };
    }
  }

  /** 单条投递（事务内）：落行 → 合并判定 → 投递 / 排期；重放命中唯一键 = duplicate（幂等）。 */
  private async deliverOnce(
    message: NotifyMessagePayload,
    topic: string,
    dedupeKey: string,
  ): Promise<{ duplicate: boolean }> {
    const now = this.clock.now();
    const prefs = await this.resolvePrefs(message.recipientId);
    const insert: NotifyMessageInsert = {
      recipientId: message.recipientId,
      type: message.type,
      title: message.title,
      body: message.body,
      refType: message.refType ?? null,
      refId: message.refId ?? null,
      sourceTopic: topic,
      sourceDedupeKey: dedupeKey,
      templateCode: message.templateCode ?? null,
      mergeKey: mergeKeyOf(message),
    };
    return this.database.db.transaction(async (tx) => {
      const row = await this.repository.insertMessage(insert, tx);
      if (row === null) {
        return { duplicate: true };
      }
      if (await this.tryMerge(row, prefs, now, tx)) {
        return { duplicate: false };
      }
      const decision = planDelivery({
        now,
        quiet: prefs.quiet,
        dailyLimit: prefs.dailyLimit,
        deliveredToday: await this.repository.countDeliveredSince(row.recipientId, shanghaiDayStart(now), tx),
        nextDayStartMinute: this.config.env.NOTIFY_DAILY_WINDOW_START_MINUTE,
      });
      if (decision.deliver) {
        await this.repository.markDelivered(row.id, now, tx);
      } else {
        this.logger.log(
          "通知静默排期（" + decision.reason + "）：#" + row.id + " → " + decision.deliverAt.toISOString(),
        );
        await this.repository.postpone(row.id, decision.deliverAt, now, tx);
      }
      return { duplicate: false };
    });
  }

  /**
   * 延迟投递排空（worker 常驻循环）：领取 `deliver_at` 到期的未投递主行，逐条重排（合并 → 投递 / 再排期）。
   * 单行失败只记日志（下一轮重排，不阻塞其余行）；单轮条数由 NOTIFY_FLUSH_BATCH 收敛。
   */
  async flushDue(): Promise<NotifyFlushStats> {
    const now = this.clock.now();
    const due = await this.repository.listDue(now, this.config.env.NOTIFY_FLUSH_BATCH);
    const stats: NotifyFlushStats = { scanned: due.length, delivered: 0, merged: 0, postponed: 0 };
    for (const row of due) {
      try {
        const prefs = await this.resolvePrefs(row.recipientId);
        const outcome = await this.database.db.transaction(async (tx) => {
          if (await this.tryMerge(row, prefs, now, tx)) {
            return "merged" as const;
          }
          const decision = planDelivery({
            now,
            quiet: prefs.quiet,
            dailyLimit: prefs.dailyLimit,
            deliveredToday: await this.repository.countDeliveredSince(row.recipientId, shanghaiDayStart(now), tx),
            nextDayStartMinute: this.config.env.NOTIFY_DAILY_WINDOW_START_MINUTE,
          });
          if (decision.deliver) {
            await this.repository.markDelivered(row.id, now, tx);
            return "delivered" as const;
          }
          await this.repository.postpone(row.id, decision.deliverAt, now, tx);
          return "postponed" as const;
        });
        stats[outcome] += 1;
      } catch (error) {
        this.logger.error("通知延迟投递失败（下一轮重排）：#" + row.id + " —— " + messageOf(error));
      }
    }
    return stats;
  }

  /** 合并判定：命中同人同键、窗口内的未读主行 → 并入（子行留档 + 主行计数自增）。 */
  private async tryMerge(
    row: NotifyMessageRow,
    prefs: ResolvedNotifyPrefs,
    now: Date,
    tx: DbClient,
  ): Promise<boolean> {
    if (prefs.mergeWindowMs <= 0) {
      return false;
    }
    const target = await this.repository.findMergeTarget(
      {
        recipientId: row.recipientId,
        mergeKey: row.mergeKey,
        since: new Date(now.getTime() - prefs.mergeWindowMs),
        excludeId: row.id,
      },
      tx,
    );
    if (target === null) {
      return false;
    }
    await this.repository.attachMerged({ childId: row.id, parentId: target.id, at: now }, tx);
    return true;
  }

  /** 收件箱清单（C5-01 / C5-02）：状态 / 类型 / 关联对象 + 投递时刻区间 + 分页；随行未读角标。 */
  async list(actorId: string, query: NotificationListQuery): Promise<NotificationListResponse> {
    const from = query.from === undefined ? null : new Date(query.from);
    const to = query.to === undefined ? null : new Date(query.to);
    if (from !== null && to !== null && from.getTime() > to.getTime()) {
      throw new AppError("VALIDATION_FAILED", "投递时刻区间非法：from 必须早于（或等于）to");
    }
    const filter: NotifyInboxFilter = {
      status: query.status ?? null,
      type: query.type ?? null,
      refType: query.refType ?? null,
      from,
      to,
      page: query.page,
      limit: query.limit,
    };
    const { rows, total } = await this.repository.listInbox(actorId, filter);
    const unreadCount = await this.repository.countUnread(actorId);
    return { items: rows.map(toContract), page: query.page, limit: query.limit, total, unreadCount };
  }

  /** 标记状态（C5-01）：幂等；仅本人已投递主行（他人 / 合并子行 / 未投递行统一 404 防 IDOR）。 */
  async mark(actorId: string, id: number, status: string): Promise<Notification> {
    const existing = await this.repository.findByIdForRecipient(id, actorId);
    if (existing === null || existing.mergedIntoId !== null || existing.deliveredAt === null) {
      throw new AppError("NOT_FOUND", "通知不存在：" + id);
    }
    const updated = await this.repository.markStatus(id, status, this.clock.now());
    return toContract(updated);
  }

  /** 全部标记已读（C5-01）：只动本人已投递未读主行；幂等（无未读时 updated=0）。 */
  async markAllRead(actorId: string): Promise<NotificationMarkAllReadResponse> {
    const at = this.clock.now();
    const updated = await this.repository.markAllRead(actorId, at);
    const unreadCount = await this.repository.countUnread(actorId);
    return { updated, unreadCount };
  }

  /** 通知偏好（生效值）：个人配置缺省时回退 env（NOTIFY_QUIET_HOURS / NOTIFY_DAILY_LIMIT / NOTIFY_MERGE_WINDOW_MS）。 */
  async getPrefs(actorId: string): Promise<NotifyPrefs> {
    return this.toPrefs(await this.repository.getPrefs(actorId));
  }

  /** 更新通知偏好（局部更新：只写传入键；空更新 400）；quietHours 三态 default / off / HH:MM-HH:MM。 */
  async updatePrefs(actorId: string, body: NotifyPrefsUpdateBody): Promise<NotifyPrefs> {
    if (Object.keys(body).length === 0) {
      throw new AppError(
        "VALIDATION_FAILED",
        "更新内容为空：至少传入一个变更键（quietHours / dailyLimit / mergeWindowMs）",
      );
    }
    const patch: NotifyPrefsPatch = {};
    if (body.quietHours !== undefined) {
      patch.quietHours = body.quietHours === "default" ? null : body.quietHours === "off" ? "" : body.quietHours;
    }
    if (body.dailyLimit !== undefined) {
      patch.dailyLimit = body.dailyLimit;
    }
    if (body.mergeWindowMs !== undefined) {
      patch.mergeWindowMs = body.mergeWindowMs;
    }
    const row = await this.repository.upsertPrefs(actorId, patch, this.clock.now());
    return this.toPrefs(row);
  }

  /** 生效偏好解析：行内值 → env 缺省回退（quiet 三态：null 继承 / '' 关闭 / 自定义）。 */
  private async resolvePrefs(userId: string): Promise<ResolvedNotifyPrefs> {
    const row = await this.repository.getPrefs(userId);
    const effectiveQuiet = row?.quietHours ?? this.config.env.NOTIFY_QUIET_HOURS;
    return {
      quiet: parseQuietHours(effectiveQuiet),
      dailyLimit: row?.dailyLimit ?? this.config.env.NOTIFY_DAILY_LIMIT,
      mergeWindowMs: row?.mergeWindowMs ?? this.config.env.NOTIFY_MERGE_WINDOW_MS,
    };
  }

  /** 行 → 契约读面（quietFrom / quietTo 为生效值；配置态回显 quietHours 三态）。 */
  private toPrefs(row: NotifyPrefsRow | null): NotifyPrefs {
    const quietHours = row?.quietHours ?? "default";
    const effective = row?.quietHours ?? this.config.env.NOTIFY_QUIET_HOURS;
    const quiet = parseQuietHours(effective);
    return {
      quietHours: quietHours === "" ? "off" : quietHours,
      quietFrom: quiet === null ? null : formatClockMinute(quiet.fromMinute),
      quietTo: quiet === null ? null : formatClockMinute(quiet.toMinute),
      dailyLimit: row?.dailyLimit ?? this.config.env.NOTIFY_DAILY_LIMIT,
      mergeWindowMs: row?.mergeWindowMs ?? this.config.env.NOTIFY_MERGE_WINDOW_MS,
      updatedAt: row === null ? null : row.updatedAt.toISOString(),
    };
  }
}

/** 行 → 契约（收件箱条目；deliveredAt 在服务层已保证非空）。 */
function toContract(row: NotifyMessageRow): Notification {
  return {
    id: row.id,
    type: row.type as Notification["type"],
    title: row.title,
    body: row.body,
    status: row.status as Notification["status"],
    refType: row.refType,
    refId: row.refId,
    templateCode: row.templateCode,
    mergedCount: row.mergedCount,
    // S8-3 契约扩字段（稍后提醒）：实现刀 M5-04-2（迁移 0045）落地前恒 null。
    snoozeUntil: null,
    deliveredAt: (row.deliveredAt ?? row.deliverAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
