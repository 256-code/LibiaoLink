/** audit 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export { AuditModule } from "./audit.module.js";
export { AuditService, toAuditLog } from "./audit.service.js";
export type { AuditListQueryInput, AuditRecordInput } from "./audit.service.js";
export type { AuditInsertInput, AuditListFilter, AuditRow } from "./audit.repository.js";
