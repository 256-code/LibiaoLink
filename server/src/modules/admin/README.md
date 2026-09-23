# admin 模块（h7 · S6·admin：字典 C9 与审计留痕）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 字典读下发与维护（C9）、操作审计留痕与检索（C7）；备份恢复 / 运维页仍未落地 |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | DictService（list / get / createItem / updateItem）、AuditService（record / recordDenied / list）、纯函数（audit.rules.ts：stableValue / diffRecords）、HTTP：GET /api/v1/dicts、GET /api/v1/dicts/{type}、POST /api/v1/dicts/{type}/items、PATCH /api/v1/dicts/{type}/items/{code}、GET /api/v1/audit-logs |

## 已实现（h7）

- 迁移 `database/migrations/0013_admin_dict_audit.sql`：`dict_types`（类型注册表）+ `dict_items`（条目，`uq_dict_items_type_code` 同类型内码唯一）+ `audit_logs`（追加写）。防篡改：库级收回 api 角色对 audit_logs 的 UPDATE / DELETE（`database/roles/0001_roles.sql` 每次执行显式重放；migrator 保留全量）。
- 字典读（C9-01 / C9-03）：GET /api/v1/dicts 与 /{type}，默认只回 `enabled=true`；`includeDisabled=true`（管理端维护停用项）需 dict.manage；未知类型 404；响应 `updatedAt` 取类型版本（条目变更 touchType），供前端做缓存刷新。
- 字典写（C9-02，2026-09-23 修订）：POST `{type}/items` 按类型分权 —— **region 登录即可**（全站共享的公共标签；重复码仍 409）、其余类型 dict.manage；PATCH（改名 / 排序 / 停用）仍仅 dict.manage（治理权不放开）；同类型内码唯一（重复 409 DICT_ITEM_EXISTS）；「删除」= 停用（`enabled=false`，无物理删除；停用不影响存量数据按原码 / 原名渲染）；响应为更新后的整个字典（前端直接替换缓存）。
- 字典类型固定为契约枚举（region / projectType，`DICT_TYPES`）；阶段与成果文件类型走契约枚举、不下发。种子 `database/seeds/dicts.mjs`（#5）：region 8 项、projectType 3 项（metadata 携带主题色 accent / accentText），幂等且不覆盖库内已修订值。
- 审计写入（C7-01 / C7-02）：`record()` 由业务用例在**同一事务**内调用，落「谁 / 何时 / 对什么 / 从什么改成什么」（`changes` 字段级 before / after；null = 无字段级变化）；操作人姓名快照（60s 缓存）保证改名后仍可追溯。
  - h7 已接线写路径：项目创建 / 修改 / 归档（project）、名册增删（project_member）、任务创建 / 修改 / 进度（task）、节点新增 / 删除 / 完成与阶段推进 / 回退（node / stage）；门禁拒绝在 catch 内补写 `result=failed`。
- 越权留痕（C7-03）：全局异常过滤器（`common/errors/api-error.filter.ts`）在 403 与项目域 404 时经 `AUDIT_SINK` 令牌调用 `recordDenied()`（异步、失败只告警、不影响响应），落 `action=deny` + `result=denied`；路径 → 对象解析在 `common/audit/audit-path.ts`（纯函数，单测直测）。告警推送（企微）随 M5 通知模块。
- 审计检索（C7-04 服务端）：GET /api/v1/audit-logs，仅 audit.view；按 objectType + objectId（按对象）、actorId（按人）、action / result / projectId / 时间区间筛选，occurredAt 降序（同毫秒按 id 降序）；`result=denied` 即越权尝试筛法。页面与导出随 u12（px 线）。
- 权限：`dict.manage` / `audit.view` 入契约 `PERMISSION_KEYS`（现 26 键）；种子 `database/seeds/role-permissions.mjs` 给 admin 补两键（admin 26 键 = 契约全量）。

## 与其它模块的边界

- 依赖方向：admin → identity（会话 / CSRF 守卫）、permission（dict.manage / audit.view 的统一判定出口）；平台模块不反依赖业务模块 —— 业务模块反向 import 本模块 `AuditService` 注入留痕；common 不依赖 modules（越权留痕经 `AUDIT_SINK` 令牌 + useExisting 接线）。
- 审计仓储直读 `users.displayName` 取操作人姓名快照（platform → identity 表的只读引用，不经 identity 业务出口；check:boundaries 无违规）。
- 蓝图（blueprint）写路径未接线：`assertAdmin` 的 403 会由全局过滤器记 denied；蓝图字段级留痕随蓝图维护卡片补。

## 差异与后续（待复核）

1. 前端仍硬编码 PROJECT_TYPES / 主题色：改读字典随 u12（前端接线，px 线；本模块只交付服务端与种子）。
2. 字典类型目录固定 region / projectType（契约 `DICT_TYPES`）；新增类型 = 契约 + 迁移 / 种子同步。
3. 审计页面 / 导出、高风险导出重认证随 u12；告警推送（企微）随 M5 通知模块（当前 = `result=denied` 行 + 服务端 warn 日志）。
4. 保留 ≥6 个月（C7-05）：库级已禁删；按月清理未实现，由运维 / 迁移器按月执行。
5. 备份恢复 / 运维页（g4 占位时的另一半职责）未落地，随对应卡片。

## 测试

- `server/test/admin-audit.test.ts`（15 例）：diff / 稳定序列化、路径解析与越权判定、DictService 停用替代删除 / 码唯一 / 无变更不留痕、AuditService 写入 / 检索 / 人员快照 / 失败吞错。
- 全量：`vitest run` 14 文件 184 例全过；`check:db-schema` 24 表 · 246 列 · 69 索引/唯一 · 64 CHECK；`check:permission-matrix` 6 角色 / 73 条目 / 26 键；`check:boundaries` 102 文件 / 377 依赖 / 0 违规；`tsc --noEmit` 与 `nest build` 通过。
