/**
 * 内置规则定义与逐字文案模板（M5-01 内核切片 + M5-05 余项 · A 系列 · Push 163）。
 * 逐字基准：docs/rules/R01-R07-内置规则文案.md（R01 ~ R07，需求说明书原文逐字）、
 *   docs/rules/A01-A03-A14-扩展规则文案.md（A01 / A02 / A03 / A14 —— 原文未给逐字文案：该文档为建议稿 + 待确认清单）。
 * 口径来源：系统功能书 C2-02 / C2-04 / C2-11 / A3-14 / A6-05 / A7-03 / A7-05、技术设计v0.2 §6.1、
 *   ADR-026（A03：T+1 提醒责任人 / T+3 升级项目经理）、ADR-028（时区）。
 * 说明：R01 无通知动作（落点 = 变更生效事务内同事务回写 tasks.change_refs，见 M4-04），故不在引擎规则集内；
 *   其余十条为引擎可执行规则：R02 / R06 事件型（主体 = 任务），R03 / R04 / R05 / R07 任务调度型，
 *   A01 / A02 / A03 / A14 主体调度型（主体类型见 BUILTIN_RULE_SUBJECT_KINDS）。
 */
import type { AutomationMessageTemplate, AutomationRule } from "@libiaolink/contracts";
import type { ReplaySubjectKind } from "./automation.rules.js";

/** R01 说明（非引擎规则：无消息文案）。 */
export const R01_NOTE =
  "R01 变更文件自动关联：无通知动作，落点 = 变更生效事务内同事务回写任务变更关联（M4-04 / Push 121）；金标 = 多值命中全部关联 + 重复变更不重复关联。";

