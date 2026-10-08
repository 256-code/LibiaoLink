/** admin 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export { AdminModule } from "./admin.module.js";
// 审计出口自 Push 173 起在 audit 模块；此处保持 re-export，既有调用方（project / task / file / calendar / template 等）零改动。
export { AuditService, toAuditLog } from "../audit/index.js";
export type { AuditListQueryInput, AuditRecordInput } from "../audit/index.js";
export { DictService } from "./dict.service.js";
export { diffRecords, stableValue } from "./audit.rules.js";
export type { AuditInsertInput, AuditListFilter, AuditRow } from "../audit/index.js";
export type { DictItemInsertInput, DictItemRow, DictItemUpdateInput, DictTypeRow } from "./dict.repository.js";
