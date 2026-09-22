# server/ · 后端工程（g4 骨架 · g6 会话后端化 · h1 identity/org · h2 project · h3 流程节点 · h4 task · h5 PoC-9 · h6 权限矩阵 · h7 字典与审计 · h8 工作日历 · w2 任务落库口径 · 存储接入 · M4-01 上传管道 · M4-02 版本与回收站 · M4-03 文件库查询与多态关联 · j6 干系人台账（A5-01 ~ A5-04 / A5-07））

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
    common/               # errors / http（校验管道）/ audit（越权留痕路径解析与 sink 令牌 · h7）/ clock（ClockService · h8）/ logging
    config/               # 环境变量契约（Zod）与全局配置模块
    db/                   # PG 连接 + Drizzle schema（对齐 database/migrations）
    storage/              # 对象存储接入：S3 协议端口 + 适配器（ADR-006；见 src/storage/README.md）
    health/               # 垂直样例：controller -> service -> repository
    modules/identity/     # 首个真实实现：/auth/* 会话链路（g6）
    modules/permission/   # 权限策略层（h6 · PoC-6）：记录级 / 功能权限 / 字段级 / 五出口投影
    modules/admin/        # 字典 C9 与审计留痕 C7（h7）：类型 / 条目维护 + 审计写入与检索（其余模块仍为 README 占位）
    modules/calendar/     # 工作日历 D5（h8 · 横切）：例外维护 / 顺延规则 / T-1·T+1 实时求值
    modules/file/         # 文件与版本（S7·file · M4-01 上传管道 + M4-02 版本 / 定档 / 回溯 / 回收站 + M4-03 文件库查询与多态关联）：发起上传 / 分片预签名 / 断点续传 / 完成落版本（写 file_links）/ 取消 / 详情 / 版本链 / 定档 / 回溯 / 回收 / 恢复 / 彻底删除 / 项目文件库列表（筛选 / 关键字 / 排序 / 分页 / 双向跳转）（变更按 M4-04 接入）
    modules/stakeholder/  # 干系人台账（S8·stakeholder · j6）：台账 CRUD + 项目关联与反查 + 字段级脱敏（导入随 M8-01、导出随 M7-03；见 src/modules/stakeholder/README.md）
  scripts/check-boundaries.mjs   # 依赖方向规则检查
  scripts/check-db-schema.mjs    # Drizzle schema 与实际库漂移检查
  scripts/check-permission-matrix.mjs  # 权限矩阵自检（种子 #6b ↔ 契约枚举 ↔ 角色集，不连库）
  scripts/m4-upload-replay.mjs   # M4-01 上传管道真机回放（真 PG + 真对象存储 + 真 api；断言全过退出码 0）
  scripts/m4-library-replay.mjs  # M4-03 多态关联与文件库查询真机回放（同上口径；断言全过退出码 0）
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
| `npm run check:db-schema` | Drizzle schema ↔ 实际库（需先 build；当前 29 表 / 284 列 / 87 索引 / 85 CHECK） |
| `npm run storage:init` | 对象存储初始化（建桶 / 版本控制 / CORS / 分片清理；`-- --check` 只读校验） |
| `npm run storage:it` | 对象存储真机回放（需真实对象存储 + 先 `npm run build`） |
| `node dist/entry/worker.js --health-check` | worker 一次性健康检查 |

## 本地运行

前置：Node 24、PostgreSQL 18（库结构由 `database/` 迁移器维护）、`shared/` 已构建。

1. `cd shared && npm ci && npm run build`（server 依赖 `@libiaolink/contracts` 的 `dist/` 产物）
2. `cd server && npm ci`
3. `cp .env.example .env`，按需改 `DATABASE_URL`（应用角色 `libiaolink_api`，无 DDL 权限）；`/auth/*` 另需 `CASDOOR_*`（本地沙箱见 `deploy/casdoor/`，真实值不落仓库）；文件能力另需 `S3_*`（本地沙箱见 `deploy/minio/`，然后 `npm run storage:init`）
4. `npm run build && npm run start:api`，然后 `curl http://127.0.0.1:3000/healthz`、`/readyz`

数据库迁移不在 server 内执行：`database/scripts/migrate.mjs`（见 `database/README.md`）。

## 进程边界

- api：HTTP、业务事务、Outbox 写入、SSE；无状态、不跑 CPU 密集任务。
- worker：Outbox 投递 / 调度 / 规则 / 转换编排 / 导出；骨架阶段只起进程与心跳（60s），`--health-check` 供探针使用。
- converter（沙箱）：一期由 file / preview（lan 线）落地，不在本骨架内。

## 模块结构约定

- 四层：controller（HTTP）/ service（用例）/ repository（数据访问）/ events（同事务写 Outbox），对外只经 `index.ts`。
- 15 个模块目录已占位（每个 README 标注类型 / 职责 / 主责 / 预留接口），代码随各自实现卡片落地；identity / project / blueprint / node / task / permission / admin / calendar / stakeholder 已落地，其余仍为占位 README。
- DTO 一律用 `@libiaolink/contracts` 的 Zod schema（配 `ZodValidationPipe`），禁止另起一套类型。

| 类型 | 模块 | 主责 |
|---|---|---|
| 领域（domain） | identity、project、blueprint、node、task、report-issue、stakeholder | wmj |
| 领域（domain · 横切） | permission（权限策略层 · h6）、calendar（工作日历 · h8） | wmj |
| 平台（platform） | file、notify、search、dashboard | lan |
| 平台（platform） | automation、admin（字典 / 审计 · h7 落地） | wmj |

## 依赖方向规则（npm run check:boundaries）

1. 跨模块只允许 `import` 对端 `index.ts`；
2. 平台模块不得反依赖领域模块（例外：`file → project` 仅限项目快照出口，即 `modules/project/index.ts`）；
3. `common/`、`db/`、`config/`、`storage/` 不得依赖 `modules/`；
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
- `GET /readyz`：就绪；探测 PG 连通 + 核心表可达（projects / outbox_events）+ 对象存储桶可达（`object-storage:head-bucket`，数据库通不等于文件可用）；失败 503 `{status:"degraded",checks:[...]}`。
- readyz 不校验迁移版本：应用角色 `libiaolink_api` 无权读 `schema_migrations`（最小权限，见 `database/README.md`）；迁移是否最新用 `node database/scripts/migrate.mjs --dry-run`。
- 两个端点都在 `/api/v1` 之外（基础设施端点，不走业务契约）。

## 对象存储接入（S3 协议 · ADR-006）

