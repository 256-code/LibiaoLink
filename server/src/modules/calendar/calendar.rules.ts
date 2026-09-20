/**
 * 工作日历规则（纯函数，不连库）：日期判定 / 顺延 / T-N·T+N 求值 / Asia/Shanghai 时刻换算。
 * 口径来源：系统功能书 D5-01 ~ D5-03；技术设计v0.1 §4 时间语义（节假日 / 调休日历参与顺延判断；
 *   T-1/T+1 以任务当前日期实时求值 —— 改期后按新日期重算，已发送的不撤回）；技术设计v0.3 §4.7
 *   （业务日按 Asia/Shanghai、存 UTC；规则禁止直接取系统时间 —— 基准日期一律由调用方传入）。
 * 数据面只存「例外」（放假 / 调休上班），未登记日期按默认规则：周一至周五工作日、周六周日非工作日。
 */

export type CalendarDayType = "holiday" | "makeup_workday";
export type CalendarDayKind = "workday" | "weekend" | "holiday" | "makeup_workday";
export type CalendarShiftDirection = "forward" | "backward";
export type CalendarShiftMode = "inherit" | "on" | "off";

/** 例外行（规则层输入：与仓储行解耦；date 为 YYYY-MM-DD 业务日）。 */
export interface CalendarException {
  date: string;
  dayType: CalendarDayType;
  name: string | null;
  note: string | null;
}

/** 日历窗口：一次求值可加载的例外集合 + 覆盖边界（越界 = 未加载，与「非工作日」严格区分）。 */
export interface CalendarWindow {
  from: string;
  to: string;
  days: Map<string, CalendarException>;
}

/** 单日判定结果。 */
export interface CalendarDayResolution {
  date: string;
  kind: CalendarDayKind;
  isWorkday: boolean;
  name: string | null;
  note: string | null;
  source: "default" | "calendar";
}

/** 顺延结果：ok=false 表示窗口用尽（调用方扩窗后重算，避免把「未加载」当成「工作日」）。 */
export type ShiftOutcome =
  | {
      ok: true;
      date: string;
      shifted: boolean;
      skipped: string[];
      kind: CalendarDayKind;
      name: string | null;
    }
  | { ok: false; reason: "exhausted"; skipped: string[] };

/** T-N / T+N 求值入参（顺延开关与方向由服务层折算后传入，规则层不做配置判定）。 */
export interface OffsetEvaluateInput {
  baseDate: string;
  days: number;
  shiftEnabled: boolean;
  shiftDirection: CalendarShiftDirection;
  window: CalendarWindow;
}

export interface OffsetEvaluateOutcome {
  rawDate: string;
  date: string;
  shifted: boolean;
  shiftDirection: CalendarShiftDirection | null;
  kind: CalendarDayKind;
  name: string | null;
}

/** 顺延最大步数（防御：连续非工作日不应超过一年）。 */
const SHIFT_GUARD = 366;

/** 构造窗口（过滤掉边界外的例外行）。 */
export function calendarWindow(from: string, to: string, exceptions: readonly CalendarException[]): CalendarWindow {
  const days = new Map<string, CalendarException>();
  for (const item of exceptions) {
    if (item.date >= from && item.date <= to) days.set(item.date, item);
  }
  return { from, to, days };
}

/** 纯日期加减（YYYY-MM-DD，按 UTC 日算术；业务日不携带时区）。 */
export function addDays(date: string, days: number): string {
  const base = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(base)) throw new Error("非法业务日期：" + date);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** 星期（0 = 周日，与 UTC 日算术一致）。 */
export function dayOfWeek(date: string): number {
  const parsed = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed)) throw new Error("非法业务日期：" + date);
  return new Date(parsed).getUTCDay();
}

/** 是否周末（默认规则的非工作日）。 */
export function isWeekend(date: string): boolean {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
}

/**
 * 单日判定：例外优先（holiday 放假 / makeup_workday 调休上班 —— 调休上班视为工作日），
 * 否则按默认规则（周六周日周末、周一至周五工作日）；窗口外返回 null（未加载）。
 */
export function resolveDay(date: string, window: CalendarWindow): CalendarDayResolution | null {
  const exception = window.days.get(date);
  if (exception !== undefined) {
    return {
      date,
      kind: exception.dayType,
      isWorkday: exception.dayType === "makeup_workday",
      name: exception.name,
      note: exception.note,
      source: "calendar",
    };
  }
  if (date < window.from || date > window.to) return null;
  const weekend = isWeekend(date);
  return { date, kind: weekend ? "weekend" : "workday", isWorkday: !weekend, name: null, note: null, source: "default" };
}

/** 是否工作日（窗口外一律按非工作日返回 false；跨窗求值请用 resolveDay / shiftToWorkday 的 ok 判定）。 */
export function isWorkday(date: string, window: CalendarWindow): boolean {
  const resolved = resolveDay(date, window);
  return resolved !== null && resolved.isWorkday;
}

/**
 * 顺延 / 提前到最近工作日（D5-02）：forward = 之后最近工作日，backward = 之前最近工作日；
 * 已是工作日则原样返回（shifted=false）；跳过的日期按移动顺序进 skipped（金标用例逐条断言）。
 */
export function shiftToWorkday(date: string, direction: CalendarShiftDirection, window: CalendarWindow): ShiftOutcome {
  const step = direction === "forward" ? 1 : -1;
  const skipped: string[] = [];
  let cursor = date;
  for (let guard = 0; guard <= SHIFT_GUARD; guard += 1) {
    const resolved = resolveDay(cursor, window);
    if (resolved === null) return { ok: false, reason: "exhausted", skipped };
    if (resolved.isWorkday) {
      return { ok: true, date: cursor, shifted: cursor !== date, skipped, kind: resolved.kind, name: resolved.name };
    }
    skipped.push(cursor);
    cursor = addDays(cursor, step);
  }
  return { ok: false, reason: "exhausted", skipped };
}

/**
 * T-N / T+N 求值（D5-03）：先按自然日偏移（-1 = 前一天、+1 = 后一天），若结果落在非工作日且顺延开启，
 * 再按方向顺延到最近工作日。实时求值 —— 不缓存、不落库，任务日期被修改后按新日期重算。
 */
export function evaluateOffset(input: OffsetEvaluateInput): OffsetEvaluateOutcome | null {
  const rawDate = addDays(input.baseDate, input.days);
  const raw = resolveDay(rawDate, input.window);
  if (raw === null) return null;
  if (raw.isWorkday || !input.shiftEnabled) {
    return {
      rawDate,
      date: rawDate,
      shifted: false,
      shiftDirection: null,
      kind: raw.kind,
      name: raw.name,
    };
  }
  const shifted = shiftToWorkday(rawDate, input.shiftDirection, input.window);
  if (!shifted.ok) return null;
  return {
    rawDate,
    date: shifted.date,
    shifted: shifted.shifted,
    shiftDirection: shifted.shifted ? input.shiftDirection : null,
    kind: shifted.kind,
    name: shifted.name,
  };
}

/** 业务日 + HH:mm（Asia/Shanghai）→ UTC 时间戳（R03 / R05 的「前 1 天 08:00」等提醒时刻）。 */
export function atShanghaiTime(date: string, time: string): string {
  const parsed = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(time);
  if (parsed === null) throw new Error("非法时刻（HH:mm）：" + time);
  const base = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(base)) throw new Error("非法业务日期：" + date);
  const offsetMs = Number(parsed[1]) * 3_600_000 + Number(parsed[2]) * 60_000 - 8 * 3_600_000;
  return new Date(base + offsetMs).toISOString();
}
