import { Injectable } from "@nestjs/common";
import { ObjectStorage } from "../storage/index.js";
import { HealthRepository, type ReadinessCheck } from "./health.repository.js";

export interface ReadinessReport {
  status: "ok" | "degraded";
  ok: boolean;
  checks: ReadinessCheck[];
}

@Injectable()
export class HealthService {
  constructor(
    private readonly repository: HealthRepository,
    private readonly storage: ObjectStorage,
  ) {}

  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  async readiness(): Promise<ReadinessReport> {
    const checks = await this.repository.readinessChecks();
    checks.push(await this.storageCheck());
    const ok = checks.every((check) => check.ok);
    return { status: ok ? "ok" : "degraded", ok, checks };
  }

  /** 对象存储就绪（ADR-006：文件是本项目最重的一类资产，数据库通不等于文件可用）。 */
  private async storageCheck(): Promise<ReadinessCheck> {
    try {
      await this.storage.probe();
      return { name: "object-storage:head-bucket", ok: true };
    } catch (error) {
      return {
        name: "object-storage:head-bucket",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
