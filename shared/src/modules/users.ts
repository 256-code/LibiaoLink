import { z } from "../zod.ts";
import { DateOnlySchema, DateTimeSchema, PageQuerySchema, UuidSchema, paginated } from "../common/conventions.ts";

/** 用户状态（users.status）：离职 / 停用由组织同步维护；非 active 的登录会话立即失效（v0.3 §3.2）。 */
export const UserStatusSchema = z.enum(["active", "disabled"]).openapi("UserStatus", {
  description: "用户状态；非 active 时该用户全部会话被撤销",
});

/**
 * 用户目录项（A2）：只暴露选择器与姓名解析所需字段。
 * 刻意不含 casdoorId / owner / 部门 / 手机号 —— 一期用不到，少一个泄露面。
 */
export const UserSummarySchema = z
  .object({
    id: UuidSchema,
    username: z.string().openapi({ description: "工号（users.username，唯一）", example: "10086" }),
    displayName: z.string().openapi({ description: "姓名（users.display_name）" }),
    email: z.string().nullable(),
    status: UserStatusSchema,
  })
  .openapi("UserSummary", { description: "用户目录项（M1：项目经理下拉 / 任务负责人候选 / 姓名解析）" });

/** 用户目录查询：默认按 username 升序（工号稳定序，分页不跳行）；只返回 status=active。 */
export const UserListQuerySchema = z
  .object({
    q: z.string().optional().openapi({ description: "关键字（工号 / 姓名 / 邮箱）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
  })
  .openapi("UserListQuery", { description: "用户目录查询（已登录用户全员可读；不做数据范围裁剪）" });

export const UserListResponseSchema = paginated(UserSummarySchema).openapi("UserListResponse");

/** 常用筛选：最多保存的组合数（与前端 SAVED_FILTER_LIMIT 同源）。 */
export const SAVED_HOME_FILTER_LIMIT = 20;

/**
 * 常用筛选组合（首页分类筛选侧栏「常用筛选」· Push 138 前端落地 / Push 169 落库）：
 * 一组分类条件（地区 / 项目类型 / 项目经理 / 项目时间）存成可命名的组合，按账号随偏好同步（A24）。
 * 字段与前端 SavedFilter 同形（条件内联在组合上，不套一层 criteria）。
 */
export const SavedHomeFilterSchema = z
  .object({
    id: z.string().min(1).max(64).openapi({ description: "组合 id（前端生成 sf- 前缀；跨设备同步后保持不变）" }),
    name: z.string().min(1).max(20).openapi({ description: "组合名称（≤ 20 字）" }),
    regions: z.array(z.string()).openapi({ description: "地区字典码（多值任一命中）" }),
    projectTypes: z.array(z.string()).openapi({ description: "项目类型字典码（多值任一命中）" }),
    managerIds: z.array(z.string()).openapi({ description: "项目经理 id 列表（用户目录 id；多值任一命中）" }),
    timeFrom: DateOnlySchema.nullable().openapi({ description: "项目时间区间起（闭区间；与 timeTo 成对，单边不生效）" }),
    timeTo: DateOnlySchema.nullable().openapi({ description: "项目时间区间止（闭区间；与 timeFrom 成对，单边不生效）" }),
  })
  .openapi("SavedHomeFilter", { description: "常用筛选组合（首页侧栏；按账号存 user_preferences.prefs.homeSavedFilters）" });

/**
 * 任务表列 key 白名单（A4「列显隐」· Push 170）：与前端 `TaskBoard.tsx` 的 `TABLE_COLUMNS` **非锁定列**逐项同源
 * （顺序 = 表头顺序；「任务描述」常显、不可隐藏，故不在白名单内）。服务端按它校验 `taskTableHiddenColumns`：
 * 未知 key → 400 VALIDATION_FAILED（契约描述里承诺的白名单，随本片落地）。
 */
export const TASK_TABLE_COLUMN_KEYS = [
  "manager",
  "owner",
  "status",
  "priority",
  "onTime",
  "deliverable",
  "files",
  "note",
  "start",
  "days",
  "due",
  "headcount",
  "doneDate",
  "change",
] as const;

export const TaskTableColumnKeySchema = z
  .enum(TASK_TABLE_COLUMN_KEYS)
  .openapi("TaskTableColumnKey", { description: "任务表列 key（白名单；「任务描述」常显，不在其中）" });

/** 工作台折叠面板展开态上限（A31 · Push 233）：按标签各记 ≤ 200 个项目 id（现实项目数远小于此，留足余量）。 */
export const WORKSPACE_OPEN_PROJECTS_LIMIT = 200;

/**
 * 工作台折叠面板展开态（A31 · Push 233 · 业务口径「这个下拉要有记忆」）：两个标签（我的任务 / 我提出的问题）
 * 各记一组**已展开的项目 id**（整体替换语义，不按顺序消费）；默认两个空数组 = 全部收起。
 * 按账号存 user_preferences.prefs（与 taskTableHiddenColumns / focusMode 同一条偏好通道）——
 * 刷新 / 同账号换设备都保持展开记忆；读侧坏形状（非对象 / 数组里非字符串项）一律收敛为空数组，不抛错。
 */
export const WorkspaceOpenProjectsSchema = z
  .object({
    tasks: z
      .array(UuidSchema)
      .max(WORKSPACE_OPEN_PROJECTS_LIMIT)
      .openapi({ description: "「我的任务」标签已展开的项目 id 列表（整体替换语义）" }),
    raised: z
      .array(UuidSchema)
      .max(WORKSPACE_OPEN_PROJECTS_LIMIT)
      .openapi({ description: "「我提出的问题」标签已展开的项目 id 列表（整体替换语义）" }),
  })
  .openapi("WorkspaceOpenProjects", {
    description: "工作台折叠面板展开态（A31 · Push 233 · 业务口径「这个下拉要有记忆」）：按标签分记已展开的项目 id；默认两空数组 = 全部收起；读侧坏形状收敛为空数组（整体替换语义）",
  });

/**
 * 「我的计划」便签墙（Push 268 · 业务口径 2026-10-10「数据接入数据库」）：便签墙整体按账号存
 * `user_preferences.prefs.myPlanBoard`（与 workspaceOpenProjects 同一条偏好通道）—— 换设备可见。
 * PATCH 时客户端只传 { notes, categories }，updatedAt 由服务端盖章（同 prefs 行 updated_at 口径）；
 * 读侧坏形状逐条收敛（非法便签整条丢弃、分类表去空去重截断），与前端 `myPlan.ts` 同口径。
 */
export const PLAN_BOARD_NOTE_LIMIT = 300;
export const PLAN_BOARD_CATEGORY_LIMIT = 12;
export const PLAN_BOARD_TITLE_MAX = 40;
export const PLAN_BOARD_CONTENT_MAX = 2000;
export const PLAN_BOARD_CATEGORY_NAME_MAX = 10;

/** 便签颜色 id（7 色 hex 调色板；与前端 `myPlan.ts` 的 `PLAN_COLORS` 同源）。 */
export const PLAN_BOARD_COLOR_IDS = ["white", "yellow", "green", "blue", "purple", "pink", "orange"] as const;

export const PlanBoardColorSchema = z
  .enum(PLAN_BOARD_COLOR_IDS)
  .openapi("PlanBoardColor", { description: "便签颜色 id（7 色 hex 调色板，与前端 myPlan.ts 同源）" });

/** 便签字体 id（简约 / 优雅 / 等宽；与前端 `myPlan.ts` 的 `PLAN_FONTS` 同源）。 */
export const PLAN_BOARD_FONT_IDS = ["sans", "serif", "mono"] as const;

export const PlanBoardFontSchema = z
  .enum(PLAN_BOARD_FONT_IDS)
  .openapi("PlanBoardFont", { description: "便签字体 id（简约 / 优雅 / 等宽，与前端 myPlan.ts 同源）" });

export const MyPlanNoteSchema = z
  .object({
    id: z.string().min(1).max(64).openapi({ description: "便签 id（前端生成 pn- 前缀；跨设备同步后保持不变）" }),
    title: z.string().max(PLAN_BOARD_TITLE_MAX).openapi({ description: "标题（≤ 40 字；与内容可各自为空，但不同时为空）" }),
    content: z.string().max(PLAN_BOARD_CONTENT_MAX).openapi({ description: "内容（≤ 2000 字）" }),
    category: z.string().min(1).max(PLAN_BOARD_CATEGORY_NAME_MAX).openapi({ description: "分类名（≤ 10 字；引用 categories 表）" }),
    colorId: PlanBoardColorSchema,
    fontId: PlanBoardFontSchema,
    done: z.boolean().openapi({ description: "完成态（Push 268）：true = 收进「已完成」，便签墙（含分类视图）不再显示" }),
    createdAt: DateTimeSchema.openapi({ description: "创建时间（ISO 8601；跨设备同步后保持原值）" }),
    updatedAt: DateTimeSchema.openapi({ description: "最后更新时间（排序 / 卡片角标用）" }),
  })
  .openapi("MyPlanNote", { description: "「我的计划」单条便签（Push 268）" });

export const MyPlanBoardUpdateSchema = z
  .object({
    notes: z.array(MyPlanNoteSchema).max(PLAN_BOARD_NOTE_LIMIT).openapi({ description: "便签列表（整体替换语义；≤ 300 条）" }),
    categories: z
      .array(z.string().min(1).max(PLAN_BOARD_CATEGORY_NAME_MAX))
      .max(PLAN_BOARD_CATEGORY_LIMIT)
      .openapi({ description: "分类表（整体替换语义；≤ 12 类）" }),
  })
  .openapi("MyPlanBoardUpdate", { description: "「我的计划」便签墙 PATCH 体（客户端只传 notes / categories；updatedAt 由服务端盖章）" });

export const MyPlanBoardSchema = MyPlanBoardUpdateSchema
  .extend({
    updatedAt: DateTimeSchema.nullable().openapi({ description: "该键最后一次保存时间（服务端盖章）；从未保存 = null（前端据此判断首次进入 → 预置 6 条示例并上云）" }),
  })
  .openapi("MyPlanBoard", { description: "「我的计划」便签墙（Push 268）：按账号跨设备可见；读侧坏形状逐条收敛" });

/**
 * 用户级 UI 偏好（A4）：独立于项目视图 project_views（M2-06 的 filters / columns / sort / group）。
 * 存储为 user_preferences（user_id 主键 + prefs jsonb + updated_at），单用户单写者，不需要 version。
 * 声明键：taskTableHiddenColumns（A4 列显隐）/ homeSavedFilters（A24 常用筛选）/ focusMode（A4 醒目模式 · Push 171）/ workspaceOpenProjects（A31 工作台展开态 · Push 233）/ myPlanBoard（「我的计划」便签墙 · Push 268）；
 * 未声明键按 `.catchall` 原样保存（前向兼容），但不回读 —— 新增偏好键必须同时补这里与 service 的 toContract。
 */
export const UserPreferencesSchema = z
  .object({
    taskTableHiddenColumns: z
      .array(TaskTableColumnKeySchema)
      .max(30)
      .openapi({ description: "任务表隐藏列 key 列表（白名单 = TaskTableColumnKey，「任务描述」常显；未知 key 400 VALIDATION_FAILED；整体替换语义）" }),
    homeSavedFilters: z
      .array(SavedHomeFilterSchema)
      .max(SAVED_HOME_FILTER_LIMIT)
      .openapi({ description: "常用筛选组合（最多 20 组；整体替换语义）" }),
    focusMode: z
      .boolean()
      .openapi({
        description:
          "醒目模式（A4 · §6.13，Push 171）：true = 项目总览任务表每行铺该任务状态的底色；默认 false；读侧非布尔一律收敛为 false",
      }),
    workspaceOpenProjects: WorkspaceOpenProjectsSchema,
    myPlanBoard: MyPlanBoardSchema,
    updatedAt: DateTimeSchema.nullable().openapi({ description: "偏好最后更新时间（尚未保存过 = null）" }),
  })
  .openapi("UserPreferences", { description: "用户偏好（全量；GET 返回当前值）" });

/** PATCH 合并语义：只传变更键，未传键保持原值（数组键为整体替换）；未声明键原样保存（新增偏好键不必改契约即可前向兼容）。myPlanBoard 特殊：客户端只传 notes / categories，updatedAt 由服务端盖章。 */
export const UserPreferencesUpdateBodySchema = z
  .object({
    taskTableHiddenColumns: z.array(TaskTableColumnKeySchema).max(30).optional(),
    homeSavedFilters: z.array(SavedHomeFilterSchema).max(SAVED_HOME_FILTER_LIMIT).optional(),
    focusMode: z.boolean().optional(),
    workspaceOpenProjects: WorkspaceOpenProjectsSchema.optional(),
    myPlanBoard: MyPlanBoardUpdateSchema.optional(),
  })
  .catchall(z.unknown())
  .openapi("UserPreferencesUpdateBody", {
    description:
      "PATCH 合并语义：只传变更键（数组键整体替换）；未声明键原样保存；taskTableHiddenColumns 的 key 需在白名单（TaskTableColumnKey）内、focusMode 需为布尔，否则 400 VALIDATION_FAILED"
  });

/** 契约类型出口（与 dicts.ts 同口径：schema 的 infer 类型一并导出）。 */
export type TaskTableColumnKey = z.infer<typeof TaskTableColumnKeySchema>;
export type SavedHomeFilter = z.infer<typeof SavedHomeFilterSchema>;
export type WorkspaceOpenProjects = z.infer<typeof WorkspaceOpenProjectsSchema>;
export type MyPlanNote = z.infer<typeof MyPlanNoteSchema>;
export type MyPlanBoard = z.infer<typeof MyPlanBoardSchema>;
export type MyPlanBoardUpdate = z.infer<typeof MyPlanBoardUpdateSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UserPreferencesUpdateBody = z.infer<typeof UserPreferencesUpdateBodySchema>;
