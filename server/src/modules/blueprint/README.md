# blueprint 模块（h3 · S6·blueprint/node：蓝图版本化 / 校验 / 导入导出）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 蓝图（按项目类型各一份 + default 兜底、版本化）、校验、导入 / 导出、发布 |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | BlueprintService（getView / saveDraft / publish / exportBlueprint / importBlueprint / getPublishedForProject / getVersionForProject / findNodeTemplate）；HTTP：GET / PUT /api/v1/blueprint、POST /api/v1/blueprint/publish、GET /api/v1/blueprint/export、POST /api/v1/blueprint/import |

## 已实现（h3 · Push 83）

- 契约：`shared/src/modules/flow.ts`（Blueprint* 族 / `BlueprintQuerySchema`，OpenAPI tags=flow）。
- 数据面（迁移 `0011_blueprints.sql` + Drizzle `src/db/schema/blueprint.ts`）：`blueprints`（`project_type` 唯一、草稿 `draft_payload`、`published_version`、乐观锁 `version`）与 `blueprint_versions`（版本 `payload` + 校验 `issues`，`unique(blueprint_id, blueprint_version)`）——「导入即快照」的版本来源，已生成项目不受后续蓝图变更影响。
- 组织口径（ADR-019）：按项目类型各一份（`projectType` 缺省 `default`）+ default 兜底。
  - 读 / 写（`GET` / `PUT` / `publish` / `export` / `import`）按 `projectType` **精确取**：该项目类型尚未建档 → 404（`PUT` 首次保存即建档，不 404）；
  - **兜底只发生在项目侧解析**：`getPublishedForProject` / `getVersionForProject` / `findNodeTemplate` 一律「先该项目类型、后 default」（default 行不存在或未发布 = 不可用）。
- 校验（`blueprint.validation.ts`，纯函数、不连库）：schema（`schemaVersion=1`）→ 阶段 `key` 唯一 + `seq` 递增 → 节点 `key` 全局唯一 + `seq` 递增 → 约束 `docType` 必须命中成果文件字典。失败分歧：schema / 结构类 → 422 `BLUEPRINT_SCHEMA_INVALID`；引用类（docType / 引用未知）→ 422 `BLUEPRINT_REF_UNKNOWN`；明细逐条进 `details[]`（`code=blueprint_invalid`）。
- 发布（`POST /blueprint/publish`）：草稿与已发布 payload 做 `sameBlueprint`（**键序归一化后比较** —— PG jsonb 会重排键，直比会误判「有变更」而虚增版本）；无变更原样返回（版本不递增，幂等）；有变更写新版本 `published_version + 1`，并把草稿回写为归一化后的 payload（否则下一次发布仍会误判）。
- 导入 / 导出：导出优先已发布版本（未发布回落草稿）；导入 = 校验后存草稿（复用 `saveDraft`，重复导入幂等）。自建格式 round-trip 无损（本地实机：导出 → 导入 → 再导出字节级一致）。
- 权限：写接口（`PUT` / `publish` / `import`）要求功能权限 `blueprint.manage`（已随 h6 由「角色码 = admin」改为键位判定；种子 #6b 只把该键授予系统管理员，故实际口径不变，语义改由角色矩阵决定）；读接口登录即可。
- 种子：`database/seeds/blueprint.mjs`（种子 #7）落 default 模板（9 阶段 19 节点 + 版本 1）；节点清单待业务补全，库内已修订时种子不覆盖（可重跑）。
- 单测：`test/blueprint-validation.test.ts`（7 例，纯函数：schema / key 唯一 / seq 递增 / docType 引用 / 引用未知分流）。

## 边界与后续

- 项目升级到新蓝图版本（重生成快照）不在 h3：随 M6 归档 / 升级口径（当前「导入即快照」，蓝图变更不影响已生成项目）。
- 模板管理员角色细分、审批流：键位已随 h6 就绪（`blueprint.view` / `blueprint.manage`），角色细分与界面随 u 系列。
- 蓝图审计留痕（谁改了什么）：随 h7 `audit_logs`（当前只有 outbox 业务事件与库内 `updated_by` / `published_by`）。