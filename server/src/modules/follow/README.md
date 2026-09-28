# follow 模块（M2-06 首刀 · 关注订阅 · A1-15 · Push 168）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain · 已登记 check-boundaries 的 DOMAIN_MODULES） |
| 职责 | 关注订阅：关注 / 取关 / 批量 / 我的关注清单（关注关系单独存储，不作为任务 / 项目字段） |
| 主责 | wmj（团队分工 §2） |
| 对外接口 | `FollowService`（`index.ts` 出口） |

## 本切片交付（第一刀 · Push 168）

- **契约**：`shared/src/modules/follows.ts` —— `FOLLOW_OBJECT_TYPES`（project / task）、`FollowItem`（objectType / objectId / projectId / projectCode / name / createdAt）、`FollowListQuery`（objectType / objectId / projectId 过滤）、`FollowCreateBody` / `FollowCreateResponse`（`created` 标记 —— 新建 201 / 已关注 200）、`FollowDeleteResponse`、`FollowBatchBody`（1 ~ 50 条）+ `FollowBatchResponse`（followed / unfollowed / unchanged / failures[]；失败 code 仅 `not_found`）；`shared/src/openapi.ts` 新增 `GET|POST /api/v1/follows`、`POST /api/v1/follows/batch`、`DELETE /api/v1/follows/{objectType}/{objectId}`（tags = follows）。
- **数据面（迁移 `0037`）**：`follows`（`user_id` → users 级联删；`object_type` CHECK（project / task）；`object_id` 多态 —— 不设外键，目标硬删由服务端按关系键清行（项目硬删 15 步已含 follows 清理）；`uq_follows_user_object` 用户 × 对象唯一；`ix_follows_object` / `ix_follows_user_created`）；Drizzle `server/src/db/schema/follows.ts` 对齐。
- **目标口径**：目标必须可见且未删除（不存在 / 已删 / 不可见统一 404，防 IDOR —— 经 `PermissionService.resolveProjectAccess`）；**归档项目不可新关注**（404，ADR-027 冻结语义延伸），已有关注行保留；项目 / 任务两族混用同一关系表，`projectId` 为任务所属项目。
- **读面**：`GET /api/v1/follows` —— 我的关注清单（createdAt 降序 → id 升序；随行 `projectCode` / `name`；不可见或已删目标不返回）。
- **写面**：`POST /api/v1/follows`（幂等 —— `created=true` 201 / 已关注 `created=false` 200；并发撞唯一键走重试或读取既有行）；`DELETE /api/v1/follows/{objectType}/{objectId}`（按关系键物理删、不校验目标存在；未关注 = 404）；`POST /api/v1/follows/batch`（单事务逐条独立，整体 200；取关不存在的行 = `unchanged`）。
- **鉴权与留痕**：读 = `SessionGuard`、写 = `SessionGuard + CsrfGuard`；无功能权限键、不写审计（幂等关系行 —— 先例 `user_preferences` · Push 169）。
- **差异登记**：① 通知投递（状态变更 / 延期 / 变更生效实时提醒）随 M5 通知切片（lan 线）；② 工作台关注动态流（A6-08）随工作台二刀；③ 关注清单 / 批量入口的前端接线随 M2-07（px 线）；④ 关注对象一期只含 project / task（干系人 / 文件等随后续卡片）。
- **测试**：`server/test/follow.test.ts`（7 例：幂等 create / 清单过滤 / 批量逐条计数 / 取关 404 / 归档与越权 404 / 硬删清理）＋ `schema-literals-parity.test.ts`（`FOLLOW_OBJECT_TYPES` ↔ 库侧取值）；真机回放见 `server/scripts/m2-06-replay.mjs` F1 ~ F11（CI database job 执行）。
