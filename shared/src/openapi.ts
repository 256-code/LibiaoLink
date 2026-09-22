import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "./zod.ts";
import { DateOnlySchema, IdempotencyKeySchema, UuidSchema } from "./common/conventions.ts";
import { StageKeySchema } from "./common/dicts.ts";
import { ApiErrorSchema } from "./common/errors.ts";
import {
  ProjectCreateBodySchema,
  ProjectDeleteHeadersSchema,
  ProjectFacetsSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectMemberCreateBodySchema,
  ProjectMemberListResponseSchema,
  ProjectMemberSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectUpdateBodySchema,
} from "./modules/projects.ts";
import {
  TaskCanCompleteResponseSchema,
  TaskCompleteBodySchema,
  TaskCompleteResponseSchema,
  TaskCreateBodySchema,
  TaskCreateFromTemplateBodySchema,
  TaskCreateFromTemplateResponseSchema,
  TaskDeleteResponseSchema,
  TaskDetailSchema,
  TaskListItemSchema,
  TaskListQuerySchema,
  TaskLockedFieldsAdjustBodySchema,
  TaskListResponseSchema,
  TaskProgressUpdateBodySchema,
  TaskSchema,
  TaskUpdateBodySchema,
  TaskBatchBodySchema,
  TaskBatchResponseSchema,
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
  StakeholderCreateBodySchema,
  StakeholderDeleteResponseSchema,
  StakeholderListQuerySchema,
  StakeholderListResponseSchema,
  StakeholderProjectLinkBodySchema,
  StakeholderSchema,
  StakeholderUpdateBodySchema,
} from "./modules/stakeholders.ts";
import {
  DailyReportCreateBodySchema,
  DailyReportListQuerySchema,
  DailyReportListResponseSchema,
  DailyReportSchema,
  DailyReportUpdateBodySchema,
} from "./modules/reports.ts";
import {
  IssueDetailSchema,
  IssueListQuerySchema,
  IssueListResponseSchema,
  IssueUpdateBodySchema,
} from "./modules/issues.ts";
import {
  BlueprintImportBodySchema,
  BlueprintQuerySchema,
  BlueprintSaveBodySchema,
  BlueprintViewSchema,
  CanCompleteResponseSchema,
  NodeCompleteBodySchema,
  NodeCompleteResponseSchema,
  NodeCreateBodySchema,
  NodeDeleteBodySchema,
  ProjectFlowSchema,
  ProjectNodeSchema,
  StageAdvanceBodySchema,
  StageListResponseSchema,
  StageRollbackBodySchema,
} from "./modules/flow.ts";
import { CallbackQuerySchema, LoginQuerySchema, MeResponseSchema } from "./modules/identity.ts";
import { UserListQuerySchema, UserListResponseSchema, UserPreferencesSchema, UserPreferencesUpdateBodySchema } from "./modules/users.ts";
import {
  DictItemCreateBodySchema,
  DictItemUpdateBodySchema,
  DictListResponseSchema,
  DictReadQuerySchema,
  DictSchema,
} from "./modules/dicts.ts";
import { AuditLogListQuerySchema, AuditLogListResponseSchema } from "./modules/audits.ts";
import {
  CalendarDayQuerySchema,
  CalendarDayUpsertBodySchema,
  CalendarDayViewSchema,
  CalendarOffsetQuerySchema,
  CalendarOffsetResultSchema,
  CalendarSettingsUpdateBodySchema,
  CalendarShiftQuerySchema,
  CalendarShiftResultSchema,
  CalendarShiftSettingsSchema,
  CalendarYearQuerySchema,
  CalendarYearSchema,
} from "./modules/calendar.ts";
import { PermissionMeResponseSchema } from "./modules/permissions.ts";
import {
  ChangeRequestDetailSchema,
  ChangeRequestListQuerySchema,
  ChangeRequestListResponseSchema,
  FileDetailSchema,
  FileDownloadUrlResponseSchema,
  FileFinalizeBodySchema,
  FileListQuerySchema,
  FileListResponseSchema,
  FilePreviewQuerySchema,
  FilePreviewResponseSchema,
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
const stageParams = z.object({ id: UuidSchema, key: StageKeySchema });
const blueprintQuery = BlueprintQuerySchema;
const memberParams = z.object({ id: UuidSchema, userId: UuidSchema });
const idempotencyHeader = z.object({ "Idempotency-Key": IdempotencyKeySchema.optional() });
// 字典类型路径参数：一期取值 region / projectType；未知类型返回 404（非 400）——与 DictsController 行为一致
const dictTypeParams = z.object({ type: z.string().min(1).max(64).openapi({ description: "字典类型（一期：region / projectType）；未知类型返回 404" }) });
// 工作日历路径参数：业务日期 YYYY-MM-DD（例外表的业务键；非法日期由契约校验拦成 400）
const calendarDayParams = z.object({ date: DateOnlySchema });

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
    method: "delete",
    path: "/api/v1/projects/{id}",
    tags: ["projects"],
    summary: "删除项目（软删；If-Match 回传当前 version 防误删）",
    request: { params: idParams, headers: ProjectDeleteHeadersSchema },
    responses: {
      200: { description: "已软删项目（列表 / 详情 / facets / 搜索不再返回）", ...json(ProjectSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/members",
    tags: ["projects"],
    summary: "项目成员名册（记录级权限来源）",
    request: { params: idParams },
    responses: {
      200: { description: "成员列表（项目经理在前，同角色按工号升序）", ...json(ProjectMemberListResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/members",
    tags: ["projects"],
    summary: "添加 / 更新成员（幂等：同项目 + 同用户唯一）",
    request: { params: idParams, headers: idempotencyHeader, body: json(ProjectMemberCreateBodySchema) },
    responses: {
      200: { description: "成员行（重复添加 = 覆盖角色）", ...json(ProjectMemberSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/projects/{id}/members/{userId}",
    tags: ["projects"],
    summary: "移除成员（返回被移除的成员行；项目归档后拒绝）",
    request: { params: memberParams },
    responses: {
      200: { description: "被移除的成员", ...json(ProjectMemberSchema) },
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
    summary: "项目任务列表（TaskListItem：表格直接渲染 + 内联摘要）",
    request: { params: idParams, query: TaskListQuerySchema },
    responses: {
      200: { description: "任务列表", ...json(TaskListResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/tasks/{taskId}",
    tags: ["tasks"],
    summary: "任务详情（抽屉全字段 + 文件清单；列表走 TaskListItem，抽屉打开时按需请求）",
    request: { params: z.object({ id: UuidSchema, taskId: UuidSchema }) },
    responses: {
      200: { description: "任务详情", ...json(TaskDetailSchema) },
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
      200: { description: "更新后的任务（TaskListItem 同形，前端直接替换行）", ...json(TaskListItemSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/tasks/{taskId}/can-complete",
    tags: ["tasks"],
    summary: "完成预检（门禁缺件与放行提示；UI 置灰依据，服务端仍在事务内强校验）",
    request: { params: z.object({ id: UuidSchema, taskId: UuidSchema }) },
    responses: {
      200: { description: "预检结果（canComplete + missing + warnings）", ...json(TaskCanCompleteResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/tasks/{taskId}/complete",
    tags: ["tasks"],
    summary: "任务完成提交（事务内门禁：缺件 422 TASK_REQUIRED_DOC_MISSING；未定档放行 + warning 并触发 R02）",
    request: { params: z.object({ id: UuidSchema, taskId: UuidSchema }), body: json(TaskCompleteBodySchema) },
    responses: {
      200: { description: "完成结果（task + warnings）", ...json(TaskCompleteResponseSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
      422: commonErrors[422],
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
    path: "/api/v1/projects/{id}/tasks/batch",
    tags: ["tasks"],
    summary: "任务批量操作（A1-08：批量指派 / 改状态 / 改日期 / 批量完成；逐条校验 + 部分失败清单）",
    request: { params: idParams, headers: idempotencyHeader, body: json(TaskBatchBodySchema) },
    responses: {
      200: { description: "批量结果（succeeded + failures；部分失败不影响成功项）", ...json(TaskBatchResponseSchema) },
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
    method: "patch",
    path: "/api/v1/projects/{id}/tasks/{taskId}/locked-fields",
    tags: ["tasks"],
    summary:
      "锁定字段例外调整（仅系统管理员 · A1-17 / C9-07）：任务描述 / 输出成果文件生成后锁定，确需修正时原因必填并留痕（审计 + outbox）",
    request: { params: z.object({ id: UuidSchema, taskId: UuidSchema }), body: json(TaskLockedFieldsAdjustBodySchema) },
    responses: {
      200: { description: "调整后的任务", ...json(TaskSchema) },
      400: commonErrors[400],
      403: commonErrors[403],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/projects/{id}/tasks/{taskId}",
    tags: ["tasks"],
    summary: "删除任务（软删：列表 / 看板 / 甘特图 / 完成门禁不可见 + 写留痕；重复删除统一 404；已产生变更记录 409 TASK_HAS_REFERENCES）",
    request: { params: z.object({ id: UuidSchema, taskId: UuidSchema }) },
    responses: {
      200: { description: "删除结果（软删标记）", ...json(TaskDeleteResponseSchema) },
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
  // ---- 用户目录与字典（A2 / A3 / A4）----
  registry.registerPath({
    method: "get",
    path: "/api/v1/users",
    tags: ["users"],
    summary: "用户目录（项目经理下拉 / 任务负责人候选 / 姓名解析；只返回启用用户，默认按工号升序）",
    request: { query: UserListQuerySchema },
    responses: {
      200: { description: "用户列表", ...json(UserListResponseSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/users/me/preferences",
    tags: ["users"],
    summary: "读取当前用户偏好（任务表列显隐等）",
    responses: {
      200: { description: "偏好全量", ...json(UserPreferencesSchema) },
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/users/me/preferences",
    tags: ["users"],
    summary: "更新当前用户偏好（PATCH 合并语义：只传变更键）",
    request: { body: json(UserPreferencesUpdateBodySchema) },
    responses: {
      200: { description: "更新后的偏好全量", ...json(UserPreferencesSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/dicts",
    tags: ["dicts"],
    summary: "全量字典（region / projectType，含元数据与主题色；阶段与成果文件类型走契约枚举，不在字典内）",
    request: { query: DictReadQuerySchema },
    responses: {
      200: { description: "全部字典", ...json(DictListResponseSchema) },
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/dicts/{type}",
    tags: ["dicts"],
    summary: "单个字典（未知类型返回 404）",
    request: { params: dictTypeParams, query: DictReadQuerySchema },
    responses: {
      200: { description: "字典", ...json(DictSchema) },
      401: commonErrors[401],
      404: commonErrors[404],
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/dicts/{type}/items",
    tags: ["dicts"],
    summary: "新增字典条目（仅管理员 · dict.manage；变更写审计留痕）",
    request: { params: dictTypeParams, body: json(DictItemCreateBodySchema) },
    responses: {
      201: { description: "创建成功（更新后的整个字典）", ...json(DictSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
      403: commonErrors[403],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/dicts/{type}/items/{code}",
    tags: ["dicts"],
    summary: "更新字典条目（部分更新；停用替代删除；变更写审计留痕）",
    request: { params: dictTypeParams.extend({ code: z.string() }), body: json(DictItemUpdateBodySchema) },
    responses: {
      200: { description: "更新后的整个字典", ...json(DictSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
      403: commonErrors[403],
      404: commonErrors[404],
    },
  });

  // ---- 操作审计（C7；admin 模块：按对象 / 操作人检索） ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/audit-logs",
    tags: ["audit"],
    summary: "审计检索（对象 / 操作人 / 动作 / 结果 / 项目 / 时间区间；仅 audit.view）",
    request: { query: AuditLogListQuerySchema },
    responses: {
      200: { description: "审计列表（occurredAt 降序）", ...json(AuditLogListResponseSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
      403: commonErrors[403],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/blueprint",
    tags: ["flow"],
    summary: "当前蓝图（含版本与发布状态；该项目类型尚未建档时 404，default 仅作导入兜底）",
    request: { query: blueprintQuery },
    responses: { 200: { description: "蓝图视图", ...json(BlueprintViewSchema) }, 404: commonErrors[404] },
  });

  registry.registerPath({
    method: "put",
    path: "/api/v1/blueprint",
    tags: ["flow"],
    summary: "保存蓝图草稿（必须通过 schema + 引用校验）",
    request: { query: blueprintQuery, headers: idempotencyHeader, body: json(BlueprintSaveBodySchema) },
    responses: {
      200: { description: "保存后的蓝图视图", ...json(BlueprintViewSchema) },
      400: commonErrors[400],
      403: commonErrors[403],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/blueprint/publish",
    tags: ["flow"],
    summary: "发布蓝图（递增 blueprintVersion；不影响已生成项目）",
    request: { query: blueprintQuery, headers: idempotencyHeader, body: json(BlueprintSaveBodySchema) },
    responses: {
      200: { description: "发布后的蓝图视图", ...json(BlueprintViewSchema) },
      403: commonErrors[403],
      404: commonErrors[404],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/blueprint/export",
    tags: ["flow"],
    summary: "导出蓝图 JSON（自建格式，round-trip 无损）",
    request: { query: blueprintQuery },
    responses: { 200: { description: "蓝图 JSON", ...json(BlueprintViewSchema.shape.blueprint) }, 404: commonErrors[404] },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/blueprint/import",
    tags: ["flow"],
    summary: "导入蓝图 JSON（保存为草稿；重复导入幂等）",
    request: { query: blueprintQuery, headers: idempotencyHeader, body: json(BlueprintImportBodySchema) },
    responses: {
      200: { description: "导入后的蓝图视图", ...json(BlueprintViewSchema) },
      403: commonErrors[403],
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
      403: commonErrors[403],
      409: commonErrors[409],
      422: commonErrors[422],
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
      403: commonErrors[403],
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

  // ---- 阶段推进 / 回退（M2-03 · ADR-023）----
  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/stages",
    tags: ["flow"],
    summary: "项目阶段列表（九阶段状态与完成度；读时派生）",
    request: { params: idParams },
    responses: {
      200: { description: "阶段列表", ...json(StageListResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/stages/{key}/advance",
    tags: ["flow"],
    summary: "推进阶段（服务端门禁：任务 / 节点 / 成果文件；失败 422 + 缺项明细，不部分推进）",
    request: { params: stageParams, headers: idempotencyHeader, body: json(StageAdvanceBodySchema) },
    responses: {
      200: { description: "推进后的阶段列表", ...json(StageListResponseSchema) },
      400: commonErrors[400],
      403: commonErrors[403],
      404: commonErrors[404],
      409: commonErrors[409],
      422: commonErrors[422],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/stages/{key}/rollback",
    tags: ["flow"],
    summary: "回退到相邻上一阶段（原因必填并留痕；不做门禁）",
    request: { params: stageParams, headers: idempotencyHeader, body: json(StageRollbackBodySchema) },
    responses: {
      200: { description: "回退后的阶段列表", ...json(StageListResponseSchema) },
      400: commonErrors[400],
      403: commonErrors[403],
      404: commonErrors[404],
      409: commonErrors[409],
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
    path: "/api/v1/files/{id}/preview",
    tags: ["files"],
    summary: "预览状态与短时签名地址（D2：异步产物；未就绪 / 失败为 200 语义，not_ready 幂等补投，失败降级「请下载」）",
    request: { params: idParams, query: FilePreviewQuerySchema },
    responses: {
      200: { description: "预览状态（ready / not_ready / failed）", ...json(FilePreviewResponseSchema) },
      404: commonErrors[404],
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

  // ---- 权限画像（ADR-011 策略服务；PoC-6 五出口） ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/permissions/me",
    tags: ["permissions"],
    summary: "当前用户授权画像（角色 / 数据范围 / 功能权限位；前端据此置灰）",
    responses: {
      200: { description: "授权画像", ...json(PermissionMeResponseSchema) },
      401: commonErrors[401],
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

  // ---- 工作日历（D5；h8：日历维护 / 顺延配置 / T-1·T+1 求值） ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/calendar/days",
    tags: ["calendar"],
    summary: "某年工作日历：例外清单（放假 / 调休上班）+ 顺延配置（登录即可读）",
    request: { query: CalendarYearQuerySchema },
    responses: {
      200: { description: "某年日历", ...json(CalendarYearSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/calendar/day",
    tags: ["calendar"],
    summary: "某天的工作日判定（缺省今天；顺延与 T-1/T+1 的输入口径）",
    request: { query: CalendarDayQuerySchema },
    responses: {
      200: { description: "某天判定", ...json(CalendarDayViewSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "put",
    path: "/api/v1/calendar/days/{date}",
    tags: ["calendar"],
    summary: "设置某天为放假 / 调休上班（仅管理员 · calendar.manage；幂等 upsert，变更写审计留痕）",
    request: { params: calendarDayParams, body: json(CalendarDayUpsertBodySchema) },
    responses: {
      200: { description: "更新后的整年日历", ...json(CalendarYearSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
      403: commonErrors[403],
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/calendar/days/{date}",
    tags: ["calendar"],
    summary: "删除某天的例外（回落默认规则：周一至周五工作日 / 周六周日非工作日；仅管理员 · calendar.manage）",
    request: { params: calendarDayParams },
    responses: {
      200: { description: "更新后的整年日历", ...json(CalendarYearSchema) },
      401: commonErrors[401],
      403: commonErrors[403],
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/calendar/settings",
    tags: ["calendar"],
    summary: "顺延规则配置（D5-02：提醒日期落在非工作日时是否顺延 + 方向；登录即可读）",
    responses: {
      200: { description: "顺延配置", ...json(CalendarShiftSettingsSchema) },
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "put",
    path: "/api/v1/calendar/settings",
    tags: ["calendar"],
    summary: "更新顺延规则（仅管理员 · calendar.manage；变更写审计留痕）",
    request: { body: json(CalendarSettingsUpdateBodySchema) },
    responses: {
      200: { description: "更新后的顺延配置", ...json(CalendarShiftSettingsSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
      403: commonErrors[403],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/calendar/shift",
    tags: ["calendar"],
    summary: "顺延求值：非工作日按方向移动到最近工作日（金标：节假日顺延开 / 关两态）",
    request: { query: CalendarShiftQuerySchema },
    responses: {
      200: { description: "顺延结果", ...json(CalendarShiftResultSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/calendar/offset",
    tags: ["calendar"],
    summary: "T-N / T+N 求值：自然日偏移 + 可选顺延 + 提醒时刻（如 R03 的「前 1 天 08:00」）",
    request: { query: CalendarOffsetQuerySchema },
    responses: {
      200: { description: "T-N / T+N 结果", ...json(CalendarOffsetResultSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
    },
  });

  // ---- 干系人台账（j6 · S8·stakeholder · A5） ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/stakeholders",
    tags: ["stakeholders"],
    summary: "干系人台账列表（记录级按数据范围裁剪；隐私字段按字段级策略不返回）",
    request: { query: StakeholderListQuerySchema },
    responses: {
      200: { description: "干系人列表", ...json(StakeholderListResponseSchema) },
      400: commonErrors[400],
      401: commonErrors[401],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/stakeholders",
    tags: ["stakeholders"],
    summary: "新增干系人（A5-01 / A5-04；stakeholder.manage）：写审计留痕（对象 = stakeholder）",
    request: { body: json(StakeholderCreateBodySchema) },
    responses: {
      201: { description: "新建的干系人", ...json(StakeholderSchema) },
      400: commonErrors[400],
      403: commonErrors[403],
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/stakeholders/{stakeholderId}",
    tags: ["stakeholders"],
    summary: "干系人详情（含关联项目；不可见 / 已删除一律 404，防 IDOR）",
    request: { params: z.object({ stakeholderId: UuidSchema }) },
    responses: {
      200: { description: "干系人详情", ...json(StakeholderSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/stakeholders/{stakeholderId}",
    tags: ["stakeholders"],
    summary: "更新干系人（部分更新，null = 清空）：字段级留痕",
    request: { params: z.object({ stakeholderId: UuidSchema }), body: json(StakeholderUpdateBodySchema) },
    responses: {
      200: { description: "更新后的干系人", ...json(StakeholderSchema) },
      400: commonErrors[400],
      403: commonErrors[403],
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/stakeholders/{stakeholderId}",
    tags: ["stakeholders"],
    summary: "删除干系人（软删：deleted_at 置位，不物理删行；项目关联保留）",
    request: { params: z.object({ stakeholderId: UuidSchema }) },
    responses: {
      200: { description: "删除结果（deleted 标记）", ...json(StakeholderDeleteResponseSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/stakeholders/{stakeholderId}/projects",
    tags: ["stakeholders"],
    summary: "关联项目（A5-03；幂等：已关联返回同一结果）；写审计留痕",
    request: { params: z.object({ stakeholderId: UuidSchema }), body: json(StakeholderProjectLinkBodySchema) },
    responses: {
      200: { description: "关联后的干系人", ...json(StakeholderSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/stakeholders/{stakeholderId}/projects/{projectId}",
    tags: ["stakeholders"],
    summary: "解除项目关联（A5-03）：未关联 404；写审计留痕",
    request: { params: z.object({ stakeholderId: UuidSchema, projectId: UuidSchema }) },
    responses: {
      200: { description: "解除后的干系人", ...json(StakeholderSchema) },
      404: commonErrors[404],
    },
  });

  // ---- 日报与问题（M6-01 ~ M6-03 · A3：日报填报 / 回写 / 问题闭环 · wmj 线）----
  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/reports",
    tags: ["reports"],
    summary: "日报列表（A3-01 / A7-02）：日期区间 / 状态 / 提交人筛选 + 分页；日期倒序",
    request: { params: idParams, query: DailyReportListQuerySchema },
    responses: {
      200: { description: "日报列表（项目内成员可见）", ...json(DailyReportListResponseSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/projects/{id}/reports",
    tags: ["reports"],
    summary:
      "新建日报（A3-01 / A3-02 · M6-01）：一人一项目一天一条（重复 409 REPORT_ALREADY_EXISTS）；对过去日期提交 = 补填；现场发现问题非空且提交 = 自动生成问题（A3-09 幂等）",
    request: { params: idParams, body: json(DailyReportCreateBodySchema) },
    responses: {
      201: { description: "新建的日报", ...json(DailyReportSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/reports/{reportId}",
    tags: ["reports"],
    summary: "日报详情（A3-01 全字段 + 关联任务标题）",
    request: { params: z.object({ id: UuidSchema, reportId: UuidSchema }) },
    responses: {
      200: { description: "日报详情", ...json(DailyReportSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/projects/{id}/reports/{reportId}",
    tags: ["reports"],
    summary:
      "编辑 / 提交日报（A3-02 草稿提交 · A3-08 回写关联任务「项目进展描述」）：乐观锁 version；date 不可改；已提交行不允许退回草稿",
    request: { params: z.object({ id: UuidSchema, reportId: UuidSchema }), body: json(DailyReportUpdateBodySchema) },
    responses: {
      200: { description: "更新后的日报", ...json(DailyReportSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/issues",
    tags: ["issues"],
    summary: "问题列表（A3-16 问题追踪 / 问题看板同源）：状态 / 归类 / 任务 / 来源日报筛选 + 关键字 + 分页；提出日期倒序",
    request: { params: idParams, query: IssueListQuerySchema },
    responses: {
      200: { description: "问题列表", ...json(IssueListResponseSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/projects/{id}/issues/{issueId}",
    tags: ["issues"],
    summary: "问题详情（A3-13）：问题本体 + 处理过程留痕（时间正序）",
    request: { params: z.object({ id: UuidSchema, issueId: UuidSchema }) },
    responses: {
      200: { description: "问题详情", ...json(IssueDetailSchema) },
      404: commonErrors[404],
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/api/v1/projects/{id}/issues/{issueId}",
    tags: ["issues"],
    summary:
      "问题更新（A3-10 四态流转 / A3-12 分派 / A3-13 解决方案）：乐观锁 version；允许回退且留痕（done → 其它态一并清 closed_at）",
    request: { params: z.object({ id: UuidSchema, issueId: UuidSchema }), body: json(IssueUpdateBodySchema) },
    responses: {
      200: { description: "更新后的问题详情", ...json(IssueDetailSchema) },
      400: commonErrors[400],
      404: commonErrors[404],
      409: commonErrors[409],
    },
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
      { name: "users", description: "用户目录与用户偏好（A2 / A4；M1）" },
      { name: "permissions", description: "权限画像与策略出口（ADR-011；PoC-6 权限矩阵与脱敏五出口）" },
      { name: "dicts", description: "数据字典下发（A3；region / projectType，含主题色元数据）" },
      { name: "audit", description: "操作审计（C7）：关键操作留痕、按对象 / 操作人检索与越权尝试（admin 模块）" },
      { name: "calendar", description: "工作日历（D5）：日历维护 / 顺延规则配置 / T-1·T+1 求值（h8）" },
      { name: "changes", description: "变更记录（一期申请即通过、全程留痕；v0.2 §5.3 / A4-13~A4-15）" },
      { name: "stakeholders", description: "干系人台账与项目关联（A5-01~A5-04 / A5-07；隐私字段走字段级策略）" },
      { name: "reports", description: "日报（A3-01 / A3-02 / A3-08 / A3-09；M6-01 / M6-02）" },
      { name: "issues", description: "问题闭环（A3-09~A3-13；四态流转 / 分派 / 留痕，M6-02 / M6-03）" },
    ],
  });
}
