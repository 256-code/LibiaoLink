# server/ · 后端工程（g4 骨架 · g6 会话后端化 · h1 identity/org · h2 project · h3 流程节点 · h4 task · h5 PoC-9 · h6 权限矩阵 · h7 字典与审计）

NestJS 12 模块化单体骨架：api / worker 双入口、统一错误与日志、健康检查、Drizzle schema 与服务边界规则；identity 模块已落地 `/auth/*` 会话链路（g6）。

依据：《技术设计v0.2-架构与数据模型.md》§1.1 进程与组件、§1.2 模块划分与依赖规则、§1.3 事务与幂等；《团队分工.md》§2 模块归属；ADR-002 / 003 / 004 / 014 / 017。

## 目录结构

```text
server/
  src/
    entry/api.ts          # api 入口（HTTP）
    entry/worker.ts       # worker 入口（同镜像不同入口；支持 --health-check 一次性探针）
    app.module.ts         # api 进程装配
    worker.module.ts      # worker 进程装配
    common/               # errors / http（校验管道）/ audit（越权留痕路径解析与 sink 令牌 · h7）/ logging
    config/               # 环境变量契约（Zod）与全局配置模块
    db/                   # PG 连接 + Drizzle schema（对齐 database/migrations）
    health/               # 垂直样例：controller -> service -> repository
    modules/identity/     # 首个真实实现：/auth/* 会话链路（g6）
    modules/permission/   # 权限策略层（h6 · PoC-6）：记录级 / 功能权限 / 字段级 / 五出口投影
    modules/admin/        # 字典 C9 与审计留痕 C7（h7）：类型 / 条目维护 + 审计写入与检索（其余模块仍为 README 占位）
  scripts/check-boundaries.mjs   # 依赖方向规则检查
  scripts/check-db-schema.mjs    # Drizzle schema 与实际库漂移检查
  scripts/check-permission-matrix.mjs  # 权限矩阵自检（种子 #6b ↔ 契约枚举 ↔ 角色集，不连库）
  test/                          # vitest（health / auth 端到端 + 校验管道单测；auth 用进程内桩 IdP，不依赖 PG 与 Casdoor）
```

## 命令

| 命令 | 说明 |
|---|---|
| `npm run build` | nest build（tsc，输出 `dist/`） |
| `npm run typecheck` | tsc --noEmit（含 `test/`） |
| `npm run dev:api` | nest start --watch（api） |
| `npm run start:api` / `start:worker` | 运行构建产物（自带 `--env-file-if-exists=.env`） |
| `npm run test` | vitest run |
| `npm run check:boundaries` | 依赖方向规则（违规退出码 1） |
| `npm run check:permission-matrix` | 权限矩阵自检：种子 #6b ↔ 契约 `PermissionKey` 枚举 ↔ 角色集（admin 必须全量；不连库，退出码 1） |
| `npm run check:db-schema` | Drizzle schema ↔ 实际库（需先 build） |
| `node dist/entry/worker.js --health-check` | worker 一次性健康检查 |

## 本地运行

前置：Node 24、PostgreSQL 18（库结构由 `database/` 迁移器维护）、`shared/` 已构建。

1. `cd shared && npm ci && npm run build`（server 依赖 `@libiaolink/contracts` 的 `dist/` 产物）
2. `cd server && npm ci`
3. `cp .env.example .env`，按需改 `DATABASE_URL`（应用角色 `libiaolink_api`，无 DDL 权限）；`/auth/*` 另需 `CASDOOR_*`（本地沙箱见 `deploy/casdoor/`，真实值不落仓库）
4. `npm run build && npm run start:api`，然后 `curl http://127.0.0.1:3000/healthz`、`/readyz`

数据库迁移不在 server 内执行：`database/scripts/migrate.mjs`（见 `database/README.md`）。

## 进程边界

- api：HTTP、业务事务、Outbox 写入、SSE；无状态、不跑 CPU 密集任务。
- worker：Outbox 投递 / 调度 / 规则 / 转换编排 / 导出；骨架阶段只起进程与心跳（60s），`--health-check` 供探针使用。
- converter（沙箱）：一期由 file / preview（lan 线）落地，不在本骨架内。

## 模块结构约定

- 四层：controller（HTTP）/ service（用例）/ repository（数据访问）/ events（同事务写 Outbox），对外只经 `index.ts`。
- 13 个模块目录已占位（每个 README 标注类型 / 职责 / 主责 / 预留接口），代码随各自实现卡片落地。
- DTO 一律用 `@libiaolink/contracts` 的 Zod schema（配 `ZodValidationPipe`），禁止另起一套类型。

| 类型 | 模块 | 主责 |
|---|---|---|
| 领域（domain） | identity、project、blueprint、node、task、report-issue、stakeholder | wmj |
| 领域（domain · 横切） | permission（权限策略层 · h6） | wmj |
| 平台（platform） | file、notify、search、dashboard | lan |
| 平台（platform） | automation、admin（字典 / 审计 · h7 落地） | wmj |

## 依赖方向规则（npm run check:boundaries）

1. 跨模块只允许 `import` 对端 `index.ts`；
2. 平台模块不得反依赖领域模块（例外：`file → project` 仅限项目快照出口，即 `modules/project/index.ts`）；
3. `common/`、`db/`、`config/` 不得依赖 `modules/`；
4. 禁止循环依赖。

