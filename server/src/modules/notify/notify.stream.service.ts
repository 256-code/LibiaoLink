/**
 * SSE 实时流服务（S8-3 · M5-04-1 · C5 实时性口径）：
 *   - 连接注册表：每用户多连接、上限 env `NOTIFY_STREAM_MAX_CONNECTIONS`（超出拒新 · 定案 §三-4）；连接数按日志可观测；
 *   - PG LISTEN/NOTIFY 广播桥（定案 §三-5）：**惰性启动** —— 首个连接建立才 LISTEN（NotifyModule 由 api / worker
 *     共用，worker 永不建连接 → 永不 LISTEN）；用独立 `pg.Client`（不占查询连接池、停机与 DatabaseService 解耦）；
 *   - 心跳注释行（env `NOTIFY_STREAM_HEARTBEAT_MS`）+ 优雅关闭先发注释行（定案 §三-4 / §三-3：客户端自动重连）；
 *   - 轮询兜底（env `NOTIFY_STREAM_POLL_MS`，默认关）：弱实时兼容位，仅补 unread 角标快照（LISTEN 不可靠部署）；
 *   - 重连不补发（定案 §三-3）：本层零游标状态，错过的事件由客户端读面补拉对齐。
 */
import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Client, type Notification } from "pg";
import { AppConfig } from "../../config/config.module.js";
import { NotifyRepository } from "./notify.repository.js";
import {
  NOTIFY_STREAM_CHANNEL,
  NOTIFY_STREAM_HEARTBEAT_FRAME,
  NOTIFY_STREAM_SHUTDOWN_FRAME,
  NotifyStreamWireSchema,
  frameOf,
  type NotifyStreamWireMessage,
} from "./notify.stream.js";

/** 广播桥建立失败 / 掉线的重连间隔（毫秒）：仅在有活跃连接时重试。 */
const LISTEN_RETRY_MS = 2000;

/** 底层可写出口：控制器包装 express res（SSE 帧 / 注释行 → `res.write`；收尾 → `res.end`）；测试注入替身。 */
export interface NotifyStreamSink {
  write(chunk: string): void;
  end(): void;
}

/** 已建立的连接句柄（控制器在响应 close 时调用 `close()`；幂等）。 */
export interface NotifyStreamConnection {
  readonly userId: string;
  close(): void;
}

/** 单条 SSE 连接：心跳 / 轮询计时器随连接生命周期；close 幂等。 */
class StreamConnection implements NotifyStreamConnection {
  private closed = false;
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;
  private readonly pollTimer: ReturnType<typeof setInterval> | null;

  constructor(
    readonly userId: string,
    private readonly sink: NotifyStreamSink,
    heartbeatMs: number,
    pollMs: number,
    private readonly onPoll: (connection: StreamConnection) => void,
    private readonly onClose: (connection: StreamConnection) => void,
  ) {
    this.heartbeatTimer = setInterval(() => this.write(NOTIFY_STREAM_HEARTBEAT_FRAME), heartbeatMs);
    this.heartbeatTimer.unref();
    this.pollTimer =
      pollMs > 0
        ? setInterval(() => {
            if (!this.closed) this.onPoll(this);
          }, pollMs)
        : null;
    this.pollTimer?.unref();
  }

  /** 写一帧（已关闭则丢弃）。 */
  write(frame: string): void {
    if (!this.closed) this.sink.write(frame);
  }

  /** 优雅关闭（服务停机）：先发注释行告知客户端重连，再收尾。 */
  shutdown(): void {
    if (this.closed) return;
    this.write(NOTIFY_STREAM_SHUTDOWN_FRAME);
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.onClose(this);
    this.sink.end();
  }
}

