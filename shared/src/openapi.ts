import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "./zod.ts";
import { IdempotencyKeySchema, UuidSchema } from "./common/conventions.ts";
import { ApiErrorSchema } from "./common/errors.ts";
import {
  ProjectCreateBodySchema,
  ProjectFacetsSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectUpdateBodySchema,
} from "./modules/projects.ts";
import {
  TaskCreateBodySchema,
  TaskCreateFromTemplateBodySchema,
  TaskCreateFromTemplateResponseSchema,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskProgressUpdateBodySchema,
  TaskSchema,
  TaskUpdateBodySchema,
} from "./modules/tasks.ts";
import {
  TaskNodeListQuerySchema,
  TaskNodeListResponseSchema,
  TaskTemplateCreateBodySchema,
  TaskTemplateDeleteBodySchema,
  TaskTemplateDeleteResponseSchema,
  TaskTemplateListQuerySchema,
  TaskTemplateListResponseSchema,
  TaskTemplateSchema,
  TaskTemplateUpdateBodySchema,
} from "./modules/templates.ts";
import {
  BlueprintImportBodySchema,
  BlueprintSaveBodySchema,
  BlueprintViewSchema,
  CanCompleteResponseSchema,
  NodeCompleteBodySchema,
  NodeCompleteResponseSchema,
  NodeCreateBodySchema,
  NodeDeleteBodySchema,
  ProjectFlowSchema,
  ProjectNodeSchema,
} from "./modules/flow.ts";
import { CallbackQuerySchema, LoginQuerySchema, MeResponseSchema } from "./modules/identity.ts";
import {
  ChangeRequestDetailSchema,
  ChangeRequestListQuerySchema,
  ChangeRequestListResponseSchema,
  FileDetailSchema,
  FileDownloadUrlResponseSchema,
  FileFinalizeBodySchema,
  FileListQuerySchema,
  FileListResponseSchema,
  FilePurgeBodySchema,
  FilePurgeResponseSchema,
  FileRecycleBodySchema,
  FileRestoreBodySchema,
  FileRollbackBodySchema,
  FileRollbackResponseSchema,
  FileSchema,
  FileVersionListResponseSchema,
  UploadAbortResponseSchema,
  UploadCompleteBodySchema,
  UploadCompleteResponseSchema,
  UploadCreateBodySchema,
  UploadCreateResponseSchema,
  UploadPartsBodySchema,
  UploadPartsResponseSchema,
  UploadSessionViewSchema,
} from "./modules/files.ts";

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const errorResponse = (description: string) => ({ description, ...json(ApiErrorSchema) });

const commonErrors = {
  400: errorResponse("契约校验失败（VALIDATION_FAILED）"),
  401: errorResponse("未认证（AUTH_REQUIRED）"),
  403: errorResponse("无权限（FORBIDDEN）"),
  404: errorResponse("资源不存在或不可见（NOT_FOUND，统一 404 语义）"),
  409: errorResponse("冲突（VERSION_CONFLICT / 状态不允许当前操作）"),
  410: errorResponse("上传会话已过期（UPLOAD_SESSION_EXPIRED，需重新发起上传）"),
  422: errorResponse("业务校验未通过（门禁 / 蓝图校验，含明细）"),
} as const;

const idParams = z.object({ id: UuidSchema });
const idempotencyHeader = z.object({ "Idempotency-Key": IdempotencyKeySchema.optional() });

