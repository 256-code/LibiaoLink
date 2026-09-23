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

/**
 * 用户级 UI 偏好（A4）：独立于项目视图 project_views（M2-06 的 filters / columns / sort / group）。
 * 存储为 user_preferences（user_id 主键 + prefs jsonb + updated_at），单用户单写者，不需要 version。
 * 声明键：taskTableHiddenColumns（A4 列显隐）/ homeSavedFilters（A24 常用筛选）/ focusMode（A4 醒目模式 · Push 171）；
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
    updatedAt: DateTimeSchema.nullable().openapi({ description: "偏好最后更新时间（尚未保存过 = null）" }),
  })
  .openapi("UserPreferences", { description: "用户偏好（全量；GET 返回当前值）" });

/** PATCH 合并语义：只传变更键，未传键保持原值（数组键为整体替换）；未声明键原样保存（新增偏好键不必改契约即可前向兼容）。 */
export const UserPreferencesUpdateBodySchema = z
  .object({
    taskTableHiddenColumns: z.array(TaskTableColumnKeySchema).max(30).optional(),
    homeSavedFilters: z.array(SavedHomeFilterSchema).max(SAVED_HOME_FILTER_LIMIT).optional(),
    focusMode: z.boolean().optional(),
  })
  .catchall(z.unknown())
  .openapi("UserPreferencesUpdateBody", {
    description:
      "PATCH 合并语义：只传变更键（数组键整体替换）；未声明键原样保存；taskTableHiddenColumns 的 key 需在白名单（TaskTableColumnKey）内、focusMode 需为布尔，否则 400 VALIDATION_FAILED"
  });

/** 契约类型出口（与 dicts.ts 同口径：schema 的 infer 类型一并导出）。 */
export type TaskTableColumnKey = z.infer<typeof TaskTableColumnKeySchema>;
export type SavedHomeFilter = z.infer<typeof SavedHomeFilterSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UserPreferencesUpdateBody = z.infer<typeof UserPreferencesUpdateBodySchema>;
