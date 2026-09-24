# task 模块（h4 · S6·task：任务主表 / 五态派生 + 显式覆盖 / 进度聚合 / 完成门禁 / 批量操作 / 软删 / 锁定字段例外调整）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 任务主数据（列表 / 详情）、进度与状态写入联动（五态可写 · M3-07 刀 1）、展示五态与按时交付派生、汇总卡（最慢 / 最新阶段 + 三计数）、阶段任务统计出口、完成门禁（M3-03 · A4-20 / ADR-024）、批量操作（M3-04 · A1-08）、软删与引用守卫（M3-05 · A25）、锁定字段例外调整（M3-05 续卡 · A1-17 / C9-07） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | TaskService（summary / list / detail / create / update / updateProgress / canComplete / complete / batch / remove / adjustLockedFields）、TaskStatsService（countStageTasks / stageTaskCounts）、规则纯函数与查询解析（task.rules / task.query）；节点实例的读写仍在 project 模块 flow.service（依赖方向 project → node → task，本模块不反向依赖） |

## 已实现（h4 · Push 89）

- 契约：`shared/src/modules/tasks.ts`（列表 / 详情 / 创建 / 编辑 / 进度五组 schema + `TaskListItem` 随行摘要）；错误码新增 `TASK_ALREADY_EXISTS`（409：节点已有未删任务）。**Push 146（lan 线代记，请 wmj 复核）**：`Task.changeRef` → `Task.changeLinks: TaskChangeLink[]`（`{ id, reason(截 40 字), appliedAt }`，A1-07「追加＋去重」可多条），`TaskListItem` / `TaskDetail` 的单条 `changeSummary` 下线（改由 `changeLinks` 承载）；落库 `tasks.change_refs uuid[]`（迁移 0020），本模块只读、不写该列。
- 规则口径（纯函数 `task.rules.ts`，来源：系统功能书 A1-06、A12 / A13 / A14（Push 70 定案）、ADR-028 时区）：
  - 展示五态**读时派生 + 显式覆盖（2026-09-24 · M3-07 刀 1）**：存储只有基础三态 `pending / active / done` + `status_override`（仅 `overdue` / `early_done` 两值）；**有覆盖且边界满足时优先取覆盖**（overdue 仅未完成生效、early_done 仅已完成生效），否则回落派生 —— `overdue` = 未完成且已过预计完成日期；`early_done` = 完成且实际完成日期早于预计完成日期；展示态本身仍不写回；
  - `applyStatusWrite`（A12 · 2026-09-24 五态）：done → 满格 + 缺省补当天完成日期（已有日期保留）+ 清覆盖；active → 至少 1 格（0 → 0.25、满格 → 0.75）并清完成日期 + 清覆盖；pending → 清进度与完成日期 + 清覆盖；**overdue（已延期）→ 保持当前格数与完成日期、只落覆盖**；**early_done（提前完成）→ 四格全亮 + 完成日期缺省当天 + 落覆盖**；
  - `applyProgressWrite`（A13）：0 → 待开始；0.25 / 0.5 / 0.75 → 进行中并清完成日期（**清除完成日期的唯一方式**）；1 → 已完成 + 完成日期（缺省当天，可显式传入）；三种结果一律**清空显式覆盖**（回到派生，与原型点进度条同结果）；
  - `deriveOnTime`（A14）：完成且实际 ≤ 预计 → true，完成但晚于预计（或未填完成日期且预计已过）→ false；未完成已过期 → false；派生不出回落存储值；
  - 日界：`shanghaiToday` 按 UTC+8 固定偏移算出后以参数进 SQL（ADR-028），不在 SQL 里拼时区表达式。
