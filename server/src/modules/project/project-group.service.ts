import { Injectable } from "@nestjs/common";
import { ProjectGroupBindingSchema, ProjectGroupPutBodySchema, z } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import type { AuditChangeEntry } from "../../db/schema/admin.js";
import { AuditService } from "../admin/index.js";
import { ProjectGroupRepository, type WecomGroupRow } from "./project-group.repository.js";
import { ProjectRepository } from "./project.repository.js";

export type ProjectGroupBindingView = z.infer<typeof ProjectGroupBindingSchema>;

/** 入参按「契约输入」收：name 的缺省（覆盖语义 = 清空）由 ZodValidationPipe 落定，直接调用服务时同口径兜底。 */
type ProjectGroupPutBody = z.input<typeof ProjectGroupPutBodySchema>;

/** chatid 掩码（读面 / 审计 / 日志统一口径：只回末 4 位，全文只落库）。 */
export function maskChatid(chatid: string): string {
  return "****" + chatid.slice(-4);
}

/** 绑定行 → 契约视图；未绑定（含解绑后）由 null 分支构造 bound:false 形态。 */
export function toProjectGroupView(projectId: string, row: WecomGroupRow | null): ProjectGroupBindingView {
  if (row === null) {
    return { projectId, bound: false, name: null, chatidMasked: null, activated: false, updatedAt: null };
  }
  return {
    projectId,
    bound: true,
    name: row.name,
    chatidMasked: maskChatid(row.chatid),
    activated: row.activatedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 项目群绑定用例（M5-03-2 接线段 · C2-05）：读 / 绑定换绑 / 解绑。
 * 口径（S8-1 定案 + P5 切换）：GET 恒 200（未绑定 = bound:false；项目不存在 / 不可见由守卫落 404）；
 * PUT 覆盖语义（name 缺省 = 清空）、chatid 变更 = 换绑（新会话，activated_at 重置 null）；
 * 写路径归档保护同主数据（ADR-027 → 409 PROJECT_ARCHIVED）；变更写审计（objectType=project）并刷新项目 updatedAt（ADR-022）。
 */
@Injectable()
export class ProjectGroupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly groups: ProjectGroupRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditService,
  ) {}

  async getGroup(projectId: string): Promise<ProjectGroupBindingView> {
    await this.requireProject(projectId);
    const row = await this.groups.findByProject(projectId);
    return toProjectGroupView(projectId, row);
  }

  /** 绑定 / 换绑：同 chatid 重放幂等（保留激活态与群名外的更新）；换绑重置 activated_at（主动推送需重新激活）。 */
  async putGroup(projectId: string, body: ProjectGroupPutBody, actorId: string): Promise<ProjectGroupBindingView> {
    const project = await this.requireProject(projectId);
    this.assertWritable(project.project.status);
    const chatid = body.chatid;
    const name = body.name ?? null;
    const at = new Date();
    const row = await this.database.db.transaction(async (tx) => {
      const previous = await this.groups.findByProject(projectId, tx);
      const activatedAt = previous === null || previous.chatid !== chatid ? null : previous.activatedAt;
      const saved = await this.groups.upsert({ projectId, chatid, name, activatedAt }, at, tx);
      await this.projects.touch(projectId, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "project",
        objectId: projectId,
        projectId,
        summary: this.bindSummary(previous, chatid),
        changes: this.bindChanges(previous, chatid, name),
        metadata: {
          bound: true,
          chatidChanged: previous !== null && previous.chatid !== chatid,
          activated: saved.activatedAt !== null,
        },
      });
      return saved;
    });
    return toProjectGroupView(projectId, row);
  }

  /** 解绑（幂等）：未绑定不落审计 / 不触 updatedAt；解绑后读面恒 bound:false。 */
  async deleteGroup(projectId: string, actorId: string): Promise<ProjectGroupBindingView> {
    const project = await this.requireProject(projectId);
    this.assertWritable(project.project.status);
    const at = new Date();
    await this.database.db.transaction(async (tx) => {
      const removed = await this.groups.remove(projectId, tx);
      if (removed === null) return;
      await this.projects.touch(projectId, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "delete",
        objectType: "project",
        objectId: projectId,
        projectId,
        summary: "解绑项目群（chatid " + maskChatid(removed.chatid) + "）",
        changes: [
          { field: "groupChatid", from: maskChatid(removed.chatid), to: null },
          ...(removed.name === null ? [] : [{ field: "groupName", from: removed.name, to: null }]),
        ],
        metadata: { bound: false },
      });
    });
    return toProjectGroupView(projectId, null);
  }

  private bindSummary(previous: WecomGroupRow | null, chatid: string): string {
    if (previous === null) return "绑定项目群（chatid " + maskChatid(chatid) + "）";
    if (previous.chatid !== chatid) {
      return "换绑项目群（chatid " + maskChatid(previous.chatid) + " → " + maskChatid(chatid) + "）";
    }
    return "维护项目群绑定信息（chatid " + maskChatid(chatid) + "）";
  }

  /** 字段级留痕：chatid 只记掩码（全文不落审计读面）；无变化字段不进 changes（与 diff 语义一致）。 */
  private bindChanges(previous: WecomGroupRow | null, chatid: string, name: string | null): AuditChangeEntry[] {
    const changes: AuditChangeEntry[] = [];
    if (previous === null || previous.chatid !== chatid) {
      changes.push({
        field: "groupChatid",
        from: previous === null ? null : maskChatid(previous.chatid),
        to: maskChatid(chatid),
      });
    }
    const previousName = previous?.name ?? null;
    if (previousName !== name) {
      changes.push({ field: "groupName", from: previousName, to: name });
    }
    return changes;
  }

  private async requireProject(projectId: string) {
    const project = await this.projects.findViewById(projectId);
    if (project === null) {
      throw new AppError("NOT_FOUND", "项目不存在或不可见");
    }
    return project;
  }

  /** 归档写保护（ADR-027）：群绑定属项目附属维护，与主数据 / 名册同口径。 */
  private assertWritable(status: string): void {
    if (status === "archived") {
      throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止修改群绑定");
    }
  }
}