/**
 * 添加任务链路上的「节点 / 模板条目」形状（Push 182 起 = 接口条目的最小公约数）。
 *
 * **本文件不再携带写死的模板预设内容**：
 * - 「任务节点」= 节点库接口条目（Push 181：`GET /api/v1/task-nodes?stage=`，`frontend/src/templateApi.ts` 的 `TaskNodeItem`）；
 * - 「模板」= 模板接口条目（Push 182：`GET /api/v1/task-templates?stage=`，`TemplateItem`）—— 原来的 `STAGE_TEMPLATE_PRESETS`
 *   已由种子 #9 灌进库（`database/seeds/task-templates.mjs` → `task_templates` / `task_template_nodes`），
 *   内容改在任务模板页维护（`PlaceholderPage.tsx`），添加任务卡片（`components/StageAddCard.tsx`）与两块看板都吃接口。
 *
 * 保留本类型是为了让 TaskBoard / TaskKanban / ProjectDetail 这几处只管「标题 + 英文名 + 判重键」的链路不绑死某个具体来源 ——
 * 接口条目的 id（节点库 UUID / 模板 UUID）与 version 字段在这里都用不到。
 */
export type TemplatePresetNode = {
  id: string;
  title: string;
  titleEn: string;
};