- 接口（挂 `api/v1/projects`；读登录即可，写入口径见下）：
  - `GET /{id}/summary` 汇总卡（**M3-07 刀 1 起**：`slowestStage` 最慢 = 九阶段序第一个存在未完成任务的阶段 / `latestStage` 最新 = 已动工任务（基础态 active / done）里阶段序最靠后者的所属阶段，均 `nullable`；`overdue` / `done` / `total` 三计数照旧）—— 原 `currentStage`（= `projects.stage_key`）下线；
  - `GET /{id}/tasks` 分页列表：阶段 / 负责人 / 展示态（可多值，条件下推 SQL）/ 关键字 `q` 筛选 + 排序白名单（plannedStart / plannedEnd / actualEnd / progress / title / createdAt；默认序 = 阶段序 + 组内位次 `sort_index` + id（A15 / A19 / A20 · Push 124：未分组落最后，与看板列内顺序同口径））；非法参数 400；
  - `GET /{id}/tasks/{taskId}` 详情：抽屉全字段 + 文件清单 + 负责人名与变更摘要（`fileSummaries` 聚合，免 N+1）；
  - `POST /{id}/tasks` 创建：① 从任务节点生成（节点须属本项目，`stageKey` 与节点阶段不一致 400；同节点已有未删任务 409 `TASK_ALREADY_EXISTS`）；② 手工创建（**仅管理员**，系统功能书 A1-13，非管理员 403）；`stageKey` 缺省 / 显式 null = 「未分组」、`ownerIds` 缺省 = 项目全部项目经理（A23 · Push 136；**显式 `[]` = 「待分配」**）、`sortIndex` = 插入位次（A15 / A18 / A20 · Push 124）；
  - `PATCH /{id}/tasks/{taskId}` 编辑：乐观锁 `version`（不一致 409 `VERSION_CONFLICT`）+ **五态写入联动（A12 · M3-07 刀 1）**+ `ownerIds` 显式置空（不传 = 不改；传数组 = 整体替换、顺序 = 展示顺序）+ 组内重排（`sortIndex`，越界 = 组尾）+ 字段级留痕（A18 / A19 / A20 · Push 124）；任务描述 / 成果文件锁定不在本接口；
  - `PATCH /{id}/tasks/{taskId}/progress` 进度写入：响应与列表行同形（`TaskListItem`），联动状态与完成日期；`note` 写 note_change 事件留痕；
  - `PATCH /{id}/tasks/batch` 批量操作（M3-04 · Push 150 / A1-08）：`ids`（1~100、重复去重）+ `changes` 白名单（ownerIds / status / plannedStart / plannedEnd / estimatedDays / headcount / priority / note；null = 清空、缺键 = 不改；不含描述 / 成果文件（A1-17）与 sortIndex）；逐条独立事务 + 部分失败清单 `failures[]`（复用单条写入内核 `applyUpdate`）；空 changes 400、归档项目 409；审计 = 批次一条（`project` 域，metadata 记 batchId / 计数 / 失败清单）+ 逐条字段级一条（`metadata.entry = batch` + 同批 `batchId`）；
  - `DELETE /{id}/tasks/{taskId}` 删除（M3-05 · A25 · Push 152）：软删 —— 列表 / 看板 / 甘特图 / 详情 / 完成门禁一律不可见 + 写留痕；重复删除与已删任务上的任何写操作统一 404（不新增错误码）；组内位次同事务压缩、来源节点约束随软删释放（口径见下节）。
  - `PATCH /{id}/tasks/{taskId}/locked-fields` 锁定字段例外调整（M3-05 续卡 · A1-17 / C9-07 · Push 153）：**仅系统管理员**（服务端复核，非管理员 403）；任务描述 / 输出成果文件按模板生成后锁定、常规编辑不可达，确需修正时**原因必填并留痕**；至少一个实际变化（空调整 400）；乐观锁 409；不写 `task_events`（四值闭集）；口径见下节「锁定字段例外调整」。
  - 归档项目写入口径 409 `PROJECT_ARCHIVED`（ADR-027）；任务变更 touch 项目 `updated_at`（ADR-022 ④）。
