-- LibiaoLink · 0005 file 生命周期与上传会话
-- 依据：技术设计v0.2 §5.1-5.3（对象键 / 五态状态机 / 变更即通过）、§11.2（files 增列：回收站到期 purge_after，A4-12）、
--   §11.1（upload_sessions：分片上传）；契约 = shared/src/modules/files.ts（File / FileVersion / UploadSession）。
-- 口径：
--   1. 定档（final）后不覆盖内容，版本链只追加；定档 / 回收站字段成对写入（时间与操作人同时有值）。
--   2. 回收站默认保留 30 天：进入时写 recycled_at 与 purge_after（= recycled_at + 保留期）；恢复时三列清空。
--   3. 分片状态以对象存储 ListParts 为唯一真相，不落 upload_parts 表（避免双写漂移；见 database/README.md）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。

-- 1) files：定档 / 回收站 / 到期清理
alter table files
  add column finalized_at timestamptz,
  add column finalized_by uuid,
  add column recycled_at timestamptz,
  add column recycled_by uuid,
  add column recycled_from_status text,
  add column purge_after timestamptz;

alter table files
  add constraint ck_files_finalized_pair check ((finalized_at is null) = (finalized_by is null)),
  add constraint ck_files_recycled_pair check ((recycled_at is null) = (recycled_by is null) and (recycled_at is null) = (recycled_from_status is null)),
  add constraint ck_files_recycled_from_status check (recycled_from_status is null or recycled_from_status in ('draft','final','changed','archived'));

create index ix_files_purge on files (purge_after);

-- 2) upload_sessions：分片直传会话（api 只签名与登记元数据，不代理文件流量）
create table upload_sessions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  intent text not null,                       -- version（草稿期新增 / 替换）| change（定档后变更，change_payload 必填）
  status text not null default 'active',      -- active | completed | aborted | expired
  object_key text not null,                   -- 目标对象键（v0.2 §5.1；完成时回写 file_versions.object_key）
  storage_upload_id text,                     -- 对象存储 multipart UploadId（首次取分片 URL 时登记）
  part_size_bytes integer not null,
  total_parts integer not null,
  size_bytes bigint not null,
  content_hash text,                          -- 客户端 init 提供（可空）；complete 回传值与其比对
  mime text,
  change_payload jsonb,                       -- intent=change 的变更申请（reason / beforeSummary / afterSummary / stageKey）
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,            -- 会话有效期：过期不可续传，需重建（契约 UploadSession.expiresAt）
  completed_at timestamptz,
  aborted_at timestamptz,
  constraint ck_upload_sessions_intent check (intent in ('version','change')),
  constraint ck_upload_sessions_status check (status in ('active','completed','aborted','expired')),
  constraint ck_upload_sessions_part_size check (part_size_bytes > 0),
  constraint ck_upload_sessions_total_parts check (total_parts between 1 and 10000),
  constraint ck_upload_sessions_size check (size_bytes >= 0),
  constraint ck_upload_sessions_expires check (expires_at > created_at),
  constraint ck_upload_sessions_change_payload check ((intent = 'change') = (change_payload is not null))
);

create index ix_upload_sessions_file on upload_sessions (file_id, status);
create index ix_upload_sessions_expiry on upload_sessions (status, expires_at);
