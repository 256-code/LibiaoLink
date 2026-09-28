import { Injectable } from "@nestjs/common";
import {
  type FollowBatchBody,
  type FollowBatchFailure,
  type FollowBatchResponse,
  type FollowCreateBody,
  type FollowCreateResponse,
  type FollowDeleteResponse,
  type FollowItem,
  type FollowListQuery,
  type FollowListResponse,
  type FollowObjectType,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { PermissionService } from "../permission/index.js";
import { FollowRepository, type FollowListRow, type FollowTarget } from "./follow.repository.js";

/**
 * 关注用例（M2-06 首刀 · A1-15）：关注项目 / 任务；关注关系单独存储、不作为任务字段。
 * 口径：
 *   - 关注目标必须可见且未删除；归档项目不可新关注（404，ADR-027 冻结语义的项目侧延伸）；重复关注幂等（created=false）。
 *   - 取关按关系键删除，不校验目标是否存在 / 可见（目标被硬删后仍可清理自己的关注行）；未关注 = 404（批量 = unchanged）。
 *   - 批量：单事务逐条独立，失败只记不做（failures 内联，整体 200）。
 *   - 通知接线（状态变更 / 延期 / 变更生效）随消息通道 M5（lan 线）；关注动态流（A6-08）随工作台二刀 —— 本刀只做关系读写。
 */
@Injectable()
export class FollowService {
  constructor(
    private readonly follows: FollowRepository,
    private readonly permission: PermissionService,
    private readonly database: DatabaseService,
  ) {}

  /** GET /api/v1/follows：我的关注清单（目标不可见 / 已删的行不返回）。 */
  async list(actorId: string, query: FollowListQuery): Promise<FollowListResponse> {
    const rows = await this.follows.list(actorId, {
      objectType: query.objectType ?? null,
      objectId: query.objectId ?? null,
      projectId: query.projectId ?? null,
    });
    const scope = await this.permission.projectScope(actorId);
    const visible = scope.kind === "all" ? rows : rows.filter((row) => scope.ids.includes(row.projectId));
    return { items: visible.map((row) => toItem(row)) };
  }

  /** POST /api/v1/follows：关注（幂等；created=false = 已关注）。 */
  async create(actorId: string, body: FollowCreateBody, at: Date = new Date()): Promise<FollowCreateResponse> {
    const target = await this.resolveFollowable(actorId, body.objectType, body.objectId);
    return this.database.db.transaction(async (tx) => {
      const inserted = await this.follows.insertIfAbsent(actorId, body.objectType, body.objectId, at, tx);
      if (inserted !== null) {
        return { item: toItem({ ...inserted, ...target }), created: true };
      }
      const existing = await this.follows.find(actorId, body.objectType, body.objectId, tx);
      if (existing !== null) {
        return { item: toItem({ ...existing, ...target }), created: false };
      }
      const retried = await this.follows.insert(actorId, body.objectType, body.objectId, at, tx);
      return { item: toItem({ ...retried, ...target }), created: true };
    });
  }

  /** DELETE /api/v1/follows/{objectType}/{objectId}：取关（未关注 = 404）。 */
  async remove(actorId: string, objectType: FollowObjectType, objectId: string): Promise<FollowDeleteResponse> {
    const removed = await this.follows.deleteByKey(actorId, objectType, objectId);
    if (removed === 0) {
      throw new AppError("NOT_FOUND", "未关注该对象：" + objectType + " / " + objectId);
    }
    return { objectType, objectId, removed: true };
  }

  /** POST /api/v1/follows/batch：批量关注 / 取关（单事务逐条独立）。 */
  async batch(actorId: string, body: FollowBatchBody, at: Date = new Date()): Promise<FollowBatchResponse> {
    return this.database.db.transaction(async (tx) => {
      const result: FollowBatchResponse = { followed: 0, unfollowed: 0, unchanged: 0, failures: [] };
      for (const [index, item] of body.items.entries()) {
        if (!item.follow) {
          const removed = await this.follows.deleteByKey(actorId, item.objectType, item.objectId, tx);
          if (removed > 0) result.unfollowed += 1;
          else result.unchanged += 1;
          continue;
        }
        const target = await this.follows.resolveTarget(item.objectType, item.objectId, tx);
        if (target === null) {
          result.failures.push(failure(index, item.objectType, item.objectId, "目标不存在或已删除"));
          continue;
        }
        if (target.archived) {
          result.failures.push(failure(index, item.objectType, item.objectId, "归档项目不可新关注（ADR-027 冻结）"));
          continue;
        }
        const access = await this.permission.resolveProjectAccess(actorId, target.projectId);
        if (access === null) {
          result.failures.push(failure(index, item.objectType, item.objectId, "目标不存在或不可见"));
          continue;
        }
        const inserted = await this.follows.insertIfAbsent(actorId, item.objectType, item.objectId, at, tx);
        if (inserted === null) result.unchanged += 1;
        else result.followed += 1;
      }
      return result;
    });
  }

  /** 目标解析 + 可见性：不存在 / 已删 / 不可见 / 归档项目一律 not_found（404，防 IDOR + ADR-027）。 */
  private async resolveFollowable(actorId: string, objectType: FollowObjectType, objectId: string): Promise<FollowTarget> {
    const target = await this.follows.resolveTarget(objectType, objectId);
    if (target === null) {
      throw new AppError("NOT_FOUND", "关注目标不存在或已删除：" + objectType + " / " + objectId);
    }
    if (target.archived) {
      throw new AppError("NOT_FOUND", "归档项目不可新关注（ADR-027 冻结）：" + objectId);
    }
    const access = await this.permission.resolveProjectAccess(actorId, target.projectId);
    if (access === null) {
      throw new AppError("NOT_FOUND", "关注目标不存在或不可见：" + objectType + " / " + objectId);
    }
    return target;
  }
}

/** 失败明细（批量；仅关注动作产生，code 恒为 not_found）。 */
function failure(index: number, objectType: FollowObjectType, objectId: string, message: string): FollowBatchFailure {
  return { index, objectType, objectId, code: "not_found", message };
}

/** 行 → 契约视图（随行名称由 join / 目标解析给出）。 */
function toItem(row: FollowListRow | (FollowTarget & { objectType: string; objectId: string; createdAt: Date })): FollowItem {
  return {
    objectType: row.objectType as FollowObjectType,
    objectId: row.objectId,
    projectId: row.projectId,
    projectCode: row.projectCode,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}
