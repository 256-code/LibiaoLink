# identity 模块（g6 · S5·会话后端化 已落地）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | SSO 接入、会话、用户与角色（组织 / 通讯录同步见 h1） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | getUser、SessionGuard + CurrentUser、CsrfGuard、revokeAllForUser |

## 已实现（g6）

- 路由（根路径，不进 /api/v1）：`GET /auth/login`、`/auth/callback`、`/auth/me`、`/auth/logout`（ADR-010；OIDC authorization_code + PKCE + state）。
- 会话：HttpOnly Cookie `ll_sid`（PostgreSQL `sessions` 表只存 sha256 哈希）；空闲超时 `SESSION_IDLE_MINUTES`（默认 30 分钟，接入标准「企业内部系统」档）；绝对上限取 ID Token `exp`；命中后 `last_seen_at` 按 60s 节流刷新。
- 单点登出：撤销本地会话 + 302 到 Casdoor `/api/logout`（携 `id_token_hint`，仅存于服务端会话行）。
- 用户：登录时按 `claims.id` upsert `users`（工号 `claims.name`、姓名 `claims.displayName`）；禁用账号登录 403、已登录会话被踢（`revokeAllForUser`）。
- CSRF：登录下发可读 Cookie `ll_csrf`；写接口叠加 `CsrfGuard`（回传 `X-CSRF-Token`），h2 起随业务接口启用。
- 回跳：`/auth/login?returnTo=` 仅允许同源相对路径（`safeReturnTo` 白名单，防开放重定向）。
- 文件：`auth.controller.ts` / `oidc.service.ts` / `session.service.ts` / `user.service.ts` / `auth.guard.ts` / `csrf.guard.ts` / 两个 repository；四层结构与 index 出口约定见 `server/README.md`。

## 边界与后续

- 不做：密码 / 本地账号兜底、角色与组织同步（h1）、前端会话切换（k6，px）、正式环境 Casdoor 配置核对（g7，px）。
- 过期会话清理（物理删除）随 worker / jobs 卡片；当前以 `revoked_at` + `expires_at` 索引支撑。
