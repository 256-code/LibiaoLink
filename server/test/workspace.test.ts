/**
 * 工作台回归（M6-05 · A6-01 / A6-03）：分组边界（逾期 / 今天 / 即将不限窗口 / 未排期）、展示态派生、
 * 进度与优先级归一化、问题两栏拆分（双命中两边都出现）、可见性口径与基准日透传。
 * 2026-09-30 口径复评：取消 7 天窗口（远期进 upcoming）、未排期单列 unscheduled（不再丢弃）。
 * 真机口径见 server/src/modules/workspace/README.md 与 server/scripts/m6-replay.mjs 证据六。
 */
import { describe, expect, it } from "vitest";
import type { PermissionService, ProjectScopeFilter } from "../src/modules/permission/index.js";
import { shanghaiToday } from "../src/modules/task/task.rules.js";
import type { WorkspaceIssueRow, WorkspaceRepository, WorkspaceTaskRow } from "../src/modules/workspace/workspace.repository.js";
import { addDays, taskGroupOf } from "../src/modules/workspace/workspace.rules.js";
import { WorkspaceService } from "../src/modules/workspace/workspace.service.js";

const ME = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const OTHER = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const TASK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ISSUE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ISSUE_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TODAY = shanghaiToday(new Date());

class FakeWorkspaceRepository {
  taskRows: WorkspaceTaskRow[] = [];
  issueRows: WorkspaceIssueRow[] = [];
  lastTaskArgs: { actorId: string; scope: ProjectScopeFilter } | null = null;
  lastIssueArgs: { actorId: string; scope: ProjectScopeFilter } | null = null;

  async listMyTasks(actorId: string, scope: ProjectScopeFilter): Promise<WorkspaceTaskRow[]> {
    this.lastTaskArgs = { actorId, scope };
    return this.taskRows;
  }

  async listMyIssues(actorId: string, scope: ProjectScopeFilter): Promise<WorkspaceIssueRow[]> {
    this.lastIssueArgs = { actorId, scope };
    return this.issueRows;
  }
}

class FakePermissionService {
  scope: ProjectScopeFilter = { kind: "all" };

  async projectScope(): Promise<ProjectScopeFilter> {
    return this.scope;
  }
}

function makeTask(overrides: Partial<WorkspaceTaskRow> = {}): WorkspaceTaskRow {
  return {
    id: TASK_A,
    projectId: PROJECT,
    projectCode: "P-001",
    projectName: "示范项目",
    stageKey: "install",
    title: "安装设备",
    titleEn: null,
    status: "active",
    statusOverride: null,
    progress: "0.5",
    plannedStart: "2026-09-01",
    plannedEnd: TODAY,
    actualEnd: null,
    ownerIds: [ME, OTHER],
    ownerNames: ["我", "他人"],
    priority: "高",
    onTime: null,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<WorkspaceIssueRow> = {}): WorkspaceIssueRow {
  return {
    id: ISSUE_A,
    projectId: PROJECT,
    projectCode: "P-001",
    projectName: "示范项目",
    taskId: TASK_A,
    title: "物料到货延迟",
    categories: ["采购部"],
    state: "in_progress",
    reporterId: OTHER,
    reporterName: "他人",
    ownerDepartment: "采购部",
    ownerId: ME,
    ownerName: "我",
    raisedAt: "2026-09-20",
    updatedAt: new Date("2026-09-25T01:00:00.000Z"),
    version: 3,
    ...overrides,
  };
}

function makeService(repo: FakeWorkspaceRepository, permission: FakePermissionService): WorkspaceService {
  return new WorkspaceService(repo as unknown as WorkspaceRepository, permission as unknown as PermissionService);
}

describe("工作台分组口径（纯函数）", () => {
  it("addDays：跨月 / 跨年按 UTC 日期串推进", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-09-28", -1)).toBe("2026-09-27");
  });

  it("taskGroupOf：逾期 / 今天 / 即将（不限窗口，+365 仍 upcoming）/ 未排期（null）", () => {
    expect(taskGroupOf(addDays(TODAY, -1), TODAY)).toBe("overdue");
    expect(taskGroupOf(TODAY, TODAY)).toBe("today");
    expect(taskGroupOf(addDays(TODAY, 1), TODAY)).toBe("upcoming");
    expect(taskGroupOf(addDays(TODAY, 7), TODAY)).toBe("upcoming");
    expect(taskGroupOf(addDays(TODAY, 8), TODAY)).toBe("upcoming");
    expect(taskGroupOf(addDays(TODAY, 365), TODAY)).toBe("upcoming");
    expect(taskGroupOf(null, TODAY)).toBe("unscheduled");
  });
});

