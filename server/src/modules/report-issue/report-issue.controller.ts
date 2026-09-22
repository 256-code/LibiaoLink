import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  DailyReportCreateBodySchema,
  DailyReportListQuerySchema,
  DailyReportSchema,
  DailyReportUpdateBodySchema,
  IssueDetailSchema,
  IssueListQuerySchema,
  IssueListResponseSchema,
  IssueUpdateBodySchema,
  DailyReportListResponseSchema,
  UuidSchema,
  z,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard, RequirePermission } from "../permission/index.js";
import { IssueService } from "./issue.service.js";
import { ReportService } from "./report.service.js";

type DailyReport = z.infer<typeof DailyReportSchema>;
type DailyReportListQuery = z.infer<typeof DailyReportListQuerySchema>;
type DailyReportListResponse = z.infer<typeof DailyReportListResponseSchema>;
type DailyReportCreateBody = z.infer<typeof DailyReportCreateBodySchema>;
type DailyReportUpdateBody = z.infer<typeof DailyReportUpdateBodySchema>;
type IssueListQuery = z.infer<typeof IssueListQuerySchema>;
type IssueListResponse = z.infer<typeof IssueListResponseSchema>;
type IssueDetail = z.infer<typeof IssueDetailSchema>;
type IssueUpdateBody = z.infer<typeof IssueUpdateBodySchema>;

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 日报接口（M6-01 / M6-02 · S6·report-issue）：契约 shared/src/modules/reports.ts。
 * 路径为**项目嵌套**（/projects/{id}/reports）—— ProjectAccessGuard 以 :id 解析项目上下文（记录级 404 + 权限位），
 * 契约提案 A21 的扁平路径（/reports/{id}）在守卫下拿不到项目上下文，差异已登记（前端功能需求.md §3.8 A21）。
 * 权限：读 report.view、写 report.fill（均项目成员平权，见 permission.rules PROJECT_MEMBER_IMPLIED_KEYS）。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  /** 日报列表（A7-02 子集）：日期区间 / 状态 / 提交人 + 分页，日期倒序。 */
  @Get(":id/reports")
  @RequirePermission("report.view")
  list(
    @Param("id", uuidParam) id: string,
    @Query(new ZodValidationPipe(DailyReportListQuerySchema)) query: DailyReportListQuery,
  ): Promise<DailyReportListResponse> {
    return this.reports.list(id, query);
  }

  /** 新报一天（草稿 / 提交）：重复 409 REPORT_ALREADY_EXISTS；提交触发 A3-08 回写与 A3-09 问题生成。 */
  @Post(":id/reports")
  @RequirePermission("report.fill")
  create(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(DailyReportCreateBodySchema)) body: DailyReportCreateBody,
    @CurrentActorId() actorId: string,
  ): Promise<DailyReport> {
    return this.reports.create(id, body, actorId);
  }

  /** 日报详情（A3-01 全字段 + 关联任务标题）。 */
  @Get(":id/reports/:reportId")
  @RequirePermission("report.view")
  detail(
    @Param("id", uuidParam) id: string,
    @Param("reportId", uuidParam) reportId: string,
  ): Promise<DailyReport> {
    return this.reports.detail(id, reportId);
  }

  /** 编辑 / 提交日报（乐观锁 version；date 不可改；已提交行不允许退回草稿）。 */
  @Patch(":id/reports/:reportId")
  @RequirePermission("report.fill")
  update(
    @Param("id", uuidParam) id: string,
    @Param("reportId", uuidParam) reportId: string,
    @Body(new ZodValidationPipe(DailyReportUpdateBodySchema)) body: DailyReportUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<DailyReport> {
    return this.reports.update(id, reportId, body, actorId);
  }
}

/**
 * 问题接口（M6-02 / M6-03 · A3-10 ~ A3-13）：契约 shared/src/modules/issues.ts。
 * 路径同为项目嵌套；读 issue.view、写 issue.manage（成员平权）；四态允许回退且留痕，一次更新写一条事件。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class IssueController {
  constructor(private readonly issues: IssueService) {}

  /** 问题列表（问题追踪表 / 问题看板同源）。 */
  @Get(":id/issues")
  @RequirePermission("issue.view")
  list(
    @Param("id", uuidParam) id: string,
    @Query(new ZodValidationPipe(IssueListQuerySchema)) query: IssueListQuery,
  ): Promise<IssueListResponse> {
    return this.issues.list(id, query);
  }

  /** 问题详情 = 问题 + 处理过程留痕（时间正序）。 */
  @Get(":id/issues/:issueId")
  @RequirePermission("issue.view")
  detail(
    @Param("id", uuidParam) id: string,
    @Param("issueId", uuidParam) issueId: string,
  ): Promise<IssueDetail> {
    return this.issues.detail(id, issueId);
  }

  /** 问题更新（状态流转 / 解决方案 / 分派 / 时限）：乐观锁 version；允许回退且留痕。 */
  @Patch(":id/issues/:issueId")
  @RequirePermission("issue.manage")
  update(
    @Param("id", uuidParam) id: string,
    @Param("issueId", uuidParam) issueId: string,
    @Body(new ZodValidationPipe(IssueUpdateBodySchema)) body: IssueUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<IssueDetail> {
    return this.issues.update(id, issueId, body, actorId);
  }
}
