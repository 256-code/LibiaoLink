import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from "@nestjs/common";
import {
  CalendarDayQuerySchema,
  CalendarDayUpsertBodySchema,
  CalendarOffsetQuerySchema,
  CalendarSettingsUpdateBodySchema,
  CalendarShiftQuerySchema,
  CalendarYearQuerySchema,
  DateOnlySchema,
} from "@libiaolink/contracts";
import type {
  CalendarDayQuery,
  CalendarDayUpsertBody,
  CalendarDayView,
  CalendarOffsetQuery,
  CalendarOffsetResult,
  CalendarSettingsUpdateBody,
  CalendarShiftQuery,
  CalendarShiftResult,
  CalendarShiftSettings,
  CalendarYear,
  CalendarYearQuery,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard, RequirePermission } from "../permission/index.js";
import { CalendarService } from "./calendar.service.js";

// 路径参数：业务日期 YYYY-MM-DD（契约 DateOnly；非法日期 400；无该例外由服务层 404）
const dateParam = new ZodValidationPipe(DateOnlySchema);

/**
 * 工作日历接口（h8 · D5；契约 shared/src/modules/calendar.ts）：
 * 读（某年日历 / 单日判定 / 顺延配置 / 顺延与 T-N·T+N 求值）= 登录即可 —— 任务日期提示与规则引擎同一口径；
 * 写（例外维护 D5-01、顺延规则 D5-02）= 仅管理员（calendar.manage），每次变更写审计留痕，响应为更新后的整年日历 / 配置。
 * 求值接口实时计算（不缓存、不落库）：任务日期被修改后按新日期重算（v0.1 §4 时间语义）。
 */
@Controller("api/v1/calendar")
@UseGuards(SessionGuard, CsrfGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** 某年日历：例外清单（放假 / 调休上班）+ 顺延配置。 */
  @Get("days")
  listDays(@Query(new ZodValidationPipe(CalendarYearQuerySchema)) query: CalendarYearQuery): Promise<CalendarYear> {
    return this.calendar.getYear(query.year);
  }

  /** 某天的工作日判定（缺省今天）：顺延与 T-1/T+1 的输入口径。 */
  @Get("day")
  getDay(@Query(new ZodValidationPipe(CalendarDayQuerySchema)) query: CalendarDayQuery): Promise<CalendarDayView> {
    return this.calendar.getDay(query.date);
  }

  /** 设置某天为放假 / 调休上班（仅管理员）：幂等 upsert。 */
  @Put("days/:date")
  @UseGuards(ProjectAccessGuard)
  @RequirePermission("calendar.manage")
  setDay(
    @Param("date", dateParam) date: string,
    @Body(new ZodValidationPipe(CalendarDayUpsertBodySchema)) body: CalendarDayUpsertBody,
    @CurrentActorId() actorId: string,
  ): Promise<CalendarYear> {
    return this.calendar.setDay(date, body, actorId);
  }

  /** 删除某天的例外（仅管理员）：回落默认规则（周一至周五工作日、周六周日非工作日）；无该例外 404。 */
  @Delete("days/:date")
  @UseGuards(ProjectAccessGuard)
  @RequirePermission("calendar.manage")
  removeDay(@Param("date", dateParam) date: string, @CurrentActorId() actorId: string): Promise<CalendarYear> {
    return this.calendar.deleteDay(date, actorId);
  }

  /** 顺延规则配置（是否顺延 + 方向）。 */
  @Get("settings")
  getSettings(): Promise<CalendarShiftSettings> {
    return this.calendar.getSettings();
  }

  /** 更新顺延规则（仅管理员）。 */
  @Put("settings")
  @UseGuards(ProjectAccessGuard)
  @RequirePermission("calendar.manage")
  updateSettings(
    @Body(new ZodValidationPipe(CalendarSettingsUpdateBodySchema)) body: CalendarSettingsUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<CalendarShiftSettings> {
    return this.calendar.updateSettings(body, actorId);
  }

  /** 顺延求值：非工作日移动到最近工作日（golden：中途跳过的日期逐条返回）。 */
  @Get("shift")
  shift(@Query(new ZodValidationPipe(CalendarShiftQuerySchema)) query: CalendarShiftQuery): Promise<CalendarShiftResult> {
    return this.calendar.shift(query);
  }

  /** T-N / T+N 求值：自然日偏移 + 可选顺延 + 提醒时刻（如 R03 的「前 1 天 08:00」）。 */
  @Get("offset")
  offset(@Query(new ZodValidationPipe(CalendarOffsetQuerySchema)) query: CalendarOffsetQuery): Promise<CalendarOffsetResult> {
    return this.calendar.offset(query);
  }
}