实现：`scripts/check-boundaries.mjs`（TypeScript 编译器 API，零新增依赖；违规退出码 1）。规则来源：v0.2 §1.2。

违规演示（本地验证记录，2026-09-18，演示文件已删除）：

- `modules/project/probe.ts` 深引 `modules/task/task.service.ts` → 拒绝（跨模块深引）；
- `modules/file/probe.ts` 引用 `modules/task/index.ts` → 拒绝（平台反依赖业务）；
- 修复后：24 个文件 / 50 条内部依赖 / 0 违规。

## 统一错误与日志

- 错误信封（唯一结构）：`code` / `message` / `details` / `traceId`（契约包 `ApiError`）；`AppError` 的 HTTP 状态取自 `HTTP_STATUS_BY_ERROR_CODE`，不手写映射。
- 校验失败统一 `VALIDATION_FAILED`（字段明细进 `details`）。
- 日志：Pino JSON（nestjs-pino）；请求日志含 `req.id`（透传或生成 `X-Request-Id` 并回写响应头），字段 `time` / `level` / `context` / `msg`。
- 全局过滤器在 `AppModule` 注册（`APP_FILTER`），api 与测试行为一致。

## 健康检查

- `GET /healthz`：存活（进程在即可），200 `{status:"ok"}`。
- `GET /readyz`：就绪；探测 PG 连通 + 核心表可达（projects / outbox_events）；失败 503 `{status:"degraded",checks:[...]}`。
- readyz 不校验迁移版本：应用角色 `libiaolink_api` 无权读 `schema_migrations`（最小权限，见 `database/README.md`）；迁移是否最新用 `node database/scripts/migrate.mjs --dry-run`。
- 两个端点都在 `/api/v1` 之外（基础设施端点，不走业务契约）。

## 会话链路（/auth/*，g6）

- 路由（根路径，不进 /api/v1）：`GET /auth/login`（302 SSO 授权页）、`/auth/callback`（state + PKCE 换令牌建会话）、`/auth/me`（401 = 需重新认证）、`/auth/logout`（撤销本地会话 + Casdoor 单点登出）；契约见 `shared/src/modules/identity.ts`、ADR-010。
- Cookie：`ll_sid`（HttpOnly 会话；DB 只存 sha256 哈希）、`ll_oidc`（PKCE 转场 10 分钟）、`ll_csrf`（可读；写接口叠加 `CsrfGuard` 回传 `X-CSRF-Token`）。
- 环境变量：`CASDOOR_ISSUER` / `CASDOOR_CLIENT_ID` / `CASDOOR_CLIENT_SECRET`（生产必填，启动即校验）/ `CASDOOR_REDIRECT_URI` / `CASDOOR_SCOPE` / `SESSION_IDLE_MINUTES`（默认 30，接入标准「企业内部系统」档；0 仅测试）/ `SESSION_COOKIE_SECURE`（auto = 仅生产 Secure）/ `CASDOOR_ORG_NAME`（目录同步 owner；生产必填）/ `INTERNAL_SYNC_TOKEN`（内部作业凭证；生产必填）。
- 会话超时：空闲 > `SESSION_IDLE_MINUTES` 或超过 ID Token `exp` → 401 并撤销；命中时 `last_seen_at` 按 60s 节流刷新。
- 供他人使用：`SessionGuard` + `@CurrentUser()`（identity index 出口）；`revokeAllForUser` 供组织同步（h1）踢线；h1 新增 `listDepartments`（DepartmentService）、`RoleService`（授权画像 / 角色绑定）、`OrgSyncService`（目录快照 → 差异报告）；细节见 `src/modules/identity/README.md`。

## 用户目录与内部作业（h1 收口）

- `GET /api/v1/users`（业务接口，首个 `/api/v1` 路由）：用户目录（A2），已登录全员可读、只返回启用用户；`q` 命中工号 / 姓名 / 邮箱，默认工号升序（契约 `shared/src/modules/users.ts`）。
- 内部作业（根路径，不进 `/api/v1`；统一 `X-Internal-Token` 鉴权，生产必填、缺失 / 不匹配 401）：
  - `POST /internal/users/disable` / `/enable` / `/delete`：离职回收（接入标准第五部分）；入参 `{"name","email"}`（name 为准、email 兜底），幂等 200（目录中不存在也成功）；disable / delete 撤销该用户全部在线会话（`affectedSessions`）；delete 为软删（`removed_at` 置位 + `status=disabled`，不物理删行）。
  - `POST /internal/org-sync/run`：手动触发一次 Casdoor 目录拉取 + 差异应用（`{"missingUserPolicy":"report|disable"}`，默认 report）；定时调度随 i5 接 worker。

## 项目接口（h2 · S6·project：M2-01 / M2-04 / M2-05）

