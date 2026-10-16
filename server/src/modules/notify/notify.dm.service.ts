/**
 * 单聊 aibot 投递消费 + 绑定码 ingest（M5-03-5-3 实现段 · M5-03-5-6 绑定码链路；
 * outbox 主题 `notify.message` 的 channel=wecom_aibot 分支；生产路由 / 产出接线 / worker 回调分流随 M5-03-5-4）。
 *
 * 寻址口径（M5-03-5-6 · 口径 §7 核心变更）：发送地址 = 绑定行 `wecom_aibot_dm_activations.wecom_userid`
 * （回调 from.userid 原文 = 密文 open_userid，按 `bot_id` = 当前机器人取）；**无绑定行 → 不发帧**，按
 * permanent 收口（dead + C5-04 降级 · D4 未绑定话术）。`users.username`（明文）不再参与单聊寻址。
 *
 * 一次消费 = 解析载荷 → 读收件人 → 读绑定行（寻址 + 是否可投递）→ 组装 markdown（截断）
 * → 读激活表（846607 分流依据 + 旁证回填判重）→ `WecomAibotClient.sendUserMarkdown` → 三分类收敛 +
 * 投递留痕（notify_deliveries · channel=wecom_aibot、target=userid）：
 *   ok                                 → done（sent 行；发送成功旁证回填激活表 —— D4，失败只 warn 不影响 done）；
 *   rate_limited（本地桶 / 846607 命中激活表）→ deferred（deferred 行；availableAt = retryAt ?? now+60s；不消耗重试次数）；
 *   retryable（断连 / 未订阅 / 回执超时） → retry（failed 行）；
 *   permanent（853000 / 846601 / 846607 未命中激活表）→ dead（dead 行）+ C5-04 降级（同收件人站内信）；
 *   收件人不可投递（不存在 / 停用 / 离职 / 未绑定企微）→ 不发帧，按 permanent 收口（同 app 口径：用户存在即降级）。
 *
 * C5-04 降级：经 `NotifyService.deliverInboxCopy` —— 站内信行走同一落行 / 合并 / 免打扰 / 实时流口径；
 * 幂等键 = 来源 dedupeKey + ":c504"。未绑定企微（无绑定行）/ 846607 未命中激活表 = 无可用地址的确定性失败
 * → 降级前缀附绑定指引话术（**D4 定稿 2026-10-16**：「当前用户未绑定企业微信，请前往设置补绑」）；其余失败用通用前缀。降级写库失败 →
 * retry 收敛（有界重试，不静默丢消息）。管理员告警群留痕由 outbox 死信告警自动承担（dispatcher → OUTBOX_ALERT_SINK）。
 *
 * 绑定码链路（M5-03-5-6 · 口径 §3 / §5）：`requestBindingCode`（取码）/ `ingestCallback`（单聊发码 →
 * 同事务写绑定 + 标记码已用 → 会话内回执 `aibot_respond_msg`）/ `getBindingState`（读绑定态）。
 * 解绑 / 换绑入 `audit_logs`（D6）属 admin 审计口径（wmj 线）—— 与本刀未落的契约端点同批对齐。
 *
 * 超长口径（B5 定案 · 同群口径）：markdown 按 UTF-8 字节截断（≤ 20000 字节，留 20480 官方上限余量），
 * 尾部省略 + warn 留痕。免打扰口径同 M5-03-3（不做投递前 DND 过滤）。安全：userid 只进库与限速桶摘要；
 * 日志 / outbox error 一律掩码（末 4 位）。
 */
import { randomInt } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { NotifyMessagePayload } from "@libiaolink/contracts";
import { AppConfig } from "../../config/config.module.js";
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
 * 未绑定企微降级前缀（**D4 定稿 2026-10-16** · 口径 §6 / §10 —— 替换原 B6「请私发任意消息激活」：
 * 绑定码口径下「随便发条消息」不再产生可投递地址）。触发 = 收件人无绑定行（不发帧即判 permanent），
 * 以及兜底的「846607 且未命中激活表」分支；其余 permanent 失败用通用前缀，不误导用户去绑定。
 */
