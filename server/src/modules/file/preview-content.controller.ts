import { All, Controller, MethodNotAllowedException, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { UuidSchema } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { PreviewContentService } from "./preview-content.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 受控预览内容端点（S3 · 安全定稿 §3.2 · ADR-030）—— DocServer 查看器拉取口：
 * - **不挂 SessionGuard / CsrfGuard**：服务间调用，忽略 Cookie、不参与用户会话、不向浏览器来源开 CORS（C2）；
 * - **仅 GET**：`@All` 显式挡下其余方法 → 405（`MethodNotAllowedException`，不进业务逻辑；C2 / C4）；
 * - 鉴权（Bearer 三条校验）/ 404 同形 / 响应头 / fail-closed 全在 `PreviewContentService`。
 * 路由随 `shared/` 契约与 OpenAPI（C6）「契约可见」；网关不暴露（公网 404）是部署侧必要条件（S2 / D1）。
 */
@Controller("api/v1/files")
export class PreviewContentController {
  constructor(private readonly contents: PreviewContentService) {}

  @All(":id/versions/:versionId/preview-content")
  async previewContent(
    @Param("id", uuidParam) fileId: string,
    @Param("versionId", uuidParam) versionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (request.method !== "GET") {
      throw new MethodNotAllowedException("仅接受 GET（其余方法显式 405，不进业务逻辑）");
    }
    await this.contents.serve({
      fileId,
      versionId,
      originalUrl: request.originalUrl,
      authorization: request.headers.authorization ?? null,
      response,
    });
  }
}
