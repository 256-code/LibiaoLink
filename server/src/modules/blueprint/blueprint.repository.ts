import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { blueprints, blueprintVersions } from "../../db/schema/blueprint.js";
import type { DbClient } from "../../db/db-client.js";
import type { Blueprint, BlueprintIssue } from "./blueprint.validation.js";

export type BlueprintRow = typeof blueprints.$inferSelect;
export type BlueprintVersionRow = typeof blueprintVersions.$inferSelect;

/** 蓝图数据访问（h3）：草稿落在 blueprints，发布版本行不可变（blueprint_versions）。 */
@Injectable()
export class BlueprintRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByProjectType(projectType: string, client: DbClient = this.database.db): Promise<BlueprintRow | null> {
    const rows = await client.select().from(blueprints).where(eq(blueprints.projectType, projectType)).limit(1);
    return rows[0] ?? null;
  }

  async insertDraft(
    projectType: string,
    name: string,
    payload: Blueprint,
    actorId: string | null,
    at: Date,
  ): Promise<BlueprintRow> {
    const rows = await this.database.db
      .insert(blueprints)
      .values({
        projectType,
        name,
        draftPayload: payload,
        draftUpdatedAt: at,
        draftUpdatedBy: actorId,
        publishedVersion: 0,
        version: 0,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("blueprints insert 未返回记录");
    return row;
  }

  /** 保存草稿（last-write-wins：契约 BlueprintSaveBody 未带 version；version 仅作内部递增）。 */
  async updateDraft(id: string, payload: Blueprint, actorId: string | null, at: Date): Promise<BlueprintRow | null> {
    const rows = await this.database.db
      .update(blueprints)
      .set({
        name: payload.name,
        draftPayload: payload,
        draftUpdatedAt: at,
        draftUpdatedBy: actorId,
        version: sql`${blueprints.version} + 1`,
        updatedAt: at,
      })
      .where(eq(blueprints.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async findVersion(blueprintId: string, version: number, client: DbClient = this.database.db): Promise<BlueprintVersionRow | null> {
    const rows = await client
      .select()
      .from(blueprintVersions)
      .where(and(eq(blueprintVersions.blueprintId, blueprintId), eq(blueprintVersions.blueprintVersion, version)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 按项目类型 + 版本取已发布 payload（建项目导入 / 模板节点池解析用）。 */
  async findVersionByProjectType(projectType: string, version: number): Promise<BlueprintVersionRow | null> {
    const rows = await this.database.db
      .select({ version: blueprintVersions })
      .from(blueprintVersions)
      .innerJoin(blueprints, eq(blueprints.id, blueprintVersions.blueprintId))
      .where(and(eq(blueprints.projectType, projectType), eq(blueprintVersions.blueprintVersion, version)))
      .limit(1);
    return rows[0]?.version ?? null;
  }

  /** 最新已发布版本行（导出的正本；无发布时返回 null）。 */
  async findLatestVersion(blueprintId: string): Promise<BlueprintVersionRow | null> {
    const rows = await this.database.db
      .select()
      .from(blueprintVersions)
      .where(eq(blueprintVersions.blueprintId, blueprintId))
      .orderBy(desc(blueprintVersions.blueprintVersion))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 发布：写不可变版本行 + 递增 published_version（同一事务内原子完成）。 */
  async publishVersion(
    blueprintId: string,
    blueprintVersion: number,
    payload: Blueprint,
    issues: BlueprintIssue[],
    actorId: string | null,
    at: Date,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx.insert(blueprintVersions).values({
        blueprintId,
        blueprintVersion,
        payload,
        issues,
        publishedBy: actorId,
        publishedAt: at,
      });
      await tx
        .update(blueprints)
        .set({
          draftPayload: payload,
          draftUpdatedAt: at,
          draftUpdatedBy: actorId,
          publishedVersion: blueprintVersion,
          version: sql`${blueprints.version} + 1`,
          updatedAt: at,
        })
        .where(eq(blueprints.id, blueprintId));
    });
  }
}
