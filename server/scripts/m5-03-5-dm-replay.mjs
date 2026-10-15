#!/usr/bin/env node
/**
 * M5-03-5-3 · 单聊 aibot（实现段）· 本地回放（无网络 / 无 PG）：
 *   ① 帧形锁帧（P4 复核落地）：假 socket 驱动 server/dist 的 `wecom.aibot.js` —— `sendUserMarkdown` 帧 =
 *      { chatid: userid, chat_type: 1, msgtype: markdown, markdown: { content } }（官方 SDK 语义核对
 *      sendMessage：单聊填 userid + 探针 T5-1b 真机 errcode=0）；群帧 chat_type=2 不动（对拍）。
 *   ② 846607 双语义分流：dmActivated=false（未命中激活表）→ permanent；true / 缺省 → rate_limited（超频）；
 *      群侧 groupActivated 分流对拍。
 *   ③ 限速 kind `single`：本地双窗口拒绝（不发帧 / attempts=0 / retryAt = 被拒窗口下一窗口起点）；群 / 单聊桶隔离。
 *   ④ 消费链（假仓储 / 假站内信驱动 dist `notify.dm.service.js`）：ok → done + sent 行 + 旁证回填（D4）/
 *      rate_limited → deferred（不消耗重试）/ retryable → retry / permanent 853000 → dead + 通用前缀降级 /
 *      permanent 846607（未命中）→ dead + 激活指引前缀降级（P3 · 终稿）/ 收件人不存在 → dead 不降级 /
 *      停用 → dead + 降级 / 降级写库失败 → retry。
 *   ⑤ 激活 ingest：single 消息回调 upsert（原文 userid + 反查回填 + 幂等刷新 last_message_at）/
 *      enter_chat 不激活 / 未匹配用户留空登记 / 非法 userid 忽略。
 *
 * 前置：已构建的 server/dist（cd server && npm run build）。
 * 用法：cd server && node scripts/m5-03-5-dm-replay.mjs [--out <报告.md>] [--json <证据.json>]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const report = [];
const evidence = { checks: [] };
let pass = 0;
let fail = 0;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") out.out = argv[++i];
    if (item === "--json") out.json = argv[++i];
  }
  return out;
}

function check(name, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  report.push((ok ? "PASS " : "FAIL ") + name + (detail === undefined ? "" : " —— " + detail));
  evidence.checks.push({ name, ok, detail: detail ?? null });
}

function assertEqual(name, actual, expected) {
  const ok = actual === expected;
  check(name, ok, ok ? undefined : "实际 " + JSON.stringify(actual) + " / 期望 " + JSON.stringify(expected));
}

function assertTrue(name, ok, detail) {
  check(name, ok === true, ok === true ? undefined : detail);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 假 socket（AibotSocket 替身）：sent 记录已发帧 + 驱动面（open / deliver / ackLast）。 */
function makeFakeSocket() {
  const socket = {
    sent: [],
    closed: false,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      socket.sent.push(data);
    },
    close(code, reason) {
      if (socket.closed) return;
      socket.closed = true;
      socket.onclose?.(code ?? 1000, reason ?? "closed by replay");
    },
    open() {
      socket.onopen?.();
    },
    deliver(frame) {
      socket.onmessage?.(JSON.stringify(frame));
    },
    lastFrame() {
      return JSON.parse(socket.sent[socket.sent.length - 1]);
    },
    /** 以回执应答最近一帧（订阅 / 推送同形：errcode 在帧顶层）。 */
    ackLast(errcode = 0, errmsg = "ok") {
      const headers = socket.lastFrame().headers ?? {};
      socket.deliver({ headers: { req_id: headers.req_id }, errcode, errmsg });
    },
  };
  return socket;
}

