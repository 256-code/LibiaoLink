# identity 模块（g6 会话后端化 + h1 组织 / 角色 / 通讯录同步已收口）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | SSO 接入、会话、用户、组织同步与角色（h1） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | getUser、listUsers（用户目录）、listDepartments、SessionGuard + CurrentUser + CurrentActorId、CsrfGuard、revokeAllForUser、RoleService（授权画像 / 绑定）、OrgSyncService（快照 → 差异报告）、CasdoorDirectorySource（目录拉取）、InternalUserService（离职回收）、UserPreferenceService（用户偏好 A4 / A24）；HTTP：GET /api/v1/users、GET|PATCH /api/v1/users/me/preferences、POST /internal/users/*、POST /internal/org-sync/run |

## 已实现（g6）

- 路由（根路径，不进 /api/v1）：`GET /auth/login`、`/auth/callback`、`/auth/me`、`/auth/logout`（ADR-010；OIDC authorization_code + PKCE + state）。
- 会话：HttpOnly Cookie `ll_sid`（PostgreSQL `sessions` 表只存 sha256 哈希）；空闲超时 `SESSION_IDLE_MINUTES`（默认 30 分钟，接入标准「企业内部系统」档）；绝对上限取 ID Token `exp`；命中后 `last_seen_at` 按 60s 节流刷新。
- 单点登出：撤销本地会话 + 302 到 Casdoor `/api/logout`（携 `id_token_hint`，仅存于服务端会话行）。
- 用户：登录时按 `claims.id` upsert `users`（工号 `claims.name`、姓名 `claims.displayName`）；禁用账号登录 403、已登录会话被踢（`revokeAllForUser`）。
- CSRF：登录下发可读 Cookie `ll_csrf`；写接口叠加 `CsrfGuard`（回传 `X-CSRF-Token`），h2 起随业务接口启用（项目接口已挂）。
- 请求级用户口径（h2 起）：`@CurrentUser()` 返回 `/auth/me` 同口径的用户（`id` 为 Casdoor 侧标识）；`@CurrentActorId()` 返回本库 `users.id`（uuid）—— 落库外键 / 审计字段用后者（首个使用方：项目软删 `deleted_by`）。
- 回跳：`/auth/login?returnTo=` 仅允许同源相对路径（`safeReturnTo` 白名单，防开放重定向）。
- 文件：`auth.controller.ts` / `oidc.service.ts` / `session.service.ts` / `user.service.ts` / `auth.guard.ts` / `csrf.guard.ts` / 两个 repository；四层结构与 index 出口约定见 `server/README.md`。
- 用户偏好（A4 / A24 · Push 169）：`GET / PATCH /api/v1/users/me/preferences` —— 落 `user_preferences`（迁移 `0028_user_preferences.sql`，`user_id` 主键一人一行、`prefs` jsonb 默认 `{}`、`updated_at`）；GET 无记录 = 默认值 + `updatedAt: null`，PATCH **合并语义**（只传变更键 / 数组键整体替换 / 未声明键保留）+ `CsrfGuard`；**只读写会话 actor 自己那一行**；读侧规范化（坏条目丢弃 / id 去重 / 名称截断 20 / 非法日期置 null / ≤ 20 组）在服务层，偏好属界面状态**不写审计**；`taskTableHiddenColumns` 为枚举白名单（`TaskTableColumnKey` = 前端 `TABLE_COLUMNS` 非锁定列；未知 key 400，读侧白名单外一律丢弃）；`focusMode` 为布尔（A4 §6.13 醒目模式 · Push 171；读侧非布尔回 false）；实现 `user-preference.repository.ts`（读一行 / `onConflictDoUpdate` 覆盖写）+ `user-preference.service.ts`，单测 `test/user-preferences.test.ts`（11 例：合并语义 / 读侧规范 / 上限 / 白名单 / 醒目模式布尔与收敛）。

## 已实现（h1 · S6·identity/org）

