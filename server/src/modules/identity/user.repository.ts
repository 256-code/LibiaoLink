import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { users } from "../../db/schema/identity.js";

export type UserRow = typeof users.$inferSelect;

/** 组织同步的目录记录（企微 / Casdoor 归一化后）：status 以目录为准。 */
export interface DirectoryUserProfile {
  casdoorId: string;
  username: string;
  displayName: string;
  email: string | null;
  status: "active" | "disabled";
}

export interface SsoProfile {
  casdoorId: string;
  username: string;
  displayName: string;
  email: string | null;
  owner: string | null;
}

/** users 数据访问（SSO 为准；登录时按键 casdoor_id upsert）。 */
@Injectable()
export class UserRepository {
  constructor(private readonly database: DatabaseService) {}

  async upsert(profile: SsoProfile): Promise<UserRow> {
    const rows = await this.database.db
      .insert(users)
      .values({
        casdoorId: profile.casdoorId,
        username: profile.username,
        displayName: profile.displayName,
        email: profile.email,
        owner: profile.owner,
      })
      .onConflictDoUpdate({
        target: users.casdoorId,
        set: {
          username: profile.username,
          displayName: profile.displayName,
          email: profile.email,
          owner: profile.owner,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("users upsert 未返回记录");
    }
    return row;
  }

  async findById(id: string): Promise<UserRow | null> {
    const rows = await this.database.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByCasdoorId(casdoorId: string): Promise<UserRow | null> {
    const rows = await this.database.db.select().from(users).where(eq(users.casdoorId, casdoorId)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * 组织同步 upsert（h1）：与登录 upsert 的差别只有一点 —— status 以目录为准（离职禁用 / 复职启用）。
   * 登录路径不重置 status，避免「被禁用后用旧 token 登录」把禁用状态冲掉。
   */
  async upsertFromDirectory(profile: DirectoryUserProfile, at: Date): Promise<UserRow> {
    const rows = await this.database.db
      .insert(users)
      .values({
        casdoorId: profile.casdoorId,
        username: profile.username,
        displayName: profile.displayName,
        email: profile.email,
        status: profile.status,
      })
      .onConflictDoUpdate({
        target: users.casdoorId,
        set: {
          username: profile.username,
          displayName: profile.displayName,
          email: profile.email,
          status: profile.status,
          updatedAt: at,
        },
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("users upsertFromDirectory 未返回记录");
    }
    return row;
  }

  async listAll(): Promise<UserRow[]> {
    return this.database.db.select().from(users).orderBy(users.casdoorId);
  }

  async updateStatus(id: string, status: "active" | "disabled", at: Date): Promise<void> {
    await this.database.db.update(users).set({ status, updatedAt: at }).where(eq(users.id, id));
  }
}

