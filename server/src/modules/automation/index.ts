/** automation 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export {
  dedupeKey,
  evaluateCondition,
  evaluateOperator,
  evaluateRule,
  isoWeekKey,
  mondayOf,
  renderTemplate,
  resolveScheduleFire,
} from "./automation.rules.js";
export type {
  ConditionEvaluation,
  RuleContext,
  RuleEvaluation,
  RuleEvaluationOptions,
  RuleFieldValue,
  ScheduleFire,
  ScheduleFireInput,
} from "./automation.rules.js";
export { BUILTIN_MESSAGE_TEMPLATES, BUILTIN_RULES, R01_NOTE, findTemplate } from "./builtin-rules.js";
export { cronTime, replayRules } from "./automation.replay.js";
export type {
  ReplayDetail,
  ReplayInput,
  ReplayMessage,
  ReplayReport,
  ReplaySkipReason,
  ReplayTask,
} from "./automation.replay.js";
