-- LibiaoLink · 0027 预览产物表 + 审计动作扩值（M4-05 预览管道 · 数据层切片 · Push 165；编号两度顺延：原取 0022 → 撞 0022_task_soft_delete；改取 0024 → 撞主线先入的 0024_drop_tasks_legacy_order_index / 0025_priority_three_levels / 0026_priority_foldback_four_quadrants → 定为 0027）
-- 口径来源：系统功能书 D2-01~D2-07 / A4-11（在线预览）、技术设计v0.3 §3.5（M4-05 卡片与「新增表 preview_artifacts」）、
--   ADR-007（预览管道：缓存键 = 内容哈希 + pipelineVersion + target 三元组）、ADR-006（对象键形态）、
--   契约 shared/src/modules/files.ts（PREVIEW_TARGETS / PREVIEW_STATUSES / FilePreviewResponse）、
--   shared/src/modules/audits.ts（AUDIT_ACTIONS 含 preview —— D2-07 预览计入查看 / 下载审计；并含 download —— Push 160 定案 · A4-10）。
-- 口径：
--   1. 三元组唯一（content_hash + pipeline_version + target）= D2-06「同一文件只转换一次」的落点：
--      同内容换版本（回溯 / 变更）或多文件同内容都命中同一行，不重复转换；转换器实现 / 参数 / 模板 / 字体 /
--      兜底策略变化 → pipeline_version 递增 → 缓存整体失效、按需重转（ADR-007）。
--   2. content_hash 冗余自 file_versions（同一版本内容哈希）：唯一键不能跨表；由写入方（转换编排，M4-05b）同事务落，
--      与 file_versions.content_hash 保持一致。
--   3. file_id / version_id = 首次生成该产物的版本（登记 + 引用判定用）；读面按三元组命中（不按版本命中），
--      清理（彻底删除 / 回收站到期）须先按 content_hash 反查是否还有其它版本引用，无剩余引用才清对象与行。
--   4. 状态机 not_ready → ready / failed（值集与契约 PREVIEW_STATUSES 同值同序）：not_ready = 已请求未就绪
--      （生成任务由 outbox 重试兜底，不在本表记进度）；ready 与 object_key / generated_at 成对，failed 与 error 成对
--      （口径同 files 的成对字段）；failed 是缓存态 —— 管线修复后由 pipeline_version 递增失效，不做原地重试。
--   5. 审计：ck_audit_logs_action 由八值**一次扩为十值**（新增 preview —— D2-07；新增 download —— Push 160 定案 · A4-10
--      离线下载受权限控制并记日志）；两值与契约 AUDIT_ACTIONS 同序（preview 在前、download 紧随其后）；只扩值、不改列，回滚见文末。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限；新表权限由 roles/0001 的 default privileges 自动授予。
-- 回滚（如需）：
--   ① 审计动作回九值（只撤 download，本迁移前另有 preview 时的形态）：
--      alter table audit_logs drop constraint ck_audit_logs_action,
--        add constraint ck_audit_logs_action check (action in ('create','update','delete','progress','complete','advance','rollback','preview','deny'));
--      再回一步为八值（本迁移前的主线值集）：去掉 'preview' → ('create','update','delete','progress','complete','advance','rollback','deny')。
--   ② drop table preview_artifacts;（索引与 CHECK 随表消失）

create table preview_artifacts (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  version_id uuid not null references file_versions(id) on delete cascade,
  content_hash text not null,
  target text not null,
  pipeline_version text not null,
  status text not null default 'not_ready',
  object_key text,
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_preview_artifacts_cache_key unique (content_hash, pipeline_version, target),
  constraint ck_preview_artifacts_target check (target in ('pdf','image','structured')),
  constraint ck_preview_artifacts_status check (status in ('ready','not_ready','failed')),
  constraint ck_preview_artifacts_ready_pair check ((status = 'ready') = (object_key is not null and generated_at is not null)),
  constraint ck_preview_artifacts_failed_pair check ((status = 'failed') = (error is not null)),
  constraint ck_preview_artifacts_error_length check (error is null or char_length(error) <= 500)
);
create index ix_preview_artifacts_version on preview_artifacts (version_id, target);
create index ix_preview_artifacts_file on preview_artifacts (file_id);

-- 审计动作扩值（D2-07 预览计入查看 / 下载审计 + Push 160 定案 · A4-10 离线下载受权限控制并记日志）：
-- CHECK 不支持追加取值 → drop + 重建；一次扩两值（八值 → 十值）；
-- 值集与契约 AUDIT_ACTIONS 同序同值（一致性由 server/test/schema-literals-parity.test.ts 守护）。
alter table audit_logs drop constraint ck_audit_logs_action;
alter table audit_logs add constraint ck_audit_logs_action
  check (action in ('create','update','delete','progress','complete','advance','rollback','preview','download','deny'));