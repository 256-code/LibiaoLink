import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/db/database.service.js";
import type { DbClient } from "../src/db/db-client.js";
import type { RoleService } from "../src/modules/identity/index.js";
import type { AuditService } from "../src/modules/admin/index.js";
import type {
  TaskChangeLinkRow,
  TaskEventInput,
  TaskFileSummaryCounts,
  TaskListRow,
  TaskCompletionTargetRow,
  TaskProjectNodeRow,
  TaskProjectRow,
  TaskInsertInput,
  TaskRow,
  TaskUpdatePatch,
} from "../src/modules/task/task.repository.js";
import { TaskRepository } from "../src/modules/task/task.repository.js";
import type { TaskGateRepository } from "../src/modules/task/task.gate.repository.js";
import { shanghaiToday } from "../src/modules/task/task.rules.js";
import { TaskService } from "../src/modules/task/task.service.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const MANAGER = "caa8d763-4b6a-4967-9b26-7d1086272c9c";
const ACTOR = "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69";
const MANAGER_2 = "b0f1c9d2-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

function makeRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: TASK,
    projectId: PROJECT,
    stageKey: "install",
    nodeId: NODE,
    title: "货架组装",
    titleEn: null,
    ownerIds: [MANAGER],
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
  project: TaskProjectRow | null = { id: PROJECT, managerIds: [MANAGER], stageKey: "presale", status: "active" };
  node: TaskProjectNodeRow | null = { id: NODE, stageKey: "install", status: "active" };
  existingTaskId: string | null = null;
  task: TaskRow | null = makeRow();
  /** 变更关联（A1-07 多条）：列表 / 详情随行下发，测试按需替换。 */
  changeLinks: TaskChangeLinkRow[] = [];
  /** listChangeLinks 收到的 change_refs（追加序）。 */
  changeLinkQueries: string[][] = [];
  inserted: TaskRow | null = null;
  events: TaskEventInput[] = [];
  touched: string[] = [];
  counts = { overdue: 0, done: 0, total: 0 };

  async summaryCounts(): Promise<{ overdue: number; done: number; total: number }> {
    return this.counts;
  }
  async listPage(): Promise<{ items: TaskListRow[]; total: number }> {
    return { items: [], total: 0 };
  }
  async findListRowById(): Promise<TaskListRow | null> {
    return this.task === null
      ? null
      : {
          task: this.task,
          ownerNames: ["张三"],
          changeLinks: this.changeLinks,
        };
  }
  async listFiles(): Promise<never[]> {
    return [];
  }
  /** 写路径响应回读变更关联（edit / complete 不改动已有 change_refs）。 */
  async listChangeLinks(changeRefs: readonly string[]): Promise<TaskChangeLinkRow[]> {
    this.changeLinkQueries.push([...changeRefs]);
    return this.changeLinks.filter((link) => changeRefs.includes(link.id));
  }
  async fileSummaries(): Promise<Map<string, TaskFileSummaryCounts>> {
    return new Map();
  }
  async findProject(): Promise<TaskProjectRow | null> {
    return this.project;
  }
  async findProjectNode(): Promise<TaskProjectNodeRow | null> {
    return this.node;
  }
  async findTaskIdByNode(): Promise<string | null> {
    return this.existingTaskId;
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
  group: { id: string; sortIndex: number }[] = [];
  groupSize = 0;
  shifted: { from: number; to: number | null; delta: number }[] = [];

  async insert(input: TaskInsertInput): Promise<TaskRow> {
    const row = makeRow({ id: TASK, status: "pending", progress: "0", version: 0, title: input.title, stageKey: input.stageKey, nodeId: input.nodeId, ownerIds: input.ownerIds, sortIndex: input.sortIndex });
    this.inserted = row;
    return row;
  }
  async updateWithVersion(_taskId: string, expectedVersion: number, patch: TaskUpdatePatch, at: Date): Promise<TaskRow | null> {
    const current = this.task;
    if (current === null || current.version !== expectedVersion) return null;
    const next: TaskRow = {
      ...current,
      ownerIds: patch.ownerIds !== undefined ? patch.ownerIds : current.ownerIds,
      status: patch.status ?? current.status,
      progress: patch.progress ?? current.progress,
      sortIndex: patch.sortIndex !== undefined ? patch.sortIndex : current.sortIndex,
      plannedStart: patch.plannedStart !== undefined ? patch.plannedStart : current.plannedStart,
      plannedEnd: patch.plannedEnd !== undefined ? patch.plannedEnd : current.plannedEnd,
      actualEnd: patch.actualEnd !== undefined ? patch.actualEnd : current.actualEnd,
      estimatedDays: patch.estimatedDays !== undefined ? patch.estimatedDays : current.estimatedDays,
      headcount: patch.headcount !== undefined ? patch.headcount : current.headcount,
      priority: patch.priority !== undefined ? patch.priority : current.priority,
      note: patch.note !== undefined ? patch.note : current.note,
      updatedAt: at,
      version: current.version + 1,
    };
    this.task = next;
    return next;
  }
  async insertEvents(_tx: DbClient, events: readonly TaskEventInput[]): Promise<void> {
    this.events.push(...events);
  }
  async touchProject(projectId: string): Promise<void> {
    this.touched.push(projectId);
  }
  async countStageTasks(): Promise<{ total: number; done: number }> {
    return { total: 0, done: 0 };
  }
  async findTaskBrief(): Promise<{ id: string; projectId: string; stageKey: string | null; sortIndex: number } | null> {
    return this.task === null
      ? null
      : { id: this.task.id, projectId: this.task.projectId, stageKey: this.task.stageKey, sortIndex: this.task.sortIndex };
  }
  async countGroup(): Promise<number> {
    return this.groupSize;
  }
  async listGroupOrder(): Promise<{ id: string; sortIndex: number }[]> {
    return this.group;
  }
  async shiftGroupIndexes(
    _projectId: string,
    _stageKey: string | null,
    from: number,
    to: number | null,
    delta: number,
  ): Promise<void> {
    this.shifted.push({ from, to, delta });
    for (const row of this.group) {
      if (row.sortIndex >= from && (to === null || row.sortIndex <= to)) row.sortIndex += delta;
    }
  }
  async taskCountsByStage(): Promise<never[]> {
    return [];
  }
}

