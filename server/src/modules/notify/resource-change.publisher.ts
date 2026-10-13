import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { LiveResource, ResourceChangeSink } from "../../common/realtime/resource-change.js";
import { DatabaseService } from "../../db/database.service.js";
import { NOTIFY_STREAM_CHANNEL } from "./notify.stream.js";

/** Best-effort post-commit hints; reconnect and periodic reads compensate for missed hints. */
@Injectable()
export class ResourceChangePublisher implements ResourceChangeSink, OnApplicationShutdown {
  private readonly logger = new Logger(ResourceChangePublisher.name);
  private readonly pending = new Set<LiveResource>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly database: DatabaseService) {}

  changed(resources: readonly LiveResource[]): void {
    if (this.stopped) return;
    for (const resource of resources) this.pending.add(resource);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null || this.running || this.pending.size === 0 || this.stopped) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 250);
    this.timer.unref();
  }

  private async flush(): Promise<void> {
    this.running = true;
    const resources = [...this.pending];
    this.pending.clear();
    try {
      await this.database.pool.query("select pg_notify($1, $2)", [
        NOTIFY_STREAM_CHANNEL,
        JSON.stringify({ recipientId: null, event: "invalidate", data: { resources } }),
      ]);
    } catch {
      this.logger.warn("自动同步提示发布失败，客户端将通过补取恢复最新数据");
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.pending.clear();
  }
}
