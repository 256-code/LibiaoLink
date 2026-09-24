/**
 * 规则回放器（纯函数，不连库）：给定规则集 + 任务数据集 + 业务日 + 日历 → 应发送清单（含幂等与合并）。
 * 口径来源：技术设计v0.2 §6.2（幂等执行键 / 可测试：时钟注入 + 规则回放 + 金标文案逐字比对）、
 *   docs/rules/R01-R07-内置规则文案.md、技术设计v0.3 §3.6 M5 出口标准（R03~R07 金标回放全绿）。
 * 边界：本文件只算「应发给谁、发什么、幂等键是什么」；真正投递（企微 / 站内信 / 重试 / 死信）由 M5-02 ~ M5-04 承担。
 */
import type { AutomationRule, NotifyChannel, RuleRecipient } from "@libiaolink/contracts";
import type { CalendarShiftDirection, CalendarWindow } from "../calendar/index.js";
import {
  dedupeKey,
  evaluateRule,
  renderTemplate,
  resolveScheduleFire,
  type ConditionEvaluation,
  type RuleContext,
} from "./automation.rules.js";
import { BUILTIN_RULES, findTemplate } from "./builtin-rules.js";

/** 回放用任务快照（去 DB 化：字段口径 = 规则条件与文案变量所需的最小集）。 */
export interface ReplayTask {
  id: string;
  title: string;
  version: number;
  /** 展示五态（pending / active / done / overdue / early_done，派生口径见 task.rules）。 */
  displayStatus: string;
  urgency: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  ownerId: string | null;
  ownerName: string | null;
  managerId: string | null;
  managerName: string | null;
  projectId: string;
  projectProgress: number;
  projectGroupId: string | null;
  deliverableTypes: readonly string[];
  fileCount: number;
}

/** 回放入参：业务日（Asia/Shanghai）+ 数据集 + 日历窗口（顺延开关与方向由调用方按日历设置折算）。 */
export interface ReplayInput {
  businessDate: string;
  tasks: readonly ReplayTask[];
  calendar: CalendarWindow;
  shiftEnabled?: boolean;
  shiftDirection?: CalendarShiftDirection;
  /** 已发送（或已入队）的幂等键：命中即跳过，跨天 / 重启补跑不重复发送。 */
  sentKeys?: readonly string[];
  /** 规则集（缺省 = 内置 R02 ~ R07；回放指定规则便于金标逐条比对）。 */
  rules?: readonly AutomationRule[];
}

export interface ReplayMessage {
  ruleCode: string;
  entityId: string;
  windowKey: string;
  dedupeKey: string;
  channel: NotifyChannel;
  recipient: RuleRecipient;
  recipientId: string | null;
  recipientName: string | null;
  title: string | null;
  body: string;
  /** 分组来源（分组规则 = 本条清单覆盖的任务 id；非分组消息省略）。 */
  mergedFrom?: string[];
}

export type ReplaySkipReason =
  | "disabled"
  | "window_mismatch"
  | "not_matched"
  | "recipient_missing"
  | "template_missing"
  | "duplicate";

export interface ReplayDetail {
  ruleCode: string;
  entityId: string;
  windowKey: string | null;
  matched: boolean;
  skipped: ReplaySkipReason | null;
  conditions: ConditionEvaluation[];
}

export interface ReplayReport {
  businessDate: string;
  /** 应发送清单（确定性排序：规则码 → 实体 id）。 */
  messages: ReplayMessage[];
  matched: number;
  skipped: number;
  details: ReplayDetail[];
}

/** 事件型规则在回放中的候选口径：任务已处完成态 = 完成事件已发生（真实事件由 outbox 承载，M5-02）。 */
const COMPLETED_STATUSES = ["done", "early_done"];

/** 合并文案模板（先行口径：R07 同负责人多任务合并为一条清单，形态待业务确认 —— docs/rules 文末清单）。 */
const MERGED_TEMPLATE_CODES: Readonly<Record<string, string>> = { R07: "R07_APP_MERGED" };

