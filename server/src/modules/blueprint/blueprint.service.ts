import { Injectable } from "@nestjs/common";
import { BlueprintViewSchema, z } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { RoleService } from "../identity/index.js";
import { BlueprintRepository, type BlueprintRow } from "./blueprint.repository.js";
import { validateBlueprint, type Blueprint } from "./blueprint.validation.js";

export type BlueprintView = z.infer<typeof BlueprintViewSchema>;

/** 兜底默认模板的项目类型（ADR-019）。 */
export const DEFAULT_BLUEPRINT_PROJECT_TYPE = "default";

export interface BlueprintSnapshot {
  blueprintId: string;
  projectType: string;
  version: number;
  payload: Blueprint;
}

/** 蓝图用例（h3）：草稿保存 / 发布 / 导出 / 导入 + 建项目事务取快照；写操作仅管理员（ADR-019 / ADR-020）。 */
@Injectable()
export class BlueprintService {
  constructor(
    private readonly blueprints: BlueprintRepository,
    private readonly roles: RoleService,
  ) {}

  /** 管理员校验：h6 功能权限矩阵就位前，按角色码 admin 判定（口径记录在 README）。 */
  async assertAdmin(actorId: string): Promise<void> {
    const authorization = await this.roles.getActorAuthorization(actorId);
    if (!authorization.roleCodes.includes("admin")) {
      throw new AppError("FORBIDDEN", "蓝图维护仅限管理员（ADR-019 / ADR-020）");
    }
  }

  /** GET /blueprint：projectType 缺省 = default 兜底模板；未创建 → 404。 */
  async getView(projectTypeInput?: string): Promise<BlueprintView> {
    const row = await this.findRowOrFail(projectTypeInput);
    return this.toView(row);
  }

  /** PUT /blueprint：保存草稿（校验不过 → 422 + 全量 issues；未创建的 projectType 首次保存即建档）。 */
  async saveDraft(projectTypeInput: string | undefined, payload: unknown, actorId: string): Promise<BlueprintView> {
    await this.assertAdmin(actorId);
    const projectType = projectTypeInput ?? DEFAULT_BLUEPRINT_PROJECT_TYPE;
    const blueprint = this.validateOrThrow({ ...(payload as Record<string, unknown>), projectType });
    const at = new Date();
    const existing = await this.blueprints.findByProjectType(projectType);
    const row =
      existing === null
        ? await this.blueprints.insertDraft(projectType, blueprint.name, blueprint, actorId, at)
        : await this.blueprints.updateDraft(existing.id, blueprint, actorId, at);
    if (row === null) throw new AppError("NOT_FOUND", "蓝图不存在：" + projectType);
    return this.toView(row);
  }

  /** POST /blueprint/publish：草稿无变更 → 幂等返回当前视图（不递增版本）；否则发布新版本。 */
  async publish(projectTypeInput: string | undefined, actorId: string): Promise<BlueprintView> {
    await this.assertAdmin(actorId);
    const row = await this.findRowOrFail(projectTypeInput);
    const draft = row.draftPayload as Blueprint;
    const published = row.publishedVersion > 0 ? await this.blueprints.findVersion(row.id, row.publishedVersion) : null;
    if (published !== null && sameBlueprint(draft, published.payload as Blueprint)) {
      return this.toView(row);
    }
    const at = new Date();
    const nextVersion = row.publishedVersion + 1;
    const payload: Blueprint = {
      ...draft,
      projectType: row.projectType,
      blueprintVersion: nextVersion,
      updatedAt: at.toISOString(),
    };
    await this.blueprints.publishVersion(row.id, nextVersion, payload, [], actorId, at);
    const updated = await this.blueprints.findByProjectType(row.projectType);
    return this.toView(updated ?? row);
  }

  /** GET /blueprint/export：已发布 payload 为正本；尚未发布时导出草稿（round-trip 无损）。 */
  async exportBlueprint(projectTypeInput?: string): Promise<Blueprint> {
    const row = await this.findRowOrFail(projectTypeInput);
    if (row.publishedVersion > 0) {
      const published = await this.blueprints.findVersion(row.id, row.publishedVersion);
      if (published !== null) return published.payload as Blueprint;
    }
    return row.draftPayload as Blueprint;
  }

  /** POST /blueprint/import：外部 JSON 存入草稿（schema + 引用校验；重复导入幂等）。 */
  async importBlueprint(projectTypeInput: string | undefined, payload: unknown, actorId: string): Promise<BlueprintView> {
    return this.saveDraft(projectTypeInput, payload, actorId);
  }

