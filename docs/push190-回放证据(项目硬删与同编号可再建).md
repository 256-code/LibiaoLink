# Push 190 回放证据（项目硬删 · 同编号可再建）

> 口径：业务定案 2026-09-24 —— 「先改项目删除」「删除要硬删不要软删」「现在同一个编号删除了 再建一个编号都不可以」「历史那 67 行软删项目：一并物理清掉」。
> 项目删除 = **物理删行**（连同项目聚合子表，同事务）；**项目编号随行释放 → 同编号可再建**；`seq_no` 仍不回收。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-24 18:00 +08:00（推送前最后一轮复跑） |
| api | http://127.0.0.1:3001 |
| 数据库 | postgres://libiaolink_api@127.0.0.1:5433/libiaolink |
| 代码版本 | `72abe30`（并入 main 的合并提交 `ef40f39`） |
| 回放账号（临时会话，跑完删除） | 管理员账号的临时会话（脚本自建 `sessions` 行 → 跑完 DELETE，零残留） |
| 脚本 | server/scripts/px-project-hard-delete-replay.mjs |
| 结果 | **18 / 18 全过** |

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
  - 实际：201 {"code":"PXHD-A-20260924175344","version":0,"seqNo":207}
| PASS | A2 | 蓝图快照落库：项目阶段 / 流程节点 |
  - 期望：stages >= 1 且 nodes >= 1
  - 实际：{"stages":9,"nodes":19}
| PASS | A3 | 聚合子表写入：加成员 200 + 加任务 201 → 库内各 1 行 |
  - 期望：200 / 201 / tasks=1 / members=1
  - 实际：200 / 201 / {"tasks":1,"members":1}
| PASS | A4 | DELETE（If-Match = version）→ 200 + 返回删除前快照 |
  - 期望：200 + code 一致 + version = 删除前 version
  - 实际：200 {"code":"PXHD-A-20260924175344","version":0}
| PASS | A5 | 物理删行：库内 projects 该行不存在 |
  - 期望：0
  - 实际：0
| PASS | A6 | 聚合子表零残留（9 张表按 project_id） |
  - 期望：全 0
  - 实际：{"tasks":0,"nodes":0,"stages":0,"members":0,"stakeholders":0,"reports":0,"issues":0,"changes":0,"files":0}
| PASS | A7 | 审计留痕：project.delete + metadata.hardDelete + children 计数 |
  - 期望：1 行 + hardDelete=true + children.tasks=1 / members=1 / nodes>=1 / stages>=1
  - 实际：1 行 / {"children":{"files":0,"nodes":19,"tasks":1,"issues":0,"stages":9,"members":1,"reports":0,"stakeholders":0,"changeRequests":0},"hardDelete":true}
| PASS | A8 | 审计字段级快照：changes 每条 to=null（行已删、快照留痕） |
  - 期望：>= 7 条且 to 全 null
  - 实际：9 条
| PASS | A9 | 同编号可再建（Push 190 前 409 PROJECT_CODE_EXISTS）+ seq_no 不回收 |
  - 期望：201 + code 相同 + seqNo > 被删项目 seqNo
  - 实际：201 {"code":"PXHD-A-20260924175344","seqNo":208}
| PASS | A10 | 已删项目：详情 404 + 按编号查列表只含再建那条 |
  - 期望：404 + 列表不含已被删 id
  - 实际：404 / ["788412d8-21e8-4366-85cb-78cb21a846a6"]
| PASS | B1 | 版本不匹配 → 409 VERSION_CONFLICT 且整事务回滚（项目仍在） |
  - 期望：409 + code=VERSION_CONFLICT + 库内 1 行
  - 实际：409 / VERSION_CONFLICT / 1
| PASS | B2 | 删除不存在的项目 → 404 NOT_FOUND |
  - 期望：404
  - 实际：404 {"code":"NOT_FOUND","message":"项目不存在或不可见","details":[],"traceId":"2f73acf9-0912-4f61-aac4-481d3e393d60"}
| PASS | B3 | 归档项目禁删（ADR-027） |
  - 期望：PATCH 200 + DELETE 409 PROJECT_ARCHIVED
  - 实际：200 / 409 {"code":"PROJECT_ARCHIVED","message":"项目已归档，禁止删除","details":[],"traceId":"55ba3fdf-4c0f-4e42-8adc-22b69385478f"}
| PASS | C1 | 复位归档后删除 → 200（清理临时项目） |
  - 期望：200
  - 实际：200 {"id":"788412d8-21e8-4366-85cb-78cb21a846a6","code":"PXHD-A-20260924175344","seqNo":208,"name":"Push190 硬删回放 A2（同编号再建·临时...
| PASS | C2 | 零残留：临时项目 id / 编号在全链路无行 |
  - 期望：全 0
  - 实际：{"projects":0,"tasks":0,"nodes":0,"stages":0,"members":0}
| PASS | C3 | 审计历史保留（行删了、留痕在） |
  - 期望：>= 2
  - 实际：8

## 小结

- 断言：**18 项，全部通过**（S1~S2 环境 + A1~A10 主路径 + B1~B3 边界 + C1~C3 清尾）。
- **删干净**：DELETE 200 返回删除前快照；`projects` 该行不存在；9 张聚合子表（tasks / project_nodes / project_stages / project_members / project_stakeholders / daily_reports / issues / change_requests / files）按 `project_id` 计数全 0。
- **留痕在**：审计 `action=delete` + `metadata.hardDelete=true` + `metadata.children` 各行数 + `changes` 逐字段快照（`to: null`，9 条）；行删了、审计历史保留。
- **编号释放**：同编号再建 201（Push 190 前 409 `PROJECT_CODE_EXISTS`），`seqNo` 前进不回收（208 > 207）。
- **边界不放松**：`If-Match` 版本不匹配 409 `VERSION_CONFLICT` 且整事务回滚（项目仍在）；不存在 404；归档 409 `PROJECT_ARCHIVED`。
- **零残留**：临时项目 id / 编号在全链路无行（projects / tasks / nodes / stages / members 全 0），临时会话已删。
- 迁移侧对照：临时库 `libiaolink_hd190`（35 个迁移含 `0035_project_hard_delete.sql`，跑完 drop）全过；沙箱库执行 0035 后 `projects` 175 → 108 行（软删 0）、`tasks` 278 → 85、`project_nodes` 3325 → 2052、`project_stages` 1575 → 972，`audit_logs` 1390 行保留（执行 0035 时的行数）。
