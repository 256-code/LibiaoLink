import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { CsrfGuard } from "./csrf.guard.js";
import { OidcService } from "./oidc.service.js";
import { SessionGuard } from "./auth.guard.js";
import { SessionRepository } from "./session.repository.js";
import { SessionService } from "./session.service.js";
import { UserRepository } from "./user.repository.js";
import { UserService } from "./user.service.js";

/** identity 模块（领域）：SSO 接入、会话、用户（组织 / 角色同步见 h1 卡片）。 */
@Module({
  controllers: [AuthController],
  providers: [OidcService, SessionService, UserService, SessionRepository, UserRepository, SessionGuard, CsrfGuard],
  exports: [SessionService, UserService, SessionGuard, CsrfGuard],
})
export class IdentityModule {}