/** 逐字文案模板（键 = 动作 template 码；同一文案多渠道各自一条，便于渠道差异化后续扩）。 */
export const BUILTIN_MESSAGE_TEMPLATES: readonly AutomationMessageTemplate[] = [
  {
    code: "R02_INBOX",
    title: "及时添加文件",
    body: "请为项目任务{任务描述}及时添加成果文件",
  },
  {
    code: "R02_WECOM",
    title: "及时添加文件",
    body: "请为项目任务{任务描述}及时添加成果文件",
  },
  {
    code: "R03_GROUP",
    title: null,
    body: "hello，{任务负责人}，你的任务{任务描述}还有1天就要截止了，快加加油，尽快追上进度吧！",
  },
  {
    code: "R04_GROUP",
    title: "有新任务已到启动时间",
    body: "{任务负责人}你好呀，你的任务{任务描述}已到启动时间，快查看任务详情吧~今日工作加油",
  },
  {
    code: "R05_GROUP",
    title: "！任务超时提醒",
    body: "hello，{任务负责人}，你的任务{任务描述}已经超时一天了，快加加油，尽快追上进度吧！",
  },
  {
    code: "R06_GROUP",
    title: "叮咚~喜报来啦！",
    body: "恭喜{任务负责人}成功拿下一项重要任务：{任务描述}。大家一起为这位优秀的伙伴喝彩吧",
  },
  {
    code: "R07_APP",
    title: "重点任务提醒",
    body: "以下重点任务正在进行中：{任务描述}请关注并及时推进任务~",
  },
  {
    code: "R07_APP_MERGED",
    title: "重点任务提醒",
    body: "以下重点任务正在进行中：{任务清单}请关注并及时推进任务~",
  },
  {
    code: "A01_INBOX_MERGED",
    title: "请及时填写今日日报",
    body: "你今天还有日报未提交：{项目清单}请尽快填写，辛苦啦！",
  },
  {
    code: "A01_WECOM_MERGED",
    title: "请及时填写今日日报",
    body: "你今天还有日报未提交：{项目清单}请尽快填写，辛苦啦！",
  },
  {
    code: "A02_GROUP",
    title: "日报汇总 | {项目名}（{日期}）",
    body: "今日 {提交人数} 人已提交（应填 {应填人数} 人），发现问题 {问题数} 条。{汇总正文}",
  },
  {
    code: "A03_T1_INBOX",
    title: "问题处理超时提醒",
    body: "{责任人}，你的问题「{问题标题}」已超过处理时限 1 天，请尽快处理并更新进展！",
  },
  {
    code: "A03_T1_APP",
    title: "问题处理超时提醒",
    body: "{责任人}，你的问题「{问题标题}」已超过处理时限 1 天，请尽快处理并更新进展！",
  },
  {
    code: "A03_T3_INBOX",
    title: "问题超期升级",
    body: "{项目经理}，问题「{问题标题}」超期 3 天仍未闭环，已升级给你，请关注并推动处理！",
  },
  {
    code: "A03_T3_APP",
    title: "问题超期升级",
    body: "{项目经理}，问题「{问题标题}」超期 3 天仍未闭环，已升级给你，请关注并推动处理！",
  },
  {
    code: "A14_INBOX",
    title: "待办提醒：{待办标题}",
    body: "{提醒对象}，你的待办「{待办标题}」已到提醒时间。{待办内容}",
  },
  {
    code: "A14_APP",
    title: "待办提醒：{待办标题}",
    body: "{提醒对象}，你的待办「{待办标题}」已到提醒时间。{待办内容}",
  },
];
/** 引擎可执行的内置规则（R02 ~ R07 任务类；A01 / A02 / A03 / A14 主体类）。 */
export const BUILTIN_RULES: readonly AutomationRule[] = [
  {
    code: "R02",
    name: "成果文件自动化通知",
    enabled: true,
    trigger: { kind: "event", topic: "task.completed" },
    conditions: [
      { field: "task.deliverable_types", op: "notEmpty" },
      { field: "task.file_count", op: "eq", value: 0 },
    ],
    actions: [
      { kind: "notification", channel: "inbox", recipient: "task.owner_or_project_manager", template: "R02_INBOX" },
      { kind: "notify", channel: "wecom_app", recipient: "task.owner_or_project_manager", template: "R02_WECOM" },
    ],
    version: 1,
  },
  {
    code: "R03",
    name: "任务即将延期提醒",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 8 * * *", window: "T_MINUS_1", baseField: "task.planned_end" },
    conditions: [{ field: "task.display_status", op: "notIn", value: ["done", "early_done"] }],
    actions: [{ kind: "notify", channel: "wecom_group", recipient: "project.group", template: "R03_GROUP" }],
    version: 1,
  },
  {
    code: "R04",
    name: "任务启动提醒",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 10 * * *", window: "SAME_DAY", baseField: "task.planned_start" },
    conditions: [
      { field: "task.display_status", op: "in", value: ["pending", "active"] },
      { field: "task.actual_start", op: "isNull" },
    ],
    actions: [{ kind: "notify", channel: "wecom_group", recipient: "project.group", template: "R04_GROUP" }],
    version: 1,
  },
  {
    code: "R05",
    name: "任务超时提醒",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 8 * * *", window: "T_PLUS_1", baseField: "task.planned_end" },
    conditions: [{ field: "task.display_status", op: "notIn", value: ["done", "early_done"] }],
    actions: [{ kind: "notify", channel: "wecom_group", recipient: "project.group", template: "R05_GROUP" }],
    version: 1,
  },
  {
    code: "R06",
    name: "任务完成喜报",
    enabled: true,
    trigger: { kind: "event", topic: "task.completed" },
    conditions: [
      { field: "task.actual_end", op: "notNull" },
      { field: "project.progress", op: "eq", value: 100 },
    ],
    actions: [{ kind: "notify", channel: "wecom_group", recipient: "project.group", template: "R06_GROUP" }],
    version: 1,
  },
  {
    code: "R07",
    name: "每周一提醒跟进重要 / 紧急任务",
    enabled: true,
    trigger: { kind: "schedule", cron: "30 9 * * 1", window: "WEEKLY" },
    conditions: [
      { field: "task.display_status", op: "eq", value: "active" },
      { field: "task.urgency", op: "in", value: ["重要且紧急", "紧急但不重要", "重要但不紧急"] },
    ],
    actions: [
      { kind: "notify", channel: "wecom_app", recipient: "task.owner", template: "R07_APP", groupBy: ["task.owner_id"] },
    ],
    version: 1,
  },
  // A03 = 一条业务规则、两个触发窗口（ADR-026）：T+1 提醒责任人 / T+3 升级项目经理 ——
  // 规则集内同 code 两行（幂等键 = 规则 + 实体 + 窗口，两窗口互不冲突）；落库形态随 M5-06（lan）接线时定。
  {
    code: "A01",
    name: "日报应填未填提醒",
    enabled: true,
    trigger: { kind: "schedule", cron: "30 19 * * *", window: "SAME_DAY", baseField: "report.date" },
    conditions: [
      { field: "report.is_workday", op: "eq", value: true },
      { field: "report.submitted", op: "eq", value: false },
    ],
    actions: [
      { kind: "notification", channel: "inbox", recipient: "report.member", template: "A01_INBOX_MERGED", groupBy: ["report.user_id"] },
      { kind: "notify", channel: "wecom_app", recipient: "report.member", template: "A01_WECOM_MERGED", groupBy: ["report.user_id"] },
    ],
    version: 1,
  },
  {
    code: "A02",
    name: "日报每日汇总群播报",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 19 * * *", window: "SAME_DAY", baseField: "report.date" },
    conditions: [{ field: "report.entry_count", op: "gt", value: 0 }],
    actions: [{ kind: "notify", channel: "wecom_group", recipient: "project.group", template: "A02_GROUP" }],
    version: 1,
  },
  {
    code: "A03",
    name: "问题超期提醒（T+1 责任人）",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 9 * * *", window: "T_PLUS_1", baseField: "issue.due_at" },
    conditions: [{ field: "issue.state", op: "ne", value: "done" }],
    actions: [
      { kind: "notification", channel: "inbox", recipient: "issue.owner", template: "A03_T1_INBOX" },
      { kind: "notify", channel: "wecom_app", recipient: "issue.owner", template: "A03_T1_APP" },
    ],
    version: 1,
  },
  {
    code: "A03",
    name: "问题超期升级（T+3 项目经理）",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 9 * * *", window: "T_PLUS_3", baseField: "issue.due_at" },
    conditions: [{ field: "issue.state", op: "ne", value: "done" }],
    actions: [
      { kind: "notification", channel: "inbox", recipient: "project.manager", template: "A03_T3_INBOX" },
      { kind: "notify", channel: "wecom_app", recipient: "project.manager", template: "A03_T3_APP" },
    ],
    version: 1,
  },
  {
    code: "A14",
    name: "自定义待办提醒",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 9 * * *", window: "SAME_DAY", baseField: "todo.remind_date" },
    conditions: [{ field: "todo.status", op: "ne", value: "done" }],
    actions: [
      { kind: "notification", channel: "inbox", recipient: "rule.members", template: "A14_INBOX" },
      { kind: "notify", channel: "wecom_app", recipient: "rule.members", template: "A14_APP" },
    ],
    version: 1,
  },
];