  /**
   * 建项目事务取快照：优先该项目类型的已发布蓝图，缺失回落 default 模板（ADR-019）。
   * 两者都无已发布版本 → null（调用方转 422 BLUEPRINT_NOT_PUBLISHED）。
   */
  async getPublishedForProject(projectType: string): Promise<BlueprintSnapshot | null> {
    for (const type of [projectType, DEFAULT_BLUEPRINT_PROJECT_TYPE]) {
      const row = await this.blueprints.findByProjectType(type);
      if (row === null || row.publishedVersion === 0) continue;
      const version = await this.blueprints.findVersion(row.id, row.publishedVersion);
      if (version === null) continue;
      return {
        blueprintId: row.id,
        projectType: row.projectType,
        version: row.publishedVersion,
        payload: version.payload as Blueprint,
      };
    }
    return null;
  }

  /** 指定版本取快照（ProjectCreateBody.blueprintVersion 显式指定时用；同样回落 default）。 */
  async getVersionForProject(projectType: string, version: number): Promise<BlueprintSnapshot | null> {
    for (const type of [projectType, DEFAULT_BLUEPRINT_PROJECT_TYPE]) {
      const row = await this.blueprints.findByProjectType(type);
      if (row === null) continue;
      const versionRow = await this.blueprints.findVersion(row.id, version);
      if (versionRow === null) continue;
      return { blueprintId: row.id, projectType: row.projectType, version, payload: versionRow.payload as Blueprint };
    }
    return null;
  }

  /** 模板节点池解析（节点增补）：按项目导入版本取模板节点；项目类型无独立蓝图时回落 default（与导入快照同源，ADR-019）。 */
  async findNodeTemplate(projectType: string, version: number, nodeKey: string): Promise<BlueprintTemplateNode | null> {
    for (const type of [projectType, DEFAULT_BLUEPRINT_PROJECT_TYPE]) {
      const row = await this.blueprints.findByProjectType(type);
      if (row === null) continue;
      const versionRow = await this.blueprints.findVersion(row.id, version);
      if (versionRow === null) continue;
      const payload = versionRow.payload as Blueprint;
      for (const stage of payload.stages) {
        const node = stage.nodes.find((item) => item.key === nodeKey);
        if (node !== undefined) return { stageKey: stage.key, node };
      }
    }
    return null;
  }

  private async findRowOrFail(projectTypeInput?: string): Promise<BlueprintRow> {
    const projectType = projectTypeInput ?? DEFAULT_BLUEPRINT_PROJECT_TYPE;
    const row = await this.blueprints.findByProjectType(projectType);
    if (row === null) throw new AppError("NOT_FOUND", "该项目类型尚未创建蓝图：" + projectType);
    return row;
  }

  private validateOrThrow(payload: unknown): Blueprint {
    const result = validateBlueprint(payload);
    if (!result.ok || result.blueprint === null) {
      throw new AppError(
        result.refUnknown ? "BLUEPRINT_REF_UNKNOWN" : "BLUEPRINT_SCHEMA_INVALID",
        "蓝图校验未通过（" + result.issues.length + " 项）",
        result.issues.map((issue) => ({ code: "blueprint_invalid", message: issue.message, path: issue.path })),
      );
    }
    return result.blueprint;
  }

  private async toView(row: BlueprintRow): Promise<BlueprintView> {
    const draft = row.draftPayload as Blueprint;
    const published = row.publishedVersion > 0 ? await this.blueprints.findVersion(row.id, row.publishedVersion) : null;
    const publishedPayload = published === null ? null : (published.payload as Blueprint);
    const status: BlueprintView["status"] = publishedPayload !== null && sameBlueprint(draft, publishedPayload) ? "published" : "draft";
    return {
      blueprint: status === "published" && publishedPayload !== null ? publishedPayload : draft,
      status,
      projectType: row.projectType,
      isDefault: row.projectType === DEFAULT_BLUEPRINT_PROJECT_TYPE,
      publishedVersion: row.publishedVersion,
      publishedAt: published === null ? null : published.publishedAt.toISOString(),
      publishedBy: published === null ? null : published.publishedBy,
    };
  }
}

export interface BlueprintTemplateNode {
  stageKey: string;
  node: Blueprint["stages"][number]["nodes"][number];
}

/** 语义等值（payload 深比较）：发布幂等与草稿 / 已发布状态判定的唯一口径。 */
export function sameBlueprint(left: Blueprint, right: Blueprint): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
