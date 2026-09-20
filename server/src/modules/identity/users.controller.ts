import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { UserListQuerySchema, UserListResponseSchema, z } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { SessionGuard } from "./auth.guard.js";
import { UserService } from "./user.service.js";

type UserListQuery = z.infer<typeof UserListQuerySchema>;
type UserListResponse = z.infer<typeof UserListResponseSchema>;

/** 用户目录（A2 · M1）：已登录全员可读；只返回启用用户；契约 shared/src/modules/users.ts（Push 49）。 */
@Controller("api/v1/users")
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UserService) {}

  @Get()
  list(@Query(new ZodValidationPipe(UserListQuerySchema)) query: UserListQuery): Promise<UserListResponse> {
    return this.users.listUsers(query);
  }
}
