/**
 * 用户偏好（A4 / A24 · Push 169；A4 列显隐白名单 · Push 170；A31 工作台展开态 · Push 233；「我的计划」便签墙 · Push 268）回归：无行默认值、PATCH 合并语义（只传变更键 / 数组整体替换 /
 * 未声明键保留）、读侧规范化（jsonb 是自由对象，脏数据一律收敛不抛错）、契约上限（≤ 20 组 / 名称 ≤ 20 字）、
 * 任务表列 key 白名单（未知 key 400 + 与前端 `TABLE_COLUMNS` 同源）、工作台展开态形状与收敛、便签墙形状 / 收敛 / 服务端盖章。
 * 不连库：仓储用内存替身（与 admin-audit.test.ts 同口径）；契约 schema 直接解析校验。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAN_BOARD_CATEGORY_LIMIT, PLAN_BOARD_NOTE_LIMIT, SAVED_HOME_FILTER_LIMIT, TASK_TABLE_COLUMN_KEYS, UserPreferencesUpdateBodySchema, WORKSPACE_OPEN_PROJECTS_LIMIT } from "@libiaolink/contracts";
import type { MyPlanNote } from "@libiaolink/contracts";
import type { SavedHomeFilter } from "@libiaolink/contracts";
import { UserPreferenceService } from "../src/modules/identity/user-preference.service.js";
import type { UserPreferenceRepository, UserPreferenceRow } from "../src/modules/identity/user-preference.repository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AT = new Date("2026-09-23T04:00:00.000Z");

class FakePreferenceRepository {
  rows = new Map<string, UserPreferenceRow>();
  async find(userId: string): Promise<UserPreferenceRow | null> {
    return this.rows.get(userId) ?? null;
  }
  async upsert(userId: string, prefs: Record<string, unknown>, at: Date): Promise<UserPreferenceRow> {
    const row = { userId, prefs, updatedAt: at } as UserPreferenceRow;
    this.rows.set(userId, row);
    return row;
  }
}

function makeService(): { service: UserPreferenceService; repo: FakePreferenceRepository } {
  const repo = new FakePreferenceRepository();
  return { service: new UserPreferenceService(repo as unknown as UserPreferenceRepository), repo };
}

/**
 * 白名单与前端任务表列**同源**（契约承诺「与前端 TABLE_COLUMNS 一致」）：直接读前端源码抽取非锁定列 key。
 * 前端这份没有测试基建，故把守卫放在 server 测试里（比注释更强：改一边漏另一边会红）。
 */
function frontendColumnKeys(): string[] {
  const source = readFileSync(fileURLToPath(new URL("../../frontend/src/components/TaskBoard.tsx", import.meta.url)), "utf8");
  const start = source.indexOf("export const TABLE_COLUMNS");
  if (start < 0) {
    throw new Error("未找到前端 TABLE_COLUMNS（文件被改名？同步更新本守卫）");
  }
  const block = source.slice(start, source.indexOf("];", start));
  const keys: string[] = [];
  for (const match of block.matchAll(/\{\s*key:\s*"([a-zA-Z]+)"([^}]*)\}/g)) {
    const body = match[2] ?? "";
    if (!body.includes("locked: true")) {
      keys.push(match[1] ?? "");
    }
  }
  return keys;
}

function filterOf(index: number, name?: string): SavedHomeFilter {
  return {
    id: "sf-" + String(index),
    name: name ?? "组合" + String(index),
    regions: ["华东"],
    projectTypes: [],
    managerIds: [],
    timeFrom: null,
    timeTo: null,
  };
}

