import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { sessions, users } from "../../db/schema/identity.js";
import type { UserRow } from "./user.repository.js";

export type SessionRow = typeof sessions.$inferSelect;

export interface SessionWithUser {
  session: SessionRow;
  user: UserRow;
}

/** sessions 数据访问（只存 sha256 哈希；软删用 revoked_at）。 */
@Injectable()
export class SessionRepository {
  constructor(private readonly database: DatabaseService) {}

  async insert(input: { tokenHash: string; userId: string; idToken: string; expiresAt: Date }): Promise<SessionRow> {
    const rows = await this.database.db.insert(sessions).values(input).returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("sessions insert 未返回记录");
    }
    return row;
  }

  async findWithUserByHash(tokenHash: string): Promise<SessionWithUser | null> {
    const rows = await this.database.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.database.db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, id));
  }

  async revokeById(id: string, at: Date): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  /** 撤销某用户全部在线会话（禁用 / 组织同步踢线；h1 复用）。 */
  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    const rows = await this.database.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  }
}
