import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { CsrfGuard } from "./csrf.guard.js";
import { DepartmentRepository } from "./department.repository.js";
import { DepartmentService } from "./department.service.js";
import { OidcService } from "./oidc.service.js";
import { OrgSyncService } from "./org-sync.service.js";
import { RoleRepository } from "./role.repository.js";
import { RoleService } from "./role.service.js";
import { SessionGuard } from "./auth.guard.js";
import { SessionRepository } from "./session.repository.js";
import { SessionService } from "./session.service.js";
import { UserRepository } from "./user.repository.js";
import { UserService } from "./user.service.js";

/** identity 模块（领域）：SSO 接入、会话、用户、组织同步与角色（h1）。 */
@Module({
  controllers: [AuthController],
  providers: [
    OidcService,
    SessionService,
    UserService,
    SessionRepository,
    UserRepository,
    SessionGuard,
    CsrfGuard,
    DepartmentRepository,
    DepartmentService,
    RoleRepository,
    RoleService,
    OrgSyncService,
  ],
  exports: [SessionService, UserService, SessionGuard, CsrfGuard, DepartmentService, RoleService, OrgSyncService],
})
export class IdentityModule {}
