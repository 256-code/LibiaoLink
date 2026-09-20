import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema/index.js";

/** 应用侧数据库句柄类型（db 或 事务 tx）：仓储方法按需接收，保证同一事务内调用。 */
export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbClient = Database | DbTransaction;
