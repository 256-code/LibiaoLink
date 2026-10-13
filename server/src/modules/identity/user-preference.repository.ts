import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { userPreferences } from "../../db/schema/identity.js";

export type UserPreferenceRow = typeof userPreferences.$inferSelect;

/**
 * user_preferences 数据访问（A4 / A24 · 0028）：一人一行，在事务内锁定账号行后合并变更键；
 * 同键集合由服务层比较版本，不同键更新保留已提交值。
 */
@Injectable()
export class UserPreferenceRepository {
  constructor(private readonly database: DatabaseService) {}

  async find(userId: string): Promise<UserPreferenceRow | null> {
    const rows = await this.database.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    return rows[0] ?? null;
  }

  /** Lock even the first write: merging a previously read JSON object outside this transaction loses concurrent keys. */
  async mutate(userId: string, update: (current: Record<string, unknown>) => Record<string, unknown>, at: Date): Promise<UserPreferenceRow> {
    return this.database.db.transaction(async (tx) => {
      await tx.insert(userPreferences).values({ userId, prefs: {}, updatedAt: at }).onConflictDoNothing();
      const [current] = await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)).for("update");
      if (current === undefined) throw new Error("user_preferences lock 未返回记录");
      const prefs = update(current.prefs);
      const [row] = await tx.update(userPreferences).set({ prefs, updatedAt: at }).where(eq(userPreferences.userId, userId)).returning();
      if (row === undefined) throw new Error("user_preferences update 未返回记录");
      await tx.execute(sql`select pg_notify('notify_stream', ${JSON.stringify({ recipientId: userId, event: "invalidate", data: { resources: ["preferences"] } })})`);
      return row;
    });
  }

}
