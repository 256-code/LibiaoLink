/**
 * 「我的计划」便签墙（工作台第三枚标签 · 业务口径 2026-10-10「照 minimemo3 的便签页融入系统」）：
 * 个人便签墙 —— 新建 / 编辑 / 删除便签，支持颜色、字体、分类（可自定义）、搜索、排序；页面形态与配色照 MiniMemo 参考页照搬（奶白背景 / 198 高圆角卡片 / 7 色 hex 调色板），编辑（填写）弹窗亦照搬（便签底色整卡铺底 + 顶栏关闭 / 7 色圆点 / 字体 Aa 分段器 + 大标题 / 记录区 + 分类胶囊 + 「更新于」底栏；业务口径 2026-10-10「填写也要一样」），不做导出 / 导入。
 *
 * 存储（本刀 · 纯前端）：按浏览器本机保存，键 libiaolink.plan.board.v1（版本化 JSON，形状 = PlanBoard）；
 * 退出登录时随其它本机记忆一起清除（AppHeader，多人共用设备的隔离手段），换账号互不可见。
 * 服务端同步（按账号存偏好、换设备可见）不在本刀：需要 user_preferences.prefs 契约扩键（wmj 线），登记为后续事项。
 *
 * 口径：
 * - 首次打开（本机无记录）预置 6 条示例便签（可删）—— 与参考页 minimemo3 的初始数据同一做法，便签墙一进来不是空的；
 * - 单条：标题（≤ 40 字）/ 内容（≤ 2000 字）/ 分类（默认六类，可加至 12 类、每类名 ≤ 10 字）/ 颜色（7 色）/ 字体（简约 / 优雅 / 等宽）；
 * - 便签数上限 300 条（超出时「新建便签」出提示，不静默丢）；
 * - 读取时逐条收敛（不合法整条丢弃），不抛错、不半读半写；损坏不覆盖原始值（等人工排查）；
 * - 导出 / 导入不做（业务口径 2026-10-10「导出导入功能不要」）；本机数据自己留底，清浏览器数据会丢。
 */

export type PlanColorId = "white" | "yellow" | "green" | "blue" | "purple" | "pink" | "orange";

export type PlanFontId = "sans" | "serif" | "mono";

export type PlanNote = {
  id: string;
  title: string;
  content: string;
  category: string;
  colorId: PlanColorId;
  fontId: PlanFontId;
  /** ISO 8601（UTC，展示按本机时区）；排序与展示同一来源。 */
  createdAt: string;
  updatedAt: string;
};

export type PlanSortKey = "updated_desc" | "created_desc" | "created_asc" | "title_asc";

export type PlanBoard = {
  notes: PlanNote[];
  categories: string[];
};

/** 本机存储键（版本化：形状升级时换 v2，旧键按迁移策略处理）。 */
export const PLAN_STORAGE_KEY = "libiaolink.plan.board.v1";

export const PLAN_TITLE_MAX = 40;
export const PLAN_CONTENT_MAX = 2000;
export const PLAN_NOTE_LIMIT = 300;
export const PLAN_CATEGORY_MAX = 12;
export const PLAN_CATEGORY_NAME_MAX = 10;

export type PlanColor = {
  id: PlanColorId;
  label: string;
  /** 卡片底色（便签墙 / 编辑弹窗同一档；Push 266 起照 MiniMemo 参考页的 hex 调色板）。 */
  bg: string;
  /** 卡片描边。 */
  border: string;
  /** 卡片文字色（标题 / 正文 / 底行继承）。 */
  ink: string;
  /** 分类签底色（编辑弹窗的取色圆点同用）。 */
  swatch: string;
};

export const PLAN_COLORS: readonly PlanColor[] = [
  { id: "white", label: "白色", bg: "#ffffff", border: "#e7e5e4", ink: "#292524", swatch: "#f1f0ee" },
  { id: "yellow", label: "黄色", bg: "#fef8d5", border: "#f2e3a4", ink: "#713f12", swatch: "#fde68a" },
  { id: "green", label: "绿色", bg: "#e4f6e6", border: "#c6e8ca", ink: "#14532d", swatch: "#b9f0bf" },
  { id: "blue", label: "蓝色", bg: "#e3eefe", border: "#c5daf7", ink: "#1e3a8a", swatch: "#bcd8fb" },
  { id: "purple", label: "紫色", bg: "#eceafd", border: "#d6d1f6", ink: "#4c1d95", swatch: "#d8cffd" },
  { id: "pink", label: "粉色", bg: "#fce8f1", border: "#f5cddf", ink: "#831843", swatch: "#fbc9e2" },
  { id: "orange", label: "橙色", bg: "#feeddb", border: "#f7d6ae", ink: "#7c2d12", swatch: "#fdd0a0" },
];

export type PlanFont = { id: PlanFontId; label: string; hint: string; className: string };

