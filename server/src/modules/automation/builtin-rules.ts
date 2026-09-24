/**
 * R01~R07 内置规则定义与逐字文案模板（M5-01 切片）。
 * 逐字基准：docs/rules/R01-R07-内置规则文案.md（标题与内容不得改字；变量占位符保持 {字段} 原文格式）。
 * 口径来源：系统功能书 C2-02 / C2-04、技术设计v0.2 §6.1、ADR-026（A03 升级链路）/ ADR-028（时区）。
 * 说明：R01 无通知动作（落点 = 变更生效事务内同事务回写 tasks.change_refs，见 M4-04），
 *   故不在引擎规则集内；其余六条为引擎可执行规则（R02 / R06 事件型，R03 / R04 / R05 / R07 调度型）。
 */
import type { AutomationMessageTemplate, AutomationRule } from "@libiaolink/contracts";

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
];

/** 引擎可执行的内置规则（R02 / R03 / R04 / R05 / R06 / R07）。 */
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
];

/** 模板码 → 模板（未知模板码返回 null，由回放器登记为配置错误）。 */
export function findTemplate(code: string): AutomationMessageTemplate | null {
  return BUILTIN_MESSAGE_TEMPLATES.find((item) => item.code === code) ?? null;
}
