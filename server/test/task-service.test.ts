import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/db/database.service.js";
import type { DbClient } from "../src/db/db-client.js";
import type { RoleService } from "../src/modules/identity/index.js";
import type {
  TaskEventInput,
  TaskFileSummaryCounts,
  TaskListRow,
  TaskProjectNodeRow,
  TaskProjectRow,
  TaskInsertInput,
  TaskRow,
  TaskUpdatePatch,
} from "../src/modules/task/task.repository.js";
import { TaskRepository } from "../src/modules/task/task.repository.js";
import { shanghaiToday } from "../src/modules/task/task.rules.js";
import { TaskService } from "../src/modules/task/task.service.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const MANAGER = "caa8d763-4b6a-4967-9b26-7d1086272c9c";
const ACTOR = "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69";

function makeRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: TASK,
    projectId: PROJECT,
    stageKey: "install",
    nodeId: NODE,
    title: "货架组装",
    titleEn: null,
    ownerId: MANAGER,
    status: "pending",
    progress: "0",
    plannedStart: null,
    plannedEnd: null,
    actualEnd: null,
    estimatedDays: null,
    headcount: null,
    priority: null,
    deliverable: null,
    note: null,
    onTime: null,
    changeRef: null,
    version: 3,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

class FakeTaskRepository {
  project: TaskProjectRow | null = { id: PROJECT, managerId: MANAGER, stageKey: "presale", status: "active" };
  node: TaskProjectNodeRow | null = { id: NODE, stageKey: "install", status: "active" };
  existingTaskId: string | null = null;
  task: TaskRow | null = makeRow();
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
    return this.task === null ? null : { task: this.task, ownerName: "张三", changeSummary: null };
  }
  async listFiles(): Promise<never[]> {
    return [];
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
  async insert(input: TaskInsertInput): Promise<TaskRow> {
    const row = makeRow({ id: TASK, status: "pending", progress: "0", version: 0, title: input.title, stageKey: input.stageKey, nodeId: input.nodeId, ownerId: input.ownerId });
    this.inserted = row;
    return row;
  }
  async updateWithVersion(_taskId: string, expectedVersion: number, patch: TaskUpdatePatch, at: Date): Promise<TaskRow | null> {
    const current = this.task;
    if (current === null || current.version !== expectedVersion) return null;
    const next: TaskRow = {
      ...current,
      ownerId: patch.ownerId ?? current.ownerId,
      status: patch.status ?? current.status,
      progress: patch.progress ?? current.progress,
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
  async taskCountsByStage(): Promise<never[]> {
    return [];
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

function makeService(repo: FakeTaskRepository, roles: FakeRoleService = new FakeRoleService()): TaskService {
  const database = new FakeDatabase();
  return new TaskService(database as unknown as DatabaseService, repo as unknown as TaskRepository, roles as unknown as RoleService);
}

describe("TaskService.create（A10 / A1-13）", () => {
  it("带节点创建：ownerId 缺省 = 项目经理，状态 pending / 进度 0，写 outbox 与项目触点", async () => {
    const repo = new FakeTaskRepository();
    const service = makeService(repo);
    const created = await service.create(
      PROJECT,
      { stageKey: "install", title: "货架组装", taskNodeId: NODE },
      ACTOR,
    );
    expect(created.ownerId).toBe(MANAGER);
    expect(created.status).toBe("pending");
    expect(created.progress).toBe(0);
    expect(repo.touched).toEqual([PROJECT]);
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
    repo.project = { id: PROJECT, managerId: MANAGER, stageKey: "acceptance", status: "archived" };
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

describe("TaskService.summary（项目总览四格）", () => {
  it("当前阶段取项目字段，逾期 / 已完成 / 总数取任务计数", async () => {
    const repo = new FakeTaskRepository();
    repo.counts = { overdue: 2, done: 5, total: 9 };
    const service = makeService(repo);
    const summary = await service.summary(PROJECT);
    expect(summary).toEqual({ projectId: PROJECT, currentStage: "presale", overdue: 2, done: 5, total: 9 });
  });
});