export const PLAN_FONTS: readonly PlanFont[] = [
  { id: "sans", label: "简约", hint: "默认无衬线", className: "font-sans" },
  { id: "serif", label: "优雅", hint: "衬线体", className: "font-serif" },
  { id: "mono", label: "等宽", hint: "等宽体", className: "font-mono" },
];

/** 默认分类（首次打开预置；可再加，不删除 —— 便签引用的分类永远在）。 */
export const PLAN_DEFAULT_CATEGORIES: readonly string[] = ["待办", "工作", "想法", "采购", "个人", "其他"];

export const PLAN_SORT_LABELS: Record<PlanSortKey, string> = {
  updated_desc: "最近更新",
  created_desc: "最新创建",
  created_asc: "最早创建",
  title_asc: "标题 A→Z",
};

export function planColorOf(id: string): PlanColor {
  return PLAN_COLORS.find((item) => item.id === id) ?? PLAN_COLORS[0];
}

export function planFontOf(id: string): PlanFont {
  return PLAN_FONTS.find((item) => item.id === id) ?? PLAN_FONTS[0];
}

function isPlanColorId(value: string): value is PlanColorId {
  return PLAN_COLORS.some((item) => item.id === value);
}

function isPlanFontId(value: string): value is PlanFontId {
  return PLAN_FONTS.some((item) => item.id === value);
}

export function newPlanNoteId(): string {
  return "pn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** 标题：去首尾空白 + 截断（超长截断而不是拒绝）。 */
export function normalizePlanTitle(raw: string): string {
  return raw.trim().slice(0, PLAN_TITLE_MAX);
}

/** 内容：去尾部空白 + 截断；中间换行保留（便签按行写、按行显示）。 */
export function normalizePlanContent(raw: string): string {
  return raw.replace(/\s+$/, "").slice(0, PLAN_CONTENT_MAX);
}

/** 分类名：去首尾空白 + 截断 + 全角空格兼容。 */
export function normalizePlanCategoryName(raw: string): string {
  return raw.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "").slice(0, PLAN_CATEGORY_NAME_MAX);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value));
}

/** 单条：字段缺失 / 类型不符即整条丢弃（不半读半写）。 */
function sanitizeNote(value: unknown): PlanNote | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id !== "" ? record.id : null;
  const title = typeof record.title === "string" ? normalizePlanTitle(record.title) : null;
  const content = typeof record.content === "string" ? normalizePlanContent(record.content) : null;
  const category = typeof record.category === "string" ? normalizePlanCategoryName(record.category) : null;
  const createdAt = isIsoTime(record.createdAt) ? record.createdAt : null;
  const updatedAt = isIsoTime(record.updatedAt) ? record.updatedAt : null;
  if (id === null || title === null || content === null || category === null || category === "" || createdAt === null || updatedAt === null) {
    return null;
  }
  if (title === "" && content === "") {
    return null;
  }
  const colorId = typeof record.colorId === "string" && isPlanColorId(record.colorId) ? record.colorId : "white";
  const fontId = typeof record.fontId === "string" && isPlanFontId(record.fontId) ? record.fontId : "sans";
  return { id, title, content, category, colorId, fontId, createdAt, updatedAt };
}

/** 分类表：去重、去空、去超长，最多 12 类；空表回落默认六类。 */
function sanitizeCategories(value: unknown): string[] {
  const result: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }
      const name = normalizePlanCategoryName(item);
      if (name !== "" && !result.includes(name)) {
        result.push(name);
      }
      if (result.length >= PLAN_CATEGORY_MAX) {
        break;
      }
    }
  }
  return result.length > 0 ? result : PLAN_DEFAULT_CATEGORIES.slice();
}

/** 首次打开预置的 6 条示例便签（对应参考页 minimemo3 的初始数据；可删）。 */
function seedNotes(now: Date): PlanNote[] {
  const at = (hoursAgo: number): string => new Date(now.getTime() - hoursAgo * 3600000).toISOString();
  return [
    { id: "pn-seed-1", title: "本周重点", content: "1: 跟进印度项目的任务排期\n2: 整理周五评审要用的材料\n3: 给新同事开通账号", category: "待办", colorId: "yellow", fontId: "sans", createdAt: at(6), updatedAt: at(1) },
    { id: "pn-seed-2", title: "想法速记", content: "把「我的计划」做成便签墙：颜色分类 + 搜索排序。\n先本机保存，重要内容自己留个底。", category: "想法", colorId: "blue", fontId: "sans", createdAt: at(26), updatedAt: at(3) },
    { id: "pn-seed-3", title: "会议要点", content: "周一例会：\n- 验收节点提前到月底\n- 甘特图按负责人筛选\n- 日报必填项已上线", category: "工作", colorId: "white", fontId: "sans", createdAt: at(50), updatedAt: at(22) },
    { id: "pn-seed-4", title: "采购清单", content: "- A4 打印纸\n- 标签机色带\n- 白板笔（黑 / 红）", category: "采购", colorId: "green", fontId: "mono", createdAt: at(74), updatedAt: at(30) },
    { id: "pn-seed-5", title: "读书清单", content: "《人月神话》\n《凤凰项目》\n《持续交付》", category: "个人", colorId: "pink", fontId: "serif", createdAt: at(98), updatedAt: at(50) },
    { id: "pn-seed-6", title: "随手记", content: "便签保存在这台设备的浏览器里：不跟账号走，清理浏览器数据前先自己留个底。", category: "其他", colorId: "purple", fontId: "sans", createdAt: at(122), updatedAt: at(74) },
  ];
}

