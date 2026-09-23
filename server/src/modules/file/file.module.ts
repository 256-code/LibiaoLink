import { Module } from "@nestjs/common";
import { ClockService } from "../../common/clock/clock.service.js";
import { OutboxStore } from "../../db/outbox.store.js";
import { AdminModule } from "../admin/index.js";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { ChangeRequestController } from "./change.controller.js";
import { ChangeRequestLibraryController } from "./change-library.controller.js";
import { ChangeService } from "./change.service.js";
import { FileController } from "./file.controller.js";
import { FileLibraryController } from "./file-library.controller.js";
import { FileRepository } from "./file.repository.js";
import { FileService } from "./file.service.js";
import { PreviewConverter } from "./preview.converter.js";
import { PreviewReadService } from "./preview-read.service.js";
import { PreviewRepository } from "./preview.repository.js";
import { PreviewService } from "./preview.service.js";

/**
 * file 模块（平台 · S7·file · M4）：文件与版本、上传管道、定档锁版、变更（申请即通过）、回收站。
 * 依赖：identity（会话 / CSRF 守卫）、permission（file.upload / file.download 判定出口）、admin（AuditService 同事务留痕）、
 * storage（ObjectStorage 端口，@Global，经端口调用不直接碰 S3 SDK）。
 * 已落：M4-01 上传管道、M4-02 版本 / 定档 / 回溯 / 回收站、M4-03 文件库查询 + 多态关联（file_links）、
 * M4-04 变更写入 + 读面（变更记录列表 / 详情）、M4-05 预览（数据层 + 转换队列：outbox `preview.job`
 * 领取器 / 转换器客户端 / 三元组幂等 / 失败降级）+ 读 API（三态 + 短时签名 + 仅 ready 写审计）+ 产物清理（彻底删除 / 到期清理按 content_hash 反查引用：有引用归属转移、无引用清对象）。
 */
@Module({
  imports: [IdentityModule, PermissionModule, AdminModule],
  controllers: [FileController, FileLibraryController, ChangeRequestLibraryController, ChangeRequestController],
  providers: [
    FileRepository,
    FileService,
    ChangeService,
    ClockService,
    // M4-05c 预览转换队列：worker 领取 outbox `preview.job` 时用（api 侧只实例化、不消费）。
    OutboxStore,
    PreviewRepository,
    PreviewConverter,
    PreviewService,
    // M4-05 读 API：api 侧三态 + 短时签名 + 仅 ready 写审计（worker 侧队列见 PreviewService）。
    PreviewReadService,
  ],
  exports: [FileService, ChangeService, PreviewService],
})
export class FileModule {}
