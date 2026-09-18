import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { HealthService } from "./health.service.js";

/** 基础设施端点（不在 /api/v1 业务契约内）：/healthz 存活、/readyz 就绪。 */
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("healthz")
  liveness(): { status: "ok" } {
    return this.health.liveness();
  }

  @Get("readyz")
  async readiness(@Res() response: Response): Promise<void> {
    const report = await this.health.readiness();
    response.status(report.ok ? 200 : 503).json(report);
  }
}
