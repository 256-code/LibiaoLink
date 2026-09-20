import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { departments } from "../../db/schema/identity.js";

export type DepartmentRow = typeof departments.$inferSelect;

export interface DepartmentUpsertInput {
  sourceId: string;
  name: string;
  parentId: string | null;
  status: "active" | "disabled";
}

/**
 * departments 数据访问（0007）：组织同步按 source_id upsert；缺失部门置 disabled（不物理删除）。
 * 人员 ↔ 部门映射（多部门 / 兼职）随 D1-06 另起迁移，本 repository 暂不承载。
 */
@Injectable()
export class DepartmentRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(options: { includeDisabled?: boolean } = {}): Promise<DepartmentRow[]> {
    return this.database.db
      .select()
      .from(departments)
      .where(options.includeDisabled === true ? undefined : eq(departments.status, "active"))
      .orderBy(asc(departments.name), asc(departments.id));
  }

  /** 同步来源的部门行（source_id 非空）：组织同步计算缺失 / 差异用。 */
  async listSynced(): Promise<DepartmentRow[]> {
    return this.database.db
      .select()
      .from(departments)
      .where(isNotNull(departments.sourceId))
      .orderBy(asc(departments.id));
  }

  async findBySourceId(sourceId: string): Promise<DepartmentRow | null> {
    const rows = await this.database.db
      .select()
      .from(departments)
      .where(eq(departments.sourceId, sourceId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertBySourceId(input: DepartmentUpsertInput, at: Date): Promise<DepartmentRow> {
    const rows = await this.database.db
      .insert(departments)
      .values({
        sourceId: input.sourceId,
        name: input.name,
        parentId: input.parentId,
        status: input.status,
      })
      .onConflictDoUpdate({
        target: departments.sourceId,
        set: { name: input.name, parentId: input.parentId, status: input.status, updatedAt: at },
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("departments upsert 未返回记录");
    }
    return row;
  }

  /** 批量停用（仅命中 active 行）；返回实际变更行的 id。 */
  async disableByIds(ids: readonly string[], at: Date): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.database.db
      .update(departments)
      .set({ status: "disabled", updatedAt: at })
      .where(and(inArray(departments.id, [...ids]), eq(departments.status, "active")))
      .returning({ id: departments.id });
    return rows.map((row) => row.id);
  }
}
