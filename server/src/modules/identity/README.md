# identity 模块（g6 会话后端化 + h1 组织 / 角色 已落地）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | SSO 接入、会话、用户、组织同步与角色（h1） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | getUser、listDepartments、SessionGuard + CurrentUser、CsrfGuard、revokeAllForUser、RoleService（授权画像 / 绑定）、OrgSyncService（目录快照 → 差异报告） |

## 已实现（g6）

- 路由（根路径，不进 /api/v1）：`GET /auth/login`、`/auth/callback`、`/auth/me`、`/auth/logout`（ADR-010；OIDC authorization_code + PKCE + state）。
- 会话：HttpOnly Cookie `ll_sid`（PostgreSQL `sessions` 表只存 sha256 哈希）；空闲超时 `SESSION_IDLE_MINUTES`（默认 30 分钟，接入标准「企业内部系统」档）；绝对上限取 ID Token `exp`；命中后 `last_seen_at` 按 60s 节流刷新。
- 单点登出：撤销本地会话 + 302 到 Casdoor `/api/logout`（携 `id_token_hint`，仅存于服务端会话行）。
- 用户：登录时按 `claims.id` upsert `users`（工号 `claims.name`、姓名 `claims.displayName`）；禁用账号登录 403、已登录会话被踢（`revokeAllForUser`）。
- CSRF：登录下发可读 Cookie `ll_csrf`；写接口叠加 `CsrfGuard`（回传 `X-CSRF-Token`），h2 起随业务接口启用。
- 回跳：`/auth/login?returnTo=` 仅允许同源相对路径（`safeReturnTo` 白名单，防开放重定向）。
- 文件：`auth.controller.ts` / `oidc.service.ts` / `session.service.ts` / `user.service.ts` / `auth.guard.ts` / `csrf.guard.ts` / 两个 repository；四层结构与 index 出口约定见 `server/README.md`。

## 已实现（h1 · S6·identity/org）

- 数据面（迁移 `0007_identity_org.sql` + Drizzle 同步）：`departments`（部门树；`source_id` 唯一，缺失不删只停用）、`roles`（六个内置角色 + `data_scope`）、`role_permissions`（功能权限位结构）、`user_roles`（用户 ↔ 角色绑定）；`npm run check:db-schema` 通过（18 张表 / 187 列 / 50 索引 / 47 CHECK）。
- 种子：`database/seeds/roles.mjs`（一期六角色：admin / project_manager / task_owner / project_member / sales / viewer，upsert 幂等）+ `database/scripts/seed.mjs`（`--dry-run` / `--only=<name>`；与迁移分界见 `database/seeds/README.md`）。
- 出口一：`DepartmentService.listDepartments()` —— 默认只返回 active、按名称升序，`parentId` 供消费方组树（v0.2 §1.2）。
- 出口二：`RoleService.getActorAuthorization(userId)` —— 授权画像 = 角色码 + 数据范围并集（由宽到窄：`all` > `managed_projects` > `involved_projects` > `own_stakeholders` > `granted`）+ 功能权限位并集；`assignRole` / `revokeRole` 幂等，未知角色码 404。
- 出口三：`OrgSyncService.applySnapshot(snapshot)` —— 部门树父先于子 upsert、快照缺失的在编部门停用、用户按 casdoor_id upsert、目录判定离职 → 置 disabled + 撤销该用户全部在线会话；产出差异报告（created / updated / disabled / sessionsRevoked / unresolvedParents / missing）。`missingUserPolicy: "disable"`（离职回收闭环）带安全阀：缺失在职用户超过 max(3, 在职 × 20%) 只报告不执行。
- 单测：`test/identity-org.test.ts` —— 六角色数据范围用例（h1 验收项）+ 组织同步差异语义（父序解析 / 重命名 / 缺失停用 / 离职踢线 / 复职 / 安全阀 / 成环与重复报错），不连库。
- 口径：权限判定只在服务端（ADR-011）；本模块只产授权画像，`can / buildScopeWhere / fieldPolicy / exportPolicy` 由 h6 策略服务消费；组织 / 角色接口维持「内部作业」，不新开 HTTP 端点（M1 契约切片表）。

## 边界与后续

- 不做：密码 / 本地账号兜底、正式环境 Casdoor 配置核对（g7，px）。前端会话切换（k6）已于 Push 46 合入，`/auth/*` 由本模块独立承载。
- 待接：① 目录适配器（Casdoor / 企微 HTTP 拉取 → `OrgDirectorySnapshot`）随调度卡片（i5）接入 worker；② `role_permissions` 矩阵条目随 h6（PoC-6 权限矩阵与脱敏五出口）；③ 人员 ↔ 部门映射（多部门 / 兼职）随 D1-06 与同步 payload 确认另起迁移；④ 组织 / 角色管理端点随 C3-09 / D1-06 管理界面（u3 / u12）。
- 过期会话清理（物理删除）随 worker / jobs 卡片；当前以 `revoked_at` + `expires_at` 索引支撑。
- 首任系统管理员授权：`RoleService.assignRole(userId, "admin")`（运维执行，不写死种子）。
