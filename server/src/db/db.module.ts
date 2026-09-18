import { Global, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

/** 平台模块：PG 连接对外只暴露 DatabaseService（repository 层用）。 */
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