- 契约 `shared/src/modules/projects.ts`（OpenAPI tags=projects）；实现 `src/modules/project/`（controller / service / repository / query + `index.ts` 唯一出口）；整组路由挂 `SessionGuard + CsrfGuard`（读要登录、写要 `X-CSRF-Token`），`GET /facets` 注册在 `GET /{id}` 之前。
- `GET /api/v1/projects`：分页 + 多维筛选（`filter[region|projectType|managerId|stageKey|status]` 多值英文逗号分隔）+ 关键字 `q`（编号 / 名称 / 客户 / 序号）+ 时间闭区间（`filter[timeFrom]` / `filter[timeTo]`，Asia/Shanghai 日界，映射 `updated_at`）+ 排序白名单（`updatedAt` / `createdAt` / `seqNo`，缺省 `updatedAt:desc`）；非法枚举 / 非法 uuid / 区间反向一律 400（不返回静默空列表）。
- `GET /api/v1/projects/facets`：与列表共用同一个 filter 构造器（五组计数 + `total`），计数与列表同口径（v0.2 §8.2 / A6）。
- `POST /api/v1/projects`（201）：编号 `code` 由创建人填写、唯一性由数据库约束兜底（409 `PROJECT_CODE_EXISTS`）；`seq_no` 由序列分配（不接受传入）；缺省 `stageKey=presale`。`PATCH`（乐观锁：正文 `version`，409 `VERSION_CONFLICT`）、`DELETE`（`If-Match` 回传当前 `version`，缺头 400；软删落 `deleted_at` / `deleted_by`）。
- 归档写保护（ADR-027）：`status=archived` 的项目 PATCH / DELETE 一律 409 `PROJECT_ARCHIVED`（错误码随本批入契约与映射表）。软删（A5）：列表 / 详情 / facets 统一 `deleted_at is null`；`seq_no` 不回收、同编号再建仍 409。
- 成员名册（M2-05）：`GET /api/v1/projects/{id}/members`（项目经理在前，同角色按工号升序，姓名随行）、`POST`（200；幂等 upsert —— 同项目 + 同用户唯一，重复添加 = 覆盖角色且保留 `joinedAt`；目标用户不存在 404）、`DELETE /api/v1/projects/{id}/members/{userId}`（返回被移除行；不是成员 404）。名册是记录级权限（非成员 404）与「我参与的项目」的数据来源；成员变更按 ADR-022 ② touch 项目 `updated_at`；归档项目名册只读（409 PROJECT_ARCHIVED）。
- 分类字段口径（A1-12）：`region` / `projectType` 为 facets 两组计数来源；创建缺省「未分类」（契约 default），更新可改。
- 会话侧新增出口：`@CurrentActorId()`（identity index）—— 当前用户在本库 `users.id`（uuid），供落库外键 / 审计字段使用；`@CurrentUser()` 仍是 Casdoor 侧口径。

## 流程接口（h3 · S6·blueprint/node：M2-02 / M2-03）

- 契约 `shared/src/modules/flow.ts`（OpenAPI tags=flow）；实现 `src/modules/project/`（`flow.controller.ts` / `nodes.controller.ts` + `flow.service.ts` / `flow.repository.ts`）、`src/modules/blueprint/`（蓝图数据面）、`src/modules/node/gate.*`（完成门禁，独立模块避免 project ↔ blueprint 循环依赖）；整组路由挂 `SessionGuard + CsrfGuard`（读要登录、写要 `X-CSRF-Token`）。
- 蓝图（ADR-019）：`GET /api/v1/blueprint?projectType=`（该项目类型尚未建档 404 —— default 只是导入 / 版本解析的兜底，不返回给编辑器）、`PUT`（保存草稿，未建档首次保存即建档）、`POST /publish`（版本递增；**无变更重复发布不递增** —— 幂等）、`GET /export` 与 `POST /import`（自建格式 round-trip 无损，实测导出 → 导入 → 再导出一致）。写接口仅管理员（角色码 `admin`）→ 非管理员 403。
- 建项目导入快照（M2-02）：`POST /api/v1/projects` 单事务 = 插入 projects → 取该项目类型「已发布蓝图」（缺失回落 default）→ 生成 `project_stages` / `project_nodes` / `node_requirements`（唯一键 + `onConflictDoNothing`，重复导入幂等）→ `projects.stage_key` 指向蓝图首阶段（请求 `stageKey` 命中快照阶段时按请求）→ 同事务写 outbox `project.created`；蓝图都不可用（含 default 未发布）→ 422 `BLUEPRINT_NOT_PUBLISHED`。`GET /projects/{id}/flow` 返回快照（`blueprintVersion=0` = h3 之前建的项目：无 stages / nodes）。
- 阶段推进 / 回退（M2-03 · ADR-023）：`GET /projects/{id}/stages`（九阶段状态 + 节点 / 任务完成度，读时派生）、`POST …/stages/{key}/advance`（仅当前 `active` 阶段；服务端门禁 = 该阶段节点全 done + 任务全 done + 各节点必交成果文件齐备；失败 422 `STAGE_GATE_NOT_PASSED` + `details[].code = node_not_done / task_not_done / doc_missing`，**整体一次事务、不部分推进**）、`POST …/stages/{key}/rollback`（仅相邻上一阶段、原因必填、不做门禁；首阶段 409 `STAGE_STATE_INVALID`）。推进：阶段 `status=done` + `advanced_at/by`、下一阶段 `active`、`projects.stage_key` 前移；回退：本阶段回 `pending` + `rolled_back_at/by` + `rollback_reason`、上一阶段回 `active`、`stage_key` 回移。
- 节点增删（ADR-020）：`POST /projects/{id}/nodes`（仅项目经理：`admin` 角色 / `projects.manager_id` / 名册 `role_in_project=project_manager` 三选一，否则 403；`nodeKey` 必须命中**项目导入版本**的模板节点池，否则 422 `BLUEPRINT_REF_UNKNOWN`；`node_key` 在项目内唯一（DB 唯一索引 `project_nodes_project_id_node_key_key`）—— 已有未删节点 409 `NODE_ALREADY_EXISTS`，软删后再增补 = 还原同一行（回 `pending`、清完成留痕）；`seq` 缺省 = 同阶段 max + 10）、`DELETE /projects/{id}/nodes/{nodeId}`（原因必填、软删、乐观锁；节点下有成果文件 409 `NODE_HAS_FILES`）。
- 完成门禁（v0.2 §3.6）：`POST /api/v1/nodes/{id}/complete`（**成员平权**，服务端事务内强校验；缺 `required_doc` → 422 `NODE_REQUIRED_DOC_MISSING` + `missing[]` 明细；重复完成 409 `NODE_ALREADY_DONE`；响应按契约 `NodeCompleteResponse`（{ node }））、`GET /api/v1/nodes/{id}/can-complete`（预检，只是 UI 置灰依据）。门禁拒绝写 outbox 留痕（`node.gate_rejected` / `stage.gate_rejected`，audit_logs 随 h7）。
- 写保护与留痕：归档项目（`status=archived`）的流程写操作一律 409 `PROJECT_ARCHIVED`；节点 / 阶段事件同事务写 outbox（`node.added`（还原带 `restored: true`）/ `node.completed` / `node.deleted` / `stage.advanced` / `stage.rolled_back`）。
- 权限与过渡口径（登记待收口）：① 记录级 404 语义（非成员不可见）与权限矩阵随 h6 策略服务 —— 当前流程读接口登录即可读、完成门禁无成员校验；② `GateService` 仍直接读 `files` 表（file 模块未落地）：文件计入口径 = `deleted_at is null` 且 `status ∈ (final, changed)` 且 `current_version_id is not null`，i1 落地后改为对端 index 出口；**任务侧计数已随 h4 收口** —— 阶段门禁与阶段完成度的任务计数经 task 模块 `TaskStatsService`（node → task）；③ 蓝图写权限按角色码 `admin` 判定，待 h6 矩阵换成功能权限 `admin.blueprint.manage`。
## 任务接口（h4 · S6·task：M3-01 列表 / 详情 + M3-02 进度与状态 + 项目总览四格）

