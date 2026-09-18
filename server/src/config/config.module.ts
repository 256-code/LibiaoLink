import { Global, Module, type DynamicModule } from "@nestjs/common";
import type { Env } from "./env.js";

export class AppConfig {
  constructor(readonly env: Env) {}
}

/** 全局配置模块：env 由入口（api / worker）加载后注入，模块内只读。 */
@Global()
@Module({})
export class AppConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: AppConfig, useValue: new AppConfig(env) }],
      exports: [AppConfig],
    };
  }
}
