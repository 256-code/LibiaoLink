# node 模块（h3 · S6·blueprint/node：完成门禁 / 阶段推进门禁）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 节点约束判定、完成门禁、阶段推进门禁（缺项明细） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | GateService（evaluateNode / evaluateStageAdvance / stageProgress / countLinkedFiles）、GateRepository；节点实例的读写与增删在 project 模块的 flow.service（避免 project ↔ blueprint 循环依赖，本模块不反向依赖） |

## 已实现（h3 · Push 83）

- 契约：`shared/src/modules/flow.ts`（`NodeGateMissingSchema` / `ProjectStageSummarySchema` / `NodeRequirementSchema`）。
- 门禁口径（v0.2 §3.6 / A4-20）：完成节点与推进阶段都在**服务端事务内**重新判定（`can-complete` 预检只是 UI 置灰依据，不替代判定）：
  - `evaluateNode`：节点约束 `required_doc` 与节点下成果文件比对 → `missing[] = { docType, required, present }`；缺件 → 422 `NODE_REQUIRED_DOC_MISSING`；
  - `evaluateStageAdvance`：阶段内 **节点全 done**（`node_not_done`）+ **任务全 done**（`task_not_done`）+ **各节点必交成果文件齐备**（`doc_missing`）三类缺项 → 422 `STAGE_GATE_NOT_PASSED` + 明细；失败整体回滚，不部分推进。
- 文件计入口径（过渡）：`files.deleted_at is null` 且 `status ∈ (final, changed)` 且 `current_version_id is not null` —— 未定档 / 回收站 / 历史版本不计入完成门禁。
- `countLinkedFiles`：节点下文件总数（含未定档），供删除节点的 409 `NODE_HAS_FILES` 判定。
- **过渡口径（登记待收口）**：本模块仍直读 `files` 表（file 模块已落地 M4-01~03，改经对端 `index.ts` 出口随后续卡收口）；`tasks` 表已随 h4 收口 —— 阶段门禁 / 完成度的任务计数经 `TaskStatsService`（node → task）。
- **任务侧完成门禁（M3-03 · Push 143）由 task 模块按同口径实现**（`task.gate.repository.ts` 只读 `node_requirements` / `files`）：node → task 依赖已存在，task → node 会成环，故判定落 task 模块 —— `required_doc` 逐类统计 + `status ∈ (final, changed)` 且 `current_version_id 非空` 的口径与 `evaluateNode` **必须同步修改**（改动其一必须同步另一处与两边 README）。
- 单测：`test/flow-gate.test.ts`（6 例，FakeGateRepository：缺件明细 / 三类缺项 / 全过分支 / 完成度派生 / 有文件判定）。