/** 规则码 → 回放主体类型（缺省 task）：A01 日报名册槽位 / A02 项目日报 / A03 问题 / A14 待办。 */
export const BUILTIN_RULE_SUBJECT_KINDS: Readonly<Record<string, ReplaySubjectKind>> = {
  R02: "task",
  R03: "task",
  R04: "task",
  R05: "task",
  R06: "task",
  R07: "task",
  A01: "report_slot",
  A02: "project_day",
  A03: "issue",
  A14: "todo",
};

/** 规则码 → 主体类型（未登记的自定义规则按 task 处理 —— 保持 R 系列历史口径）。 */
export function subjectKindOf(ruleCode: string): ReplaySubjectKind {
  return BUILTIN_RULE_SUBJECT_KINDS[ruleCode] ?? "task";
}

/**
 * 模板变量取数口径（变量名 → 字段名候选链，取第一个非空）：
 *   - "@recipient" = 本次实际解析出的收件人名称（A03 升级消息的「项目经理」/ A14 的「提醒对象」）；
 *   - 其余 = 主体字段（点分命名空间，由唤醒层注入的实体快照提供）。
 * 候选链全空 = 渲染空串；模板里出现的变量名必须登记在此（见 test/automation-a-series.test.ts 的模板一致性用例）。
 */
export const SUBJECT_TEMPLATE_VARIABLES: Readonly<
  Record<ReplaySubjectKind, Readonly<Record<string, readonly string[]>>>
> = {
  task: {
    "任务描述": ["task.title"],
    "任务负责人": ["task.owner_name", "task.manager_name"],
  },
  issue: {
    "问题标题": ["issue.title"],
    "责任人": ["issue.owner_name"],
    "项目经理": ["@recipient"],
  },
  report_slot: {
    "项目名": ["project.name"],
  },
  project_day: {
    "项目名": ["project.name"],
    "日期": ["report.date"],
    "提交人数": ["report.entry_count"],
    "应填人数": ["report.headcount_total"],
    "问题数": ["report.issue_count"],
    "汇总正文": ["report.summary_text"],
  },
  todo: {
    "待办标题": ["todo.title"],
    "待办内容": ["todo.content"],
    "提醒对象": ["@recipient"],
  },
};

/** 合并文案（groupBy 规则）：键 = rule|channel 优先、其次 rule 级。 */
export interface MergedTemplateSpec {
  template: string;
  listVariable: string;
  listField: string;
}

export const MERGED_TEMPLATE_SPECS: Readonly<Record<string, MergedTemplateSpec>> = {
  R07: { template: "R07_APP_MERGED", listVariable: "任务清单", listField: "task.title" },
  "A01|inbox": { template: "A01_INBOX_MERGED", listVariable: "项目清单", listField: "project.name" },
  "A01|wecom_app": { template: "A01_WECOM_MERGED", listVariable: "项目清单", listField: "project.name" },
};

/** 合并文案查表：rule|channel 优先、回退 rule 级；无登记 = 不换文案（仅收件人粒度幂等）。 */
export function findMergedSpec(ruleCode: string, channel: string): MergedTemplateSpec | null {
  return MERGED_TEMPLATE_SPECS[ruleCode + "|" + channel] ?? MERGED_TEMPLATE_SPECS[ruleCode] ?? null;
}

/** 模板码 → 模板（未知模板码返回 null，由回放器登记为配置错误）。 */
export function findTemplate(code: string): AutomationMessageTemplate | null {
  return BUILTIN_MESSAGE_TEMPLATES.find((item) => item.code === code) ?? null;
}