describe("用户偏好（A4 / A24）", () => {
  it("无行：返回契约默认值 + updatedAt null", async () => {
    const { service } = makeService();
    expect(await service.get(USER_ID)).toEqual({ taskTableHiddenColumns: [], homeSavedFilters: [], focusMode: false, workspaceOpenProjects: { tasks: [], raised: [] }, myPlanBoard: { notes: [], categories: [], updatedAt: null }, updatedAt: null });
  });

  it("首次 PATCH 只传 homeSavedFilters：数组整体落库，updatedAt 为写入时间", async () => {
    const { service, repo } = makeService();
    const prefs = await service.update(USER_ID, { homeSavedFilters: [filterOf(1)] }, AT);
    expect(prefs.homeSavedFilters).toEqual([filterOf(1)]);
    expect(prefs.taskTableHiddenColumns).toEqual([]);
    expect(prefs.updatedAt).toBe(AT.toISOString());
    expect(repo.rows.get(USER_ID)?.prefs).toEqual({ homeSavedFilters: [filterOf(1)] });
  });

  it("合并语义：只传变更键 —— 未传的声明键保持原值，数组键整体替换", async () => {
    const { service } = makeService();
    await service.update(USER_ID, { taskTableHiddenColumns: ["owner", "due"], homeSavedFilters: [filterOf(1), filterOf(2)] }, AT);
    const after = await service.update(USER_ID, { homeSavedFilters: [filterOf(3)] }, AT);
    expect(after.taskTableHiddenColumns).toEqual(["owner", "due"]);
    expect(after.homeSavedFilters).toEqual([filterOf(3)]);
  });

  it("未声明键原样保存（前向兼容）：后续 PATCH 不会把它冲掉", async () => {
    const { service, repo } = makeService();
    await service.update(USER_ID, { sidebarOpen: false } as unknown as { homeSavedFilters?: SavedHomeFilter[] }, AT);
    await service.update(USER_ID, { homeSavedFilters: [filterOf(4)] }, AT);
    expect(repo.rows.get(USER_ID)?.prefs).toEqual({ sidebarOpen: false, homeSavedFilters: [filterOf(4)] });
  });

  it("读侧规范化：非数组 / 缺 id / 重复 id / 非法日期一律收敛，名称超长截断", async () => {
    const { service, repo } = makeService();
    repo.rows.set(USER_ID, {
      userId: USER_ID,
      prefs: {
        taskTableHiddenColumns: ["owner", 7, "owner", "", "progress", "title"],
        homeSavedFilters: [
          filterOf(1, "名称超长超长超长超长超长超长超长超长超长"),
          { id: "sf-1", name: "重复 id" },
          { name: "缺 id" },
          null,
          { id: "sf-2", name: "坏日期", regions: [], projectTypes: [], managerIds: [], timeFrom: "2026/1/1", timeTo: "2026-09-30" },
        ],
        workspaceOpenProjects: { tasks: [PROJECT_A, 7, PROJECT_A, "", PROJECT_B], raised: "坏形状" },
      },
      updatedAt: AT,
    } as unknown as UserPreferenceRow);
    const prefs = await service.get(USER_ID);
    // owner 去重保留；progress / title / 非字符串 一律丢弃（title = 常显列，progress = 不存在）
    expect(prefs.taskTableHiddenColumns).toEqual(["owner"]);
    expect(prefs.homeSavedFilters).toHaveLength(2);
    expect(prefs.homeSavedFilters[0]?.name).toBe("名称超长超长超长超长超长超长超长超长超长超".slice(0, 20));
    expect(prefs.homeSavedFilters[1]?.timeFrom).toBeNull();
    expect(prefs.homeSavedFilters[1]?.timeTo).toBe("2026-09-30");
    expect(prefs.workspaceOpenProjects).toEqual({ tasks: [PROJECT_A, PROJECT_B], raised: [] });
    expect(prefs.updatedAt).toBe(AT.toISOString());
  });

  it("醒目模式（A4 / §6.13 · Push 171）：只传 focusMode 落库，未传键保持原值；false 可显式写回", async () => {
    const { service, repo } = makeService();
    await service.update(USER_ID, { taskTableHiddenColumns: ["owner"], focusMode: true }, AT);
    expect((await service.get(USER_ID)).focusMode).toBe(true);
    expect(repo.rows.get(USER_ID)?.prefs).toEqual({ taskTableHiddenColumns: ["owner"], focusMode: true });
    const after = await service.update(USER_ID, { homeSavedFilters: [filterOf(9)] }, AT);
    expect(after.focusMode).toBe(true);
    expect(after.taskTableHiddenColumns).toEqual(["owner"]);
    expect((await service.update(USER_ID, { focusMode: false }, AT)).focusMode).toBe(false);
  });

  it("醒目模式读侧收敛 + 契约：jsonb 里非布尔一律回 false；PATCH 非布尔 400", async () => {
    const { service, repo } = makeService();
    repo.rows.set(USER_ID, { userId: USER_ID, prefs: { focusMode: "yes" }, updatedAt: AT } as unknown as UserPreferenceRow);
    const prefs = await service.get(USER_ID);
    expect(prefs.focusMode).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ focusMode: true }).success).toBe(true);
    expect(UserPreferencesUpdateBodySchema.safeParse({ focusMode: false }).success).toBe(true);
    expect(UserPreferencesUpdateBodySchema.safeParse({ focusMode: "yes" }).success).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ focusMode: 1 }).success).toBe(false);
  });

  it("工作台展开态（A31 · Push 233）：只传 workspaceOpenProjects 落库、整体替换；两标签各自独立", async () => {
    const { service, repo } = makeService();
    await service.update(USER_ID, { workspaceOpenProjects: { tasks: [PROJECT_A], raised: [] } }, AT);
    expect((await service.get(USER_ID)).workspaceOpenProjects).toEqual({ tasks: [PROJECT_A], raised: [] });
    const after = await service.update(USER_ID, { workspaceOpenProjects: { tasks: [], raised: [PROJECT_B] } }, AT);
    expect(after.workspaceOpenProjects).toEqual({ tasks: [], raised: [PROJECT_B] });
    expect(repo.rows.get(USER_ID)?.prefs).toEqual({ workspaceOpenProjects: { tasks: [], raised: [PROJECT_B] } });
  });

  it("工作台展开态契约：{ tasks, raised }（uuid 数组）通过；缺键 / 非 uuid / 超上限 400", () => {
    expect(UserPreferencesUpdateBodySchema.safeParse({ workspaceOpenProjects: { tasks: [PROJECT_A], raised: [] } }).success).toBe(true);
    expect(UserPreferencesUpdateBodySchema.safeParse({ workspaceOpenProjects: { tasks: [] } }).success).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ workspaceOpenProjects: { tasks: ["不是-uuid"], raised: [] } }).success).toBe(false);
    const many = Array.from({ length: WORKSPACE_OPEN_PROJECTS_LIMIT + 1 }, () => PROJECT_A);
    expect(UserPreferencesUpdateBodySchema.safeParse({ workspaceOpenProjects: { tasks: many, raised: [] } }).success).toBe(false);
  });

  it("便签墙（「我的计划」· Push 268）：只传 myPlanBoard 落库、整体替换；updatedAt 由服务端盖章（不被客户端伪造值覆盖）", async () => {
    const { service, repo } = makeService();
    const note: MyPlanNote = { id: "pn-1", title: "买纸", content: "A4", category: "采购", colorId: "yellow", fontId: "sans", done: false, createdAt: AT.toISOString(), updatedAt: AT.toISOString() };
    await service.update(USER_ID, { myPlanBoard: { notes: [note], categories: ["采购"] } }, AT);
    const prefs = await service.get(USER_ID);
    expect(prefs.myPlanBoard.notes).toEqual([note]);
    expect(prefs.myPlanBoard.categories).toEqual(["采购"]);
    expect(prefs.myPlanBoard.updatedAt).toBe(AT.toISOString());
    expect(repo.rows.get(USER_ID)?.prefs).toEqual({ myPlanBoard: { notes: [note], categories: ["采购"], updatedAt: AT.toISOString() } });
    // 客户端夹带 updatedAt 伪造 → 被服务端盖章值覆盖（写入时间以服务端为准）
    const forged: MyPlanNote = { ...note, id: "pn-2", done: true };
    const later = new Date("2026-10-10T02:00:00.000Z");
    const after = await service.update(USER_ID, { myPlanBoard: { notes: [forged], categories: ["采购"], updatedAt: "1999-01-01T00:00:00.000Z" } } as unknown as { myPlanBoard?: unknown }, later);
    expect(after.myPlanBoard.updatedAt).toBe(later.toISOString());
    expect(after.myPlanBoard.notes).toEqual([forged]);
    // 未传键保持原值：换个键 PATCH 不冲掉便签墙
    expect((await service.update(USER_ID, { focusMode: true }, AT)).myPlanBoard.notes).toEqual([forged]);
  });

  it("便签墙读侧收敛：脏 jsonb（非法便签整条丢弃 / 颜色字体回落 / done 非布尔 → false / 分类去空去重）", async () => {
    const { service, repo } = makeService();
    const ok: MyPlanNote = { id: "pn-a", title: "t", content: "c", category: "待办", colorId: "blue", fontId: "mono", done: true, createdAt: AT.toISOString(), updatedAt: AT.toISOString() };
    const dirty = {
      notes: [ok, { id: "pn-b" }, "oops", { ...ok, id: "pn-c", colorId: "red", fontId: "x", done: "yes" }, { ...ok, id: "pn-d", category: "  " }, { ...ok, id: "pn-e", title: "", content: "" }],
      categories: ["待办", "待办", 5, "", "采购"],
    };
    repo.rows.set(USER_ID, { userId: USER_ID, prefs: { myPlanBoard: dirty }, updatedAt: AT } as unknown as UserPreferenceRow);
    const prefs = await service.get(USER_ID);
    expect(prefs.myPlanBoard.notes.map((item) => item.id)).toEqual(["pn-a", "pn-c"]);
    expect(prefs.myPlanBoard.notes[1]).toMatchObject({ colorId: "white", fontId: "sans", done: false });
    expect(prefs.myPlanBoard.categories).toEqual(["待办", "采购"]);
    expect(prefs.myPlanBoard.updatedAt).toBeNull();
  });

  it("便签墙契约：≤ 300 条 / done 必填 / 颜色字体白名单；超上限 / 缺 done / 未知色 / 超 12 类由 schema 拒绝", () => {
    const note: MyPlanNote = { id: "pn-1", title: "t", content: "", category: "待办", colorId: "white", fontId: "sans", done: false, createdAt: AT.toISOString(), updatedAt: AT.toISOString() };
    expect(UserPreferencesUpdateBodySchema.safeParse({ myPlanBoard: { notes: [note], categories: ["待办"] } }).success).toBe(true);
    expect(UserPreferencesUpdateBodySchema.safeParse({ myPlanBoard: { notes: [{ ...note, done: undefined }], categories: ["待办"] } }).success).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ myPlanBoard: { notes: [{ ...note, colorId: "red" }], categories: ["待办"] } }).success).toBe(false);
    const many = Array.from({ length: PLAN_BOARD_NOTE_LIMIT + 1 }, () => note);
    expect(UserPreferencesUpdateBodySchema.safeParse({ myPlanBoard: { notes: many, categories: ["待办"] } }).success).toBe(false);
    const cats = Array.from({ length: PLAN_BOARD_CATEGORY_LIMIT + 1 }, (_value, index) => "类" + String(index));
    expect(UserPreferencesUpdateBodySchema.safeParse({ myPlanBoard: { notes: [], categories: cats } }).success).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ myPlanBoard: { notes: [], categories: ["一二三四五六七八九十一"] } }).success).toBe(false);
  });

  it("契约上限：第 21 组 / 名称 21 字由 schema 拒绝（服务端 400）", () => {
    const many = Array.from({ length: SAVED_HOME_FILTER_LIMIT + 1 }, (_value, index) => filterOf(index));
    expect(UserPreferencesUpdateBodySchema.safeParse({ homeSavedFilters: many }).success).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ homeSavedFilters: [filterOf(1, "一二三四五六七八九十一二三四五六七八九十一")] }).success).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ homeSavedFilters: [filterOf(1, "一二三四五六七八九十一二三四五六七八九十")] }).success).toBe(true);
  });

  it("列显隐白名单：白名单内 key 通过，未知 key / 常显的 title 拒绝（服务端 400）", () => {
    expect(UserPreferencesUpdateBodySchema.safeParse({ taskTableHiddenColumns: ["owner", "due", "deliverable"] }).success).toBe(true);
    expect(UserPreferencesUpdateBodySchema.safeParse({ taskTableHiddenColumns: [] }).success).toBe(true);
    expect(UserPreferencesUpdateBodySchema.safeParse({ taskTableHiddenColumns: ["progress"] }).success).toBe(false);
    expect(UserPreferencesUpdateBodySchema.safeParse({ taskTableHiddenColumns: ["title"] }).success).toBe(false);
  });

  it("白名单与前端任务表列同源：TASK_TABLE_COLUMN_KEYS = TABLE_COLUMNS 的非锁定列（逐项 + 顺序）", () => {
    expect(frontendColumnKeys()).toEqual([...TASK_TABLE_COLUMN_KEYS]);
  });

  it("非法形状的偏好体：空对象合法（等价空 PATCH），homeSavedFilters 非数组拒绝", () => {
    expect(UserPreferencesUpdateBodySchema.safeParse({}).success).toBe(true);
    expect(UserPreferencesUpdateBodySchema.safeParse({ homeSavedFilters: "oops" }).success).toBe(false);
  });
});
