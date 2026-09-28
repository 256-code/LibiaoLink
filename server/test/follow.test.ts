/**
 * 关注回归（M2-06 首刀 · A1-15）：目标解析（不存在 / 归档 / 不可见一律 404）、幂等关注（created 标记）、
 * 取关按关系键（未关注 404）、清单可见性过滤、批量逐条独立（followed / unfollowed / unchanged / failures）。
 * 真机口径见 server/src/modules/follow/README.md 与 server/scripts/m2-06-replay.mjs。
 */
import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/db/database.service.js";
import type { PermissionService, ProjectScopeFilter } from "../src/modules/permission/index.js";
import type { FollowListFilter, FollowListRow, FollowRow, FollowTarget } from "../src/modules/follow/follow.repository.js";
import { FollowService } from "../src/modules/follow/follow.service.js";

const ME = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const TASK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AT = new Date("2026-09-28T03:00:00.000Z");

class FakeFollowRepository {
  rows: (FollowRow & { projectId: string; projectCode: string; name: string })[] = [];
  targets = new Map<string, FollowTarget | null>();
  lastListFilter: FollowListFilter | null = null;
  deletedKeys: string[] = [];

  async list(_userId: string, filter: FollowListFilter): Promise<FollowListRow[]> {
    this.lastListFilter = filter;
    return this.rows;
  }

  async resolveTarget(objectType: string, objectId: string): Promise<FollowTarget | null> {
    return this.targets.get(objectType + "/" + objectId) ?? null;
  }

  async find(_userId: string, objectType: string, objectId: string): Promise<FollowRow | null> {
    return this.rows.find((row) => row.objectType === objectType && row.objectId === objectId) ?? null;
  }

  async insertIfAbsent(_userId: string, objectType: string, objectId: string, at: Date): Promise<FollowRow | null> {
    if (this.rows.some((row) => row.objectType === objectType && row.objectId === objectId)) return null;
    const row = makeRow({ objectType, objectId, createdAt: at });
    this.rows.push(row);
    return row;
  }

  async insert(_userId: string, objectType: string, objectId: string, at: Date): Promise<FollowRow> {
    const row = makeRow({ objectType, objectId, createdAt: at });
    this.rows.push(row);
    return row;
  }

  async deleteByKey(_userId: string, objectType: string, objectId: string): Promise<number> {
    this.deletedKeys.push(objectType + "/" + objectId);
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.objectType === objectType && row.objectId === objectId));
    return before - this.rows.length;
  }
}

class FakePermissionService {
  scope: ProjectScopeFilter = { kind: "all" };
  visible = new Set<string>([PROJECT_A, PROJECT_B]);

  async projectScope(): Promise<ProjectScopeFilter> {
    return this.scope;
  }

  async resolveProjectAccess(_actorId: string, projectId: string): Promise<{ projectId: string } | null> {
    return this.visible.has(projectId) ? { projectId } : null;
  }
}

const fakeDatabase = {
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(undefined) },
} as unknown as DatabaseService;

function makeRow(
  overrides: Partial<FollowRow> & { projectId?: string; projectCode?: string; name?: string } = {},
): FollowRow & { projectId: string; projectCode: string; name: string } {
  const base = {
    id: "99999999-9999-4999-8999-999999999999",
    userId: ME,
    objectType: "project",
    objectId: PROJECT_A,
    createdAt: new Date("2026-09-28T03:00:00.000Z"),
    projectId: PROJECT_A,
    projectCode: "P-001",
    name: "示范项目",
  };
  return { ...base, ...overrides };
}

function makeService(repo: FakeFollowRepository, permission: FakePermissionService): FollowService {
  return new FollowService(repo as never, permission as unknown as PermissionService, fakeDatabase);
}

function projectTarget(overrides: Partial<FollowTarget> = {}): FollowTarget {
  return { projectId: PROJECT_A, projectCode: "P-001", name: "示范项目", archived: false, ...overrides };
}

