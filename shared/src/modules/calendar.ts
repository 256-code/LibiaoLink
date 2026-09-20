import { z } from "../zod.ts";
import { DateOnlySchema, DateTimeSchema, UuidSchema } from "../common/conventions.ts";

/**
 * 工作日历（D5）契约：日历维护（D5-01）、顺延规则配置（D5-02）、T-1/T+1 求值（D5-03）。
 * 口径来源：系统功能书 D5-01 ~ D5-03；技术设计v0.1 §4 时间语义；技术设计v0.3 §4.7（业务日按 Asia/Shanghai、存 UTC、
 * 规则禁止直接取系统时间）。表口径见 database/migrations/0014_work_calendar.sql：
 * 只存「例外」（放假 / 调休上班），未登记日期按默认规则（周一至周五工作日、周六周日非工作日）。
 */

/** 日历例外类型（calendar_days.day_type）：holiday 放假（法定节假日 / 调休放假）/ makeup_workday 调休上班（周末补班）。 */
export const CALENDAR_DAY_TYPES = ["holiday", "makeup_workday"] as const;

export const CalendarDayTypeSchema = z.enum(CALENDAR_DAY_TYPES).openapi("CalendarDayType", {
  description: "日历例外类型：holiday 放假 / makeup_workday 调休上班（周末补班）；未登记的日期按默认规则判定",
});

/** 日期判定结果（求值侧，D5-03）：workday 普通工作日 / weekend 周末（默认非工作日）/ holiday 放假 / makeup_workday 调休上班。 */
export const CALENDAR_DAY_KINDS = ["workday", "weekend", "holiday", "makeup_workday"] as const;

export const CalendarDayKindSchema = z.enum(CALENDAR_DAY_KINDS).openapi("CalendarDayKind", {
  description: "日期判定结果：workday 工作日 / weekend 周末 / holiday 放假 / makeup_workday 调休上班（isWorkday 为 false 的三种一律参与顺延判断）",
});

/** 顺延方向（calendar_settings.shift_direction）：forward 顺延到之后最近工作日 / backward 提前到之前最近工作日。 */
export const CalendarShiftDirectionSchema = z.enum(["forward", "backward"]).openapi("CalendarShiftDirection", {
  description: "顺延方向：forward 顺延到之后最近工作日（节假日期间不提醒，节后补） / backward 提前到之前最近工作日（节前提醒）",
});

/** 求值时的顺延开关三态：inherit = 按日历配置（D5-02）；on / off = 本次强制覆盖（规则引擎回放与金标用例用）。 */
export const CALENDAR_SHIFT_MODES = ["inherit", "on", "off"] as const;

export const CalendarShiftModeSchema = z.enum(CALENDAR_SHIFT_MODES).openapi("CalendarShiftMode", {
  description: "顺延开关：inherit 按日历配置（缺省） / on 本次强制顺延 / off 本次强制不顺延",
});

/** 日历例外条目（D5-01 维护对象）。 */
export const CalendarDaySchema = z
  .object({
    date: DateOnlySchema,
    dayType: CalendarDayTypeSchema,
    name: z.string().nullable().openapi({ description: "名称（如「国庆节」「春节调休上班」）；可空" }),
    note: z.string().nullable().openapi({ description: "说明 / 来源（可空）" }),
    updatedAt: DateTimeSchema,
    updatedBy: UuidSchema.nullable().openapi({ description: "最近维护人 users.id" }),
  })
  .openapi("CalendarDay", { description: "日历例外条目；维护动作写审计留痕（object_type = calendar_day）" });

/** 顺延规则配置（D5-02，单行）。 */
export const CalendarShiftSettingsSchema = z
  .object({
    reminderShiftEnabled: z.boolean().openapi({ description: "提醒日期落在非工作日时是否顺延（可配置，D5-02）" }),
    shiftDirection: CalendarShiftDirectionSchema,
    updatedAt: DateTimeSchema,
    updatedBy: UuidSchema.nullable(),
  })
  .openapi("CalendarShiftSettings", { description: "顺延规则配置（单行）：是否顺延 + 顺延方向" });