/** 门禁替身（M3-03）：默认放行；用例可注入要求与计数（缺件 / draft 提示）。 */
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

class FakeRoleService {
  roleCodes: string[] = [];
  async getActorAuthorization(): Promise<{ roleCodes: string[] }> {
    return { roleCodes: this.roleCodes };
  }
}

class FakeDatabase {
  outbox: unknown[] = [];
  db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(this.makeTx()),
  };
  makeTx() {
    return {
      insert: () => ({
        values: async (value: unknown) => {
          this.outbox.push(value);
        },
      }),
    };
  }
}

/** 审计替身（h7）：只记录写入调用。 */
class FakeAuditService {
  entries: unknown[] = [];
  async record(_client: unknown, input: unknown): Promise<void> {
    this.entries.push(input);
  }
}

function makeService(
  repo: FakeTaskRepository,
  roles: FakeRoleService = new FakeRoleService(),
  gate: FakeTaskGateRepository = new FakeTaskGateRepository(),
): TaskService {
  const database = new FakeDatabase();
  return new TaskService(
    database as unknown as DatabaseService,
    repo as unknown as TaskRepository,
    gate as unknown as TaskGateRepository,
    roles as unknown as RoleService,
    new FakeAuditService() as unknown as AuditService,
  );
}

describe("TaskService.create（A10 / A1-13）", () => {
  it("带节点创建：ownerIds 缺省 = 项目全部项目经理，状态 pending / 进度 0，写 outbox 与项目触点", async () => {
    const repo = new FakeTaskRepository();
    const service = makeService(repo);
    const created = await service.create(
      PROJECT,
      { stageKey: "install", title: "货架组装", taskNodeId: NODE },
      ACTOR,
    );
    expect(created.ownerIds).toEqual([MANAGER]);
    expect(created.status).toBe("pending");
    expect(created.progress).toBe(0);
    expect(repo.touched).toEqual([PROJECT]);
  });

  it("多位项目经理（A23 · Push 136）：ownerIds 缺省兜底 = 项目全部经理、顺序与 managerIds 一致", async () => {
    const repo = new FakeTaskRepository();
    repo.project = { id: PROJECT, managerIds: [MANAGER, MANAGER_2], stageKey: "presale", status: "active" };
    const service = makeService(repo);
    const created = await service.create(PROJECT, { stageKey: "install", title: "货架组装", taskNodeId: NODE }, ACTOR);
    expect(created.ownerIds).toEqual([MANAGER, MANAGER_2]);
  });

  it("节点判重 → 409 TASK_ALREADY_EXISTS", async () => {
    const repo = new FakeTaskRepository();
    repo.existingTaskId = TASK;
    const service = makeService(repo);
    await expect(service.create(PROJECT, { stageKey: "install", title: "货架组装", taskNodeId: NODE }, ACTOR)).rejects.toMatchObject({
      code: "TASK_ALREADY_EXISTS",
      httpStatus: 409,
    });
  });

  it("手工创建（无节点）非管理员 → 403；管理员 → 放行", async () => {
    const repo = new FakeTaskRepository();
    const roles = new FakeRoleService();
    const service = makeService(repo, roles);
    await expect(service.create(PROJECT, { stageKey: "install", title: "临时任务" }, ACTOR)).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    roles.roleCodes = ["admin"];
    const created = await service.create(PROJECT, { stageKey: "install", title: "临时任务" }, ACTOR);
    expect(created.title).toBe("临时任务");
  });

  it("stageKey 与来源节点阶段不一致 → 400", async () => {
    const repo = new FakeTaskRepository();
    repo.node = { id: NODE, stageKey: "install", status: "active" };
    const service = makeService(repo);
    await expect(service.create(PROJECT, { stageKey: "deploy", title: "货架组装", taskNodeId: NODE }, ACTOR)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      httpStatus: 400,
    });
  });

  it("归档项目 → 409 PROJECT_ARCHIVED", async () => {
    const repo = new FakeTaskRepository();
    repo.project = { id: PROJECT, managerIds: [MANAGER], stageKey: "acceptance", status: "archived" };
    const service = makeService(repo);
    await expect(service.create(PROJECT, { stageKey: "install", title: "货架组装", taskNodeId: NODE }, ACTOR)).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
      httpStatus: 409,
    });
  });
});