- 留痕与队列：`task_events` 四类型 `status_change / progress_change / date_change / note_change`（before / after 为 JSON 键值对）+ outbox 五个 topic `task.created / task.updated / task.progress_changed / task.deleted / task.locked_fields_adjusted`（dedupeKey 带版本；锁定字段调整 payload 带 `reason` 与实际变化字段）；软删与锁定字段例外调整不写 `task_events`（四值闭集）。
- 与 h3 门禁的衔接（**过渡口径收口**）：`node/gate.repository` 不再直读 `tasks` 表；阶段推进门禁的「任务全 done」与 `GET /projects/{id}/stages` 的任务计数改经 `TaskStatsService` 出口，`StageProgressRow` 不再携带任务字段，门禁语义不变；`files` 表直读仍为过渡口径（随 i1 收口）。
- 单测：`test/task-rules.test.ts`（17 例，纯规则）+ `test/task-service.test.ts`（18 例，桩仓储不连库）+ `test/task-order.test.ts`（4 例，顺序纯函数）+ `test/task-locked-fields.test.ts`（8 例，锁定字段例外调整：桩仓储 + 角色 / 门禁替身）；Push 153 后全量 387 例 / 26 文件（任务族：rules 17 / service 22 / order 4 / gate 8 / batch 9 / remove 10 / locked-fields 8）；**Push 155（M6-01 ~ M6-03 日报 / 问题）后全量 416 例 / 27 文件** —— `test/task-remove.test.ts` 10 → **12 例**（引用守卫补齐：日报 `report_ref` / 问题 `issue_ref`，与变更记录同一 409 `TASK_HAS_REFERENCES`）。

## 完成门禁（M3-03 · Push 143）

> 口径来源：系统功能书 A4-20 / A2-10、ADR-024（成果文件多选与门禁）、技术设计v0.3 §3.4。

- 契约：`GET /projects/{id}/tasks/{taskId}/can-complete`（预检：`canComplete` + `missing[]` + `warnings[]`）、`POST …/complete`（提交：`{ task, warnings }`）；错误码新增 422 `TASK_REQUIRED_DOC_MISSING`（缺件）与 409 `TASK_ALREADY_DONE`（重复提交）；`Task.deliverableTypes: DocType[]`（数组、服务端去重、空数组 = 不要求）。
- 判定来源（ADR-024）：① 有节点任务按所属节点 `node_requirements` 的 `required_doc` 逐类统计（与 node 模块 `GateService.evaluateNode` 同口径）；② 无节点任务按自身 `deliverable_types` 兜底（每类 ≥ 1 份）。定档口径 = `files.status ∈ (final, changed)` 且 `current_version_id` 非空；统计范围 = 节点下 / 任务下文件（回收站不计）。
- 三入口一致（A4-20）：完成提交（`POST …/complete`）与 `PATCH …/{taskId}`（`status=done`）、`PATCH …/progress`（`progress=1`）在**事务内走同一门禁判定**；缺件一律 422 + `missing[]`（`details[].code = required_doc`）且不部分生效（乐观锁校验在前、写库在后）。
- 放行提示（A2-10 / R02）：存在未定档（draft）成果文件时放行，响应带 `warnings[{ code: draft_doc_present, docType, count }]`，并写 outbox `task.draft_doc_reminded`（R02 触发点，notify 落地后消费）。
- 留痕：拒绝 → outbox `task.gate_rejected`（事务回滚后补写）+ 审计 `result=failed`（含错误码与缺件明细）；成功 → outbox `task.completed`（payload 带 warnings）+ 审计 `action=complete`。
- 数据面：迁移 `0018_task_deliverable_types.sql`（`deliverable` text → `deliverable_types` text[] 非空默认空数组 + `ck_tasks_deliverable_types` / `ck_tasks_deliverable_types_no_null` + GIN `ix_tasks_deliverable_types`；存量单值转单元素数组、空值转空数组）；创建任务缺省从节点 `required_doc` 类型带出（body 显式给出优先）；`TaskUpdateBody` 不含该字段 = 生成后锁定（A1-17；**例外调整已落 Push 153**，见下节），PATCH 置空/编辑不可达。
- 实现归属：门禁判定实现在本模块 `task.gate.repository.ts`（只读 `node_requirements` / `files`）—— node 模块 `GateService` 依赖 task（`TaskStatsService`），task 反向依赖会成环；两处 SQL 口径必须同步修改（node/README.md 已登记）。
- 单测：`test/task-gate.test.ts` 8 例（预检缺件明细 / 无节点 deliverable_types 兜底 / 完成缺件 422 + outbox + 审计 failed / 门禁通过 200 + `task.completed` / draft 放行 + R02 / 重复提交 409 / `PATCH status=done` 与 `progress=1` 同一门禁）。