- 契约 `shared/src/modules/tasks.ts`（OpenAPI tags=tasks）；实现 `src/modules/task/`（controller / service / repository / rules / query / stats + `index.ts` 出口）；`TaskController` 挂 `api/v1/projects`：`GET /projects/{id}/summary`（项目总览四格：当前阶段 / 逾期 / 已完成 / 总数）、`GET/POST /projects/{id}/tasks`、`GET/PATCH /projects/{id}/tasks/{taskId}`、`PATCH /projects/{id}/tasks/{taskId}/progress`；整组 `SessionGuard + CsrfGuard`。
- 五态派生（A1-06 / A12 / A14）：`displayStatus` 与 `onTime` 服务端读时派生、不写回存储 —— 完成按实际完成日期与预计完成日期分 已完成 / 提前完成（同日或晚于 = 已完成、逾期补完不回退）；未完成且已过预计完成日期 = 「已延期」（派生优先，人工写状态不改写）；`onTime` 可判定时按真实日期算、判不出回落迁移存储值（仍无 = null）。`filter[status]` 与同一派生口径下推 SQL（overdue / early_done 非存储态；实测 `done,active` 不误收逾期任务）。
- 状态写入联动（A12，同事务）：`PATCH …/{taskId}` 的 `status` 只收基础三态 —— done → 进度满格 + 缺省按当天补完成日期（已有保留）；active → 至少 1 格（0 → 0.25、满格 → 0.75）并清完成日期；pending → 清进度、清完成日期。「已延期 / 提前完成」提交由契约 Zod 拦为 400。
- 进度写入联动（A13）：`PATCH …/progress` 只收离散五档 0 / 0.25 / 0.5 / 0.75 / 1；`progress<1` 清完成日期（**清除完成日期的唯一方式**）、`progress=1` 缺省按当天（Asia/Shanghai，ADR-028）、显式 `actualEnd` 采用传入值；响应为 `TaskListItem` 同形（前端直接替换行）。
- 列表（A7 / A8）：分页 + `stage` / `filter[ownerId]` / `filter[status]`（展示态多值）/ `q`（中英文标题）+ 排序白名单（`plannedStart` / `plannedEnd` / `actualEnd` / `progress` / `title` / `createdAt`）；缺省顺序 = 阶段序（契约 `STAGE_KEYS`）+ 组内 `plannedStart ASC NULLS LAST` → `created_at` → `id`（稳定分页）；非法枚举 / uuid / 排序字段一律 400。`TaskListItem` 随行 `ownerName` / `changeSummary`（变更原因截 40 字；详情用 `changeRef`）/ `fileSummary`（一次分组统计免 N+1；口径 = 排除回收站，`draft` = 未定档、`final` = final + changed）。
- 创建（A10 / A1-13）：从任务节点生成（`taskNodeId`；校验节点属于本项目且与 `stageKey` 一致，**按项目判重 409 `TASK_ALREADY_EXISTS`**）成员可建；手工创建（无节点）= 非标准任务**仅管理员**（角色码 `admin`，否则 403）。缺省 `ownerId` = 项目经理、状态 pending、进度 0。
- 写保护与留痕：归档项目写操作一律 409 `PROJECT_ARCHIVED`（ADR-027）；字段级留痕写 `task_events`（status_change / progress_change / date_change / note_change，before / after 为 JSON）；业务事件同事务写 outbox（`task.created` / `task.updated` / `task.progress_changed`，dedupeKey 带版本）；任务变更 touch 项目 `updated_at`（ADR-022 ④）。
- 收口（h3 过渡口径）：`GateService` 不再直读 `tasks` 表 —— 阶段门禁 `task_not_done` 与 `GET /projects/{id}/stages` 的任务完成度经 task 模块 `TaskStatsService`（node → task；`countStageTasks` / `stageTaskCounts`）。
- 过渡口径（登记待收口）：① 记录级 404 语义与权限矩阵随 h6 —— 当前任务读 / 编辑 / 进度登录即可（成员平权），手工创建按 A1-13 限管理员；② `progress` 的 `note` 写任务的「项目进展描述」并留痕；③ 任务软删（DELETE，需 `tasks.deleted_at` 迁移）、任务侧完成门禁（M3-03 · `TASK_REQUIRED_DOC_MISSING`）、批量（M3-04）、从模板实例化与任务节点库 / 模板接口（依赖模板表，A11）、快筛参数、1 万行压测与索引调优（M3-06）为后续卡片；④ 列表默认序暂无 (project_id, stage_key, planned_start, created_at, id) 复合索引，随 M3-06。
## 字典与审计接口（h7 · S6·admin：C9 字典 + C7 审计留痕）

