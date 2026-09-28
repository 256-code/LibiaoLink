import { Module, type DynamicModule } from "@nestjs/common";
import { ClockService } from "../common/clock/clock.service.js";
import type { Env } from "../config/env.js";
import { OutboxStore } from "../db/outbox.store.js";
import { FileModule, PREVIEW_JOB_TOPIC, PreviewService } from "../modules/file/index.js";
import { LogOutboxAlertSink, OUTBOX_ALERT_SINK } from "./alert.js";
import { OUTBOX_POLICIES, OUTBOX_REGISTRY, OutboxDispatcher } from "./dispatcher.js";
import type { OutboxTopicHandler } from "./handler.js";
import { resolveOutboxPolicies } from "./policy.js";
import { OutboxAlertProbe } from "./probe.js";
import { OutboxRetention } from "./retention.js";

/**
 * Outbox worker 运行时（S7-1）：dispatcher（领取 / 消费 / 重试 / dead）+ 告警探针 + done 行保留期清理。
 * 只装配在 worker 进程（api 不消费）。消费者注册表在此组装：当前只有 preview.job（受 PREVIEW_JOB_ENABLED 开关）；
 * 通用事件消费与调度随 i11 / M5 接入（注册表加项即可，dispatcher 不感知业务）。
 */
@Module({})
export class OutboxModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: OutboxModule,
      imports: [FileModule],
      providers: [
        OutboxStore,
        ClockService,
        { provide: OUTBOX_ALERT_SINK, useClass: LogOutboxAlertSink },
        { provide: OUTBOX_POLICIES, useFactory: () => resolveOutboxPolicies(env) },
        {
          provide: OUTBOX_REGISTRY,
          useFactory: (previews: PreviewService) => buildRegistry(env, previews),
          inject: [PreviewService],
        },
        OutboxAlertProbe,
        OutboxRetention,
        OutboxDispatcher,
      ],
      exports: [OutboxDispatcher, OutboxAlertProbe, OutboxRetention],
    };
  }
}

/** 注册表组装（消费侧唯一清单）：PREVIEW_JOB_ENABLED=false 时预览不入表（只投递不消费的排障态）。 */
function buildRegistry(env: Env, previews: PreviewService): Map<string, OutboxTopicHandler> {
  const registry = new Map<string, OutboxTopicHandler>();
  if (env.PREVIEW_JOB_ENABLED === "true") {
    registry.set(PREVIEW_JOB_TOPIC, {
      handle: (row) => previews.consume(row),
      onDead: (row, error) => previews.onDead(row, error),
    });
  }
  return registry;
}