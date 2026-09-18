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
import { TaskListQuerySchema, TaskListResponseSchema, TaskProgressUpdateBodySchema, TaskSchema } from "./modules/tasks.ts";
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

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const errorResponse = (description: string) => ({ description, ...json(ApiErrorSchema) });

const commonErrors = {
  400: errorResponse("契约校验失败（VALIDATION_FAILED）"),
  401: errorResponse("未认证（AUTH_REQUIRED）"),
  403: errorResponse("无权限（FORBIDDEN）"),
  404: errorResponse("资源不存在或不可见（NOT_FOUND，统一 404 语义）"),
  409: errorResponse("冲突（VERSION_CONFLICT / 状态不允许当前操作）"),
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
      { name: "flow", description: "流程节点与蓝图（v0.2 §3）" },
      { name: "auth", description: "认证与会话（ADR-010；根路径 /auth/*，OIDC + PKCE）" },
    ],
  });
}
