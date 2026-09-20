# PoC-7 回放证据（字典 C9 与审计留痕 C7）

> 卡片：h7 · S6·admin（主责 wmj，协办 lan）｜验收口径见 团队分工.md §6：字典唯一口径 + 审计留痕（谁 / 何时 / 对什么 / 从什么改成什么），越权留痕按对象与操作人可检索。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-20 16:25:36 +08:00 |
| 目标 | http://127.0.0.1:3011 |
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink |
| 代码版本 | d8134d4 |
| 管理员账号 | caa8d763-4b6a-4967-9b26-7d1086272c9c |
| 受限账号 | ea6eff88-4b3e-4df1-9ce0-02ffb14fed69 |
| 回放字典条目 | region / POC7-20260920082535 |
| 脚本 | server/scripts/poc7-replay.mjs |

## 断言明细

| PASS | S1 | 管理员会话（dict.manage / audit.view 基准账号） |
  - 期望：200 + 键位含 dict.manage 与 audit.view
  - 实际：200 {"roleCodes":["admin"],"hasDict":true,"hasAudit":true}
  - 说明：账号 Zhangsan（caa8d763-4b6a-4967-9b26-7d1086272c9c）
| PASS | S2 | 受限账号会话（越权拒绝基准账号） |
  - 期望：200 + 不含 dict.manage / audit.view
  - 实际：200 {"roleCodes":[],"keys":0}
  - 说明：账号 lisi（ea6eff88-4b3e-4df1-9ce0-02ffb14fed69）；--actor 可指定
| PASS | D1 | 默认下发只回启用项（前端启动拉一次） |
  - 期望：200 + region 字典非空且全部 enabled=true
  - 实际：200 {"types":["region","projectType"],"regionItems":8,"allEnabled":true}
| PASS | D2 | 读 = 登录即可：受限账号可读默认下发 |
  - 期望：200 + region 非空
  - 实际：200 types=2
| PASS | D3 | 管理口径：includeDisabled 无 dict.manage → 403 |
  - 期望：403 FORBIDDEN
  - 实际：403 {"code":"FORBIDDEN","message":"查看停用字典项需要 dict.manage","details":[],"traceId":"2297196b-a969-419b-ba56-da388e049389"}
| PASS | D3b | 越权留痕（C7-03）：403 写 result=denied 行 |
  - 期望：denied 行数 0 → 1
  - 实际：实际 1
  - 说明：检索口径：actorId + result=denied（写审计为异步补写，最多等 3s）
