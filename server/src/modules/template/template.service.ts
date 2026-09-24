import { Injectable } from "@nestjs/common";
import { STAGE_NAMES } from "@libiaolink/contracts";
import type {
  TaskNode,
  TaskNodeCreateBody,
  TaskNodeDeleteResponse,
  TaskNodeListQuery,
  TaskNodeListResponse,
  TaskNodeUpdateBody,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { AuditService, diffRecords } from "../admin/index.js";
import { PermissionService } from "../permission/index.js";
import { TaskNodeRepository } from "./task-node.repository.js";
import type { TaskNodeRow, TaskNodeUpdatePatch } from "./task-node.repository.js";

/** 阶段 key → 展示名（与 project 模块 flow.service 同口径）。 */
const STAGE_NAME_BY_KEY = STAGE_NAMES as Record<string, string>;

/** 节点快照（审计字段级留痕口径）。 */
function nodeSnapshot(row: TaskNodeRow): Record<string, unknown> {
  return { stageKey: row.stageKey, seq: row.seq, title: row.title, titleEn: row.titleEn };
}

/**
 * 任务模板域用例（M3-05 余 · 第一段：任务节点库）。
 * - 读（GET /api/v1/task-nodes）：登录即可 —— 任务模板页左列与「项目总览 → 添加任务」卡片的节点来源；
 * - 写（POST / PATCH / DELETE）：`blueprint.manage`，与蓝图维护同口径（ADR-019 / ADR-020：仅系统管理员）；
 * - 留痕：新增 / 编辑 / 删除各写一条审计（对象类型 task_node；编辑写字段级 changes、删除为物理删行快照进 changes）；不写 outbox（与字典维护同口径）。
 * 模板（TaskTemplate）的读写随本域第二段落（契约已定，见 shared/src/modules/templates.ts）。
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly nodes: TaskNodeRepository,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  async listNodes(query: TaskNodeListQuery): Promise<TaskNodeListResponse> {
    const rows = await this.nodes.list(query.stage ?? null);
    return { items: rows.map(toContract), total: rows.length };
  }

  /** POST /api/v1/task-nodes：新增节点（同阶段同名 409 NODE_ALREADY_EXISTS）；缺省 seq = 该阶段末位 + 10。 */
  async createNode(body: TaskNodeCreateBody, actorId: string): Promise<TaskNode> {
    await this.assertAdmin(actorId, "新增任务节点");
    const title = body.title.trim();
    const titleEn = body.titleEn === undefined || body.titleEn === null || body.titleEn.trim() === "" ? null : body.titleEn.trim();
    const created = await this.database.db.transaction(async (tx) => {
      const duplicate = await this.nodes.findByTitle(body.stageKey, title, tx);
      if (duplicate !== null) {
        throw new AppError(
          "NODE_ALREADY_EXISTS",
          "该阶段已有同名节点：" + STAGE_NAME_BY_KEY[body.stageKey] + " · " + title,
        );
      }
      const seq = body.seq ?? (await this.nodes.maxSeq(body.stageKey, tx)) + 10;
      const row = await this.nodes.insert({ stageKey: body.stageKey, seq, title, titleEn }, tx);
      await this.audit.record(tx, {
        actorId,
        action: "create",
        objectType: "task_node",
        objectId: row.id,
        summary: "新增任务节点：" + STAGE_NAME_BY_KEY[body.stageKey] + " · " + row.title,
        changes: diffRecords({}, nodeSnapshot(row)),
        metadata: { stageKey: row.stageKey, seq: row.seq },
      });
      return row;
    });
    return toContract(created);
  }

  /**
   * PATCH /api/v1/task-nodes/{id}：改名 / 英文名（乐观锁 version 必传）。
   * 不存在 404 NOT_FOUND；版本过期 409 VERSION_CONFLICT；改成同阶段已有名字 409 NODE_ALREADY_EXISTS（排除自身）。
   */
  async updateNode(id: string, body: TaskNodeUpdateBody, actorId: string): Promise<TaskNode> {
    await this.assertAdmin(actorId, "编辑任务节点");
    const at = new Date();
    const updated = await this.database.db.transaction(async (tx) => {
      const before = await this.nodes.findById(id, tx);
      if (before === null) {
        throw new AppError("NOT_FOUND", "任务节点不存在：" + id);
      }
      const patch: TaskNodeUpdatePatch = {};
      if (body.title !== undefined) {
        const title = body.title.trim();
        const duplicate = await this.nodes.findByTitle(before.stageKey, title, tx);
        if (duplicate !== null && duplicate.id !== id) {
          throw new AppError(
            "NODE_ALREADY_EXISTS",
            "该阶段已有同名节点：" + STAGE_NAME_BY_KEY[before.stageKey] + " · " + title,
          );
        }
        patch.title = title;
      }
      if (body.titleEn !== undefined) {
        patch.titleEn = body.titleEn === null || body.titleEn.trim() === "" ? null : body.titleEn.trim();
      }
      const row = await this.nodes.updateWithVersion(id, body.version, patch, at, tx);
      if (row === null) {
        throw new AppError("VERSION_CONFLICT", "任务节点已被他人更新，请刷新后重试");
      }
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "task_node",
        objectId: id,
        summary: "编辑任务节点：" + STAGE_NAME_BY_KEY[before.stageKey] + " · " + row.title,
        changes: diffRecords(nodeSnapshot(before), nodeSnapshot(row)),
        metadata: { stageKey: row.stageKey, seq: row.seq },
      });
      return row;
    });
    return toContract(updated);
  }

  /** DELETE /api/v1/task-nodes/{id}：物理删行（删除前快照写审计）；不存在 / 非 UUID 404。已生成的项目任务不变。 */
  async deleteNode(id: string, actorId: string): Promise<TaskNodeDeleteResponse> {
    await this.assertAdmin(actorId, "删除任务节点");
    await this.database.db.transaction(async (tx) => {
      const before = await this.nodes.findById(id, tx);
      if (before === null) {
        throw new AppError("NOT_FOUND", "任务节点不存在：" + id);
      }
      await this.nodes.deleteById(id, tx);
      await this.audit.record(tx, {
        actorId,
        action: "delete",
        objectType: "task_node",
        objectId: id,
        summary: "删除任务节点：" + STAGE_NAME_BY_KEY[before.stageKey] + " · " + before.title,
        changes: diffRecords(nodeSnapshot(before), {}),
        metadata: { stageKey: before.stageKey, seq: before.seq },
      });
    });
    return { id, deleted: true };
  }

  /** 节点库维护权限：矩阵键 blueprint.manage（种子 #6b 仅授系统管理员 · ADR-019 / ADR-020）。 */
  private async assertAdmin(actorId: string, action: string): Promise<void> {
    await this.permission.assertCan(actorId, "blueprint.manage", undefined, action + "仅限管理员（ADR-019 / ADR-020）");
  }
}

/** 行 → 契约 TaskNode（version = 编辑用的乐观锁，PATCH 时必传）。 */
function toContract(row: TaskNodeRow): TaskNode {
  return {
    id: row.id,
    stageKey: row.stageKey as TaskNode["stageKey"],
    seq: row.seq,
    title: row.title,
    titleEn: row.titleEn,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
