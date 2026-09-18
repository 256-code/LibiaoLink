import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AppConfig } from "../config/config.module.js";
import * as schema from "./schema/index.js";

/** PG 连接与 Drizzle 客户端：应用角色（libiaolink_api，无 DDL，见 database/README.md）。 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(config: AppConfig) {
    this.pool = new Pool({ connectionString: config.env.DATABASE_URL, max: 5 });
    this.db = drizzle(this.pool, { schema });
  }

  async ping(): Promise<void> {
    await this.pool.query("select 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