describe("工作台服务（M6-05）", () => {
  it("四组落位：已逾期 / 今日待办 / 即将到期（含远期）/ 未排期", async () => {
    const repo = new FakeWorkspaceRepository();
    repo.taskRows = [
      makeTask({ id: TASK_A, plannedEnd: addDays(TODAY, -3) }),
      makeTask({ id: TASK_B, plannedEnd: TODAY }),
      makeTask({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", plannedEnd: addDays(TODAY, 5) }),
      makeTask({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", plannedEnd: addDays(TODAY, 9) }),
      makeTask({ id: "99999999-9999-4999-8999-999999999999", plannedEnd: null }),
    ];
    const response = await makeService(repo, new FakePermissionService()).get(ME);
    expect(response.myTasks.overdue.map((item) => item.id)).toEqual([TASK_A]);
    expect(response.myTasks.today.map((item) => item.id)).toEqual([TASK_B]);
    expect(response.myTasks.upcoming.map((item) => item.id)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ]);
    expect(response.myTasks.unscheduled.map((item) => item.id)).toEqual(["99999999-9999-4999-8999-999999999999"]);
  });

  it("组内保序：沿用仓储顺序（plannedEnd 升序 → id 升序），服务不重排", async () => {
    const repo = new FakeWorkspaceRepository();
    repo.taskRows = [
      makeTask({ id: TASK_A, plannedEnd: addDays(TODAY, -9) }),
      makeTask({ id: TASK_B, plannedEnd: addDays(TODAY, -2) }),
    ];
    const response = await makeService(repo, new FakePermissionService()).get(ME);
    expect(response.myTasks.overdue.map((item) => item.id)).toEqual([TASK_A, TASK_B]);
  });

  it("展示态派生：未完成且已过计划完成 = 已延期；显式覆盖优先（同一行两种口径）", async () => {
    const repo = new FakeWorkspaceRepository();
    repo.taskRows = [
      makeTask({ id: TASK_A, plannedEnd: addDays(TODAY, -1), statusOverride: "overdue" }),
      makeTask({ id: TASK_B, plannedEnd: addDays(TODAY, 2), statusOverride: null }),
    ];
    const response = await makeService(repo, new FakePermissionService()).get(ME);
    expect(response.myTasks.overdue[0]?.displayStatus).toBe("overdue");
    expect(response.myTasks.upcoming[0]?.displayStatus).toBe("active");
  });

  it("进度与优先级归一化：0.3 → 0.25、越界值回落 0；非三档优先级回落 null", async () => {
    const repo = new FakeWorkspaceRepository();
    repo.taskRows = [makeTask({ progress: "0.3", priority: "urgent" }), makeTask({ id: TASK_B, progress: "2", priority: null })];
    const response = await makeService(repo, new FakePermissionService()).get(ME);
    expect(response.myTasks.today[0]?.progress).toBe(0.25);
    expect(response.myTasks.today[0]?.priority).toBeNull();
    expect(response.myTasks.today[1]?.progress).toBe(0);
  });

  it("负责人姓名缺位回落空数组（待分配不参与，但读面防御）", async () => {
    const repo = new FakeWorkspaceRepository();
    repo.taskRows = [makeTask({ ownerNames: null })];
    const response = await makeService(repo, new FakePermissionService()).get(ME);
    expect(response.myTasks.today[0]?.ownerNames).toEqual([]);
  });

  it("问题两栏：我处理 / 我提出的；双命中两边都出现；多值归类与时间格式原样映射（Push 215 删处理时限）", async () => {
    const repo = new FakeWorkspaceRepository();
    repo.issueRows = [
      makeIssue({ id: ISSUE_A, ownerId: ME, reporterId: OTHER }),
      makeIssue({ id: ISSUE_B, ownerId: OTHER, reporterId: ME, categories: ["采购部", "供应商原因"] }),
      makeIssue({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ownerId: ME, reporterId: ME, state: "done" }),
    ];
    const response = await makeService(repo, new FakePermissionService()).get(ME);
    expect(response.myIssues.handling.map((item) => item.id)).toEqual([ISSUE_A, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]);
    expect(response.myIssues.raised.map((item) => item.id)).toEqual([ISSUE_B, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]);
    expect(response.myIssues.raised[0]?.categories).toEqual(["采购部", "供应商原因"]);
    expect("dueAt" in (response.myIssues.raised[0] ?? {})).toBe(false);
    expect(response.myIssues.handling[0]?.updatedAt).toBe("2026-09-25T01:00:00.000Z");
  });

  it("透传：基准日 = 上海今天、可见性口径原样下传；空集可见 = 四组空结果", async () => {
    const repo = new FakeWorkspaceRepository();
    const permission = new FakePermissionService();
    permission.scope = { kind: "ids", ids: [PROJECT] };
    const response = await makeService(repo, permission).get(ME);
    expect(response.today).toBe(TODAY);
    expect(repo.lastTaskArgs).toEqual({ actorId: ME, scope: { kind: "ids", ids: [PROJECT] } });
    expect(repo.lastIssueArgs).toEqual({ actorId: ME, scope: { kind: "ids", ids: [PROJECT] } });
    expect(response.myTasks).toEqual({ today: [], upcoming: [], overdue: [], unscheduled: [] });
    expect(response.myIssues).toEqual({ handling: [], raised: [] });
  });
});
