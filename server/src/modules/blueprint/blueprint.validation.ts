import { BlueprintSchema, DOC_TYPES, z } from "@libiaolink/contracts";

export type Blueprint = z.infer<typeof BlueprintSchema>;

/** 校验 issue（path + 原因）：失败时一次性返回全部，不允许部分导入（v0.2 §3.4）。 */
export interface BlueprintIssue {
  path: string;
  message: string;
}

export interface BlueprintValidationResult {
  ok: boolean;
  issues: BlueprintIssue[];
  /** 存在「引用类」问题（docType 不在成果文件字典）→ 错误码取 BLUEPRINT_REF_UNKNOWN，否则 BLUEPRINT_SCHEMA_INVALID。 */
  refUnknown: boolean;
  blueprint: Blueprint | null;
}

const DOC_TYPE_SET: ReadonlySet<string> = new Set<string>(DOC_TYPES);

/**
 * 蓝图校验（保存 / 发布 / 导入共用）：
 * 1) schemaVersion 与必填字段（契约 BlueprintSchema）；2) stage.key / node.key 全局唯一；
 * 3) seq 递增（阶段之间与阶段内节点）；4) required_doc.docType 命中成果文件字典。
 */
export function validateBlueprint(payload: unknown): BlueprintValidationResult {
  const schemaIssues: BlueprintIssue[] = [];
  const refIssues: BlueprintIssue[] = [];
  collectDocTypeRefs(payload, refIssues);

  const parsed = BlueprintSchema.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      schemaIssues.push({ path: issue.path.join("."), message: issue.message });
    }
  } else {
    structuralIssues(parsed.data, schemaIssues);
  }

  const issues = [...schemaIssues, ...refIssues];
  return {
    ok: issues.length === 0,
    issues,
    refUnknown: refIssues.length > 0,
    blueprint: parsed.success && issues.length === 0 ? parsed.data : null,
  };
}

/** 结构类校验（zod 之外的语义约束）。 */
function structuralIssues(blueprint: Blueprint, issues: BlueprintIssue[]): void {
  const stageKeys = new Set<string>();
  const nodeKeys = new Set<string>();
  let lastStageSeq = 0;
  blueprint.stages.forEach((stage, stageIndex) => {
    if (stageKeys.has(stage.key)) {
      issues.push({ path: "stages." + stageIndex + ".key", message: "stage.key 重复：" + stage.key });
    }
    stageKeys.add(stage.key);
    if (stage.seq <= lastStageSeq) {
      issues.push({ path: "stages." + stageIndex + ".seq", message: "阶段 seq 必须严格递增（当前 " + stage.seq + "，前一个 " + lastStageSeq + "）" });
    }
    lastStageSeq = stage.seq;
    let lastNodeSeq = 0;
    stage.nodes.forEach((node, nodeIndex) => {
      const prefix = "stages." + stageIndex + ".nodes." + nodeIndex;
      if (nodeKeys.has(node.key)) {
        issues.push({ path: prefix + ".key", message: "node.key 全局重复：" + node.key });
      }
      nodeKeys.add(node.key);
      if (node.seq <= lastNodeSeq) {
        issues.push({ path: prefix + ".seq", message: "节点 seq 必须严格递增（当前 " + node.seq + "，前一个 " + lastNodeSeq + "）" });
      }
      lastNodeSeq = node.seq;
    });
  });
}

/** 引用类校验：扫描原始 payload 的 required_doc.docType（zod 只认字典枚举，这里给出可读路径）。 */
function collectDocTypeRefs(payload: unknown, issues: BlueprintIssue[]): void {
  if (typeof payload !== "object" || payload === null) return;
  const stages = (payload as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return;
  stages.forEach((stage, stageIndex) => {
    const nodes = (stage as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node, nodeIndex) => {
      const constraints = (node as { constraints?: unknown }).constraints;
      if (!Array.isArray(constraints)) return;
      constraints.forEach((constraint, constraintIndex) => {
        if (typeof constraint !== "object" || constraint === null) return;
        const item = constraint as { type?: unknown; docType?: unknown };
        if (item.type !== "required_doc" || typeof item.docType !== "string") return;
        if (!DOC_TYPE_SET.has(item.docType)) {
          issues.push({
            path: "stages." + stageIndex + ".nodes." + nodeIndex + ".constraints." + constraintIndex + ".docType",
            message: "docType 不在成果文件字典：" + item.docType,
          });
        }
      });
    });
  });
}