@Injectable()
export class NotifyStreamService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotifyStreamService.name);
  private readonly connections = new Map<string, Set<StreamConnection>>();
  private listener: Client | null = null;
  private listenPending: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;

  constructor(
    private readonly repository: NotifyRepository,
    private readonly config: AppConfig,
  ) {}

  /** 活跃连接数（观测 / 测试；不传 user 时为全部）。 */
  connectionCount(userId?: string): number {
    if (userId !== undefined) return this.connections.get(userId)?.size ?? 0;
    let total = 0;
    for (const set of this.connections.values()) total += set.size;
    return total;
  }

  /**
   * 建立连接（控制器入口）：超出每用户上限（`NOTIFY_STREAM_MAX_CONNECTIONS`）→ null（拒新，控制器回 429）；
   * 停机中同样拒新。建立后不主动发任何帧（客户端等下一次事件 + 读面补拉对齐 —— 重连不补发口径）。
   */
  open(userId: string, sink: NotifyStreamSink): NotifyStreamConnection | null {
    if (this.shuttingDown) return null;
    const set = this.connections.get(userId) ?? new Set<StreamConnection>();
    const max = this.config.env.NOTIFY_STREAM_MAX_CONNECTIONS;
    if (set.size >= max) {
      this.logger.warn("SSE 连接超限拒新：user=" + userId + " 当前=" + set.size + " 上限=" + max);
      return null;
    }
    const connection = new StreamConnection(
      userId,
      sink,
      this.config.env.NOTIFY_STREAM_HEARTBEAT_MS,
      this.config.env.NOTIFY_STREAM_POLL_MS,
      (item) => void this.pollUnread(item),
      (item) => this.unregister(item),
    );
    set.add(connection);
    this.connections.set(userId, set);
    this.logger.log("SSE 连接建立：user=" + userId + " 活跃=" + set.size);
    void this.ensureListening();
    return connection;
  }

  /** 停机（Nest 生命周期）：逐连接先发注释行再收尾，随后关闭广播桥。 */
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    for (const set of [...this.connections.values()]) {
      for (const connection of [...set]) connection.shutdown();
    }
    this.connections.clear();
    const client = this.listener;
    this.listener = null;
    if (client !== null) {
      try {
        await client.end();
      } catch (error) {
        this.logger.warn("SSE 广播桥关闭失败：" + messageOf(error));
      }
    }
  }

  /** LISTEN 专用连接工厂（独立于查询池；测试覆写注入替身）。 */
  protected createListenerClient(): Client {
    return new Client({
      connectionString: this.config.env.DATABASE_URL,
      // 连接建立超时：桥建立失败必须落 catch（记日志 + 2s 重试），禁止静默悬挂（M5-04-1 真机回放实测）。
      connectionTimeoutMillis: 5000,
      // 观测锚点：pg_stat_activity 一眼认出广播桥（排障 / 连接治理用）。
      application_name: "libiaolink-notify-stream",
    });
  }

  /** 惰性启动广播桥：首个连接建立才 LISTEN（worker 无连接 → 永不启动）；并发调用去重。 */
  private async ensureListening(): Promise<void> {
    if (this.shuttingDown || this.listener !== null) return;
    if (this.listenPending !== null) {
      await this.listenPending;
      return;
    }
    this.listenPending = this.startListening().finally(() => {
      this.listenPending = null;
    });
    await this.listenPending;
  }

  private async startListening(): Promise<void> {
    const client = this.createListenerClient();
    try {
      client.on("notification", (message: Notification) => this.handleBroadcast(message));
      client.on("error", (error: Error) => {
        this.logger.error("SSE 广播桥连接异常（将自动重连）：" + messageOf(error));
        this.dropListener(client);
      });
      client.on("end", () => {
        if (!this.shuttingDown) {
          this.logger.warn("SSE 广播桥连接断开（将自动重连）");
          this.dropListener(client);
        }
      });
      // 显式 connect 必须先行（M5-04-1 真机回放实测的静默悬挂根因）：pg v8 的 query() 在未连接时
      // 只把查询入队、不自动建连；readyForQuery 恒 false —— 查询永久排队，桥永不就绪且无任何日志。
      await client.connect();
      await client.query("LISTEN " + NOTIFY_STREAM_CHANNEL);
      this.listener = client;
      this.logger.log("SSE 广播桥就绪：LISTEN " + NOTIFY_STREAM_CHANNEL + "（惰性启动）");
    } catch (error) {
      this.logger.error("SSE 广播桥建立失败（有连接时自动重试）：" + messageOf(error));
      await client.end().catch(() => {});
      this.scheduleRetry();
    }
  }

  /** 广播桥掉线（error / end）：清引用、收尾旧连接，并调度重连（仅当仍有活跃连接）。 */
  private dropListener(client: Client): void {
    if (this.listener !== client) {
      // 建立失败 / 已被替换的旧连接：只收尾，不触碰现役桥。
      void client.end().catch(() => {});
      return;
    }
    this.listener = null;
    void client.end().catch(() => {});
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.shuttingDown || this.retryTimer !== null || this.connectionCount() === 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensureListening();
    }, LISTEN_RETRY_MS);
    this.retryTimer.unref();
  }

  /** PG 通知 → 校验 → 本地扇出（非法载荷只告警丢弃，不影响已建连接）。 */
  private handleBroadcast(message: Notification): void {
    if (message.channel !== NOTIFY_STREAM_CHANNEL || typeof message.payload !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.payload);
    } catch {
      this.logger.warn("SSE 广播载荷非法（JSON 解析失败），已忽略");
      return;
    }
    const wire = NotifyStreamWireSchema.safeParse(parsed);
    if (!wire.success) {
      this.logger.warn("SSE 广播载荷非法（结构不符契约），已忽略");
      return;
    }
    this.broadcast(wire.data);
  }

  /** 扇出到该用户的本地连接；本实例无该用户连接 = 静默丢弃（重连不补发口径，客户端读面补拉）。 */
  private broadcast(wire: NotifyStreamWireMessage): void {
    const set = this.connections.get(wire.recipientId);
    if (set === undefined || set.size === 0) return;
    const frame = frameOf(wire.event, wire.data);
    for (const connection of set) connection.write(frame);
  }

  /** 轮询兜底（`NOTIFY_STREAM_POLL_MS` > 0 时启用）：弱实时补 unread 角标快照（幂等，重复帧无害）。 */
  private async pollUnread(connection: StreamConnection): Promise<void> {
    try {
      const unreadCount = await this.repository.countUnread(connection.userId);
      connection.write(frameOf("unread", { unreadCount }));
    } catch (error) {
      this.logger.warn("SSE 轮询兜底失败（下一轮重试）：" + messageOf(error));
    }
  }

  private unregister(connection: StreamConnection): void {
    const set = this.connections.get(connection.userId);
    if (set === undefined) return;
    set.delete(connection);
    if (set.size === 0) this.connections.delete(connection.userId);
    this.logger.log("SSE 连接关闭：user=" + connection.userId + " 活跃=" + set.size);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