## 批量操作（M3-04 · A1-08 · Push 150）

> 口径来源：系统功能书 A1-08（批量指派 / 改状态 / 改日期 / 批量完成）；一次请求 = 同一组变更应用到 1~100 个任务。

- 端点与权限：`PATCH /projects/{id}/tasks/batch`（注册在 `PATCH …/{taskId}` 之前，否则 batch 会被当作任务 id 命中）；权限键 `task.update`（项目内成员平权）；归档项目入口 409 `PROJECT_ARCHIVED`。
- 变更白名单 `TaskBatchChanges`：`ownerIds` / `status`（基础三态，done = 批量完成，走同一完成门禁）/ `plannedStart` / `plannedEnd` / `estimatedDays` / `headcount` / `priority` / `note`；语义与单条编辑一致（null = 清空、缺键 = 不改）；不含任务描述 / 成果文件（A1-17 生成后锁定）与 `sortIndex`（顺序是「插入位置」的逐条语义）；全空 changes 400 `VALIDATION_FAILED`。
- 执行模型：`ids` 去重后按首次出现顺序**逐条独立事务**（避免长事务与整体回滚），复用单条写入内核 `applyUpdate`（锁行 → 校验 → 状态联动 → 完成门禁 → 落库 + 事件 + outbox + touch + 审计）；响应 `{ total, succeededCount, failedCount, succeeded[], failures[] }`。
- 部分失败（条目级可预期错误降级，整体 200）：`not_found`（不存在 / 不属于该项目）/ `archived` / `gate_not_passed`（带 `missing[]`，与完成门禁同形）/ `already_done`（批量完成遇已完成条目，不重复写）/ `version_conflict` / `invalid_state`（其它 4xx）；非 AppError 照旧抛出（500）。
- 留痕双层：① **批次审计**（A1-08「批量操作整体写审计日志」）—— 每次请求一条 `project` 域记录（summary「批量操作任务：N 条（成功 X，失败 Y）」，metadata = `{ entry, batchId, taskIds, changedFields, succeededCount, failedCount, failures[] }`）；② **逐条字段级审计**（C7-02）—— `action=update`，summary 前缀「批量修改任务：」，`metadata.entry = batch` + 同批 `batchId`；批量完成缺件的拒绝留痕沿用 outbox `task.gate_rejected` + 审计 `result=failed`（summary 前缀「批量任务完成被门禁拒绝：」+ 同批 metadata）。
- 单测：`test/task-batch.test.ts` 9 例（批量改字段 + 审计同 batchId / 部分失败 not_found / ids 去重 / 空 changes 400 / 归档 409 / 批量指派置空 / 批量完成 / 缺件 gate_not_passed + 留痕 / already_done）。

## 软删（M3-05 · A25 · Push 152）

> 口径来源：系统功能书【修订 2026-09-22，Push 148】业务确认「任务删除要做」+ `前端功能需求.md` §3.8 A25；记录级 404 语义随 h6 策略服务。

