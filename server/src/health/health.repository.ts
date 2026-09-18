import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/database.service.js";

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/** 就绪探针的数据访问：只做最小探测（连通性 + 核心表可达）。 */
@Injectable()
export class HealthRepository {
  constructor(private readonly database: DatabaseService) {}

  async probe(name: string, sql: string): Promise<ReadinessCheck> {
    try {
      await this.database.pool.query(sql);
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async readinessChecks(): Promise<ReadinessCheck[]> {
    return [
      await this.probe("postgres:connect", "select 1"),
      await this.probe("table:projects", "select 1 from projects limit 0"),
      await this.probe("table:outbox_events", "select 1 from outbox_events limit 0"),
    ];
  }
}
