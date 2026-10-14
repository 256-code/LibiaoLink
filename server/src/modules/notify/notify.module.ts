import { Module } from "@nestjs/common";
import { ClockService } from "../../common/clock/clock.service.js";
import { AppConfig } from "../../config/config.module.js";
import { DatabaseService } from "../../db/database.service.js";
import { PermissionModule } from "../permission/index.js";
import { IdentityModule } from "../identity/index.js";
import { NotifyAppRepository } from "./notify.app.repository.js";
import { NotifyAppService } from "./notify.app.service.js";
import { NotifyDmRepository } from "./notify.dm.repository.js";
import { NotifyDmService } from "./notify.dm.service.js";
import { NotifyGroupRepository } from "./notify.group.repository.js";
import { NotifyGroupService } from "./notify.group.service.js";
import { NotifyController } from "./notify.controller.js";
import { NotifyRepository } from "./notify.repository.js";
import { NotifyService } from "./notify.service.js";
import { NotifyStreamPublisher } from "./notify.stream.publisher.js";
import { NotifyStreamService } from "./notify.stream.service.js";
import { ResourceChangePublisher } from "./resource-change.publisher.js";
import { RESOURCE_CHANGE_SINK } from "../../common/realtime/resource-change.js";
import { createWecomAibotClientFromEnv, WecomAibotClient } from "./wecom.aibot.js";
import { createWecomClientFromEnv, WecomClient } from "./wecom.client.js";
import { PgRateWindowStore } from "./wecom.rate.pg.js";

/**
 * notify 模块（平台 · S7-4 · j1 / M5-04 首刀）：站内信投递内核 —— outbox `notify.message` 消费 +
 * 合并（同人同时段）+ 免打扰（次日补发）+ 每人每日上限 + 收件箱读面 + 全量留档 + 通知偏好。
 * 依赖：identity（会话 / CSRF / 当前用户）—— 个人资源不做功能权限位、不写审计（先例 user_preferences / project_views）。
 * 装配：api 侧挂控制器（AppModule）；worker 侧经 OutboxModule 的消费注册表 + entry/worker.ts 的 flush 循环。
 * 实时流（S8-3 · M5-04-1）：`NotifyStreamService` 惰性 LISTEN（首个 SSE 连接建立才启动 —— worker 不建连接 → 不启动）；
 * `NotifyStreamPublisher` 供投递 / 标记在事务内 pg_notify（worker 写方同样生效，api 各实例桥到本地连接）。
 * 群通道（M5-03-2 接线段）：`NotifyGroupService` 消费 `notify.group`（worker 注册表）+ 回调 ingest；
 * `WecomAibotClient` 由工厂装配（api 侧构造不建连；worker 侧入口显式 `start()`）。
 * 应用消息（M5-03-3）：`NotifyAppService` 消费 `notify.message` 的 channel=wecom_app 分支（OutboxModule 路由）；
 * `WecomClient`（自建应用）由工厂装配，限速计数同走 `PgRateWindowStore`。
 * 单聊 aibot（M5-03-5-3 实现段）：`NotifyDmService` 消费 `notify.message` 的 channel=wecom_aibot 分支
 * （发送面 = 长连接 `sendUserMarkdown` · 限速 kind `single` · 激活表读 / 回填 · 846607 分流 + C5-04 降级；
 * 生产路由 / 产出接线 / worker 回调分流随 M5-03-5-4 —— 见执行计划 §4）。
 */
@Module({
  imports: [IdentityModule, PermissionModule],
  controllers: [NotifyController],
  providers: [
    NotifyRepository,
    NotifyService,
    NotifyStreamPublisher,
    NotifyStreamService,
    ResourceChangePublisher,
    { provide: RESOURCE_CHANGE_SINK, useExisting: ResourceChangePublisher },
    NotifyGroupRepository,
    NotifyGroupService,
    NotifyAppRepository,
    NotifyAppService,
    NotifyDmRepository,
    NotifyDmService,
    PgRateWindowStore,
    {
      // 群通道长连接客户端（M5-03-2 接线段）：构造不建连（start() 由 worker 启动流程显式调用）；
      // 限速计数 = PgRateWindowStore（DB 计数，跨进程共享配额 —— 差异登记①收口）。
      provide: WecomAibotClient,
      useFactory: (config: AppConfig, database: DatabaseService) =>
        createWecomAibotClientFromEnv(config.env, { store: new PgRateWindowStore(database) }).aibot,
      inject: [AppConfig, DatabaseService],
    },
    {
      // 自建应用消息客户端（M5-03-3）：token 单飞缓存 + app 限速桶；构造无副作用（无后台任务）。
      provide: WecomClient,
      useFactory: (config: AppConfig, database: DatabaseService) =>
        createWecomClientFromEnv(config.env, { store: new PgRateWindowStore(database) }).client,
      inject: [AppConfig, DatabaseService],
    },
    ClockService,
  ],
  exports: [NotifyService, NotifyGroupService, NotifyAppService, NotifyDmService, WecomAibotClient, WecomClient, RESOURCE_CHANGE_SINK],
})
export class NotifyModule {}
