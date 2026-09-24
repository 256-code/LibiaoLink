# template 模块（M3-05 余第一段 · 任务节点库 A1-16 / A1-17 · Push 181）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 任务节点库（`task_nodes`）读写：列表 / 新增 / 编辑 / 删除（模板 TaskTemplate 随第二段） |
| 主责 | wmj（团队分工.md §2；本切为 px 按授权代做，请 wmj 复核） |
| 对外接口 | `TemplateService` / `TaskNodeRepository`（`index.ts` 出口） |

## 本切片交付（Push 181）

- **契约**：`shared/src/modules/templates.ts` —— `TaskNodeSchema` / `TaskNodeListQuerySchema` / `TaskNodeCreateBodySchema` / `TaskNodeUpdateBodySchema` / `TaskNodeDeleteResponseSchema`；`shared/src/openapi.ts` 新增 `POST /api/v1/task-nodes`、`PATCH /api/v1/task-nodes/{id}`、`DELETE /api/v1/task-nodes/{id}`。
- **数据**：迁移 `database/migrations/0032_task_nodes.sql`（`task_nodes`：九阶段 CHECK / `seq` 正数 / 同阶段同名唯一 `uq_task_nodes_stage_title` / 读序索引 `ix_task_nodes_stage_seq`）+ 种子 #8（九阶段 52 条）。
- **读**：`GET /api/v1/task-nodes?stage=`（登录即可；缺省全部阶段）—— 排序 = 九阶段顺序 → `seq` → `id`；`total` 与 `items` 同步。
- **写**（服务层 `blueprint.manage` 复核，仅系统管理员；非管理员 403 `FORBIDDEN`）：
  - `POST /api/v1/task-nodes`：`title` trim 后落库、`titleEn` 空串 → null；同阶段同名 409 `NODE_ALREADY_EXISTS`（不落库不留痕）；缺省 `seq` = 该阶段末位 + 10；
  - `PATCH /api/v1/task-nodes/{id}`：只改传入字段（`titleEn` 传 null / 空串 = 清空）；`version` 必传 —— 过期 409 `VERSION_CONFLICT`；改名撞同阶段已有名 409 `NODE_ALREADY_EXISTS`（排除自身）；不存在 404 `NOT_FOUND`；
  - `DELETE /api/v1/task-nodes/{id}`：**物理删行**（与字典条目硬删同口径），删除前快照进审计 `changes`；已按该节点生成的项目任务不受影响（任务侧无外键）。
- **留痕**：每条写操作一条审计（`objectType` = `task_node`；`summary` 带阶段中文名与节点名；`metadata` 记 `stageKey` / `seq`），与业务写入**同一事务**；**不写 outbox**（与字典维护同口径）。
- **边界**：不碰 `tasks` / `project_nodes` —— `tasks.node_id` 指向流程节点（`project_nodes`），节点库只回答「任务从哪来」；前端接线见 `frontend/src/templateApi.ts` 与 `PlaceholderPage.tsx`（左列「任务节点」：新增 / 编辑 / 删除 + 按板块缓存重取）。

## 验证

- `test/template-nodes.test.ts` —— 17 例全绿（列表 / 新增（归一 + seq + 同名 + 越权）/ 编辑（改名 + 英文名清空 + 同名放行与拦截 + 乐观锁 + 404 + 403）/ 删除（快照 + 404 + 403））。
- `npm run typecheck` / `npm run build` / `npm test`（587 → 593 项）/ `npm run check:db-schema`（35 表 · 353 列 · 111 索引 / 唯一 · 114 CHECK）/ `npm run check:boundaries` 全过。
- 真机回放：`frontend/scripts/m3-05-task-nodes-e2e.mjs` 48 项全过，证据 `docs/m3-05-回放证据(节点库增删改·前端).md`。

## 待办（第二段）

- 模板（TaskTemplate）读写：`GET /api/v1/task-templates?stage=`、`GET /{id}`、`POST`、`PATCH`（`nodeIds` 全量替换 + `version`）、`DELETE`（带 `version`），以及实例化 `POST /api/v1/projects/{id}/tasks/from-template`。
- 模板落库后，前端右侧模板面板（`PlaceholderPage.tsx` 的内存草稿）改吃接口，「保存」按钮 = `PATCH`。