- 端点与权限：`DELETE /projects/{id}/tasks/{taskId}`（权限键 `task.update` —— 与编辑同一权限位，不新增权限键，`PROJECT_MEMBER_IMPLIED_KEYS` 已含该键）；响应 `TaskDeleteResponse = { id, deleted: true }`（只回标记，前端列表本地移除即可）；项目侧照旧先过 `loadProjectForWrite`（归档 409 `PROJECT_ARCHIVED`）。
- 软删而非物理删：置 `tasks.deleted_at` / `deleted_by`（迁移 `0022_task_soft_delete.sql`，照 0009 projects / 0019 stakeholders 口径），行与留痕保留；**统一 404、不新增错误码** —— 重复删除、已删任务上的编辑 / 进度 / 完成提交 / 预检、跨项目与不存在一律 404 `NOT_FOUND`（记录级 404 语义）。
- 引用守卫（系统功能书 A2-01「已产生日报 / 问题 / 变更的任务不允许删除，只能关闭或标记」）：`change_refs` 非空 → 409 `TASK_HAS_REFERENCES`（`details[].code = change_ref` + `changeRequestId`），不软删 / 不压缩位次 / 不写留痕；日报 / 问题两表随 M5 落地后在守卫处一并加判定（照「节点下已有文件 → 409 `NODE_HAS_FILES`」同一先例）。
- 读面不可见：列表 / 详情 / summary 四格 / 阶段计数 / 看板与甘特图（与列表同源）/ 完成门禁预检与提交 / 节点判重 / 组内顺序读 / 锁行一律过滤 `deleted_at is null`；新增部分索引 `ix_tasks_active_group (project_id, stage_key, sort_index) where deleted_at is null`（列表与看板顺序读走它）。
- 组内位次压缩（A19 / A20 不变式）：删除后同组后续任务位次同事务 -1，保持「0 起、密集」；只写位次列，不 bump `version` / `updated_at`（与插入 / 移动同口径）。
- 节点释放（A10 / A11）：判重走 `findTaskIdByNode`（只看未删行），软删后同一节点可重新创建任务；`tasks` 本无 `(project_id, node_id)` 唯一约束，无需改约束。
- 留痕：审计 `action=delete`（`objectType=task`，summary「删除任务：<标题>」，changes = 删除前快照，metadata `{ softDelete: true, stageKey, nodeId }`）+ outbox `task.deleted`（dedupeKey = `task.deleted:{taskId}:{version}`，payload = projectId / taskId / stageKey / nodeId / actorId / at）+ touch 项目 `updated_at`；**不写 `task_events`**（其类型为四值闭集：status_change / date_change / progress_change / note_change，删除不属于字段级变更）。
- 单测：`test/task-remove.test.ts` 10 例（软删置位 + 审计快照 / 位次压缩 / outbox task.deleted / 重复删除 404 / 不存在与跨项目 404 + 并发兜底 / 归档 409 / 已删任务写路径全 404 / can-complete 404 / 节点释放可重建 / 位次仍 0 起密集 / **已有变更关联 409 `TASK_HAS_REFERENCES`（不软删 / 不变位次 / 不写留痕）** / 无关联照常软删）。

## 锁定字段例外调整（M3-05 续卡 · A1-17 / C9-07 · Push 153）

> 口径来源：系统功能书 A1-17（任务描述 / 阶段性里程 / 输出成果文件按流程节点模板生成后锁定；确需修正时由管理员修正模板 + 对当期任务例外调整，原因必填并留痕）与 C9-07；设计口径见 技术设计v0.3 §3.4（M3-05）。

- 端点与权限：`PATCH /projects/{id}/tasks/{taskId}/locked-fields`（body `TaskLockedFieldsAdjustBody` = `version` + `reason` + 可选 `title` / `titleEn` / `deliverableTypes`）；控制器 `@RequirePermission(task.update)` 只作项目上下文门禁，**服务端 `assertAdmin` 复核（仅系统管理员，非管理员 403）** —— 与手工创建任务同口径（A1-13）。
- 锁定范围：`title`（任务描述）/ `titleEn` / `deliverableTypes`（要求输出成果文件）；常规编辑 `PATCH …/{taskId}` 与批量 `PATCH …/batch` 均不含这三项；**「阶段性里程」一期 tasks 表无对应列**（A1-17 映射修订），本期不开放（差异登记见本 README 边界段与系统功能书）。
- 校验：至少一个实际变化（同值 / 空调整 → 400 `VALIDATION_FAILED`，防止刷留痕）；`deliverableTypes` 走 `normalizeDocTypes`（字典内、首次出现去重保序）；乐观锁 409 `VERSION_CONFLICT`；归档项目 409 `PROJECT_ARCHIVED`；不存在 / 跨项目 / 已软删统一 404。
- 留痕（A1-17 / C9-07）：审计 `action=update`（changes = 锁定字段 before → after；metadata = { reason, kind: locked_field_exception, adminOnly: true, fields }）+ outbox `task.locked_fields_adjusted`（dedupeKey = `task.locked_fields_adjusted:{taskId}:{version}`，payload = projectId / taskId / fields / reason / actorId / at）+ touch 项目 `updated_at`；**不写 `task_events`**（四值闭集）。
- 门禁联动：`deliverableTypes` 修正后即刻成为**无节点任务**的完成门禁依据（有节点任务仍以节点 `node_requirements` 为准，ADR-024）。
- 单测：`test/task-locked-fields.test.ts` 8 例（管理员改 title + deliverableTypes → 落库 / 版本 +1 / 审计含原因 / outbox / touch / 不写 task_events / 非管理员 403 且无留痕 / 空调整 400 / 乐观锁 409 / 归档 409 / 不存在与跨项目与已软删 404 / 去重与非法值过滤 + 门禁联动 / titleEn 清空）。

