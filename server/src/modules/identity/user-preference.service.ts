import { Injectable } from "@nestjs/common";
import { PLAN_BOARD_CATEGORY_LIMIT, PLAN_BOARD_CATEGORY_NAME_MAX, PLAN_BOARD_COLOR_IDS, PLAN_BOARD_CONTENT_MAX, PLAN_BOARD_FONT_IDS, PLAN_BOARD_NOTE_LIMIT, PLAN_BOARD_TITLE_MAX, SAVED_HOME_FILTER_LIMIT, TASK_TABLE_COLUMN_KEYS, type MyPlanBoard, type MyPlanNote, type SavedHomeFilter, type TaskTableColumnKey, type UserPreferences, type UserPreferencesUpdateBody, type WorkspaceOpenProjects } from "@libiaolink/contracts";
import { UserPreferenceRepository } from "./user-preference.repository.js";
import type { UserPreferenceRow } from "./user-preference.repository.js";

type PrefsRecord = Record<string, unknown>;

/** 读侧规范化：jsonb 是自由对象（手工 / 旧版本写入都可能存在），声明键一律按契约形状收敛，坏数据丢弃不抛错。 */
function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item !== "" && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

/** 任务表列 key 白名单（契约 `TaskTableColumnKey`）：jsonb 里可能残留旧版本 / 手改的 key，读侧一律丢弃。 */
const COLUMN_KEY_SET: ReadonlySet<TaskTableColumnKey> = new Set(TASK_TABLE_COLUMN_KEYS);

function isColumnKey(value: unknown): value is TaskTableColumnKey {
  return typeof value === "string" && COLUMN_KEY_SET.has(value as TaskTableColumnKey);
}