- 端口 `src/storage/object-storage.ts`（`ObjectStorage` 抽象类 + `StorageError` + `toApiError`）→ 实现 `s3-object-storage.ts`（唯一处配置协议细节）→ 装配 `storage.module.ts`（`@Global`，api 侧注入）；细节见 `src/storage/README.md`。
- **只依赖 S3 协议**：换实现（内网 MinIO / SeaweedFS / 云 OSS）只改 `createS3Client` 的 endpoint 与凭据，调用方代码不动（ADR-006「实现可替换」）。
- **本层不得依赖 `modules/`**：`storage/` 与 `common` / `db` / `config` 同级，已纳入 `check:boundaries` 规则 3。
- 对象键 `projects/{projectId}/files/{fileId}/v{seq}/{contentHash}.{ext}`：版本与哈希进键（定档不覆盖物理对象），原文件名（含中文）只进元数据，片段严格校验防路径穿越。
- 分片计划 `part-plan.ts`：非末片 ≥ 5 MiB、单片 ≤ 5 GiB、总片数 ≤ 10000（客户端不传 `partSizeBytes`，由服务端算并随 `UploadCreateResponse` 返回）。**分片状态以对象存储 ListParts 为唯一真相，不落 `upload_parts` 表**。
- **键形态（ADR-006 定案 · 2026-09-21）**：会话先按暂存键 `…/staging/{sessionId}` 直传，complete 时校验内容哈希 + `copyObject` 复制到契约键，落库 `file_versions.object_key` 始终是契约形态；单次复制上限 5 GiB 由 `UPLOAD_MAX_SIZE_MB`（默认 2048，启动校验 ≤ 5120）保证。
- **彻底删除必须按版本删**：桶开启版本控制后，不带 `versionId` 的 `DeleteObject` 只写 delete marker、数据版本永不回收（lifecycle 已不作为清理手段）→ 端口提供 `purgeObject`（列版本 + 批量按版本删），暂存清理与 M4-02 回收站都走它。
- 错误映射：`NoSuchUpload` → 410 `UPLOAD_SESSION_EXPIRED`；`InvalidPart` / `InvalidPartOrder` / `EntityTooSmall` / `EntityTooLarge` → 409 `UPLOAD_INCOMPLETE`；对象缺失 → 404；源对象超过单次复制上限（5 GiB）→ 500 `INTERNAL`；其余 → 500 `INTERNAL`。
- 预签名：分片直传与下载均为短时签名（`S3_PART_URL_TTL_SECONDS` 默认 900 / `S3_DOWNLOAD_URL_TTL_SECONDS` 默认 300）；中文文件名下载头走 RFC 5987。
- 环境变量：`S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`（生产必填，启动即校验）/ `S3_BUCKET` / `S3_FORCE_PATH_STYLE`（auto = 非 AWS 端点走 path-style）/ 两个 TTL / `UPLOAD_MAX_SIZE_MB`。
- 真机回放（`npm run storage:it`，沙箱见 `deploy/minio/`）：**24 项断言全过** —— 上传上限不变式 → 建会话（暂存键）→ 3 片预签名直传（8 / 8 / 4 MiB）→ ListParts 一致 → 乱序合并 → HEAD 大小校验 → **复制到契约键** → 签名下载 → SHA-256 哈希比对 → 匿名 GET 403 → **普通删除只留 delete marker、`purgeObject` 回收版本** → 中止幂等且会话即失效（映射 410）。跑后按版本清理回放对象。
- 实现选型（ADR-006 阶段 0 修订 · [PR #96](https://github.com/256-code/LibiaoLink/pull/96) / Push 126）：接口层不变（S3 协议抽象继续有效）；一期实现改为**可替换绑定** —— 沙箱继续用 pinned 的 `RELEASE.2025-09-07T16-13-09Z`（**仅沙箱，不代表生产选型**），生产按候选顺序 ① 公司内网既有对象存储 / MinIO 集群 → ② SeaweedFS 等自建 S3 兼容 → ③ 云 OSS；关闭责任 px + lan，时点 = M8 生产部署形态验证前，验收 = `storage:init -- --check` + `storage:it` 在目标实现上全绿。实测的两条能力缺口（CORS 只能服务端配置、lifecycle 被拒）登记为「任何替代实现都必须满足的行为面」；证据见 `deploy/minio/README.md`。

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
- `GET /api/v1/projects`：分页 + 多维筛选（`filter[region|projectType|managerId|stageKey|status]` 多值英文逗号分隔；`managerId` 命中口径 = 项目挂的任意一位经理，A22 · Push 136）+ 关键字 `q`（编号 / 名称 / 客户 / 序号）+ 时间闭区间（`filter[timeFrom]` / `filter[timeTo]`，Asia/Shanghai 日界，映射 `updated_at`）+ 排序白名单（`updatedAt` / `createdAt` / `seqNo`，缺省 `updatedAt:desc`）；非法枚举 / 非法 uuid / 区间反向一律 400（不返回静默空列表）。
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
- 节点增删（ADR-020）：`POST /projects/{id}/nodes`（仅项目经理：`admin` 角色 / `projects.manager_ids` 任一位 / 名册 `role_in_project=project_manager` 三选一，否则 403；`nodeKey` 必须命中**项目导入版本**的模板节点池，否则 422 `BLUEPRINT_REF_UNKNOWN`；`node_key` 在项目内唯一（DB 唯一索引 `project_nodes_project_id_node_key_key`）—— 已有未删节点 409 `NODE_ALREADY_EXISTS`，软删后再增补 = 还原同一行（回 `pending`、清完成留痕）；`seq` 缺省 = 同阶段 max + 10）、`DELETE /projects/{id}/nodes/{nodeId}`（原因必填、软删、乐观锁；节点下有成果文件 409 `NODE_HAS_FILES`）。
- 完成门禁（v0.2 §3.6）：`POST /api/v1/nodes/{id}/complete`（**成员平权**，服务端事务内强校验；缺 `required_doc` → 422 `NODE_REQUIRED_DOC_MISSING` + `missing[]` 明细；重复完成 409 `NODE_ALREADY_DONE`；响应按契约 `NodeCompleteResponse`（{ node }））、`GET /api/v1/nodes/{id}/can-complete`（预检，只是 UI 置灰依据）。门禁拒绝写 outbox 留痕（`node.gate_rejected` / `stage.gate_rejected`，audit_logs 随 h7）。
- 写保护与留痕：归档项目（`status=archived`）的流程写操作一律 409 `PROJECT_ARCHIVED`；节点 / 阶段事件同事务写 outbox（`node.added`（还原带 `restored: true`）/ `node.completed` / `node.deleted` / `stage.advanced` / `stage.rolled_back`）。
- 权限与过渡口径（登记待收口）：① 记录级 404 语义（非成员不可见）与权限矩阵随 h6 策略服务 —— 当前流程读接口登录即可读、完成门禁无成员校验；② `GateService` 仍直接读 `files` 表（file 模块未落地）：文件计入口径 = `deleted_at is null` 且 `status ∈ (final, changed)` 且 `current_version_id is not null`，i1 落地后改为对端 index 出口；**任务侧计数已随 h4 收口** —— 阶段门禁与阶段完成度的任务计数经 task 模块 `TaskStatsService`（node → task）；③ 蓝图写权限按角色码 `admin` 判定，待 h6 矩阵换成功能权限 `admin.blueprint.manage`。
## 任务接口（h4 · S6·task：M3-01 列表 / 详情 + M3-02 进度与状态 + M3-03 完成门禁 + 项目总览四格）

- 契约 `shared/src/modules/tasks.ts`（OpenAPI tags=tasks）；实现 `src/modules/task/`（controller / service / repository / rules / query / stats + `index.ts` 出口）；`TaskController` 挂 `api/v1/projects`：`GET /projects/{id}/summary`（项目总览四格：当前阶段 / 逾期 / 已完成 / 总数）、`GET/POST /projects/{id}/tasks`、`GET/PATCH /projects/{id}/tasks/{taskId}`、`PATCH /projects/{id}/tasks/{taskId}/progress`、`GET /projects/{id}/tasks/{taskId}/can-complete`、`POST /projects/{id}/tasks/{taskId}/complete`（M3-03 · Push 143）；整组 `SessionGuard + CsrfGuard`。
- 五态派生（A1-06 / A12 / A14）：`displayStatus` 与 `onTime` 服务端读时派生、不写回存储 —— 完成按实际完成日期与预计完成日期分 已完成 / 提前完成（同日或晚于 = 已完成、逾期补完不回退）；未完成且已过预计完成日期 = 「已延期」（派生优先，人工写状态不改写）；`onTime` 可判定时按真实日期算、判不出回落迁移存储值（仍无 = null）。`filter[status]` 与同一派生口径下推 SQL（overdue / early_done 非存储态；实测 `done,active` 不误收逾期任务）。
- 状态写入联动（A12，同事务）：`PATCH …/{taskId}` 的 `status` 只收基础三态 —— done → 进度满格 + 缺省按当天补完成日期（已有保留）；active → 至少 1 格（0 → 0.25、满格 → 0.75）并清完成日期；pending → 清进度、清完成日期。「已延期 / 提前完成」提交由契约 Zod 拦为 400。
- 进度写入联动（A13）：`PATCH …/progress` 只收离散五档 0 / 0.25 / 0.5 / 0.75 / 1；`progress<1` 清完成日期（**清除完成日期的唯一方式**）、`progress=1` 缺省按当天（Asia/Shanghai，ADR-028）、显式 `actualEnd` 采用传入值；响应为 `TaskListItem` 同形（前端直接替换行）。
- 列表（A7 / A8）：分页 + `stage` / `filter[ownerId]`（任一位负责人命中即命中，A23 · Push 136）/ `filter[status]`（展示态多值）/ `q`（中英文标题）+ 排序白名单（`plannedStart` / `plannedEnd` / `actualEnd` / `progress` / `title` / `createdAt`）；缺省顺序 = 阶段序（契约 `STAGE_KEYS`）+ 组内位次 `sort_index` → `id`（A15 / A19 / A20 · Push 124：与看板列内顺序同口径，未分组落最后）；非法枚举 / uuid / 排序字段一律 400。`TaskListItem` 随行 `ownerNames` / `changeSummary`（变更原因截 40 字；详情用 `changeRef`）/ `fileSummary`（一次分组统计免 N+1；口径 = 排除回收站，`draft` = 未定档、`final` = final + changed）。
- 创建（A10 / A1-13）：从任务节点生成（`taskNodeId`；校验节点属于本项目且与 `stageKey` 一致，**按项目判重 409 `TASK_ALREADY_EXISTS`**）成员可建；手工创建（无节点）= 非标准任务**仅管理员**（角色码 `admin`，否则 403）。缺省 `ownerIds` = 项目全部项目经理（A23 · Push 136）、状态 pending、进度 0；**显式 `ownerIds: []` = 「待分配」**（A18 · Push 124），`stageKey` 缺省 / 显式 null = 「未分组」（A15；带 `taskNodeId` 时缺省取节点所属阶段，显式不一致 400），`sortIndex` = 插入位次（A20；越界 / 缺省 = 组尾，同组顺延）。
- 写保护与留痕：归档项目写操作一律 409 `PROJECT_ARCHIVED`（ADR-027）；字段级留痕写 `task_events`（status_change / progress_change / date_change / note_change，before / after 为 JSON）；业务事件同事务写 outbox（`task.created` / `task.updated` / `task.progress_changed`，dedupeKey 带版本）；任务变更 touch 项目 `updated_at`（ADR-022 ④）；`ownerIds` / `sortIndex` 变更进审计快照（diff `from` / `to`，C7-02 字段级留痕）。
- 完成门禁（M3-03 · Push 143 / A4-20 / ADR-024）：`GET …/can-complete` 预检（`canComplete` + `missing[]` + `warnings[]`，UI 置灰依据）+ `POST …/complete` 提交（`{ task, warnings }`）。**三入口同一判定** —— 完成提交与 `PATCH …/{taskId}`（`status=done`）、`PATCH …/progress`（`progress=1`）在事务内走同一门禁：有节点任务按所属节点 `node_requirements` 逐类统计，无节点任务按自身 `deliverable_types` 兜底（每类 ≥ 1 份）；定档口径 = `status ∈ (final, changed)` 且 `current_version_id` 非空。缺件 422 `TASK_REQUIRED_DOC_MISSING`（`details[].code=required_doc` + `missing[]`）且不部分生效，拒绝写 outbox `task.gate_rejected`（事务外补写）+ 审计 `result=failed`；存在 draft 成果文件 → 放行 + `warnings[]`（`draft_doc_present`）+ outbox `task.draft_doc_reminded`（R02 触发点）；重复完成 409 `TASK_ALREADY_DONE`。`deliverableTypes` 多值随迁移 `0018_task_deliverable_types.sql` 落地（单值转单元素数组 + GIN 索引 + 双 CHECK；创建缺省从节点 `required_doc` 带出、`TaskUpdateBody` 不含该字段 = 生成后锁定，A1-17）。门禁判定实现在 task 模块 `task.gate.repository.ts`（node → task 依赖在、反向会成环；与 `GateService.evaluateNode` 同 SQL 口径，两处必须同步）。
- 收口（h3 过渡口径）：`GateService` 不再直读 `tasks` 表 —— 阶段门禁 `task_not_done` 与 `GET /projects/{id}/stages` 的任务完成度经 task 模块 `TaskStatsService`（node → task；`countStageTasks` / `stageTaskCounts`）；阶段完成度只统计带阶段任务，未分组（`stage_key` 为空）不计入（A15 · Push 124）。
- 落库口径（A15 / A18 / A19 / A20 · Push 124）：迁移 `0015_task_order_and_nullable_scope.sql` 给 `tasks` 加 `sort_index`（组内 0 起、密集，回填按迁移前默认读序）、`stage_key` 放宽可空；迁移 `0017_multi_manager_and_owner.sql` 把 `tasks.owner_id` 改为 `owner_ids` uuid[]（空数组 = 待分配，回填 `array[owner_id]` / 空数组）；一组 = 同一项目 + 同一阶段（null = 未分组，自成一组）；编辑的 `sortIndex` = 移到组内第 N 位（越界 = 组尾），同组顺延只写位次列、不逐个 bump `version`，并发靠组行锁（`select … for update`）；契约 `Task` / `TaskCreateBody` / `TaskUpdateBody` 同步。
- 过渡口径（登记待收口）：① 记录级 404 语义与权限矩阵随 h6 —— 当前任务读 / 编辑 / 进度登录即可（成员平权），手工创建按 A1-13 限管理员；② `progress` 的 `note` 写任务的「项目进展描述」并留痕；③ 任务软删（DELETE，需 `tasks.deleted_at` 迁移）、任务侧完成门禁（M3-03 · `TASK_REQUIRED_DOC_MISSING`）、批量（M3-04）、从模板实例化与任务节点库 / 模板接口（依赖模板表，A11）、快筛参数、1 万行压测与索引调优（M3-06）为后续卡片；④ 列表默认序已有 `ix_tasks_project_stage_order (project_id, stage_key, sort_index)` 复合索引（0015 · Push 124），1 万行压测与索引调优仍随 M3-06。
## 字典与审计接口（h7 · S6·admin：C9 字典 + C7 审计留痕）

- 契约 `shared/src/modules/dicts.ts`（读取参数 / 维护请求，tags=dicts）与 `shared/src/modules/audits.ts`（审计读取面，tags=audit）；实现 `src/modules/admin/`（dicts.controller / audit.controller + dict.service / audit.service + repository + audit.rules + `index.ts` 出口）；`AdminModule` 导入 identity（守卫）/ permission（统一判定出口），业务模块反向 import 其 `AuditService` 注入留痕。
- 字典读（C9-01 / C9-03）：`GET /api/v1/dicts` 与 `/{type}` 登录即可读，默认只回 `enabled=true`；`includeDisabled=true`（管理端维护停用项）需 `dict.manage`（缺位 403）；未知类型 404（路径参数不做枚举硬拦，未知类型由服务层统一 404）；响应 `updatedAt` 取类型版本（条目变更 touchType）供前端缓存刷新；类型固定 region / projectType（契约 `DICT_TYPES`；阶段 / 成果文件类型走契约枚举，不下发）。
- 字典写（C9-02）：`POST /api/v1/dicts/{type}/items`（201）/ `PATCH /api/v1/dicts/{type}/items/{code}`（200）仅 `dict.manage`；同类型内码唯一（重复 409 `DICT_ITEM_EXISTS`）；「删除」= 停用（`enabled=false`，无物理删除；停用不影响存量数据按原码 / 原名渲染）；响应为更新后的整个字典（前端直接替换缓存）；每次变更写审计（无字段级变化时 `changes=null`）。种子 #5 `database/seeds/dicts.mjs`（region 8 项 / projectType 3 项，metadata 带 accent / accentText）。
- 审计写入（C7-01 / C7-02）：`AuditService.record()` 由业务用例在**同一事务**内调用（谁 / 何时 / 对什么 / 从什么改成什么；`changes` = 字段级 before / after），操作人姓名快照 60s 缓存。已接线写路径：项目创建 / 修改 / 归档（project）、名册增删（project_member）、任务创建 / 修改 / 进度（task）、节点新增 / 删除 / 完成与阶段推进 / 回退（node / stage）；阶段 / 节点门禁拒绝在 catch 内补写 `result=failed`。
- 越权留痕（C7-03）：全局异常过滤器（`common/errors/api-error.filter.ts`）在 403 与项目域 404 时经 `AUDIT_SINK` 令牌调用 `recordDenied()`（异步补写、失败只告警、不阻塞响应）；路径 → 对象解析在 `common/audit/audit-path.ts`（403 全记；404 只记写请求与项目域路径，避免普通 404 噪声；字典对象 id 与写入侧同形 `type[:code]`）；告警推送（企微）随 M5 通知模块。
- 审计检索（C7-04 服务端）：`GET /api/v1/audit-logs` 仅 `audit.view`；按 objectType + objectId（按对象）/ actorId（按人）/ action / result / projectId / from-to 时间区间筛选，occurredAt 降序（同毫秒按 id 降序）；`result=denied` 即越权尝试筛法。页面 / 导出随 u12（px 线）。
- 防篡改（C7-05）：`audit_logs` 只 INSERT / SELECT —— 库级收回 api 角色 UPDATE / DELETE（`database/roles/0001_roles.sql` 每次执行显式重放；migrator 保留全量）；保留 ≥6 个月的按月清理由运维 / 迁移器执行（未自动化）。

## 工作日历接口（h8 · S6·工作日历：D5-01 日历维护 / D5-02 顺延规则 / D5-03 T-1·T+1）

- 契约 `shared/src/modules/calendar.ts`（tags=calendar；`calendarDayParams` 路径参数）：读取面 = 某年日历 / 单日判定 / 顺延配置 / 顺延与 T-N·T+N 求值（登录即可）；维护面 = 例外 upsert / 删除 + 顺延规则更新（仅 `calendar.manage`）。实现 `src/modules/calendar/`（controller / service / repository / rules + `index.ts` 出口）；横切模块（`check-boundaries` 的 CROSSCUT_MODULES）—— 领域与平台都可经其 `index.ts` 复用日期求值（i8 规则引擎 / 任务提醒 / 应填未填清单）。
- 单日判定（D5-01 读）：`GET /api/v1/calendar/day`（`date` 缺省今天，Asia/Shanghai）—— 例外优先（`source=calendar`）、否则默认规则（`source=default`，周一至周五工作日 / 周六周日非工作日）；`kind` 四态 workday / weekend / holiday / makeup_workday；调休上班视为工作日。
- 年历与维护（D5-01）：`GET /api/v1/calendar/days?year=`（例外清单 + 顺延配置）；`PUT /api/v1/calendar/days/{date}`（幂等 upsert：name / note 缺省保持原值；响应 = 更新后的整年日历）与 `DELETE …/{date}`（回落默认规则；无该例外 404）；写仅 `calendar.manage`，每次变更在同一事务写审计（objectType = calendar_day，字段级 before / after）。
- 顺延规则（D5-02）：`GET` / `PUT /api/v1/calendar/settings` —— 是否顺延 + 方向（forward 顺延到之后最近工作日 / backward 提前到之前最近工作日）；PUT 为部分更新、仅 `calendar.manage`、写审计（objectType = calendar_settings，objectId = default）。
- 顺延求值：`GET /api/v1/calendar/shift?date=&direction=` —— 移动到最近工作日（已是工作日原样返回 `shifted=false`）；`skipped[]` 逐条返回中途跳过的日期；`direction` 缺省取配置。
- T-N / T+N 求值（D5-03）：`GET /api/v1/calendar/offset?date=&days=&time=&shift=` —— 自然日偏移 → 顺延开关（`inherit` 按配置 / `on` / `off` 供规则引擎回放强制覆盖）→ 顺延 → 可选时刻叠加（`at` = 业务日 + HH:mm 按 Asia/Shanghai 转 UTC，如 R03「前 1 天 08:00」）；**实时求值、不缓存、不落库**（改期后按新日期重算）。窗口一次加载基准日 ± 370 天，窗口外 ≠ 非工作日（`exhausted` 防御）。
- 时钟（v0.3 §4.7）：新增 `src/common/clock/clock.service.ts`（now / today / setSource）—— 求值基准一律经 ClockService（缺省今天），规则 / 调度禁止直接取系统时间（回放与金标测试可注入固定时刻）。
- 权限：`calendar.manage` 入契约（现 27 键）；种子 #6b 给 admin 补该键（admin 27 键 = 契约全量，其余角色不含）。

## 文件上传接口（S7·file · M4-01：上传管道）

- 契约 `shared/src/modules/files.ts`（tags=files）：`POST /api/v1/files/uploads`（发起，201）、`POST /api/v1/files/{id}/uploads/{uploadId}/parts`（取分片预签名 URL，200）、`GET /api/v1/files/{id}/uploads/{uploadId}`（会话状态，200）、`POST …/complete`（完成，200）、`POST …/abort`（取消，200）。实现 `src/modules/file/`（controller / service / repository + `index.ts` 出口），装配进 api（`app.module.ts`）与 worker（`worker.module.ts`：过期清理）。
- 发起上传（`intent=version` 且不带 `fileId` —— 本切片唯一开放路径）：建 `files` 行（status=draft、version=0）+ 上传会话（先写**暂存键** `…/staging/{sessionId}`，ADR-006），返回分片计划（`partSizeBytes` / `totalParts`，服务端算）、`expiresAt`（`UPLOAD_SESSION_TTL_HOURS`，默认 24h）与 `duplicateHint`（带 `contentHash` 且命中同项目既有内容时回提示，A4-04，不强阻断）。
- **上传入口 `fileId`（Push 130 定案 · wmj｜M4-02 放开 version 路径）**：`intent=version` 省略 `fileId` = 新建文件；**给出 `fileId` = 对既有 draft 文件替换 / 追加版本（M4-02 已放开）** —— 目标不存在 / 不可见 404、与 `projectId` 不一致 400（`invalid_file`）、`name` / `docType` / `nodeId` / `taskId` 与目标现状不一致 400（`name_mismatch` / `doc_type_mismatch` / `node_mismatch` / `task_mismatch`，生效字段一律以目标文件为准）、目标非 draft 409 `FILE_STATE_INVALID`、`duplicateHint` 恒空；`intent=change` **必填** `fileId`（目标须 final / changed，A4-13）—— **仍为切片守卫：显式 400 `VALIDATION_FAILED`（details `intent_change_not_open`），随 M4-04 变更流放开**；zod 放行后无显式守卫会把「追加版本 / 变更」静默当新建文件。
- 分片直传 / 断点续传：`parts` 批量签名（首次调用登记存储侧 `storage_upload_id`，行锁防并发双建；分片号越界 400）；`GET` 会话状态回 `uploadedPartNumbers` / `missingPartNumbers`（**以对象存储 ListParts 为唯一真相**，不落 `upload_parts` 表），续传只补缺失片。
- 完成（`complete`）：ListParts 校验齐全（缺片 409 `UPLOAD_INCOMPLETE` + `details.missing`）→ 合并（按编号升序）→ HEAD 校大小（与声明不符 409 `size_mismatch`，不信客户端声明）→ `contentHash` 一致性（与 init 声明不符 422 `FILE_HASH_MISMATCH`；init 未给则以 complete 为准）→ `copyObject` 到契约键 `…/v{seq}/{contentHash}.{ext}` → 事务内锁会话 + 锁文件 + 复核位次 → 写 `file_versions` + 更新 `files.current_version_id` / `version` + 会话 completed + 审计 + outbox `file.version.created` → 按版本清暂存（失败只告警，过期清理兜底）。位次被并发完成抢占 → 500 `INTERNAL`（不写半份版本）。
- 取消（`abort`）：中止分片 + 清暂存 + 置 aborted + 审计；**幂等**（重复取消回 200，已结束会话不再动存储），已完成会话 409 `FILE_STATE_INVALID`（回退走 M4-02 版本回溯）。
- 过期：访问时惰性判定（分片 / 完成路径 410 `UPLOAD_SESSION_EXPIRED`；会话状态读 409 `FILE_STATE_INVALID`）+ worker 定时清理（`entry/worker.ts`：启动即跑一轮，之后每 10 分钟一批 ≤ 200 条 —— 中止分片 + 按版本清暂存 + 置 expired + system 审计）。
- 权限：创建 / 分片 / 完成 / 取消 = `file.upload`（项目成员平权，ADR-011 平权例外）；读取会话状态 = 项目可见即可；不可见项目统一 404（防 IDOR）。`nodeId` / `taskId` 必须属于该项目（跨项目 400，防挂接）。文件上传**不触发** `projects.updated_at`（ADR-022 明示「不触发」）。
- 环境变量：`UPLOAD_MAX_SIZE_MB`（默认 2048，启动校验 ≤ 5120 —— 单次 CopyObject 上限）、`UPLOAD_SESSION_TTL_HOURS`（默认 24）。
- 审计口径：`audit_logs.object_type = "file"`（objectId = fileId），上传会话事件经 `metadata.uploadId` 定位（契约枚举 `AUDIT_OBJECT_TYPES` 随之增 `file` —— PR-4 跨线改动，请 wmj 评审）。

## 文件生命周期接口（S7·file · M4-02：版本 / 定档 / 回溯 / 回收站 + 到期清理任务）

- 契约同 `shared/src/modules/files.ts`（本卡**不改契约**）：`GET /api/v1/files/{id}`（详情含当前版本，200）、`GET /api/v1/files/{id}/versions`（版本链，200）、`POST …/finalize`（定档，200）、`POST …/rollback`（回溯，200）、`POST …/recycle`（回收，200）、`POST …/restore`（恢复，200）、`POST …/purge`（彻底删除，200 / 403）。
- 状态机：`draft → final（定档锁版）→ changed（M4-04 变更）→ archived`；`recycled` 为任意态的旁路（回收站，默认保留 30 天可恢复）。**生命周期写操作一律带乐观锁 `version`**：不匹配 → 409 `VERSION_CONFLICT`（details 带 `expected` / `current`）；`version` 落库在每次成功写后 +1（「并发定档 409」= M4 出口标准）。
- 版本链：只追加、不覆盖（ADR-006 对象键含 `v{seq}/{hash}`，定档不覆盖物理对象）；历史版本可读（读面 = 项目可见即可，非成员 404）。
- 定档（`finalize`）：仅 `draft`（否则 409 `FILE_STATE_INVALID`）；至少 1 个版本（否则 400 `VALIDATION_FAILED` + details `no_version`）；落 `finalized_at` / `finalized_by` 成对字段（库侧 CHECK `ck_files_finalized_pair`）+ 审计（action=complete）+ outbox `file.finalized`；定档后不可覆盖 / 替换，修改必须走变更（M4-04）。
- 回溯（`rollback`）：**生成新版本**（复制目标版对象到新版本契约键 `…/v{seq}/{hash}.{ext}`），不删除历史；目标版本不存在 / 不属于该文件 404、目标即当前版本 400（`already_current`）、位次被并发占用 500 `INTERNAL`（不写半份版本）。**定档（final / changed）后回溯走变更流（A4-13 申请即通过），随 M4-04 落地 —— 本切片显式 400（details `change_flow_not_open`）**；`recycled` / `archived` → 409 `FILE_STATE_INVALID`。
- 回收站（`recycle` / `restore`）：任意状态可删（重复回收 409）；落 `recycled_at` / `recycled_by` / `recycled_from_status` 三列成对字段（CHECK `ck_files_recycled_pair` / `ck_files_recycled_from_status`）与 `purge_after = recycled_at + FILE_RECYCLE_RETENTION_DAYS`；恢复回到进入前状态并清空四列。
- 彻底删除（`purge`）：**仅系统管理员**（非管理员 403 `FORBIDDEN`；权限模型落地前的临时口径）；仅回收站中的文件（否则 409）—— **对象按版本清（`purgeObject`，ADR-006：不依赖存储 lifecycle）+ 元数据删（清 `current_version_id` → 删 `file_versions` → 删 `files`，`upload_sessions` 外键 cascade）+ 审计留痕（`metadata.deletedVersions` / `reason`）**。对象清理在**持锁事务内**执行：防「清理快照过期 + 并发恢复」误删已恢复文件的对象；删除对象幂等，事务失败下轮重试收敛。
- 到期清理任务（worker）：`entry/worker.ts` 启动即跑一轮，之后每 30 分钟一批 ≤ 100 条（`RECYCLE_SWEEP_BATCH`）—— `purge_after ≤ now` 的回收站文件走同一彻底删除实现（system 留痕：`actorId = null`、`metadata.source = "system"`）；单条失败只告警不阻断（下轮重试）；并发恢复 / 并发删除在事务内复核后跳过。
- 权限：定档 / 回溯 / 回收 / 恢复 = `file.upload`（项目成员平权，ADR-011 平权例外）；详情 / 版本链 = 项目可见即可；彻底删除 = 仅系统管理员；不可见资源统一 404（防 IDOR）。
- 环境变量：`FILE_RECYCLE_RETENTION_DAYS`（回收站保留期，默认 30，1~3650；`.env.example` 已同步）。
- 本卡不需要新迁移：`files` 的 `finalized_*` / `recycled_*` / `purge_after` 与 `file_versions` 已在 `0001` / `0005` 就位。

## 文件库接口（S7·file · M4-03：多态关联与文件库查询）

- 契约同 `shared/src/modules/files.ts`（本卡**不改契约**）：`GET /api/v1/projects/{id}/files`（文件库列表，200；契约 `FileListQuerySchema` + `FileListResponseSchema = paginated(FileSchema)`）。实现：新增 `file-library.controller.ts`（`@Controller("api/v1/projects")` + `SessionGuard` / `CsrfGuard` / `ProjectAccessGuard`）+ `file.query.ts`（纯函数解析）+ repository `listProjectFiles` / `listFileLinks` / `listFileIdsByObject` / `insertFileLinks`。
- 多态关联（`file_links`，A4-01 / A4-09「一处关联、多处可见」）：上传完成（complete）在同一事务内写入——**project 必写，node / task 有则写**，`created_by` = 上传人；唯一 `（file_id, object_type, object_id）` + `insert … on conflict do nothing` 保证「追加版本不重复写」幂等；`file_id` 外键 on delete cascade（彻底删除自动清关联）。report / issue / change 三类随对应模块落地后写入（日报 / 问题在 M6、变更在 M4-04），本卡已备读方法。
- 查询口径：`filter[nodeId]` / `filter[taskId]`（对象侧反查，双向跳转）/ `filter[status]` / `filter[docType]`（**多值逗号 = OR**）/ `filter[uploadedBy]`（口径 = `files.created_by`，即文件创建者；追加版本的 `uploaded_by` 不作为筛选口径）/ `q`（文件名关键字，`ilike` 通配转义）/ `page` / `limit` / `sort`（白名单 `createdAt` / `updatedAt` / `finalizedAt` / `name` / `status`，方向缺省 asc；无排序 = `created_at desc` + `id` 升序 tie-breaker）。
- **默认口径 = 排除 recycled**（文件库 = 在用文件；与任务文件摘要 `FILE_STATUS_FOR_SUMMARY` 同口径）；显式 `filter[status]` 以给出为准（`filter[status]=recycled` 只看回收站，多值混排如 `draft,recycled` 两者都出）。`page` / `limit` 由 `paginationQuery` 归一（非法 / 越界 400）。
- 非法输入一律 400 `VALIDATION_FAILED`（不静默忽略）：排序白名单外 / 非法状态 / 非法类型 / 非 UUID（`details[].path` = `filter[nodeId]` 等字面键）/ 非法方向。契约未变：`FileListQuerySchema` 的 `filter[...]` 键由 Express 逐字解析（qs 不折叠）。
- 权限：**读 = 项目可见即可**（`ProjectAccessGuard` 在入口判定；非成员 / 项目不存在统一 404，防 IDOR）；写路径（关联写入）随 complete 走 `file.upload`。
- 本卡新增迁移 `0016_file_links.sql`（database 线，lan）：`file_links` + 唯一约束 + 反查索引（只追加；应用角色权限由 `roles/0001` default privileges 自动授予）。

## 干系人接口（j6 · S8·stakeholder：A5-01 ~ A5-04 / A5-07）

- 契约 `shared/src/modules/stakeholders.ts`（tags=stakeholders）：`StakeholderSchema`（八业务字段 + `projects[]` 关联 + 台账留痕）、`StakeholderCreateBodySchema`（`projectIds` 可一并关联）、`StakeholderUpdateBodySchema`（部分更新；null = 清空该字段）、`StakeholderListQuerySchema`（`q` / `filter[companyType]` / `filter[projectId]` / 排序）、`StakeholderProjectLinkBodySchema`、`StakeholderDeleteResponseSchema`；`AUDIT_OBJECT_TYPES` 增 `stakeholder`（跨线改动，请 lan 评审）。实现 `src/modules/stakeholder/`（controller / service / repository / rules + `index.ts` 唯一出口），`StakeholderModule` 由 `app.module.ts` 装配。
- 台账读（A5-01 / A5-03）：`GET /api/v1/stakeholders`（`q` = 姓名 / 公司 / 职务关键词（大小写不敏感、空值与空字段不参与命中）、`filter[companyType]` 四类多值逗号分隔、`filter[projectId]` 按项目看联系人清单、排序白名单 `updatedAt` / `createdAt` / `name`（缺省 `updatedAt:desc`）、分页走 `paginationQuery`；非法分类 / 排序 / 分页一律 400，不静默忽略）与 `GET /api/v1/stakeholders/{stakeholderId}`（含关联项目反查；不可见 / 不存在 / 已软删统一 **404**，防 IDOR）。
- 台账写（A5-02 / A5-04）：`POST /api/v1/stakeholders`（**201**；可带 `projectIds` 一并关联，项目不存在 404 且不写审计）、`PATCH /api/v1/stakeholders/{stakeholderId}`（部分更新：null = 清空、缺键 = 不改，审计只记变化字段）、`DELETE /api/v1/stakeholders/{stakeholderId}`（软删：写 `deleted_at` / `deleted_by`，不物理删行，历史与项目关联保留）。
- 项目关联（A5-03）：`POST /api/v1/stakeholders/{stakeholderId}/projects`（幂等：已关联再关返回同一结果、**不重复写审计**）与 `DELETE /api/v1/stakeholders/{stakeholderId}/projects/{projectId}`（未关联 404）；两条都回整行（含 `projects[]`），前端按项目看清单与按干系人反查项目同一数据面。
- 权限（A5-07 / C3-08）：读 = `stakeholder.view`（销售 / 项目经理 / 任务负责人 / 成员 / 只读 / 管理员均有），写 = `stakeholder.manage`（管理员 / 项目经理 / 销售）—— 种子 #6b 无需改动。记录级可见集 = 「关联项目落在我的可见项目内」∪「**我录入的**」（`own_stakeholders` 数据范围的一期落地形态，ownId 恒为本人 = 记录级兜底：有角色不会反而看得更少）。字段级直接复用 h6 策略出口（`projectFields`），无权字段**键不存在**（不落 null、不做前端打码）：`phone` / `wechat` / `email` → `stakeholder.contact.view`、`company` / `title` → `stakeholder.view`、`remark` → `stakeholder.manage`；`name` / `companyType` / `createdBy` / `projects` / 留痕字段未登记字段级策略 = 可见即可返回。
- 留痕（C7-01 / C7-02）：创建（`changes` 显式列八字段）/ 编辑（字段级 before / after）/ 软删 / 关联 / 解绑都在**同一事务**内写审计（`objectType = stakeholder`、`objectId` = 干系人 id；项目定位走 `metadata.projectId` + `metadata.link`），重复关联等无变化路径不产生噪声留痕。
- 迁移 `0019_stakeholders.sql`（database 线，只追加）：`stakeholders` + `project_stakeholders`；应用角色权限由 `roles/0001` default privileges 自动授予。判重（A5-05 姓名 + 手机号）走应用层提示、不建唯一约束（同名同号可能属不同项目的不同人）。
- 差异与后续（明细见 `src/modules/stakeholder/README.md`）：A5-05 批量导入随 M8-01（lan）、A5-06 去重合并二期、A5-08 提醒二期、A5-09 导出随 M7-03（lan）；「干系人角色」列口径未定，本切片不落列。

## 数据访问（Drizzle ↔ 迁移对齐）

- 迁移是唯一 DDL 来源（`database/migrations/`，只追加）；`src/db/schema/` 的 Drizzle 定义必须与迁移后的最终结构一致（当前 0001 ~ 0019）。
- 新增迁移的同一 PR 内同步更新 schema，并跑 `npm run check:db-schema`（比对表 / 列类型 / 可空性 / 索引 / CHECK 名称）。
- file 模块数据层（0005 / 0006）：`files` 补定档 / 回收站 / `purge_after` 列，新增 `upload_sessions`（分片直传会话，分片状态以对象存储 ListParts 为准）与 `idempotency_keys`（只存 sha256(key)；作用域 = 调用方 + 接口指纹），口径见 `database/README.md`。
- identity 数据层（0007 · h1）：`departments` / `roles` / `role_permissions` / `user_roles` 四表；角色集由 `database/seeds/roles.mjs` 种子维护（`node database/scripts/seed.mjs`），权限矩阵条目随 h6。
- project 成员数据层（0010 · h2）：`project_members`（`project_id` / `user_id` / `role_in_project` / `joined_at`；联合唯一 + `user_id` 反查索引），角色两值 `project_manager` / `project_member` 与全局角色相互独立。
- project 数据层（0009 · h2）：`projects` 增 `deleted_at` / `deleted_by` 与局部索引 `ix_projects_active_updated (updated_at desc) where deleted_at is null`；唯一约束违例经 drizzle 包装（`DrizzleQueryError`，原始驱动错误挂在 `cause`）——repository 逐层解包后按 `code=23505 + constraint` 映射业务错误码（编号重复 → 409 `PROJECT_CODE_EXISTS`）。
- 蓝图数据层（0011 · h3）：`blueprints`（`project_type` 唯一 + 草稿 `draft_payload` + `published_version` + 乐观锁 `version`）与 `blueprint_versions`（版本快照 payload + 校验 issues；`unique(blueprint_id, blueprint_version)`）—— 快照版本的唯一来源；发布时草稿同步归一为发布 payload（PG jsonb 会重排键，直比会误判「有变更」导致版本虚增）。
- 阶段跟踪（0012 · h3）：`project_stages` 增 `advanced_at` / `advanced_by` / `rolled_back_at` / `rolled_back_by` / `rollback_reason`（推进 / 回退留痕；ADR-023）。
- 字典与审计数据层（0013 · h7）：`dict_types`（类型注册表）/ `dict_items`（条目，`uq_dict_items_type_code` 同类型内码唯一 + 排序索引）/ `audit_logs`（追加写；`changes` / `metadata` jsonb + 按对象 / 操作人 / 项目 / 时间索引）；权限矩阵给 admin 补 `dict.manage` / `audit.view`（种子 #6b，admin = 契约 26 键全量）。
- 工作日历数据层（0014 · h8）：`calendar_days`（只存例外：date 主键 + day_type 两值 holiday / makeup_workday + name / note + updated_by + 4 CHECK + `(day_type, date)` 索引）与 `calendar_settings`（单行布尔主键：reminder_shift_enabled / shift_direction + 2 CHECK；迁移即建默认行）；权限矩阵给 admin 补 `calendar.manage`（种子 #6b，admin = 契约 27 键全量）。
- 文件多态关联数据层（0016 · M4-03）：`file_links`（`file_id` → `files(id)` on delete cascade + `object_type` 六值 CHECK（project / task / node / report / issue / change）+ `object_id`（多态无外键，归属校验在应用层）+ `created_by` / `created_at`；联合唯一 `uq_file_links_file_object` 保证重复写入幂等，反查索引 `ix_file_links_object (object_type, object_id)` 支撑对象侧双向跳转；report / issue / change 三类随对应模块落地后写入）。
- 干系人数据层（0019 · j6）：`stakeholders`（全库台账、不挂项目：name / company_type 四值 + company / title / phone / wechat / email / remark + created_by 录入人 + 软删 deleted_at / deleted_by；8 CHECK + 4 条局部索引，默认读序 = updated_at 降序且排除软删）与 `project_stakeholders`（多对多：联合唯一 `uq_project_stakeholders` + 两侧反查索引）；判重（A5-05 姓名 + 手机号）走应用层提示、不建唯一约束（去重合并 A5-06 二期）；「干系人角色」口径未定故不落列。
- 大文件走 MinIO 直传（api 只签名与元数据）属 file 模块后续卡片。

## 测试

- `npm run test`：vitest；端到端用 `@nestjs/testing` + supertest，PG 用替身（测试不依赖数据库）。
- 骨架测试：/healthz、/readyz（ok / degraded）、未知路由信封、ZodValidationPipe。
- 会话链路测试（`test/auth.e2e.test.ts`）：login 302 + PKCE 参数 → 回调建会话（用户 upsert / 只存哈希 / CSRF Cookie）→ 会话超时 / 登出 / 禁用踢线 / 开放重定向 / CsrfGuard，共 10 例（h1 新增 provider 以空替身隔离，不引数据库）。
- identity/org 测试（`test/identity-org.test.ts` · h1）：六角色数据范围用例 + 组织同步差异语义（父序 / 缺失停用 / 离职踢线 / 安全阀 / 复职），共 23 例（Push 74 时全量 39 例）。

- project 测试（`test/project-crud.test.ts` · h2）：筛选解析（多值 / 非法枚举 400 / 上海日界 / 区间反向 400）、排序白名单、行 → 契约视图映射、创建缺省阶段与撞号 409、乐观锁冲突与归档写保护、软删可见性与操作人透传、唯一违例解包、多位经理 `managerNames` 同下标映射，共 22 例（Push 136 追加 1 例）；
- project 成员测试（`test/project-members.test.ts` · h2）：视图映射 / 列表顺序 / 添加 upsert + touch / 重复添加改角色 / 目标用户 404 / 归档写保护 / 移除与不是成员 404，共 7 例；`npm run test` 全部 87 例（h2 末）。

- 蓝图校验测试（`test/blueprint-validation.test.ts` · h3）：schema / 节点 key 唯一 / seq 递增 / docType 引用命中成果字典 / 引用未知分流 422 `BLUEPRINT_REF_UNKNOWN`，共 7 例；
- 流程门禁测试（`test/flow-gate.test.ts` · h3）：节点完成缺件明细 `missing[]`、阶段推进三类缺项（`node_not_done` / `task_not_done` / `doc_missing`）、门禁全过分支与阶段完成度派生，共 6 例；**h3 后全量 100 例（9 文件）**。
- 任务规则测试（`test/task-rules.test.ts` · h4）：五态派生（待开始 / 进行中 / 已延期 / 已完成 / 提前完成）、按时交付派生（含回落存储值）、状态写入联动、进度写入联动（清完成日期 = 唯一方式）、上海日界、列表筛选 / 排序解析（非法值 400），共 17 例；
- 门禁拒绝测试（`test/flow-gate-rejection.test.ts` · h5 · PoC-9）：服务端强校验 422 + `details[].code=required_doc`、拒绝留痕 `node.gate_rejected`（含 missing 明细与操作人）、不部分生效（未 `markNodeDone` / 未 touch）、can-complete 预检（缺件 false / 齐备 true / 已完成 false）、门禁通过对照（`node.completed`），共 5 例；**h5 后全量 135 例（12 文件）**。
- 权限矩阵测试（`test/permission-matrix.test.ts` · h6 · PoC-6）：**记录级 9 例**（六角色数据范围的可见集规格、多角色并集、主数据责任人恒可见、单项目谓词与可见 id 同源）＋**功能权限 7 例**（全局位、任务负责人、项目内项目经理 / 成员平权、非成员先 404、项目上下文外只看全局位、隐含位 ⊆ 且全在契约枚举内）＋**字段级 6 例**（联系方式三字段 / 商务字段 / 备注三级、行投影删字段不落 null、员工邮箱一期全员可见、策略表字段登记校验）＋**五出口 5 例**（四出口投影一致、导出单独授权、导出字段仍按同一策略裁剪、任一出口不含被裁字段、出口集合 = 四类 + 记录级）＋**策略服务 7 例**（projectScope all / ids、resolveProjectAccess 的 404 语义与角色位、软删、assertCan 403、画像缓存单次查库），共 34 例；**h6 后全量 169 例（13 文件）**。
- 字典与审计测试（`test/admin-audit.test.ts` · h7 · S6·admin）：**纯函数 3 例**（字段级 diff 与稳定序列化）＋**越权判定 3 例**（路径 → 对象解析、403 全记 / 404 白名单、uuid 判定）＋**DictService 5 例**（默认只发启用项 / 未知类型 404 / 同码 409 + 审计入参 / 停用替代删除的字段级留痕 / 无变更仍留痕 changes=null）＋**AuditService 4 例**（写入口径补全、越权写入吞错不抛、按对象与按人检索、人员快照缓存），共 15 例；**h7 后全量 184 例（14 文件）**。
- 工作日历测试（`test/calendar-rules.test.ts` + `test/calendar-service.test.ts` · h8 · S6·工作日历）：**规则 17 例**（默认规则与例外优先、窗口外 null、日期算术、顺延金标 forward / backward / 已是工作日 / 跨年 / exhausted、T-1·T+N 开关两态与改期重算、上海时刻换算）＋**服务 12 例**（年历与排序、缺省今天走时钟、setDay 审计与幂等、deleteDay 404、updateSettings 空变更、shift 方向覆盖、offset T-1 / T+1），共 29 例；**h8 后全量 213 例（16 文件）**。
- 任务用例测试（`test/task-service.test.ts` · h4）：带节点创建缺省项目经理 / 节点判重 409 / 手工创建仅管理员 403 / 阶段不一致 400 / 归档 409、状态联动（done 满格补当天、active 退 0.75 清日期、过期保持已延期）、乐观锁 409 / 跨项目 404、进度写回清完成日期、项目总览四格，共 19 例（含 w2 · Push 124 追加 5 例：未分组 / 位次顺延 / 显式置空 / 组内重排；Push 136 追加 1 例：`ownerIds` 缺省兜底项目全部经理）；**w2 后全量 222 例（17 文件）**、**Push 136 后全量 310 例（19 文件）**、**Push 143（M3-03）后全量 318 例（20 文件）**（新增 `test/task-gate.test.ts` 8 例：预检缺件明细 / 无节点 `deliverable_types` 兜底 / 完成缺件 422 + outbox + 审计 failed / 门禁通过 200 + `task.completed` / draft 放行 + R02 / 重复提交 409 / `PATCH status=done` 与 `progress=1` 同一门禁）；**j6（Push 144）后全量 345 例（22 文件）**。
- 任务顺序测试（`test/task-order.test.ts` · w2）：位次夹取 / 插入计划（组尾 / 组首 / 中间）/ 移动计划（越界 = 组尾）/ 读序稳定，共 4 例（纯函数，不连库）；
- 干系人策略测试（`test/stakeholder-rules.test.ts` · j6）：记录级可见集 4 例（管理员全量 / 我录入的 ∪ 可见项目关联 / 销售无可见项目仍见我录入的 / 可见集副本不可变）+ 过滤解析 3 例（空查询 / 公司分类多值 + 非法 400 / 项目筛选透传）+ 排序白名单 3 例 + 关键词 2 例，共 12 例；
- 干系人服务测试（`test/stakeholder-service.test.ts` · j6 · S8·stakeholder）：**字段级脱敏为核心验收**（销售全可见 / 任务负责人联系方式与备注**键不存在** / 只读无备注 / 未登记字段恒返回）＋记录级 5 例（我录入的兜底 / 他人录入且项目不可见 404 / 项目可见即可见 / 管理员全量 / 列表三类筛选）＋用例与留痕 6 例（新建八字段留痕 / 关联不存在项目 404 不写审计 / 更新只记变化字段 / 重复关联幂等不重复留痕 / 解除关联 404 与留痕 / 软删后详情 404），共 15 例；
- 文件上传测试（`test/file-service.test.ts` · M4-01 · S7·file）：仓储 / 存储 / 权限 / 审计替身直测服务层 —— 发起上传（draft + 暂存键 + 分片计划 + TTL + 秒传提示 + 小写归一）、`intent=change` + `fileId` 400（details `intent_change_not_open`）、`intent=version` + `fileId` 400（显式守卫，details `file_id_not_supported`；`change` 缺 `fileId` 在契约层即拒，由契约回放 / 真机 U21 兜住）、超上限 400（details.limitBytes）、归档 409 / 不存在 404、nodeId / taskId 跨项目 400；取分片（首建登记 + 复用 + 越界 400 + 过期惰性 410 + 非本文件会话 404）；会话状态（已传 / 缺失、未建存储侧会话、过期 409、已完成 409）；完成（成功链路 = 合并升序 + 复制契约键 + 版本 / 文件 / 会话 + 审计 + outbox + 清暂存、缺片 409 带 missing、未上传任何分片、HEAD size_mismatch 409、合并结果不存在、哈希不符 422、init 无哈希以 complete 为准、过期 410、存储侧会话丢失 410、位次被抢占 500、copy 失败映射、清暂存失败只告警）；取消（成功 + 幂等 + 已完成 409）；过期清理（批量 + 单条失败不阻断）；**M4-02（版本 / 定档 / 回溯 / 回收站）**：详情与版本链（无版本时 currentVersion=null / 不存在 404）、`intent=version + fileId` 追加版本（复用文件行不新建 + 审计 update + 秒传提示恒空）与反例（非 draft 409 / 跨项目 invalid_file 400 / 名称 name_mismatch 400 / 不存在 404）、定档（成功链路 = 成对字段 + 乐观锁递增 + 审计 + outbox、并发 409 VERSION_CONFLICT（details current/expected）、状态不允许 409、无版本 400 no_version）、回溯（成功 = 复制目标版对象到新版本契约键 + 新版本行 + 审计 rollback + outbox、定档后 400 change_flow_not_open、回收站 409、目标不存在 404、already_current 400、乐观锁 409、位次竞态 500）、回收（成对写 + purgeAfter = 保留期 + 保留期可配置 + 重复回收 409 + 乐观锁 409）、恢复（回退原状态 + 清三列 + 未回收 409）、彻底删除（非管理员 403 / 非回收站 409 / 乐观锁 409 / 按版本清对象 + 删元数据 + 留痕 / 对象失败不删元数据）、到期清理（批量两条 + 单条失败不阻断 + 并发恢复跳过），共 **55 例**；**M4-03（多态关联与文件库查询）**：关联写入（project+node+task 三行 / 仅 project / 重复完成幂等不再写）、文件库列表（筛选解析下推（多值 trim / 分页 offset）+ 默认口径（排除 recycled）+ 非法输入 400），共 6 例；**M4-03 后全量 308 例（19 文件）**、**Push 136 后全量 310 例（19 文件）**。

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
- 差异与后续：搜索 / 通知模块（lan 线）尚未落地、投影入口已就绪；字段级真实出口**已随 j6 干系人落地（Push 144）**；导出 / 搜索 / 通知出口的调用方接线随 i 系列与 M7 —— 明细见 `src/modules/permission/README.md` 差异 1~5。

## PoC-7 回放（h7 · S6·admin：字典 C9 与审计留痕 C7）

- 脚本：`scripts/poc7-replay.mjs`（连真 PG + 真 api；铸管理员与受限账号两个临时会话、建 `POC7-xxx` 字典条目 —— 跑完硬删字典条目与本次审计行（api 角色无权删审计，用 migrator 连接）与两个会话）。
  - 复跑：`cd server && node scripts/poc7-replay.mjs --out ../docs/PoC-7-回放证据(字典C9与审计留痕C7).md`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据、`--actor <userId>` 指定受限账号。
- 证据入库：`docs/PoC-7-回放证据(字典C9与审计留痕C7).md`（真机 23 项断言：默认只下发启用项 + 管理口径 403 + 新增 / 停用 200 且同码 409 + 未知类型 404 无噪声 + 审计按对象 / 按人命中 + 越权 403 落 denied 行 + 收尾零残留）。
- 门禁（不连库，随 `npm test` 与 CI 常跑）：`test/admin-audit.test.ts` 15 例 + `check:db-schema`（29 表 / 284 列 / 87 索引 / 85 CHECK）+ `check:permission-matrix`（6 角色 / 74 条目 / 27 键）。
- 回放中发现并修正的契约漂移（h7）：`GET /api/v1/dicts/{type}` 原先用枚举管道硬拦路径参数（未知类型 → 400），与契约「未知类型返回 404」不符 —— 已改为普通路径段校验、未知类型由服务层统一 404（`src/modules/admin/dicts.controller.ts`）；`POST /api/v1/dicts/{type}/items` 的契约响应码 200 → 201（与实际行为一致）。

## PoC-8 回放（h8 · S6·工作日历：D5 日历维护 / 顺延规则 / T-1·T+1）

- 脚本：`scripts/poc8-replay.mjs`（连真 PG + 真 api；铸管理员与受限账号两个临时会话、在 **2099 年**合成与国庆同形的日历（10-01~10-07 放假 + 10-10 调休上班）—— 跑完硬删日历行、恢复顺延配置、删除两个会话）。
  - 复跑：`cd server && node scripts/poc8-replay.mjs --out ../docs/PoC-8-回放证据(工作日历D5).md`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据、`--actor <userId>` 指定受限账号。
- 证据入库：`docs/PoC-8-回放证据(工作日历D5).md`（真机 30 项断言：读面登录即可 + 写面受限 403 + 越权落 denied 行 + 单日判定例外优先 + 顺延 forward / backward 金标 + T-1 命中不顺延 + T-7 顺延开 / 关两态 + 08:00 时刻换算 + 删除回落 + 收尾零残留）。
- 门禁（不连库，随 `npm test` 与 CI 常跑）：`test/calendar-rules.test.ts` 17 例 + `test/calendar-service.test.ts` 12 例 + `check:db-schema`（29 表 / 284 列 / 87 索引 / 85 CHECK）+ `check:permission-matrix`（6 角色 / 74 条目 / 27 键）。
- 差异与后续：节假日 / 调休年历数据待业务回执（种子 #10）；跨天补跑随 i8 / i9（依赖 i5 outbox）；日历视图与前端接入随 u 系列 —— 明细见 `src/modules/calendar/README.md` 差异 1~5。
## w2 落库口径回放（w2 · A15 / A18 / A19 / A20）

- 脚本：`scripts/w2-replay.mjs`（连真 PG + 真 api；铸管理员会话 / 跑完撤销，建 `W2-xxx` 回放项目与 6 条任务 / 跑完硬删回放项目及其节点 / 阶段 / 任务 / outbox 事件）。
  - 复跑：`cd server && node scripts/w2-replay.mjs --out ../docs/w2-回放证据(任务落库口径A15A18A19).md`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据。
- 证据入库：`docs/w2-回放证据(任务落库口径A15A18A19).md`（真机 33 项断言：未分组落库 + 待分配可空 + 组内位次持久化（插入 / 拖动 / 越界 / 乐观锁 / 组隔离）+ 节点来源口径 + 阶段完成度剔除未分组 + 字段级留痕）。
- 门禁（不连库，随 `npm test` 与 CI 常跑）：`test/task-order.test.ts` 4 例 + `test/task-service.test.ts` 19 例 + `check:db-schema`（29 表 / 284 列 / 87 索引 / 85 CHECK）。
- 迁移与回填：`database/migrations/0015_task_order_and_nullable_scope.sql`（回填按迁移前默认读序 `planned_start ASC NULLS LAST, created_at, id`，迁移前后读序一致）。

## 多位项目经理 / 多位任务负责人（A22 / A23 · Push 136）

- 契约与落库：`shared/src/modules/projects.ts` 的 `Project.managerIds`（`uuid[]`，至少一位）+ `managerNames`（与 `managerIds` 同下标）、`tasks.ts` 的 `Task.ownerIds`（`uuid[]`，空数组 = 「待分配」）+ `ownerNames`；迁移 `0017_multi_manager_and_owner.sql` 把 `projects.manager_id` / `tasks.owner_id` 换成 `manager_ids` / `owner_ids`（`ck_projects_manager_ids` / `ck_projects_manager_ids_no_null` / `ck_tasks_owner_ids_no_null` + `ix_projects_manager_ids` / `ix_tasks_owner_ids` GIN）。
- 口径：数组顺序 = 展示顺序；项目至少一位经理（创建 / 编辑都校验），任务负责人可空（`[]` = 「待分配」）；筛选 `filter[managerId]` / `filter[ownerId]` = 任一位命中即命中；facets 的 `managerId` 维度每位经理各计一次（`cross join lateral unnest`）；任务创建缺省 `ownerIds` = 项目全部项目经理、显式 `[]` = 待分配，编辑不传 = 不改、`[]` = 置空、数组 = 整体替换。
- 权限与留痕：项目责任人判定改 `manager_ids` 任一位；`listOwnedProjectIds`（「我负责的项目」）改 `manager_ids @> array[$]::uuid[]`；`managerIds` / `ownerIds` 变更进审计快照（字段级 `from` / `to`，C7-02）。
## M4-01 回放（S7·file 上传管道）

- 脚本：`scripts/m4-upload-replay.mjs`（真 PG + 真对象存储 + 真 api；铸管理员与名册成员两个临时会话 / 跑完撤销，建 `M4-xxx` 回放项目 / 跑完硬删项目及其文件 / 版本 / 会话 / 审计 / outbox 事件 + 清桶内前缀）。
  - 复跑：`cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink node --env-file-if-exists=.env scripts/m4-upload-replay.mjs --out "../docs/m4-01-回放证据(上传管道S7file).md"`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据。
  - `M4_DATABASE_URL` 优先于 `DATABASE_URL`：脚本侧断言 SQL 与收尾需要迁移器权限（`audit_logs` 对应用角色只授 SELECT / INSERT）。
- 证据入库：`docs/m4-01-回放证据(上传管道S7file).md`（真机 28 项断言：发起上传与落库口径 / 分片直传与断点续传 / 完成落版本（契约键 + 暂存清理）/ 留痕与 outbox / 失败面（缺片 / 大小 / 哈希 / 已完成 / 取消幂等）/ 过期清理（惰性 + worker 定时）/ 权限平权与跨项目反例）。
- 门禁（不连库，随 `npm test` 与 CI 常跑）：`test/file-service.test.ts` 61 例（服务层替身直测，含 M4-02 生命周期）；`check:boundaries` / `check:permission-matrix` 覆盖新增模块与权限键用法。
- 覆盖范围提示：本卡只落「上传管道」（发起 / 分片 / 状态 / 完成 / 取消 + 过期清理）；**文件详情 / 版本链 / 定档 / 回溯 / 回收站 / 恢复 / 彻底删除已随 M4-02（PR-5）接入同一控制器**，变更（M4-04）与预览（M4-05）仍为后续卡片。U22 断言已随 M4-02 放开 `version + fileId` 同步切换（version 接受 / change 仍 400）。

## M4-02 回放（S7·file 版本 / 定档 / 回溯 / 回收站 + 到期清理任务）

- 脚本：`scripts/m4-lifecycle-replay.mjs`（真 PG + 真对象存储 + 真 api；铸管理员与名册成员两个临时会话 / 跑完撤销，建 `M4L-` 回放项目 / 跑完硬删项目及其文件 / 版本 / 会话 / 审计 / outbox 事件 + 清桶内前缀）。
  - 复跑：`cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink node --env-file-if-exists=.env scripts/m4-lifecycle-replay.mjs --out "../docs/m4-02-回放证据(版本定档回溯回收站).md"`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据。
  - `M4_DATABASE_URL` 优先于 `DATABASE_URL`：脚本侧断言 SQL 与收尾需要迁移器权限（`audit_logs` 对应用角色只授 SELECT / INSERT）。
- 证据入库：`docs/m4-02-回放证据(版本定档回溯回收站).md`（真机 20 项断言：读面（详情 + 版本链）/ 定档与并发定档 409 / 定档后管控（追加版本 409 + 回溯 400）/ draft 追加版本与反例 / 回溯（复制对象 + already_current）/ 回收与恢复 / 到期清理（worker 启动一轮）/ 彻底删除（管理员 200 + 成员 403 + 非回收站 409）/ 读面权限 404）。
- 门禁（不连库，随 `npm test` 与 CI 常跑）：`test/file-service.test.ts` 61 例（服务层替身直测，含 M4-03）；`check:boundaries` / `check:permission-matrix` 覆盖新增模块与权限键用法。
- 落点说明：`docs/` 属 px 线；证据文件由 lan 随 M4-02 卡片代记（回放脚本与断言同 PR），请 px 复核。

## M4-03 回放（S7·file 多态关联与文件库查询）

- 脚本：`scripts/m4-library-replay.mjs`（真 PG + 真对象存储 + 真 api；铸管理员与名册成员两个临时会话 / 跑完撤销，建 `M4LIB-` 回放项目 / 跑完硬删项目及其文件 / 关联 / 会话 / 版本 / 任务 / 审计 / outbox 事件 + 清桶内前缀）。
  - 复跑：`cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink node --env-file-if-exists=.env scripts/m4-library-replay.mjs --out "../docs/m4-03-回放证据(多态关联与文件库查询).md"`；退出码 0 = 断言全过（可当门禁），`--keep` 保留回放数据、`--json <file>` 输出机器可读证据。
  - `M4_DATABASE_URL` 优先于 `DATABASE_URL`：脚本侧断言 SQL 与收尾需要迁移器权限（`audit_logs` 对应用角色只授 SELECT / INSERT）。
- 证据入库：`docs/m4-03-回放证据(多态关联与文件库查询).md`（真机 19 项断言：多态关联写入与幂等（project / node / task 三行 + 追加版本不重复写）/ 文件库筛选（节点 / 任务 / 类型 / 状态 / 上传人 / 关键字）/ 白名单排序与分页 / 回收站口径（默认排除 + 显式可查 + 多值混排）/ `file_links` 反查与列表同源 / 非法输入 400 / 权限 404）。
- 门禁（不连库，随 `npm test` 与 CI 常跑）：`test/file-service.test.ts` 61 例（服务层替身直测，含 M4-03）；`check:db-schema`（29 表 / 284 列 / 87 索引 / 85 CHECK）；`check:boundaries` / `check:permission-matrix` 覆盖新增文件与权限键用法。
- 落点说明：`docs/` 属 px 线；证据文件由 lan 随 M4-03 卡片代记（回放脚本与断言同 PR），请 px 复核。

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
- h6：权限矩阵与脱敏五出口（ADR-011 策略层落地：记录级可见集 / 功能权限 / 字段级策略 / 五出口投影 + ProjectAccessGuard + `GET /api/v1/permissions/me` + 种子 #6b + 真机回放）—— 已落地（Push 95）；剩余：临时授权（C3-06）、权限管理界面与权限自检报告（C3-09 · u12）、越权尝试留痕告警（h7）、干系人字段级真实出口（j6 · 已落 Push 144）、搜索 / 通知模块本身（lan 线）。
- h7：字典 C9 与审计留痕 C7（`dict_types` / `dict_items` / `audit_logs` + 字典读写出口 + 审计写入 / 越权留痕 / 检索 + 种子 #5 + 真机回放）—— 已落地（Push 97）；剩余：前端改读字典（u12 · px 线）、审计页面与导出（u12）、告警推送（M5 通知）、蓝图字段级留痕（随蓝图维护卡片）、按月清理（运维）。
- h8：工作日历与顺延规则（D5-01~03：`calendar_days` / `calendar_settings` + `/api/v1/calendar/*` + ClockService + 种子 #6b 补 `calendar.manage` + 真机回放）—— 已落地（Push 99）；剩余：节假日 / 调休年历数据（业务回执后经管理端录入 · u12）、跨天补跑 / 应执行清单（i8 / i9，依赖 i5 outbox）、日历视图与前端接入（u 系列 · px 线）。
- j6：干系人台账（S8·stakeholder：A5-01 ~ A5-04 / A5-07 —— `stakeholders` / `project_stakeholders` 数据面 + `/api/v1/stakeholders` 台账 CRUD 与项目关联 + 字段级脱敏真实出口 + 迁移 0019）—— 已落地（Push 144）；剩余：批量导入（A5-05 · M8-01 · lan）、去重合并（A5-06 · 二期）、提醒（A5-08 · M5）、导出（A5-09 · M7-03 · lan）、「干系人角色」列（口径未定）、前端台账页与项目「干系人」面板（u 系列 · px 线）。
- S7·file：M4-01 上传管道（发起 / 分片直传与断点续传 / 完成落版本 / 取消 / 过期清理 + 真机回放）—— 已落地（Push 129 · PR-4）；**M4-02 版本 / 定档 / 回溯 / 回收站 + 到期清理任务（详情 / 版本链 / finalize / rollback / recycle / restore / purge + worker 到期清理 + 真机回放）—— 已落地（PR-5）**；上传入口 `fileId` 定案（Push 130 · wmj，#100）已按线放开：`version + fileId`（既有 draft 追加 / 替换）随 M4-02 落地，`change + fileId`（定档后变更）随 M4-04 仍为 400 守卫；**M4-03 文件库查询与多态关联（GET /projects/{id}/files 列表 + ile_links 双向跳转 + 真机回放）—— 已落地（PR-6）**；M4-04 变更、M4-05 预览编排为后续卡片。
- lan 线：file（进行中：M4-01 / M4-02 / M4-03 已落地；M4-04 变更 / M4-05 预览编排待落）/ preview / notify / outbox 调度 / search / dashboard。
- 非目标（v0.2 §1.4）：Redis / MQ / K8s / 在线编辑 / 移动端 / 甘特图。