/**
 * /api/v1 契约唯一入口：由各模块 Zod schema 注册而来。
 * 生成物（generated/openapi.json 与 generated/api-types.d.ts）由 npm run generate 产出，禁止手改（CONTRIBUTING §14）。
 */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  // ---- 项目与首页分类 ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/projects",
    tags: ["projects"],
    summary: "项目列表（分页 + 多维筛选 + 排序）",
    request: { query: ProjectListQuerySchema },
    responses: {
      200: { description: "项目列表", ...json(ProjectListResponseSchema) },
      400: commonErrors[400],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects",
    tags: ["projects"],
    summary: "新建项目（编号由创建人填写；默认按已发布蓝图导入节点）",
    request: { headers: idempotencyHeader, body: json(ProjectCreateBodySchema) },
    responses: {
      201: { description: "创建成功", ...json(ProjectSchema) },
      400: commonErrors[400],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/facets",
    tags: ["projects"],
    summary: "首页分类计数（与列表同一筛选口径）",
    request: { query: ProjectListQuerySchema },
    responses: {
      200: { description: "各维度计数", ...json(ProjectFacetsSchema) },
      400: commonErrors[400],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}",
    tags: ["projects"],
    summary: "项目详情",
    request: { params: idParams },
    responses: {
      200: { description: "项目", ...json(ProjectSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/projects/{id}",
    tags: ["projects"],
    summary: "更新项目（乐观锁：必须回传 version）",
    request: { params: idParams, body: json(ProjectUpdateBodySchema) },
    responses: {
      200: { description: "更新后的项目", ...json(ProjectSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/summary",
    tags: ["projects"],
    summary: "项目总览四格（当前阶段 / 逾期 / 已完成 / 总数）",
    request: { params: idParams },
    responses: {
      200: { description: "总览统计", ...json(ProjectSummarySchema) },
      404: commonErrors[404],
    },
  });

  // ---- 任务 ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/tasks",
    tags: ["tasks"],
    summary: "项目任务列表（表格与抽屉直接渲染的全字段）",
    request: { params: idParams, query: TaskListQuerySchema },
    responses: {
      200: { description: "任务列表", ...json(TaskListResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/projects/{id}/tasks/{taskId}/progress",
    tags: ["tasks"],
    summary: "更新任务进度（联动状态与完成日期，写审计；回退同样留痕）",
    request: {
      params: z.object({ id: UuidSchema, taskId: UuidSchema }),
      body: json(TaskProgressUpdateBodySchema),
    },
    responses: {
      200: { description: "更新后的任务", ...json(TaskSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/tasks",
    tags: ["tasks"],
    summary: "创建任务（从任务节点库 / 任务模板生成或手工创建；headcount / priority 可空）",
    request: { params: idParams, headers: idempotencyHeader, body: json(TaskCreateBodySchema) },
    responses: {
      201: { description: "创建成功", ...json(TaskSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/projects/{id}/tasks/{taskId}",
    tags: ["tasks"],
    summary: "编辑任务（乐观锁；任务描述 / 成果文件按 A1-17 锁定，进度走 /progress）",
    request: { params: z.object({ id: UuidSchema, taskId: UuidSchema }), body: json(TaskUpdateBodySchema) },
    responses: {
      200: { description: "更新后的任务", ...json(TaskSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/tasks/from-template",
    tags: ["tasks"],
    summary: "从任务模板批量生成任务（「整套添加」；按节点判重，已存在的跳过）",
    request: { params: idParams, headers: idempotencyHeader, body: json(TaskCreateFromTemplateBodySchema) },
    responses: {
      201: { description: "创建结果（created + skipped）", ...json(TaskCreateFromTemplateResponseSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  // ---- 任务节点库与任务模板（A1-16 / A1-17；对齐项 A11） ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/task-nodes",
    tags: ["templates"],
    summary: "任务节点库（任务模板的节点来源；按阶段过滤）",
    request: { query: TaskNodeListQuerySchema },
    responses: { 200: { description: "节点库列表", ...json(TaskNodeListResponseSchema) } },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/task-templates",
    tags: ["templates"],
    summary: "任务模板列表（按阶段过滤；含节点顺序与名称摘要）",
    request: { query: TaskTemplateListQuerySchema },
    responses: { 200: { description: "模板列表", ...json(TaskTemplateListResponseSchema) } },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/task-templates/{id}",
    tags: ["templates"],
    summary: "模板详情",
    request: { params: idParams },
    responses: {
      200: { description: "模板", ...json(TaskTemplateSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/task-templates",
    tags: ["templates"],
    summary: "新建任务模板（名称 + 阶段 + 节点顺序）",
    request: { headers: idempotencyHeader, body: json(TaskTemplateCreateBodySchema) },
    responses: {
      201: { description: "创建成功", ...json(TaskTemplateSchema) },
      400: commonErrors[400],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/task-templates/{id}",
    tags: ["templates"],
    summary: "编辑模板（改名 / 节点全量替换；乐观锁）",
    request: { params: idParams, body: json(TaskTemplateUpdateBodySchema) },
    responses: {
      200: { description: "更新后的模板", ...json(TaskTemplateSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/task-templates/{id}",
    tags: ["templates"],
    summary: "删除模板（即生效；已生成的项目任务不变）",
    request: { params: idParams, body: json(TaskTemplateDeleteBodySchema) },
    responses: {
      200: { description: "已删除", ...json(TaskTemplateDeleteResponseSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  // ---- 流程节点与蓝图 ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/blueprint",
    tags: ["flow"],
    summary: "当前蓝图（含版本与发布状态）",
    responses: { 200: { description: "蓝图视图", ...json(BlueprintViewSchema) } },
  });

  registry.registerPath({
    method: "put",
    path: "/api/v1/blueprint",
    tags: ["flow"],
    summary: "保存蓝图草稿（必须通过 schema + 引用校验）",
    request: { headers: idempotencyHeader, body: json(BlueprintSaveBodySchema) },
    responses: {
      200: { description: "保存后的蓝图视图", ...json(BlueprintViewSchema) },
      400: commonErrors[400],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/blueprint/publish",
    tags: ["flow"],
    summary: "发布蓝图（递增 blueprintVersion；不影响已生成项目）",
    request: { headers: idempotencyHeader, body: json(BlueprintSaveBodySchema) },
    responses: {
      200: { description: "发布后的蓝图视图", ...json(BlueprintViewSchema) },
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/blueprint/export",
    tags: ["flow"],
    summary: "导出蓝图 JSON（自建格式，round-trip 无损）",
    responses: { 200: { description: "蓝图 JSON", ...json(BlueprintViewSchema.shape.blueprint) } },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/blueprint/import",
    tags: ["flow"],
    summary: "导入蓝图 JSON（保存为草稿；重复导入幂等）",
    request: { headers: idempotencyHeader, body: json(BlueprintImportBodySchema) },
    responses: {
      200: { description: "导入后的蓝图视图", ...json(BlueprintViewSchema) },
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/flow",
    tags: ["flow"],
    summary: "项目流程（阶段 + 节点 + 约束 + 状态）",
    request: { params: idParams },
    responses: {
      200: { description: "项目流程", ...json(ProjectFlowSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/nodes",
    tags: ["flow"],
    summary: "新增节点（一期仅模板节点池；留痕）",
    request: { params: idParams, headers: idempotencyHeader, body: json(NodeCreateBodySchema) },
    responses: {
      201: { description: "新节点", ...json(ProjectNodeSchema) },
      400: commonErrors[400],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/projects/{id}/nodes/{nodeId}",
    tags: ["flow"],
    summary: "删除节点（软删除 + 留痕；关联成果物时先提示）",
    request: { params: z.object({ id: UuidSchema, nodeId: UuidSchema }), body: json(NodeDeleteBodySchema) },
    responses: {
      200: { description: "已删除的节点（status=deleted）", ...json(ProjectNodeSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/nodes/{id}/complete",
    tags: ["flow"],
    summary: "完成节点（服务端事务内过门禁；缺件返回 422 + missing 明细）",
    request: { params: idParams, headers: idempotencyHeader, body: json(NodeCompleteBodySchema) },
    responses: {
      200: { description: "完成后的节点", ...json(NodeCompleteResponseSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/nodes/{id}/can-complete",
    tags: ["flow"],
    summary: "完成预检（UI 置灰依据；不替代服务端强校验）",
    request: { params: idParams },
    responses: {
      200: { description: "预检结果", ...json(CanCompleteResponseSchema) },
      404: commonErrors[404],
    },
  });

  // ---- 文件与变更（v0.2 §5.1-5.3；系统功能书 A4 / D2 接口面）----
  const uploadParams = z.object({ id: UuidSchema, uploadId: UuidSchema });
  const versionParams = z.object({ id: UuidSchema, versionId: UuidSchema });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/files",
    tags: ["files"],
    summary: "项目文件库列表（按类型 / 节点 / 任务 / 状态 / 上传人筛选）",
    request: { params: idParams, query: FileListQuerySchema },
    responses: {
      200: { description: "文件列表", ...json(FileListResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/uploads",
    tags: ["files"],
    summary: "发起上传（分片直传；version = 草稿替换 / change = 定档后变更，申请即通过）",
    request: { headers: idempotencyHeader, body: json(UploadCreateBodySchema) },
    responses: {
      201: { description: "上传会话（含分片参数；complete 时登记版本）", ...json(UploadCreateResponseSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/files/{id}",
    tags: ["files"],
    summary: "文件详情（含当前版本）",
    request: { params: idParams },
    responses: {
      200: { description: "文件详情", ...json(FileDetailSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/files/{id}/versions",
    tags: ["files"],
    summary: "版本链（历史版本可预览 / 下载，受权限控制）",
    request: { params: idParams },
    responses: {
      200: { description: "版本链", ...json(FileVersionListResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/files/{id}/versions/{versionId}/download-url",
    tags: ["files"],
    summary: "版本短时签名下载（写查看 / 下载审计）",
    request: { params: versionParams },
    responses: {
      200: { description: "签名下载地址", ...json(FileDownloadUrlResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/uploads/{uploadId}/parts",
    tags: ["files"],
    summary: "批量获取分片预签名 URL（首传 / 断点续传共用）",
    request: { params: uploadParams, body: json(UploadPartsBodySchema) },
    responses: {
      200: { description: "分片预签名 URL", ...json(UploadPartsResponseSchema) },
      404: commonErrors[404],
      410: commonErrors[410],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/files/{id}/uploads/{uploadId}",
    tags: ["files"],
    summary: "上传会话状态（已传 / 缺失分片；断点续传依据）",
    request: { params: uploadParams },
    responses: {
      200: { description: "会话状态", ...json(UploadSessionViewSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/uploads/{uploadId}/complete",
    tags: ["files"],
    summary: "完成上传（登记 file_version；intent=change 同事务落变更）",
    request: { params: uploadParams, headers: idempotencyHeader, body: json(UploadCompleteBodySchema) },
    responses: {
      200: { description: "文件、版本与（change 意图的）变更记录", ...json(UploadCompleteResponseSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
      410: commonErrors[410],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/uploads/{uploadId}/abort",
    tags: ["files"],
    summary: "取消上传会话（未完成分片由对象存储生命周期兜底清理）",
    request: { params: uploadParams },
    responses: {
      200: { description: "已取消的会话", ...json(UploadAbortResponseSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/finalize",
    tags: ["files"],
    summary: "定档（锁版；此后修改必须走变更）",
    request: { params: idParams, headers: idempotencyHeader, body: json(FileFinalizeBodySchema) },
    responses: {
      200: { description: "已定档的文件", ...json(FileSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/rollback",
    tags: ["files"],
    summary: "回溯生成新版本（不删除历史；定档后按变更流留痕）",
    request: { params: idParams, headers: idempotencyHeader, body: json(FileRollbackBodySchema) },
    responses: {
      200: { description: "回溯后的文件与新版本", ...json(FileRollbackResponseSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/recycle",
    tags: ["files"],
    summary: "移入回收站（默认保留 30 天，可恢复）",
    request: { params: idParams, headers: idempotencyHeader, body: json(FileRecycleBodySchema) },
    responses: {
      200: { description: "已回收的文件", ...json(FileSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/restore",
    tags: ["files"],
    summary: "从回收站恢复（回到进入前状态）",
    request: { params: idParams, headers: idempotencyHeader, body: json(FileRestoreBodySchema) },
    responses: {
      200: { description: "已恢复的文件", ...json(FileSchema) },
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/files/{id}/purge",
    tags: ["files"],
    summary: "彻底删除（仅管理员；对象与元数据一并清理，操作留痕）",
    request: { params: idParams, headers: idempotencyHeader, body: json(FilePurgeBodySchema) },
    responses: {
      200: { description: "已彻底删除", ...json(FilePurgeResponseSchema) },
      403: commonErrors[403],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/change-requests",
    tags: ["changes"],
    summary: "变更记录列表（按阶段 / 节点 / 文件 / 申请人 / 关键字检索）",
    request: { params: idParams, query: ChangeRequestListQuerySchema },
    responses: {
      200: { description: "变更记录列表", ...json(ChangeRequestListResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/change-requests/{id}",
    tags: ["changes"],
    summary: "变更详情（含变更后文件与版本）",
    request: { params: idParams },
    responses: {
      200: { description: "变更详情", ...json(ChangeRequestDetailSchema) },
      404: commonErrors[404],
    },
  });

  // ---- 认证与会话（根路径 /auth/*，浏览器直接导航；ADR-010） ----
  registry.registerPath({
    method: "get",
    path: "/auth/login",
    tags: ["auth"],
    summary: "登录入口：302 跳转 Casdoor 授权页（PKCE + state；returnTo 为同源回跳路径）",
    request: { query: LoginQuerySchema },
    responses: { 302: { description: "跳转 SSO 授权页（Set-Cookie: 转场 state / verifier）" } },
  });

  registry.registerPath({
    method: "get",
    path: "/auth/callback",
    tags: ["auth"],
    summary: "登录回调：校验 state + PKCE 换令牌，建立 HttpOnly 会话后 302 回 returnTo",
    request: { query: CallbackQuerySchema },
    responses: {
      302: { description: "会话建立，跳转应用内路径" },
      400: { description: "回调校验失败（AUTH_CALLBACK_FAILED）", ...json(ApiErrorSchema) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/auth/me",
    tags: ["auth"],
    summary: "当前登录用户（会话无效 / 超时返回 401，前端据此重新走 SSO）",
    responses: {
      200: { description: "已登录用户", ...json(MeResponseSchema) },
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/auth/logout",
    tags: ["auth"],
    summary: "登出：清本地会话并 302 到 Casdoor 单点登出（携 id_token_hint）",
    responses: { 302: { description: "跳转 SSO 登出（本地会话已撤销）" } },
  });

  return new OpenApiGeneratorV31(registry.definitions, { sortComponents: "alphabetically" }).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "LibiaoLink API（市场项目管理系统）",
      version: "0.1.0",
      description:
        "契约唯一真相 = shared/src 下的 Zod schema（技术设计v0.2 §7）；本文件与 generated/api-types.d.ts 由工具生成，禁止手改（CONTRIBUTING §14）。",
    },
    servers: [{ url: "/", description: "同源部署（Nginx 反代 /api/v1）" }],
    tags: [
      { name: "projects", description: "项目主数据与首页分类（v0.2 §8）" },
      { name: "tasks", description: "任务与进度（v0.2 §2.3 / §2.4）" },
      { name: "templates", description: "任务节点库与任务模板（A1-16 / A1-17 流程节点模板化）" },
      { name: "flow", description: "流程节点与蓝图（v0.2 §3）" },
      { name: "auth", description: "认证与会话（ADR-010；根路径 /auth/*，OIDC + PKCE）" },
      { name: "files", description: "文件、版本、上传、定档与回收站（v0.2 §5.1-5.2 / A4）" },
      { name: "changes", description: "变更记录（一期申请即通过、全程留痕；v0.2 §5.3 / A4-13~A4-15）" },
    ],
  });
}
