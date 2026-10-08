import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { auditLogs, type AuditChangeEntry } from "../../db/schema/admin.js";
import { users } from "../../db/schema/identity.js";

/** 审计写入入参（actor / result / entry 由服务层补全；字段口径 = audit_logs 表）。 */
export interface AuditInsertInput {
  occurredAt: Date;
  actorId: string | null;
  actorName: string | null;
  action: string;
  objectType: string;
  objectId: string;
  projectId: string | null;
  result: string;
  entry: string;
  summary: string;
  changes: AuditChangeEntry[] | null;
  metadata: Record<string, unknown>;
}

/** 审计检索条件（h7 验收项②：按对象 / 操作人；其余为 C7-04 查询页预留）。 */
export interface AuditListFilter {
  objectType?: string;
  objectId?: string;
  actorId?: string;
  action?: string;
  result?: string;
  projectId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditRow {
  id: number;
  occurredAt: Date;
  actorId: string | null;
  actorName: string | null;
  action: string;
  objectType: string;
  objectId: string;
  projectId: string | null;
  result: string;
  entry: string;
  summary: string;
  changes: AuditChangeEntry[] | null;
  metadata: Record<string, unknown>;
}

/**
 * 审计数据访问（h7 · C7）：只 INSERT + SELECT —— UPDATE / DELETE 已在库级收回（0013 迁移 + 角色脚本，C7-05 防篡改）。
 * 写入以调用方事务为准（业务留痕与业务写入同事务）；越权留痕由 AuditService 走独立连接。
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 追加写（业务事务内调用）。 */
  async insert(client: DbClient, input: AuditInsertInput): Promise<void> {
    await client.insert(auditLogs).values({
      occurredAt: input.occurredAt,
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      projectId: input.projectId,
      result: input.result,
      entry: input.entry,
      summary: input.summary,
      changes: input.changes,
      metadata: input.metadata,
    });
  }

  /** 检索（occurredAt 降序 + id 降序：同毫秒写入也稳定）。 */
  async listPage(filter: AuditListFilter, limit: number, offset: number): Promise<{ items: AuditRow[]; total: number }> {
    const where = buildAuditWhere(filter);
    const items = await this.database.db
      .select({
        id: auditLogs.id,
        occurredAt: auditLogs.occurredAt,
        actorId: auditLogs.actorId,
        actorName: auditLogs.actorName,
        action: auditLogs.action,
        objectType: auditLogs.objectType,
        objectId: auditLogs.objectId,
        projectId: auditLogs.projectId,
        result: auditLogs.result,
        entry: auditLogs.entry,
        summary: auditLogs.summary,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(limit)
      .offset(offset);
    const totals = await this.database.db.select({ value: count() }).from(auditLogs).where(where);
    return { items, total: Number(totals[0]?.value ?? 0) };
  }

  /** 操作人姓名快照（只读 users 一列；避免平台模块依赖 identity 的业务出口 —— check:boundaries）。 */
  async findUserDisplayName(userId: string): Promise<string | null> {
    const rows = await this.database.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.displayName ?? null;
  }
}

/** 条件构造：等值 + 时间闭区间（索引 ix_audit_logs_object / ix_audit_logs_actor / ix_audit_logs_time 覆盖）。 */
function buildAuditWhere(filter: AuditListFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.objectType !== undefined) conditions.push(eq(auditLogs.objectType, filter.objectType));
  if (filter.objectId !== undefined) conditions.push(eq(auditLogs.objectId, filter.objectId));
  if (filter.actorId !== undefined) conditions.push(eq(auditLogs.actorId, filter.actorId));
  if (filter.action !== undefined) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.result !== undefined) conditions.push(eq(auditLogs.result, filter.result));
  if (filter.projectId !== undefined) conditions.push(eq(auditLogs.projectId, filter.projectId));
  if (filter.from !== undefined) conditions.push(gte(auditLogs.occurredAt, filter.from));
  if (filter.to !== undefined) conditions.push(lte(auditLogs.occurredAt, filter.to));
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}
