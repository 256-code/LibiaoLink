import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { taskNodes } from "../../db/schema/templates.js";

/** 节点库行（契约转换在服务层做）。 */
export interface TaskNodeRow {
  id: string;
  stageKey: string;
  seq: number;
  title: string;
  titleEn: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskNodeInsertInput {
  stageKey: string;
  seq: number;
  title: string;
  titleEn: string | null;
}

/** 编辑补丁（只改传入的字段；titleEn = null 显式清空）。 */
export interface TaskNodeUpdatePatch {
  title?: string;
  titleEn?: string | null;
}

/** 九阶段顺序（列表排序用）：与 shared/src/common/dicts.ts 的 STAGE_KEYS 同序；未知 key 排最后。 */
const STAGE_RANK = sql`coalesce(array_position(array['presale','design','purchase','assembly','install','deploy','trial','production','acceptance']::text[], ${taskNodes.stageKey}), 99)`;

/**
 * 任务节点库仓库（0032 · M3-05 余）：只读写 task_nodes。
 * 删除 = 物理删行（returning 回快照给服务层写审计），无软删标记 —— 与字典条目硬删同口径（Push 173）。
 */
@Injectable()
export class TaskNodeRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 按阶段过滤（null = 全部阶段）；排序 = 九阶段顺序 → seq → id（前端也按这个序渲染）。 */
  async list(stageKey: string | null, tx?: DbClient): Promise<TaskNodeRow[]> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select()
      .from(taskNodes)
      .where(stageKey === null ? undefined : eq(taskNodes.stageKey, stageKey))
      .orderBy(STAGE_RANK, asc(taskNodes.seq), asc(taskNodes.id));
    return rows.map(toRow);
  }

  async findById(id: string, tx?: DbClient): Promise<TaskNodeRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db.select().from(taskNodes).where(eq(taskNodes.id, id)).limit(1);
    return rows.length === 0 ? null : toRow(rows[0] as TaskNodeRow);
  }

  /** 一批节点（按 id，顺序不保证）：模板写入前校验「节点存在且与模板同阶段」（缺失 = 调用方判 400）。 */
  async listByIds(ids: string[], tx?: DbClient): Promise<TaskNodeRow[]> {
    if (ids.length === 0) {
      return [];
    }
    const db = tx ?? this.database.db;
    const rows = await db.select().from(taskNodes).where(inArray(taskNodes.id, ids));
    return rows.map(toRow);
  }

  /** 同阶段同名判重（唯一约束 uq_task_nodes_stage_title 的应用层前置 —— 撞库时仍由约束兜底）。 */
  async findByTitle(stageKey: string, title: string, tx?: DbClient): Promise<TaskNodeRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select()
      .from(taskNodes)
      .where(sql`${taskNodes.stageKey} = ${stageKey} and ${taskNodes.title} = ${title}`)
      .limit(1);
    return rows.length === 0 ? null : toRow(rows[0] as TaskNodeRow);
  }

  /** 该阶段当前最大 seq（空阶段 → 0）：「添加节点」缺省追加到末尾（末位 + 10）。 */
  async maxSeq(stageKey: string, tx?: DbClient): Promise<number> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select({ value: sql<number | null>`max(${taskNodes.seq})` })
      .from(taskNodes)
      .where(eq(taskNodes.stageKey, stageKey));
    const value = rows[0]?.value ?? null;
    return value === null ? 0 : Number(value);
  }

  async insert(input: TaskNodeInsertInput, tx?: DbClient): Promise<TaskNodeRow> {
    const db = tx ?? this.database.db;
    const rows = await db
      .insert(taskNodes)
      .values({ stageKey: input.stageKey, seq: input.seq, title: input.title, titleEn: input.titleEn })
      .returning();
    return toRow(rows[0] as TaskNodeRow);
  }

  /** 乐观锁更新：version 不匹配返回 null（由 service 转 409 VERSION_CONFLICT）；只改传入的字段。 */
  async updateWithVersion(
    id: string,
    expectedVersion: number,
    patch: TaskNodeUpdatePatch,
    at: Date,
    tx?: DbClient,
  ): Promise<TaskNodeRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .update(taskNodes)
      .set({ ...patch, version: sql`${taskNodes.version} + 1`, updatedAt: at })
      .where(and(eq(taskNodes.id, id), eq(taskNodes.version, expectedVersion)))
      .returning();
    return rows.length === 0 ? null : toRow(rows[0] as TaskNodeRow);
  }

  /** 物理删行；返回被删的行（不存在 = null）。 */
  async deleteById(id: string, tx?: DbClient): Promise<TaskNodeRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db.delete(taskNodes).where(eq(taskNodes.id, id)).returning();
    return rows.length === 0 ? null : toRow(rows[0] as TaskNodeRow);
  }
}

function toRow(row: typeof taskNodes.$inferSelect): TaskNodeRow {
  return {
    id: row.id,
    stageKey: row.stageKey,
    seq: row.seq,
    title: row.title,
    titleEn: row.titleEn,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
