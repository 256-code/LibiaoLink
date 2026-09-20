/** admin 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export { AdminModule } from "./admin.module.js";
export { AuditService, toAuditLog } from "./audit.service.js";
export type { AuditListQueryInput, AuditRecordInput } from "./audit.service.js";
export { DictService } from "./dict.service.js";
export { diffRecords, stableValue } from "./audit.rules.js";
export type { AuditInsertInput, AuditListFilter, AuditRow } from "./audit.repository.js";
export type { DictItemInsertInput, DictItemRow, DictItemUpdateInput, DictTypeRow } from "./dict.repository.js";
