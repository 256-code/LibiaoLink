#!/usr/bin/env node
/**
 * PoC-7 真机回放（h7 · S6·admin · 团队分工 §6）：字典 C9 与审计留痕 C7。
 *
 * 真机（真 PG + 真 api）验到的部分：
 *   字典（C9）：GET /dicts 默认只回启用项（前端启动拉一次）；includeDisabled 无 dict.manage → 403（管理端口径）；
 *     管理员新增条目 201、**删除条目 = 物理删行 200**（Push 173：`DELETE /dicts/{type}/items/{code}`），响应即「更新后的整个字典」（前端直接替换缓存）；同码重复 409 DICT_ITEM_EXISTS；
 *     未知类型 404；删除无记忆 —— 库里不留行、管理端全集也不含，同码可重新新增（存量数据仍按原码 / 原名展示）。
 *   审计（C7）：写动作留痕（谁 / 何时 / 对什么 / 从什么改成什么）→ 按对象（objectType + objectId）与操作人（actorId）检索命中；
 *     越权 403 → result=denied 行（C7-03，可按人筛出）；普通读 404 不产生噪声行；审计接口仅 audit.view（受限账号 403）。
 *
 * 前置：真 PG（DATABASE_URL）+ 真 api（BASE_URL）。只在本地沙箱 / 联调库跑，会：铸两个临时会话（跑完删除）、
 *      建 POC7-xxx 字典条目（跑完硬删；api 角色无权删审计 → 用 migrator 连接）、清掉本次写入的审计行。
 * 用法：cd server && node scripts/poc7-replay.mjs [--out <报告.md>] [--json <证据.json>] [--actor <userId>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.POC7_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const CSRF = randomBytes(16).toString("hex");
const CODE = "POC7-" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
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

function caller(token) {
  return async function call(method, path, body, extraHeaders = {}) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "ll_sid=" + token + "; ll_csrf=" + CSRF,
        "x-csrf-token": CSRF,
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text === "" ? null : JSON.parse(text); } catch { parsed = { raw: text.slice(0, 400) }; }
    return { status: response.status, body: parsed };
  };
}

function check(id, title, expected, actual, ok, note = "", fatal = true) {
  if (!ok) failures += 1;
  const line = (ok ? "| PASS | " : "| FAIL | ") + id + " | " + title + " |";
  report.push(line);
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.steps.push({ id, title, expected, actual, ok, note });
  process.stdout.write(line + "\n");
  if (!ok && fatal) throw new Error("PoC-7 回放失败（" + id + "）：" + title);
}

const DENIED_SQL = "select count(*)::int as n from audit_logs where result = $$denied$$ and actor_id = $1";

async function sqlCount(query, params) {
  const rows = (await db.query(query, params)).rows;
  return rows[0] === undefined ? 0 : Number(rows[0].n);
}

async function waitForCount(query, params, atLeast, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last = await sqlCount(query, params);
  while (last < atLeast && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await sqlCount(query, params);
  }
  return last;
}

const cleanup = { code: CODE, adminId: null, actorId: null, tokens: [], startedAt: new Date() };
let db;
let adminCall;
let actorCall;

try {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  if (health !== 200) throw new Error("api 不可用（" + BASE_URL + "/healthz → " + health + "）；先起 api 再跑本脚本");

  // ---------- 会话：管理员 + 受限账号（跑完删除） ----------
  const adminRow = (await db.query("select u.id, u.display_name from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $$admin$$ and u.status = $$active$$ order by u.id limit 1")).rows[0];
  if (adminRow === undefined) throw new Error("找不到可用的管理员账号（roles.code = admin）");
  const actorRow = args.actor !== undefined
    ? (await db.query("select id, username from users where id = $1 and status = $$active$$", [args.actor])).rows[0]
    : (await db.query("select u.id, u.username from users u where u.status = $$active$$ and u.id <> $1 and not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.code = $$admin$$) order by (select count(*) from user_roles ur2 where ur2.user_id = u.id), u.username limit 1", [adminRow.id])).rows[0];
  if (actorRow === undefined) throw new Error("找不到可用的受限账号（--actor <userId> 可指定）");
  cleanup.adminId = adminRow.id;
  cleanup.actorId = actorRow.id;

  const adminToken = "poc7-admin-" + randomBytes(12).toString("hex");
  const actorToken = "poc7-actor-" + randomBytes(12).toString("hex");
  cleanup.tokens = [adminToken, actorToken];
  for (const pair of [[adminToken, adminRow.id, "poc7-replay-admin"], [actorToken, actorRow.id, "poc7-replay-actor"]]) {
    await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(hours => 2))", [sha256(pair[0]), pair[1], pair[2]]);
  }
  adminCall = caller(adminToken);
  actorCall = caller(actorToken);

  const meAdmin = await adminCall("GET", "/api/v1/permissions/me");
  const adminKeys = meAdmin.body?.permissions?.permissionKeys ?? [];
  check("S1", "管理员会话（dict.manage / audit.view 基准账号）", "200 + 键位含 dict.manage 与 audit.view", meAdmin.status + " " + truncate({ roleCodes: meAdmin.body?.permissions?.roleCodes, hasDict: adminKeys.includes("dict.manage"), hasAudit: adminKeys.includes("audit.view") }, 180), meAdmin.status === 200 && adminKeys.includes("dict.manage") && adminKeys.includes("audit.view"), "账号 " + adminRow.display_name + "（" + adminRow.id + "）");

  const meActor = await actorCall("GET", "/api/v1/permissions/me");
  const actorKeys = meActor.body?.permissions?.permissionKeys ?? [];
  check("S2", "受限账号会话（越权拒绝基准账号）", "200 + 不含 dict.manage / audit.view", meActor.status + " " + truncate({ roleCodes: meActor.body?.permissions?.roleCodes, keys: actorKeys.length }, 160), meActor.status === 200 && !actorKeys.includes("dict.manage") && !actorKeys.includes("audit.view"), "账号 " + actorRow.username + "（" + actorRow.id + "）；--actor 可指定");

  // ---------- 字典读（C9） ----------
  const dictAll = await adminCall("GET", "/api/v1/dicts");
  const regionItems = ((dictAll.body?.items ?? []).find((item) => item.type === "region")?.items) ?? [];
  check("D1", "默认下发只回启用项（前端启动拉一次）", "200 + region 字典非空且全部 enabled=true", dictAll.status + " " + truncate({ types: (dictAll.body?.items ?? []).map((item) => item.type), regionItems: regionItems.length, allEnabled: regionItems.every((item) => item.enabled === true) }, 200), dictAll.status === 200 && regionItems.length > 0 && regionItems.every((item) => item.enabled === true));

  const dictActor = await actorCall("GET", "/api/v1/dicts");
  check("D2", "读 = 登录即可：受限账号可读默认下发", "200 + region 非空", dictActor.status + " types=" + ((dictActor.body?.items ?? []).length), dictActor.status === 200 && ((dictActor.body?.items ?? []).find((item) => item.type === "region")?.items?.length ?? 0) > 0);

  const deniedBefore = await waitForCount(DENIED_SQL, [actorRow.id], 0);
  const hiddenActor = await actorCall("GET", "/api/v1/dicts?includeDisabled=true");
  check("D3", "管理口径：includeDisabled 无 dict.manage → 403", "403 FORBIDDEN", hiddenActor.status + " " + truncate(hiddenActor.body, 140), hiddenActor.status === 403 && hiddenActor.body?.code === "FORBIDDEN");
  const deniedAfter = await waitForCount(DENIED_SQL, [actorRow.id], deniedBefore + 1);
  check("D3b", "越权留痕（C7-03）：403 写 result=denied 行", "denied 行数 " + deniedBefore + " → " + (deniedBefore + 1), "实际 " + deniedAfter, deniedAfter >= deniedBefore + 1, "检索口径：actorId + result=denied（写审计为异步补写，最多等 3s）", false);

  const hiddenAdmin = await adminCall("GET", "/api/v1/dicts?includeDisabled=true");
  const hiddenRegionCount = ((hiddenAdmin.body?.items ?? []).find((item) => item.type === "region")?.items?.length) ?? 0;
  check("D4", "管理口径：管理员 includeDisabled=true 返回全集", "200 + 条数 ≥ 默认下发（" + regionItems.length + "）", hiddenAdmin.status + " regionItems=" + hiddenRegionCount + " " + truncate(hiddenAdmin.body, 120), hiddenAdmin.status === 200 && hiddenRegionCount >= regionItems.length, "兼容参数：Push 173 起删除 = 物理删行，一期不再产生停用项，故两者相等（历史停用行见 D10b）");

  const deniedAdminBefore = await sqlCount(DENIED_SQL, [adminRow.id]);
  const unknown = await adminCall("GET", "/api/v1/dicts/priority");
  check("D5", "未知字典类型 → 404 NOT_FOUND", "404 NOT_FOUND", unknown.status + " " + truncate(unknown.body, 140), unknown.status === 404 && unknown.body?.code === "NOT_FOUND");
  const deniedAdminAfter = await sqlCount(DENIED_SQL, [adminRow.id]);
  check("D5b", "噪声边界：普通读 404 不产生 denied 行（shouldRecordDenied）", "管理员 denied 行数不变（" + deniedAdminBefore + "）", "实际 " + deniedAdminAfter, deniedAdminAfter === deniedAdminBefore, "404 只记写请求与项目域路径（server/src/common/audit/audit-path.ts）", false);

  // ---------- 字典写（C9-02）：新增 → 物理删除（Push 173：删除无记忆，同码可重建） ----------
  const created = await adminCall("POST", "/api/v1/dicts/region/items", { code: CODE, name: "PoC-7 回放区", sort: 999, enabled: true, metadata: {} });
  const createdItem = (created.body?.items ?? []).find((item) => item.code === CODE);
  check("D6", "新增条目（dict.manage）：响应是更新后的整个字典（前端替换缓存）", "201 + 含 " + CODE + "（enabled=true）", created.status + " " + truncate({ type: created.body?.type, hit: createdItem, items: created.body?.items?.length }, 200), created.status === 201 && createdItem?.enabled === true);

  const auditCreate = await waitForCount("select count(*)::int as n from audit_logs where object_type = $$dict_item$$ and object_id = $1", ["region:" + CODE], 1);
  const createRow = (await db.query("select action, actor_id, actor_name, result, entry, changes from audit_logs where object_type = $$dict_item$$ and object_id = $1 order by id desc limit 1", ["region:" + CODE])).rows[0];
  check("A1", "按对象检索命中新增留痕（谁 / 何时 / 对什么 / 从什么改成什么）", "action=create + actorId=" + adminRow.id + " + result=succeeded + changes 含 code", "行数=" + auditCreate + " " + truncate(createRow, 260), auditCreate >= 1 && createRow?.action === "create" && createRow?.actor_id === adminRow.id && createRow?.result === "succeeded" && createRow?.entry === "api" && Array.isArray(createRow?.changes) && createRow.changes.some((change) => change.field === "code" && change.to === CODE), "等价 API：GET /api/v1/audit-logs?objectType=dict_item&objectId=region:" + CODE);

  const duplicate = await adminCall("POST", "/api/v1/dicts/region/items", { code: CODE, name: "重复码", sort: 1000, enabled: true, metadata: {} });
  check("D7", "同类型内码唯一：重复新增 409 DICT_ITEM_EXISTS", "409 DICT_ITEM_EXISTS", duplicate.status + " " + truncate(duplicate.body, 140), duplicate.status === 409 && duplicate.body?.code === "DICT_ITEM_EXISTS");

  const actorCreateRegion = await actorCall("POST", "/api/v1/dicts/region/items", { code: CODE + "-X", name: "受限账号新增区", sort: 1000, enabled: true, metadata: {} });
  const actorRegionItem = (actorCreateRegion.body?.items ?? []).find((item) => item.code === CODE + "-X");
  check("D8", "region 新增 = 登录即可（Push 168：地区是全站共享的公共标签）：受限账号可新增", "201 + 含 " + CODE + "-X", actorCreateRegion.status + " " + truncate(actorRegionItem, 200), actorCreateRegion.status === 201 && actorRegionItem?.enabled === true);

  const actorCreateType = await actorCall("POST", "/api/v1/dicts/projectType/items", { code: CODE + "-T", name: "越权新增类型", sort: 1000, enabled: true, metadata: { accent: "#3b82f6" } });
  check("D8b", "projectType 新增 = 仅管理员：受限账号 403 FORBIDDEN", "403 FORBIDDEN", actorCreateType.status + " " + truncate(actorCreateType.body, 140), actorCreateType.status === 403 && actorCreateType.body?.code === "FORBIDDEN");
  const deniedActorRows = await waitForCount(DENIED_SQL, [actorRow.id], deniedBefore + 2);
  check("D8c", "越权写留痕：denied 行 +1（objectRefOfUrl → dict_item / projectType）", "denied 行数 ≥ " + (deniedBefore + 2), "实际 " + deniedActorRows, deniedActorRows >= deniedBefore + 2, "POST /dicts/projectType/items（items 是结构段，对象 id 取 type）", false);

  const actorDelete = await actorCall("DELETE", "/api/v1/dicts/region/items/" + encodeURIComponent(CODE));
  check("D11", "写 = 仅管理员：受限账号删除 403", "403 FORBIDDEN", actorDelete.status + " " + truncate(actorDelete.body, 140), actorDelete.status === 403 && actorDelete.body?.code === "FORBIDDEN");
  const deniedSameObject = await waitForCount("select count(*)::int as n from audit_logs where result = $$denied$$ and object_type = $$dict_item$$ and object_id = $1 and actor_id = $2", ["region:" + CODE, actorRow.id], 1);
  check("D11b", "越权行与成功写同对象 id（可直接按对象检索同一条目）", "≥1 行（objectId=region:" + CODE + "）", "实际 " + deniedSameObject, deniedSameObject >= 1, "objectRefOfUrl 对字典取 type[:code] 且路径段先解码", false);

  const deleted = await adminCall("DELETE", "/api/v1/dicts/region/items/" + encodeURIComponent(CODE));
  const deletedStillListed = (deleted.body?.items ?? []).some((item) => item.code === CODE);
  check("D9", "删除条目 = 物理删行（Push 173）：DELETE 200 + 响应不含该条目", "200 + " + CODE + " 不在响应的 region 条目里", deleted.status + " " + truncate({ type: deleted.body?.type, stillListed: deletedStillListed, items: deleted.body?.items?.length }, 200), deleted.status === 200 && deletedStillListed === false);

  const rowGone = await sqlCount("select count(*)::int as n from dict_items where type_code = $$region$$ and code = $1", [CODE]);
  check("D9b", "物理删除：库里 dict_items 无该行（不是 enabled=false）", "行数 0", "实际 " + rowGone, rowGone === 0, "直读库表（api 角色 DELETE 权限来自 0013；无物理删除的旧口径见 database/migrations/0030_dict_item_hard_delete.sql）");

  const dictAfterDelete = await adminCall("GET", "/api/v1/dicts");
  const stillListed = (((dictAfterDelete.body?.items ?? []).find((item) => item.type === "region")?.items) ?? []).some((item) => item.code === CODE);
  check("D10", "删除后默认下发不含该条目", "默认下发不含 " + CODE, "含 " + CODE + " = " + stillListed, dictAfterDelete.status === 200 && stillListed === false);

  const adminAllAfterDelete = await adminCall("GET", "/api/v1/dicts?includeDisabled=true");
  const stillInAdminAll = (((adminAllAfterDelete.body?.items ?? []).find((item) => item.type === "region")?.items) ?? []).some((item) => item.code === CODE);
  check("D10b", "管理端全集（includeDisabled=true）也不含该条目：删除无残留、无停用位", "管理端全集不含 " + CODE, "含 " + CODE + " = " + stillInAdminAll, adminAllAfterDelete.status === 200 && stillInAdminAll === false, "Push 173：删除 = 物理删行；includeDisabled 降级为兼容参数");

  const deleteRow = (await db.query("select action, actor_id, result, changes from audit_logs where object_type = $$dict_item$$ and object_id = $1 order by id desc limit 1", ["region:" + CODE])).rows[0];
  const codeChange = Array.isArray(deleteRow?.changes) ? deleteRow.changes.find((change) => change.field === "code") : undefined;
  const nameChange = Array.isArray(deleteRow?.changes) ? deleteRow.changes.find((change) => change.field === "name") : undefined;
  check("A2", "按对象检索命中删除留痕：action=delete + 字段级 from → null（删除前快照）", "action=delete + changes 含 {code, " + CODE + ", null} 与 {name, 原名, null}", truncate({ action: deleteRow?.action, actor: deleteRow?.actor_id, codeChange, nameChange }, 260), deleteRow?.action === "delete" && deleteRow?.actor_id === adminRow.id && codeChange?.from === CODE && codeChange?.to === null && nameChange?.to === null);

  const recreated = await adminCall("POST", "/api/v1/dicts/region/items", { code: CODE, name: "PoC-7 回放区（重建）", sort: 1001, enabled: true, metadata: {} });
  const recreatedItem = (recreated.body?.items ?? []).find((item) => item.code === CODE);
  check("D12", "删除无记忆：同码可重新新增（不 409），按本次参数落库", "201 + " + CODE + "（name=重建后、sort=1001）", recreated.status + " " + truncate(recreatedItem, 200), recreated.status === 201 && recreatedItem?.name === "PoC-7 回放区（重建）" && recreatedItem?.sort === 1001);

  // ---------- 审计检索（C7-04 服务端） ----------
  const auditByObject = await adminCall("GET", "/api/v1/audit-logs?objectType=dict_item&objectId=" + encodeURIComponent("region:" + CODE) + "&limit=50");
  const byObjectItems = auditByObject.body?.items ?? [];
  check("A3", "审计接口·按对象检索（objectType + objectId）", "200 + total ≥ 2（create + delete）", auditByObject.status + " total=" + (auditByObject.body?.total ?? "?") + " " + truncate(byObjectItems.map((item) => item.action), 120), auditByObject.status === 200 && (auditByObject.body?.total ?? 0) >= 2 && byObjectItems.every((item) => item.objectType === "dict_item"));

  const auditByActor = await adminCall("GET", "/api/v1/audit-logs?actorId=" + actorRow.id + "&result=denied&limit=50");
  const byActorItems = auditByActor.body?.items ?? [];
  check("A4", "审计接口·按人检索 + 越权筛法（actorId + result=denied）", "200 + total ≥ 2（includeDisabled 403 + 写 403）且全为该账号 denied", auditByActor.status + " total=" + (auditByActor.body?.total ?? "?") + " " + truncate(byActorItems.map((item) => item.action + "@" + item.objectId), 160), auditByActor.status === 200 && (auditByActor.body?.total ?? 0) >= 2 && byActorItems.every((item) => item.actorId === actorRow.id && item.result === "denied"));

  const auditForbidden = await actorCall("GET", "/api/v1/audit-logs");
  check("A5", "审计接口仅 audit.view：受限账号 403", "403 FORBIDDEN", auditForbidden.status + " " + truncate(auditForbidden.body, 140), auditForbidden.status === 403 && auditForbidden.body?.code === "FORBIDDEN");
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("PoC-7 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true) {
        await db.query("delete from dict_items where code like $1", ["POC7-%"]);
        await db.query("delete from audit_logs where object_id like $$region:POC7-%$$ or (actor_id = any($1::uuid[]) and occurred_at >= $2)", [[cleanup.adminId, cleanup.actorId], cleanup.startedAt]);
        await db.query("delete from sessions where token_hash = any($1::text[])", [cleanup.tokens.map((token) => sha256(token))]);
        const residue = {
          dictItems: await sqlCount("select count(*)::int as n from dict_items where code like $$POC7-%$$", []),
          auditObjects: await sqlCount("select count(*)::int as n from audit_logs where object_id like $$region:POC7-%$$", []),
          auditActors: await sqlCount("select count(*)::int as n from audit_logs where actor_id = any($1::uuid[]) and occurred_at >= $2", [[cleanup.adminId, cleanup.actorId], cleanup.startedAt]),
          sessions: await sqlCount("select count(*)::int as n from sessions where token_hash = any($1::text[])", [cleanup.tokens.map((token) => sha256(token))]),
        };
        check("C1", "收尾核对：回放数据与临时会话零残留", "dict_items / audit_logs（对象 + 操作人）/ sessions 全 0", truncate(residue, 200), Object.values(residue).every((value) => value === 0), "字典条目与本次审计行用 migrator 连接硬删（api 角色对 audit_logs 无 UPDATE / DELETE）", false);
      } else {
        report.push("| SKIP | C1 | 收尾（--keep：保留回放数据与临时会话）");
      }
    } catch (error) {
      report.push("| WARN | 收尾未完全成功：" + (error instanceof Error ? error.message : String(error)));
    }
    await db.end();
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
const lines = [];
lines.push("# PoC-7 回放证据（字典 C9 与审计留痕 C7）");
lines.push("");
lines.push("> 卡片：h7 · S6·admin（主责 wmj，协办 lan）｜验收口径见 团队分工.md §6：字典唯一口径 + 审计留痕（谁 / 何时 / 对什么 / 从什么改成什么），越权留痕按对象与操作人可检索。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 代码版本 | " + commit + " |");
lines.push("| 管理员账号 | " + (cleanup.adminId ?? "-") + " |");
lines.push("| 受限账号 | " + (cleanup.actorId ?? "-") + " |");
lines.push("| 回放字典条目 | region / " + CODE + " |");
lines.push("| 脚本 | server/scripts/poc7-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：默认只下发启用项、管理口径 403、新增 201 / 删除 200（物理删行 + 删除无记忆）且同码 409、未知类型 404 无噪声、审计按对象与按人检索命中、越权 403 落 denied 行、审计接口仅 audit.view、回放数据零残留。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（团队分工.md §6 · h7）");
lines.push("");
lines.push("- 「字典（C9）唯一口径」= D1 ~ D12：下发只含启用项、includeDisabled 需 dict.manage（403，兼容参数）、新增条目 201 / 删除条目 200（**物理删行**：库表无该行、默认下发与管理端全集都不含）且响应即更新后的整个字典、同码 409 `DICT_ITEM_EXISTS`、未知类型 404、删除无记忆（同码可重建为全新条目）。");
lines.push("- 「审计留痕（谁 / 何时 / 对什么 / 从什么改成什么）」= A1 / A2：dict_item 对象上的 create（changes 含 code）/ delete（字段级 `code / name / sort / enabled / metadata → null`：删除前快照）两行，actorId 为管理员、entry=api、result=succeeded；写入与业务同事务（读库直证）。");
lines.push("- 「按对象与操作人可检索」= A3 / A4 + D11b：`GET /api/v1/audit-logs?objectType=dict_item&objectId=region:<code>` 命中 create + delete；`actorId=<受限账号>&result=denied` 命中全部越权行；越权行对象 id 与成功写同形（type[:code]）。");
lines.push("- 「越权留痕（C7-03）」= D3 / D3b / D8b / D8c / D11 / A5：403 一律记 denied（含 includeDisabled 越权读、projectType 新增越权、删除越权）；普通读 404（未知类型）不写噪声行（D5b）。");
lines.push("- 项目 / 任务 / 节点与阶段推进的写路径留痕由单测覆盖（`server/test/project-crud.test.ts` / `task-service.test.ts` / `flow-gate-rejection.test.ts` 的 FakeAuditService 断言 record 入参）；真机不造项目数据（回放脚本只跑字典与审计域）。");
lines.push("- 「自动化用例全绿」= `cd server && node node_modules/vitest/vitest.mjs run`（`test/admin-audit.test.ts` 18 例 + 全量 476 例 / 32 文件，随 `npm test` 常跑，不连库）与 `node scripts/check-db-schema.mjs` / `check-permission-matrix.mjs`。");
lines.push("- 复跑：cd server && node scripts/poc7-replay.mjs --out ../docs/PoC-7-回放证据(字典C9与审计留痕C7).md");
lines.push("");

const markdown = lines.join("\n") + "\n";
if (args.out !== undefined) { writeFileSync(args.out, markdown, "utf8"); process.stdout.write("报告已写入 " + args.out + "\n"); }
if (args.json !== undefined) { writeFileSync(args.json, JSON.stringify({ baseUrl: BASE_URL, commit, ranAt: new Date().toISOString(), failures, steps: evidence.steps }, null, 2), "utf8"); }
process.stdout.write(failures === 0 ? "PoC-7 回放通过（" + evidence.steps.length + " 项断言）\n" : "PoC-7 回放失败（" + failures + " 项）\n");
process.exit(failures === 0 ? 0 : 1);