/** 隐藏列 key 列表：只留白名单内、去重（顺序保持写入顺序，界面按表头顺序渲染不受影响）。 */
function columnKeysOf(value: unknown): TaskTableColumnKey[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: TaskTableColumnKey[] = [];
  for (const item of value) {
    if (isColumnKey(item) && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

function savedFiltersOf(value: unknown): SavedHomeFilter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: SavedHomeFilter[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id !== "" ? record.id : null;
    const name = typeof record.name === "string" ? record.name.slice(0, 20) : "";
    if (id === null || name === "" || result.some((existing) => existing.id === id)) {
      continue;
    }
    result.push({
      id,
      name,
      regions: stringArrayOf(record.regions),
      projectTypes: stringArrayOf(record.projectTypes),
      managerIds: stringArrayOf(record.managerIds),
      timeFrom: dayOf(record.timeFrom),
      timeTo: dayOf(record.timeTo),
    });
    if (result.length >= SAVED_HOME_FILTER_LIMIT) {
      break;
    }
  }
  return result;
}

/** 布尔偏好（醒目模式 · §6.13）：jsonb 是自由对象，只认严格布尔，字符串 / 数字 / 缺失一律回默认 false（不抛错）。 */
function booleanOf(value: unknown): boolean {
  return value === true;
}

/** 工作台展开态（A31 · Push 233）：`{ tasks, raised }` 两个项目 id 列表；jsonb 里非对象 / 数组内非字符串项一律收敛（不抛错）。 */
function openProjectsOf(value: unknown): WorkspaceOpenProjects {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return { tasks: stringArrayOf(record["tasks"]), raised: stringArrayOf(record["raised"]) };
}

/** 便签颜色 / 字体白名单（契约 PlanBoardColorSchema / PlanBoardFontSchema）：jsonb 里旧值 / 手改值一律回落缺省。 */
const PLAN_COLOR_SET: ReadonlySet<string> = new Set(PLAN_BOARD_COLOR_IDS);
const PLAN_FONT_SET: ReadonlySet<string> = new Set(PLAN_BOARD_FONT_IDS);

function isoTimeOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function isPlanColor(value: unknown): value is MyPlanNote["colorId"] {
  return typeof value === "string" && PLAN_COLOR_SET.has(value);
}

function isPlanFont(value: unknown): value is MyPlanNote["fontId"] {
  return typeof value === "string" && PLAN_FONT_SET.has(value);
}

/** 「我的计划」单条（Push 268）：与前端 myPlan.ts sanitize 同口径 —— 字段缺失 / 类型不符即整条丢弃（不半读半写）。 */
function planNoteOf(value: unknown): MyPlanNote | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id !== "" && record.id.length <= 64 ? record.id : null;
  const title = typeof record.title === "string" ? record.title.slice(0, PLAN_BOARD_TITLE_MAX) : null;
  const content = typeof record.content === "string" ? record.content.slice(0, PLAN_BOARD_CONTENT_MAX) : null;
  const category = typeof record.category === "string" ? record.category.trim().slice(0, PLAN_BOARD_CATEGORY_NAME_MAX) : null;
  const createdAt = isoTimeOf(record.createdAt);
  const updatedAt = isoTimeOf(record.updatedAt);
  if (id === null || title === null || content === null || category === null || category === "" || createdAt === null || updatedAt === null) {
    return null;
  }
  if (title === "" && content === "") {
    return null;
  }
  return {
    id,
    title,
    content,
    category,
    colorId: isPlanColor(record.colorId) ? record.colorId : "white",
    fontId: isPlanFont(record.fontId) ? record.fontId : "sans",
    done: booleanOf(record.done),
    createdAt,
    updatedAt,
  };
}

/** 便签墙（Push 268）：单条逐条收敛（非法整条丢弃、id 去重、≤ 300 条）；分类表去空 / 去重 / 截断；updatedAt 非法 → null。 */
function planBoardOf(value: unknown): MyPlanBoard {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const notes: MyPlanNote[] = [];
  if (Array.isArray(record["notes"])) {
    for (const item of record["notes"]) {
      const note = planNoteOf(item);
      if (note !== null && !notes.some((existing) => existing.id === note.id)) {
        notes.push(note);
      }
      if (notes.length >= PLAN_BOARD_NOTE_LIMIT) {
        break;
      }
    }
  }
  const categories: string[] = [];
  if (Array.isArray(record["categories"])) {
    for (const item of record["categories"]) {
      if (typeof item !== "string") {
        continue;
      }
      const name = item.trim().slice(0, PLAN_BOARD_CATEGORY_NAME_MAX);
      if (name !== "" && !categories.includes(name)) {
        categories.push(name);
      }
      if (categories.length >= PLAN_BOARD_CATEGORY_LIMIT) {
        break;
      }
    }
  }
  return { notes, categories, updatedAt: isoTimeOf(record["updatedAt"]) };
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dayOf(value: unknown): string | null {
  return typeof value === "string" && DAY_ONLY.test(value) ? value : null;
}

/**
 * 用户级 UI 偏好用例（A4 / A24）：声明键 = taskTableHiddenColumns / homeSavedFilters / focusMode（§6.13 醒目模式 · Push 171）/ workspaceOpenProjects（A31 工作台展开态 · Push 233）/ myPlanBoard（「我的计划」便签墙 · Push 268）；
 * GET 返回契约全量形状（无行 = 默认值 + updatedAt null）；
 * PATCH 合并语义 —— 只传变更键、数组键整体替换、未声明键原样保存（前向兼容，不必为新偏好键改契约）。
 * 偏好是界面状态（非业务数据），不写审计；单用户单写者，无乐观锁。
 */
@Injectable()
export class UserPreferenceService {
  constructor(private readonly preferences: UserPreferenceRepository) {}

  async get(userId: string): Promise<UserPreferences> {
    return this.toContract(await this.preferences.find(userId));
  }

  async update(userId: string, body: UserPreferencesUpdateBody, at: Date = new Date()): Promise<UserPreferences> {
    const existing = await this.preferences.find(userId);
    const current: PrefsRecord = { ...(existing?.prefs ?? {}) };
    const next: PrefsRecord = { ...current, ...(body as PrefsRecord) };
    // 便签墙（Push 268）：客户端只传 notes / categories，updatedAt 由服务端盖章（不被客户端伪造）
    if (Object.prototype.hasOwnProperty.call(body, "myPlanBoard") && body.myPlanBoard !== undefined) {
      const board = body.myPlanBoard;
      next["myPlanBoard"] = { notes: board.notes, categories: board.categories, updatedAt: at.toISOString() };
    }
    return this.toContract(await this.preferences.upsert(userId, next, at));
  }

  /** 行 → 契约：声明键按形状收敛，updatedAt 由写入时间给出（无行 = null）。 */
  private toContract(row: UserPreferenceRow | null): UserPreferences {
    const prefs: PrefsRecord = row?.prefs ?? {};
    return {
      taskTableHiddenColumns: columnKeysOf(prefs["taskTableHiddenColumns"]),
      homeSavedFilters: savedFiltersOf(prefs["homeSavedFilters"]),
      focusMode: booleanOf(prefs["focusMode"]),
      workspaceOpenProjects: openProjectsOf(prefs["workspaceOpenProjects"]),
      myPlanBoard: planBoardOf(prefs["myPlanBoard"]),
      updatedAt: row === null ? null : row.updatedAt.toISOString(),
    };
  }
}
