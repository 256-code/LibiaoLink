import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { users } from "../../db/schema/identity.js";

export type UserRow = typeof users.$inferSelect;

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
}
