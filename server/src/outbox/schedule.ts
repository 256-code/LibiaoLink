/**
 * 调度窗口求值（S7-3 · i11 / M5-02）：cron 五段解析、下一触发时刻、补发窗口枚举与跨度裁剪。
 *
 * 口径来源：技术设计v0.2 §6.2（调度：记录 last_run_at；重启或错过窗口按应执行清单补发）、
 *   ADR-005（任务定义入 DB；每分钟 tick；支持错过补发）、shared/src/modules/outbox.ts 的 OUTBOX_SCHEDULER
 *   （tick 周期 / 补发跨度上限 / 单活锁名）。
 *
 * 纯函数：不连库、不取系统时间（时间由调用方传入；业务时区 Asia/Shanghai = UTC+8 固定偏移 · ADR-028）。
 * cron 五段（分钟 小时 日 月 周）：周 0~7（0 / 7 = 周日）；支持 `*`、单值、逗号列表、`a-b` 区间、步进
 *   （星号 / 单值 / 区间 + 「/n」）。「日」与「周」同时受限时按标准 cron 的 OR 语义（任一命中即触发）。
 *
 * 求值算法：按上海「业务日」逐日推进 —— 业务日索引 = floor((utcMs + 8h) / 一天)；日级命中一次判定，
 *   日内触发时刻 = 业务日 + 小时 + 分钟（再减 8h 回 UTC）。避免逐分钟扫描，扫描有界（MAX_SCAN_DAYS）。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS;
/** nextFireAfter 扫描上限（天）：给「不可能 cron」（如 2 月 31 日）兜底，避免无界扫描。 */
const MAX_SCAN_DAYS = 731;
/** 补发窗口枚举的内存兜底上限：超过只取前 N 个并标记 truncated（防异常 cron 撑爆内存）；每轮策略上限见 planCatchup 的 maxWindows（契约 OUTBOX_SCHEDULER.maxWindowsPerTick）。 */
export const MAX_CATCHUP_FIRES = 2000;

export interface ParsedCron {
  minutes: readonly number[];
  hours: readonly number[];
  /** null = `*`（不受限）。 */
  daysOfMonth: readonly number[] | null;
  months: readonly number[] | null;
  /** 0~6（0 = 周日）；null = `*`。 */
  daysOfWeek: readonly number[] | null;
}

function fail(label: string, piece: string): never {
  throw new Error("cron " + label + " 段无法解析：" + piece);
}

function assertRange(value: number, min: number, max: number, label: string, piece: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(label, piece + "（越界 " + min + "~" + max + "）");
  }
  return value;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  label: string,
  normalize: (value: number) => number = (value) => value,
): number[] | null {
  if (raw === "*") return null;
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (piece === "") fail(label, raw);
    const step = /^(\*|\d+-\d+)\/(\d+)$/.exec(piece);
    if (step !== null) {
      const stepSize = Number(step[2]);
      if (stepSize <= 0) fail(label, piece);
      let from = min;
      let to = max;
      const stepKind = step[1] ?? "";
      if (stepKind !== "*") {
        const [fromText, toText] = stepKind.split("-");
        from = Number(fromText);
        to = Number(toText);
      }
      if (from > to) fail(label, piece);
      for (let value = from; value <= to; value += stepSize) {
        values.add(normalize(assertRange(value, min, max, label, piece)));
      }
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(piece);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to) fail(label, piece);
      for (let value = from; value <= to; value += 1) {
        values.add(normalize(assertRange(value, min, max, label, piece)));
      }
      continue;
    }
    const singleStep = /^(\d+)\/(\d+)$/.exec(piece);
    if (singleStep !== null) {
      const from = assertRange(Number(singleStep[1]), min, max, label, piece);
      const stepSize = Number(singleStep[2]);
      if (stepSize <= 0) fail(label, piece);
      for (let value = from; value <= max; value += stepSize) {
        values.add(normalize(value));
      }
      continue;
    }
    if (!/^\d+$/.test(piece)) fail(label, piece);
    values.add(normalize(assertRange(Number(piece), min, max, label, piece)));
  }
  return [...values].sort((a, b) => a - b);
}

function expandAll(min: number, max: number): number[] {
  const values: number[] = [];
  for (let value = min; value <= max; value += 1) values.push(value);
  return values;
}

/** 解析五段 cron（Asia/Shanghai 口径）；非法写法直接抛（配置错误 fail fast）。 */
export function parseCron(cron: string): ParsedCron {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("cron 需五段（分钟 小时 日 月 周）：" + cron);
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = fields as [string, string, string, string, string];
  return {
    minutes: parseField(minutes, 0, 59, "分钟") ?? expandAll(0, 59),
    hours: parseField(hours, 0, 23, "小时") ?? expandAll(0, 23),
    daysOfMonth: parseField(daysOfMonth, 1, 31, "日"),
    months: parseField(months, 1, 12, "月"),
    daysOfWeek: parseField(daysOfWeek, 0, 7, "周", (value) => (value === 7 ? 0 : value)),
  };
}

