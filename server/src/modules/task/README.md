# task 模块（h4 · S6·task：任务主表 / 五态派生 / 进度聚合 / 完成门禁）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 任务主数据（列表 / 详情）、进度与状态写入联动、展示五态与按时交付派生、项目总览四格、阶段任务统计出口、完成门禁（M3-03 · A4-20 / ADR-024） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | TaskService（summary / list / detail / create / update / updateProgress / canComplete / complete）、TaskStatsService（countStageTasks / stageTaskCounts）、规则纯函数与查询解析（task.rules / task.query）；节点实例的读写仍在 project 模块 flow.service（依赖方向 project → node → task，本模块不反向依赖） |

## 已实现（h4 · Push 89）

- 契约：`shared/src/modules/tasks.ts`（列表 / 详情 / 创建 / 编辑 / 进度五组 schema + `TaskListItem` 随行摘要）；错误码新增 `TASK_ALREADY_EXISTS`（409：节点已有未删任务）。**Push 145（lan 线代记，请 wmj 复核）**：`Task.changeRef` → `Task.changeLinks: TaskChangeLink[]`（`{ id, reason(截 40 字), appliedAt }`，A1-07「追加＋去重」可多条），`TaskListItem` / `TaskDetail` 的单条 `changeSummary` 下线（改由 `changeLinks` 承载）；落库 `tasks.change_refs uuid[]`（迁移 0020），本模块只读、不写该列。
- 规则口径（纯函数 `task.rules.ts`，来源：系统功能书 A1-06、A12 / A13 / A14（Push 70 定案）、ADR-028 时区）：
  - 展示五态**读时派生、不写回存储**（存储只有基础三态 `pending / active / done`）：`overdue` = 未完成且已过预计完成日期（派生优先，人工写状态不改写它）；`early_done` = 完成且实际完成日期早于预计完成日期；
  - `applyStatusWrite`（A12）：done → 满格 + 缺省补当天完成日期（已有日期保留）；active → 至少 1 格（0 → 0.25、满格 → 0.75）并清完成日期；pending → 清进度与完成日期；
  - `applyProgressWrite`（A13）：0 → 待开始；0.25 / 0.5 / 0.75 → 进行中并清完成日期（**清除完成日期的唯一方式**）；1 → 已完成 + 完成日期（缺省当天，可显式传入）；
  - `deriveOnTime`（A14）：完成且实际 ≤ 预计 → true，完成但晚于预计（或未填完成日期且预计已过）→ false；未完成已过期 → false；派生不出回落存储值；
  - 日界：`shanghaiToday` 按 UTC+8 固定偏移算出后以参数进 SQL（ADR-028），不在 SQL 里拼时区表达式。
- 接口（挂 `api/v1/projects`；读登录即可，写入口径见下）：
  - `GET /{id}/summary` 项目总览四格（当前阶段 / 逾期 / 已完成 / 总数）；
  - `GET /{id}/tasks` 分页列表：阶段 / 负责人 / 展示态（可多值，条件下推 SQL）/ 关键字 `q` 筛选 + 排序白名单（plannedStart / plannedEnd / actualEnd / progress / title / createdAt；默认序 = 阶段序 + 组内位次 `sort_index` + id（A15 / A19 / A20 · Push 124：未分组落最后，与看板列内顺序同口径））；非法参数 400；
  - `GET /{id}/tasks/{taskId}` 详情：抽屉全字段 + 文件清单 + 负责人名与变更摘要（`fileSummaries` 聚合，免 N+1）；
  - `POST /{id}/tasks` 创建：① 从任务节点生成（节点须属本项目，`stageKey` 与节点阶段不一致 400；同节点已有未删任务 409 `TASK_ALREADY_EXISTS`）；② 手工创建（**仅管理员**，系统功能书 A1-13，非管理员 403）；`stageKey` 缺省 / 显式 null = 「未分组」、`ownerIds` 缺省 = 项目全部项目经理（A23 · Push 136；**显式 `[]` = 「待分配」**）、`sortIndex` = 插入位次（A15 / A18 / A20 · Push 124）；
  - `PATCH /{id}/tasks/{taskId}` 编辑：乐观锁 `version`（不一致 409 `VERSION_CONFLICT`）+ 基础三态写入联动（A12）+ `ownerIds` 显式置空（不传 = 不改；传数组 = 整体替换、顺序 = 展示顺序）+ 组内重排（`sortIndex`，越界 = 组尾）+ 字段级留痕（A18 / A19 / A20 · Push 124）；任务描述 / 成果文件锁定不在本接口；
  - `PATCH /{id}/tasks/{taskId}/progress` 进度写入：响应与列表行同形（`TaskListItem`），联动状态与完成日期；`note` 写 note_change 事件留痕；
  - 归档项目写入口径 409 `PROJECT_ARCHIVED`（ADR-027）；任务变更 touch 项目 `updated_at`（ADR-022 ④）。
