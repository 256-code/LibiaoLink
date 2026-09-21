import { Module } from "@nestjs/common";
import { ClockService } from "../../common/clock/clock.service.js";
import { AdminModule } from "../admin/index.js";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { FileController } from "./file.controller.js";
import { FileLibraryController } from "./file-library.controller.js";
import { FileRepository } from "./file.repository.js";
import { FileService } from "./file.service.js";

/**
 * file 模块（平台 · S7·file · M4）：文件与版本、上传管道、定档锁版、变更（申请即通过）、回收站。
 * 依赖：identity（会话 / CSRF 守卫）、permission（file.upload / file.download 判定出口）、admin（AuditService 同事务留痕）、
 * storage（ObjectStorage 端口，@Global，经端口调用不直接碰 S3 SDK）。
 * 已落：M4-01 上传管道、M4-02 版本 / 定档 / 回溯 / 回收站、M4-03 文件库查询 + 多态关联（file_links）；M4-04 / M4-05 待接入。
 */
@Module({
  imports: [IdentityModule, PermissionModule, AdminModule],
  controllers: [FileController, FileLibraryController],
  providers: [FileRepository, FileService, ClockService],
  exports: [FileService],
})
export class FileModule {}