describe("TaskService.update（A12 状态联动 + 乐观锁 + 留痕）", () => {
  it("status=done → 进度满格 + 完成日期按当天补，留痕 status / progress / date 三类", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ status: "active", progress: "0.5" });
    const service = makeService(repo);
    const updated = await service.update(PROJECT, TASK, { status: "done", version: 3 }, ACTOR);
    expect(updated.status).toBe("done");
    expect(updated.progress).toBe(1);
    expect(updated.actualEnd).toBe(shanghaiToday(new Date()));
    expect(updated.displayStatus).toBe("done");
    expect(repo.events.map((event) => event.eventType)).toEqual(["status_change", "progress_change", "date_change"]);
    expect(repo.touched).toEqual([PROJECT]);
  });

  it("status=active（已满格）→ 退回 0.75 并清完成日期", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ status: "done", progress: "1", actualEnd: "2026-09-10" });
    const service = makeService(repo);
    const updated = await service.update(PROJECT, TASK, { status: "active", version: 3 }, ACTOR);
    expect(updated.status).toBe("active");
    expect(updated.progress).toBe(0.75);
    expect(updated.actualEnd).toBeNull();
  });

  it("过期未完成的展示态保持「已延期」（派生优先，不因写状态改写）", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ status: "active", progress: "0.5", plannedEnd: "2020-01-01" });
    const service = makeService(repo);
    const updated = await service.update(PROJECT, TASK, { status: "done", version: 3 }, ACTOR);
    expect(updated.status).toBe("done");
    const overdueRow = makeRow({ status: "pending", progress: "0.25", plannedEnd: "2020-01-01" });
    repo.task = overdueRow;
    const stillOverdue = await service.update(PROJECT, TASK, { status: "pending", version: 3 }, ACTOR);
    expect(stillOverdue.displayStatus).toBe("overdue");
  });

  it("乐观锁冲突（stale version）→ 409 VERSION_CONFLICT", async () => {
    const repo = new FakeTaskRepository();
    const service = makeService(repo);
    await expect(service.update(PROJECT, TASK, { status: "done", version: 2 }, ACTOR)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      httpStatus: 409,
    });
  });

  it("任务不属于该项目 → 404", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ projectId: "44444444-4444-4444-8444-444444444444" });
    const service = makeService(repo);
    await expect(service.update(PROJECT, TASK, { status: "done", version: 3 }, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("TaskService.updateProgress（A13 清除完成日期的唯一方式）", () => {
  it("从已完成写回 0.75 → 进行中、清完成日期", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ status: "done", progress: "1", actualEnd: "2026-09-10" });
    const service = makeService(repo);
    const updated = await service.updateProgress(PROJECT, TASK, { progress: 0.75, version: 3 }, ACTOR);
    expect(updated.status).toBe("active");
    expect(updated.progress).toBe(0.75);
    expect(updated.actualEnd).toBeNull();
    expect(repo.events.map((event) => event.eventType)).toContain("date_change");
    expect(repo.touched).toEqual([PROJECT]);
  });

  it("progress=1 显式完成日期 → 采用传入值", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ status: "active", progress: "0.75", plannedEnd: "2026-12-31" });
    const service = makeService(repo);
    const updated = await service.updateProgress(PROJECT, TASK, { progress: 1, actualEnd: "2026-09-15", version: 3 }, ACTOR);
    expect(updated.status).toBe("done");
    expect(updated.actualEnd).toBe("2026-09-15");
    expect(updated.displayStatus).toBe("early_done");
  });
});