- 留痕与队列：`task_events` 四类型 `status_change / progress_change / date_change / note_change`（before / after 为 JSON 键值对）+ outbox 三个 topic `task.created / task.updated / task.progress_changed`（dedupeKey 带版本）。
- 与 h3 门禁的衔接（**过渡口径收口**）：`node/gate.repository` 不再直读 `tasks` 表；阶段推进门禁的「任务全 done」与 `GET /projects/{id}/stages` 的任务计数改经 `TaskStatsService` 出口，`StageProgressRow` 不再携带任务字段，门禁语义不变；`files` 表直读仍为过渡口径（随 i1 收口）。
- 单测：`test/task-rules.test.ts`（17 例，纯规则）+ `test/task-service.test.ts`（18 例，桩仓储不连库）+ `test/task-order.test.ts`（4 例，顺序纯函数）；w2 后全量 222 例 / 17 文件。

## 完成门禁（M3-03 · Push 143）

> 口径来源：系统功能书 A4-20 / A2-10、ADR-024（成果文件多选与门禁）、技术设计v0.3 §3.4。

- 契约：`GET /projects/{id}/tasks/{taskId}/can-complete`（预检：`canComplete` + `missing[]` + `warnings[]`）、`POST …/complete`（提交：`{ task, warnings }`）；错误码新增 422 `TASK_REQUIRED_DOC_MISSING`（缺件）与 409 `TASK_ALREADY_DONE`（重复提交）；`Task.deliverableTypes: DocType[]`（数组、服务端去重、空数组 = 不要求）。
- 判定来源（ADR-024）：① 有节点任务按所属节点 `node_requirements` 的 `required_doc` 逐类统计（与 node 模块 `GateService.evaluateNode` 同口径）；② 无节点任务按自身 `deliverable_types` 兜底（每类 ≥ 1 份）。定档口径 = `files.status ∈ (final, changed)` 且 `current_version_id` 非空；统计范围 = 节点下 / 任务下文件（回收站不计）。
- 三入口一致（A4-20）：完成提交（`POST …/complete`）与 `PATCH …/{taskId}`（`status=done`）、`PATCH …/progress`（`progress=1`）在**事务内走同一门禁判定**；缺件一律 422 + `missing[]`（`details[].code = required_doc`）且不部分生效（乐观锁校验在前、写库在后）。
- 放行提示（A2-10 / R02）：存在未定档（draft）成果文件时放行，响应带 `warnings[{ code: draft_doc_present, docType, count }]`，并写 outbox `task.draft_doc_reminded`（R02 触发点，notify 落地后消费）。
- 留痕：拒绝 → outbox `task.gate_rejected`（事务回滚后补写）+ 审计 `result=failed`（含错误码与缺件明细）；成功 → outbox `task.completed`（payload 带 warnings）+ 审计 `action=complete`。
- 数据面：迁移 `0018_task_deliverable_types.sql`（`deliverable` text → `deliverable_types` text[] 非空默认空数组 + `ck_tasks_deliverable_types` / `ck_tasks_deliverable_types_no_null` + GIN `ix_tasks_deliverable_types`；存量单值转单元素数组、空值转空数组）；创建任务缺省从节点 `required_doc` 类型带出（body 显式给出优先）；`TaskUpdateBody` 不含该字段 = 生成后锁定（A1-17；例外调整随 M3-05），PATCH 置空/编辑不可达。
- 实现归属：门禁判定实现在本模块 `task.gate.repository.ts`（只读 `node_requirements` / `files`）—— node 模块 `GateService` 依赖 task（`TaskStatsService`），task 反向依赖会成环；两处 SQL 口径必须同步修改（node/README.md 已登记）。
- 单测：`test/task-gate.test.ts` 8 例（预检缺件明细 / 无节点 deliverable_types 兜底 / 完成缺件 422 + outbox + 审计 failed / 门禁通过 200 + `task.completed` / draft 放行 + R02 / 重复提交 409 / `PATCH status=done` 与 `progress=1` 同一门禁）。

