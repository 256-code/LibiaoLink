import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { userPreferences } from "../../db/schema/identity.js";

export type UserPreferenceRow = typeof userPreferences.$inferSelect;

/**
 * user_preferences 数据访问（A4 / A24 · 0028）：一人一行，prefs 整体读写 ——
 * 合并语义（只传变更键 / 未声明键保留）在服务层做，仓储只负责「读一行 / 覆盖写一行」。
 */
@Injectable()
export class UserPreferenceRepository {
  constructor(private readonly database: DatabaseService) {}

  async find(userId: string): Promise<UserPreferenceRow | null> {
    const rows = await this.database.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    return rows[0] ?? null;
  }

  /** 覆盖写（不存在则插入）：prefs 整体替换为传入对象，updated_at 刷新为写入时间。 */
  async upsert(userId: string, prefs: Record<string, unknown>, at: Date): Promise<UserPreferenceRow> {
    const rows = await this.database.db
      .insert(userPreferences)
      .values({ userId, prefs, updatedAt: at })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { prefs, updatedAt: at } })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("user_preferences upsert 未返回记录");
    }
    return row;
  }
}
