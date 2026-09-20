/** calendar 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export { CalendarModule } from "./calendar.module.js";
export { CalendarService } from "./calendar.service.js";
export type { CalendarDayRow, CalendarSettingsRow } from "./calendar.repository.js";
export {
  addDays,
  atShanghaiTime,
  calendarWindow,
  dayOfWeek,
  evaluateOffset,
  isWeekend,
  isWorkday,
  resolveDay,
  shiftToWorkday,
} from "./calendar.rules.js";
export type {
  CalendarDayKind,
  CalendarDayResolution,
  CalendarDayType,
  CalendarException,
  CalendarShiftDirection,
  CalendarShiftMode,
  CalendarWindow,
  OffsetEvaluateInput,
  OffsetEvaluateOutcome,
  ShiftOutcome,
} from "./calendar.rules.js";