## 落库口径（w2 · A15 / A18 / A19 / A20 · Push 124）

> 口径来源：`前端功能需求.md` 附录 A15 / A18 / A19 / A20（Push 119 / 120 定案）与 `字段对照清单.md` §七；落库机制二选一定为 **① `tasks.sort_index` 位次列**（不新增批量排序接口）。

- 顺序（A19 / A20）：一组 = 同一项目 + 同一阶段（`stage_key` 为空 = 「未分组」，自成一组）；组内位次 0 起、密集。创建带 `sortIndex` = 插入位次、编辑带 `sortIndex` = 移到组内第 N 位（两者越界 / 缺省都落组尾），同组其余任务顺延 —— 只写位次列、不逐个 bump `version` / `updated_at`，并发靠组行锁（`select … for update` 锁整组后再锁任务行）。
- 阶段可空（A15）：创建不传 / 显式 null = 「未分组」；带 `taskNodeId` 时缺省取节点所属阶段、显式不一致 400。默认读序 = **阶段序（`STAGE_KEYS` 序，未分组落最后）+ `sort_index` + id**（A8 原「阶段序 + `planned_start` + `created_at` + id」由本条取代）；阶段完成度（`GET /projects/{id}/stages`）与阶段门禁**只统计带阶段任务**。
- 负责人可多位 / 可空（A18 / A23 · Push 136）：创建不传 = 项目全部项目经理兜底、显式 `[]` = 「待分配」；编辑不传 = 不改、显式 `[]` = 置空、传数组 = 整体替换（顺序 = 展示顺序）；`Task.ownerIds` 为 uuid[]（空数组 = 待分配）、`TaskListItem.ownerNames` 为同下标姓名数组。筛选 `filter[ownerId]` = 任一位负责人命中即命中。
- 数据面与契约：迁移 `0015_task_order_and_nullable_scope.sql`（回填按迁移前默认读序 → 迁移前后读序一致；`ck_tasks_sort_index` + `ix_tasks_project_stage_order`）与 `0017_multi_manager_and_owner.sql`（`owner_id` → `owner_ids` uuid[] + `ck_tasks_owner_ids_no_null` + `ix_tasks_owner_ids` GIN；回填空数组 / `array[owner_id]`）、Drizzle `src/db/schema/tasks.ts`、契约 `shared/src/modules/tasks.ts` 三处同步（`check:db-schema`：27 表 / 265 列 / 78 索引 / 77 CHECK · Push 143 后）；outbox topic 与 `task_events` 类型不变，`sortIndex` / `ownerIds` 进审计快照（C7-02 字段级留痕）。
- 真机回放：`server/scripts/w2-replay.mjs`（真 PG + 真 api :3011，33 项断言，退出码即门禁）；证据入 `docs/w2-回放证据(任务落库口径A15A18A19).md`。

## 边界与后续（差异登记）

- 已随 h6 落地：读路由记录级 404（不可见项目 / 跨项目任务统一 404）、写路由功能权限位（`task.create` / `task.update` / `task.progress` —— 项目内成员对这三项平权，见 `modules/permission/README.md`）；手工创建仅管理员的口径随 A1-13 复核；
- 不在本卡（Push 143 后更新）：列表快捷筛选参数、任务软删 / 批量操作、门禁增强 M3-04 ~ M3-06（**M3-03 已落 Push 143**：`deliverableTypes` 多值 + 完成门禁；模板锁定与例外调整随 M3-05）；
- 列表默认序已有 `ix_tasks_project_stage_order (project_id, stage_key, sort_index)` 复合索引（0015 · Push 124）；1 万行压测与索引调优仍随压测卡 M3-06；
- 契约里进度档位为离散五档，迁移数据任意小数在读时四舍五入到最近档。
