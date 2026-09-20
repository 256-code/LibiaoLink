-- LibiaoLink · 0006 幂等键（platform）
-- 依据：技术设计v0.2 §1.3（事务、一致性与幂等）、§11.1（platform：idempotency_keys）；
--   契约：写接口统一携带 Idempotency-Key 头（shared/src/common/conventions.ts），重放返回首次结果并记 IDEMPOTENT_REPLAY（v0.2 §7.2）。
-- 口径：
--   1. 只存 sha256(key)，不落原值（与 sessions.token_hash 同口径）。
--   2. 作用域 = 调用方（actor_id）+ 接口指纹（route），防跨接口 / 跨用户重放。
--   3. request_hash = 规范化请求体哈希：同一 Key 携带不同请求体时拒绝（冲突）。
--   4. 记录按 expires_at 清理（保留期由应用配置，建议 ≥ 24h）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。

create table idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  route text not null,                        -- 接口指纹（如 POST /api/v1/files/uploads）
  key_hash text not null,                     -- sha256(Idempotency-Key)
  request_hash text not null,                 -- sha256(规范化请求体)
  status text not null default 'in_progress', -- in_progress | completed
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint ck_idempotency_keys_status check (status in ('in_progress','completed')),
  constraint ck_idempotency_keys_expires check (expires_at > created_at),
  constraint ck_idempotency_keys_response check ((status = 'completed') = (response_status is not null)),
  constraint ck_idempotency_keys_hashes check (key_hash ~ '^[0-9a-f]{64}$' and request_hash ~ '^[0-9a-f]{64}$'),
  unique (actor_id, route, key_hash)
);

create index ix_idempotency_keys_expiry on idempotency_keys (expires_at);
