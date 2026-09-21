import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { FileListQuerySchema, FileListResponseSchema, UuidSchema, z } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard } from "../permission/index.js";
import { FileService } from "./file.service.js";

type FileListQuery = z.infer<typeof FileListQuerySchema>;

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 项目文件库接口（M4-03 · A4-01 / A4-09）：契约 shared/src/modules/files.ts 的 `GET /projects/{id}/files`。
 *
 * 记录级可见性由 ProjectAccessGuard 处理（路径 `:id` 非成员 / 不存在 → 404，防 IDOR）；读 = 项目可见即可。
 * `file_links` 双向跳转：任务 / 节点 / 日报 / 问题 / 变更侧的「查文件」走本列表的 filter（读写链路见 FileService）。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class FileLibraryController {
  constructor(private readonly files: FileService) {}

  /** 文件库列表：状态 / 类型 / 节点 / 任务 / 上传人筛选 + 文件名关键字 + 白名单排序 + 分页。 */
  @Get(":id/files")
  list(
    @Param("id", uuidParam) id: string,
    @Query(new ZodValidationPipe(FileListQuerySchema)) query: FileListQuery,
  ): Promise<z.infer<typeof FileListResponseSchema>> {
    return this.files.listProjectFiles(id, query);
  }
}
