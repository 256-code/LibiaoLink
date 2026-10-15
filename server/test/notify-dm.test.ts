/**
 * 单聊 aibot 消费回归（M5-03-5-3 实现段 · outbox 主题 notify.message 的 channel=wecom_aibot 分支）：
 * markdown 组装与字节截断、消费三分类（ok / rate_limited / retryable / permanent → done / deferred /
 * retry / dead + 投递留痕）、激活表读（846607 分流传入态）与发送成功旁证回填（D4）、C5-04 降级
 * （同收件人站内信 · :c504 · 未激活附激活指引前缀 P3）、收件人不可投递收敛、渠道路由防御、回调 ingest
 * （激活 upsert · 未匹配留空 · enter_chat 不激活）。仓储 / 长连接客户端 / 站内信 / 时钟全替身，不连库、不发帧。
 */
import { describe, expect, it } from "vitest";
import type { NotifyMessagePayload } from "@libiaolink/contracts";
import { ClockService } from "../src/common/clock/clock.service.js";
import type { OutboxClaimedRow } from "../src/db/outbox.store.js";
import type { DmActivationRow, NotifyDmDeliveryInsert, WecomDmContact } from "../src/modules/notify/notify.dm.repository.js";
import {
  composeDmMarkdown,
  DM_ACTIVATION_DEGRADE_PREFIX,
  DM_DEGRADE_PREFIX,
  DM_MARKDOWN_MAX_BYTES,
  DM_TRUNCATION_SUFFIX,
  NotifyDmService,
  truncateDmMarkdown,
} from "../src/modules/notify/notify.dm.service.js";
import type { AibotIncomingMessage, AibotSendResult, WecomAibotClient } from "../src/modules/notify/wecom.aibot.js";