- 数据面（迁移 `0007_identity_org.sql` + `0008_identity_removed.sql` + Drizzle 同步）：`departments`（部门树；`source_id` 唯一，缺失不删只停用）、`roles`（六个内置角色 + `data_scope`）、`role_permissions`（功能权限位结构）、`user_roles`（用户 ↔ 角色绑定）、`users.removed_at`（delete 软删标记）；`npm run check:db-schema` 通过（18 张表 / 188 列 / 50 索引 / 47 CHECK）。
- 种子：`database/seeds/roles.mjs`（一期六角色：admin / project_manager / task_owner / project_member / sales / viewer，upsert 幂等）+ `database/scripts/seed.mjs`（`--dry-run` / `--only=<name>`；与迁移分界见 `database/seeds/README.md`）。
- 出口一：`DepartmentService.listDepartments()` —— 默认只返回 active、按名称升序，`parentId` 供消费方组树（v0.2 §1.2）。
- 出口二：`RoleService.getActorAuthorization(userId)` —— 授权画像 = 角色码 + 数据范围并集（由宽到窄：`all` > `managed_projects` > `involved_projects` > `own_stakeholders` > `granted`）+ 功能权限位并集；`assignRole` / `revokeRole` 幂等，未知角色码 404。
- 出口三：`OrgSyncService.applySnapshot(snapshot)` —— 部门树父先于子 upsert、快照缺失的在编部门停用、用户按 casdoor_id upsert、目录判定离职 → 置 disabled + 撤销该用户全部在线会话；产出差异报告（created / updated / disabled / sessionsRevoked / unresolvedParents / missing）。`missingUserPolicy: "disable"`（离职回收闭环）带安全阀：缺失在职用户超过 max(3, 在职 × 20%) 只报告不执行。
- 单测：`test/identity-org.test.ts` —— 六角色数据范围用例（h1 验收项）+ 组织同步差异语义（父序解析 / 重命名 / 缺失停用 / 离职踢线 / 复职 / 安全阀 / 成环与重复报错）；`test/identity-internal.test.ts` —— h1 收口（离职回收三动作 / 幂等 / email 兜底 / 常量时间凭证比较 / Casdoor 适配器分页与归一化 / 用户目录查询）；均不连库。
- 口径：权限判定只在服务端（ADR-011）；本模块只产授权画像，`can / buildScopeWhere / fieldPolicy / exportPolicy` 由 h6 策略服务消费。
- 出口四（h1 收口）：`GET /api/v1/users` —— 用户目录（A2；首个 `/api/v1` 业务路由）。SessionGuard 已登录全员可读、只返回启用用户、`q` 命中工号 / 姓名 / 邮箱、默认工号升序（分页不跳行）；契约 `shared/src/modules/users.ts`（Push 49）。
- 离职回收 API（h1 收口 · 接入标准第五部分）：`POST /internal/users/{disable,enable,delete}`（根路径 + `X-Internal-Token` 常量时间比较；name 为准 / email 兜底；幂等 200 —— 目录中不存在也成功）。disable / delete 撤销全部在线会话（响应 `affectedSessions`）；delete 为软删（`removed_at` + `status=disabled`，不物理删行），enable 清 `removed_at` 恢复 active（不恢复旧会话）。迁移 `0008_identity_removed.sql`；`INTERNAL_SYNC_TOKEN` 未配置一律 401（生产启动强制非空）。
- 目录适配器（h1 收口 · D1-02）：`CasdoorDirectorySource.pull()` —— Casdoor 管理 API（`/api/get-users` 分页 + `/api/get-groups`）→ `OrgDirectorySnapshot`；`isForbidden` / `isDeleted` → disabled、脏行跳过、重复页去重保护、非 ok 响应抛错不静默；`POST /internal/org-sync/run` 手动触发一次拉取 + 差异应用（默认 `missingUserPolicy=report`，运维显式 `disable` 才执行缺失禁用）。定时调度随 i5 接 worker（复用本类 + `OrgSyncService`）。

## 边界与后续

- 不做：密码 / 本地账号兜底、正式环境 Casdoor 配置核对（g7，px）、离职用户物理删除（delete 为软删留痕；物理删除待数据留存口径确认后另起迁移）。前端会话切换（k6）已于 Push 46 合入，`/auth/*` 由本模块独立承载。
- 待接：① Casdoor 定时调度（周期拉取）随调度卡片（i5）接入 worker —— 适配器 / 差异引擎已就绪（`CasdoorDirectorySource` + `OrgSyncService`）；② 企微侧适配器（企微通讯录 API → 同一 `OrgDirectorySnapshot` 形状）随企微打通卡片（与 PoC-2 同批）；③ `role_permissions` 矩阵条目随 h6（PoC-6 权限矩阵与脱敏五出口）；④ 人员 ↔ 部门映射（多部门 / 兼职）随 D1-06 与同步 payload 确认另起迁移；⑤ 组织 / 角色管理端点随 C3-09 / D1-06 管理界面（u3 / u12）；⑥ 离职回收 / 同步动作的审计留痕（audit_logs）随 h7；⑦ Casdoor 管理 API 字段核对（group.parentId / isTopGroup 等）随 g7 正式环境演练。
- 过期会话清理（物理删除）随 worker / jobs 卡片；当前以 `revoked_at` + `expires_at` 索引支撑。
- 首任系统管理员授权：`RoleService.assignRole(userId, "admin")`（运维执行，不写死种子）。
