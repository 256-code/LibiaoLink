import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, AUDIT_RESULTS, UuidSchema } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";

/**
 * 审计列表查询解析（C7-04 · 2026-10-09 追订「别的筛选也是同理 要支持多选」+「操作记录里面也是」）：
 * 对象类型 / 操作人 / 动作 / 结果 / 项目支持逗号多值（去重保序、OR 语义），逐值校验白名单 / UUID，
 * 非法值一律 400（明确失败、不返回静默空列表 —— 与文件列表 filter[status] 同一先例，见 file/file.query.ts）。
 * 纯函数、不做 IO。
 */

/** 契约 AuditLogListQuery 的多值子集（controller 透传 z.infer 结果）。 */
export interface AuditMultiQueryInput {
  objectType?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  result?: string | undefined;
  projectId?: string | undefined;
}

/** 解析后的多值筛选（undefined = 不筛）。 */
export interface AuditMultiFilter {
  objectTypes?: string[];
  actorIds?: string[];
  actions?: string[];
  results?: string[];
  projectIds?: string[];
}

export function parseAuditListFilters(query: AuditMultiQueryInput): AuditMultiFilter {
  const out: AuditMultiFilter = {};
  const objectTypes = splitEnumList(query.objectType, AUDIT_OBJECT_TYPES, "objectType");
  if (objectTypes !== undefined) out.objectTypes = objectTypes;
  const actorIds = splitUuidList(query.actorId, "actorId");
  if (actorIds !== undefined) out.actorIds = actorIds;
  const actions = splitEnumList(query.action, AUDIT_ACTIONS, "action");
  if (actions !== undefined) out.actions = actions;
  const results = splitEnumList(query.result, AUDIT_RESULTS, "result");
  if (results !== undefined) out.results = results;
  const projectIds = splitUuidList(query.projectId, "projectId");
  if (projectIds !== undefined) out.projectIds = projectIds;
  return out;
}

/** 逗号多值：逐值过白名单（trim + 去重保序）；非法值 400；空串 = 不筛。 */
function splitEnumList(value: string | undefined, allowed: readonly string[], field: string): string[] | undefined {
  const parts = splitMulti(value);
  if (parts === undefined) return undefined;
  for (const part of parts) {
    if (!allowed.includes(part)) {
      throw new AppError("VALIDATION_FAILED", field + " 含非法取值：" + part);
    }
  }
  return parts;
}

/** 逗号多值：逐值过 UUID 校验（去重保序）；非法值 400；空串 = 不筛。 */
function splitUuidList(value: string | undefined, field: string): string[] | undefined {
  const parts = splitMulti(value);
  if (parts === undefined) return undefined;
  for (const part of parts) {
    if (!UuidSchema.safeParse(part).success) {
      throw new AppError("VALIDATION_FAILED", field + " 不是合法 UUID：" + part);
    }
  }
  return parts;
}

function splitMulti(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .filter((part, index, all) => all.indexOf(part) === index);
  return parts.length === 0 ? undefined : parts;
}