/** 调度窗口的业务时刻（取 cron 前两段，分钟粒度；不支持星号步进写法，配置错误直接抛）。 */
export function cronTime(cron: string | null | undefined): string {
  if (cron === null || cron === undefined) throw new Error("调度型规则缺少 cron");
  const fields = cron.trim().split(" ");
  if (fields.length !== 5) throw new Error("cron 需五段：" + cron);
  const minute = Number(fields[0]);
  const hour = Number(fields[1]);
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    throw new Error("cron 前两段需为具体时刻（分钟 / 小时）：" + cron);
  }
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function taskContext(task: ReplayTask): RuleContext {
  return {
    "task.id": task.id,
    "task.title": task.title,
    "task.version": task.version,
    "task.display_status": task.displayStatus,
    "task.urgency": task.urgency,
    "task.planned_start": task.plannedStart,
    "task.planned_end": task.plannedEnd,
    "task.actual_start": task.actualStart,
    "task.actual_end": task.actualEnd,
    "task.owner_id": task.ownerId,
    "task.owner_name": task.ownerName,
    "task.deliverable_types": task.deliverableTypes,
    "task.file_count": task.fileCount,
    "project.id": task.projectId,
    "project.progress": task.projectProgress,
  };
}

function baseDateOf(task: ReplayTask, field: string | null | undefined): string | null {
  if (field === "task.planned_start") return task.plannedStart;
  if (field === "task.planned_end") return task.plannedEnd;
  return null;
}

interface ResolvedRecipient {
  id: string | null;
  name: string | null;
}

function resolveRecipient(task: ReplayTask, recipient: RuleRecipient): ResolvedRecipient | null {
  if (recipient === "task.owner") {
    return task.ownerId === null ? null : { id: task.ownerId, name: task.ownerName };
  }
  if (recipient === "task.owner_or_project_manager") {
    if (task.ownerId !== null) return { id: task.ownerId, name: task.ownerName };
    return task.managerId === null ? null : { id: task.managerId, name: task.managerName };
  }
  if (recipient === "project.manager") {
    return task.managerId === null ? null : { id: task.managerId, name: task.managerName };
  }
  if (recipient === "project.group") {
    return task.projectGroupId === null ? null : { id: task.projectGroupId, name: null };
  }
  return null;
}

/** 同一次回放内的重复判定粒度 = 幂等键 + 投放面（实体 + 渠道 + 收件人）：同规则多渠道路由 / 多任务各自成条，互不吞并。 */
function messageIdentity(message: ReplayMessage): string {
  return [message.dedupeKey, message.entityId, message.channel, message.recipient, message.recipientId ?? "-"].join("|");
}

/**
 * 回放主流程（确定性）：逐规则 × 逐任务 →（触发窗口 → 条件 → 动作 / 收件人）→ 应发送清单。
 * 去重：sentKeys（已发送 / 已入队）按幂等键判定、本次清单按投放面判定，命中即 duplicate 跳过；R07 按 groupBy 合并到收件人粒度（同负责人同窗口）。
 */
