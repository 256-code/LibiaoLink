import { Injectable } from "@nestjs/common";
import {
  VIEW_NAME_MAX_LENGTH,
  type SavedView,
  type ViewCreateBody,
  type ViewDeleteResponse,
  type ViewListQuery,
  type ViewListResponse,
  type ViewUpdateBody,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { ProjectViewRepository, type ProjectViewPatch, type ProjectViewRow } from "./view.repository.js";

/**
 * 视图用例（M2-06 首刀 · A1-03）：个人视图（仅本人可见 / 可改）+ 公共视图（全员可见、创建者可改）。
 * 口径：仅保存配置、不复制数据（打开视图实时反映最新数据）；物理删、无审计、无乐观锁（界面配置、单写者）。
 * 归属：个人视图他人 = 404（不可见）；公共视图非创建者 = 403（可见但无写权）。
 * 差异登记：公共视图「共享给指定角色」未做 —— 一期公共视图 = 全员可见。
 */
@Injectable()
export class ViewService {
  constructor(
    private readonly views: ProjectViewRepository,
    private readonly database: DatabaseService,
  ) {}

  /** GET /api/v1/views：我的个人视图 + 全部公共视图（scope 可过滤；个人在前 → updatedAt 降序 → id 升序）。 */
  async list(actorId: string, query: ViewListQuery): Promise<ViewListResponse> {
    const rows = await this.views.listVisible(actorId, query.scope ?? null);
    return { items: rows.map(toContract) };
  }

  /** POST /api/v1/views：新建；isDefault 置位时同事务清掉本人其它默认。 */
  async create(actorId: string, body: ViewCreateBody): Promise<SavedView> {
    const at = new Date();
    const row = await this.database.db.transaction(async (tx) => {
      const created = await this.views.insert(
        {
          ownerId: actorId,
          scope: body.scope,
          name: normalizeName(body.name),
          filters: body.filters,
          columns: body.columns,
          sort: body.sort ?? null,
          grouping: body.grouping ?? null,
          isDefault: body.isDefault,
        },
        at,
        tx,
      );
      if (created.isDefault) {
        await this.views.clearOtherDefaults(actorId, created.id, tx);
      }
      return created;
    });
    return toContract(row);
  }

  /** PATCH /api/v1/views/{id}：局部更新（空更新 400）；归属校验见 assertWritable；置默认时同事务清掉本人其它默认。 */
  async update(actorId: string, id: string, body: ViewUpdateBody): Promise<SavedView> {
    if (Object.keys(body).length === 0) {
      throw new AppError("VALIDATION_FAILED", "更新内容为空：至少传入一个变更键（name / scope / filters / columns / sort / grouping / isDefault）");
    }
    const at = new Date();
    const row = await this.database.db.transaction(async (tx) => {
      const existing = await this.views.findById(id, tx);
      if (existing === null) {
        throw new AppError("NOT_FOUND", "视图不存在：" + id);
      }
      assertWritable(existing, actorId);
      const patch: ProjectViewPatch = {};
      if (body.name !== undefined) patch.name = normalizeName(body.name);
      if (body.scope !== undefined) patch.scope = body.scope;
      if (body.filters !== undefined) patch.filters = body.filters;
      if (body.columns !== undefined) patch.columns = body.columns;
      if (body.sort !== undefined) patch.sort = body.sort;
      if (body.grouping !== undefined) patch.grouping = body.grouping;
      if (body.isDefault !== undefined) patch.isDefault = body.isDefault;
      const updated = await this.views.update(id, patch, at, tx);
      if (updated.isDefault) {
        await this.views.clearOtherDefaults(actorId, id, tx);
      }
      return updated;
    });
    return toContract(row);
  }

  /** DELETE /api/v1/views/{id}：物理删（配置文件不留痕）；归属校验同 update。 */
  async remove(actorId: string, id: string): Promise<ViewDeleteResponse> {
    await this.database.db.transaction(async (tx) => {
      const existing = await this.views.findById(id, tx);
      if (existing === null) {
        throw new AppError("NOT_FOUND", "视图不存在：" + id);
      }
      assertWritable(existing, actorId);
      await this.views.delete(id, tx);
    });
    return { id, deleted: true };
  }
}

/** 名称收敛：剔除前后空白后 1 ' 50 字（与库侧 CHECK ck_project_views_name 同口径）。 */
function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > VIEW_NAME_MAX_LENGTH) {
    throw new AppError("VALIDATION_FAILED", "视图名称剔除前后空白后须为 1 ' 50 字");
  }
  return name;
}

/** 写归属：个人视图他人 = 404（不可见防 IDOR）；公共视图非创建者 = 403（可见但无写权）。 */
function assertWritable(row: ProjectViewRow, actorId: string): void {
  if (row.ownerId === actorId) return;
  if (row.scope === "public") {
    throw new AppError("FORBIDDEN", "公共视图仅创建者可改 / 删：" + row.id);
  }
  throw new AppError("NOT_FOUND", "视图不存在：" + row.id);
}

/** 行 → 契约（jsonb 读面原样下发：写入经契约校验，个人界面配置不做二次收敛）。 */
function toContract(row: ProjectViewRow): SavedView {
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    scope: row.scope as SavedView["scope"],
    name: row.name,
    filters: row.filters as SavedView["filters"],
    columns: row.columns,
    sort: row.sort,
    grouping: row.grouping,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
