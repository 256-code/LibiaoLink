import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { ViewController } from "./view.controller.js";
import { ProjectViewRepository } from "./view.repository.js";
import { ViewService } from "./view.service.js";

/**
 * view 模块（领域 · M2-06 首刀 · A1-03）：保存视图（个人 / 公共）—— 视图 = 仅保存配置（筛选 + 列 + 排序 + 分组）。
 * 依赖：identity（会话 / CSRF / 当前用户）。不做功能权限位、不写审计（用户界面配置，先例 user_preferences）。
 * 已登记 check-boundaries 的 DOMAIN_MODULES（view 属领域模块，平台模块不得反依赖）。
 */
@Module({
  imports: [IdentityModule],
  controllers: [ViewController],
  providers: [ProjectViewRepository, ViewService],
  exports: [ViewService],
})
export class ViewModule {}
