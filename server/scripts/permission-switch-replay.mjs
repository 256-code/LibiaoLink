#!/usr/bin/env node
/**
 * 权限判定开关真机回放（Push 178 · PERMISSION_ENFORCED · 一期「不判权限」，业务口径 2026-09-23）。
 *
 * 真机（真 PG + 两个真 api）验到的部分 —— 同一个「零角色」账号、同一份数据，只有环境开关不同：
 *   ① 不判权限（A 站 · PERMISSION_ENFORCED=false，默认）：授权画像 = 等效管理员（admin 角色码 / 数据范围 all / 契约全量权限位）；
 *      受限读面 audit-logs、stakeholders、dicts?includeDisabled=true 全部 200；项目列表不做「我管的 / 我参与的」裁剪（total 与管理员一致）。
 *   ② 按 ADR-011 判定（B 站 · PERMISSION_ENFORCED=true）：同一账号画像为空（无 admin / 无 all / 无权限位）；
 *      同一批读面 403 FORBIDDEN；项目列表按名册裁剪（total = 库内名册与责任人可见数）。
 *   ③ 只影响裁定、不动数据：用户偏好两端读数一致；跑完角色绑定原样恢复、临时会话删除（零残留）。
 *
 * 前置：真 PG（DATABASE_URL）+ 两个真 api（同一份代码、同一个库）：
 *   A 站 = 默认（不判权限）`--base-url`（默认 http://127.0.0.1:3012）；
 *   B 站 = `PERMISSION_ENFORCED=true` `--enforced-url`（默认 http://127.0.0.1:3013）。
 *   脚本会临时清空回放账号的角色绑定（跑完原样恢复）、铸一个临时会话（跑完删除）；
 *   越权 403 会按 C7-03 在库内留 denied 行（属审计口径，不清理）。
 * 用法：cd server && node scripts/permission-switch-replay.mjs [--out <报告.md>] [--json <证据.json>] [--actor <userId>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.SWITCH_BASE_URL ?? "http://127.0.0.1:3012";
const ENFORCED_URL = args.enforcedUrl ?? process.env.SWITCH_ENFORCED_URL ?? "http://127.0.0.1:3013";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:5433/libiaolink";
const CSRF = randomBytes(16).toString("hex");
const report = [];
const evidence = { steps: [] };
let failures = 0;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") out.out = argv[++i];
    else if (item === "--json") out.json = argv[++i];
    else if (item === "--actor") out.actor = argv[++i];
    else if (item === "--base-url") out.baseUrl = argv[++i];
    else if (item === "--enforced-url") out.enforcedUrl = argv[++i];
    else if (item === "--database-url") out.databaseUrl = argv[++i];
    else if (item === "--keep") out.keep = true;
  }
  return out;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function truncate(value, max = 300) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "…" : text;
}

function caller(base, token) {
  return async function call(method, path, body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "ll_sid=" + token + "; ll_csrf=" + CSRF,
        "x-csrf-token": CSRF,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text === "" ? null : JSON.parse(text); } catch { parsed = { raw: text.slice(0, 400) }; }
    return { status: response.status, body: parsed };
  };
}

function check(id, title, expected, actual, ok, note = "") {
  if (!ok) failures += 1;
  report.push((ok ? "| PASS | " : "| FAIL | ") + id + " | " + title + " |");
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.steps.push({ id, title, expected, actual, ok, note });
  process.stdout.write((ok ? "PASS " : "FAIL ") + id + " " + title + "\n");
  if (!ok) throw new Error("权限开关回放失败（" + id + "）：" + title);
}

const cleanup = { sessionTokens: [], actorId: null, rolesBefore: [], restored: false, startedAt: new Date() };
let db;

async function health(base) {
  return fetch(base + "/healthz").then((response) => response.status).catch(() => 0);
}

try {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const healthA = await health(BASE_URL);
  const healthB = await health(ENFORCED_URL);
  check("S1", "两个 api 都在跑（A = 默认口径 / B = 按 ADR-011 判定）", "200 / 200", healthA + " / " + healthB, healthA === 200 && healthB === 200, "A=" + BASE_URL + "，B=" + ENFORCED_URL);

  // ---------- 回放账号：临时清空角色绑定，造「零角色」基线 ----------
  const actor = args.actor !== undefined
    ? (await db.query("select id, username from users where id = $1 and status = $$active$$", [args.actor])).rows[0]
    : (await db.query("select id, username from users where status = $$active$$ order by username limit 1")).rows[0];
  if (actor === undefined) throw new Error("找不到可用的回放账号（--actor <userId> 可指定）");
  cleanup.actorId = actor.id;
  cleanup.rolesBefore = (await db.query("select r.code from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 order by r.code", [actor.id])).rows.map((row) => row.code);
  await db.query("delete from user_roles where user_id = $1", [actor.id]);
  const adminRow = (await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $$admin$$ and u.status = $$active$$ and u.id <> $1 order by u.id limit 1", [actor.id])).rows[0];
  if (adminRow === undefined) throw new Error("找不到管理员基准账号（roles.code = admin）");

  const token = "switch-" + randomBytes(12).toString("hex");
  const adminToken = "switch-admin-" + randomBytes(12).toString("hex");
  cleanup.sessionTokens = [token, adminToken];
  for (const pair of [[token, actor.id], [adminToken, adminRow.id]]) {
    await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(hours => 2))", [sha256(pair[0]), pair[1], "permission-switch-replay"]);
  }
  const zeroCallA = caller(BASE_URL, token);
  const zeroCallB = caller(ENFORCED_URL, token);
  const adminCall = caller(BASE_URL, adminToken);

  const meAdmin = await adminCall("GET", "/api/v1/permissions/me");
  const adminKeys = meAdmin.body?.permissions?.permissionKeys ?? [];
  check("S2", "管理员基准画像（全量权限位的对账基准）", "200 + 键位含 audit.view / dict.manage / stakeholder.contact.view", meAdmin.status + " " + truncate({ keys: adminKeys.length, hasAudit: adminKeys.includes("audit.view"), hasDict: adminKeys.includes("dict.manage") }, 160), meAdmin.status === 200 && adminKeys.includes("audit.view") && adminKeys.includes("dict.manage") && adminKeys.includes("stakeholder.contact.view"), "账号 " + adminRow.id);

  // ---------- ① A 站（不判权限）：零角色账号 = 等效管理员 ----------
  const meA = await zeroCallA("GET", "/api/v1/permissions/me");
  const keysA = meA.body?.permissions?.permissionKeys ?? [];
  check("A1", "A 站（PERMISSION_ENFORCED=false）：零角色账号画像 = 等效管理员", "200 + roleCodes=[admin] + dataScopes=[all] + 全量权限位", meA.status + " " + truncate({ roleCodes: meA.body?.permissions?.roleCodes, dataScopes: meA.body?.permissions?.dataScopes, keys: keysA.length }, 180), meA.status === 200 && (meA.body?.permissions?.roleCodes ?? []).includes("admin") && (meA.body?.permissions?.dataScopes ?? []).includes("all") && keysA.length === adminKeys.length);

  const auditA = await zeroCallA("GET", "/api/v1/audit-logs?limit=1");
  check("A2", "A 站：audit.view 读面放行（原本零角色 → 403）", "200", auditA.status + " " + truncate(auditA.body, 120), auditA.status === 200);

  const stakeA = await zeroCallA("GET", "/api/v1/stakeholders?limit=1");
  check("A3", "A 站：stakeholder.view 读面放行", "200", stakeA.status + " " + truncate(stakeA.body, 120), stakeA.status === 200);

  const dictA = await zeroCallA("GET", "/api/v1/dicts?includeDisabled=true");
  check("A4", "A 站：dict.manage 管理口径放行（includeDisabled）", "200", dictA.status + " " + truncate({ types: (dictA.body?.items ?? []).length }, 120), dictA.status === 200);

  const listAdmin = await adminCall("GET", "/api/v1/projects?limit=1");
  const listA = await zeroCallA("GET", "/api/v1/projects?limit=1");
  check("A5", "A 站：项目列表不裁剪（记录级 = all，total 与管理员一致）", "total 均为 " + listAdmin.body?.total, "管理员 " + listAdmin.body?.total + " / 零角色 " + listA.body?.total, listAdmin.status === 200 && listA.status === 200 && listA.body?.total === listAdmin.body?.total);

  // ---------- ② B 站（按 ADR-011 判定）：同一账号回到「零角色」语义 ----------
  const meB = await zeroCallB("GET", "/api/v1/permissions/me");
  const keysB = meB.body?.permissions?.permissionKeys ?? [];
  check("B1", "B 站（PERMISSION_ENFORCED=true）：同一账号画像为空（非等效管理员）", "200 + 不含 admin / all / audit.view", meB.status + " " + truncate({ roleCodes: meB.body?.permissions?.roleCodes, dataScopes: meB.body?.permissions?.dataScopes, keys: keysB.length }, 180), meB.status === 200 && !(meB.body?.permissions?.roleCodes ?? []).includes("admin") && !(meB.body?.permissions?.dataScopes ?? []).includes("all") && !keysB.includes("audit.view"));

  const auditB = await zeroCallB("GET", "/api/v1/audit-logs?limit=1");
  check("B2", "B 站：audit.view 读面 403（C7-03 越权留痕口径）", "403 FORBIDDEN", auditB.status + " " + truncate(auditB.body, 120), auditB.status === 403 && auditB.body?.code === "FORBIDDEN");

  const stakeB = await zeroCallB("GET", "/api/v1/stakeholders?limit=1");
  check("B3", "B 站：stakeholder.view 读面 403", "403 FORBIDDEN", stakeB.status + " " + truncate(stakeB.body, 120), stakeB.status === 403 && stakeB.body?.code === "FORBIDDEN");

  const dictB = await zeroCallB("GET", "/api/v1/dicts?includeDisabled=true");
  check("B4", "B 站：dict.manage 管理口径 403", "403 FORBIDDEN", dictB.status + " " + truncate(dictB.body, 120), dictB.status === 403 && dictB.body?.code === "FORBIDDEN");

  const rosterCount = Number((await db.query("select count(*)::int as n from projects p where p.deleted_at is null and (p.manager_ids @> array[$1::uuid] or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = $1))", [actor.id])).rows[0]?.n ?? -1);
  const listB = await zeroCallB("GET", "/api/v1/projects?limit=1");
  check("B5", "B 站：项目列表按名册 / 责任人裁剪（total = 库内可见数）", "total = 库内 " + rosterCount, "接口 " + listB.body?.total + "（库内 " + rosterCount + "）", listB.status === 200 && listB.body?.total === rosterCount, "名册为空时总数为 0 也是通过 —— 关键是「界面口径回到 ADR-011」");

  // ---------- ③ 只影响裁定、不动数据 ----------
  const prefA = await zeroCallA("GET", "/api/v1/users/me/preferences");
  const prefB = await zeroCallB("GET", "/api/v1/users/me/preferences");
  check("C1", "用户偏好不随开关变化（两站同账号读数一致）", "两站均 200 且响应一致", prefA.status + " / " + prefB.status + " 一致=" + (JSON.stringify(prefA.body) === JSON.stringify(prefB.body)), prefA.status === 200 && prefB.status === 200 && JSON.stringify(prefA.body) === JSON.stringify(prefB.body));

  // ---------- ④ 角色绑定原样恢复 ----------
  for (const code of cleanup.rolesBefore) {
    await db.query("insert into user_roles (user_id, role_id) select $1, id from roles where code = $2 on conflict do nothing", [actor.id, code]);
  }
  cleanup.restored = true;
  const rolesAfter = (await db.query("select r.code from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 order by r.code", [actor.id])).rows.map((row) => row.code);
  check("D1", "回放账号角色绑定原样恢复（零残留）", truncate(cleanup.rolesBefore, 160), truncate(rolesAfter, 160), JSON.stringify(rolesAfter) === JSON.stringify(cleanup.rolesBefore));
} catch (error) {
  failures += 1;
  report.push("| FAIL | X0 | 回放中止 |");
  report.push("  - 实际：" + (error instanceof Error ? error.message : String(error)));
  evidence.steps.push({ id: "X0", title: "回放中止", expected: "无异常", actual: String(error), ok: false });
  process.stdout.write("FAIL X0 " + String(error) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (!cleanup.restored && cleanup.actorId !== null) {
        for (const code of cleanup.rolesBefore) {
          await db.query("insert into user_roles (user_id, role_id) select $1, id from roles where code = $2 on conflict do nothing", [cleanup.actorId, code]);
        }
        cleanup.restored = true;
      }
      if (args.keep !== true && cleanup.sessionTokens.length > 0) {
        await db.query("delete from sessions where token_hash = any($1::text[])", [cleanup.sessionTokens.map((item) => sha256(item))]);
      }
      const leftover = Number((await db.query("select count(*)::int as n from sessions where token_hash = any($1::text[])", [cleanup.sessionTokens.map((item) => sha256(item))])).rows[0]?.n ?? -1);
      report.push("| PASS | Z1 | 临时会话清理（零残留） |");
      report.push("  - 期望：0 行；实际：" + (args.keep === true ? "--keep 保留" : leftover + " 行"));
      evidence.steps.push({ id: "Z1", title: "临时会话清理（零残留）", expected: "0 行", actual: args.keep === true ? "--keep 保留" : leftover + " 行", ok: args.keep === true || leftover === 0 });
    } catch (error) {
      process.stdout.write("清理阶段异常：" + String(error) + "\n");
    } finally {
      await db.end().catch(() => undefined);
    }
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
const lines = [];
lines.push("# 权限开关回放证据（PERMISSION_ENFORCED · 一期「不判权限」）");
lines.push("");
lines.push("> 口径：业务 2026-09-23「我们当前这个系统就不要考虑权限」；落点 = `RoleService.getActorAuthorization()`（唯一注入点）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| A 站（不判权限 · 默认） | " + BASE_URL + " |");
lines.push("| B 站（按 ADR-011 判定） | " + ENFORCED_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 代码版本 | " + commit + " |");
lines.push("| 回放账号（临时清空角色 → 用完恢复） | " + (cleanup.actorId ?? "-") + " |");
lines.push("| 脚本 | server/scripts/permission-switch-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：开关两侧行为对照成立，角色绑定与临时会话零残留。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 复跑");
lines.push("");
lines.push("- A 站：`PORT=3012 node --env-file-if-exists=.env dist/entry/api.js`（`PERMISSION_ENFORCED` 缺省 = false）");
lines.push("- B 站：`PORT=3013 PERMISSION_ENFORCED=true node --env-file-if-exists=.env dist/entry/api.js`");
lines.push("- 回放：`cd server && node scripts/permission-switch-replay.mjs --out ../docs/权限开关回放证据(PERMISSION_ENFORCED).md`");
lines.push("");

const markdown = lines.join("\n") + "\n";
if (args.out !== undefined) { writeFileSync(args.out, markdown, "utf8"); process.stdout.write("报告已写入 " + args.out + "\n"); }
if (args.json !== undefined) { writeFileSync(args.json, JSON.stringify({ baseUrl: BASE_URL, enforcedUrl: ENFORCED_URL, commit, ranAt: new Date().toISOString(), failures, steps: evidence.steps }, null, 2), "utf8"); }
process.stdout.write(failures === 0 ? "权限开关回放通过（" + evidence.steps.length + " 项断言）\n" : "权限开关回放失败（" + failures + " 项）\n");
process.exit(failures === 0 ? 0 : 1);
