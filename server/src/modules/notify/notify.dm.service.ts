/**
 * 单聊 aibot 投递消费（M5-03-5-3 实现段 · outbox 主题 `notify.message` 的 channel=wecom_aibot 分支；
 * 生产路由 / 产出接线 / worker 回调分流均随 M5-03-5-4）。
 *
 * 一次消费 = 解析载荷 → 解析 userid（`users.username`，同 app 面口径）→ 组装 markdown（截断）
 * → 读激活表（846607 分流依据 + 旁证回填判重）→ `WecomAibotClient.sendUserMarkdown` → 三分类收敛 +
 * 投递留痕（notify_deliveries · channel=wecom_aibot、target=userid）：
 *   ok                                 → done（sent 行；发送成功旁证回填激活表 —— D4，失败只 warn 不影响 done）；
 *   rate_limited（本地桶 / 846607 命中激活表）→ deferred（deferred 行；availableAt = retryAt ?? now+60s；不消耗重试次数）；
 *   retryable（断连 / 未订阅 / 回执超时） → retry（failed 行）；
 *   permanent（853000 / 846601 / 846607 未命中激活表）→ dead（dead 行）+ C5-04 降级（同收件人站内信）；
 *   收件人不可投递（不存在 / 停用 / 离职 / userid 缺失）→ 不发帧，按 permanent 收口（同 app 口径：用户存在即降级）。
 *
 * C5-04 降级：经 `NotifyService.deliverInboxCopy` —— 站内信行走同一落行 / 合并 / 免打扰 / 实时流口径；
 * 幂等键 = 来源 dedupeKey + ":c504"。846607 未命中激活表 = 未激活确定性失败 → 降级前缀附激活指引
 * 话术（P3 定案 2026-10-14；话术终稿 2026-10-15 自运营项回填 —— 计划 §6 · Push 239）；其余失败用通用前缀。降级写库失败 →
 * retry 收敛（有界重试，不静默丢消息）。管理员告警群留痕由 outbox 死信告警自动承担（dispatcher → OUTBOX_ALERT_SINK）。
 *
 * 超长口径（B5 定案 · 同群口径）：markdown 按 UTF-8 字节截断（≤ 20000 字节，留 20480 官方上限余量），
 * 尾部省略 + warn 留痕。免打扰口径同 M5-03-3（不做投递前 DND 过滤）。安全：userid 只进库与限速桶摘要；
 * 日志 / outbox error 一律掩码（末 4 位）。
 */
import { Injectable, Logger } from "@nestjs/common";
import type { NotifyMessagePayload } from "@libiaolink/contracts";
import { ClockService } from "../../common/clock/clock.service.js";
import type { OutboxClaimedRow } from "../../db/outbox.store.js";
import type { OutboxHandleOutcome } from "../../outbox/handler.js";
import { maskUserid } from "./notify.app.service.js";
import { parseNotifyMessage } from "./notify.delivery.js";
import { NotifyDmRepository } from "./notify.dm.repository.js";
import { NotifyService } from "./notify.service.js";
import type { AibotIncomingMessage, AibotSendResult } from "./wecom.aibot.js";
import { WecomAibotClient } from "./wecom.aibot.js";
import { describeWecomFailure, WECOM_BOT_FREQ_ERRCODE } from "./wecom.errors.js";
import { truncateUtf8Bytes } from "./wecom.text.js";

/** 单聊 markdown 字节上限（官方口径 20480；取 20000 留余量 —— 同群口径）。 */
export const DM_MARKDOWN_MAX_BYTES = 20_000;

/** 截断省略后缀（尾部省略口径）。 */
export const DM_TRUNCATION_SUFFIX = "\n\n…（内容过长，已截断）";

/** 降级站内信前缀（C5-04：企微失败 → 站内信；正文保留原文，前缀标注来源变化）。 */
export const DM_DEGRADE_PREFIX = "【企微未送达，已转站内信】\n\n";

/**
 * 未激活降级前缀（P3 定案 2026-10-14；话术终稿 2026-10-15 自运营项回填 —— 计划 §6 · Push 239）。
 * 触发 = 846607 且未命中激活表（确定性未激活）；其余 permanent 失败用通用前缀，不误导用户去激活。
 */
export const DM_ACTIVATION_DEGRADE_PREFIX =
  "【企微未送达，已转站内信】\n" +
  "当前机器人未激活，请私发任意消息给机器人即可激活。\n\n";

/** 单聊 userid 字符集（同激活表 CHECK `^[A-Za-z0-9_.@-]{1,64}$`）—— 回调脏数据防御，不替代 DB 约束。 */
const DM_USERID_PATTERN = /^[A-Za-z0-9_.@-]{1,64}$/;