const AT = new Date("2026-10-14T06:00:00.000Z");
const BEFORE = new Date("2026-10-14T05:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const USERID = "zhangsan";

class FakeDmRepository {
  contacts = new Map<string, WecomDmContact>();
  activations = new Map<string, DmActivationRow>();
  deliveries: NotifyDmDeliveryInsert[] = [];
  upsertCalls: { wecomUserid: string; userId: string | null; at: Date }[] = [];
  backfillCalls: { wecomUserid: string; userId: string; at: Date }[] = [];
  backfillFails = false;
  /** username → 本地用户 id（反查替身）。 */
  usernames = new Map<string, string>();

  async findContact(userId: string): Promise<WecomDmContact | null> {
    return this.contacts.get(userId) ?? null;
  }

  async findUserIdByUsername(username: string): Promise<string | null> {
    return this.usernames.get(username) ?? null;
  }

  async findActivation(wecomUserid: string): Promise<DmActivationRow | null> {
    return this.activations.get(wecomUserid) ?? null;
  }

  async upsertActivationFromCallback(input: { wecomUserid: string; userId: string | null; at: Date }): Promise<void> {
    this.upsertCalls.push(input);
    const existing = this.activations.get(input.wecomUserid);
    this.activations.set(input.wecomUserid, {
      wecomUserid: input.wecomUserid,
      userId: existing?.userId ?? input.userId,
      firstActivatedAt: existing?.firstActivatedAt ?? input.at,
      lastMessageAt: input.at,
    });
  }

  async backfillActivationOnSend(input: { wecomUserid: string; userId: string; at: Date }): Promise<void> {
    if (this.backfillFails) {
      throw new Error("fake 回填写库失败");
    }
    this.backfillCalls.push(input);
    const existing = this.activations.get(input.wecomUserid);
    this.activations.set(input.wecomUserid, {
      wecomUserid: input.wecomUserid,
      userId: existing?.userId ?? input.userId,
      firstActivatedAt: existing?.firstActivatedAt ?? input.at,
      lastMessageAt: existing?.lastMessageAt ?? input.at,
    });
  }

  async insertDelivery(input: NotifyDmDeliveryInsert): Promise<void> {
    this.deliveries.push(input);
  }
}

class FakeAibot {
  sends: { userid: string; content: string; dmActivated?: boolean | null }[] = [];
  result: AibotSendResult = { ok: true, attempts: 1 };

  async sendUserMarkdown(params: {
    userid: string;
    content: string;
    dmActivated?: boolean | null;
  }): Promise<AibotSendResult> {
    this.sends.push(params);
    return this.result;
  }
}

/** C5-04 降级站内信替身（NotifyService.deliverInboxCopy 端口）。 */
class FakeNotifyInbox {
  copies: { message: NotifyMessagePayload; topic: string; dedupeKey: string }[] = [];
  fail = false;

  async deliverInboxCopy(
    message: NotifyMessagePayload,
    topic: string,
    dedupeKey: string,
  ): Promise<{ duplicate: boolean }> {
    if (this.fail) {
      throw new Error("fake 站内信写库失败");
    }
    this.copies.push({ message, topic, dedupeKey });
    return { duplicate: false };
  }
}

function makeService(): {
  service: NotifyDmService;
  repo: FakeDmRepository;
  aibot: FakeAibot;
  inbox: FakeNotifyInbox;
} {
  const repo = new FakeDmRepository();
  const aibot = new FakeAibot();
  const inbox = new FakeNotifyInbox();
  const clock = new ClockService();
  clock.setSource(() => AT);
  const service = new NotifyDmService(repo as never, aibot as unknown as WecomAibotClient, inbox as never, clock);
  return { service, repo, aibot, inbox };
}

function contact(overrides: Partial<WecomDmContact> = {}): WecomDmContact {
  return { id: USER_ID, username: USERID, status: "active", removedAt: null, ...overrides };
}

function activation(overrides: Partial<DmActivationRow> = {}): DmActivationRow {
  return { wecomUserid: USERID, userId: USER_ID, firstActivatedAt: BEFORE, lastMessageAt: BEFORE, ...overrides };
}

function claimedRow(payload: Record<string, unknown>, overrides: Partial<OutboxClaimedRow> = {}): OutboxClaimedRow {
  return {
    id: 11,
    topic: "notify.message",
    payload,
    dedupeKey: "R02:t-1:v5:aibot",
    attempts: 0,
    availableAt: AT,
    lockedAt: AT,
    createdAt: AT,
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipientId: USER_ID,
    type: "reminder",
    channel: "wecom_aibot",
    title: "任务节点完成",
    body: "节点：到货验收 负责人：张工",
    ...overrides,
  };
}

function permanent(errcode: number, errmsg: string): AibotSendResult {
  return { ok: false, kind: "permanent", errcode, errmsg, retryAt: null, attempts: 1, state: "subscribed" };
}

function incoming(overrides: Partial<AibotIncomingMessage> = {}): AibotIncomingMessage {
  return {
    cmd: "aibot_msg_callback",
    reqId: null,
    chatid: null,
    chattype: "single",
    fromUserId: USERID,
    msgid: "m1",
    ...overrides,
  };
}

// ---------- markdown 组装 / 截断（纯函数） ----------

describe("composeDmMarkdown / truncateDmMarkdown（纯函数）", () => {
  it("组装：加粗标题 + 空行 + 正文（同群口径）", () => {
    expect(composeDmMarkdown({ title: "T", body: "B" })).toBe("**T**\n\nB");
  });

  it("组装：空白标题防御（仅正文）", () => {
    expect(composeDmMarkdown({ title: "  ", body: "B" })).toBe("B");
  });

  it("截断：超长按 UTF-8 字节截断（≤ 20000 字节 + 省略标记 + 不劈多字节）", () => {
    const truncated = truncateDmMarkdown("汉".repeat(30_000));

    expect(truncated.truncated).toBe(true);
    expect(Buffer.byteLength(truncated.content, "utf8")).toBeLessThanOrEqual(DM_MARKDOWN_MAX_BYTES);
    expect(truncated.content.endsWith(DM_TRUNCATION_SUFFIX)).toBe(true);
    expect(truncated.content.includes("\uFFFD")).toBe(false);
  });

  it("截断：未超长原样返回", () => {
    expect(truncateDmMarkdown("短消息")).toEqual({ content: "短消息", truncated: false });
  });
});

// ---------- 消费三分类 ----------

describe("NotifyDmService.consume（三分类 + 留痕 + 降级 + 激活面）", () => {
  it("ok：done + sent 行（target=userid）+ 加粗标题发出 + 未命中激活表 → 旁证回填（D4）", async () => {
    const { service, repo, aibot, inbox } = makeService();
    repo.contacts.set(USER_ID, contact());

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome).toEqual({ outcome: "done" });
    expect(repo.deliveries[0]).toMatchObject({ state: "sent", target: USERID, attempts: 1, sentAt: AT, error: null });
    expect(aibot.sends[0]).toMatchObject({ userid: USERID, dmActivated: false });
    expect(aibot.sends[0]!.content).toBe("**任务节点完成**\n\n节点：到货验收 负责人：张工");
    expect(repo.backfillCalls).toEqual([{ wecomUserid: USERID, userId: USER_ID, at: AT }]);
    expect(inbox.copies).toEqual([]);
  });

  it("ok：命中激活表 → dmActivated=true 传入、不重复回填", async () => {
    const { service, repo, aibot } = makeService();
    repo.contacts.set(USER_ID, contact());
    repo.activations.set(USERID, activation());

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome).toEqual({ outcome: "done" });
    expect(aibot.sends[0]!.dmActivated).toBe(true);
    expect(repo.backfillCalls).toEqual([]);
  });

  it("ok：激活行存在但 user_id 留空（未匹配登记）→ 命中分流 + 补回填 user_id", async () => {
    const { service, repo, aibot } = makeService();
    repo.contacts.set(USER_ID, contact());
    repo.activations.set(USERID, activation({ userId: null }));

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome).toEqual({ outcome: "done" });
    expect(aibot.sends[0]!.dmActivated).toBe(true);
    expect(repo.backfillCalls).toEqual([{ wecomUserid: USERID, userId: USER_ID, at: AT }]);
  });

  it("ok：旁证回填写库失败 → 不影响 done（旁证非关键路径）", async () => {
    const { service, repo } = makeService();
    repo.contacts.set(USER_ID, contact());
    repo.backfillFails = true;

    expect(await service.consume(claimedRow(payload()))).toEqual({ outcome: "done" });
  });

  it("rate_limited：deferred + deferred 行（availableAt = retryAt；attempts 不消耗）", async () => {
    const retryAt = new Date(AT.getTime() + 30_000);
    const { service, repo, aibot } = makeService();
    repo.contacts.set(USER_ID, contact());
    aibot.result = {
      ok: false,
      kind: "rate_limited",
      errcode: null,
      errmsg: "本地限速桶已满",
      retryAt,
      attempts: 0,
      state: "subscribed",
    };

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome.outcome).toBe("deferred");
    if (outcome.outcome === "deferred") {
      expect(outcome.availableAt.getTime()).toBe(retryAt.getTime());
    }
    expect(repo.deliveries[0]).toMatchObject({ state: "deferred", attempts: 0, sentAt: null });
  });

  it("846607 命中激活表（客户端按超频分类）→ dmActivated=true + deferred（与未激活分支成对）", async () => {
    const retryAt = new Date(AT.getTime() + 60_000);
    const { service, repo, aibot } = makeService();
    repo.contacts.set(USER_ID, contact());
    repo.activations.set(USERID, activation());
    aibot.result = {
      ok: false,
      kind: "rate_limited",
      errcode: 846607,
      errmsg: "aibot send msg frequency limit exceeded",
      retryAt,
      attempts: 1,
      state: "subscribed",
    };

    const outcome = await service.consume(claimedRow(payload()));

    expect(aibot.sends[0]!.dmActivated).toBe(true);
    expect(outcome.outcome).toBe("deferred");
  });

  it("retryable（断连 / 未订阅 / 超时）：retry + failed 行", async () => {
    const { service, repo, aibot } = makeService();
    repo.contacts.set(USER_ID, contact());
    aibot.result = {
      ok: false,
      kind: "retryable",
      errcode: 846609,
      errmsg: "not subscribed",
      retryAt: null,
      attempts: 1,
      state: "subscribed",
    };

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome.outcome).toBe("retry");
    expect(repo.deliveries[0]).toMatchObject({ state: "failed", attempts: 1 });
  });

  it("permanent（853000 配置类）：dead + dead 行 + 通用前缀降级（:c504 / 标题关联保留）", async () => {
    const { service, repo, aibot, inbox } = makeService();
    repo.contacts.set(USER_ID, contact());
    aibot.result = permanent(853000, "invalid bot");

    const outcome = await service.consume(
      claimedRow(payload({ refType: "task", refId: "33333333-3333-4333-8333-333333333333", templateCode: "R02_WECOM" })),
    );

    expect(outcome.outcome).toBe("dead");
    expect(repo.deliveries[0]).toMatchObject({ state: "dead", target: USERID, error: expect.stringContaining("853000") });
    expect(inbox.copies).toHaveLength(1);
    expect(inbox.copies[0]!.topic).toBe("notify.message");
    expect(inbox.copies[0]!.dedupeKey).toBe("R02:t-1:v5:aibot:c504");
    expect(inbox.copies[0]!.message).toMatchObject({
      recipientId: USER_ID,
      type: "reminder",
      title: "任务节点完成",
      refType: "task",
      refId: "33333333-3333-4333-8333-333333333333",
    });
    expect(inbox.copies[0]!.message.body.startsWith(DM_DEGRADE_PREFIX)).toBe(true);
    expect(inbox.copies[0]!.message.body).toContain("节点：到货验收 负责人：张工");
  });

  it("permanent（846607 未命中激活表 = 未激活）：dead + 降级前缀附激活指引话术终稿（P3 · 2026-10-15）", async () => {
    const { service, repo, aibot, inbox } = makeService();
    repo.contacts.set(USER_ID, contact());
    aibot.result = permanent(846607, "aibot send msg frequency limit exceeded");

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome.outcome).toBe("dead");
    expect(aibot.sends[0]!.dmActivated).toBe(false); // 未命中激活表 → false（计划 §3.5）
    expect(repo.deliveries[0]).toMatchObject({ state: "dead", error: expect.stringContaining("846607") });
    expect(inbox.copies).toHaveLength(1);
    const body = String(inbox.copies[0]!.message.body);
    expect(body.startsWith(DM_ACTIVATION_DEGRADE_PREFIX)).toBe(true);
    expect(body).toContain("当前机器人未激活，请私发任意消息给机器人即可激活。");
    expect(body).toContain("节点：到货验收 负责人：张工");
  });

  it("收件人不存在：dead + dead 行（target=user:<id>）、不发送、不降级", async () => {
    const { service, repo, aibot, inbox } = makeService();

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome.outcome).toBe("dead");
    expect(repo.deliveries[0]).toMatchObject({ state: "dead", target: "user:" + USER_ID, attempts: 0 });
    expect(aibot.sends).toEqual([]);
    expect(inbox.copies).toEqual([]);
  });

  it("收件人停用 / 已删除 / userid 缺失：dead + dead 行 + 降级（同 app 口径：用户存在即降级）", async () => {
    const disabled = makeService();
    disabled.repo.contacts.set(USER_ID, contact({ status: "disabled" }));
    expect((await disabled.service.consume(claimedRow(payload()))).outcome).toBe("dead");
    expect(disabled.repo.deliveries[0]).toMatchObject({ state: "dead", target: USERID, error: "收件人不可投递（已停用）" });
    expect(disabled.inbox.copies).toHaveLength(1);

    const removed = makeService();
    removed.repo.contacts.set(USER_ID, contact({ removedAt: AT }));
    expect((await removed.service.consume(claimedRow(payload()))).outcome).toBe("dead");
    expect(removed.repo.deliveries[0]!.error).toContain("已删除");
    expect(removed.inbox.copies).toHaveLength(1);

    const nameless = makeService();
    nameless.repo.contacts.set(USER_ID, contact({ username: "  " }));
    expect((await nameless.service.consume(claimedRow(payload()))).outcome).toBe("dead");
    expect(nameless.repo.deliveries[0]).toMatchObject({ target: "user:" + USER_ID, error: "收件人不可投递（userid 缺失）" });
    expect(nameless.aibot.sends).toEqual([]);
    expect(nameless.inbox.copies).toHaveLength(1);
  });

  it("降级站内信写库失败：retry 收敛（不静默丢消息）", async () => {
    const { service, repo, aibot, inbox } = makeService();
    repo.contacts.set(USER_ID, contact());
    aibot.result = permanent(853000, "invalid bot");
    inbox.fail = true;

    const outcome = await service.consume(claimedRow(payload()));

    expect(outcome.outcome).toBe("retry");
    if (outcome.outcome === "retry") {
      expect(outcome.error).toContain("降级站内信失败");
    }
  });

  it("发送内容：合法上限内长正文（3000 字）逐字发出、≤ 20000 字节防御上限（截断行为另由纯函数锁）", async () => {
    const { service, repo, aibot } = makeService();
    repo.contacts.set(USER_ID, contact());

    const body = "长".repeat(3_000);
    const outcome = await service.consume(claimedRow(payload({ body })));

    expect(outcome).toEqual({ outcome: "done" });
    expect(aibot.sends[0]!.content).toBe("**任务节点完成**\n\n" + body);
    expect(Buffer.byteLength(aibot.sends[0]!.content, "utf8")).toBeLessThanOrEqual(DM_MARKDOWN_MAX_BYTES);
    // 契约 body ≤ 4000 字 → 合法载荷不会触达 20000 字节截断；上限为契约放宽时的防御（截断逐字口径见纯函数用例）
    expect(aibot.sends[0]!.content.endsWith(DM_TRUNCATION_SUFFIX)).toBe(false);
    expect(repo.deliveries[0]!.state).toBe("sent");
  });

  it("渠道路由防御：非 wecom_aibot（wecom_app）→ dead、不读联系人、不发送", async () => {
    const { service, repo, aibot } = makeService();

    const outcome = await service.consume(claimedRow(payload({ channel: "wecom_app" })));

    expect(outcome.outcome).toBe("dead");
    if (outcome.outcome === "dead") {
      expect(outcome.error).toContain("渠道异常");
    }
    expect(repo.deliveries).toEqual([]);
    expect(aibot.sends).toEqual([]);
  });

  it("非法载荷：dead、不读联系人、不发送", async () => {
    const { service, repo, aibot } = makeService();

    const outcome = await service.consume(
      claimedRow({ recipientId: USER_ID, type: "unknown", title: "t", body: "b", channel: "wecom_aibot" }),
    );

    expect(outcome.outcome).toBe("dead");
    expect(repo.deliveries).toEqual([]);
    expect(aibot.sends).toEqual([]);
  });
});

