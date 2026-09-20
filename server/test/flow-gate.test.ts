import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/db/db-client.js";
import { GateRepository, type DocCountRow, type RequirementRow, type StageNodeRow, type StageTaskCounts } from "../src/modules/node/gate.repository.js";
import { GateService } from "../src/modules/node/gate.service.js";

const TX = {} as unknown as DbClient;
const NODE_ID = "11111111-1111-4111-8111-111111111111";

class FakeGateRepository {
  requirements: RequirementRow[] = [];
  files: DocCountRow[] = [];
  nodes: StageNodeRow[] = [];
  tasks: StageTaskCounts = { total: 0, done: 0 };
  async listRequirements(): Promise<RequirementRow[]> {
    return this.requirements;
  }
  async countFinalFilesByDocType(): Promise<DocCountRow[]> {
    return this.files;
  }
  async listStageNodes(): Promise<StageNodeRow[]> {
    return this.nodes;
  }
  async countStageTasks(): Promise<StageTaskCounts> {
    return this.tasks;
  }
  async listStageProgress(): Promise<never[]> {
    return [];
  }
  async countLinkedFiles(): Promise<number> {
    return 0;
  }
}

function makeService(repo: FakeGateRepository): GateService {
  return new GateService(repo as unknown as GateRepository);
}

describe("GateService.evaluateNode（v0.2 §3.6 完成门禁）", () => {
  it("无 required_doc 约束 → 直接通过", async () => {
    const repo = new FakeGateRepository();
    repo.requirements = [{ requirementType: "field", docType: null, minCount: 1 }];
    const result = await makeService(repo).evaluateNode(TX, NODE_ID);
    expect(result.missing).toEqual([]);
  });

  it("缺必交成果文件 → missing 明细（docType / required / present）", async () => {
    const repo = new FakeGateRepository();
    repo.requirements = [
      { requirementType: "required_doc", docType: "技术协议", minCount: 1 },
      { requirementType: "required_doc", docType: "合同", minCount: 2 },
    ];
    repo.files = [{ docType: "合同", present: 1 }];
    const result = await makeService(repo).evaluateNode(TX, NODE_ID);
    expect(result.missing).toEqual([
      { docType: "技术协议", required: 1, present: 0 },
      { docType: "合同", required: 2, present: 1 },
    ]);
  });

  it("补齐后通过（status ∈ final / changed 且已定档的口径在计数查询里）", async () => {
    const repo = new FakeGateRepository();
    repo.requirements = [{ requirementType: "required_doc", docType: "合同", minCount: 1 }];
    repo.files = [{ docType: "合同", present: 1 }];
    const result = await makeService(repo).evaluateNode(TX, NODE_ID);
    expect(result.missing).toEqual([]);
  });
});

describe("GateService.evaluateStageAdvance（ADR-023 阶段推进门禁）", () => {
  const STAGE = "presale";
  const PROJECT = "22222222-2222-4222-8222-222222222222";

  it("节点未完成 → node_not_done；任务未完成 → task_not_done", async () => {
    const repo = new FakeGateRepository();
    repo.nodes = [{ id: "node-1", nodeKey: "presale.requirement", name: "需求澄清", status: "active" }];
    repo.tasks = { total: 3, done: 1 };
    const result = await makeService(repo).evaluateStageAdvance(TX, PROJECT, STAGE);
    expect(result.ok).toBe(false);
    expect(result.missing[0]).toMatchObject({ type: "node_not_done", nodeId: "node-1", status: "active" });
    expect(result.missing[1]).toEqual({ type: "task_not_done", total: 3, done: 1 });
  });

  it("节点已完成但成果文件被回收 → doc_missing 兜底", async () => {
    const repo = new FakeGateRepository();
    repo.nodes = [{ id: "node-1", nodeKey: "presale.contract", name: "合同评审", status: "done" }];
    repo.requirements = [{ requirementType: "required_doc", docType: "合同", minCount: 1 }];
    repo.files = [];
    const result = await makeService(repo).evaluateStageAdvance(TX, PROJECT, STAGE);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      { type: "doc_missing", nodeId: "node-1", nodeKey: "presale.contract", docType: "合同", required: 1, present: 0 },
    ]);
  });

  it("节点与任务全通过 → ok（无缺项）", async () => {
    const repo = new FakeGateRepository();
    repo.nodes = [{ id: "node-1", nodeKey: "presale.contract", name: "合同评审", status: "done" }];
    repo.requirements = [{ requirementType: "required_doc", docType: "合同", minCount: 1 }];
    repo.files = [{ docType: "合同", present: 1 }];
    repo.tasks = { total: 2, done: 2 };
    const result = await makeService(repo).evaluateStageAdvance(TX, PROJECT, STAGE);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
