import { Injectable } from "@nestjs/common";
import { AppError } from "../../common/errors/app-error.js";
import { UserRepository, type SsoProfile, type UserRow } from "./user.repository.js";

/** claims → users 的归一化口径（ADR-010：JWT-Custom 的 name=工号、displayName=姓名）。 */
export function normalizeSsoProfile(claims: Record<string, unknown>): SsoProfile {
  const casdoorId = firstString(claims.id, claims.sub);
  if (casdoorId === null) {
    throw new AppError("AUTH_CALLBACK_FAILED", "ID Token 缺少用户标识（id）");
  }
  const username = firstString(claims.name) ?? casdoorId;
  const displayName = firstString(claims.displayName) ?? username;
  return {
    casdoorId,
    username,
    displayName,
    email: firstString(claims.email),
    owner: firstString(claims.owner),
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return null;
}


/** 用户用例：登录 upsert（不重新启用已禁用账号）+ 对外 getUser（identity 模块预留接口）。 */
@Injectable()
export class UserService {
  constructor(private readonly users: UserRepository) {}

  async upsertFromClaims(claims: Record<string, unknown>): Promise<UserRow> {
    return this.users.upsert(normalizeSsoProfile(claims));
  }

  async getUser(userId: string): Promise<UserRow> {
    const row = await this.users.findById(userId);
    if (row === null) {
      throw new AppError("NOT_FOUND", "用户不存在");
    }
    return row;
  }
}
