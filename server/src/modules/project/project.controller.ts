import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ProjectCreateBodySchema,
  ProjectListQuerySchema,
  ProjectMemberCreateBodySchema,
  ProjectUpdateBodySchema,
  UuidSchema,
  z,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard, ProjectScope, RequirePermission } from "../permission/index.js";
import type { ProjectScopeFilter } from "../permission/index.js";
import { ProjectMemberService } from "./project-member.service.js";
import type { ProjectMemberListResult, ProjectMemberView } from "./project-member.service.js";
import { ProjectService } from "./project.service.js";
import type { ProjectFacetsResult, ProjectListResult, ProjectView } from "./project.service.js";

type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
type ProjectCreateBody = z.infer<typeof ProjectCreateBodySchema>;
type ProjectUpdateBody = z.infer<typeof ProjectUpdateBodySchema>;
type ProjectMemberCreateBody = z.infer<typeof ProjectMemberCreateBodySchema>;

/** 路径参数 id 校验：非法 uuid 直接 400 VALIDATION_FAILED（不落到 SQL 层）。 */
const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 项目接口（h2 · M2-01 项目 CRUD + M2-04 首页列表 / facets）；契约 shared/src/modules/projects.ts。
 * 读接口要求登录 + 记录级可见（非成员 / 不可见项目 404）；写接口叠加 CsrfGuard（X-CSRF-Token）与功能权限位；
 * GET /facets 必须注册在 GET /:id 之前（否则被 :id 吃掉）。
 * 记录级与功能权限判定统一由 ProjectAccessGuard（h6 · ADR-011）完成：列表 / facets 取 @ProjectScope() 过滤。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectService,
    private readonly members: ProjectMemberService,
  ) {}

  /** 列表（M2-04）：多维筛选 + 时间闭区间 + 分页 + 排序；软删项目不可见（A5）。 */
  @Get()
  list(
    @Query(new ZodValidationPipe(ProjectListQuerySchema)) query: ProjectListQuery,
    @ProjectScope() scope: ProjectScopeFilter,
  ): Promise<ProjectListResult> {
    return this.projects.listProjects(query, scope);
  }

  /** 首页分类计数（A6）：与列表同一筛选口径（禁止两套 SQL）。 */
  @Get("facets")
  facets(
    @Query(new ZodValidationPipe(ProjectListQuerySchema)) query: ProjectListQuery,
    @ProjectScope() scope: ProjectScopeFilter,
  ): Promise<ProjectFacetsResult> {
    return this.projects.getFacets(query, scope);
  }

  /** 详情：软删 / 不存在统一 404 NOT_FOUND。 */
  @Get(":id")
  detail(@Param("id", uuidParam) id: string): Promise<ProjectView> {
    return this.projects.getProject(id);
  }

  /** 创建（M2-01）：201；编号重复 409 PROJECT_CODE_EXISTS；seq_no 由服务端分配（不接受传入）。需 project.create。 */
  @Post()
  @RequirePermission("project.create")
  create(
    @Body(new ZodValidationPipe(ProjectCreateBodySchema)) body: ProjectCreateBody,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectView> {
    return this.projects.createProject(body, actorId);
  }

  /** 更新（M2-01）：乐观锁（正文 version）；归档写保护（ADR-027）→ 409 PROJECT_ARCHIVED。需 project.update。 */
  @Patch(":id")
  @RequirePermission("project.update")
  update(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(ProjectUpdateBodySchema)) body: ProjectUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectView> {
    return this.projects.updateProject(id, body, actorId);
  }

  /** 软删（M2-01 · A5）：If-Match 回传当前 version 防误删；返回被删项目（此后列表 / 详情 / facets 均不可见）。需 project.delete。 */
  @Delete(":id")
  @RequirePermission("project.delete")
  remove(
    @Param("id", uuidParam) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectView> {
    return this.projects.deleteProject(id, parseIfMatch(ifMatch), actorId);
  }

  /** 成员名册（M2-05）：项目经理在前，同角色按工号升序；项目不存在 / 已软删统一 404。 */
  @Get(":id/members")
  listMembers(@Param("id", uuidParam) id: string): Promise<ProjectMemberListResult> {
    return this.members.listMembers(id);
  }

  /** 添加 / 更新成员（幂等 upsert；缺省角色 project_member）；归档项目 409 PROJECT_ARCHIVED。需 member.manage。 */
  @Post(":id/members")
  @HttpCode(200)
  @RequirePermission("member.manage")
  addMember(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(ProjectMemberCreateBodySchema)) body: ProjectMemberCreateBody,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectMemberView> {
    return this.members.addMember(id, body, actorId);
  }

  /** 移除成员：返回被移除的行；成员不存在 / 项目不存在统一 404。需 member.manage。 */
  @Delete(":id/members/:userId")
  @RequirePermission("member.manage")
  removeMember(
    @Param("id", uuidParam) id: string,
    @Param("userId", uuidParam) userId: string,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectMemberView> {
    return this.members.removeMember(id, userId, actorId);
  }
}

/** If-Match 解析：口径与契约 ProjectDeleteHeadersSchema 一致（缺失 / 非纯数字 → 400 VALIDATION_FAILED）。 */
function parseIfMatch(value: string | undefined): number {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new AppError("VALIDATION_FAILED", "缺少 If-Match 请求头（需回传项目当前 version，防误删）");
  }
  return Number(value);
}