## 五态写入与汇总卡（M3-07 刀 1 · Push 179 · 2026-09-24 业务定案）

> 业务口径：「状态下拉都要有 要5态 但是他们的逻辑要和之前的一样」/「（`currentStage` 保持 = 项目当前阶段）有了最快最慢这个就不需要了」；按授权替 wmj 线落地，跨线请 wmj 复核。

- **写面**：契约新增 `TaskStatusWrite`（`pending` / `active` / `done` / `overdue` / `early_done`），替换 `TaskUpdateBody.status` 与 `TaskBatchChanges.status` 的实现类型；服务端 `applyStatusWrite` 五态分支（overdue = 保持格数与完成日期、只落 `status_override`；early_done = 四格全亮 + 完成日期缺省当天 + 覆盖），`applyProgressWrite` 与 `done / active / pending` 一律清覆盖。
- **读面**：`deriveDisplayStatus` 先判覆盖（边界：overdue 仅未完成、early_done 仅已完成）再走原派生；`displayStatusExpression`（SQL CASE）与规则函数**严格同形** —— `filter[status]` 下推与读时派生必须同批修改，改一处即改两处（`task.query.ts` 的解析注释同步）。
- **汇总卡**：`summary()` 由 `taskCountsByStage` 聚合（`stage_key is null` 的「未分组」不参与阶段判定、只进三计数）；`slowestStage` = `STAGE_KEYS.find(存在未完成)`、`latestStage` = 反序 `find(已动工)`；`currentStage` 字段从契约删除（`projects.stage_key` 本身仍供阶段推进，不再出现在汇总卡）。
- **留痕**：`buildEvents` 的 `status_change` 负载补 `statusOverride`（只记本次变化的键）—— 基础态不变、只切覆盖时同样有事件；`taskAuditSnapshot` 同样带该字段。
- **迁移**：`database/migrations/0031_task_status_override_and_priority_three_levels.sql`（`tasks.status_override` + CHECK + 存量 `priority` 折算三档，无其他 DDL）。
- **验证**：`test/task-rules.test.ts` / `test/task-service.test.ts` 新增五态与两阶段用例；真机回放 `server/scripts/m3-07-replay.mjs` 24 项断言全过（证据 `docs/m3-07-回放证据(五态与汇总卡).md`：覆盖写入与清空、覆盖来源筛选命中、两阶段与两个 null 边界、四象限值 400、事件负载、批量五态、零残留）。
## 落库口径（w2 · A15 / A18 / A19 / A20 · Push 124）

> 口径来源：`前端功能需求.md` 附录 A15 / A18 / A19 / A20（Push 119 / 120 定案）与 `字段对照清单.md` §七；落库机制二选一定为 **① `tasks.sort_index` 位次列**（不新增批量排序接口）。

