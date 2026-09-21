-- LibiaoLink · 0016 file_links 多态关联（M4-03 · S7·file）
-- 依据：技术设计v0.2 §5.1-5.4、技术设计v0.3 §3.5（M4-03 卡：file_links —— file_id、object_type
--   （project / task / node / report / issue / change）、object_id）；系统功能书 A4-01 / A4-03 / A4-09
--   （上传成功即写入文件库并建立关联；一处关联多处可见、支持双向跳转）。
-- 口径：
--   1. file_links = 文件的多态关联索引。object_id 无外键（多态无法约束到单表），归属校验由应用层
--      按 object_type 执行（如 task / node 必须属于同一 project，见 file 模块 repository）；
--   2. 唯一（file_id, object_type, object_id）：重复写入幂等（insert ... on conflict do nothing）；
--   3. 文件彻底删除时级联清关联（on delete cascade）；report / issue / change 关联随对应模块落地后写入
--      （本卡写入 project / node / task 三类）；
--   4. 反查索引（object_type, object_id）：从任务 / 节点 / 日报 / 问题 / 变更侧查文件（双向跳转）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。

create table file_links (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  object_type text not null,                  -- project | task | node | report | issue | change
  object_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint ck_file_links_object_type check (object_type in ('project','task','node','report','issue','change')),
  constraint uq_file_links_file_object unique (file_id, object_type, object_id)
);

create index ix_file_links_object on file_links (object_type, object_id);
