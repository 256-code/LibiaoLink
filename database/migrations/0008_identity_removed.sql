-- LibiaoLink · 0008 identity/removed（users.removed_at：离职回收 delete 标记）
-- 依据：docs/开发者接入注意事项(SSO接入标准).md 第五部分（权限回收：disable / enable / delete，
--   X-Internal-Token 固定头 + 幂等 + 必须踢在线会话）；h1 · S6·identity/org 收口（内部离职回收 API）。
-- 口径：
--   1. removed_at：仅在 delete 动作时置位（目录源已删除该用户）；disable / enable 不改动该列。
--   2. 不物理删除用户行：历史引用与审计需要保留；复职 / 重建目录时以 SSO 与目录同步为准（enable 清空该列）。
--   3. status 语义不变（active | disabled）；delete 同时置 status = disabled 并撤销全部在线会话。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新列权限随表默认权限（roles/0001）。

alter table users add column removed_at timestamptz;