- 契约 `shared/src/modules/dicts.ts`（读取参数 / 维护请求，tags=dicts）与 `shared/src/modules/audits.ts`（审计读取面，tags=audit）；实现 `src/modules/admin/`（dicts.controller / audit.controller + dict.service / audit.service + repository + audit.rules + `index.ts` 出口）；`AdminModule` 导入 identity（守卫）/ permission（统一判定出口），业务模块反向 import 其 `AuditService` 注入留痕。
- 字典读（C9-01 / C9-03）：`GET /api/v1/dicts` 与 `/{type}` 登录即可读，默认只回 `enabled=true`；`includeDisabled=true`（管理端维护停用项）需 `dict.manage`（缺位 403）；未知类型 404（路径参数不做枚举硬拦，未知类型由服务层统一 404）；响应 `updatedAt` 取类型版本（条目变更 touchType）供前端缓存刷新；类型固定 region / projectType（契约 `DICT_TYPES`；阶段 / 成果文件类型走契约枚举，不下发）。
- 字典写（C9-02）：`POST /api/v1/dicts/{type}/items`（201）/ `PATCH /api/v1/dicts/{type}/items/{code}`（200）仅 `dict.manage`；同类型内码唯一（重复 409 `DICT_ITEM_EXISTS`）；「删除」= 停用（`enabled=false`，无物理删除；停用不影响存量数据按原码 / 原名渲染）；响应为更新后的整个字典（前端直接替换缓存）；每次变更写审计（无字段级变化时 `changes=null`）。种子 #5 `database/seeds/dicts.mjs`（region 8 项 / projectType 3 项，metadata 带 accent / accentText）。
- 审计写入（C7-01 / C7-02）：`AuditService.record()` 由业务用例在**同一事务**内调用（谁 / 何时 / 对什么 / 从什么改成什么；`changes` = 字段级 before / after），操作人姓名快照 60s 缓存。已接线写路径：项目创建 / 修改 / 归档（project）、名册增删（project_member）、任务创建 / 修改 / 进度（task）、节点新增 / 删除 / 完成与阶段推进 / 回退（node / stage）；阶段 / 节点门禁拒绝在 catch 内补写 `result=failed`。
- 越权留痕（C7-03）：全局异常过滤器（`common/errors/api-error.filter.ts`）在 403 与项目域 404 时经 `AUDIT_SINK` 令牌调用 `recordDenied()`（异步补写、失败只告警、不阻塞响应）；路径 → 对象解析在 `common/audit/audit-path.ts`（403 全记；404 只记写请求与项目域路径，避免普通 404 噪声；字典对象 id 与写入侧同形 `type[:code]`）；告警推送（企微）随 M5 通知模块。
- 审计检索（C7-04 服务端）：`GET /api/v1/audit-logs` 仅 `audit.view`；按 objectType + objectId（按对象）/ actorId（按人）/ action / result / projectId / from-to 时间区间筛选，occurredAt 降序（同毫秒按 id 降序）；`result=denied` 即越权尝试筛法。页面 / 导出随 u12（px 线）。
- 防篡改（C7-05）：`audit_logs` 只 INSERT / SELECT —— 库级收回 api 角色 UPDATE / DELETE（`database/roles/0001_roles.sql` 每次执行显式重放；migrator 保留全量）；保留 ≥6 个月的按月清理由运维 / 迁移器执行（未自动化）。

