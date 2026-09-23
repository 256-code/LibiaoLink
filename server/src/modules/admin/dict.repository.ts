import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { dictItems, dictTypes } from "../../db/schema/admin.js";

/** dict_types 行（字典类型注册表）。 */
export interface DictTypeRow {
  code: string;
  name: string;
  sort: number;
  enabled: boolean;
  updatedAt: Date;
}

/** dict_items 行（字典条目）。 */
export interface DictItemRow {
  id: string;
  typeCode: string;
  code: string;
  name: string;
  sort: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
  updatedAt: Date;
}

export interface DictItemInsertInput {
  typeCode: string;
  code: string;
  name: string;
  sort: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface DictItemUpdateInput {
  name?: string;
  sort?: number;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

const TYPE_COLUMNS = {
  code: dictTypes.code,
  name: dictTypes.name,
  sort: dictTypes.sort,
  enabled: dictTypes.enabled,
  updatedAt: dictTypes.updatedAt,
};

const ITEM_COLUMNS = {
  id: dictItems.id,
  typeCode: dictItems.typeCode,
  code: dictItems.code,
  name: dictItems.name,
  sort: dictItems.sort,
  enabled: dictItems.enabled,
  metadata: dictItems.metadata,
  updatedAt: dictItems.updatedAt,
};

/** 字典数据访问（h7 · C9）：类型注册表 + 条目；「删除」= 物理删行（DELETE /dicts/{type}/items/{code}，Push 173 起），enabled 仅作兼容字段。 */
@Injectable()
export class DictRepository {
  constructor(private readonly database: DatabaseService) {}

  async findType(type: string, client: DbClient = this.database.db): Promise<DictTypeRow | null> {
    const rows = await client.select(TYPE_COLUMNS).from(dictTypes).where(eq(dictTypes.code, type)).limit(1);
    return rows[0] ?? null;
  }

  /** 启用的字典类型（全量下发按注册表顺序）。 */
  async listTypes(client: DbClient = this.database.db): Promise<DictTypeRow[]> {
    return client
      .select(TYPE_COLUMNS)
      .from(dictTypes)
      .where(eq(dictTypes.enabled, true))
      .orderBy(asc(dictTypes.sort), asc(dictTypes.code));
  }

  async listItems(type: string, includeDisabled: boolean, client: DbClient = this.database.db): Promise<DictItemRow[]> {
    const where =
      includeDisabled === true
        ? eq(dictItems.typeCode, type)
        : and(eq(dictItems.typeCode, type), eq(dictItems.enabled, true));
    return client.select(ITEM_COLUMNS).from(dictItems).where(where).orderBy(asc(dictItems.sort), asc(dictItems.code));
  }

  async findItem(type: string, code: string, client: DbClient = this.database.db): Promise<DictItemRow | null> {
    const rows = await client
      .select(ITEM_COLUMNS)
      .from(dictItems)
      .where(and(eq(dictItems.typeCode, type), eq(dictItems.code, code)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertItem(input: DictItemInsertInput, actorId: string, at: Date, client: DbClient): Promise<DictItemRow> {
    const rows = await client
      .insert(dictItems)
      .values({
        typeCode: input.typeCode,
        code: input.code,
        name: input.name,
        sort: input.sort,
        enabled: input.enabled,
        metadata: input.metadata,
        createdAt: at,
        updatedAt: at,
        updatedBy: actorId,
      })
      .returning(ITEM_COLUMNS);
    const row = rows[0];
    if (row === undefined) throw new Error("dict_items insert 未返回行");
    return row;
  }

  /** 更新条目（部分更新）：返回 null = 条目不存在（服务层转 404）。 */
  async updateItem(
    type: string,
    code: string,
    patch: DictItemUpdateInput,
    actorId: string,
    at: Date,
    client: DbClient,
  ): Promise<DictItemRow | null> {
    const set: Record<string, unknown> = { updatedAt: at, updatedBy: actorId };
    if (patch.name !== undefined) set["name"] = patch.name;
    if (patch.sort !== undefined) set["sort"] = patch.sort;
    if (patch.enabled !== undefined) set["enabled"] = patch.enabled;
    if (patch.metadata !== undefined) set["metadata"] = patch.metadata;
    const rows = await client
      .update(dictItems)
      .set(set)
      .where(and(eq(dictItems.typeCode, type), eq(dictItems.code, code)))
      .returning(ITEM_COLUMNS);
    return rows[0] ?? null;
  }

  /** 物理删除条目：返回 null = 条目不存在（服务层转 404）；调用方负责 touchType 与审计留痕。 */
  async deleteItem(type: string, code: string, client: DbClient): Promise<DictItemRow | null> {
    const rows = await client
      .delete(dictItems)
      .where(and(eq(dictItems.typeCode, type), eq(dictItems.code, code)))
      .returning(ITEM_COLUMNS);
    return rows[0] ?? null;
  }

  /** 字典版本触点：条目变更刷新 dict_types.updated_at（响应 updatedAt / ETag 的基准）。 */
  async touchType(type: string, at: Date, client: DbClient): Promise<void> {
    await client.update(dictTypes).set({ updatedAt: at }).where(eq(dictTypes.code, type));
  }
}
