import { Global, Module } from "@nestjs/common";
import { AppConfig } from "../config/config.module.js";
import { ObjectStorage } from "./object-storage.js";
import { createS3ObjectStorage } from "./s3-object-storage.js";

/**
 * 存储基础设施模块（与 common / db / config 同级；不依赖任何业务模块）。
 * 全局导出 ObjectStorage 端口：消费方只依赖端口，换实现（SeaweedFS / 云 OSS）不改调用代码。
 */
@Global()
@Module({
  providers: [
    {
      provide: ObjectStorage,
      useFactory: (config: AppConfig): ObjectStorage => createS3ObjectStorage(config.env),
      inject: [AppConfig],
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