## 数据访问（Drizzle ↔ 迁移对齐）

- 迁移是唯一 DDL 来源（`database/migrations/`，只追加）；`src/db/schema/` 的 Drizzle 定义必须与迁移后的最终结构一致（当前 0001 ~ 0013）。
- 新增迁移的同一 PR 内同步更新 schema，并跑 `npm run check:db-schema`（比对表 / 列类型 / 可空性 / 索引 / CHECK 名称）。
- file 模块数据层（0005 / 0006）：`files` 补定档 / 回收站 / `purge_after` 列，新增 `upload_sessions`（分片直传会话，分片状态以对象存储 ListParts 为准）与 `idempotency_keys`（只存 sha256(key)；作用域 = 调用方 + 接口指纹），口径见 `database/README.md`。
- identity 数据层（0007 · h1）：`departments` / `roles` / `role_permissions` / `user_roles` 四表；角色集由 `database/seeds/roles.mjs` 种子维护（`node database/scripts/seed.mjs`），权限矩阵条目随 h6。
- project 成员数据层（0010 · h2）：`project_members`（`project_id` / `user_id` / `role_in_project` / `joined_at`；联合唯一 + `user_id` 反查索引），角色两值 `project_manager` / `project_member` 与全局角色相互独立。
- project 数据层（0009 · h2）：`projects` 增 `deleted_at` / `deleted_by` 与局部索引 `ix_projects_active_updated (updated_at desc) where deleted_at is null`；唯一约束违例经 drizzle 包装（`DrizzleQueryError`，原始驱动错误挂在 `cause`）——repository 逐层解包后按 `code=23505 + constraint` 映射业务错误码（编号重复 → 409 `PROJECT_CODE_EXISTS`）。
- 蓝图数据层（0011 · h3）：`blueprints`（`project_type` 唯一 + 草稿 `draft_payload` + `published_version` + 乐观锁 `version`）与 `blueprint_versions`（版本快照 payload + 校验 issues；`unique(blueprint_id, blueprint_version)`）—— 快照版本的唯一来源；发布时草稿同步归一为发布 payload（PG jsonb 会重排键，直比会误判「有变更」导致版本虚增）。
- 阶段跟踪（0012 · h3）：`project_stages` 增 `advanced_at` / `advanced_by` / `rolled_back_at` / `rolled_back_by` / `rollback_reason`（推进 / 回退留痕；ADR-023）。
- 字典与审计数据层（0013 · h7）：`dict_types`（类型注册表）/ `dict_items`（条目，`uq_dict_items_type_code` 同类型内码唯一 + 排序索引）/ `audit_logs`（追加写；`changes` / `metadata` jsonb + 按对象 / 操作人 / 项目 / 时间索引）；权限矩阵给 admin 补 `dict.manage` / `audit.view`（种子 #6b，admin = 契约 26 键全量）。
- 大文件走 MinIO 直传（api 只签名与元数据）属 file 模块后续卡片。

## 测试

- `npm run test`：vitest；端到端用 `@nestjs/testing` + supertest，PG 用替身（测试不依赖数据库）。
- 骨架测试：/healthz、/readyz（ok / degraded）、未知路由信封、ZodValidationPipe。
- 会话链路测试（`test/auth.e2e.test.ts`）：login 302 + PKCE 参数 → 回调建会话（用户 upsert / 只存哈希 / CSRF Cookie）→ 会话超时 / 登出 / 禁用踢线 / 开放重定向 / CsrfGuard，共 10 例（h1 新增 provider 以空替身隔离，不引数据库）。
- identity/org 测试（`test/identity-org.test.ts` · h1）：六角色数据范围用例 + 组织同步差异语义（父序 / 缺失停用 / 离职踢线 / 安全阀 / 复职），共 23 例（Push 74 时全量 39 例）。

- project 测试（`test/project-crud.test.ts` · h2）：筛选解析（多值 / 非法枚举 400 / 上海日界 / 区间反向 400）、排序白名单、行 → 契约视图映射、创建缺省阶段与撞号 409、乐观锁冲突与归档写保护、软删可见性与操作人透传、唯一违例解包，共 21 例；
- project 成员测试（`test/project-members.test.ts` · h2）：视图映射 / 列表顺序 / 添加 upsert + touch / 重复添加改角色 / 目标用户 404 / 归档写保护 / 移除与不是成员 404，共 7 例；`npm run test` 全部 87 例（h2 末）。

