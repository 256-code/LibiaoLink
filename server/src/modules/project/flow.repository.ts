import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { nodeRequirements, projectNodes } from "../../db/schema/flow.js";
import { projectStages } from "../../db/schema/projects.js";
import type { Blueprint } from "../blueprint/index.js";

export type ProjectStageRow = typeof projectStages.$inferSelect;
export type ProjectNodeRow = typeof projectNodes.$inferSelect;
export type NodeRequirementRow = typeof nodeRequirements.$inferSelect;

export interface ImportSnapshotStage {
  key: string;
  name: string;
  seq: number;
  nodes: { key: string; name: string; seq: number; constraints: Blueprint["stages"][number]["nodes"][number]["constraints"] }[];
}

export interface ImportSnapshotInput {
  projectId: string;
  blueprintVersion: number;
  activeStageKey: string;
  stages: readonly ImportSnapshotStage[];
  at: Date;
}

export interface NodeWithRequirements {
  node: ProjectNodeRow;
  requirements: NodeRequirementRow[];
}

/** 流程实例数据访问（h3）：project_stages / project_nodes / node_requirements 读写收敛在本层。 */
@Injectable()
export class FlowRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * 导入快照（建项目事务内调用）：生成 project_stages + project_nodes + node_requirements。
   * 幂等：project_nodes (project_id, node_key) 唯一，重复 node_key 跳过（v0.2 §3.5）。
   */
  async importSnapshot(tx: DbClient, input: ImportSnapshotInput): Promise<{ stages: number; nodes: number; requirements: number }> {
    let nodeCount = 0;
    let requirementCount = 0;
    for (const stage of input.stages) {
      const stageRows = await tx
        .insert(projectStages)
        .values({
          projectId: input.projectId,
          stageKey: stage.key,
          seq: stage.seq,
          status: stage.key === input.activeStageKey ? "active" : "pending",
          version: 0,
        })
        .onConflictDoNothing({ target: [projectStages.projectId, projectStages.stageKey] })
        .returning({ id: projectStages.id });
      const stageId = stageRows[0]?.id ?? (await this.findStageId(tx, input.projectId, stage.key));
      if (stageId === null) throw new Error("导入阶段行失败：" + stage.key);
      for (const node of stage.nodes) {
        const nodeRows = await tx
          .insert(projectNodes)
          .values({
            projectId: input.projectId,
            stageId,
            nodeKey: node.key,
            name: node.name,
            seq: String(node.seq),
            status: stage.key === input.activeStageKey ? "active" : "pending",
            origin: "blueprint",
            sourceBlueprintVersion: input.blueprintVersion,
            version: 0,
            createdAt: input.at,
          })
          .onConflictDoNothing({ target: [projectNodes.projectId, projectNodes.nodeKey] })
          .returning({ id: projectNodes.id });
        const nodeId = nodeRows[0]?.id;
        if (nodeId === undefined) continue;
        nodeCount += 1;
        for (const constraint of node.constraints) {
          await tx.insert(nodeRequirements).values({
            nodeId,
            requirementType: constraint.type,
            docType: constraint.type === "required_doc" ? constraint.docType : null,
            minCount: constraint.type === "required_doc" ? constraint.minCount : 1,
            config: constraint.type === "required_doc" ? null : constraint.config,
            createdAt: input.at,
          });
          requirementCount += 1;
        }
      }
    }
    return { stages: input.stages.length, nodes: nodeCount, requirements: requirementCount };
  }

  async findStageId(client: DbClient, projectId: string, stageKey: string): Promise<string | null> {
    const rows = await client
      .select({ id: projectStages.id })
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.stageKey, stageKey)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async listStages(projectId: string, client: DbClient = this.database.db): Promise<ProjectStageRow[]> {
    return client.select().from(projectStages).where(eq(projectStages.projectId, projectId)).orderBy(asc(projectStages.seq));
  }

  async findStage(projectId: string, stageKey: string): Promise<ProjectStageRow | null> {
    const rows = await this.database.db
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.stageKey, stageKey)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 阶段行加锁（事务内 SELECT ... FOR UPDATE；ADR-023 不部分推进的串行化基础）。 */
  async lockStage(tx: DbClient, stageId: string): Promise<ProjectStageRow | null> {
    const rows = await tx.select().from(projectStages).where(eq(projectStages.id, stageId)).for("update");
    return rows[0] ?? null;
  }

  async updateStageStatus(
    tx: DbClient,
    stageId: string,
    status: string,
    expectedVersion: number,
  ): Promise<number> {
    const rows = await tx
      .update(projectStages)
      .set({ status, version: sql`${projectStages.version} + 1` })
      .where(and(eq(projectStages.id, stageId), eq(projectStages.version, expectedVersion)))
      .returning({ version: projectStages.version });
    return rows[0]?.version ?? -1;
  }

  async updateStageAdvanced(tx: DbClient, stageId: string, expectedVersion: number, actorId: string, at: Date): Promise<number> {
    const rows = await tx
      .update(projectStages)
      .set({ status: "done", advancedAt: at, advancedBy: actorId, version: sql`${projectStages.version} + 1` })
      .where(and(eq(projectStages.id, stageId), eq(projectStages.version, expectedVersion)))
      .returning({ version: projectStages.version });
    return rows[0]?.version ?? -1;
  }

  async updateStageRolledBack(
    tx: DbClient,
    stageId: string,
    status: string,
    reason: string,
    expectedVersion: number,
    actorId: string,
    at: Date,
  ): Promise<number> {
    const rows = await tx
      .update(projectStages)
      .set({ status, rolledBackAt: at, rolledBackBy: actorId, rollbackReason: reason, version: sql`${projectStages.version} + 1` })
      .where(and(eq(projectStages.id, stageId), eq(projectStages.version, expectedVersion)))
      .returning({ version: projectStages.version });
    return rows[0]?.version ?? -1;
  }

  /** 阶段内节点批量置状态（advance：下一阶段节点 → active；rollback：本阶段节点 → pending）。 */
  async setStageNodesStatus(tx: DbClient, stageId: string, fromStatus: string, toStatus: string): Promise<void> {
    await tx
      .update(projectNodes)
      .set({ status: toStatus })
      .where(and(eq(projectNodes.stageId, stageId), eq(projectNodes.status, fromStatus)));
  }

  async listNodesWithRequirements(projectId: string): Promise<NodeWithRequirements[]> {
    const nodes = await this.database.db
      .select()
      .from(projectNodes)
      .where(and(eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)))
      .orderBy(asc(projectNodes.seq));
    if (nodes.length === 0) return [];
    const requirements = await this.database.db
      .select()
      .from(nodeRequirements)
      .where(inArray(nodeRequirements.nodeId, nodes.map((node) => node.id)));
    const byNode = new Map<string, NodeRequirementRow[]>();
    for (const requirement of requirements) {
      const list = byNode.get(requirement.nodeId) ?? [];
      list.push(requirement);
      byNode.set(requirement.nodeId, list);
    }
    return nodes.map((node) => ({ node, requirements: byNode.get(node.id) ?? [] }));
  }

  /** 增补去重：node_key 在项目内唯一（DB 唯一索引 project_nodes_project_id_node_key_key），含软删行。 */
  async findNodeByKey(tx: DbClient, projectId: string, nodeKey: string): Promise<ProjectNodeRow | null> {
    const rows = await tx
      .select()
      .from(projectNodes)
      .where(and(eq(projectNodes.projectId, projectId), eq(projectNodes.nodeKey, nodeKey)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 重新增补 = 还原软删行（唯一索引下不能再插一行）：回到 pending、清完成留痕、可换阶段与排序。 */
  async restoreNode(
    tx: DbClient,
    input: { nodeId: string; stageId: string; name: string; seq: string },
  ): Promise<ProjectNodeRow> {
    const rows = await tx
      .update(projectNodes)
      .set({
        stageId: input.stageId,
        name: input.name,
        seq: input.seq,
        status: "pending",
        doneAt: null,
        doneBy: null,
        deletedAt: null,
        deletedBy: null,
        version: sql`${projectNodes.version} + 1`,
      })
      .where(eq(projectNodes.id, input.nodeId))
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("project_nodes restore 未返回记录");
    return row;
  }

  async findNodeById(nodeId: string): Promise<ProjectNodeRow | null> {
    const rows = await this.database.db.select().from(projectNodes).where(eq(projectNodes.id, nodeId)).limit(1);
    return rows[0] ?? null;
  }

  async lockNode(tx: DbClient, nodeId: string): Promise<ProjectNodeRow | null> {
    const rows = await tx.select().from(projectNodes).where(eq(projectNodes.id, nodeId)).for("update");
    return rows[0] ?? null;
  }

  async maxSourceBlueprintVersion(projectId: string): Promise<number> {
    const rows = await this.database.db
      .select({ value: sql<number>`coalesce(max(${projectNodes.sourceBlueprintVersion}), 0)` })
      .from(projectNodes)
      .where(eq(projectNodes.projectId, projectId));
    return Number(rows[0]?.value ?? 0);
  }

  async insertNode(
    tx: DbClient,
    input: { projectId: string; stageId: string; nodeKey: string; name: string; seq: string; sourceBlueprintVersion: number; at: Date },
  ): Promise<ProjectNodeRow> {
    const rows = await tx
      .insert(projectNodes)
      .values({
        projectId: input.projectId,
        stageId: input.stageId,
        nodeKey: input.nodeKey,
        name: input.name,
        seq: input.seq,
        status: "active",
        origin: "added_by_user",
        sourceBlueprintVersion: input.sourceBlueprintVersion,
        version: 0,
        createdAt: input.at,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("project_nodes insert 未返回记录");
    return row;
  }

  async insertRequirements(
    tx: DbClient,
    nodeId: string,
    constraints: readonly { type: string; docType?: string; minCount?: number; config?: Record<string, unknown> }[],
    at: Date,
  ): Promise<void> {
    for (const constraint of constraints) {
      await tx.insert(nodeRequirements).values({
        nodeId,
        requirementType: constraint.type,
        docType: constraint.type === "required_doc" ? (constraint.docType ?? null) : null,
        minCount: constraint.type === "required_doc" ? (constraint.minCount ?? 1) : 1,
        config: constraint.type === "required_doc" ? null : (constraint.config ?? null),
        createdAt: at,
      });
    }
  }

  async markNodeDone(tx: DbClient, nodeId: string, expectedVersion: number, actorId: string, at: Date): Promise<number> {
    const rows = await tx
      .update(projectNodes)
      .set({ status: "done", doneAt: at, doneBy: actorId, version: sql`${projectNodes.version} + 1` })
      .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.version, expectedVersion)))
      .returning({ version: projectNodes.version });
    return rows[0]?.version ?? -1;
  }

  async softDeleteNode(tx: DbClient, nodeId: string, expectedVersion: number, actorId: string, at: Date): Promise<number> {
    const rows = await tx
      .update(projectNodes)
      .set({ status: "deleted", deletedAt: at, deletedBy: actorId, version: sql`${projectNodes.version} + 1` })
      .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.version, expectedVersion)))
      .returning({ version: projectNodes.version });
    return rows[0]?.version ?? -1;
  }

  /** 节点约束（响应视图 / 门禁明细）。 */
  async listRequirementsByNode(nodeId: string, client: DbClient = this.database.db): Promise<NodeRequirementRow[]> {
    return client.select().from(nodeRequirements).where(eq(nodeRequirements.nodeId, nodeId));
  }
}
