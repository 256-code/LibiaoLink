-- LibiaoLink · 0014 工作日历（h8 · S6·工作日历 · D5）
-- 口径来源：系统功能书 D5-01（日历维护：管理员维护节假日、调休安排）、D5-02（顺延规则：提醒日期落在节假日时
--   按规则顺延，可配置）、D5-03（T-1/T+1 计算：为规则引擎提供日期计算依据，如「前 1 天 08:00」）；
--   技术设计v0.1 §4 时间语义（节假日 / 调休日历参与顺延判断；T-1/T+1 以任务当前日期实时求值，改期后重算）；
--   技术设计v0.3 §4.7（存 UTC、展示与业务计算按 Asia/Shanghai；规则禁止直接取系统时间）。
-- 设计要点：
--   1. 只存「例外」：calendar_days 记录 holiday（放假：法定节假日与调休放假）与 makeup_workday（调休上班：周末补班）。
--      未登记的日期按默认规则判定（周一至周五 = 工作日、周六周日 = 非工作日），不落 365 行 / 年，改年历只增删例外。
--   2. 顺延规则可配置（D5-02）：calendar_settings 单行配置（reminder_shift_enabled / shift_direction）——
--      forward = 顺延到之后最近工作日，backward = 提前到之前最近工作日；提醒日期落在非工作日时按此执行。
--   3. T-1/T+1 不落表：由查询侧按「自然日偏移 + 可选顺延 + 可配时刻（Asia/Shanghai）」实时求值（D5-03）。
--   4. 维护动作写审计留痕（audit_logs.object_type = calendar_day / calendar_settings，h7 的 audit_logs 为自由文本对象类型，无需改表）。

create table calendar_days (
  date date primary key,
  day_type text not null,
  name text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id),
  constraint ck_calendar_days_day_type check (day_type in ('holiday', 'makeup_workday')),
  constraint ck_calendar_days_date check (date between date '2000-01-01' and date '2100-12-31'),
  constraint ck_calendar_days_name check (name is null or char_length(btrim(name)) between 1 and 80),
  constraint ck_calendar_days_note check (note is null or char_length(btrim(note)) between 1 and 200)
);
create index ix_calendar_days_type on calendar_days (day_type, date);

create table calendar_settings (
  id boolean primary key default true,
  reminder_shift_enabled boolean not null default true,
  shift_direction text not null default 'forward',
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id),
  constraint ck_calendar_settings_single check (id),
  constraint ck_calendar_settings_direction check (shift_direction in ('forward', 'backward'))
);
-- 单行配置：迁移即建默认行（幂等），保证读路径永远有配置可读。
insert into calendar_settings (id) values (true) on conflict (id) do nothing;

comment on table calendar_days is '工作日历例外（D5-01）：holiday 放假 / makeup_workday 调休上班；未登记日期按默认规则（周一至周五工作日、周六周日非工作日）';
comment on table calendar_settings is '顺延规则配置（D5-02，单行）：提醒日期落在非工作日时是否顺延与顺延方向';

grant select, insert, update, delete on table calendar_days to libiaolink_api;
grant select, insert, update, delete on table calendar_settings to libiaolink_api;
grant select on table calendar_days to libiaolink_readonly;
grant select on table calendar_settings to libiaolink_readonly;
