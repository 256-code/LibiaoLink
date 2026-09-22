/**
 * M3-03 任务完成门禁回归（A4-20 / ADR-024 · Push 143）：预检（can-complete）、完成提交缺件 422 + 留痕、
 * draft 放行 + R02 提醒、PATCH status / progress 与完成提交同一门禁（三入口一致）、无节点任务 deliverable_types 兜底。
 * 真机口径见 server/README.md「M3-03」；与之对称的节点门禁回归见 test/flow-gate-rejection.test.ts。
 */
import { describe, expect, it } from "vitest";
import type { AuditService } from "../src/modules/admin/index.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { DbClient } from "../src/db/db-client.js";
import type { RoleService } from "../src/modules/identity/index.js";
import type { TaskCompletionTargetRow, TaskFileSummaryCounts, TaskListRow, TaskRow, TaskUpdatePatch } from "../src/modules/task/task.repository.js";
import type { TaskRepository } from "../src/modules/task/task.repository.js";
import type { TaskGateRepository } from "../src/modules/task/task.gate.repository.js";
import { shanghaiToday } from "../src/modules/task/task.rules.js";
import { TaskService } from "../src/modules/task/task.service.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

interface OutboxRow {
  topic: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
}

class FakeDatabase {
  outbox: OutboxRow[] = [];
  /** 事务桩：把 appendOutbox 的 insert().values() 收集到数组（不连库）。 */
  tx = {
    insert: () => ({
      values: (value: OutboxRow) => {
        this.outbox.push(value);
        return Promise.resolve();
      },
    }),
  } as unknown as DbClient;
  readonly db = {
    transaction: (callback: (tx: DbClient) => Promise<unknown>) => callback(this.tx),
    insert: this.tx.insert,
  } as unknown as DatabaseService["db"];
}

function makeRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: TASK,
    projectId: PROJECT,
    stageKey: "install",
    nodeId: NODE,
    title: "货架组装",
    titleEn: null,
    ownerIds: [],
    status: "pending",
    progress: "0",
    sortIndex: 0,
    plannedStart: null,
    plannedEnd: null,
    actualEnd: null,
    estimatedDays: null,
    headcount: null,
    priority: null,
    deliverableTypes: [],
    note: null,
    onTime: null,
    changeRefs: [],
    version: 3,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

class FakeTaskRepository {
  project = { id: PROJECT, managerIds: [] as string[], stageKey: "install", status: "active" };
  task: TaskRow | null = makeRow();
  eventCount = 0;
  touched: string[] = [];
  async findProject(): Promise<typeof this.project | null> {
    return this.project;
  }
  async lockTask(): Promise<TaskRow | null> {
    return this.task;
  }
  async findCompletionTarget(): Promise<TaskCompletionTargetRow | null> {
    return this.task === null
      ? null
      : {
          id: this.task.id,
          projectId: this.task.projectId,
          nodeId: this.task.nodeId,
          status: this.task.status,
          deliverableTypes: this.task.deliverableTypes,
        };
  }
  async updateWithVersion(_taskId: string, expectedVersion: number, patch: TaskUpdatePatch, at: Date): Promise<TaskRow | null> {
    const current = this.task;
    if (current === null || current.version !== expectedVersion) return null;
    const next: TaskRow = {
      ...current,
      status: patch.status ?? current.status,
      progress: patch.progress ?? current.progress,
      actualEnd: patch.actualEnd !== undefined ? patch.actualEnd : current.actualEnd,
      note: patch.note !== undefined ? patch.note : current.note,
      updatedAt: at,
      version: current.version + 1,
    };
    this.task = next;
    return next;
  }
  async insertEvents(): Promise<void> {
    this.eventCount += 1;
  }
  async touchProject(projectId: string): Promise<void> {
    this.touched.push(projectId);
  }
  async findListRowById(): Promise<TaskListRow | null> {
    return this.task === null ? null : { task: this.task, ownerNames: [], changeLinks: [] };
  }
  async listChangeLinks(): Promise<never[]> {
    return [];
  }
  async fileSummaries(): Promise<Map<string, TaskFileSummaryCounts>> {
    return new Map();
  }
}

/** 门禁替身：默认放行；用例注入 required_doc 要求与 final / draft 计数。 */
class FakeTaskGateRepository {
  requirements: { docType: string; minCount: number }[] = [];
  finalCounts: { docType: string; present: number }[] = [];
  draftCounts: { docType: string; present: number }[] = [];
  async listNodeDocRequirements(): Promise<{ docType: string; minCount: number }[]> {
    return this.requirements;
  }
  async countFinalFiles(): Promise<{ docType: string; present: number }[]> {
    return this.finalCounts;
  }
  async countDraftFiles(): Promise<{ docType: string; present: number }[]> {
    return this.draftCounts;
  }
}

class FakeAuditService {
  entries: Record<string, unknown>[] = [];
  async record(_client: unknown, input: Record<string, unknown>): Promise<void> {
    this.entries.push(input);
  }
}

function makeService(repo: FakeTaskRepository, gate: FakeTaskGateRepository): {
  service: TaskService;
  db: FakeDatabase;
  audit: FakeAuditService;
} {
  const db = new FakeDatabase();
  const audit = new FakeAuditService();
  const service = new TaskService(
    db as unknown as DatabaseService,
    repo as unknown as TaskRepository,
    gate as unknown as TaskGateRepository,
    {} as unknown as RoleService,
    audit as unknown as AuditService,
  );
  return { service, db, audit };
}