export const DM_BINDING_DEGRADE_PREFIX =
  "【企微未送达，已转站内信】\n" +
  "当前用户未绑定企业微信，请前往设置补绑\n\n";

/** 单聊 userid 字符集（同激活表 CHECK `^[A-Za-z0-9_.@-]{1,64}$`）—— 回调脏数据防御，不替代 DB 约束。 */
const DM_USERID_PATTERN = /^[A-Za-z0-9_.@-]{1,64}$/;

/** 绑定码形态（D3 定案：6 位数字）—— 与迁移 0055 CHECK `^[0-9]{6}$` 同口径。 */
export const DM_BINDING_CODE_PATTERN = /^[0-9]{6}$/;

/** 绑定码有效期（D3 定案：TTL 10 分钟）。 */
export const DM_BINDING_CODE_TTL_MS = 10 * 60_000;

/** 绑定码生成频率上限（D3 定案：3 次/小时/用户）。 */
export const DM_BINDING_CODE_MAX_PER_HOUR = 3;

/** 绑定码生成冲突重试次数（6 位数字空间 1e6，撞码概率极低；到顶抛错由调用方按 5xx 收口）。 */
const DM_BINDING_CODE_ATTEMPTS = 8;

/** 会话内回执话术（口径 §5 反馈面；未命中任何码 → 不回复，防探测）。 */
export const DM_BINDING_REPLY_BOUND = "绑定成功";
export const DM_BINDING_REPLY_INVALID = "码已失效，请重新获取";
export const DM_BINDING_REPLY_ALREADY_BOUND = "已绑定";

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

/**
 * 正文归一取码（口径 §5）：trim → 去群聊 `@<机器人名>` 前缀（单聊无此形态，容错用）→ 提取 6 位数字
 * （前后不接数字，避免从长数字串里截半）。正文只在本函数内短暂持有：不入库、不落日志（CONTRIBUTING §12）；
 * 未命中 = null（调用方按「登记激活 + 不回复」收口）。
 */
export function extractBindingCode(text: string): string | null {
  const normalized = text.trim().replace(/^@\S+\s+/, "");
  const matched = /(?<!\d)([0-9]{6})(?!\d)/.exec(normalized);
  return matched === null ? null : (matched[1] ?? null);
}

