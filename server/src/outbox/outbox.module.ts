import { Logger, Module, type DynamicModule } from "@nestjs/common";
import type { OutboxTopic } from "@libiaolink/contracts";
import { ClockService } from "../common/clock/clock.service.js";
import type { Env } from "../config/env.js";
import { DatabaseService } from "../db/database.service.js";
import { JobsStore } from "../db/jobs.store.js";
import { appendOutboxIfAbsent } from "../db/outbox.js";
import { OutboxStore } from "../db/outbox.store.js";
import { AUTOMATION_SCHEDULE_JOB_KIND, listEnabledRules } from "../modules/automation/index.js";
import { CalendarModule, CalendarService } from "../modules/calendar/index.js";
import { FileModule, PREVIEW_JOB_TOPIC, PreviewService } from "../modules/file/index.js";
import { NOTIFY_MESSAGE_TOPIC, NotifyModule, NotifyService } from "../modules/notify/index.js";
import { LogOutboxAlertSink, OUTBOX_ALERT_SINK } from "./alert.js";
import { AutomationSubjectReader } from "./automation-subjects.js";
import { createAutomationScheduleHandler, createRuleEventConsumers, type AutomationWiringDeps } from "./automation-wiring.js";
import { OUTBOX_POLICIES, OUTBOX_REGISTRY, OutboxDispatcher } from "./dispatcher.js";
import type { OutboxTopicHandler } from "./handler.js";
import { resolveOutboxPolicies } from "./policy.js";
import { OutboxAlertProbe } from "./probe.js";
import { OutboxRetention } from "./retention.js";
import { JOBS_REGISTRY, JobScheduler, type OutboxJobHandler } from "./scheduler.js";

/** 规则接线日志（Nest Logger：产出 / 跳过 / 渠道留痕与 worker 日志同管道）。 */
const wiringLogger = new Logger("AutomationWiring");

/**
 * Outbox worker 运行时（S7-1）：dispatcher（领取 / 消费 / 重试 / dead）+ 告警探针 + done 行保留期清理；
 * S7-3 增补调度器（jobs 表：cron 领取 / last_run_at 补发 / 单活 advisory lock · JobScheduler）；
 * S7-4 增补规则接线（AUTOMATION_WIRING_ENABLED）：RULE_EVENT_TOPICS 事件消费 + automation-schedule.job 生产者
 * （automation 引擎 → notify.message 产出；非 inbox 渠道不产行，见 automation-wiring.ts）。
 * 只装配在 worker 进程（api 不消费）。消费 / 生产注册表都在此组装（**加项即可**，dispatcher / scheduler 不感知业务）：
 * 事件消费当前有 preview.job（受 PREVIEW_JOB_ENABLED 开关）、notify.message（S7-4 站内信投递，受
 * NOTIFY_DELIVERY_ENABLED 开关）与规则事件主题（受 AUTOMATION_WIRING_ENABLED 开关）；
 * 调度生产者当前有 automation-schedule.job（同上开关；关闭 = 「只存不跑」排障态）。
 */
@Module({})
export class OutboxModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: OutboxModule,
      imports: [FileModule, NotifyModule, CalendarModule],
      providers: [
        OutboxStore,
        JobsStore,
        ClockService,
        AutomationSubjectReader,
        { provide: OUTBOX_ALERT_SINK, useClass: LogOutboxAlertSink },
        { provide: OUTBOX_POLICIES, useFactory: () => resolveOutboxPolicies(env) },
        {
          provide: OUTBOX_REGISTRY,
          useFactory: (
            previews: PreviewService,
            notify: NotifyService,
            subjects: AutomationSubjectReader,
            clock: ClockService,
            calendar: CalendarService,
            database: DatabaseService,
          ) => {
            const registry = buildRegistry(env, previews, notify);
            if (env.AUTOMATION_WIRING_ENABLED === "true") {
              const deps = automationWiringDeps(env, subjects, clock, calendar, database);
              for (const [topic, handler] of createRuleEventConsumers(deps)) {
                registry.set(topic, handler);
              }
            }
            return registry;
          },
          inject: [PreviewService, NotifyService, AutomationSubjectReader, ClockService, CalendarService, DatabaseService],
        },
        {
          provide: JOBS_REGISTRY,
          useFactory: (
            subjects: AutomationSubjectReader,
            clock: ClockService,
            calendar: CalendarService,
            database: DatabaseService,
          ) => buildJobsRegistry(env, subjects, clock, calendar, database),
          inject: [AutomationSubjectReader, ClockService, CalendarService, DatabaseService],
        },
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
 * AUTOMATION_WIRING_ENABLED=false → 空表 = 「只存不跑」排障态（jobs 行不领取、窗口不推进）。
 */
function buildJobsRegistry(
  env: Env,
  subjects: AutomationSubjectReader,
  clock: ClockService,
  calendar: CalendarService,
  database: DatabaseService,
): Map<string, OutboxJobHandler> {
  const registry = new Map<string, OutboxJobHandler>();
  if (env.AUTOMATION_WIRING_ENABLED === "true") {
    registry.set(AUTOMATION_SCHEDULE_JOB_KIND, createAutomationScheduleHandler(automationWiringDeps(env, subjects, clock, calendar, database)));
  }
  return registry;
}

/** 接线装配依赖：主体读取（读库）+ 引擎规则来源 + 产出落点（appendOutboxIfAbsent）+ 时钟 / 顺延设置。 */
function automationWiringDeps(
  env: Env,
  subjects: AutomationSubjectReader,
  clock: ClockService,
  calendar: CalendarService,
  database: DatabaseService,
): AutomationWiringDeps {
  return {
    env,
    subjects,
    append: appendOutboxIfAbsent,
    db: database.db,
    rules: listEnabledRules,
    now: () => clock.now(),
    shift: () => calendar.getSettings(),
    logger: wiringLogger,
  };
}