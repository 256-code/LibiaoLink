/** identity 模块唯一公开出口（跨模块只允许 import 本文件；ADR-010 / g6）。 */
export { IdentityModule } from "./identity.module.js";
export { SessionGuard, CurrentUser } from "./auth.guard.js";
export type { MeUser } from "./me-user.js";
export { toMeUser } from "./me-user.js";
export { CsrfGuard } from "./csrf.guard.js";
export { SessionService } from "./session.service.js";
export { UserService } from "./user.service.js";
export type { SessionRow, SessionWithUser } from "./session.repository.js";
export type { UserRow } from "./user.repository.js";
export { DepartmentService } from "./department.service.js";
export type { DepartmentRow } from "./department.repository.js";
export { RoleService } from "./role.service.js";
export type { ActorAuthorization } from "./role.service.js";
export { OrgSyncService } from "./org-sync.service.js";
export type {
  MissingUserPolicy,
  OrgDepartmentRecord,
  OrgDirectorySnapshot,
  OrgSyncOptions,
  OrgSyncReport,
  OrgUserRecord,
} from "./org-sync.service.js";
export type { DataScope } from "./data-scope.js";
export { sortDataScopes, widestDataScope } from "./data-scope.js";
