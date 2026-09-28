import { Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../config/config.module.js";
import { OutboxStore } from "../db/outbox.store.js";

/** 单轮清扫最多批次数：每批 OUTBOX_RETENTION_BATCH 条，防一次删太多把锁与 WAL 拉满。 */
export const OUTBOX_RETENTION_MAX_ROUNDS = 50;

/**
 * done 行保留期清理（S7-1 · ADR-005：成功行约 90 天清理并观察表膨胀）。
 * 分批删除到「不足一批」为止；dead 行不动（是死信告警与排障证据，人工处置）。
 */
@Injectable()
export class OutboxRetention {
  private readonly logger = new Logger(OutboxRetention.name);

  constructor(
    private readonly store: OutboxStore,
    private readonly config: AppConfig,
  ) {}

  /** 一轮清扫；返回本轮删除条数（测试 / 回放断言用）。 */
  async sweepOnce(): Promise<number> {
    const retentionDays = this.config.env.OUTBOX_DONE_RETENTION_DAYS;
    const batch = this.config.env.OUTBOX_RETENTION_BATCH;
    let purged = 0;
    for (let round = 0; round < OUTBOX_RETENTION_MAX_ROUNDS; round += 1) {
      const deleted = await this.store.purgeDone({ retentionDays, batch });
      purged += deleted;
      if (deleted < batch) {
        break;
      }
    }
    if (purged > 0) {
      this.logger.log("outbox done 行清理：保留 " + retentionDays + " 天，本轮清理 " + purged + " 条");
    }
    return purged;
  }
}