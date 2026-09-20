import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ProjectCreateBodySchema,
  ProjectListQuerySchema,
  ProjectUpdateBodySchema,
  UuidSchema,
  z,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectService } from "./project.service.js";
import type { ProjectFacetsResult, ProjectListResult, ProjectView } from "./project.service.js";

type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
type ProjectCreateBody = z.infer<typeof ProjectCreateBodySchema>;
type ProjectUpdateBody = z.infer<typeof ProjectUpdateBodySchema>;

/** 路径参数 id 校验：非法 uuid 直接 400 VALIDATION_FAILED（不落到 SQL 层）。 */
const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 项目接口（h2 · M2-01 项目 CRUD + M2-04 首页列表 / facets）；契约 shared/src/modules/projects.ts。
 * 读接口只要求登录；写接口叠加 CsrfGuard（X-CSRF-Token）；GET /facets 必须注册在 GET /:id 之前（否则被 :id 吃掉）。
 * 数据范围裁剪（非成员 404）随 M2-05 · h6 策略服务接入，本批为登录可读。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  /** 列表（M2-04）：多维筛选 + 时间闭区间 + 分页 + 排序；软删项目不可见（A5）。 */
  @Get()
  list(@Query(new ZodValidationPipe(ProjectListQuerySchema)) query: ProjectListQuery): Promise<ProjectListResult> {
    return this.projects.listProjects(query);
  }

  /** 首页分类计数（A6）：与列表同一筛选口径（禁止两套 SQL）。 */
  @Get("facets")
  facets(@Query(new ZodValidationPipe(ProjectListQuerySchema)) query: ProjectListQuery): Promise<ProjectFacetsResult> {
    return this.projects.getFacets(query);
  }

  /** 详情：软删 / 不存在统一 404 NOT_FOUND。 */
  @Get(":id")
  detail(@Param("id", uuidParam) id: string): Promise<ProjectView> {
    return this.projects.getProject(id);
  }

  /** 创建（M2-01）：201；编号重复 409 PROJECT_CODE_EXISTS；seq_no 由服务端分配（不接受传入）。 */
  @Post()
  create(@Body(new ZodValidationPipe(ProjectCreateBodySchema)) body: ProjectCreateBody): Promise<ProjectView> {
    return this.projects.createProject(body);
  }

  /** 更新（M2-01）：乐观锁（正文 version）；归档写保护（ADR-027）→ 409 PROJECT_ARCHIVED。 */
  @Patch(":id")
  update(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(ProjectUpdateBodySchema)) body: ProjectUpdateBody,
  ): Promise<ProjectView> {
    return this.projects.updateProject(id, body);
  }

  /** 软删（M2-01 · A5）：If-Match 回传当前 version 防误删；返回被删项目（此后列表 / 详情 / facets 均不可见）。 */
  @Delete(":id")
  remove(
    @Param("id", uuidParam) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectView> {
    return this.projects.deleteProject(id, parseIfMatch(ifMatch), actorId);
  }
}

/** If-Match 解析：口径与契约 ProjectDeleteHeadersSchema 一致（缺失 / 非纯数字 → 400 VALIDATION_FAILED）。 */
function parseIfMatch(value: string | undefined): number {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new AppError("VALIDATION_FAILED", "缺少 If-Match 请求头（需回传项目当前 version，防误删）");
  }
  return Number(value);
}