/** 业务日命中判定：入参 = 上海业务日 00:00 对应的 UTC 时刻（wall 字段按业务日填）。 */
function dayMatches(parsed: ParsedCron, businessDayStartUtcMs: number): boolean {
  const wall = new Date(businessDayStartUtcMs);
  const month = wall.getUTCMonth() + 1;
  const day = wall.getUTCDate();
  const weekday = wall.getUTCDay();
  if (parsed.months !== null && !parsed.months.includes(month)) return false;
  const domRestricted = parsed.daysOfMonth !== null;
  const dowRestricted = parsed.daysOfWeek !== null;
  const domHit = parsed.daysOfMonth === null || parsed.daysOfMonth.includes(day);
  const dowHit = parsed.daysOfWeek === null || parsed.daysOfWeek.includes(weekday);
  if (domRestricted && dowRestricted) return domHit || dowHit;
  return domHit && dowHit;
}

function businessDayIndexOf(ms: number): number {
  return Math.floor((ms + SHANGHAI_OFFSET_MS) / DAY_MS);
}

function fireMsOf(dayIndex: number, hour: number, minute: number): number {
  return dayIndex * DAY_MS + hour * HOUR_MS + minute * MINUTE_MS - SHANGHAI_OFFSET_MS;
}

/** 严格晚于 after 的下一个触发时刻；扫描上限内无命中（不可能 cron）返回 null。 */
export function nextFireAfter(cron: string, after: Date): Date | null {
  const parsed = parseCron(cron);
  const afterMs = after.getTime();
  const firstDay = businessDayIndexOf(afterMs);
  for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned += 1) {
    const dayIndex = firstDay + scanned;
    const dayStartUtcMs = dayIndex * DAY_MS;
    if (!dayMatches(parsed, dayStartUtcMs)) continue;
    for (const hour of parsed.hours) {
      for (const minute of parsed.minutes) {
        const fireMs = fireMsOf(dayIndex, hour, minute);
        if (fireMs > afterMs) return new Date(fireMs);
      }
    }
  }
  return null;
}

/** 枚举 (after, until] 内的全部触发时刻（升序）；命中数触顶返回 truncated=true。 */
export function enumerateFireTimes(
  cron: string,
  after: Date,
  until: Date,
  limit: number = MAX_CATCHUP_FIRES,
): { times: Date[]; truncated: boolean } {
  const parsed = parseCron(cron);
  const afterMs = after.getTime();
  const untilMs = until.getTime();
  const times: Date[] = [];
  const firstDay = businessDayIndexOf(afterMs);
  const lastDay = businessDayIndexOf(untilMs);
  for (let dayIndex = firstDay; dayIndex <= lastDay; dayIndex += 1) {
    const dayStartUtcMs = dayIndex * DAY_MS;
    if (!dayMatches(parsed, dayStartUtcMs)) continue;
    for (const hour of parsed.hours) {
      for (const minute of parsed.minutes) {
        const fireMs = fireMsOf(dayIndex, hour, minute);
        if (fireMs > afterMs && fireMs <= untilMs) {
          if (times.length >= limit) return { times, truncated: true };
          times.push(new Date(fireMs));
        }
      }
    }
  }
  return { times, truncated: false };
}

/** 补发计划：窗口 (after, now]，超出补发跨度上限的区间只记 skipped 留痕（不补发）。 */
export interface CatchupPlan {
  windowFrom: Date;
  windowTo: Date;
  fireTimes: Date[];
  /** 本轮窗口上限触顶：还有未处理窗口 —— 调用方须把水位停在本轮最后处理的窗口，不得越过。 */
  pendingMore: boolean;
  /** 本轮最后处理的窗口（fireTimes 末项；无窗口 = null）—— 触顶时下一轮窗口下限。 */
  resumeFrom: Date | null;
  /** 超跨度被跳过的区间 (skippedFrom, skippedTo]；无跳过 = null。 */
  skippedFrom: Date | null;
  skippedTo: Date | null;
}

export function planCatchup(input: {
  cron: string;
  /**
   * 窗口下限（不含）：cron 任务 = last_run_at（上次执行时刻）；从未执行 = 首个应执行时刻前 1ms
   * （调用方构造，见 JobScheduler —— 保证首个应执行时刻落在窗口内、且不枚举任务创建前的触发时刻）。
   * 若该下限早于补发跨度上限（now - catchupMaxDays），窗口收窄到上限处、超跨度区间只记 skipped。
   */
  after: Date;
  now: Date;
  catchupMaxDays: number;
  /**
   * 单轮最多处理的窗口数（水位护栏 · OUTBOX_SCHEDULER.maxWindowsPerTick）：触顶时只取前 N 个窗口并置
   * pendingMore=true，调用方须把水位（last_run_at）停在 resumeFrom、下一轮从它继续。
   * 缺省 = MAX_CATCHUP_FIRES（内存兜底）；生产调用方显式传 env 值。
   */
  maxWindows?: number;
}): CatchupPlan {
  const capStart = new Date(input.now.getTime() - input.catchupMaxDays * DAY_MS);
  const capped = input.after.getTime() < capStart.getTime();
  const windowFrom = capped ? capStart : input.after;
  const maxWindows = Math.max(1, Math.min(input.maxWindows ?? MAX_CATCHUP_FIRES, MAX_CATCHUP_FIRES));
  const { times, truncated } = enumerateFireTimes(input.cron, windowFrom, input.now, maxWindows);
  return {
    windowFrom,
    windowTo: input.now,
    fireTimes: times,
    pendingMore: truncated,
    resumeFrom: times.length === 0 ? null : times[times.length - 1] ?? null,
    skippedFrom: capped ? input.after : null,
    skippedTo: capped ? capStart : null,
  };
}
