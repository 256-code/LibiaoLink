import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ChangeRequestDetailSchema, UuidSchema, z } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ChangeService } from "./change.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 变更记录接口（M4-04 读面 · A4-15）：契约 shared/src/modules/files.ts 的 `GET /change-requests/{id}`。
 *
 * 路径不含项目（变更 id 全局唯一），因此不挂 ProjectAccessGuard —— 记录级可见性在 ChangeService 内按
 * 变更所属项目判定（非成员 / 不存在统一 404，防 IDOR；同 FileController 的会话状态读面口径）。
 */
@Controller("api/v1/change-requests")
@UseGuards(SessionGuard, CsrfGuard)
export class ChangeRequestController {
  constructor(private readonly changes: ChangeService) {}

  /** 变更详情：变更记录 + 变更后文件 + 变更后版本。 */
  @Get(":id")
  detail(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
  ): Promise<z.infer<typeof ChangeRequestDetailSchema>> {
    return this.changes.getChange(id, actorId);
  }
}