- 蓝图校验测试（`test/blueprint-validation.test.ts` · h3）：schema / 节点 key 唯一 / seq 递增 / docType 引用命中成果字典 / 引用未知分流 422 `BLUEPRINT_REF_UNKNOWN`，共 7 例；
- 流程门禁测试（`test/flow-gate.test.ts` · h3）：节点完成缺件明细 `missing[]`、阶段推进三类缺项（`node_not_done` / `task_not_done` / `doc_missing`）、门禁全过分支与阶段完成度派生，共 6 例；**h3 后全量 100 例（9 文件）**。
- 任务规则测试（`test/task-rules.test.ts` · h4）：五态派生（待开始 / 进行中 / 已延期 / 已完成 / 提前完成）、按时交付派生（含回落存储值）、状态写入联动、进度写入联动（清完成日期 = 唯一方式）、上海日界、列表筛选 / 排序解析（非法值 400），共 17 例；
- 门禁拒绝测试（`test/flow-gate-rejection.test.ts` · h5 · PoC-9）：服务端强校验 422 + `details[].code=required_doc`、拒绝留痕 `node.gate_rejected`（含 missing 明细与操作人）、不部分生效（未 `markNodeDone` / 未 touch）、can-complete 预检（缺件 false / 齐备 true / 已完成 false）、门禁通过对照（`node.completed`），共 5 例；**h5 后全量 135 例（12 文件）**。
- 权限矩阵测试（`test/permission-matrix.test.ts` · h6 · PoC-6）：**记录级 9 例**（六角色数据范围的可见集规格、多角色并集、主数据责任人恒可见、单项目谓词与可见 id 同源）＋**功能权限 7 例**（全局位、任务负责人、项目内项目经理 / 成员平权、非成员先 404、项目上下文外只看全局位、隐含位 ⊆ 且全在契约枚举内）＋**字段级 6 例**（联系方式三字段 / 商务字段 / 备注三级、行投影删字段不落 null、员工邮箱一期全员可见、策略表字段登记校验）＋**五出口 5 例**（四出口投影一致、导出单独授权、导出字段仍按同一策略裁剪、任一出口不含被裁字段、出口集合 = 四类 + 记录级）＋**策略服务 7 例**（projectScope all / ids、resolveProjectAccess 的 404 语义与角色位、软删、assertCan 403、画像缓存单次查库），共 34 例；**h6 后全量 169 例（13 文件）**。
- 字典与审计测试（`test/admin-audit.test.ts` · h7 · S6·admin）：**纯函数 3 例**（字段级 diff 与稳定序列化）＋**越权判定 3 例**（路径 → 对象解析、403 全记 / 404 白名单、uuid 判定）＋**DictService 5 例**（默认只发启用项 / 未知类型 404 / 同码 409 + 审计入参 / 停用替代删除的字段级留痕 / 无变更仍留痕 changes=null）＋**AuditService 4 例**（写入口径补全、越权写入吞错不抛、按对象与按人检索、人员快照缓存），共 15 例；**h7 后全量 184 例（14 文件）**。
- 任务用例测试（`test/task-service.test.ts` · h4）：带节点创建缺省项目经理 / 节点判重 409 / 手工创建仅管理员 403 / 阶段不一致 400 / 归档 409、状态联动（done 满格补当天、active 退 0.75 清日期、过期保持已延期）、乐观锁 409 / 跨项目 404、进度写回清完成日期、项目总览四格，共 13 例；**h4 后全量 130 例（11 文件）**。

## PoC-9 回放（h5 · S6·PoC-9）

- 脚本：`scripts/poc9-replay.mjs`（连真 PG + 真 api；自铸管理员会话 / 跑完撤销、建 `POC9-xxx` 回放项目 / 跑完软删、节点上补定档成果文件 / 跑完硬删）。
  - 复跑：`cd server && node scripts/poc9-replay.mjs --out ../docs/PoC-9-回放证据(蓝图round-trip与门禁拒绝).md`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据。
- 证据入库：`docs/PoC-9-回放证据(蓝图round-trip与门禁拒绝).md`（真机 14 项断言：B1~B4 round-trip 无损 + P1 / P2 快照 + G1~G7 门禁三条 + 补齐放行闭环）。
- CI 回归（不连库）：`test/flow-gate-rejection.test.ts` 5 例 —— 拒绝 422 + `missing` 明细、`node.gate_rejected` 留痕、不部分生效、预检置灰、门禁通过对照。
- 回放中发现并修正的契约漂移（h5）：`POST /api/v1/nodes/{id}/complete` 原先返回裸节点视图，与契约 `NodeCompleteResponse = { node }` 不一致 —— 已按契约包成 `{ node }`（`src/modules/project/nodes.controller.ts`）。

## PoC-6 回放（h6 · S6·PoC-6：权限矩阵与脱敏五出口）

- 脚本：`scripts/poc6-replay.mjs`（连真 PG + 真 api；铸管理员与受限账号两个临时会话、建 `POC6-xxx` 回放项目、临时把受限账号加入名册 —— 跑完硬删回放项目（含任务 / 节点 / 阶段 / outbox 事件）与两个会话）。
  - 复跑：`cd server && node scripts/poc6-replay.mjs --out ../docs/PoC-6-回放证据(权限矩阵与脱敏五出口).md`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据、`--actor <userId>` 指定受限账号。
- 证据入库：`docs/PoC-6-回放证据(权限矩阵与脱敏五出口).md`（真机 24 项断言：记录级列表 / 详情 / 子资源统一 404 + 名册即刻可见 + 可见但无权限位 403 + 成员平权 200 + 出口键位数据面 + 收尾零残留）。
- 矩阵门禁（不连库，随 `npm test` 与 CI 常跑）：`check:permission-matrix`（种子 #6b ↔ 契约枚举 ↔ 角色集三方对齐）+ `test/permission-matrix.test.ts` 34 例（五类出口的策略层用例）。
- 差异与后续：搜索 / 通知模块（lan 线）尚未落地、投影入口已就绪；字段级真实出口随 j6 干系人；导出 / 搜索 / 通知出口的调用方接线随 i 系列与 M7 —— 明细见 `src/modules/permission/README.md` 差异 1~5。