| PASS | D4 | 管理口径：管理员 includeDisabled=true 返回全集 |
  - 期望：200 + 条数 ≥ 默认下发（8）
  - 实际：200 regionItems=8 {"items":[{"type":"region","items":[{"code":"华东","name":"华东","sort":10,"enabled":true,"metadata":{}},{"code":"华北","name"…
  - 说明：无停用项时两者相等；停用后见 D9 / D10
| PASS | D5 | 未知字典类型 → 404 NOT_FOUND |
  - 期望：404 NOT_FOUND
  - 实际：404 {"code":"NOT_FOUND","message":"未知字典类型：priority","details":[],"traceId":"c5512838-80b8-4f55-891f-0cb1052c5139"}
| PASS | D5b | 噪声边界：普通读 404 不产生 denied 行（shouldRecordDenied） |
  - 期望：管理员 denied 行数不变（0）
  - 实际：实际 0
  - 说明：404 只记写请求与项目域路径（server/src/common/audit/audit-path.ts）
| PASS | D6 | 新增条目（dict.manage）：响应是更新后的整个字典（前端替换缓存） |
  - 期望：201 + 含 POC7-20260920082535（enabled=true）
  - 实际：201 {"type":"region","hit":{"code":"POC7-20260920082535","name":"PoC-7 回放区","sort":999,"enabled":true,"metadata":{}},"items":9}
| PASS | A1 | 按对象检索命中新增留痕（谁 / 何时 / 对什么 / 从什么改成什么） |
  - 期望：action=create + actorId=caa8d763-4b6a-4967-9b26-7d1086272c9c + result=succeeded + changes 含 code
  - 实际：行数=1 {"action":"create","actor_id":"caa8d763-4b6a-4967-9b26-7d1086272c9c","actor_name":"Zhangsan","result":"succeeded","entry":"api","changes":[{"to":"POC7-20260920082535","from":null,"field":"code"},{"to":"PoC-7 回放区","from":null,"field":"name"},{"to":999,"from":nu…
  - 说明：等价 API：GET /api/v1/audit-logs?objectType=dict_item&objectId=region:POC7-20260920082535
| PASS | D7 | 同类型内码唯一：重复新增 409 DICT_ITEM_EXISTS |
  - 期望：409 DICT_ITEM_EXISTS
  - 实际：409 {"code":"DICT_ITEM_EXISTS","message":"该字典已存在同码条目：region/POC7-20260920082535","details":[],"traceId":"7948cc39-23ea-4c83-bc7c-0593bfa3c64f"}
| PASS | D8 | 写 = 仅管理员：受限账号新增 403 |
  - 期望：403 FORBIDDEN
  - 实际：403 {"code":"FORBIDDEN","message":"无权限：dict.manage","details":[],"traceId":"0e13946d-dff1-46fe-97c4-5c11e55ac180"}
| PASS | D8b | 越权写留痕：denied 行 +1（objectRefOfUrl → dict_item / region） |
  - 期望：denied 行数 ≥ 2
  - 实际：实际 2
  - 说明：POST /dicts/region/items（items 是结构段，对象 id 取 type）
| PASS | D9 | 停用替代删除：PATCH enabled=false 200 + 管理端回显停用项 |
  - 期望：200 + POC7-20260920082535 enabled=false（仍在管理端全集里）
  - 实际：200 {"code":"POC7-20260920082535","name":"PoC-7 回放区","sort":999,"enabled":false,"metadata":{}}
| PASS | D10 | 停用项不再出现在默认下发（存量数据仍按原值展示） |
  - 期望：默认下发不含 POC7-20260920082535
  - 实际：含 POC7-20260920082535 = false
| PASS | A2 | 按对象检索命中修改留痕：字段级 before / after（enabled true → false） |
  - 期望：action=update + changes 含 {enabled, true, false}
  - 实际：{"action":"update","actor":"caa8d763-4b6a-4967-9b26-7d1086272c9c","change":{"to":false,"from":true,"field":"enabled"}}
| PASS | D11 | 写 = 仅管理员：受限账号停用 / 恢复 403 |
  - 期望：403 FORBIDDEN
  - 实际：403 {"code":"FORBIDDEN","message":"无权限：dict.manage","details":[],"traceId":"0dfc5a80-6184-4435-9816-9a0984baad87"}
| PASS | D11b | 越权行与成功写同对象 id（可直接按对象检索同一条目） |
  - 期望：≥1 行（objectId=region:POC7-20260920082535）
  - 实际：实际 1
  - 说明：objectRefOfUrl 对字典取 type[:code] 且路径段先解码
| PASS | A3 | 审计接口·按对象检索（objectType + objectId） |
  - 期望：200 + total ≥ 2（create + update）
  - 实际：200 total=3 ["deny","update","create"]
| PASS | A4 | 审计接口·按人检索 + 越权筛法（actorId + result=denied） |
  - 期望：200 + total ≥ 2（includeDisabled 403 + 写 403）且全为该账号 denied
  - 实际：200 total=3 ["deny@region:POC7-20260920082535","deny@region","deny@dicts"]
| PASS | A5 | 审计接口仅 audit.view：受限账号 403 |
  - 期望：403 FORBIDDEN
  - 实际：403 {"code":"FORBIDDEN","message":"无权限：audit.view","details":[],"traceId":"3ba79231-ba94-4d64-a8ae-61815b7a017d"}
| PASS | C1 | 收尾核对：回放数据与临时会话零残留 |
  - 期望：dict_items / audit_logs（对象 + 操作人）/ sessions 全 0
  - 实际：{"dictItems":0,"auditObjects":0,"auditActors":0,"sessions":0}
  - 说明：字典条目与本次审计行用 migrator 连接硬删（api 角色对 audit_logs 无 UPDATE / DELETE）

## 汇总

- ✅ 全部断言通过（23 项）：默认只下发启用项、管理口径 403、新增 / 停用 200 且同码 409、未知类型 404 无噪声、审计按对象与按人检索命中、越权 403 落 denied 行、审计接口仅 audit.view、回放数据零残留。

## 验收对照（团队分工.md §6 · h7）

- 「字典（C9）唯一口径」= D1 ~ D11：下发只含启用项、includeDisabled 需 dict.manage（403）、新增 / 停用条目 200 且响应即更新后的整个字典、同码 409 `DICT_ITEM_EXISTS`、未知类型 404、停用替代删除（停用后不再默认下发，无物理删除）。
- 「审计留痕（谁 / 何时 / 对什么 / 从什么改成什么）」= A1 / A2：dict_item 对象上的 create（changes 含 code）/ update（字段级 `enabled: true → false`）两行，actorId 为管理员、entry=api、result=succeeded；写入与业务同事务（读库直证）。
- 「按对象与操作人可检索」= A3 / A4 + D11b：`GET /api/v1/audit-logs?objectType=dict_item&objectId=region:<code>` 命中 create + update；`actorId=<受限账号>&result=denied` 命中全部越权行；越权行对象 id 与成功写同形（type[:code]）。
- 「越权留痕（C7-03）」= D3 / D3b / D8 / D8b / A5：403 一律记 denied（含 includeDisabled 越权读、字典写越权）；普通读 404（未知类型）不写噪声行（D5b）。
- 项目 / 任务 / 节点与阶段推进的写路径留痕由单测覆盖（`server/test/project-crud.test.ts` / `task-service.test.ts` / `flow-gate-rejection.test.ts` 的 FakeAuditService 断言 record 入参）；真机不造项目数据（回放脚本只跑字典与审计域）。
- 「自动化用例全绿」= `cd server && node node_modules/vitest/vitest.mjs run`（`test/admin-audit.test.ts` 15 例 + 全量 184 例 / 14 文件，随 `npm test` 常跑，不连库）与 `node scripts/check-db-schema.mjs` / `check-permission-matrix.mjs`。
- 复跑：cd server && node scripts/poc7-replay.mjs --out ../docs/PoC-7-回放证据(字典C9与审计留痕C7).md

