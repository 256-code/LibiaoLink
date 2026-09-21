import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import {
  UploadAbortResponseSchema,
  UploadCompleteBodySchema,
  UploadCompleteResponseSchema,
  UploadCreateBodySchema,
  UploadCreateResponseSchema,
  UploadPartsBodySchema,
  UploadPartsResponseSchema,
  UploadSessionViewSchema,
  UuidSchema,
  z,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { FileService } from "./file.service.js";

type UploadCreateBody = z.infer<typeof UploadCreateBodySchema>;
type UploadCreateResponse = z.infer<typeof UploadCreateResponseSchema>;
type UploadPartsBody = z.infer<typeof UploadPartsBodySchema>;
type UploadPartsResponse = z.infer<typeof UploadPartsResponseSchema>;
type UploadSessionView = z.infer<typeof UploadSessionViewSchema>;
type UploadCompleteBody = z.infer<typeof UploadCompleteBodySchema>;
type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;
type UploadAbortResponse = z.infer<typeof UploadAbortResponseSchema>;

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 文件上传接口（M4-01 · S7·file）：契约 shared/src/modules/files.ts（上传 5 条路径）。
 *
 * 权限在服务层判定（`file.upload` 需项目上下文：成员平权；读取会话状态 = 项目可见即可），
 * 因此这里只用会话 + CSRF 守卫；记录级可见性（非成员 404）在 FileService 装载文件时按项目判定。
 * 文件详情 / 版本链 / 定档 / 回溯 / 回收 / 变更按 M4-02~M4-04 后续切片接入本控制器。
 */
@Controller("api/v1/files")
@UseGuards(SessionGuard, CsrfGuard)
export class FileController {
  constructor(private readonly files: FileService) {}

  /** 发起上传（分片直传；返回文件、会话与秒传提示）。 */
  @Post("uploads")
  create(
    @Body(new ZodValidationPipe(UploadCreateBodySchema)) body: UploadCreateBody,
    @CurrentActorId() actorId: string,
  ): Promise<UploadCreateResponse> {
    return this.files.createUpload(body, actorId);
  }

  /** 批量取分片预签名 URL（首传 / 断点续传共用）。契约响应码 = 200。 */
  @Post(":id/uploads/:uploadId/parts")
  @HttpCode(200)
  parts(
    @Param("id", uuidParam) id: string,
    @Param("uploadId", uuidParam) uploadId: string,
    @Body(new ZodValidationPipe(UploadPartsBodySchema)) body: UploadPartsBody,
    @CurrentActorId() actorId: string,
  ): Promise<UploadPartsResponse> {
    return this.files.signParts(id, uploadId, body, actorId);
  }

  /** 上传会话状态（已传 / 缺失分片；断点续传依据）。 */
  @Get(":id/uploads/:uploadId")
  status(
    @Param("id", uuidParam) id: string,
    @Param("uploadId", uuidParam) uploadId: string,
    @CurrentActorId() actorId: string,
  ): Promise<UploadSessionView> {
    return this.files.getUpload(id, uploadId, actorId);
  }

  /** 完成上传：校验分片 → 合并 → 复制到契约键 → 登记版本（intent=change 随 M4-04）。契约响应码 = 200。 */
  @Post(":id/uploads/:uploadId/complete")
  @HttpCode(200)
  complete(
    @Param("id", uuidParam) id: string,
    @Param("uploadId", uuidParam) uploadId: string,
    @Body(new ZodValidationPipe(UploadCompleteBodySchema)) body: UploadCompleteBody,
    @CurrentActorId() actorId: string,
  ): Promise<UploadCompleteResponse> {
    return this.files.completeUpload(id, uploadId, body, actorId);
  }

  /** 取消上传（幂等；已完成会话 409）。契约响应码 = 200。 */
  @Post(":id/uploads/:uploadId/abort")
  @HttpCode(200)
  abort(
    @Param("id", uuidParam) id: string,
    @Param("uploadId", uuidParam) uploadId: string,
    @CurrentActorId() actorId: string,
  ): Promise<UploadAbortResponse> {
    return this.files.abortUpload(id, uploadId, actorId);
  }
}
