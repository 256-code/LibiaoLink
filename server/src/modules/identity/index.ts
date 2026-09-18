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