describe("M3-03 · 任务完成门禁（A4-20 / ADR-024）", () => {
  it("预检：有节点任务按 node_requirements 缺件 → canComplete=false + missing 明细", async () => {
    const repo = new FakeTaskRepository();
    const gate = new FakeTaskGateRepository();
    gate.requirements = [{ docType: "合同", minCount: 1 }];
    const { service } = makeService(repo, gate);
    const result = await service.canComplete(PROJECT, TASK);
    expect(result.canComplete).toBe(false);
    expect(result.missing).toEqual([{ docType: "合同", required: 1, present: 0 }]);
    expect(result.warnings).toEqual([]);
  });

  it("预检：无节点任务按 deliverable_types 兜底（每类 ≥ 1 份；已有定档的那类放行）", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ nodeId: null, deliverableTypes: ["合同", "验收单"] });
    const gate = new FakeTaskGateRepository();
    gate.finalCounts = [{ docType: "合同", present: 1 }];
    const { service } = makeService(repo, gate);
    const result = await service.canComplete(PROJECT, TASK);
    expect(result.canComplete).toBe(false);
    expect(result.missing).toEqual([{ docType: "验收单", required: 1, present: 0 }]);
  });

  it("完成提交：缺件 → 422 TASK_REQUIRED_DOC_MISSING（不部分生效）+ outbox / 审计留痕", async () => {
    const repo = new FakeTaskRepository();
    const gate = new FakeTaskGateRepository();
    gate.requirements = [{ docType: "合同", minCount: 1 }];
    const { service, db, audit } = makeService(repo, gate);
    await expect(service.complete(PROJECT, TASK, { version: 3 }, ACTOR)).rejects.toMatchObject({
      code: "TASK_REQUIRED_DOC_MISSING",
      httpStatus: 422,
    });
    expect(repo.task?.status).toBe("pending");
    const event = db.outbox.find((row) => row.topic === "task.gate_rejected");
    expect(event?.payload["taskId"]).toBe(TASK);
    expect(event?.dedupeKey.startsWith("task.gate_rejected:" + TASK + ":")).toBe(true);
    const failed = audit.entries.find((entry) => entry.result === "failed");
    expect(failed?.objectType).toBe("task");
    expect(failed?.action).toBe("complete");
  });

  it("完成提交：门禁通过 → 200 task=done（满格 + 完成日期按当天）+ outbox task.completed", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ status: "active", progress: "0.75" });
    const gate = new FakeTaskGateRepository();
    gate.requirements = [{ docType: "合同", minCount: 1 }];
    gate.finalCounts = [{ docType: "合同", present: 1 }];
    const { service, db } = makeService(repo, gate);
    const result = await service.complete(PROJECT, TASK, { version: 3 }, ACTOR);
    expect(result.task.status).toBe("done");
    expect(result.task.progress).toBe(1);
    expect(result.task.actualEnd).toBe(shanghaiToday(new Date()));
    expect(result.warnings).toEqual([]);
    expect(db.outbox.some((row) => row.topic === "task.completed")).toBe(true);
    expect(db.outbox.some((row) => row.topic === "task.draft_doc_reminded")).toBe(false);
  });

  it("完成提交：存在未定档（draft）→ 放行 + warning + R02 提醒入队", async () => {
    const repo = new FakeTaskRepository();
    const gate = new FakeTaskGateRepository();
    gate.requirements = [{ docType: "合同", minCount: 1 }];
    gate.finalCounts = [{ docType: "合同", present: 1 }];
    gate.draftCounts = [{ docType: "合同", present: 2 }];
    const { service, db } = makeService(repo, gate);
    const result = await service.complete(PROJECT, TASK, { version: 3 }, ACTOR);
    expect(result.task.status).toBe("done");
    expect(result.warnings).toEqual([{ code: "draft_doc_present", docType: "合同", count: 2 }]);
    expect(db.outbox.some((row) => row.topic === "task.draft_doc_reminded")).toBe(true);
  });

  it("已完成任务重复提交 → 409 TASK_ALREADY_DONE（不重复写）", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ status: "done", progress: "1", actualEnd: "2026-09-15" });
    const gate = new FakeTaskGateRepository();
    const { service } = makeService(repo, gate);
    await expect(service.complete(PROJECT, TASK, { version: 3 }, ACTOR)).rejects.toMatchObject({
      code: "TASK_ALREADY_DONE",
      httpStatus: 409,
    });
  });

  it("表格编辑入口：PATCH status=done 同一门禁（缺件 422，不写库）", async () => {
    const repo = new FakeTaskRepository();
    const gate = new FakeTaskGateRepository();
    gate.requirements = [{ docType: "合同", minCount: 1 }];
    const { service } = makeService(repo, gate);
    await expect(service.update(PROJECT, TASK, { status: "done", version: 3 }, ACTOR)).rejects.toMatchObject({
      code: "TASK_REQUIRED_DOC_MISSING",
      httpStatus: 422,
    });
    expect(repo.task?.status).toBe("pending");
  });

  it("看板 / 四格入口：PATCH progress=1 同一门禁（缺件 422）", async () => {
    const repo = new FakeTaskRepository();
    const gate = new FakeTaskGateRepository();
    gate.requirements = [{ docType: "合同", minCount: 1 }];
    const { service } = makeService(repo, gate);
    await expect(service.updateProgress(PROJECT, TASK, { progress: 1, version: 3 }, ACTOR)).rejects.toMatchObject({
      code: "TASK_REQUIRED_DOC_MISSING",
      httpStatus: 422,
    });
    expect(repo.task?.status).toBe("pending");
  });
});
