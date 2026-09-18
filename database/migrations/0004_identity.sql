-- LibiaoLink · 0004 identity（users / sessions）
-- 依据：ADR-010（SSO-only 登录；会话在 PostgreSQL；生产用 HttpOnly Cookie + CSRF 同步 Token）
--   + docs/开发者接入注意事项(SSO接入标准).md（应用侧会话超时自控；登出同清 SSO 会话）。
-- 约定：不存原始凭据 —— 会话 Cookie 值只存 sha256 哈希；id_token 仅用于单点登出（id_token_hint）；
--   不存 refresh_token / access_token / client_secret。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。

create table users (
  id uuid primary key default gen_random_uuid(),
  casdoor_id text not null unique,            -- Casdoor 用户 ID（claims.id；登录 upsert 的唯一键）
  username text not null unique,              -- 工号（claims.name；缺省回退 claims.id）
  display_name text not null,                 -- 姓名（claims.displayName；缺省回退 username）
  email text,
  owner text,                                 -- 所属组织（claims.owner）
  status text not null default 'active',      -- active | disabled（离职回收由 h1 组织同步维护）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_users_status check (status in ('active','disabled'))
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,            -- sha256(会话令牌)；原始值只存在于用户浏览器 Cookie
  user_id uuid not null references users(id) on delete cascade,
  id_token text not null,                     -- 仅用于 Casdoor /api/logout 的 id_token_hint（服务端专用，不外发）
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),  -- 空闲超时判定基准（SESSION_IDLE_MINUTES）
  expires_at timestamptz not null,            -- 绝对上限：登录时取 ID Token exp（g7 收紧建议 8~12h）
  revoked_at timestamptz,                     -- 登出 / 禁用 / 超时后置位（软删，留排查线索）
  constraint ck_sessions_expires check (expires_at > created_at)
);

create index ix_sessions_user on sessions (user_id, expires_at desc);
create index ix_sessions_expiry on sessions (expires_at);
