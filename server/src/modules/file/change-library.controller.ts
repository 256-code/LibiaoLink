import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ChangeRequestListQuerySchema, ChangeRequestListResponseSchema, UuidSchema, z } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard } from "../permission/index.js";
import { ChangeService } from "./change.service.js";

type ChangeListQuery = z.infer<typeof ChangeRequestListQuerySchema>;

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 项目变更记录列表（M4-04 读面 · A4-15）：契约 shared/src/modules/files.ts 的 `GET /projects/{id}/change-requests`。
 *
 * 记录级可见性由 ProjectAccessGuard 处理（路径 `:id` 非成员 / 不存在 → 404，防 IDOR）；读 = 项目可见即可。
 * 「按任务检索」契约无 filter[taskId]：任务侧经任务详情的 changeLinks 跳转，或前端用「任务 → 文件」两步取 fileId 后走
 * `filter[fileId]`（契约扩项请走契约切片，本切片零改动）。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class ChangeRequestLibraryController {
  constructor(private readonly changes: ChangeService) {}

  /** 变更记录列表：阶段（多值）/ 节点 / 文件 / 申请人筛选 + 关键字（原因 / 前后摘要）+ 白名单排序 + 分页。 */
  @Get(":id/change-requests")
  list(
    @Param("id", uuidParam) id: string,
    @Query(new ZodValidationPipe(ChangeRequestListQuerySchema)) query: ChangeListQuery,
  ): Promise<z.infer<typeof ChangeRequestListResponseSchema>> {
    return this.changes.listProjectChanges(id, query);
  }
}
