import { Module, type DynamicModule } from "@nestjs/common";
import type { OutboxTopic } from "@libiaolink/contracts";
import { ClockService } from "../common/clock/clock.service.js";
import type { Env } from "../config/env.js";
import { JobsStore } from "../db/jobs.store.js";
import { OutboxStore } from "../db/outbox.store.js";
import { FileModule, PREVIEW_JOB_TOPIC, PreviewService } from "../modules/file/index.js";
import { NOTIFY_MESSAGE_TOPIC, NotifyModule, NotifyService } from "../modules/notify/index.js";
import { LogOutboxAlertSink, OUTBOX_ALERT_SINK } from "./alert.js";
import { OUTBOX_POLICIES, OUTBOX_REGISTRY, OutboxDispatcher } from "./dispatcher.js";
import type { OutboxTopicHandler } from "./handler.js";
import { resolveOutboxPolicies } from "./policy.js";
import { OutboxAlertProbe } from "./probe.js";
import { OutboxRetention } from "./retention.js";
import { JOBS_REGISTRY, JobScheduler, type OutboxJobHandler } from "./scheduler.js";

/**
 * Outbox worker 运行时（S7-1）：dispatcher（领取 / 消费 / 重试 / dead）+ 告警探针 + done 行保留期清理；
 * S7-3 增补调度器（jobs 表：cron 领取 / last_run_at 补发 / 单活 advisory lock · JobScheduler）。
 * 只装配在 worker 进程（api 不消费）。消费 / 生产注册表都在此组装（**加项即可**，dispatcher / scheduler 不感知业务）：
 * 事件消费当前有 preview.job（受 PREVIEW_JOB_ENABLED 开关）与 notify.message（S7-4 站内信投递，受 NOTIFY_DELIVERY_ENABLED 开关）；
 * 调度生产者当前为空 = 「只存不跑」排障态，规则调度 / 通知生产随 i12 / i13 接入。
 */
@Module({})
export class OutboxModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: OutboxModule,
      imports: [FileModule, NotifyModule],
      providers: [
        OutboxStore,
        JobsStore,
        ClockService,
        { provide: OUTBOX_ALERT_SINK, useClass: LogOutboxAlertSink },
        { provide: OUTBOX_POLICIES, useFactory: () => resolveOutboxPolicies(env) },
        {
          provide: OUTBOX_REGISTRY,
          useFactory: (previews: PreviewService, notify: NotifyService) => buildRegistry(env, previews, notify),
          inject: [PreviewService, NotifyService],
        },
        { provide: JOBS_REGISTRY, useFactory: () => buildJobsRegistry() },
        OutboxAlertProbe,
        OutboxRetention,
        OutboxDispatcher,
        JobScheduler,
      ],
      exports: [OutboxDispatcher, OutboxAlertProbe, OutboxRetention, JobScheduler],
    };
  }
}

/**
 * 注册表组装（消费侧唯一清单）：PREVIEW_JOB_ENABLED=false 时预览不入表、NOTIFY_DELIVERY_ENABLED=false 时
 * 站内信不入表（只投递不消费的排障态）。notify.message 的消费只做「落行 + 合并 / 投递 / 排期」分类；
 * 延迟投递（免打扰 / 每日上限）由 NotifyService.flushDue 的独立循环排空，不占 outbox 重试。
 */
function buildRegistry(
  env: Env,
  previews: PreviewService,
  notify: NotifyService,
): Map<OutboxTopic, OutboxTopicHandler> {
  const registry = new Map<OutboxTopic, OutboxTopicHandler>();
  if (env.PREVIEW_JOB_ENABLED === "true") {
    registry.set(PREVIEW_JOB_TOPIC, {
      handle: (row) => previews.consume(row),
      onDead: (row, error) => previews.onDead(row, error),
    });
  }
  if (env.NOTIFY_DELIVERY_ENABLED === "true") {
    registry.set(NOTIFY_MESSAGE_TOPIC, {
      handle: (row) => notify.consume(row),
    });
  }
  return registry;
}

/**
 * 调度生产者注册表组装：kind → handler（与 OUTBOX_REGISTRY 同形，加项即可）。
 * 当前为空 = 「只存不跑」排障态（jobs 行可先入表）；规则调度 / 通知生产随 i12 / i13 / j1 接线。
 */
function buildJobsRegistry(): Map<string, OutboxJobHandler> {
  return new Map();
}