describe("TaskService w2 落库口径（A15 / A18 / A19 / A20 · Push 124）", () => {
  it("临时任务：stageKey 缺省 = 「未分组」、ownerIds 显式 [] = 「待分配」（不兜底项目经理）", async () => {
    const repo = new FakeTaskRepository();
    const roles = new FakeRoleService();
    roles.roleCodes = ["admin"];
    const service = makeService(repo, roles);
    const created = await service.create(PROJECT, { title: "临时任务", ownerIds: [] }, ACTOR);
    expect(created.stageKey).toBeNull();
    expect(created.ownerIds).toEqual([]);
  });

  it("带节点创建：stageKey 缺省取来源节点阶段；sortIndex 缺省 = 组尾（不平移）", async () => {
    const repo = new FakeTaskRepository();
    repo.groupSize = 3;
    const service = makeService(repo);
    const created = await service.create(PROJECT, { title: "货架组装", taskNodeId: NODE }, ACTOR);
    expect(created.stageKey).toBe("install");
    expect(created.sortIndex).toBe(3);
    expect(repo.shifted).toEqual([]);
  });

  it("插入位置：sortIndex=0 → 同组其余任务位次顺延（+1），新任务落 0 位", async () => {
    const repo = new FakeTaskRepository();
    repo.groupSize = 3;
    const roles = new FakeRoleService();
    roles.roleCodes = ["admin"];
    const service = makeService(repo, roles);
    const created = await service.create(PROJECT, { title: "临时任务", sortIndex: 0 }, ACTOR);
    expect(created.sortIndex).toBe(0);
    expect(repo.shifted).toEqual([{ from: 0, to: null, delta: 1 }]);
  });

  it("负责人显式置空：PATCH ownerIds=[] → 待分配（不保留原值）", async () => {
    const repo = new FakeTaskRepository();
    const service = makeService(repo);
    const updated = await service.update(PROJECT, TASK, { ownerIds: [], version: 3 }, ACTOR);
    expect(updated.ownerIds).toEqual([]);
  });

  it("拖动排序：移到组首 → 同组其余顺延；越界 = 组尾", async () => {
    const repo = new FakeTaskRepository();
    const other1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const other2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    repo.task = makeRow({ sortIndex: 1 });
    repo.group = [
      { id: other1, sortIndex: 0 },
      { id: TASK, sortIndex: 1 },
      { id: other2, sortIndex: 2 },
    ];
    const service = makeService(repo);
    const moved = await service.update(PROJECT, TASK, { sortIndex: 0, version: 3 }, ACTOR);
    expect(moved.sortIndex).toBe(0);
    expect(repo.shifted).toEqual([{ from: 0, to: 0, delta: 1 }]);

    repo.task = makeRow({ sortIndex: 0 });
    repo.shifted = [];
    repo.group = [
      { id: TASK, sortIndex: 0 },
      { id: other1, sortIndex: 1 },
      { id: other2, sortIndex: 2 },
    ];
    const toEnd = await service.update(PROJECT, TASK, { sortIndex: 99, version: 3 }, ACTOR);
    expect(toEnd.sortIndex).toBe(2);
    expect(repo.shifted).toEqual([{ from: 1, to: 2, delta: -1 }]);
  });
});

