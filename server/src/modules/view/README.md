# view 模块（M2-06 首刀 · 视图（个人 / 公共） · A1-03 · Push 168）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain · 已登记 check-boundaries 的 DOMAIN_MODULES） |
| 职责 | 保存视图：个人 / 公共视图 CRUD（视图内容 = 筛选条件 + 列配置 + 排序 + 分组方式；仅保存配置、不复制数据） |
| 主责 | wmj（团队分工 §2） |
| 对外接口 | `ViewService`（`index.ts` 出口） |

## 本切片交付（第一刀 · Push 168）

- **契约**：`shared/src/modules/views.ts` —— `VIEW_SCOPES`（personal / public）、`SavedView`（ownerId / ownerName / scope / name / filters / columns / sort / grouping / isDefault + 时间戳）、`ViewFilterValue`（string / number / boolean / string[] / null）+ `ViewFilters`（最多 30 键 · superRefine 硬顶）/ `ViewColumns`（最多 60 列）/ `ViewSort` / `ViewGrouping`、`ViewCreateBody` / `ViewUpdateBody`（局部更新，空更新 400）/ `ViewDeleteResponse`；`shared/src/openapi.ts` 新增 `GET|POST /api/v1/views`、`PATCH|DELETE /api/v1/views/{id}`（tags = views）。
- **数据面（迁移 `0037`）**：`project_views`（`owner_id` → users 级联删；`scope` CHECK；`name` btrim 1~50 CHECK；`filters` / `columns` jsonb 形状 CHECK；`sort` / `grouping` jsonb；`is_default`；部分唯一索引 `uq_project_views_owner_default (owner_id) where is_default`；`ix_project_views_owner_updated` / `ix_project_views_scope_updated`）；Drizzle `server/src/db/schema/views.ts` 对齐。
- **读面**：`GET /api/v1/views?scope=`（缺省 = 我的个人视图 + 全部公共视图；个人在前 → `updatedAt` 降序 → id 升序；随行 `ownerName`）。
- **写面**：`POST`（201；`isDefault` 置位时同事务清掉本人其它默认）、`PATCH /{id}`（局部更新；空更新 400）、`DELETE /{id}`（物理删，响应 `{ id, deleted: true }`）。
- **归属规则**：个人视图他人改 / 删 = 404（不可见防 IDOR）；公共视图非创建者改 / 删 = 403（可见但无写权）。
- **鉴权与留痕**：读 = `SessionGuard`、写 = `SessionGuard + CsrfGuard`；无功能权限键、不写审计、无乐观锁（个人界面配置、单写者 —— 先例 `user_preferences` · Push 169）。
- **差异登记**：① 公共视图「共享给指定角色」（A1-03）未做 —— 一期公共视图 = 全员可见、创建者可改；② 列键 / 排序键 / 分组键 / 筛选键均为字符串（≤ 40 字），白名单由目标列表（任务表 / 项目列表）维护；③ 视图应用（打开视图实时反映数据）为前端行为，随 M2-07（px 线）。
- **测试**：`server/test/view.test.ts`（7 例：清单范围 / 创建与默认互斥 / 局部更新与空更新 400 / 归属 404 与 403 / 物理删 / 名称收敛）＋ `schema-literals-parity.test.ts`（`VIEW_SCOPES` ↔ 库侧取值）；真机回放见 `server/scripts/m2-06-replay.mjs` V1 ~ V11（CI database job 执行）。
- **口径修订登记**：库列名 / 契约字段 `grouping`（原 `group`，避 PG 保留字）—— 技术设计v0.3 §3.1 以本刀为准；「共享给指定角色」未做已登记差异。
