# task 模块（h4 · S6·task：任务主表 / 五态派生 / 进度聚合）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 任务主数据（列表 / 详情）、进度与状态写入联动、展示五态与按时交付派生、项目总览四格、阶段任务统计出口 |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | TaskService（summary / list / detail / create / update / updateProgress）、TaskStatsService（countStageTasks / stageTaskCounts）、规则纯函数与查询解析（task.rules / task.query）；节点实例的读写仍在 project 模块 flow.service（依赖方向 project → node → task，本模块不反向依赖） |

## 已实现（h4 · Push 86）

- 契约：`shared/src/modules/tasks.ts`（列表 / 详情 / 创建 / 编辑 / 进度五组 schema + `TaskListItem` 随行摘要）；错误码新增 `TASK_ALREADY_EXISTS`（409：节点已有未删任务）。
- 规则口径（纯函数 `task.rules.ts`，来源：系统功能书 A1-06、A12 / A13 / A14（Push 70 定案）、ADR-028 时区）：
  - 展示五态**读时派生、不写回存储**（存储只有基础三态 `pending / active / done`）：`overdue` = 未完成且已过预计完成日期（派生优先，人工写状态不改写它）；`early_done` = 完成且实际完成日期早于预计完成日期；
  - `applyStatusWrite`（A12）：done → 满格 + 缺省补当天完成日期（已有日期保留）；active → 至少 1 格（0 → 0.25、满格 → 0.75）并清完成日期；pending → 清进度与完成日期；
  - `applyProgressWrite`（A13）：0 → 待开始；0.25 / 0.5 / 0.75 → 进行中并清完成日期（**清除完成日期的唯一方式**）；1 → 已完成 + 完成日期（缺省当天，可显式传入）；
  - `deriveOnTime`（A14）：完成且实际 ≤ 预计 → true，完成但晚于预计（或未填完成日期且预计已过）→ false；未完成已过期 → false；派生不出回落存储值；
  - 日界：`shanghaiToday` 按 UTC+8 固定偏移算出后以参数进 SQL（ADR-028），不在 SQL 里拼时区表达式。
- 接口（挂 `api/v1/projects`；读登录即可，写入口径见下）：
  - `GET /{id}/summary` 项目总览四格（当前阶段 / 逾期 / 已完成 / 总数）；
  - `GET /{id}/tasks` 分页列表：阶段 / 负责人 / 展示态（可多值，条件下推 SQL）/ 关键字 `q` 筛选 + 排序白名单（plannedStart / plannedEnd / actualEnd / progress / title / createdAt；默认序 = 阶段序 + 预计开始 + 创建时间 + id）；非法参数 400；
  - `GET /{id}/tasks/{taskId}` 详情：抽屉全字段 + 文件清单 + 负责人名与变更摘要（`fileSummaries` 聚合，免 N+1）；
  - `POST /{id}/tasks` 创建：① 从任务节点生成（节点须属本项目，`stageKey` 与节点阶段不一致 400；同节点已有未删任务 409 `TASK_ALREADY_EXISTS`）；② 手工创建（**仅管理员**，系统功能书 A1-13，非管理员 403）；
  - `PATCH /{id}/tasks/{taskId}` 编辑：乐观锁 `version`（不一致 409 `VERSION_CONFLICT`）+ 基础三态写入联动（A12）+ 字段级留痕；任务描述 / 成果文件锁定不在本接口；
  - `PATCH /{id}/tasks/{taskId}/progress` 进度写入：响应与列表行同形（`TaskListItem`），联动状态与完成日期；`note` 写 note_change 事件留痕；
  - 归档项目写入口径 409 `PROJECT_ARCHIVED`（ADR-027）；任务变更 touch 项目 `updated_at`（ADR-022 ④）。
- 留痕与队列：`task_events` 四类型 `status_change / progress_change / date_change / note_change`（before / after 为 JSON 键值对）+ outbox 三个 topic `task.created / task.updated / task.progress_changed`（dedupeKey 带版本）。
- 与 h3 门禁的衔接（**过渡口径收口**）：`node/gate.repository` 不再直读 `tasks` 表；阶段推进门禁的「任务全 done」与 `GET /projects/{id}/stages` 的任务计数改经 `TaskStatsService` 出口，`StageProgressRow` 不再携带任务字段，门禁语义不变；`files` 表直读仍为过渡口径（随 i1 收口）。
- 单测：`test/task-rules.test.ts`（17 例，纯规则）+ `test/task-service.test.ts`（13 例，桩仓储不连库）；h4 后全量 130 例 / 11 文件。

## 边界与后续（差异登记）

- 记录级 404 与成员权限矩阵随 h6（当前读登录即可、写成员平权）；手工创建仅管理员的口径随 A1-13 复核；
- 不在本卡：列表快捷筛选参数、任务软删 / 批量操作 / `deliverableTypes` 校验、门禁增强 M3-03 ~ M3-06（属后续卡）；
- 列表默认序暂无复合索引（当前数据量下可接受，压测卡 M3-06 一起评）；
- 契约里进度档位为离散五档，迁移数据任意小数在读时四舍五入到最近档。