/** markdown 组装（同群口径）：加粗标题 + 空行 + 正文；标题空白防御（解析后已 trim，非空为常态）。 */
export function composeDmMarkdown(message: Pick<NotifyMessagePayload, "title" | "body">): string {
  const title = message.title.trim();
  return title === "" ? message.body : "**" + title + "**\n\n" + message.body;
}

/** UTF-8 字节截断（不劈开多字节字符）：未超长原样返回；超长截到 maxBytes - 后缀，尾部拼省略标记。 */
export function truncateDmMarkdown(content: string, maxBytes: number = DM_MARKDOWN_MAX_BYTES): {
  content: string;
  truncated: boolean;
} {
  return truncateUtf8Bytes(content, maxBytes, DM_TRUNCATION_SUFFIX);
}

/** 失败描述（核心语义：errcode + 白话标签 / errmsg 概要；不含 kind / state 内部态与企微机器尾巴；不含 userid 明文）。 */
function describeDmFailure(result: Extract<AibotSendResult, { ok: false }>): string {
  return "单聊消息未送达" + describeWecomFailure(result.errcode, result.errmsg);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 单聊 aibot 消费服务（worker 注册表 · 由 OutboxModule 按载荷 channel 路由 —— 接线随 M5-03-5-4）：
 * handler 只做业务与分类，outbox 回写统一由 dispatcher 收敛；任何异常都不外抛（同 NotifyAppService 口径）。
 */
@Injectable()
export class NotifyDmService {
  private readonly logger = new Logger(NotifyDmService.name);

  constructor(
    private readonly repository: NotifyDmRepository,
    private readonly aibot: WecomAibotClient,
    private readonly notify: NotifyService,
    private readonly clock: ClockService,
  ) {}

  /**
   * 单聊消息回调 ingest（长连接 `onMessage` 接线随 M5-03-5-4）：cmd=aibot_msg_callback 且 chattype=single
   * 且 from.userid 非空 → 激活 upsert（幂等；enter_chat 等事件不激活 —— 实测口径，计划 §3.2）。
   * 未匹配本地用户（users.username 反查）→ user_id 留空登记 + 掩码 warn（该行仍可作「已激活」判据）；
   * userid 非法（CHECK 字符集）→ 掩码 warn 忽略（不入库，防脏数据打断 ingest）。
   */
  async activateFromCallback(incoming: AibotIncomingMessage): Promise<void> {
    if (incoming.cmd !== "aibot_msg_callback" || incoming.chattype !== "single" || incoming.fromUserId === null) {
      return;
    }
    const userid = incoming.fromUserId;
    if (!DM_USERID_PATTERN.test(userid)) {
      this.logger.warn("单聊回调 userid 非法（忽略，不入库）：" + maskUserid(userid));
      return;
    }
    const userId = await this.repository.findUserIdByUsername(userid);
    if (userId === null) {
      this.logger.warn("单聊回调未匹配本地用户（user_id 留空登记；userid " + maskUserid(userid) + "）");
    }
    await this.repository.upsertActivationFromCallback({ wecomUserid: userid, userId, at: this.clock.now() });
    this.logger.log("单聊激活已登记（upsert）：userid " + maskUserid(userid) + (userId === null ? "（未匹配用户）" : ""));
  }

  async consume(row: OutboxClaimedRow): Promise<OutboxHandleOutcome> {
    const message = parseNotifyMessage(row.payload);
    if (message === null) {
      this.logger.warn("单聊消息载荷非法，转 dead：outbox#" + row.id + "（" + row.dedupeKey + "）");
      return {
        outcome: "dead",
        error: "单聊消息载荷非法（缺 recipientId / title / body 或超长）：" + row.dedupeKey,
      };
    }
    if (message.channel !== "wecom_aibot") {
      const channel = message.channel;
      this.logger.warn("单聊消息消费渠道异常（渠道路由异常转 dead）：outbox#" + row.id + " · channel=" + channel);
      return {
        outcome: "dead",
        error: "单聊消息消费渠道异常（期望 wecom_aibot，实得 " + channel + "）：" + row.dedupeKey,
      };
    }

    const contact = await this.repository.findContact(message.recipientId);
    if (contact === null) {
      // 用户不存在：站内信 FK 同样不可落 —— 不降级（无收件人可降），dead 一次即弃（同 app 口径）。
      await this.repository.insertDelivery({
        outboxId: row.id,
        target: "user:" + message.recipientId,
        state: "dead",
        attempts: 0,
        error: "收件人不存在（无法降级站内信）",
        sentAt: null,
      });
      this.logger.warn("单聊消息收件人不存在（确定性失败转 dead，不降级）：outbox#" + row.id + " · " + row.dedupeKey);
      return { outcome: "dead", error: "单聊消息收件人不存在（无法降级站内信）：" + row.dedupeKey };
    }

    const userid = contact.username.trim();
    const blockedReason =
      contact.removedAt !== null ? "已删除（目录源删除）" : contact.status !== "active" ? "已停用" : userid === "" ? "userid 缺失" : null;
    if (blockedReason !== null) {
      const error = "收件人不可投递（" + blockedReason + "）";
      await this.repository.insertDelivery({
        outboxId: row.id,
        target: userid === "" ? "user:" + contact.id : userid,
        state: "dead",
        attempts: 0,
        error,
        sentAt: null,
      });
      this.logger.warn("单聊消息收件人不可投递（确定性失败转 dead）：outbox#" + row.id + " · " + row.dedupeKey + " —— " + error);
      return await this.degradeWith(message, row, error, DM_DEGRADE_PREFIX);
    }

    const composed = composeDmMarkdown(message);
    const { content, truncated } = truncateDmMarkdown(composed);
    if (truncated) {
      this.logger.warn(
        "单聊消息超字节上限已截断（" +
          String(Buffer.byteLength(composed, "utf8")) +
          " → " +
          String(Buffer.byteLength(content, "utf8")) +
          " 字节）：outbox#" +
          row.id +
          " · userid " +
          maskUserid(userid),
      );
    }

    // 激活态读（846607 双语义分流依据；D4 —— 不做投递前拦截，未命中仍尝试发送）。
    const activation = await this.repository.findActivation(userid);
    const result = await this.aibot.sendUserMarkdown({ userid, content, dmActivated: activation !== null });

    if (result.ok) {
      await this.repository.insertDelivery({
        outboxId: row.id,
        target: userid,
        state: "sent",
        attempts: result.attempts,
        error: null,
        sentAt: this.clock.now(),
      });
      this.logger.log("单聊消息已受理：" + row.dedupeKey + " · userid " + maskUserid(userid) + (truncated ? "（截断发送）" : ""));
      if (activation === null || activation.userId === null) {
        await this.backfillActivation(contact.id, userid);
      }
      return { outcome: "done" };
    }

    const error = describeDmFailure(result);
    if (result.kind === "rate_limited") {
      const availableAt = result.retryAt ?? new Date(this.clock.now().getTime() + 60_000);
      await this.repository.insertDelivery({
        outboxId: row.id,
        target: userid,
        state: "deferred",
        attempts: result.attempts,
        error,
        sentAt: null,
      });
      return { outcome: "deferred", availableAt, error };
    }
    if (result.kind === "retryable") {
      await this.repository.insertDelivery({
        outboxId: row.id,
        target: userid,
        state: "failed",
        attempts: result.attempts,
        error,
        sentAt: null,
      });
      return { outcome: "retry", error };
    }
    // permanent（853000 / 846601 / 846607 未命中激活表）：dead + C5-04 降级（未激活附激活指引前缀 —— P3）。
    await this.repository.insertDelivery({
      outboxId: row.id,
      target: userid,
      state: "dead",
      attempts: result.attempts,
      error,
      sentAt: null,
    });
    this.logger.warn("单聊消息确定性失败（转 dead）：" + row.dedupeKey + " · userid " + maskUserid(userid) + " —— " + error);
    const prefix = result.errcode === WECOM_BOT_FREQ_ERRCODE ? DM_ACTIVATION_DEGRADE_PREFIX : DM_DEGRADE_PREFIX;
    return await this.degradeWith(message, row, error, prefix);
  }

  /** D4 旁证回填：发送成功 = 该 userid 已激活；写库失败只 warn（旁证非关键路径，不影响 done）。 */
  private async backfillActivation(userId: string, userid: string): Promise<void> {
    try {
      await this.repository.backfillActivationOnSend({ wecomUserid: userid, userId, at: this.clock.now() });
    } catch (error) {
      this.logger.warn("单聊发送成功旁证回填激活表失败（忽略；userid " + maskUserid(userid) + "）：" + messageOf(error));
    }
  }

  /**
   * C5-04 降级：企微失败 → 同收件人站内信（NotifyService.deliverInboxCopy 同口径；幂等键后缀 ":c504"）；
   * 降级写库失败 → retry 收敛（有界重试；不静默丢消息）。
   */
  private async degradeWith(
    message: NotifyMessagePayload,
    row: OutboxClaimedRow,
    error: string,
    prefix: string,
  ): Promise<OutboxHandleOutcome> {
    try {
      await this.notify.deliverInboxCopy(
        { ...message, body: prefix + message.body },
        row.topic,
        row.dedupeKey + ":c504",
      );
      this.logger.warn("单聊消息失败已降级站内信：" + row.dedupeKey + " —— " + error);
      return { outcome: "dead", error };
    } catch (degradeError) {
      const detail = messageOf(degradeError);
      this.logger.error("单聊消息降级站内信失败（按可重试收敛）：" + row.dedupeKey + " —— " + detail);
      return { outcome: "retry", error: error + " / 降级站内信失败：" + detail };
    }
  }
}
