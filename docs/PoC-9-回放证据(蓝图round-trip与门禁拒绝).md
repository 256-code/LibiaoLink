# PoC-9 回放证据（蓝图 round-trip 与门禁拒绝）

> 卡片：h5 · S6·PoC-9（主责 wmj，协办 px）｜验收口径见 团队分工.md §6 第 9 行：蓝图导出 → 导入 round-trip 无损；缺必交成果文件时完成被拒（UI 置灰 + 服务端强校验 + 留痕）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-20 15:27:27 +08:00 |
| 目标 | http://127.0.0.1:3011 | 
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink |
| 代码版本 | 00d9f99 |
| 执行账号 | caa8d763-4b6a-4967-9b26-7d1086272c9c（管理员） |
| 脚本 | server/scripts/poc9-replay.mjs |

## 断言明细

| PASS | S0 | 会话可用（管理员会话已铸） | 
  - 期望：GET /api/v1/users 200
  - 实际：200 {"items":[{"id":"ea6eff88-4b3e-4df1-9ce0-02ffb14fed69","username":"lisi","displa…
| PASS | B1 | 导出正本（已发布蓝图 payload） | 
  - 期望：200 + 阶段 / 节点非空
  - 实际：200 stages=9 nodes=19
| PASS | B2 | 导入同一份正本（校验通过） | 
  - 期望：200
  - 实际：200 {"status":"published","publishedVersion":4}
| PASS | B3 | 再导出与正本逐字相等（round-trip 无损） | 
  - 期望：键序归一化后完全一致（阶段 9 / 节点 19）
  - 实际：stages=9 nodes=19（一致）
| PASS | B4 | 导入后发布幂等（无变更不递增版本） | 
  - 期望：publishedVersion 保持 4
  - 实际：publishedVersion=4 {"status":"published"}
| PASS | P1 | 建项目（导入即快照） | 
  - 期望：201 + 项目可见
  - 实际：201 {"id":"4a302a12-fa52-4be8-bfa4-0e56bcd11ed1","stageKey":"presale","version":0}
| PASS | P2 | 快照含「必交成果文件」节点 | 
  - 期望：blueprintVersion >= 1 且存在 required_doc 节点
  - 实际：blueprintVersion=4 stages=9 必交节点=10
| PASS | G1 | 预检（UI 置灰依据）：缺件时 canComplete=false + missing 明细 | 
  - 期望：canComplete=false / missing[].docType=技术协议
  - 实际：{"canComplete":false,"missing":[{"docType":"技术协议","required":1,"present":0},{"docType":"合同","required":1,"present":0}]}
| PASS | G2 | 服务端强校验：缺必交成果文件时完成被拒 | 
  - 期望：422 NODE_REQUIRED_DOC_MISSING + details[].code=required_doc
  - 实际：422 {"code":"NODE_REQUIRED_DOC_MISSING","detail":{"docType":"技术协议","required":1,"present":0}}
| PASS | G3 | 拒绝留痕：outbox node.gate_rejected（事务回滚后补写） | 
  - 期望：存在一条留痕且 payload.missing 非空
  - 实际：id=49 missing=[{"docType":"技术协议","present":0,"required":1},{"docType":"合同","present":0,"required":1}] actor=caa8d763-4b6a-4967-9b26-7d1086272c9c
| PASS | G4 | 不部分生效：拒绝后节点未完成（status 未变 done、无完成时间、version 未推进） | 
  - 期望：status != done / done_at is null / version 未变
  - 实际：{"status":"active","done_at":null,"version":0} 期望 version=0
| SEED | 已补定档成果文件：技术协议 / 合同 |
| PASS | G5 | 补齐定档成果文件后预检放行 | 
  - 期望：canComplete=true
  - 实际：{"canComplete":true,"missing":[]}
| PASS | G6 | 补齐后完成 200（拒绝只因缺件） | 
  - 期望：200 + 节点 done + doneAt 非空
  - 实际：200 {"status":"done","doneAt":"2026-09-20T07:27:27.446Z"}
| PASS | G7 | 完成事件入 outbox（node.completed） | 
  - 期望：存在 >= 1 条
  - 实际：count=1

## 汇总

- ✅ 全部断言通过（14 项）：round-trip 无损、门禁拒绝 422 + 留痕 + 不部分生效、补齐定档文件后放行。

## 验收对照（团队分工.md §6 第 9 行）

- 「蓝图导出 → 导入 round-trip 无损」= B1 ~ B4：导出正本 → 导入同一份 → 再导出逐字相等（键序归一化）+ 发布幂等（无变更不递增版本）。
- 「缺必交成果文件时完成被拒 · UI 置灰」= G1 / G5：`can-complete` 预检缺件 false、补齐后 true（前端置灰只作展示依据，不替代服务端判定）。
- 「缺必交成果文件时完成被拒 · 服务端强校验」= G2：422 `NODE_REQUIRED_DOC_MISSING` + `details[].code=required_doc`（事务内判定，不经前端）。
- 「缺必交成果文件时完成被拒 · 留痕」= G3 / G4 / G7：`node.gate_rejected`（含 missing 明细与操作人、事务回滚后补写）且节点未部分生效；补齐后 `node.completed`。
- CI 回归（不连库）：`server/test/flow-gate-rejection.test.ts`（5 例）随 `npm test` 常跑；真机闭环用本脚本复跑。
- 复跑：cd server && node scripts/poc9-replay.mjs