describe("TaskService.summary（项目总览四格）", () => {
  it("当前阶段取项目字段，逾期 / 已完成 / 总数取任务计数", async () => {
    const repo = new FakeTaskRepository();
    repo.counts = { overdue: 2, done: 5, total: 9 };
    const service = makeService(repo);
    const summary = await service.summary(PROJECT);
    expect(summary).toEqual({ projectId: PROJECT, currentStage: "presale", overdue: 2, done: 5, total: 9 });
  });
});

describe("变更关联多条（A1-07 / R01 · Push 144）", () => {
  const CHANGE_1 = "aaaa1111-1111-4111-8111-111111111111";
  const CHANGE_2 = "bbbb2222-2222-4222-8222-222222222222";

  it("详情随行 changeLinks = change_refs 追加序（多条 + 原因截断，全文留给变更记录）", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ changeRefs: [CHANGE_1, CHANGE_2] });
    repo.changeLinks = [
      { id: CHANGE_1, reason: "首次变更：孔位调整", appliedAt: "2026-09-20T02:00:00.000Z" },
      { id: CHANGE_2, reason: "x".repeat(50), appliedAt: "2026-09-21T02:00:00.000Z" },
    ];

    const detail = await makeService(repo).detail(PROJECT, TASK);

    expect(detail.changeLinks.map((link) => link.id)).toEqual([CHANGE_1, CHANGE_2]);
    expect(detail.changeLinks[0]).toEqual({
      id: CHANGE_1,
      reason: "首次变更：孔位调整",
      appliedAt: "2026-09-20T02:00:00.000Z",
    });
    expect(detail.changeLinks[1]!.reason).toBe("x".repeat(40) + "…");
  });

  it("编辑响应回读 change_refs：既有变更关联不被响应清空", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ changeRefs: [CHANGE_1] });
    repo.changeLinks = [{ id: CHANGE_1, reason: "设计变更", appliedAt: "2026-09-20T02:00:00.000Z" }];

    const updated = await makeService(repo).update(PROJECT, TASK, { version: 3, note: "改备注" }, ACTOR);

    expect(repo.changeLinkQueries).toEqual([[CHANGE_1]]);
    expect(updated.changeLinks.map((link) => link.id)).toEqual([CHANGE_1]);
  });

  it("无关联任务：changeLinks = []（空数组不下发 null）", async () => {
    const repo = new FakeTaskRepository();
    repo.task = makeRow({ changeRefs: [] });

    const detail = await makeService(repo).detail(PROJECT, TASK);

    expect(detail.changeLinks).toEqual([]);
  });
});