/** 某年日历：例外清单 + 当前顺延配置（前端日历视图与任务日期提示一次拉取）。 */
export const CalendarYearSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    days: z.array(CalendarDaySchema).openapi({ description: "该年例外清单（放假 / 调休上班），按日期升序；未列出的日期按默认规则" }),
    settings: CalendarShiftSettingsSchema,
  })
  .openapi("CalendarYear", { description: "某年工作日历（例外清单 + 顺延配置）" });

/** 某一天的判定结果（D5-03：T-1/T+1 与顺延的输入口径）。 */
export const CalendarDayViewSchema = z
  .object({
    date: DateOnlySchema,
    kind: CalendarDayKindSchema,
    isWorkday: z.boolean(),
    name: z.string().nullable(),
    note: z.string().nullable(),
    source: z.enum(["default", "calendar"]).openapi({
      description: "判定来源：calendar = 命中例外表 / default = 默认规则（周末或普通工作日）",
    }),
  })
  .openapi("CalendarDayView", { description: "某一天的工作日判定（登录即可读，D5-03 为规则引擎提供日期依据）" });

/** 查询某年（例外清单）。 */
export const CalendarYearQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).openapi({ description: "公历年份（2000 ~ 2100）" }),
  })
  .openapi("CalendarYearQuery", { description: "按年查询工作日历（例外清单 + 顺延配置）" });

/** 查询某一天。 */
export const CalendarDayQuerySchema = z
  .object({
    date: DateOnlySchema.optional().openapi({ description: "业务日期 YYYY-MM-DD；缺省 = 今天（Asia/Shanghai）" }),
  })
  .openapi("CalendarDayQuery", { description: "按日查询工作日的判定结果" });

/** 维护单日例外（D5-01，仅管理员 · calendar.manage）：PUT 幂等 upsert —— 建改用同一入口。 */
export const CalendarDayUpsertBodySchema = z
  .object({
    dayType: CalendarDayTypeSchema,
    name: z.string().min(1).max(80).optional().openapi({ description: "名称（如「国庆节」）；不传则保持原值（新建时可空）" }),
    note: z.string().min(1).max(200).optional().openapi({ description: "说明 / 来源；不传则保持原值" }),
  })
  .openapi("CalendarDayUpsertBody", {
    description: "设置某天为放假 / 调休上班（幂等）：变更写审计留痕；响应为更新后的整年日历",
  });

/** 更新顺延配置（D5-02，仅管理员 · calendar.manage）：只传变更键。 */
export const CalendarSettingsUpdateBodySchema = z
  .object({
    reminderShiftEnabled: z.boolean().optional(),
    shiftDirection: CalendarShiftDirectionSchema.optional(),
  })
  .openapi("CalendarSettingsUpdateBody", { description: "更新顺延规则（只传变更键）：变更写审计留痕" });

/** 顺延求值（D5-02 / D5-03）：把业务日期顺延 / 提前到最近工作日。 */
export const CalendarShiftQuerySchema = z
  .object({
    date: DateOnlySchema.optional().openapi({ description: "业务日期；缺省 = 今天（Asia/Shanghai）" }),
    direction: CalendarShiftDirectionSchema.optional().openapi({ description: "顺延方向；缺省 = 按日历配置" }),
  })
  .openapi("CalendarShiftQuery", { description: "顺延求值：非工作日按方向移动到最近工作日；已是工作日则原样返回" });

export const CalendarShiftResultSchema = z
  .object({
    baseDate: DateOnlySchema,
    direction: CalendarShiftDirectionSchema,
    date: DateOnlySchema.openapi({ description: "顺延后的业务日期（已是工作日时为 baseDate 本身）" }),
    shifted: z.boolean(),
    skipped: z.array(DateOnlySchema).openapi({ description: "被跳过的非工作日（按移动顺序；未顺延为空）" }),
    baseKind: CalendarDayKindSchema.openapi({ description: "基准日期的判定结果（weekday / weekend / holiday / makeup_workday）" }),
    baseIsWorkday: z.boolean().openapi({ description: "基准日期是否工作日（false = 本次发生了顺延 / 提前）" }),
    kind: CalendarDayKindSchema.openapi({ description: "结果日期的判定结果（顺延到位后必为工作日）" }),
    name: z.string().nullable().openapi({ description: "结果日期命中的例外名称（可空）" }),
  })
  .openapi("CalendarShiftResult", { description: "顺延求值结果：基准日状态 + 顺延去向 + 跳过的非工作日" });