// ---------- 回调 ingest ----------

describe("NotifyDmService.activateFromCallback（单聊激活 upsert）", () => {
  it("单聊用户消息：upsert（wecom_userid = from.userid 原文 + 反查回填 user_id + 时刻）", async () => {
    const { service, repo } = makeService();
    repo.usernames.set(USERID, USER_ID);

    await service.activateFromCallback(incoming());

    expect(repo.upsertCalls).toEqual([{ wecomUserid: USERID, userId: USER_ID, at: AT }]);
    expect(repo.activations.get(USERID)).toEqual({
      wecomUserid: USERID,
      userId: USER_ID,
      firstActivatedAt: AT,
      lastMessageAt: AT,
    });
  });

  it("幂等：重复回调刷新 last_message_at、first_activated_at 不覆盖", async () => {
    const { service, repo } = makeService();
    repo.usernames.set(USERID, USER_ID);
    repo.activations.set(USERID, activation());

    await service.activateFromCallback(incoming());

    const row = repo.activations.get(USERID)!;
    expect(row.firstActivatedAt).toEqual(BEFORE);
    expect(row.lastMessageAt).toEqual(AT);
  });

  it("未匹配本地用户：user_id 留空登记（warn 不阻断 —— 该行仍可作已激活判据）", async () => {
    const { service, repo } = makeService();

    await service.activateFromCallback(incoming());

    expect(repo.upsertCalls).toEqual([{ wecomUserid: USERID, userId: null, at: AT }]);
    expect(repo.activations.get(USERID)!.userId).toBeNull();
  });

  it("enter_chat 等事件回调 / 群聊回调 / fromUserId 缺失：不 upsert（仅用户消息激活）", async () => {
    const { service, repo } = makeService();

    await service.activateFromCallback(incoming({ cmd: "aibot_event_callback" }));
    await service.activateFromCallback(incoming({ chattype: "group" }));
    await service.activateFromCallback(incoming({ fromUserId: null }));

    expect(repo.upsertCalls).toEqual([]);
    expect(repo.activations.size).toBe(0);
  });

  it("userid 非法（超激活表 CHECK 字符集 / 空串）：忽略不入库（防脏回调打断 ingest）", async () => {
    const { service, repo } = makeService();

    await service.activateFromCallback(incoming({ fromUserId: "bad userid!" }));
    await service.activateFromCallback(incoming({ fromUserId: "" }));

    expect(repo.upsertCalls).toEqual([]);
  });
});
