-- LibiaoLink · 0028 用户级 UI 偏好表（A4 任务表列显隐 / A24 常用筛选跨设备记忆 · Push 169）
-- 口径来源：契约 shared/src/modules/users.ts（UserPreferencesSchema / UserPreferencesUpdateBodySchema /
--   SavedHomeFilterSchema）、前端功能需求.md §3.1 #15 / #23、§3.8 A24、系统功能书 C9-02（偏好不属于字典口径）。
-- 口径：
--   1. 一人一行（user_id 主键）：偏好是「单人单写者」的界面状态，多端并发以最后一次写入为准，不需要版本号（契约注释）。
--   2. prefs 为 jsonb 对象：PATCH 合并语义在服务端做（只传变更键、数组键整体替换、未声明键原样保存 ——
--      新增偏好键不必改契约即可前向兼容）；jsonb_typeof 非 object 一律拒绝，避免把数组 / 标量写进来。
--   3. 一期的声明键：taskTableHiddenColumns（任务表列显隐 · A4）、homeSavedFilters（常用筛选组合 · A24，≤ 20 组）。
--   4. 随用户行级联：users 是软删（removed_at），真删用户时偏好一并清掉。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限；新表权限由 roles/0001 的 default privileges 自动授予。
-- 回滚（如需）：drop table user_preferences;（表内只有 UI 偏好，无业务数据依赖）

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint ck_user_preferences_prefs_object check (jsonb_typeof(prefs) = 'object')
);
