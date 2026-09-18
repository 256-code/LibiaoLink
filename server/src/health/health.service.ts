import { Injectable } from "@nestjs/common";
import { HealthRepository, type ReadinessCheck } from "./health.repository.js";

export interface ReadinessReport {
  status: "ok" | "degraded";
  ok: boolean;
  checks: ReadinessCheck[];
}

@Injectable()
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  async readiness(): Promise<ReadinessReport> {
    const checks = await this.repository.readinessChecks();
    const ok = checks.every((check) => check.ok);
    return { status: ok ? "ok" : "degraded", ok, checks };
  }
}