export function replayRules(input: ReplayInput): ReplayReport {
  const rules = input.rules ?? BUILTIN_RULES;
  const sent = new Set(input.sentKeys ?? []);
  const details: ReplayDetail[] = [];
  const candidates: Array<{ message: ReplayMessage; groupBy: readonly string[] | null; taskTitle: string }> = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      details.push({ ruleCode: rule.code, entityId: "-", windowKey: null, matched: false, skipped: "disabled", conditions: [] });
      continue;
    }
    for (const task of input.tasks) {
      const context = taskContext(task);
      let windowKey: string | null = null;

      if (rule.trigger.kind === "event") {
        if (!COMPLETED_STATUSES.includes(task.displayStatus)) {
          details.push({ ruleCode: rule.code, entityId: task.id, windowKey: null, matched: false, skipped: "window_mismatch", conditions: [] });
          continue;
        }
        windowKey = "v" + task.version;
      } else {
        const fire = resolveScheduleFire({
          window: rule.trigger.window ?? "SAME_DAY",
          businessDate: input.businessDate,
          baseDate: baseDateOf(task, rule.trigger.baseField),
          time: cronTime(rule.trigger.cron),
          shiftEnabled: input.shiftEnabled ?? false,
          shiftDirection: input.shiftDirection ?? "forward",
          calendar: input.calendar,
        });
        if (fire === null || fire.fireDate !== input.businessDate) {
          details.push({ ruleCode: rule.code, entityId: task.id, windowKey: fire === null ? null : fire.windowKey, matched: false, skipped: "window_mismatch", conditions: [] });
          continue;
        }
        windowKey = fire.windowKey;
      }

      const evaluation = evaluateRule(rule, context, { businessDate: input.businessDate });
      if (!evaluation.matched) {
        details.push({ ruleCode: rule.code, entityId: task.id, windowKey, matched: false, skipped: "not_matched", conditions: evaluation.conditions });
        continue;
      }

      const variables: Record<string, string | number> = {
        "任务描述": task.title,
        "任务负责人": task.ownerName ?? task.managerName ?? "",
      };
      const produced: ReplayMessage[] = [];
      let skip: ReplaySkipReason | null = null;
      let pendingGroup: readonly string[] | null = null;

      for (const action of rule.actions) {
        const template = findTemplate(action.template);
        if (template === null) {
          skip = skip ?? "template_missing";
          continue;
        }
        const recipientKinds = Array.isArray(action.recipient) ? action.recipient : [action.recipient];
        let resolvedAny = false;
        for (const recipientKind of recipientKinds) {
          const recipient = resolveRecipient(task, recipientKind);
          if (recipient === null) continue;
          resolvedAny = true;
          const channel = action.channel ?? "inbox";
          produced.push({
            ruleCode: rule.code,
            entityId: task.id,
            windowKey,
            dedupeKey: dedupeKey(rule.code, task.id, windowKey),
            channel,
            recipient: recipientKind,
            recipientId: recipient.id,
            recipientName: recipient.name,
            title: template.title,
            body: renderTemplate(template.body, variables),
          });
        }
        if (!resolvedAny) skip = skip ?? "recipient_missing";
        if (action.groupBy !== undefined && action.groupBy.length > 0 && produced.length > 0) pendingGroup = action.groupBy;
      }

      if (produced.length === 0) {
        details.push({ ruleCode: rule.code, entityId: task.id, windowKey, matched: false, skipped: skip ?? "recipient_missing", conditions: evaluation.conditions });
        continue;
      }
      details.push({ ruleCode: rule.code, entityId: task.id, windowKey, matched: true, skipped: null, conditions: evaluation.conditions });
      for (const message of produced) candidates.push({ message, groupBy: pendingGroup, taskTitle: task.title });
    }
  }

  const merged: ReplayMessage[] = [];
  const groups = new Map<string, Array<{ message: ReplayMessage; taskTitle: string }>>();
  for (const item of candidates) {
    if (item.groupBy === null) {
      merged.push(item.message);
      continue;
    }
    const key = [item.message.ruleCode, item.message.channel, item.message.recipient, item.message.recipientId ?? "-", item.message.windowKey].join("|");
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [{ message: item.message, taskTitle: item.taskTitle }]);
    else bucket.push({ message: item.message, taskTitle: item.taskTitle });
  }
  // 分组规则恒落到收件人粒度（哪怕本次只命中一条）：幂等键 = 规则 + 收件人 + 窗口，跨周 / 补跑不因任务条数变化而漏判。
  for (const bucket of groups.values()) {
    const firstItem = bucket[0];
    if (firstItem === undefined) continue;
    const first = firstItem.message;
    const sourceTaskIds = bucket.map((item) => item.message.entityId);
    const recipientEntityId = first.recipientId ?? first.entityId;
    const recipientKey = dedupeKey(first.ruleCode, recipientEntityId, first.windowKey);
    const mergedCode = MERGED_TEMPLATE_CODES[first.ruleCode];
    const template = mergedCode === undefined ? null : findTemplate(mergedCode);
    if (template === null) {
      merged.push({ ...first, entityId: recipientEntityId, dedupeKey: recipientKey, mergedFrom: sourceTaskIds });
      continue;
    }
    const titles = bucket.map((item) => item.taskTitle);
    merged.push({
      ...first,
      entityId: recipientEntityId,
      dedupeKey: recipientKey,
      body: renderTemplate(template.body, { "任务清单": titles.join("、") }),
      mergedFrom: sourceTaskIds,
    });
  }

  const detailIndex = new Map<string, ReplayDetail>();
  for (const detail of details) detailIndex.set(detail.ruleCode + "|" + detail.entityId, detail);
  const markDuplicate = (message: ReplayMessage): void => {
    for (const id of message.mergedFrom ?? [message.entityId]) {
      const detail = detailIndex.get(message.ruleCode + "|" + id);
      if (detail !== undefined && detail.skipped === null) detail.skipped = "duplicate";
    }
  };
  const messages: ReplayMessage[] = [];
  const producedIdentities = new Set<string>();
  for (const message of merged) {
    if (sent.has(message.dedupeKey) || producedIdentities.has(messageIdentity(message))) {
      markDuplicate(message);
      continue;
    }
    producedIdentities.add(messageIdentity(message));
    messages.push(message);
  }
  messages.sort((left, right) => (left.ruleCode + "|" + left.entityId).localeCompare(right.ruleCode + "|" + right.entityId));

  return {
    businessDate: input.businessDate,
    messages,
    matched: details.filter((item) => item.matched).length,
    skipped: details.filter((item) => item.skipped !== null).length,
    details,
  };
}