/** 读取本机便签墙：无记录 = 预置示例并落盘；损坏 / 缺字段 = 逐条收敛（损坏不覆盖原始值）。 */
export function loadPlanBoard(): PlanBoard {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PLAN_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === null) {
    const board: PlanBoard = { notes: seedNotes(new Date()), categories: PLAN_DEFAULT_CATEGORIES.slice() };
    savePlanBoard(board);
    return board;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("bad shape");
    }
    const record = parsed as Record<string, unknown>;
    const notes: PlanNote[] = [];
    if (Array.isArray(record.notes)) {
      for (const item of record.notes) {
        const note = sanitizeNote(item);
        if (note !== null && !notes.some((existing) => existing.id === note.id)) {
          notes.push(note);
        }
        if (notes.length >= PLAN_NOTE_LIMIT) {
          break;
        }
      }
    }
    return { notes, categories: sanitizeCategories(record.categories) };
  } catch {
    return { notes: [], categories: PLAN_DEFAULT_CATEGORIES.slice() };
  }
}

/** 整体写回本机；返回 false = 存储不可用（隐私模式 / 配额），调用方据此出提示。 */
export function savePlanBoard(board: PlanBoard): boolean {
  try {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ v: 1, notes: board.notes, categories: board.categories }));
    return true;
  } catch {
    return false;
  }
}

/** 退出登录清除本机便签（与首页偏好同一条隔离口径：多人共用设备不把上一位的便签带给下一位）。 */
export function clearPlanBoard(): void {
  try {
    window.localStorage.removeItem(PLAN_STORAGE_KEY);
  } catch {
    // 与写入同一降级策略
  }
}

/** 排序（不改原数组）：最近更新 / 最新创建 / 最早创建 / 标题 A→Z（中文按拼音排）。 */
export function sortPlanNotes(notes: readonly PlanNote[], key: PlanSortKey): PlanNote[] {
  const result = notes.slice();
  if (key === "updated_desc") {
    result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return result;
  }
  if (key === "created_desc") {
    result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return result;
  }
  if (key === "created_asc") {
    result.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return result;
  }
  result.sort((left, right) => left.title.localeCompare(right.title, "zh-Hans-CN"));
  return result;
}

/** 关键字（标题 / 内容 / 分类，忽略大小写）+ 分类过滤。 */
export function filterPlanNotes(notes: readonly PlanNote[], keyword: string, category: string | null): PlanNote[] {
  const query = keyword.trim().toLowerCase();
  return notes.filter((note) => {
    if (category !== null && note.category !== category) {
      return false;
    }
    if (query === "") {
      return true;
    }
    return (note.title + "\n" + note.content + "\n" + note.category).toLowerCase().includes(query);
  });
}

/** ISO 时间 → 卡片角标相对文案（Push 266 照 MiniMemo 参考页）：刚刚 / N 分钟前 / N 小时前 / 昨天 / M月D日（跨年带年）；非法值原样透出。 */
export function formatPlanRelative(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const atMs = at.getTime();
  if (Number.isNaN(atMs)) {
    return iso;
  }
  const diff = now.getTime() - atMs;
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return String(Math.floor(diff / minute)) + " 分钟前";
  }
  if (diff < day) {
    return String(Math.floor(diff / hour)) + " 小时前";
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (atMs >= startOfToday - day && atMs < startOfToday) {
    return "昨天";
  }
  const month = String(at.getMonth() + 1);
  const dayText = String(at.getDate());
  if (at.getFullYear() === now.getFullYear()) {
    return month + "月" + dayText + "日";
  }
  return String(at.getFullYear()) + "年" + month + "月" + dayText + "日";
}

/** 编辑弹窗底栏「更新于」：2026年10月10日 18:20（与参考页 formatFull 同口径：年 / 月 / 日原样、时 / 分补零）。 */
export function formatPlanFull(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return iso;
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    String(at.getFullYear()) + "年" + String(at.getMonth() + 1) + "月" + String(at.getDate()) + "日 " +
    pad(at.getHours()) + ":" + pad(at.getMinutes())
  );
}

/** 时段问候（Push 266 照 MiniMemo 参考页）：夜深了 / 早上好 / 中午好 / 下午好 / 晚上好。 */
export function planGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) {
    return "夜深了";
  }
  if (hour < 12) {
    return "早上好";
  }
  if (hour < 14) {
    return "中午好";
  }
  if (hour < 18) {
    return "下午好";
  }
  return "晚上好";
}