describe("关注服务（M2-06 首刀 · A1-15）", () => {
  it("关注：新建 → created=true（201 语义）；重复 → created=false（200 幂等）；随行名称来自目标解析", async () => {
    const repo = new FakeFollowRepository();
    const permission = new FakePermissionService();
    repo.targets.set("project/" + PROJECT_A, projectTarget());
    const service = makeService(repo, permission);
    const first = await service.create(ME, { objectType: "project", objectId: PROJECT_A }, AT);
    expect(first.created).toBe(true);
    expect(first.item).toEqual({
      objectType: "project",
      objectId: PROJECT_A,
      projectId: PROJECT_A,
      projectCode: "P-001",
      name: "示范项目",
      createdAt: "2026-09-28T03:00:00.000Z",
    });
    const second = await service.create(ME, { objectType: "project", objectId: PROJECT_A }, AT);
    expect(second.created).toBe(false);
    expect(repo.rows).toHaveLength(1);
  });

  it("关注：不存在 / 归档 / 不可见一律 404（不落库）", async () => {
    const repo = new FakeFollowRepository();
    const permission = new FakePermissionService();
    const service = makeService(repo, permission);
    await expect(service.create(ME, { objectType: "project", objectId: PROJECT_A })).rejects.toMatchObject({ code: "NOT_FOUND" });
    repo.targets.set("project/" + PROJECT_A, projectTarget({ archived: true }));
    await expect(service.create(ME, { objectType: "project", objectId: PROJECT_A })).rejects.toMatchObject({ code: "NOT_FOUND" });
    repo.targets.set("project/" + PROJECT_A, projectTarget());
    permission.visible = new Set();
    await expect(service.create(ME, { objectType: "project", objectId: PROJECT_A })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repo.rows).toEqual([]);
  });

  it("关注任务：随行任务标题 + 所属项目编号", async () => {
    const repo = new FakeFollowRepository();
    repo.targets.set("task/" + TASK_A, { projectId: PROJECT_B, projectCode: "P-002", name: "安装设备", archived: false });
    const service = makeService(repo, new FakePermissionService());
    const response = await service.create(ME, { objectType: "task", objectId: TASK_A });
    expect(response.item).toMatchObject({ objectType: "task", objectId: TASK_A, projectId: PROJECT_B, projectCode: "P-002", name: "安装设备" });
  });

  it("取关：有行 → removed=true；无行 → 404（不发删除之外的副作用）", async () => {
    const repo = new FakeFollowRepository();
    repo.rows = [makeRow()];
    const service = makeService(repo, new FakePermissionService());
    await expect(service.remove(ME, "project", PROJECT_A)).resolves.toEqual({ objectType: "project", objectId: PROJECT_A, removed: true });
    await expect(service.remove(ME, "project", PROJECT_A)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("清单：过滤条件透传；不可见项目的行被 projectScope 过滤（all = 不过滤）", async () => {
    const repo = new FakeFollowRepository();
    repo.rows = [makeRow({ objectId: PROJECT_A, projectId: PROJECT_A }), makeRow({ objectType: "task", objectId: TASK_A, projectId: PROJECT_B, name: "安装设备" })];
    const permission = new FakePermissionService();
    const service = makeService(repo, permission);
    const all = await service.list(ME, {});
    expect(all.items).toHaveLength(2);
    expect(repo.lastListFilter).toEqual({ objectType: null, objectId: null, projectId: null });
    permission.scope = { kind: "ids", ids: [PROJECT_B] };
    const scoped = await service.list(ME, { objectType: "task", projectId: PROJECT_B });
    expect(scoped.items.map((item) => item.objectId)).toEqual([TASK_A]);
    expect(repo.lastListFilter).toEqual({ objectType: "task", objectId: null, projectId: PROJECT_B });
  });

  it("批量：新关注 / 重复关注 / 关注失败 / 取关 / 取关不存在 五态计数与失败明细顺序", async () => {
    const repo = new FakeFollowRepository();
    repo.rows = [makeRow({ objectId: PROJECT_A, projectId: PROJECT_A })];
    repo.targets.set("project/" + PROJECT_A, projectTarget());
    repo.targets.set("task/" + TASK_A, { projectId: PROJECT_B, projectCode: "P-002", name: "安装设备", archived: false });
    const service = makeService(repo, new FakePermissionService());
    const response = await service.batch(ME, {
      items: [
        { objectType: "project", objectId: PROJECT_A, follow: true },
        { objectType: "task", objectId: TASK_A, follow: true },
        { objectType: "project", objectId: PROJECT_B, follow: true },
        { objectType: "task", objectId: TASK_A, follow: false },
        { objectType: "task", objectId: TASK_B, follow: false },
      ],
    });
    expect(response).toEqual({
      followed: 1,
      unfollowed: 1,
      unchanged: 2,
      failures: [
        {
          index: 2,
          objectType: "project",
          objectId: PROJECT_B,
          code: "not_found",
          message: "目标不存在或已删除",
        },
      ],
    });
    expect(repo.rows.map((row) => row.objectType + "/" + row.objectId)).toEqual(["project/" + PROJECT_A]);
  });

  it("批量：归档项目关注 → not_found 失败（取关动作不受影响）", async () => {
    const repo = new FakeFollowRepository();
    repo.rows = [makeRow({ objectId: PROJECT_A, projectId: PROJECT_A })];
    repo.targets.set("project/" + PROJECT_B, projectTarget({ projectId: PROJECT_B, archived: true }));
    const service = makeService(repo, new FakePermissionService());
    const response = await service.batch(ME, {
      items: [
        { objectType: "project", objectId: PROJECT_B, follow: true },
        { objectType: "project", objectId: PROJECT_A, follow: false },
      ],
    });
    expect(response.failures).toEqual([
      { index: 0, objectType: "project", objectId: PROJECT_B, code: "not_found", message: "归档项目不可新关注（ADR-027 冻结）" },
    ]);
    expect(response.followed).toBe(0);
    expect(response.unfollowed).toBe(1);
    expect(response.unchanged).toBe(0);
  });
});