## PoC-7 回放（h7 · S6·admin：字典 C9 与审计留痕 C7）

- 脚本：`scripts/poc7-replay.mjs`（连真 PG + 真 api；铸管理员与受限账号两个临时会话、建 `POC7-xxx` 字典条目 —— 跑完硬删字典条目与本次审计行（api 角色无权删审计，用 migrator 连接）与两个会话）。
  - 复跑：`cd server && node scripts/poc7-replay.mjs --out ../docs/PoC-7-回放证据(字典C9与审计留痕C7).md`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据、`--actor <userId>` 指定受限账号。
- 证据入库：`docs/PoC-7-回放证据(字典C9与审计留痕C7).md`（真机 23 项断言：默认只下发启用项 + 管理口径 403 + 新增 / 停用 200 且同码 409 + 未知类型 404 无噪声 + 审计按对象 / 按人命中 + 越权 403 落 denied 行 + 收尾零残留）。
- 门禁（不连库，随 `npm test` 与 CI 常跑）：`test/admin-audit.test.ts` 15 例 + `check:db-schema`（24 表 / 246 列 / 69 索引 / 64 CHECK）+ `check:permission-matrix`（6 角色 / 73 条目 / 26 键）。
- 回放中发现并修正的契约漂移（h7）：`GET /api/v1/dicts/{type}` 原先用枚举管道硬拦路径参数（未知类型 → 400），与契约「未知类型返回 404」不符 —— 已改为普通路径段校验、未知类型由服务层统一 404（`src/modules/admin/dicts.controller.ts`）；`POST /api/v1/dicts/{type}/items` 的契约响应码 200 → 201（与实际行为一致）。

## CI 接线（g5 · px｜已落地）

`.github/` 归 px 线；下方 job 片段已按 g5 落入 `.github/workflows/ci.yml` 的 `server` job（另补 `npm run build` 一步，保证部署产物可构建）：

```yaml
  server:
    name: server
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: |
            shared/package-lock.json
            server/package-lock.json
      - name: Install shared (locked)
        working-directory: shared
        run: npm ci
      - name: Build shared
        working-directory: shared
        run: npm run build
      - name: Install (locked)
        working-directory: server
        run: npm ci
      - name: Typecheck
        working-directory: server
        run: npm run typecheck
      - name: Tests
        working-directory: server
        run: npm run test
      - name: Boundary rules
        working-directory: server
        run: npm run check:boundaries
```

数据库门禁 job（**已落地**，Push 48）：`.github/workflows/ci.yml` 的 `database` job 起 `postgres:18` service → 跑 `database` 迁移（0001~）→ `npm run check:db-schema`，一次覆盖「空库迁移」与「Drizzle 漂移」两条红线。

## 后续卡片衔接

- g6：`/auth/*` 会话后端化（identity 模块首个实现）——已落地（Push 43）；前端切换 k6 已合入（Push 46），正式环境 SSO 核对（g7）仍在 px 线。
- g5：CI 扩展（上方片段 + 契约漂移）——已落地（Push 41：`server` job 入 `.github/workflows/ci.yml`）。
- h3：流程节点（蓝图版本化 / 建项目快照 / 阶段推进与回退 / 节点增删 / 完成门禁）—— 已落地（Push 83）；记录级 404 与权限矩阵随 h6，文件门禁口径随 i1（file）与 h4（task）。
- h4：task 模块（任务列表 / 详情 / 创建 / 编辑 / 进度 / 项目总览四格 / 五态与按时交付派生）—— 已落地（Push 89）；任务侧完成门禁（M3-03）、批量（M3-04）、从模板实例化与快筛、1 万行压测（M3-06）为后续卡片，记录级 404 与权限矩阵随 h6。
- h5：PoC-9 回放（蓝图 round-trip 与门禁拒绝的证据入库：回放脚本 + `docs/` 证据 + CI 回归测试）—— 已落地（Push 93）；任务侧完成门禁（M3-03）仍为后续卡片。
- h6：权限矩阵与脱敏五出口（ADR-011 策略层落地：记录级可见集 / 功能权限 / 字段级策略 / 五出口投影 + ProjectAccessGuard + `GET /api/v1/permissions/me` + 种子 #6b + 真机回放）—— 已落地（Push 95）；剩余：临时授权（C3-06）、权限管理界面与权限自检报告（C3-09 · u12）、越权尝试留痕告警（h7）、干系人字段级真实出口（j6）、搜索 / 通知模块本身（lan 线）。
- h7：字典 C9 与审计留痕 C7（`dict_types` / `dict_items` / `audit_logs` + 字典读写出口 + 审计写入 / 越权留痕 / 检索 + 种子 #5 + 真机回放）—— 已落地（Push 97）；剩余：前端改读字典（u12 · px 线）、审计页面与导出（u12）、告警推送（M5 通知）、蓝图字段级留痕（随蓝图维护卡片）、按月清理（运维）。
- lan 线：file / preview / notify / outbox 调度 / search / dashboard。
- 非目标（v0.2 §1.4）：Redis / MQ / K8s / 在线编辑 / 移动端 / 甘特图。
