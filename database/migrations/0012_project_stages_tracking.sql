-- LibiaoLink · 0012 project_stages 推进 / 回退留痕（h3 · S6·blueprint/node：M2-03 阶段推进）
-- 口径来源：ADR-023（手动推进 + 门禁 + 缺项明细；回退限相邻上一阶段且原因必填）、v0.2 §11.2（A1-12）。
--   1. advanced_at / advanced_by：最近一次推进（pending → done）的时间与操作人。
--   2. rolled_back_at / rolled_back_by / rollback_reason：最近一次回退（done → active 还原）的时间、操作人与原因。
--   3. 追加列、不重写既有数据；回填随使用自然产生（历史行为无留痕 = null）。

alter table project_stages
  add column advanced_at timestamptz,
  add column advanced_by uuid,
  add column rolled_back_at timestamptz,
  add column rolled_back_by uuid,
  add column rollback_reason text;
