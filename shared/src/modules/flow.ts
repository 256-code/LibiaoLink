import { z } from "../zod.ts";
import { DateTimeSchema, DateOnlySchema, UuidSchema, VersionSchema } from "../common/conventions.ts";
import { BlueprintStatusSchema, DocTypeSchema, NodeOriginSchema, NodeStatusSchema, StageKeySchema, StageStatusSchema } from "../common/dicts.ts";

/**
 * 蓝图与流程节点契约（v0.2 §3）。
 * 蓝图 = 项目全流程蓝图（九阶段 + 节点 + 约束），自建 JSON 格式；导出 / 导入 round-trip 无损。
 */

export const BlueprintRequiredDocConstraintSchema = z
  .object({
    type: z.literal("required_doc"),
    docType: DocTypeSchema,
    minCount: z.number().int().min(1).default(1),
  })
  .openapi("BlueprintRequiredDocConstraint", { description: "必交成果物（一期门禁实现的唯一约束类型）" });

/** field / dependency / deadline：一期仅结构就位，规则后置（Q28 定细则）。 */
export const BlueprintReservedConstraintSchema = z
  .object({
    type: z.enum(["field", "dependency", "deadline"]),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .openapi("BlueprintReservedConstraint", { description: "预留约束类型（结构就位、规则后置）" });

export const BlueprintConstraintSchema = z
  .union([BlueprintRequiredDocConstraintSchema, BlueprintReservedConstraintSchema])
  .openapi("BlueprintConstraint");

export const BlueprintNodeSchema = z
  .object({
    key: z.string().openapi({ example: "design.mech", description: "节点稳定键；一经发布不可改名（改名 = 新增 + 废弃）" }),
    name: z.string().openapi({ example: "机械设计图纸" }),
    seq: z.number().int().positive().openapi({ description: "排序（建议 10/20/30 步长，便于插入）" }),
    constraints: z.array(BlueprintConstraintSchema).default([]),
  })
  .openapi("BlueprintNode", { description: "每个节点至少一类约束（校验规则见 v0.2 §3.4）" });

export const BlueprintStageSchema = z
  .object({
    key: StageKeySchema,
    name: z.string(),
    seq: z.number().int().positive(),
    nodes: z.array(BlueprintNodeSchema).min(1),
  })
  .openapi("BlueprintStage");

export const BlueprintSchema = z
  .object({
    schemaVersion: z.literal(1),
    blueprintVersion: z.number().int().positive(),
    name: z.string(),
    updatedAt: DateTimeSchema,
    stages: z.array(BlueprintStageSchema).min(1),
  })
  .openapi("Blueprint", { description: "自建蓝图 JSON（v0.2 §3.2）；导入校验 = schema + 引用 + 幂等" });

export const BlueprintViewSchema = z
  .object({
    blueprint: BlueprintSchema,
    status: BlueprintStatusSchema,
    publishedAt: DateTimeSchema.nullable(),
    publishedBy: UuidSchema.nullable(),
  })
  .openapi("BlueprintView");

export const NodeRequirementSchema = z
  .object({
    requirementType: z.enum(["required_doc", "field", "dependency", "deadline"]),
    docType: DocTypeSchema.nullable(),
    minCount: z.number().int().min(1),
  })
  .openapi("NodeRequirement", { description: "节点约束实例（node_requirements）" });

export const ProjectNodeSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    stageId: UuidSchema,
    nodeKey: z.string(),
    name: z.string(),
    seq: z.number(),
    status: NodeStatusSchema,
    origin: NodeOriginSchema,
    doneAt: DateTimeSchema.nullable(),
    doneBy: UuidSchema.nullable(),
    sourceBlueprintVersion: z.number().int().positive(),
    version: VersionSchema,
    requirements: z.array(NodeRequirementSchema),
  })
  .openapi("ProjectNode");

export const ProjectStageSchema = z
  .object({
    id: UuidSchema,
    stageKey: StageKeySchema,
    name: z.string(),
    seq: z.number().int().positive(),
    status: StageStatusSchema,
    plannedStart: DateOnlySchema.nullable(),
    plannedEnd: DateOnlySchema.nullable(),
    actualStart: DateOnlySchema.nullable(),
    actualEnd: DateOnlySchema.nullable(),
    nodes: z.array(ProjectNodeSchema),
  })
  .openapi("ProjectStage");

export const ProjectFlowSchema = z
  .object({
    projectId: UuidSchema,
    blueprintVersion: z.number().int().positive().openapi({ description: "项目导入时的蓝图版本（快照）" }),
    stages: z.array(ProjectStageSchema),
  })
  .openapi("ProjectFlow", { description: "项目流程（阶段 + 节点 + 约束 + 状态）；导入即快照" });

/** 完成门禁未通过时的 missing 明细（HTTP 422 + code=NODE_REQUIRED_DOC_MISSING）。 */
export const NodeGateMissingSchema = z
  .object({
    docType: DocTypeSchema,
    required: z.number().int().min(1),
    present: z.number().int().min(0),
  })
  .openapi("NodeGateMissing", { description: "缺件明细（门禁拒绝时会一次性返回）" });

export const NodeCompleteBodySchema = z.object({ version: VersionSchema }).openapi("NodeCompleteBody");

export const NodeCompleteResponseSchema = z.object({ node: ProjectNodeSchema }).openapi("NodeCompleteResponse");

export const CanCompleteResponseSchema = z
  .object({
    canComplete: z.boolean(),
    missing: z.array(NodeGateMissingSchema),
  })
  .openapi("CanCompleteResponse", { description: "完成预检（UI 置灰依据；服务端仍在事务内强校验）" });

export const NodeCreateBodySchema = z
  .object({
    stageId: UuidSchema,
    nodeKey: z.string().openapi({ description: "模板节点池内的节点稳定键（一期仅允许蓝图内的 key）" }),
    name: z.string().optional(),
    seq: z.number().optional(),
  })
  .openapi("NodeCreateBody", { description: "新增节点（仅模板节点池，留痕）" });

export const NodeDeleteBodySchema = z.object({ version: VersionSchema }).openapi("NodeDeleteBody");

export const BlueprintSaveBodySchema = z.object({ blueprint: BlueprintSchema }).openapi("BlueprintSaveBody", {
  description: "保存蓝图草稿（必须通过 schema + 引用校验）",
});

export const BlueprintImportBodySchema = z.object({ blueprint: BlueprintSchema }).openapi("BlueprintImportBody", {
  description: "导入自建蓝图 JSON（保存为草稿；重复导入幂等）",
});