const AT = new Date("2026-10-14T06:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const USERID = "zhangsan";
const FIXED_NOW = 1_700_000_000_000;
const minuteWindowStart = Math.floor(FIXED_NOW / 60_000) * 60_000;

async function main() {
  const distFile = (name) => pathToFileURL(join(HERE, "..", "dist", "modules", "notify", name)).href;
  const { createWecomAibotClientFromEnv } = await import(distFile("wecom.aibot.js"));
  const { InMemoryRateWindowStore } = await import(distFile("wecom.rate.js"));
  const dm = await import(distFile("notify.dm.service.js"));
  const { ClockService } = await import(pathToFileURL(join(HERE, "..", "dist", "common", "clock", "clock.service.js")).href);

  check(
    "D0 dist 单聊实现面可用（NotifyDmService / composeDmMarkdown / 降级前缀导出）",
    typeof dm.NotifyDmService === "function" && typeof dm.composeDmMarkdown === "function" && typeof dm.DM_ACTIVATION_DEGRADE_PREFIX === "string",
  );

  // ---- 发送面（真实客户端 + 假 socket） ----
  const baseEnv = {
    WECOM_BOT_WS_URL: "wss://stub.test/aibot",
    WECOM_BOT_ID: "bot-stub",
    WECOM_BOT_SECRET: "secret-stub",
    WECOM_BOT_PING_INTERVAL_MS: 3_600_000, // 默认静默（个别场景覆盖）
    WECOM_BOT_ACK_TIMEOUT_MS: 1000,
    WECOM_BOT_RECONNECT_MIN_MS: 60_000,
    WECOM_BOT_RECONNECT_MAX_MS: 60_000,
    WECOM_BOT_RATE_LIMIT_PER_MINUTE: 30,
    WECOM_BOT_RATE_LIMIT_PER_HOUR: 1000,
  };
  const makeRuntime = (envPatch = {}) => {
    const sockets = [];
    const socketFactory = () => {
      const socket = makeFakeSocket();
      sockets.push(socket);
      return socket;
    };
    const { aibot } = createWecomAibotClientFromEnv(
      { ...baseEnv, ...envPatch },
      { socketFactory, store: new InMemoryRateWindowStore(), now: () => FIXED_NOW },
    );
    return { aibot, sockets };
  };
  const connect = async (aibot, sockets) => {
    aibot.start();
    const socket = sockets[sockets.length - 1];
    socket.open();
    socket.ackLast(0);
    await sleep(0);
    return socket;
  };

  // S1 单聊帧形锁帧（P4）
  {
    const { aibot, sockets } = makeRuntime();
    const socket = await connect(aibot, sockets);
    const pending = aibot.sendUserMarkdown({ userid: USERID, content: "**单聊锁帧**\n\n正文", dmActivated: false });
    await sleep(0);
    const frame = socket.lastFrame();
    const body = frame.body ?? {};
    check(
      "S1 单聊帧形锁帧：cmd=aibot_send_msg + req_id 前缀 + body 全等（chatid=userid / chat_type=1 / markdown.content）",
      frame.cmd === "aibot_send_msg" &&
        typeof frame.headers?.req_id === "string" &&
        frame.headers.req_id.startsWith("aibot_send_msg_") &&
        body.chatid === USERID &&
        body.chat_type === 1 &&
        body.msgtype === "markdown" &&
        body.markdown?.content === "**单聊锁帧**\n\n正文" &&
        Object.keys(body).length === 4,
      JSON.stringify(frame),
    );
    socket.ackLast(0);
    const sent = await pending;
    check("S1 单聊发送：errcode=0 → ok / attempts=1", sent.ok === true && sent.attempts === 1, JSON.stringify(sent));
    await aibot.stop();
  }

  // S2 群帧对拍（chat_type=2 不变 —— 本刀未动群发送面）
  {
    const { aibot, sockets } = makeRuntime();
    const socket = await connect(aibot, sockets);
    const pending = aibot.sendGroupMarkdown({ chatid: "ChatIdAbcDef-99", content: "群帧对拍", groupActivated: true });
    await sleep(0);
    const body = socket.lastFrame().body ?? {};
    check(
      "S2 群帧对拍：chatid=chatid + chat_type=2 不变（单聊扩面未回改群面）",
      body.chatid === "ChatIdAbcDef-99" && body.chat_type === 2 && body.msgtype === "markdown" && body.markdown?.content === "群帧对拍",
      JSON.stringify(body),
    );
    socket.ackLast(0);
    const sent = await pending;
    check("S2 群发送：errcode=0 → ok", sent.ok === true, JSON.stringify(sent));
    await aibot.stop();
  }

  // S3 846607 双语义分流（单聊 + 群对拍）
  {
    const { aibot, sockets } = makeRuntime();
    const socket = await connect(aibot, sockets);

    const unactivated = aibot.sendUserMarkdown({ userid: USERID, content: "x", dmActivated: false });
    await sleep(0);
    socket.ackLast(846607, "aibot send msg frequency limit exceeded");
    const r1 = await unactivated;
    check(
      "S3 单聊未命中激活表 + 846607 → permanent（未激活收口）",
      r1.ok === false && r1.kind === "permanent" && r1.errcode === 846607,
      JSON.stringify(r1),
    );

    const throttled = aibot.sendUserMarkdown({ userid: USERID, content: "x", dmActivated: true });
    await sleep(0);
    socket.ackLast(846607, "aibot send msg frequency limit exceeded");
    const r2 = await throttled;
    check(
      "S3 单聊命中激活表 + 846607 → rate_limited（超频延期重排）",
      r2.ok === false && r2.kind === "rate_limited" && r2.errcode === 846607,
      JSON.stringify(r2),
    );

    const groupUnactivated = aibot.sendGroupMarkdown({ chatid: "ChatIdAbcDef-99", content: "x", groupActivated: false });
    await sleep(0);
    socket.ackLast(846607, "aibot send msg frequency limit exceeded");
    const r3 = await groupUnactivated;
    check(
      "S3 群侧 groupActivated=false 对拍 → permanent（群 / 单聊分流并存、参数不串用）",
      r3.ok === false && r3.kind === "permanent",
      JSON.stringify(r3),
    );
    await aibot.stop();
  }

  // S4 未就绪发送
  {
    const { aibot, sockets } = makeRuntime();
    const result = await aibot.sendUserMarkdown({ userid: USERID, content: "x", dmActivated: true });
    check(
      "S4 未就绪发送（未 start）→ retryable / attempts=0 / 不发帧",
      result.ok === false && result.kind === "retryable" && result.attempts === 0 && sockets.length === 0,
      JSON.stringify(result),
    );
  }

  // S5 单聊限速（single 桶）+ 群 / 单聊桶隔离
  {
    const { aibot, sockets } = makeRuntime({ WECOM_BOT_RATE_LIMIT_PER_MINUTE: 1, WECOM_BOT_RATE_LIMIT_PER_HOUR: 1000 });
    const socket = await connect(aibot, sockets);

    const first = aibot.sendUserMarkdown({ userid: USERID, content: "1", dmActivated: true });
    await sleep(0);
    socket.ackLast(0);
    const firstResult = await first;
    check("S5 限速：单聊首条放行（ok）", firstResult.ok === true, JSON.stringify(firstResult));
    const framesAfterFirst = socket.sent.length;

    const blocked = await aibot.sendUserMarkdown({ userid: USERID, content: "2", dmActivated: true });
    check(
      "S5 限速：第二条本地拦截（rate_limited / attempts=0 / retryAt = 下一分钟窗口起点）",
      blocked.ok === false && blocked.kind === "rate_limited" && blocked.attempts === 0 && blocked.retryAt.getTime() === minuteWindowStart + 60_000,
      JSON.stringify(blocked),
    );
    check("S5 限速：拦截不发帧（帧数不变）", socket.sent.length === framesAfterFirst);

    const groupOk = aibot.sendGroupMarkdown({ chatid: USERID, content: "g" });
    await sleep(0);
    socket.ackLast(0);
    const groupResult = await groupOk;
    check(
      "S5 桶隔离：单聊桶耗尽不影响群桶（同摘要 kind 隔离 —— single: 前缀）",
      groupResult.ok === true,
      JSON.stringify(groupResult),
    );
    await aibot.stop();
  }

  // ---- 消费链（假仓储 / 假站内信 · 生产 = OutboxModule 按 channel=wecom_aibot 路由 —— 接线随 M5-03-5-4） ----
  const clock = new ClockService();
  clock.setSource(() => AT);

  const contact = (overrides = {}) => ({ id: USER_ID, username: USERID, status: "active", removedAt: null, ...overrides });
  const payload = (overrides = {}) => ({
    recipientId: USER_ID,
    type: "reminder",
    channel: "wecom_aibot",
    title: "任务节点完成",
    body: "节点：到货验收 负责人：张工",
    ...overrides,
  });
  const claimedRow = (payloadValue, overrides = {}) => ({
    id: 11,
    topic: "notify.message",
    payload: payloadValue,
    dedupeKey: "R02:t-1:v5:aibot",
    attempts: 0,
    availableAt: AT,
    lockedAt: AT,
    createdAt: AT,
    ...overrides,
  });

  const makeService = (clientResult) => {
    const repo = {
      contacts: new Map([[USER_ID, contact()]]),
      activations: new Map(),
      deliveries: [],
      upsertCalls: [],
      backfillCalls: [],
      async findContact(userId) {
        return this.contacts.get(userId) ?? null;
      },
      async findUserIdByUsername(username) {
        return username === USERID ? USER_ID : null;
      },
      async findActivation(wecomUserid) {
        return this.activations.get(wecomUserid) ?? null;
      },
      async upsertActivationFromCallback(input) {
        this.upsertCalls.push(input);
        const existing = this.activations.get(input.wecomUserid);
        this.activations.set(input.wecomUserid, {
          wecomUserid: input.wecomUserid,
          userId: existing?.userId ?? input.userId,
          firstActivatedAt: existing?.firstActivatedAt ?? input.at,
          lastMessageAt: input.at,
        });
      },
      async backfillActivationOnSend(input) {
        this.backfillCalls.push(input);
      },
      async insertDelivery(input) {
        this.deliveries.push(input);
      },
    };
    const aibot = {
      sends: [],
      async sendUserMarkdown(params) {
        this.sends.push(params);
        return clientResult;
      },
    };
    const inbox = {
      copies: [],
      failNext: false,
      async deliverInboxCopy(message, topic, dedupeKey) {
        if (this.failNext) {
          this.failNext = false;
          throw new Error("站内信落库失败（回放）");
        }
        this.copies.push({ message, topic, dedupeKey });
        return { duplicate: false };
      },
    };
    return { service: new dm.NotifyDmService(repo, aibot, inbox, clock), repo, aibot, inbox };
  };

  // S6 ok → done + sent 行 + 旁证回填（D4）
  {
    const { service, repo, aibot, inbox } = makeService({ ok: true, attempts: 1 });
    const outcome = await service.consume(claimedRow(payload()));
    assertEqual("S6 消费 ok：done", outcome.outcome, "done");
    assertEqual(
      "S6 消费 ok：sent 行（target=userid / attempts=1 / sentAt 非空 / error null）",
      repo.deliveries[0].state + ":" + repo.deliveries[0].target + ":" + String(repo.deliveries[0].attempts) + ":" + String(repo.deliveries[0].sentAt !== null) + ":" + String(repo.deliveries[0].error),
      "sent:" + USERID + ":1:true:null",
    );
    assertEqual("S6 消费 ok：内容逐字 = 加粗标题 + 空行 + 正文", aibot.sends[0].content, "**任务节点完成**\n\n节点：到货验收 负责人：张工");
    assertEqual("S6 消费 ok：未命中激活表 → dmActivated=false 传入（D4 不拦截、仍尝试发送）", String(aibot.sends[0].dmActivated), "false");
    assertTrue(
      "S6 消费 ok：旁证回填（D4）—— wecom_userid / user_id / 时刻",
      repo.backfillCalls.length === 1 && repo.backfillCalls[0].wecomUserid === USERID && repo.backfillCalls[0].userId === USER_ID && repo.backfillCalls[0].at.getTime() === AT.getTime(),
    );
    assertEqual("S6 消费 ok：不产生降级副本", String(inbox.copies.length), "0");
  }

  // S7 命中激活表 → dmActivated=true、不重复回填
  {
    const { service, repo, aibot } = makeService({ ok: true, attempts: 1 });
    repo.activations.set(USERID, { wecomUserid: USERID, userId: USER_ID, firstActivatedAt: AT, lastMessageAt: AT });
    await service.consume(claimedRow(payload()));
    assertTrue(
      "S7 命中激活表 → dmActivated=true 传入且不重复回填",
      aibot.sends[0].dmActivated === true && repo.backfillCalls.length === 0,
    );
  }

  // S8 rate_limited → deferred
  {
    const retryAt = new Date(AT.getTime() + 30_000);
    const { service, repo } = makeService({ ok: false, kind: "rate_limited", errcode: null, errmsg: "本地限速桶已满", retryAt, attempts: 0, state: "subscribed" });
    const outcome = await service.consume(claimedRow(payload()));
    assertEqual(
      "S8 rate_limited：deferred + availableAt = retryAt（attempts 不消耗）",
      outcome.outcome + ":" + String(outcome.availableAt.getTime() === retryAt.getTime()),
      "deferred:true",
    );
    assertEqual(
      "S8 rate_limited：deferred 行（attempts=0 / sentAt null）",
      repo.deliveries[0].state + ":" + String(repo.deliveries[0].attempts) + ":" + String(repo.deliveries[0].sentAt),
      "deferred:0:null",
    );
  }

  // S9 retryable → retry
  {
    const { service, repo } = makeService({ ok: false, kind: "retryable", errcode: 846609, errmsg: "not subscribed", retryAt: null, attempts: 1, state: "backoff" });
    const outcome = await service.consume(claimedRow(payload()));
    assertEqual("S9 retryable（未订阅 / 断连）：retry + failed 行", outcome.outcome + ":" + repo.deliveries[0].state, "retry:failed");
  }

  // S10 permanent 853000 → dead + 通用前缀降级
  {
    const { service, repo, inbox } = makeService({ ok: false, kind: "permanent", errcode: 853000, errmsg: "invalid bot", retryAt: null, attempts: 1, state: "subscribed" });
    const outcome = await service.consume(claimedRow(payload({ refType: "task", refId: "33333333-3333-4333-8333-333333333333" })));
    assertTrue(
      "S10 permanent（853000）：dead + dead 行（含 errcode）",
      outcome.outcome === "dead" && outcome.error.includes("853000") && repo.deliveries[0].state === "dead",
    );
    assertTrue(
      "S10 permanent 降级（C5-04）：同收件人站内信副本（:c504 / 通用前缀 / 标题与关联对象保留 / 不带激活指引）",
      inbox.copies.length === 1 &&
        inbox.copies[0].dedupeKey === "R02:t-1:v5:aibot:c504" &&
        inbox.copies[0].topic === "notify.message" &&
        inbox.copies[0].message.recipientId === USER_ID &&
        inbox.copies[0].message.title === "任务节点完成" &&
        inbox.copies[0].message.refId === "33333333-3333-4333-8333-333333333333" &&
        String(inbox.copies[0].message.body).startsWith(dm.DM_DEGRADE_PREFIX) &&
        !String(inbox.copies[0].message.body).includes("私发任意消息"),
    );
  }

  // S11 permanent 846607 未命中 → dead + 激活指引前缀（P3 · 终稿）
  {
    const { service, inbox, aibot } = makeService({ ok: false, kind: "permanent", errcode: 846607, errmsg: "aibot send msg frequency limit exceeded", retryAt: null, attempts: 1, state: "subscribed" });
    const outcome = await service.consume(claimedRow(payload()));
    assertTrue(
      "S11 846607 未命中激活表：dmActivated=false 传入 + dead 收口",
      aibot.sends[0].dmActivated === false && outcome.outcome === "dead",
    );
    assertTrue(
      "S11 降级前缀附激活指引话术终稿（P3 · 2026-10-15 · 含终稿句与原文保留）",
      inbox.copies.length === 1 &&
        String(inbox.copies[0].message.body).startsWith(dm.DM_ACTIVATION_DEGRADE_PREFIX) &&
        String(inbox.copies[0].message.body).includes("当前机器人未激活，请私发任意消息给机器人即可激活。") &&
        String(inbox.copies[0].message.body).includes("节点：到货验收 负责人：张工"),
    );
  }

  // S12 收件人不存在 → dead，不降级
  {
    const { service, repo, aibot, inbox } = makeService({ ok: true, attempts: 1 });
    repo.contacts.clear();
    const outcome = await service.consume(claimedRow(payload()));
    assertTrue(
      "S12 收件人不存在：dead + dead 行（target=user:<id>）、不发送、不降级",
      outcome.outcome === "dead" && repo.deliveries[0].target === "user:" + USER_ID && aibot.sends.length === 0 && inbox.copies.length === 0,
    );
  }

  // S13 收件人停用 → dead + 降级
  {
    const { service, repo, inbox } = makeService({ ok: true, attempts: 1 });
    repo.contacts.set(USER_ID, contact({ status: "disabled" }));
    const outcome = await service.consume(claimedRow(payload()));
    assertTrue(
      "S13 收件人停用：dead + dead 行 + 降级（用户存在即降级 · 同 app 口径）",
      outcome.outcome === "dead" && repo.deliveries[0].state === "dead" && inbox.copies.length === 1,
    );
  }

  // S14 降级写库失败 → retry
  {
    const { service, inbox } = makeService({ ok: false, kind: "permanent", errcode: 853000, errmsg: "invalid bot", retryAt: null, attempts: 1, state: "subscribed" });
    inbox.failNext = true;
    const outcome = await service.consume(claimedRow(payload()));
    assertTrue(
      "S14 降级站内信写库失败：retry 收敛（有界重试不静默丢）",
      outcome.outcome === "retry" && String(outcome.error).includes("降级站内信失败"),
    );
  }

  // S15 激活 ingest（single 消息回调 upsert）
  {
    const { service, repo } = makeService({ ok: true, attempts: 1 });
    const incoming = { cmd: "aibot_msg_callback", reqId: null, chatid: null, chattype: "single", fromUserId: USERID, msgid: "m1" };
    await service.activateFromCallback(incoming);
    await service.activateFromCallback(incoming); // 幂等复放（刷新 last_message_at）
    assertTrue(
      "S15 单聊消息回调 ingest：upsert 幂等（原文 userid / 反查 user_id 回填 / last_message_at 刷新）",
      repo.upsertCalls.length === 2 &&
        repo.upsertCalls[0].wecomUserid === USERID &&
        repo.upsertCalls[0].userId === USER_ID &&
        repo.activations.get(USERID).lastMessageAt.getTime() === AT.getTime(),
    );
    await service.activateFromCallback({ ...incoming, cmd: "aibot_event_callback" }); // enter_chat 不激活
    await service.activateFromCallback({ ...incoming, chattype: "group" });
    assertEqual("S15 enter_chat（event 回调）/ 群聊回调不激活（upsert 次数不变）", String(repo.upsertCalls.length), "2");
    await service.activateFromCallback({ ...incoming, fromUserId: "unmatched-user" });
    assertTrue(
      "S15 未匹配用户：user_id 留空登记（行仍落 —— 仍可作已激活判据）",
      repo.upsertCalls.length === 3 && repo.upsertCalls[2].userId === null && repo.activations.has("unmatched-user"),
    );
    await service.activateFromCallback({ ...incoming, fromUserId: "bad userid!" });
    assertEqual("S15 userid 非法：忽略不入库（防脏回调打断 ingest）", String(repo.upsertCalls.length), "3");
  }

  const summary = "m5-03-5-3 单聊 aibot（实现段）回放：PASS " + pass + " / FAIL " + fail;
  console.log(summary);
  for (const line of report) console.log("  " + line);
  if (args.out) {
    writeFileSync(args.out, "# " + summary + "\n\n" + report.map((line) => "- " + line).join("\n") + "\n", "utf8");
  }
  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ pass, fail, checks: evidence.checks }, null, 2) + "\n", "utf8");
  }
  process.exit(fail === 0 ? 0 : 1);
}

await main();
