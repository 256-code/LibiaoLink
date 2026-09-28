-- LibiaoLink · 0039 调度面：jobs（定时 / 单例任务定义与状态）+ job_runs（执行 / 跳过 / 失败留痕）（S7·outbox · S7-3 · i11 / M5-02 · lan）
-- 口径来源：技术设计v0.2-架构与数据模型.md §6.2（调度：worker 单例 advisory lock；记录 last_run_at；重启或错过窗口按应执行清单补发）、
--   ADR-005（任务定义入 DB、每分钟 tick、单活调度器、错过补发；pg_advisory_lock 选主）、
--   技术设计v0.3-实施与验收.md §「平台表」（jobs：kind / run_at / cron / last_run_at / status / locked_by —— 定时 / 单例任务）。
-- 口径：
--   1. jobs 一行 = 一个定时（cron 五段，Asia/Shanghai · ADR-028）或一次性（cron is null）任务；kind ↔ worker 生产者注册表
--      （注册表为空 = 只存不跑 —— 与 outbox「只投递不消费」同形的排障态）。
--   2. run_at = 下次应执行时刻（cron 任务执行后推进到下一触发时刻；一次性任务置 done 后不再领取）；last_run_at = 上次成功
--      执行时刻，补发窗口 = (last_run_at, now]，超出补发跨度上限（OUTBOX_SCHEDULER_CATCHUP_MAX_DAYS，默认 7 天）的区间只记 skipped 留痕。
--   3. 领取口径与 outbox_events 一致：单条语句 for update skip locked；locked_at 超阈值视为崩溃遗留可重领（OUTBOX_STALE_MS）。
--      「产出 + last_run_at 推进」在同一事务内（生产者拿事务句柄写 outbox）—— 崩溃回滚后重领不产生重复产出；
--      即使重放，同一窗口的产出由幂等执行键（outbox_events.dedupe_key 唯一约束）兜底不重发。
--   4. job_runs 是调度留痕：executed（窗口 / 触发次数 / 产出条数）/ skipped（超补发跨度的区间）/ failed（重试到顶）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。
-- 回滚（如需）：
--   drop table if exists job_runs;
--   drop table if exists jobs;

create table jobs (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  cron text,
  run_at timestamptz not null,
  last_run_at timestamptz,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_jobs_status check (status in ('pending', 'done', 'failed')),
  constraint ck_jobs_cron check (cron is null or cron ~ '^\S+( \S+){4}$'),
  constraint ck_jobs_attempts check (attempts >= 0)
);

create index ix_jobs_due on jobs (run_at) where status = 'pending';
create index ix_jobs_locked on jobs (locked_at) where status = 'pending' and locked_at is not null;

create table job_runs (
  id bigserial primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  kind text not null,
  status text not null,
  window_from timestamptz not null,
  window_to timestamptz not null,
  fire_count integer not null default 0,
  produced integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  constraint ck_job_runs_status check (status in ('executed', 'skipped', 'failed')),
  constraint ck_job_runs_fire_count check (fire_count >= 0),
  constraint ck_job_runs_produced check (produced >= 0)
);

create index ix_job_runs_job on job_runs (job_id, created_at);