/*
 * Outbox 消费与调度契约回放（M5-02 草案 · Push 165 · wmj）：契约内不变式 + 键形态与再生窗口（Zod 层，无 DB / 无 HTTP）。
 * 运行：shared/ 下 node scripts/outbox-contract-replay.mjs；退出码 0 = 全过。
 * 口径：主题白名单（规则可订阅事件为其子集）/ 状态与库侧 CHECK 同值 / 幂等执行键 scope:entityId:window（含状态版本再生）。
 * 说明：库侧权威门禁在 server 的 test/schema-literals-parity.test.ts（lan 线，本脚本只做静态旁证）。
 */
import { readFileSync } from "node:fs";
import { RULE_EVENT_TOPICS } from "../src/modules/automation.ts";
import {
  OUTBOX_DEDUPE_KEY_PATTERN,
  OUTBOX_SCHEDULER,
  OUTBOX_STATUSES,
  OUTBOX_TOPICS,
  OutboxDedupeKeySchema,
  outboxDedupeKey,
  stateVersionWindow,
} from "../src/modules/outbox.ts";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; } else { fail += 1; }
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
}

// 1) 规则可订阅主题必须是 outbox 主题白名单的子集（跨契约不变式）。
const missing = RULE_EVENT_TOPICS.filter((topic) => !OUTBOX_TOPICS.includes(topic));
check("RULE_EVENT_TOPICS 是 OUTBOX_TOPICS 的子集", missing.length === 0, missing.length ? "缺：" + missing.join(", ") : RULE_EVENT_TOPICS.length + " 个主题全部在册");

// 2) 状态四值与库侧 CHECK ck_outbox_status 同值（读 0001 迁移文本，静态旁证）。
const sql = readFileSync(new URL("../../database/migrations/0001_baseline.sql", import.meta.url), "utf8");
const row = sql.split("\n").find((line) => line.indexOf("ck_outbox_status") >= 0) || "";
const dbValues = (row.match(new RegExp("'([a-z]+)'", "g")) || []).map((token) => token.split("'").join(""));
const sameSet = dbValues.length === OUTBOX_STATUSES.length && OUTBOX_STATUSES.every((value, index) => value === dbValues[index]);
check("状态与库侧 CHECK 同值同序", sameSet, "契约为 [" + OUTBOX_STATUSES.join(", ") + "] / 库侧为 [" + dbValues.join(", ") + "]");

// 3) 幂等执行键：既有实况样例 + 构造器输出都过形态（三段为基础，按主题语义可追加段）。
const entityId = "6f1f4d3a-0000-4000-8000-000000000000";
const samples = [
  ["事件型（状态版本段）", "task.completed:" + entityId + ":v7"],
  ["存量裸版本段（task.*）", "task.completed:" + entityId + ":3"],
  ["调度型规则（日期窗口）", "A01:" + entityId + ":2026-09-24"],
  ["调度型规则（ISO 周窗口）", "R07:" + entityId + ":2026-W39"],
  ["预览任务（三元组追加段）", "preview.job:9f2c0b7d1a4e8c6f:2026.09.1:pdf"],
];
for (const [name, key] of samples) {
  const parsed = OutboxDedupeKeySchema.safeParse(key);
  check("键形态 · " + name, parsed.success, parsed.success ? key : "非法：" + key);
}
check("键形态 · 反例（缺窗口段）被拒", !OUTBOX_DEDUPE_KEY_PATTERN.test("task.completed:" + entityId));

// 4) 状态回退再生窗口：同实体同窗口同版本 = 同键（不重发）；版本推进 = 新键（可再投递）。
const first = outboxDedupeKey("task.completed", entityId, stateVersionWindow(7));
const again = outboxDedupeKey("task.completed", entityId, stateVersionWindow(7));
const regenerated = outboxDedupeKey("task.completed", entityId, stateVersionWindow(8));
check("同窗口同版本 → 同键（幂等不重发）", first === again, first);
check("状态回退后版本推进 → 新键（再生）", first !== regenerated, first + " 与 " + regenerated + " 不同");
check("状态版本窗口键形态 v{n}", stateVersionWindow(7) === "v7" && stateVersionWindow(0) === "v0", "v7 / v0");

// 5) 调度口径常量自证（ADR-005：单活调度器 + 每分钟 tick；补发跨度为正整数天）。
check("调度器单活锁名非空", typeof OUTBOX_SCHEDULER.lockName === "string" && OUTBOX_SCHEDULER.lockName.length > 0, OUTBOX_SCHEDULER.lockName);
check("tick = 60000ms（ADR-005 每分钟）", OUTBOX_SCHEDULER.tickMs === 60000, String(OUTBOX_SCHEDULER.tickMs));
check("补发跨度为正整数天", Number.isInteger(OUTBOX_SCHEDULER.catchupMaxDays) && OUTBOX_SCHEDULER.catchupMaxDays > 0, String(OUTBOX_SCHEDULER.catchupMaxDays));

console.log("");
console.log("汇总：PASS " + pass + " / FAIL " + fail);
process.exit(fail === 0 ? 0 : 1);
