import { describe, expect, it } from "vitest";
import { validateBlueprint } from "../src/modules/blueprint/blueprint.validation.js";

const BASE = {
  schemaVersion: 1,
  blueprintVersion: 1,
  name: "测试蓝图",
  updatedAt: "2026-09-20T00:00:00.000Z",
  stages: [
    {
      key: "presale",
      name: "售前规划",
      seq: 10,
      nodes: [
        { key: "presale.requirement", name: "需求澄清", seq: 10, constraints: [] },
        {
          key: "presale.contract",
          name: "合同评审",
          seq: 20,
          constraints: [{ type: "required_doc", docType: "合同", minCount: 1 }],
        },
      ],
    },
    {
      key: "design",
      name: "设计开发",
      seq: 20,
      nodes: [{ key: "design.mech", name: "机械设计图纸", seq: 10, constraints: [{ type: "required_doc", docType: "CAD图纸", minCount: 1 }] }],
    },
  ],
};

function clone(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

describe("validateBlueprint（v0.2 §3.4 校验规则）", () => {
  it("通过：结构与引用都合法", () => {
    const result = validateBlueprint(clone(BASE));
    expect(result.ok).toBe(true);
    expect(result.refUnknown).toBe(false);
    expect(result.blueprint?.stages).toHaveLength(2);
  });

  it("docType 不在成果文件字典 → refUnknown + 精确路径", () => {
    const payload = clone(BASE);
    payload.stages[0].nodes[1].constraints[0].docType = "不存在的类型";
    const result = validateBlueprint(payload);
    expect(result.ok).toBe(false);
    expect(result.refUnknown).toBe(true);
    expect(result.issues.some((issue) => issue.path === "stages.0.nodes.1.constraints.0.docType")).toBe(true);
  });

  it("node.key 全局重复 → issue（路径指向后一次出现）", () => {
    const payload = clone(BASE);
    payload.stages[1].nodes[0].key = "presale.requirement";
    const result = validateBlueprint(payload);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === "stages.1.nodes.0.key" && issue.message.includes("重复"))).toBe(true);
  });

  it("阶段 seq 非递增 → issue", () => {
    const payload = clone(BASE);
    payload.stages[1].seq = 5;
    const result = validateBlueprint(payload);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === "stages.1.seq")).toBe(true);
  });

  it("阶段内节点 seq 非递增 → issue", () => {
    const payload = clone(BASE);
    payload.stages[0].nodes[1].seq = 5;
    const result = validateBlueprint(payload);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === "stages.0.nodes.1.seq")).toBe(true);
  });

  it("schema 类问题（缺 stage / stages 为空）→ BLUEPRINT_SCHEMA_INVALID 口径（refUnknown=false）", () => {
    const empty = validateBlueprint({ ...clone(BASE), stages: [] });
    expect(empty.ok).toBe(false);
    expect(empty.refUnknown).toBe(false);
    const badVersion = validateBlueprint({ ...clone(BASE), schemaVersion: 2 });
    expect(badVersion.ok).toBe(false);
  });

  it("required_doc.minCount 缺省 = 1（契约 default）", () => {
    const payload = clone(BASE);
    delete payload.stages[0].nodes[1].constraints[0].minCount;
    const result = validateBlueprint(payload);
    expect(result.ok).toBe(true);
    expect(result.blueprint?.stages[0]?.nodes[1]?.constraints[0]).toMatchObject({ type: "required_doc", docType: "合同", minCount: 1 });
  });
});