/** 6 位数字绑定码（随机；唯一性由 DB 唯一索引保证，撞码由调用方换码重试）。 */
function randomBindingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
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
    private readonly config: AppConfig,
  ) {}

  /** 当前机器人维度（WECOM_BOT_ID 原文）：激活表 / 绑定码一律按 (bot_id, …) 成对读写（D2 定案）。 */
  private botId(): string {
    return this.config.env.WECOM_BOT_ID;
  }

  /**
   * 单聊回调 ingest（M5-03-5-6 · 口径 §5；长连接 `onMessage` 接线在 entry/worker.ts）：
   * ① 过滤：仅 cmd=aibot_msg_callback 且 chattype=single 且 from.userid 合法；事件回调（enter_chat 等）与
   *    群聊一律不处理（群聊不绑定 —— 防「发到群里以为绑定成功」）；
   * ② 登记（D1）：任何单聊消息都写激活登记（刷新 last_message_at，不动 user_id / bound_at）—— 保留 846607
   *    分流与观测，但该行不可作发送地址；
   * ③ 取码：非文本消息 / 正文不含 6 位数字 → 到此为止（不回复 —— 防探测）；
   * ④ 已绑定（含回调重复投递）→ 回「已绑定」（幂等）；
   * ⑤ 码不存在 → 不回复；码已用 / 已过期 → 回「码已失效，请重新获取」；
   * ⑥ 命中 → 同一事务写绑定行 + 标记码已用 → 回「绑定成功」。
   * 正文只做码匹配：不入库、不落日志；userid 非法（CHECK 字符集）→ 掩码 warn 忽略（防脏数据打断 ingest）。
   */
  async ingestCallback(incoming: AibotIncomingMessage): Promise<void> {
    if (incoming.cmd !== "aibot_msg_callback" || incoming.chattype !== "single" || incoming.fromUserId === null) {
      return;
    }
    const userid = incoming.fromUserId;
    if (!DM_USERID_PATTERN.test(userid)) {
      this.logger.warn("单聊回调 userid 非法（忽略，不入库）：" + maskUserid(userid));
      return;
    }
    const botId = this.botId();
    const at = this.clock.now();
    await this.repository.upsertActivationFromCallback({ botId, wecomUserid: userid, at });

    const code = incoming.msgtype === "text" && incoming.text !== null ? extractBindingCode(incoming.text) : null;
    if (code === null) {
      this.logger.log("单聊回调已登记激活（非绑定码消息 · 不可作发送地址）：userid " + maskUserid(userid));
      return;
    }
    const bound = await this.repository.findBindingByWecomUserid(userid, botId);
    if (bound !== null) {
      this.logger.log("单聊绑定码命中但该企微号已绑定（幂等，不换绑）：userid " + maskUserid(userid));
      await this.replyToCallback(incoming, userid, DM_BINDING_REPLY_ALREADY_BOUND);
      return;
    }
    const codeRow = await this.repository.findBindingCode(code);
    if (codeRow === null) {
      this.logger.log("单聊正文未命中绑定码（不回复 —— 防探测）：userid " + maskUserid(userid));
      return;
    }
    if (codeRow.status !== "pending" || codeRow.expiresAt.getTime() <= at.getTime()) {
      this.logger.warn("单聊绑定码不可用（已用 / 已过期）：userid " + maskUserid(userid) + " · code#" + String(codeRow.id));
      await this.replyToCallback(incoming, userid, DM_BINDING_REPLY_INVALID);
      return;
    }
    const boundOk = await this.repository.bindWithCode({
      codeId: codeRow.id,
      userId: codeRow.userId,
      botId,
      wecomUserid: userid,
      at,
    });
    if (!boundOk) {
      this.logger.warn("单聊绑定码占用失败（并发消费 / 恰过期）：userid " + maskUserid(userid) + " · code#" + String(codeRow.id));
      await this.replyToCallback(incoming, userid, DM_BINDING_REPLY_INVALID);
      return;
    }
    this.logger.log("单聊绑定成功（绑定行 = bot_id + userid 掩码）：userid " + maskUserid(userid) + " · user_id " + codeRow.userId);
    await this.replyToCallback(incoming, userid, DM_BINDING_REPLY_BOUND);
  }

  /**
   * 会话内回执（尽力而为）：回复失败只 warn，不影响绑定结果（绑定已落库，用户可在设置页看到绑定态）；
   * 缺 req_id（回调异常）→ 不回复（单聊回调无 chatid，回复只能靠 req_id 透传）。
   */
  private async replyToCallback(incoming: AibotIncomingMessage, userid: string, content: string): Promise<void> {
    if (incoming.reqId === null) {
      this.logger.warn("回调缺 req_id，跳过会话内回执：userid " + maskUserid(userid));
      return;
    }
    try {
      const result = await this.aibot.replyToCallback({ reqId: incoming.reqId, userid, content });
      if (!result.ok) {
        this.logger.warn("会话内回执未送达（不影响绑定结果）：userid " + maskUserid(userid) + " —— " + describeDmFailure(result));
      }
    } catch (error) {
      this.logger.warn("会话内回执异常（不影响绑定结果）：userid " + maskUserid(userid) + " —— " + messageOf(error));
    }
  }

  /**
   * 生成绑定码（D3 定案：6 位数字 / TTL 10 分钟 / 一次性 / 3 次每小时每用户；口径 §3 第 1 步）：
   * 频率到顶 → 返回 rate_limited + retryAt（窗口内最早码 + 1 小时 = 最早的可用时刻）；
   * 否则同一事务作废旧 pending 码 + 插入新码（撞码换码重试 DM_BINDING_CODE_ATTEMPTS 次）。
   * 端点 / 契约（生成绑定码 API）属 wmj 线 —— 本刀只落服务能力，HTTP 面待契约刀（口径 §11）。
   */
  async requestBindingCode(userId: string): Promise<
    { ok: true; code: string; expiresAt: Date } | { ok: false; reason: "rate_limited"; retryAt: Date }
  > {
    const at = this.clock.now();
    const since = new Date(at.getTime() - 3_600_000);
    const issuedAt = await this.repository.bindingCodesSince(userId, since);
    if (issuedAt.length >= DM_BINDING_CODE_MAX_PER_HOUR) {
      const oldest = issuedAt[0];
      const retryAt = new Date((oldest === undefined ? at.getTime() : oldest.getTime()) + 3_600_000);
      this.logger.warn("绑定码生成频率到顶（" + String(DM_BINDING_CODE_MAX_PER_HOUR) + " 次/小时）：user_id " + userId);
      return { ok: false, reason: "rate_limited", retryAt };
    }
    const expiresAt = new Date(at.getTime() + DM_BINDING_CODE_TTL_MS);
    for (let attempt = 0; attempt < DM_BINDING_CODE_ATTEMPTS; attempt += 1) {
      const code = randomBindingCode();
      if (await this.repository.createBindingCode({ userId, code, expiresAt, at })) {
        this.logger.log("绑定码已生成（TTL 10 分钟 · 旧 pending 码作废）：user_id " + userId);
        return { ok: true, code, expiresAt };
      }
    }
    throw new Error("绑定码生成失败（连续 " + String(DM_BINDING_CODE_ATTEMPTS) + " 次撞码）：user_id " + userId);
  }

  /** 绑定态读面（设置页 / 契约读端点用；口径 §6「设置页显示绑定态」）。 */
  async getBindingState(userId: string): Promise<{ bound: boolean; boundAt: Date | null }> {
    const binding = await this.repository.findBindingByUserId(userId, this.botId());
    return { bound: binding !== null, boundAt: binding === null ? null : binding.boundAt };
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

    const botId = this.botId();
    const binding = await this.repository.findBindingByUserId(contact.id, botId);
    const blockedReason =
      contact.removedAt !== null ? "已删除（目录源删除）" : contact.status !== "active" ? "已停用" : null;
    if (blockedReason !== null) {
      const error = "收件人不可投递（" + blockedReason + "）";
      await this.repository.insertDelivery({
        outboxId: row.id,
        target: binding === null ? "user:" + contact.id : binding.wecomUserid,
        state: "dead",
        attempts: 0,
        error,
        sentAt: null,
      });
      this.logger.warn("单聊消息收件人不可投递（确定性失败转 dead）：outbox#" + row.id + " · " + row.dedupeKey + " —— " + error);
      return await this.degradeWith(message, row, error, DM_DEGRADE_PREFIX);
    }

    // 未绑定企微（无绑定行 / 绑定行未带 user_id）：不发帧，按 permanent 收口 + D4 绑定指引降级（口径 §6）。
    if (binding === null) {
      const error = "收件人未绑定企业微信（无可投递地址）";
      await this.repository.insertDelivery({
        outboxId: row.id,
        target: "user:" + contact.id,
        state: "dead",
        attempts: 0,
        error,
        sentAt: null,
      });
      this.logger.warn("单聊消息收件人未绑定企微（确定性失败转 dead · 不发帧）：outbox#" + row.id + " · " + row.dedupeKey + " —— " + error);
      return await this.degradeWith(message, row, error, DM_BINDING_DEGRADE_PREFIX);
    }

    const userid = binding.wecomUserid;
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
    const activation = await this.repository.findActivation(userid, botId);
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
    const prefix = result.errcode === WECOM_BOT_FREQ_ERRCODE ? DM_BINDING_DEGRADE_PREFIX : DM_DEGRADE_PREFIX;
    return await this.degradeWith(message, row, error, prefix);
  }

  /** D4 旁证回填：发送成功 = 该 userid 已激活；写库失败只 warn（旁证非关键路径，不影响 done）。 */
  private async backfillActivation(userId: string, userid: string): Promise<void> {
    try {
      await this.repository.backfillActivationOnSend({ botId: this.botId(), wecomUserid: userid, userId, at: this.clock.now() });
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