/** T-1/T+1 求值（D5-03）：自然日偏移 + 可选顺延 + 可选提醒时刻（Asia/Shanghai）。 */
export const CalendarOffsetQuerySchema = z
  .object({
    date: DateOnlySchema.optional().openapi({ description: "基准业务日期（任务的当前日期）；缺省 = 今天（Asia/Shanghai）" }),
    days: z.coerce.number().int().min(-366).max(366).openapi({ description: "自然日偏移：T-1 = -1，T+1 = +1，T+3 / T+7 同理" }),
    time: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
      .optional()
      .openapi({ description: "提醒时刻 HH:mm（Asia/Shanghai，如 R03 / R05 的 08:00）；缺省 = 只回业务日期，不回时刻" }),
    shift: CalendarShiftModeSchema.optional().openapi({ description: "是否顺延：缺省 inherit（按日历配置）" }),
  })
  .openapi("CalendarOffsetQuery", {
    description: "T-N / T+N 求值：以业务日期实时计算（改期后按新日期重算），可叠加节假日顺延与提醒时刻",
  });

export const CalendarOffsetResultSchema = z
  .object({
    baseDate: DateOnlySchema,
    days: z.number().int(),
    time: z.string().nullable(),
    shift: CalendarShiftModeSchema,
    rawDate: DateOnlySchema.openapi({ description: "自然日偏移结果（未顺延）" }),
    date: DateOnlySchema.openapi({ description: "最终业务日期（顺延后）" }),
    shifted: z.boolean(),
    shiftDirection: CalendarShiftDirectionSchema.nullable().openapi({ description: "实际执行的顺延方向；未顺延为 null" }),
    kind: CalendarDayKindSchema,
    name: z.string().nullable(),
    at: DateTimeSchema.nullable().openapi({
      description: "最终日期 + time 的 UTC 时间戳（Asia/Shanghai 换算）；未传 time 为 null",
    }),
  })
  .openapi("CalendarOffsetResult", { description: "T-N / T+N 求值结果（业务日期 + 可选时刻；跨年自动扩窗）" });

/** 日历契约的类型别名（前端与 handler 直接用）。 */
export type CalendarDayType = z.infer<typeof CalendarDayTypeSchema>;
export type CalendarDayKind = z.infer<typeof CalendarDayKindSchema>;
export type CalendarShiftDirection = z.infer<typeof CalendarShiftDirectionSchema>;
export type CalendarShiftMode = z.infer<typeof CalendarShiftModeSchema>;
export type CalendarDay = z.infer<typeof CalendarDaySchema>;
export type CalendarShiftSettings = z.infer<typeof CalendarShiftSettingsSchema>;
export type CalendarYear = z.infer<typeof CalendarYearSchema>;
export type CalendarDayView = z.infer<typeof CalendarDayViewSchema>;
export type CalendarYearQuery = z.infer<typeof CalendarYearQuerySchema>;
export type CalendarDayQuery = z.infer<typeof CalendarDayQuerySchema>;
export type CalendarDayUpsertBody = z.infer<typeof CalendarDayUpsertBodySchema>;
export type CalendarSettingsUpdateBody = z.infer<typeof CalendarSettingsUpdateBodySchema>;
export type CalendarShiftQuery = z.infer<typeof CalendarShiftQuerySchema>;
export type CalendarShiftResult = z.infer<typeof CalendarShiftResultSchema>;
export type CalendarOffsetQuery = z.infer<typeof CalendarOffsetQuerySchema>;
export type CalendarOffsetResult = z.infer<typeof CalendarOffsetResultSchema>;
