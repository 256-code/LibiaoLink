import { Injectable } from "@nestjs/common";
import {
  ChangeRequestDetailSchema,
  ChangeRequestListResponseSchema,
  ChangeRequestSchema,
  z,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { PermissionService } from "../permission/index.js";
import { parseChangeListFilter, parseChangeListSort, type ChangeRequestListQueryInput } from "./change.query.js";
import { FileRepository, type ChangeRequestJoinedRow } from "./file.repository.js";
import { toChangeRequestView, toFileView, toVersionView } from "./file.service.js";

type ChangeRequestView = z.infer<typeof ChangeRequestSchema>;
type ChangeListResponse = z.infer<typeof ChangeRequestListResponseSchema>;
type ChangeDetail = z.infer<typeof ChangeRequestDetailSchema>;

/**
 * 变更记录读面（S7·file · M4-04 读面 · A4-15）：变更记录列表 / 详情。
 *
 * 写入面（申请即通过）在 FileService（上传管道 complete / 定档后回溯）；本服务只读：
 * `change_requests` 一行 → 按 `file_versions.change_request_id` 反查变更后文件 / 版本（一期一变更一版本）。
 * 可见性：列表由 ProjectAccessGuard 按路径项目判定；详情路径不含项目，服务层按变更所属项目判定
 * （非成员 404，防 IDOR —— 与 file 模块读面同一口径）。视图映射复用写入面的 toChangeRequestView，
 * 避免「写面 / 读面」两处字段口径漂移。
 */
@Injectable()
export class ChangeService {
  constructor(
    private readonly repository: FileRepository,
    private readonly permission: PermissionService,
  ) {}

  /** GET /projects/{id}/change-requests：变更记录列表（阶段 / 节点 / 文件 / 申请人筛选 + 关键字 + 排序 + 分页）。 */
  async listProjectChanges(projectId: string, query: ChangeRequestListQueryInput): Promise<ChangeListResponse> {
    const filter = parseChangeListFilter(projectId, query);
    const sorts = parseChangeListSort(query.sort);
    const offset = (query.page - 1) * query.limit;
    const { items, total } = await this.repository.listChangeRequests(projectId, filter, sorts, query.limit, offset);
    return { items: items.map(toChangeListView), page: query.page, limit: query.limit, total };
  }

  /** GET /change-requests/{id}：变更详情（含变更后文件与版本）；不存在 / 不可见一律 404。 */
  async getChange(changeRequestId: string, actorId: string): Promise<ChangeDetail> {
    const row = await this.repository.findChangeRequestJoinedById(changeRequestId);
    if (row === null) throw new AppError("NOT_FOUND", "变更记录不存在");
    await this.permission.assertProjectVisible(actorId, row.projectId);
    const file = await this.repository.findFileById(row.fileId);
    const version = await this.repository.findVersionById(row.fileId, row.versionId);
    if (file === null || version === null) {
      throw new AppError("INTERNAL", "变更记录的变更后文件 / 版本缺失（数据不一致）");
    }
    return { ...toChangeListView(row), file: toFileView(file), version: toVersionView(version) };
  }
}

/** 读面行 → 契约视图：复用写入面的映射（同一份字段口径）。 */
function toChangeListView(row: ChangeRequestJoinedRow): ChangeRequestView {
  return toChangeRequestView(row, row.fileId, { id: row.versionId, seq: row.versionSeq });
}