- 顺序（A19 / A20）：一组 = 同一项目 + 同一阶段（`stage_key` 为空 = 「未分组」，自成一组）；组内位次 0 起、密集。创建带 `sortIndex` = 插入位次、编辑带 `sortIndex` = 移到组内第 N 位（两者越界 / 缺省都落组尾），同组其余任务顺延 —— 只写位次列、不逐个 bump `version` / `updated_at`，并发靠组行锁（`select … for update` 锁整组后再锁任务行）。
- 阶段可空（A15）：创建不传 / 显式 null = 「未分组」；带 `taskNodeId` 时缺省取节点所属阶段、显式不一致 400。默认读序 = **阶段序（`STAGE_KEYS` 序，未分组落最后）+ `sort_index` + id**（A8 原「阶段序 + `planned_start` + `created_at` + id」由本条取代）；阶段完成度（`GET /projects/{id}/stages`）与阶段门禁**只统计带阶段任务**。
- 负责人可多位 / 可空（A18 / A23 · Push 136）：创建不传 = 项目全部项目经理兜底、显式 `[]` = 「待分配」；编辑不传 = 不改、显式 `[]` = 置空、传数组 = 整体替换（顺序 = 展示顺序）；`Task.ownerIds` 为 uuid[]（空数组 = 待分配）、`TaskListItem.ownerNames` 为同下标姓名数组。筛选 `filter[ownerId]` = 任一位负责人命中即命中。
- 数据面与契约：迁移 `0015_task_order_and_nullable_scope.sql`（回填按迁移前默认读序 → 迁移前后读序一致；`ck_tasks_sort_index` + `ix_tasks_project_stage_order`）与 `0017_multi_manager_and_owner.sql`（`owner_id` → `owner_ids` uuid[] + `ck_tasks_owner_ids_no_null` + `ix_tasks_owner_ids` GIN；回填空数组 / `array[owner_id]`）、Drizzle `src/db/schema/tasks.ts`、契约 `shared/src/modules/tasks.ts` 三处同步（`check:db-schema`：27 表 / 265 列 / 78 索引 / 77 CHECK · Push 143 后）；outbox topic 与 `task_events` 类型不变，`sortIndex` / `ownerIds` 进审计快照（C7-02 字段级留痕）。
- 真机回放：`server/scripts/w2-replay.mjs`（真 PG + 真 api :3011，33 项断言，退出码即门禁）；证据入 `docs/w2-回放证据(任务落库口径A15A18A19).md`。

## 边界与后续（差异登记）

- 已随 h6 落地：读路由记录级 404（不可见项目 / 跨项目任务统一 404）、写路由功能权限位（`task.create` / `task.update` / `task.progress` —— 项目内成员对这三项平权，见 `modules/permission/README.md`）；手工创建仅管理员的口径随 A1-13 复核；
- M3-07 刀 1 后半（前端接线）不在本模块：前端 `taskApi.ts` 接线与服务端零改动；刀 2（门禁三入口 / 批量 failures 消费）、刀 3（添加任务模板化 + 快筛）待后续切片。
- 不在本卡（Push 152 后更新）：列表快捷筛选参数、门禁增强 M3-04 ~ M3-06（**M3-03 已落 Push 143**：`deliverableTypes` 多值 + 完成门禁；**M3-04 批量操作已落 Push 150**：批量指派 / 改状态 / 改期 / 批量完成 + 部分失败清单；**M3-05 软删已落 Push 152**：`DELETE …/tasks/{taskId}` + 统一 404 + 位次压缩；**锁定字段例外调整已落 Push 153**：仅管理员可执行（非管理员 403）/ 原因必填并留痕（审计 + outbox）/ 空调整 400 / 阶段性里程一期无列；模板实例化与快筛随 M3-05 其余切片、1 万行压测随 M3-06）；
- A1-17 差异登记（Push 153）：系统功能书锁定字段含「阶段性里程」，一期 `tasks` 表无该列（A1-17 映射修订），本期只开放任务描述 / 英文描述 / 输出成果文件三项；里程碑列落地后再开；
- 列表默认序已有 `ix_tasks_project_stage_order (project_id, stage_key, sort_index)` 复合索引（0015 · Push 124）；1 万行压测与索引调优仍随压测卡 M3-06；
- 契约里进度档位为离散五档，迁移数据任意小数在读时四舍五入到最近档。
