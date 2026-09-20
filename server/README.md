# server/ · 后端工程（g4 骨架 · g6 会话后端化 · h1 identity/org · h2 project）

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
    common/               # errors / http（校验管道）/ logging
    config/               # 环境变量契约（Zod）与全局配置模块
    db/                   # PG 连接 + Drizzle schema（对齐 database/migrations）
    health/               # 垂直样例：controller -> service -> repository
    modules/identity/     # 首个真实实现：/auth/* 会话链路（g6）
    modules/<其余 12 个模块>/README.md（占位）
  scripts/check-boundaries.mjs   # 依赖方向规则检查
  scripts/check-db-schema.mjs    # Drizzle schema 与实际库漂移检查
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
| 平台（platform） | file、notify、search、dashboard | lan |
| 平台（platform） | automation、admin | wmj |

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

## 数据访问（Drizzle ↔ 迁移对齐）

- 迁移是唯一 DDL 来源（`database/migrations/`，只追加）；`src/db/schema/` 的 Drizzle 定义必须与迁移后的最终结构一致（当前 0001 ~ 0009）。
- 新增迁移的同一 PR 内同步更新 schema，并跑 `npm run check:db-schema`（比对表 / 列类型 / 可空性 / 索引 / CHECK 名称）。
- file 模块数据层（0005 / 0006）：`files` 补定档 / 回收站 / `purge_after` 列，新增 `upload_sessions`（分片直传会话，分片状态以对象存储 ListParts 为准）与 `idempotency_keys`（只存 sha256(key)；作用域 = 调用方 + 接口指纹），口径见 `database/README.md`。
- identity 数据层（0007 · h1）：`departments` / `roles` / `role_permissions` / `user_roles` 四表；角色集由 `database/seeds/roles.mjs` 种子维护（`node database/scripts/seed.mjs`），权限矩阵条目随 h6。
- project 成员数据层（0010 · h2）：`project_members`（`project_id` / `user_id` / `role_in_project` / `joined_at`；联合唯一 + `user_id` 反查索引），角色两值 `project_manager` / `project_member` 与全局角色相互独立。
- project 数据层（0009 · h2）：`projects` 增 `deleted_at` / `deleted_by` 与局部索引 `ix_projects_active_updated (updated_at desc) where deleted_at is null`；唯一约束违例经 drizzle 包装（`DrizzleQueryError`，原始驱动错误挂在 `cause`）——repository 逐层解包后按 `code=23505 + constraint` 映射业务错误码（编号重复 → 409 `PROJECT_CODE_EXISTS`）。
- 大文件走 MinIO 直传（api 只签名与元数据）属 file 模块后续卡片。

## 测试

- `npm run test`：vitest；端到端用 `@nestjs/testing` + supertest，PG 用替身（测试不依赖数据库）。
- 骨架测试：/healthz、/readyz（ok / degraded）、未知路由信封、ZodValidationPipe。
- 会话链路测试（`test/auth.e2e.test.ts`）：login 302 + PKCE 参数 → 回调建会话（用户 upsert / 只存哈希 / CSRF Cookie）→ 会话超时 / 登出 / 禁用踢线 / 开放重定向 / CsrfGuard，共 10 例（h1 新增 provider 以空替身隔离，不引数据库）。
- identity/org 测试（`test/identity-org.test.ts` · h1）：六角色数据范围用例 + 组织同步差异语义（父序 / 缺失停用 / 离职踢线 / 安全阀 / 复职），共 23 例（Push 74 时全量 39 例）。

- project 测试（`test/project-crud.test.ts` · h2）：筛选解析（多值 / 非法枚举 400 / 上海日界 / 区间反向 400）、排序白名单、行 → 契约视图映射、创建缺省阶段与撞号 409、乐观锁冲突与归档写保护、软删可见性与操作人透传、唯一违例解包，共 21 例；
- project 成员测试（`test/project-members.test.ts` · h2）：视图映射 / 列表顺序 / 添加 upsert + touch / 重复添加改角色 / 目标用户 404 / 归档写保护 / 移除与不是成员 404，共 7 例；`npm run test` 全部 87 例。

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
- lan 线：file / preview / notify / outbox 调度 / search / dashboard。
- 非目标（v0.2 §1.4）：Redis / MQ / K8s / 在线编辑 / 移动端 / 甘特图。
