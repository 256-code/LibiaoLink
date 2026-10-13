# Push 259 回放证据（项目硬删解环 · 含「当前版本文件」的项目）

> 口径：业务反馈 2026-10-09 —— 删除「未分类」项目报 500 `INTERNAL`（Chrome 控制台 DELETE /api/v1/projects/{id}）。
> 根因：`files.current_version_id → file_versions.id`（NO ACTION）与 `file_versions.file_id → files.id`（NO ACTION）互为循环外键；硬删链先删 `file_versions` 必撞 `fk_files_current_version`（23503）→ 500。
> 修复：硬删链在删版本行前新增 1 步解环 `update files set current_version_id = null`（与文件模块「彻底删除」同法）；删除序列口径 = **15 步 + 1 步解环**。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-10-09 13:05 +08:00（推送前最后一轮复跑） |
| api | http://127.0.0.1:3001（修复后 dist 重启实例；另有 3002 临时实例同结果） |
| 数据库 | postgres://libiaolink_api@127.0.0.1:5433/libiaolink |
| 代码版本 | 工作区修复（未提交；推送后回填 commit / PR） |
| 回放账号（临时会话，跑完删除） | 管理员账号的临时会话（脚本自建 sessions 行 → 跑完 DELETE，零残留） |
| 脚本 | server/scripts/px-project-hard-delete-replay.mjs（本轮补 A3b：「项目内 1 个文件带当前版本」夹具） |
| 结果 | **19 / 19 全过** |

## 断言明细

| 结果 | 编号 | 断言 |
|---|---|---|
| PASS | S1 | 真机 api 在跑 |
  - 期望：200
  - 实际：200
  - 说明：http://127.0.0.1:3001
| PASS | S2 | 临时管理员会话可用 |
  - 期望：200
  - 实际：200 {"user":{"id":"1ccd08b2-e1b5-404e-8b18-3c0da4e6ec3c","name":"wmj","displayName":"吴孟杰","email":"wumengjie@libiaorobot.com...
| PASS | A1 | 建临时项目 A（蓝图导入同事务） |
  - 期望：201 + code 一致 + version=0 + seqNo 为正整数
  - 实际：201 {"code":"PXHD-A-20261009130350","version":0,"seqNo":447}
| PASS | A2 | 蓝图快照落库：项目阶段 / 流程节点 |
  - 期望：stages >= 1 且 nodes >= 1
  - 实际：{"stages":9,"nodes":19}
| PASS | A3 | 聚合子表写入：加成员 200 + 加任务 201 → 库内各 1 行 |
  - 期望：200 / 201 / tasks=1 / members=1
  - 实际：200 / 201 / {"tasks":1,"members":1}
| PASS | A3b | 回归夹具：项目内 1 个文件带当前版本（current_version_id 非空） |
  - 期望：files=1 / versions=1 / has_current=true
  - 实际：{"files":1,"versions":1,"has_current":true}
| PASS | A4 | DELETE（If-Match = version）→ 200 + 返回删除前快照 |
  - 期望：200 + code 一致 + version = 删除前 version
  - 实际：200 {"code":"PXHD-A-20261009130350","version":0}
| PASS | A5 | 物理删行：库内 projects 该行不存在 |
  - 期望：0
  - 实际：0
| PASS | A6 | 聚合子表零残留（9 张表按 project_id + file_versions 按 file_id） |
  - 期望：全 0
  - 实际：{"tasks":0,"nodes":0,"stages":0,"members":0,"stakeholders":0,"reports":0,"issues":0,"changes":0,"files":0,"file_versions":0}
| PASS | A7 | 审计留痕：project.delete + metadata.hardDelete + children 计数 |
  - 期望：1 行 + hardDelete=true + children.tasks=1 / members=1 / files=1 / nodes>=1 / stages>=1
  - 实际：1 行 / {"children":{"files":1,"nodes":19,"tasks":1,"issues":0,"stages":9,"members":1,"reports":0,"stakeholders":0,"changeRequests":0},"hardDelete":true}
| PASS | A8 | 审计字段级快照：changes 每条 to=null（行已删、快照留痕） |
  - 期望：>= 7 条且 to 全 null
  - 实际：9 条
| PASS | A9 | 同编号可再建（Push 190 前 409 PROJECT_CODE_EXISTS）+ seq_no 不回收 |
  - 期望：201 + code 相同 + seqNo > 被删项目 seqNo
  - 实际：201 {"code":"PXHD-A-20261009130350","seqNo":448}
| PASS | A10 | 已删项目：详情 404 + 按编号查列表只含再建那条 |
  - 期望：404 + 列表不含已被删 id
  - 实际：404 / ["af372db1-c1fb-4457-a7d2-41a4997fdfe5"]
| PASS | B1 | 版本不匹配 → 409 VERSION_CONFLICT 且整事务回滚（项目仍在） |
  - 期望：409 + code=VERSION_CONFLICT + 库内 1 行
  - 实际：409 / VERSION_CONFLICT / 1
| PASS | B2 | 删除不存在的项目 → 404 NOT_FOUND |
  - 期望：404
  - 实际：404 {"code":"NOT_FOUND","message":"项目不存在或不可见","details":[],"traceId":"5c5dc284-935a-4699-83f6-b87f5dd6bd73"}
| PASS | B3 | 归档项目禁删（ADR-027；归档态 SQL 造态，PATCH 已不接 archived） |
  - 期望：GET 200 status=archived + DELETE 409 PROJECT_ARCHIVED
  - 实际：200 archived / 409 {"code":"PROJECT_ARCHIVED","message":"项目已归档，禁止删除","details":[],"traceId":"9b2edab2-c8c4-4f39-9069-837be278ebee"}
| PASS | C1 | 复位归档后删除 → 200（清理临时项目） |
  - 期望：200
  - 实际：200 {"id":"af372db1-c1fb-4457-a7d2-41a4997fdfe5","code":"PXHD-A-20261009130350","seqNo":448,"name":"Push190 硬删回放 A2（同编号再建·临时...
| PASS | C2 | 零残留：临时项目 id / 编号在全链路无行 |
  - 期望：全 0
  - 实际：{"projects":0,"tasks":0,"nodes":0,"stages":0,"members":0}
| PASS | C3 | 审计历史保留（行删了、留痕在） |
  - 期望：>= 2
  - 实际：7

## 小结

- 断言：19 项，全部通过。
