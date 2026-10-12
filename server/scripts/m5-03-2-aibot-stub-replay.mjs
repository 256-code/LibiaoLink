#!/usr/bin/env node
/**
 * M5-03-2 智能机器人长连接 · 本地 stub 回放（无网络 / 无 PG）：
 *   以假 socket（socketFactory 替身）驱动 server/dist 的 `wecom.aibot.js`（createWecomAibotClientFromEnv
 *   接线），覆盖实施方案 §五 5.3A 的失败分类与连接语义：
 *   订阅成败 / 推送帧形状 / 846607 双语义（未激活 / 超频）/ 846609 / 回执超时 / 本地双窗口限速短路 /
 *   心跳失联重连 / 回调分发与退订 / stop 清理。
 *
 *   webhook 发送面已退役（P5 定案 2026-10-12）—— HTTP 面回放见 scripts/m5-03-1-wecom-stub-replay.mjs。
 *
 * 前置：已构建的 server/dist（cd server && npm run build）。
 * 用法：cd server && node scripts/m5-03-2-aibot-stub-replay.mjs [--out <报告.md>] [--json <证据.json>]
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

async function main() {
  const distFile = (name) => pathToFileURL(join(HERE, "..", "dist", "modules", "notify", name)).href;
  const { createWecomAibotClientFromEnv } = await import(distFile("wecom.aibot.js"));
  const { InMemoryRateWindowStore } = await import(distFile("wecom.rate.js"));

  check("P1 dist 智能机器人客户端可用（工厂装配成功）", typeof createWecomAibotClientFromEnv === "function");

  const FIXED_NOW = 1_700_000_000_000;
  const minuteWindowStart = Math.floor(FIXED_NOW / 60_000) * 60_000;
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

  // S0 未就绪发送：未 start → 不发帧、retryable
  {
    const { aibot, sockets } = makeRuntime();
    const result = await aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "x" });
    check(
      "S0 未就绪发送（未 start）→ retryable / attempts = 0 / 不发帧",
      result.ok === false && result.kind === "retryable" && result.attempts === 0 && sockets.length === 0,
      JSON.stringify(result),
    );
  }

  // S1 订阅：帧形状 + 状态机 + 统计
  {
    const { aibot, sockets } = makeRuntime();
    aibot.start();
    check("S1 start 建连（state = connecting / 创建一个连接）", aibot.getStats().state === "connecting" && sockets.length === 1);
    const socket = sockets[0];
    socket.open();
    const frame = socket.lastFrame();
    check(
      "S1 订阅帧形状：aibot_subscribe + bot_id / secret",
      frame.cmd === "aibot_subscribe" && frame.body?.bot_id === "bot-stub" && frame.body?.secret === "secret-stub",
      JSON.stringify(frame),
    );
    socket.ackLast(0);
    await sleep(0);
    const stats = aibot.getStats();
    check(
      "S1 订阅成功：state = subscribed / connects = 1 / subscribes = 1",
      stats.state === "subscribed" && stats.connects === 1 && stats.subscribes === 1,
      JSON.stringify(stats),
    );
    await aibot.stop();
  }

  // S2 推送帧形状 + 回执 ok
  {
    const { aibot, sockets } = makeRuntime();
    const socket = await connect(aibot, sockets);
    const pending = aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "群播报" });
    await sleep(0);
    const frame = socket.lastFrame();
    check(
      "S2 推送帧形状：aibot_send_msg / chatid / chat_type=2 / markdown",
      frame.cmd === "aibot_send_msg" &&
        frame.body?.chatid === "chat-stub-1" &&
        frame.body?.chat_type === 2 &&
        frame.body?.msgtype === "markdown" &&
        frame.body?.markdown?.content === "群播报",
      JSON.stringify(frame),
    );
    socket.ackLast(0);
    const result = await pending;
    check("S2 推送回执 ok：ok = true / attempts = 1", result.ok === true && result.attempts === 1, JSON.stringify(result));
    await aibot.stop();
  }

  // S3 846607 双语义
  {
    const { aibot, sockets } = makeRuntime();
    const socket = await connect(aibot, sockets);
    const dormant = aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "x", groupActivated: false });
    await sleep(0);
    socket.ackLast(846607, "aibot send msg frequency limit exceeded");
    const dormantResult = await dormant;
    check(
      "S3 846607 未激活（groupActivated = false）→ permanent",
      dormantResult.ok === false && dormantResult.kind === "permanent" && dormantResult.errcode === 846607,
      JSON.stringify(dormantResult),
    );
    const frequent = aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "x", groupActivated: true });
    await sleep(0);
    socket.ackLast(846607, "aibot send msg frequency limit exceeded");
    const frequentResult = await frequent;
    check(
      "S3 846607 超频（groupActivated = true）→ rate_limited",
      frequentResult.ok === false && frequentResult.kind === "rate_limited" && frequentResult.errcode === 846607,
      JSON.stringify(frequentResult),
    );
    await aibot.stop();
  }

  // S4 846609 / 回执超时
  {
    const { aibot, sockets } = makeRuntime({ WECOM_BOT_ACK_TIMEOUT_MS: 80 });
    const socket = await connect(aibot, sockets);
    const unsubscribed = aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "x" });
    await sleep(0);
    socket.ackLast(846609, "not subscribed");
    const unsubscribedResult = await unsubscribed;
    check(
      "S4 846609（未订阅）→ retryable",
      unsubscribedResult.ok === false && unsubscribedResult.kind === "retryable" && unsubscribedResult.errcode === 846609,
      JSON.stringify(unsubscribedResult),
    );
    const timedOut = await aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "y" }); // 不回执
    check(
      "S4 回执超时 → retryable（推送回执超时）",
      timedOut.ok === false && timedOut.kind === "retryable" && String(timedOut.errmsg).includes("回执超时"),
      JSON.stringify(timedOut),
    );
    await aibot.stop();
  }

  // S5 本地双窗口限速短路
  {
    const { aibot, sockets } = makeRuntime({ WECOM_BOT_RATE_LIMIT_PER_MINUTE: 1, WECOM_BOT_RATE_LIMIT_PER_HOUR: 1000 });
    const socket = await connect(aibot, sockets);
    const first = aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "1" });
    await sleep(0);
    socket.ackLast(0);
    const firstResult = await first;
    check("S5 限速：首条放行（ok = true）", firstResult.ok === true, JSON.stringify(firstResult));
    const framesAfterFirst = socket.sent.length;
    const blocked = await aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "2" });
    check(
      "S5 限速：第二条本地拦截（attempts = 0 / rate_limited）",
      blocked.ok === false && blocked.kind === "rate_limited" && blocked.attempts === 0,
      JSON.stringify(blocked),
    );
    check("S5 限速：拦截不发帧", socket.sent.length === framesAfterFirst);
    assertEqual(
      "S5 限速：retryAt = 下一分钟窗口起点",
      blocked.ok ? null : blocked.retryAt.getTime(),
      minuteWindowStart + 60_000,
    );
    await aibot.stop();
  }

  // S6 心跳失联 → 断开重连
  {
    const { aibot, sockets } = makeRuntime({
      WECOM_BOT_PING_INTERVAL_MS: 40,
      WECOM_BOT_RECONNECT_MIN_MS: 20,
    });
    await connect(aibot, sockets);
    await sleep(500);
    const stats = aibot.getStats();
    check(
      "S6 心跳失联 → 断开重连（新连接建立 / reconnects ≥ 1 / lastError 含心跳失联）",
      sockets.length >= 2 && stats.reconnects >= 1 && String(stats.lastError).includes("心跳失联"),
      JSON.stringify({ sockets: sockets.length, state: stats.state, reconnects: stats.reconnects, lastError: stats.lastError }),
    );
    await aibot.stop();
  }

  // S7 回调分发与退订
  {
    const { aibot, sockets } = makeRuntime();
    const socket = await connect(aibot, sockets);
    const received = [];
    const off = aibot.onMessage((message) => received.push(message));
    socket.deliver({
      cmd: "aibot_msg_callback",
      headers: { req_id: "req-cb" },
      body: { chatid: "chat-stub-9", chattype: "group", from: { userid: "u-9" }, msgid: "m-1" },
    });
    const message = received[0];
    check(
      "S7 回调分发：chatid / userid / msgid 归一透传",
      received.length === 1 &&
        message?.cmd === "aibot_msg_callback" &&
        message?.chatid === "chat-stub-9" &&
        message?.fromUserId === "u-9" &&
        message?.msgid === "m-1",
      JSON.stringify(received),
    );
    off();
    socket.deliver({ cmd: "aibot_msg_callback", headers: { req_id: "req-cb-2" }, body: { chatid: "chat-stub-9" } });
    check("S7 退订后不再分发", received.length === 1);
    await aibot.stop();
  }

  // S8 stop 清理
  {
    const { aibot, sockets } = makeRuntime({ WECOM_BOT_PING_INTERVAL_MS: 30, WECOM_BOT_RECONNECT_MIN_MS: 20 });
    await connect(aibot, sockets);
    const pending = aibot.sendGroupMarkdown({ chatid: "chat-stub-1", content: "x" });
    await sleep(0);
    await aibot.stop();
    const result = await pending;
    check(
      "S8 stop：待回执推送按「连接已断开」返回",
      result.ok === false && result.kind === "retryable" && String(result.errmsg).includes("连接已断开"),
      JSON.stringify(result),
    );
    const countAfterStop = sockets.length;
    await sleep(300);
    check(
      "S8 stop 清理：不再重连 / 不再建连（state = stopped）",
      sockets.length === countAfterStop && aibot.getStats().state === "stopped",
      JSON.stringify({ sockets: sockets.length, state: aibot.getStats().state }),
    );
  }
}

main()
  .catch((error) => {
    check("脚本执行异常", false, error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    console.log(report.join("\n"));
    console.log("");
    console.log((fail === 0 ? "RESULT PASS " : "RESULT FAIL ") + pass + " / " + (pass + fail));
    if (args.out) {
      writeFileSync(args.out, "# M5-03-2 智能机器人长连接 stub 回放报告\n\n" + report.join("\n") + "\n");
    }
    if (args.json) {
      writeFileSync(args.json, JSON.stringify(evidence, null, 2) + "\n");
    }
    process.exitCode = fail === 0 ? 0 : 1;
  });
