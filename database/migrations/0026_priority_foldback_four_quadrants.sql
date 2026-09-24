-- LibiaoLink · 0026 紧急重要度回折四象限（Push 164 · px 线：整体回退到 Push 159 状态）
-- 口径来源：Push 159 版契约 shared/src/common/dicts.ts 的 PRIORITY_VALUES（四象限）与前端功能需求.md / 字段对照清单.md 的 Push 159 版口径；
--   Push 163 的三档收敛（0025）随本刀一并撤回。
--   1. 背景：Push 163 曾按「字段口径以前端页面为准」把契约与库值收敛为三档「高 / 中 / 低」（0025）；
--      Push 164 按业务口径整体回退到 Push 159 —— 契约回到四象限、库值同步回折。
--   2. 回折映射（一次性、幂等）：高 → 重要且紧急；中 → 重要不紧急；低 → 不紧急不重要。
--      **回折有损**：三档的「中」区分不了「重要不紧急」与「紧急但不重要」（0025 已把两者合并为「中」），
--      本次统一回折为「重要不紧急」（业务默认：中优先级 = 重要但不紧急的常规推进项）；如需精确还原请从备份恢复。
--   3. tasks.priority 是 text（无 CHECK、无枚举类型），本次**无 DDL**、只改存量值；应用角色权限不变。
update tasks
   set priority = case priority
     when '高' then '重要且紧急'
     when '中' then '重要不紧急'
     when '低' then '不紧急不重要'
   end
 where priority in ('高', '中', '低');
