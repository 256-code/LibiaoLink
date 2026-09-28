/**
 * project_views 数据访问（0037 · M2-06 首刀 · A1-03）：视图 = 仅保存配置（筛选 / 列 / 排序 / 分组），不复制数据。
 * 读面：个人视图仅 owner 可见、公共视图全员可见；写面（改 / 删）的归属判定在服务层。
 * 默认视图每人至多一条（部分唯一索引 uq_project_views_owner_default）—— 置位时同事务 clearOtherDefaults。
 * ownerName 随行 join users（公共视图列表展示创建者）。
 */
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import { projectViews } from "../../db/schema/views.js";

/** 视图行（含创建者姓名；契约转换在服务层做）。 */
export interface ProjectViewRow {
  id: string;
  ownerId: string;
  ownerName: string;
  scope: string;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
  sort: { key: string; order: "asc" | "desc" } | null;
  grouping: { key: string } | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 新建视图的落库输入（服务层已做名称收敛）。 */
export interface ProjectViewInsert {
  ownerId: string;
  scope: string;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
  sort: { key: string; order: "asc" | "desc" } | null;
  grouping: { key: string } | null;
  isDefault: boolean;
}

/** 局部更新补丁（只包含传入的键）。 */
export interface ProjectViewPatch {
  scope?: string;
  name?: string;
  filters?: Record<string, unknown>;
  columns?: string[];
  sort?: { key: string; order: "asc" | "desc" } | null;
  grouping?: { key: string } | null;
  isDefault?: boolean;
}

/** 读面列（含 ownerName）：写路径读回也走它，保证契约形状单点。 */
const VIEW_SELECT = {
  id: projectViews.id,
  ownerId: projectViews.ownerId,
  ownerName: users.displayName,
  scope: projectViews.scope,
  name: projectViews.name,
  filters: projectViews.filters,
  columns: projectViews.columns,
  sort: projectViews.sort,
  grouping: projectViews.grouping,
  isDefault: projectViews.isDefault,
  createdAt: projectViews.createdAt,
  updatedAt: projectViews.updatedAt,
} as const;

/** 读面原始行（ownerName 可为 null：users 软删 / 级联场景的防御，正常恒有值）。 */
type ProjectViewJoinedRow = Omit<ProjectViewRow, "ownerName"> & { ownerName: string | null };

/** 行映射：ownerName 兜底空串。 */
function toRow(row: ProjectViewJoinedRow): ProjectViewRow {
  return { ...row, ownerName: row.ownerName ?? "" };
}

@Injectable()
export class ProjectViewRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 可见清单：scope=null → 我的个人视图 + 全部公共视图；排序 = 个人在前 → updated_at 降序 → id 升序。 */
  async listVisible(actorId: string, scope: string | null, tx?: DbClient): Promise<ProjectViewRow[]> {
    const db = tx ?? this.database.db;
    const personal = and(eq(projectViews.ownerId, actorId), eq(projectViews.scope, "personal"));
    const where =
      scope === "personal"
        ? personal
        : scope === "public"
          ? eq(projectViews.scope, "public")
          : or(personal, eq(projectViews.scope, "public"));
    const rows = await db
      .select(VIEW_SELECT)
      .from(projectViews)
      .leftJoin(users, eq(users.id, projectViews.ownerId))
      .where(where)
      .orderBy(
        sql`case when ${projectViews.scope} = 'personal' then 0 else 1 end`,
        desc(projectViews.updatedAt),
        asc(projectViews.id),
      );
    return rows.map(toRow);
  }

  /** 详情 / 写前读（join ownerName）。 */
  async findById(id: string, tx?: DbClient): Promise<ProjectViewRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select(VIEW_SELECT)
      .from(projectViews)
      .leftJoin(users, eq(users.id, projectViews.ownerId))
      .where(eq(projectViews.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  async insert(input: ProjectViewInsert, at: Date, tx?: DbClient): Promise<ProjectViewRow> {
    const db = tx ?? this.database.db;
    const rows = await db
      .insert(projectViews)
      .values({ ...input, createdAt: at, updatedAt: at })
      .returning({ id: projectViews.id });
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error("project_views insert 未返回 id");
    }
    const row = await this.findById(id, db);
    if (row === null) {
      throw new Error("project_views insert 后读回失败：" + id);
    }
    return row;
  }

  async update(id: string, patch: ProjectViewPatch, at: Date, tx?: DbClient): Promise<ProjectViewRow> {
    const db = tx ?? this.database.db;
    const rows = await db.update(projectViews).set({ ...patch, updatedAt: at }).where(eq(projectViews.id, id)).returning({ id: projectViews.id });
    if (rows[0] === undefined) {
      throw new Error("project_views update 未返回记录：" + id);
    }
    const row = await this.findById(id, db);
    if (row === null) {
      throw new Error("project_views update 后读回失败：" + id);
    }
    return row;
  }

  /** 物理删（视图是配置文件、不留痕）：返回被删行 id；不存在 = null。 */
  async delete(id: string, tx?: DbClient): Promise<string | null> {
    const db = tx ?? this.database.db;
    const rows = await db.delete(projectViews).where(eq(projectViews.id, id)).returning({ id: projectViews.id });
    return rows[0]?.id ?? null;
  }

  /**
   * 清掉同一人的默认（不动 updated_at：系统侧标志位，避免清单排序被静默顶位）。
   * keepId = null 表示清空该人全部默认 —— 建新默认前必须先清旧，再落新（部分唯一索引 uq_project_views_owner_default
   * 不允许两条默认并存，后清会在插入时先撞唯一键；单测替身库不校验索引，故口径以本注释与真机回放为准）。
   */
  async clearOtherDefaults(ownerId: string, keepId: string | null, tx?: DbClient): Promise<void> {
    const db = tx ?? this.database.db;
    const conditions = [eq(projectViews.ownerId, ownerId), eq(projectViews.isDefault, true)];
    if (keepId !== null) conditions.push(ne(projectViews.id, keepId));
    await db.update(projectViews).set({ isDefault: false }).where(and(...conditions));
  }
}
