#!/usr/bin/env node
/**
 * M5-03-1 适配器内核 · 本地 stub 回放（无网络 / 无 PG）：
 *   以本机 HTTP 桩模拟企微 gettoken / message/send / webhook 三类端点，驱动 server/dist 的企微内核
 *   （createWecomClientFromEnv 接线），覆盖实施方案 §五 的失败分类分支：
 *   token 单飞 / 失效重取一次（成功与连续失效）/ 配置类与接收人永久失败 / 频率限速 / 5xx / 超时 /
 *   非 JSON 兜底 / 本地限速桶短路与跨桶隔离 / webhook 成功与失效（93000）。
 *
 * 前置：已构建的 server/dist（cd server && npm run build）。
 * 用法：cd server && node scripts/m5-03-1-wecom-stub-replay.mjs [--out <报告.md>] [--json <证据.json>]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createServer } from "node:http";
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

// —— 桩状态 ——
const state = {
  gettoken: 0,
  send: 0,
  webhook: 0,
  tokenSeq: 0,
  expiredUsed: false,
  mode: "ok",
  lastSendBody: null,
  lastSendToken: null,
  lastWebhookKey: null,
  lastWebhookBody: null,
};

function respondSend(res) {
  const mode = state.mode;
  if (mode === "expired_once" && state.expiredUsed === false) {
    state.expiredUsed = true;
    return json(res, 200, { errcode: 42001, errmsg: "access_token expired" });
  }
  if (mode === "expired_always") return json(res, 200, { errcode: 42001, errmsg: "access_token expired" });
  if (mode === "config") return json(res, 200, { errcode: 40001, errmsg: "invalid credential" });
  if (mode === "recipient") return json(res, 200, { errcode: 60011, errmsg: "invalid user" });
  if (mode === "freq") return json(res, 200, { errcode: 45009, errmsg: "freq out of limit" });
  if (mode === "http500") {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end("{}");
    return;
  }
  if (mode === "slow") {
    setTimeout(() => json(res, 200, { errcode: 0, errmsg: "ok" }), 250);
    return;
  }
  if (mode === "notjson") {
    res.statusCode = 200;
    res.end("not json");
    return;
  }
  return json(res, 200, { errcode: 0, errmsg: "ok" });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/cgi-bin/gettoken") {
    state.gettoken += 1;
    state.tokenSeq += 1;
    return json(res, 200, { errcode: 0, errmsg: "ok", access_token: "stub-token-" + state.tokenSeq, expires_in: 7200 });
  }
  if (req.method === "POST" && url.pathname === "/cgi-bin/message/send") {
    state.send += 1;
    state.lastSendToken = url.searchParams.get("access_token");
    return readBody(req).then((text) => {
      state.lastSendBody = JSON.parse(text);
      respondSend(res);
    });
  }
  if (req.method === "POST" && url.pathname === "/cgi-bin/webhook/send") {
    state.webhook += 1;
    state.lastWebhookKey = url.searchParams.get("key");
    return readBody(req).then((text) => {
      state.lastWebhookBody = JSON.parse(text);
      if (state.mode === "webhook_invalid") return json(res, 200, { errcode: 93000, errmsg: "invalid webhook url" });
      return json(res, 200, { errcode: 0, errmsg: "ok" });
    });
  }
  return json(res, 404, { errcode: 404, errmsg: "not found" });
});

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function main() {
  const distFile = (name) => pathToFileURL(join(HERE, "..", "dist", "modules", "notify", name)).href;
  const { createWecomClientFromEnv } = await import(distFile("wecom.client.js"));
  const { InMemoryRateWindowStore } = await import(distFile("wecom.rate.js"));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = "http://127.0.0.1:" + port;
  check("P1 dist 内核可用（工厂装配成功）", typeof createWecomClientFromEnv === "function");

  const FIXED_NOW = 1_700_000_000_000;
  const windowStart = Math.floor(FIXED_NOW / 60_000) * 60_000;
  const baseEnv = {
    WECOM_BASE_URL: baseUrl,
    WECOM_CORP_ID: "corp-stub",
    WECOM_AGENT_ID: 1000002,
    WECOM_APP_SECRET: "secret-stub",
    WECOM_TIMEOUT_MS: 1000,
    WECOM_TOKEN_SAFETY_MS: 300000,
    WECOM_RATE_WINDOW_MS: 60000,
    WECOM_RATE_LIMIT_APP: 0,
    WECOM_RATE_LIMIT_GROUP: 0,
  };
  const makeRuntime = (envPatch, overrides = {}) =>
    createWecomClientFromEnv({ ...baseEnv, ...envPatch }, { now: () => FIXED_NOW, store: new InMemoryRateWindowStore(), ...overrides });

  // S1 token 单飞：并发取 token 只发一次 gettoken
  {
    const { token } = makeRuntime({});
    const before = state.gettoken;
    const [a, b] = await Promise.all([token.getToken(), token.getToken()]);
    assertEqual("S1 单飞：并发两次取 token 只发一次 gettoken", state.gettoken - before, 1);
    assertEqual("S1 单飞：两路拿到同一 token", a, b);
  }

  // S2 app 发送成功：token 进 query、包体形状
  {
    const { client } = makeRuntime({});
    state.mode = "ok";
    state.lastSendBody = null;
    const before = state.send;
    const result = await client.sendAppText({ toUser: ["u1", "u2"], content: "内核回放" });
    check("S2 app 成功：ok = true / attempts = 1", result.ok === true && result.attempts === 1, JSON.stringify(result));
    assertEqual("S2 app 成功：桩收到恰 1 次 message/send", state.send - before, 1);
    check(
      "S2 app 成功：touser / msgtype / agentid / 文本形状",
      state.lastSendBody?.touser === "u1|u2" &&
        state.lastSendBody?.msgtype === "text" &&
        state.lastSendBody?.agentid === 1000002 &&
        state.lastSendBody?.text?.content === "内核回放",
      JSON.stringify(state.lastSendBody),
    );
    check("S2 app 成功：access_token 进 query 且非空", typeof state.lastSendToken === "string" && state.lastSendToken.length > 0);
  }

  // S3 token 失效重取一次：42001 → 刷新 → 重发成功
  {
    const { client } = makeRuntime({});
    state.mode = "expired_once";
    state.expiredUsed = false;
    const sendBefore = state.send;
    const tokenBefore = state.gettoken;
    const result = await client.sendAppText({ toUser: ["u1"], content: "重发" });
    check(
      "S3 token 失效重取一次：ok = true / retriedToken = true / attempts = 2",
      result.ok === true && result.retriedToken === true && result.attempts === 2,
      JSON.stringify(result),
    );
    assertEqual("S3：桩收到恰 2 次 message/send（首失败 + 重发）", state.send - sendBefore, 2);
    assertEqual("S3：gettoken 恰 2 次（初始取 1 + 失效重取 1）", state.gettoken - tokenBefore, 2);
  }

  // S4 token 连续失效：返回 token_invalid，不再重发
  {
    const { client } = makeRuntime({});
    state.mode = "expired_always";
    const sendBefore = state.send;
    const result = await client.sendAppText({ toUser: ["u1"], content: "再失败" });
    check(
      "S4 token 连续失效：kind = token_invalid / retriedToken = true / attempts = 2",
      result.ok === false && result.kind === "token_invalid" && result.retriedToken === true && result.attempts === 2,
      JSON.stringify(result),
    );
    assertEqual("S4：恰 2 次 message/send（不无限重发）", state.send - sendBefore, 2);
  }

  // S5 / S6 / S7：业务错误码分类透传
  {
    const { client } = makeRuntime({});
    state.mode = "config";
    const permanent = await client.sendAppText({ toUser: ["u1"], content: "x" });
    check("S5 配置类 40001 → permanent", permanent.ok === false && permanent.kind === "permanent" && permanent.errcode === 40001);
    state.mode = "recipient";
    const recipient = await client.sendAppText({ toUser: ["u1"], content: "x" });
    check("S6 接收人 60011 → permanent", recipient.ok === false && recipient.kind === "permanent" && recipient.errcode === 60011);
    state.mode = "freq";
    const freq = await client.sendAppText({ toUser: ["u1"], content: "x" });
    check(
      "S7 频率 45009 → rate_limited（retryAt 留 null，退避由消费侧定）",
      freq.ok === false && freq.kind === "rate_limited" && freq.errcode === 45009 && freq.retryAt === null,
    );
  }

  // S8 / S9 / S10：传输层兜底
  {
    const { client } = makeRuntime({});
    state.mode = "http500";
    const five = await client.sendAppText({ toUser: ["u1"], content: "x" });
    check("S8 5xx → retryable", five.ok === false && five.kind === "retryable" && five.httpStatus === 500);
    state.mode = "notjson";
    const text = await client.sendAppText({ toUser: ["u1"], content: "x" });
    check("S9 非 JSON 200 → retryable", text.ok === false && text.kind === "retryable");
    state.mode = "slow";
    const slowRuntime = makeRuntime({ WECOM_TIMEOUT_MS: 100 });
    const slow = await slowRuntime.client.sendAppText({ toUser: ["u1"], content: "x" });
    check("S10 超时 → retryable", slow.ok === false && slow.kind === "retryable");
    state.mode = "ok";
  }

  // S11 本地限速桶短路：app 桶限 1 → 第二次不发 HTTP
  {
    const { client } = makeRuntime({ WECOM_RATE_LIMIT_APP: 1 });
    const sendBefore = state.send;
    const first = await client.sendAppText({ toUser: ["u1"], content: "1" });
    const second = await client.sendAppText({ toUser: ["u1"], content: "2" });
    check("S11 限速：首条放行", first.ok === true);
    check(
      "S11 限速：第二条本地拦截（attempts = 0 / retryAt = 下一窗口）",
      second.ok === false && second.kind === "rate_limited" && second.attempts === 0 && second.retryAt.getTime() === windowStart + 60_000,
      JSON.stringify({ ...second, retryAt: second.ok ? null : second.retryAt.toISOString() }),
    );
    assertEqual("S11 限速：拦截不发 HTTP（桩仅增 1 次）", state.send - sendBefore, 1);
  }

  // S12 webhook 成功：无 token 面
  {
    const { client } = makeRuntime({ WECOM_RATE_LIMIT_GROUP: 1 });
    const tokenBefore = state.gettoken;
    const webhookBefore = state.webhook;
    const result = await client.sendGroupText({ webhookUrl: baseUrl + "/cgi-bin/webhook/send?key=stub-key-1", content: "群播报" });
    check("S12 webhook 成功：ok = true", result.ok === true && result.attempts === 1, JSON.stringify(result));
    assertEqual("S12：桩收到恰 1 次 webhook", state.webhook - webhookBefore, 1);
    assertEqual("S12：webhook 不走 gettoken", state.gettoken - tokenBefore, 0);
    check(
      "S12：webhook 包体 = text 载荷",
      state.lastWebhookBody?.msgtype === "text" && state.lastWebhookBody?.text?.content === "群播报",
      JSON.stringify(state.lastWebhookBody),
    );
    assertEqual("S12：webhook key 未丢失（query 保留）", state.lastWebhookKey, "stub-key-1");
  }

  // S13 webhook 失效 93000 → permanent
  {
    const { client } = makeRuntime({});
    state.mode = "webhook_invalid";
    const result = await client.sendGroupText({ webhookUrl: baseUrl + "/cgi-bin/webhook/send?key=stub-key-bad", content: "x" });
    check("S13 webhook 93000 → permanent", result.ok === false && result.kind === "permanent" && result.errcode === 93000);
    state.mode = "ok";
  }

  // S14 webhook 桶隔离：同桶限速、异桶放行
  {
    const { client } = makeRuntime({ WECOM_RATE_LIMIT_GROUP: 1 });
    const urlA = baseUrl + "/cgi-bin/webhook/send?key=stub-key-a";
    const urlB = baseUrl + "/cgi-bin/webhook/send?key=stub-key-b";
    const webhookBefore = state.webhook;
    const first = await client.sendGroupText({ webhookUrl: urlA, content: "1" });
    const blocked = await client.sendGroupText({ webhookUrl: urlA, content: "2" });
    const other = await client.sendGroupText({ webhookUrl: urlB, content: "3" });
    check("S14 桶隔离：同桶首条放行 / 第二条拦截 / 异桶放行", first.ok === true && blocked.ok === false && blocked.attempts === 0 && other.ok === true);
    assertEqual("S14：拦截不发 HTTP（桩仅增 2 次）", state.webhook - webhookBefore, 2);
  }
}

main()
  .catch((error) => {
    check("脚本执行异常", false, error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    try {
      server.closeAllConnections();
      server.close();
    } catch {
      // 忽略关闭异常
    }
    console.log(report.join("\n"));
    console.log("");
    console.log((fail === 0 ? "RESULT PASS " : "RESULT FAIL ") + pass + " / " + (pass + fail));
    if (args.out) {
      writeFileSync(args.out, "# M5-03-1 企微内核 stub 回放报告\n\n" + report.join("\n") + "\n");
    }
    if (args.json) {
      writeFileSync(args.json, JSON.stringify(evidence, null, 2) + "\n");
    }
    process.exitCode = fail === 0 ? 0 : 1;
  });
