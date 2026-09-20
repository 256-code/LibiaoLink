import { z } from "../zod.ts";
import { DateTimeSchema, PageQuerySchema, UuidSchema, paginated } from "../common/conventions.ts";

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

/**
 * 用户级 UI 偏好（A4）：独立于项目视图 project_views（M2-06 的 filters / columns / sort / group）。
 * 存储为 user_preferences（user_id 主键 + jsonb + updated_at），单用户单写者，不需要 version。
 */
export const UserPreferencesSchema = z
  .object({
    taskTableHiddenColumns: z
      .array(z.string())
      .openapi({ description: "任务表隐藏列 key 列表；key 白名单与前端任务表列一致，未知 key 返回 400 VALIDATION_FAILED" }),
    updatedAt: DateTimeSchema.openapi({ description: "偏好最后更新时间（前端乐观更新用）" }),
  })
  .openapi("UserPreferences", { description: "用户偏好（全量；GET 返回当前值）" });

/** PATCH 合并语义：只传变更键，未传键保持原值；未声明键原样保存（新增偏好键不必改契约即可前向兼容）。 */
export const UserPreferencesUpdateBodySchema = z
  .object({
    taskTableHiddenColumns: z.array(z.string()).optional(),
  })
  .catchall(z.unknown())
  .openapi("UserPreferencesUpdateBody", {
    description: "PATCH 合并语义：只传变更键；未声明键原样保存；taskTableHiddenColumns 的 key 需在白名单内（未知 key 400）",
  });
