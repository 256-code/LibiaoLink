-- LibiaoLink · 0031 任务状态显式覆盖（五态可选）+ 紧急重要度回三档（2026-09-24 业务定案 · 承接 M3-07 前端联调）
-- 口径来源：业务 2026-09-24 定案 —— ①「状态下拉都要有 要5态 但是他们的逻辑要和之前的一样」；
--   ②「紧急重要度 和前端一致只有三档」；③ 汇总卡「当前阶段」下线，改「最慢阶段 / 最新阶段」两字段（契约本刀同步）。
--   1. tasks.status_override（text，可空）：五态下拉里的「已延期（overdue）/ 提前完成（early_done）」显式覆盖值 ——
--      原型 frontend/src/data/tasks.ts 的 statusOverride 落库版。读时优先规则（task.rules.ts）：overdue 仅在未完成时生效、
--      early_done 仅在已完成时生效，其余回落读时派生（A12 / A14）；展示态派生结果本身仍不写回。
--      清除时机：写进度（PATCH …/progress）、写基础三态（pending / active / done）、完成门禁通过 —— 任一发生即置 null。
--   2. 紧急重要度回三档「高 / 中 / 低」：契约 shared/src/common/dicts.ts 的 PRIORITY_VALUES 同步（四象限口径作废）。
--      存量折算（一次性、幂等）：重要且紧急 → 高；重要不紧急 / 紧急但不重要 → 中；不紧急不重要 → 低。
--      折算有损（三档回不到四象限），不提供自动回滚；如需回退请从备份恢复 —— 与 0025 / 0026 同一口径（0025 折三档、0026 回折四象限，本次按 2026-09-24 定案再折三档）。
--   3. tasks.priority 是 text（无 CHECK、无枚举类型），优先级部分**无 DDL**、只改存量值；本次 DDL 只有 status_override 一列 + 一条 CHECK。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限；列级权限随表级 GRANT 生效，无需额外授权。
-- 回滚（如需）：update tasks set priority = case priority when '高' then '重要且紧急' when '中' then '重要不紧急' when '低' then '不紧急不重要' end where priority in ('高', '中', '低');
--   alter table tasks drop constraint ck_tasks_status_override, drop column status_override;
alter table tasks
  add column status_override text;

alter table tasks
  add constraint ck_tasks_status_override check (status_override is null or status_override in ('overdue', 'early_done'));

update tasks
   set priority = case priority
     when '重要且紧急' then '高'
     when '重要不紧急' then '中'
     when '紧急但不重要' then '中'
     when '不紧急不重要' then '低'
   end
 where priority in ('重要且紧急', '重要不紧急', '紧急但不重要', '不紧急不重要');
