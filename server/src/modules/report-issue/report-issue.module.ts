import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/index.js";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { IssueRepository } from "./issue.repository.js";
import { IssueService } from "./issue.service.js";
import { IssueController, ReportController } from "./report-issue.controller.js";
import { ReportRepository } from "./report.repository.js";
import { ReportService } from "./report.service.js";

/**
 * report-issue 模块（领域 · M6）：日报（M6-01 / M6-02）与问题闭环（M6-02 / M6-03）。
 * 口径：一人一项目一天一条 + 草稿 / 提交 / 补填（A3-01 ~ A3-04）；提交回写任务进展（A3-08）与自动生成问题（A3-09 幂等）；
 * 问题四态允许回退且留痕（A3-10 / A3-13）。依赖 identity / permission / admin，不反向依赖其它业务模块。
 */
@Module({
  imports: [IdentityModule, PermissionModule, AdminModule],
  controllers: [ReportController, IssueController],
  providers: [ReportRepository, IssueRepository, ReportService, IssueService],
  exports: [ReportService, IssueService],
})
export class ReportIssueModule {}

