# database/ · 数据库基线（g3 · S5）

PostgreSQL 基线的唯一来源：只追加的迁移脚本、最小权限角色、带 advisory lock 与漂移校验的迁移器。
对应《技术设计v0.2-架构与数据模型.md》§2.3（DDL 草案）与 `CONTRIBUTING.md` §14（生成物与不可变历史）；
选型口径见 `docs/adr/` ADR-004（PostgreSQL + Drizzle）与 ADR-013（部署）。

## 目录结构

| 路径 | 用途 |
|---|---|
| `migrations/0001_baseline.sql` | 一期基线 DDL：10 张表 + 索引 + CHECK 约束 + 关系外键（v0.2 §2.3 落地；人员字段为旧口径，由 0002 收敛） |
| `migrations/0002_projects_manager.sql` | 项目级人员字段收敛（v0.2.2 §2.3）：`projects` 删 `owner_id`、`manager_id` 改必填、`ix_projects_facets` 改用 `manager_id`（含空值回填） |
| `migrations/0003_projects_seq_no.sql` | 项目序号（v0.2.3 §2.3）：`projects.seq_no` 新增全库唯一序号列（序列分配 + 存量按 created_at / code 回填 1..N + 唯一 / 正数约束） |
| `migrations/0004_identity.sql` | 身份与会话（v0.2.5 §2.3；ADR-010）：`users`（SSO 归一化用户）+ `sessions`（会话 Cookie 值只存 sha256 哈希；id_token 仅用于单点登出） |
| `migrations/0005_file_lifecycle.sql` | 文件生命周期与分片上传（v0.2 §5.1-5.3 / §11.1-11.2）：`files` 增 `finalized_at/by`、`recycled_at/by/from_status`、`purge_after`（回收站到期）+ `upload_sessions`（分片直传会话） |
| `migrations/0006_idempotency_keys.sql` | 写接口幂等（v0.2 §1.3 / §11.1 platform）：`idempotency_keys`（只存 key 哈希；作用域 = 调用方 + 接口指纹） |
| `migrations/0007_identity_org.sql` | 身份 / 组织与角色（h1 · v0.2 §4.1 / §11.1；ADR-010 / ADR-011）：`departments`（部门树）+ `roles`（数据范围）+ `role_permissions`（功能权限位结构）+ `user_roles`（绑定） |
| `migrations/0008_identity_removed.sql` | 离职回收软删标记（h1 收口 · 接入标准第五部分）：`users.removed_at`（delete 置位 / enable 清空；不物理删行） |
| `migrations/0009_projects_soft_delete.sql` | 项目软删（h2 · M2-01 / A5）：`projects.deleted_at` / `deleted_by` + 活跃行局部索引 `ix_projects_active_updated`（列表 / 详情 / facets 统一过滤软删行） |
| `migrations/0010_project_members.sql` | 项目成员名册（h2 · M2-05）：`project_members`（`project_id` / `user_id` / `role_in_project` / `joined_at`；联合唯一 + `user_id` 反查索引）——记录级权限（非成员 404）与「我参与的项目」的来源 |
| `migrations/0011_blueprints.sql` | 蓝图与版本（h3 · M2-02；ADR-019）：`blueprints`（`project_type` 唯一 + 草稿 `draft_payload` + `published_version` + 乐观锁 `version`）与 `blueprint_versions`（版本 payload + 校验 issues，`unique(blueprint_id, blueprint_version)`）——「导入即快照」的版本来源 |
| `migrations/0012_project_stages_tracking.sql` | 阶段推进 / 回退留痕（h3 · M2-03；ADR-023）：`project_stages` 增 `advanced_at` / `advanced_by` / `rolled_back_at` / `rolled_back_by` / `rollback_reason` |
| `migrations/0013_admin_dict_audit.sql` | 字典与审计（h7 · C9 / C7）：`dict_types`（类型注册表）+ `dict_items`（条目，`uq_dict_items_type_code` 同类型内码唯一）+ `audit_logs`（追加写；`changes` / `metadata` jsonb + 按对象 / 操作人 / 项目 / 时间索引；api 角色被收回 UPDATE / DELETE） |
| `migrations/0014_work_calendar.sql` | 工作日历（h8 · D5）：`calendar_days`（只存例外：holiday 放假 / makeup_workday 调休上班 + name / note + `updated_by` + 4 CHECK + (day_type, date) 索引）与 `calendar_settings`（单行顺延配置：`reminder_shift_enabled` / `shift_direction` + 2 CHECK；迁移即建默认行） |
| `migrations/0015_task_order_and_nullable_scope.sql` | 任务落库口径（w2 · A15 / A18 / A19 / A20）：`tasks` 新增 `sort_index`（组内位次，0 起密集；存量按迁移前默认读序 `planned_start asc nulls last, created_at, id` 分区回填 → 迁移前后读序一致；默认 0 + `ck_tasks_sort_index` + `ix_tasks_project_stage_order (project_id, stage_key, sort_index)`）、`stage_key` / `owner_id` 由 not null 放宽为可空（「未分组」/「待分配」是合法状态） |
| `seeds/README.md` | 种子数据规格（M0-03 · Push 73）：可重跑、幂等、与迁移分离 |
| `seeds/roles.mjs` / `seeds/index.mjs` | 种子 #6a：一期六个内置角色（h1 · Push 74）；index 为按序注册表，新种子追加到末尾 |
| `seeds/blueprint.mjs` | 种子 #7：default 蓝图模板（9 阶段 19 节点 + 版本 1，h3 · Push 83）；节点清单待业务补全，库内已修订时不覆盖 |
| `seeds/role-permissions.mjs` | 种子 #6b：六角色 × 权限位矩阵（h6 · Push 95，h8 补 `calendar.manage`；键唯一来源 = 契约 `PERMISSION_KEYS`，移除键会删除 —— 权限吊销必须生效） |
| `seeds/dicts.mjs` | 种子 #5：地区 8 项 + 项目类型 3 项（h7 · Push 97；metadata 带 accent / accentText 主题色，幂等、不覆盖库内已修订值、不删除） |
| `roles/0001_roles.sql` | 最小权限角色（迁移器 / 应用 / 只读）+ 默认权限（幂等） |
| `scripts/migrate.mjs` | 迁移器：只追加、逐文件事务、advisory lock、checksum 漂移校验 |
| `scripts/seed.mjs` | 种子执行器（h1 · Push 74）：每个种子独立事务、`--dry-run` 全回滚、`--only=<name>`；advisory lock 20260919（与迁移器分开） |
| `package.json` / `package-lock.json` | 独立 npm 包，唯一依赖 `pg`（不引入根 package.json） |

## 角色与权限

| 角色 | 用途 | 权限 |
|---|---|---|
| `libiaolink_migrator` | 迁移专用（全库唯一有 DDL 的角色） | `public` 模式 `CREATE`；迁移产生的对象归其所有 |
| `libiaolink_api` | 应用运行 | 业务表 `SELECT/INSERT/UPDATE/DELETE` + 序列 `USAGE/SELECT`，无 DDL |
| `libiaolink_readonly` | 只读（排查 / 报表 / 核对） | 业务表 `SELECT` |

- 由数据库管理员执行一次（幂等，可重复执行）：`psql -v ON_ERROR_STOP=1 -f roles/0001_roles.sql`
- `schema_migrations`（迁移记录表）归迁移器独有，角色脚本与迁移器都会显式收回应用 / 只读角色的权限。
- 防篡改（C7-05 · h7）：`audit_logs` 对应用角色只授 `SELECT` / `INSERT` —— 迁移 0013 与 `roles/0001_roles.sql` 双处显式收回 `UPDATE` / `DELETE`（角色脚本可重复执行，每次都会重新收回，避免后续重跑把权限放开）；`libiaolink_migrator` 保留全量（保留 ≥6 个月的按月清理由运维 / 迁移器执行）。
- 新建表通过 `alter default privileges for role libiaolink_migrator` 自动授权给应用 / 只读角色，
  因此**迁移必须由 `libiaolink_migrator` 执行**（建表者决定默认权限的归属）。
- **密码不写入仓库**（CONTRIBUTING §12）：脚本以「无密码 LOGIN」创建角色（此时无法用密码登录），
  部署时由密钥库注入：`psql -c "alter role libiaolink_api password ..."`（口令来自环境变量 / 密钥管理，不落仓库）。

## 迁移命令

```bash
cd database
npm install                    # 仅首次
DATABASE_URL=postgres://libiaolink_migrator@host:5432/libiaolink node scripts/migrate.mjs
DATABASE_URL=... node scripts/migrate.mjs --dry-run   # 只列出待执行，不改库

# 种子数据（可重跑、幂等；与迁移分界见 seeds/README.md）
DATABASE_URL=... node scripts/seed.mjs                 # 全部种子
DATABASE_URL=... node scripts/seed.mjs --dry-run       # 只打印将执行的变更摘要（全部回滚）
DATABASE_URL=... node scripts/seed.mjs --only=roles    # 只跑指定种子
```

> 连接串：优先 `DATABASE_URL`；未设置时回退 `PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE`（node-postgres 约定）。

期望输出（空库）：

```
migrate: 目标 postgres://***:***@host:5432/libiaolink，迁移目录 ...
migrate: 已执行 0001_baseline.sql（xx ms）
migrate: 已执行 0002_projects_manager.sql（xx ms）
migrate: 已执行 0003_projects_seq_no.sql（xx ms）
migrate: 已执行 0004_identity.sql（xx ms）
migrate: 已执行 0005_file_lifecycle.sql（xx ms）
migrate: 已执行 0006_idempotency_keys.sql（xx ms）
migrate: 已执行 0007_identity_org.sql（xx ms）
migrate: 已执行 0008_identity_removed.sql（xx ms）
migrate: 已执行 0009_projects_soft_delete.sql（xx ms）
migrate: 已执行 0010_project_members.sql（xx ms）
migrate: 已执行 0011_blueprints.sql（xx ms）
migrate: 已执行 0012_project_stages_tracking.sql（xx ms）
migrate: 已执行 0013_admin_dict_audit.sql（xx ms）
migrate: 已执行 0014_work_calendar.sql（xx ms）
migrate: 已执行 0015_task_order_and_nullable_scope.sql（xx ms）
migrate: 完成，本次执行 15 个迁移
```

再次执行输出 `migrate: 数据库已是最新（已执行 15 个迁移，无漂移）`；随后执行种子（示例）：

```
seed: 目标 postgres://***:***@host:5432/libiaolink，种子目录 .../seeds
seed: dicts（数据字典（地区 / 项目类型 · v0.2 §2.5）） 已提交
  - typesInserted 2，typesUnchanged 0，itemsInserted 11，itemsUnchanged 0
seed: roles（角色（一期六个内置角色 · v0.2 §4.1）） 已提交
  - inserted 6，updated 0，unchanged 0
seed: role-permissions（功能权限矩阵（一期六角色 · v0.2 §4.1）） 已提交
  - inserted 74，deleted 0，unchanged 0
seed: blueprint（蓝图（默认模板 + 版本 1 · ADR-019；种子 #7）） 已提交
  - inserted 1，unchanged 0，kept 0
seed: 完成，本次执行 4 个种子
```

复跑同一条命令应零变更（`dicts` 计数不变、`roles` `unchanged 6`、`role-permissions` `unchanged 74`、`blueprint` `unchanged 1`；`--dry-run` 不改库）。

## 不变式（迁移器保证）

1. **只追加**：已执行迁移的序列必须是磁盘序列的前缀；在中间插入 / 重排就拒绝执行（退出码 1）。
2. **不可修改**：已执行迁移按内容校验和（sha256，行尾归一化后）核对，文件被改即拒绝执行。
3. **不可删除**：已记录的迁移文件缺失即拒绝执行。
4. **并发安全**：`pg_advisory_lock(20260918)` 串行化并发迁移；同一库同一时刻只有一个迁移在跑。
5. **原子性**：每个迁移文件独立事务；失败整体回滚，不落半截结构。
6. **可观测**：`schema_migrations` 记录 filename / checksum / applied_at / execution_ms。

## 规则（CONTRIBUTING §14 的落地）

- 新增结构变更 = 新增 `migrations/000N_xxx.sql`，**不要修改已合入的文件**；采用 expand / contract（先扩展、后收敛）。
- 迁移只由部署 / 运维手工触发；**应用进程不得在启动时自动迁移**（后端落地后同样适用）。
- 迁移属高风险变更（CONTRIBUTING §15）：需要另一名评审人（lan / px）批准后才能合并。
- 种子数据（字典 / 模板）走 `seeds/`，与迁移分离、可重跑（规格见 `seeds/README.md`）；CONTRIBUTING §14 的只追加约束只作用于 `migrations/`。

## 与 v0.2 §2.3 的对应

- `0001_baseline.sql` 覆盖 §2.3 全部 10 张表与索引，另补两处（文件头已注明）：
  1. 稳定枚举补 CHECK 约束（项目状态 / 阶段、节点状态、任务进度四格、文件五态、outbox 状态等）；
  2. 补齐 4 条关系外键：`file_versions.change_request_id`、`files.current_version_id`、`files.task_id`、`tasks.change_ref`。
- 人员字段口径（v0.2.2）：`0001_baseline.sql` 落库时为旧口径（`projects.owner_id` not null、`projects.manager_id` 可空、`ix_projects_facets` 用 `owner_id`）；`0002_projects_manager.sql` 收敛为 v0.2.2 §2.3 —— 删 `owner_id`、`manager_id` 改必填、索引改用 `manager_id`（先把 `manager_id` 为空的行按 `owner_id` 回填）。空库按 0001 → 0002 顺序执行后的最终结构 = v0.2.2 §2.3。
- 项目序号（v0.2.3）：`0003_projects_seq_no.sql` 新增 `projects.seq_no integer not null unique default nextval('projects_seq_no_seq')`（另加 `ck_projects_seq_no check (seq_no > 0)`），存量行按 `created_at, code` 回填 1..N，序列 `setval` 推到 `max(seq_no)+1`；口径 = 全库唯一、创建时分配、稳定不回收，与「项目编号 code」一一对应同一项目。
- 文件生命周期（v0.2 §5.1-5.3 / §11.2）：`0005_file_lifecycle.sql` 给 `files` 补定档（`finalized_at` / `finalized_by`）、回收站（`recycled_at` / `recycled_by` / `recycled_from_status`）与到期清理（`purge_after`，A4-12）；定档 / 回收站字段成对写入（CHECK 约束），`recycled_from_status` 不允许取 `recycled`。回收站 30 天保留期由应用写入 `purge_after`，到期清理任务随回收站切片落地。
- 分片上传（v0.2 §5.1 / §11.1）：`upload_sessions` 只登记元数据（目标对象键、分片大小 / 分片数、总量与哈希、有效期、`change` 意图的变更申请负载）；**`upload_parts` 不落表**（评审已定案，2026-09-18）—— 分片状态以对象存储 ListParts 为唯一真相，避免双写漂移；如后续确需落表，以新增迁移补。
- 幂等（v0.2 §1.3 / §11.1）：`0006_idempotency_keys.sql` 落 `idempotency_keys`；只存 sha256(key)，作用域 = 调用方 + 接口指纹（route），`request_hash` 防同 Key 换请求体重放，记录按 `expires_at` 清理。审计表（`audit_logs`）已随 h7 落地（0013，见下下条）。
- 枚举取值以 §2.5 字典为准（九阶段、十类成果文件、文件五态、任务基础态等）；字典全量落表随后续迁移。
- identity/org（h1 · Push 74）：`0007_identity_org.sql` 落 `departments`（`source_id` 唯一 + 父自引用 + 非自环 CHECK；不物理删除，缺失置 disabled）、`roles`（`code` 唯一 + `data_scope` 枚举 CHECK）、`role_permissions`（`模块.操作` 键格式 CHECK）、`user_roles`（联合主键 + 反查索引）；角色集为种子维护（`database/seeds/roles.mjs`），权限矩阵条目随 h6。
- identity/removed（h1 收口 · Push 78）：`0008_identity_removed.sql` 为 `users` 增 `removed_at timestamptz`（可空）。口径：内部离职回收 `POST /internal/users/delete` 置位（`status=disabled` + 撤销全部会话）、`enable` 清空；`disable` 不改动该列；用户行不物理删除（历史引用 / 审计需要，物理删除待数据留存口径确认）。
- projects/soft-delete（h2 · Push 80）：`0009_projects_soft_delete.sql` 为 `projects` 增 `deleted_at timestamptz` / `deleted_by uuid`（软删落点 + 操作人；审计留痕随 h7）与局部索引 `ix_projects_active_updated (updated_at desc) where deleted_at is null`（首页「最近活动」列表走它，且只见活跃行）；口径：`seq_no` 不回收、`code` 唯一约束保留（同编号再建仍 409 `PROJECT_CODE_EXISTS`），列表 / 详情 / facets 统一 `deleted_at is null`。
- projects/members（h2 · M2-05）：`0010_project_members.sql` 落 `project_members`（`role_in_project` 一期两值 `project_manager` / `project_member`，CHECK 约束；`uq_project_members_project_user` 保证同项目同用户唯一，支撑「添加成员」幂等 upsert；`ix_project_members_user` 供「我参与的项目」反查，h6 数据范围 involved_projects 消费）。口径：名册是记录级权限（非成员 404 语义）的唯一来源，项目软删不删名册行（项目不可见即接口 404）；`projects.manager_id`（主数据）与名册不自动联动。
- blueprints（h3 · Push 83）：`0011_blueprints.sql` 落 `blueprints`（`project_type` 唯一 —— ADR-019 按项目类型各一份 + default 兜底；`draft_payload` / `published_version` / `version`）与 `blueprint_versions`（历史版本 payload + 校验 issues；`unique(blueprint_id, blueprint_version)` + 蓝图索引）。口径：发布 = 写新版本并把草稿归一为发布 payload（PG jsonb 重排键，直比会误判变更）；已生成项目按 `project_nodes.source_blueprint_version` 锁定快照，不受后续蓝图变更影响；种子 #7 落 default 模板（9 阶段 19 节点）。
- project_stages/tracking（h3 · Push 83）：`0012_project_stages_tracking.sql` 为 `project_stages` 增 `advanced_at` / `advanced_by` / `rolled_back_at` / `rolled_back_by` / `rollback_reason`（阶段推进 / 回退留痕；ADR-023）。口径：推进 = 本阶段 `done` + 下一阶段 `active` + `projects.stage_key` 前移；回退 = 本阶段回 `pending`（原因必填）+ 上一阶段回 `active` + `stage_key` 回移；`project_stages.status` 的 `active` 恒等于「当前阶段」。
- admin/dict-audit（h7 · Push 97）：`0013_admin_dict_audit.sql` 落 `dict_types`（类型注册表：code 主键 / name / sort / enabled + 3 CHECK）、`dict_items`（uuid 主键 + `type_code` 外键（on update cascade）+ `uq_dict_items_type_code` 同类型内码唯一 + 排序索引 + 4 CHECK + `metadata` jsonb + `updated_by`）与 `audit_logs`（bigserial 主键 + occurred_at / actor_id / actor_name / action / object_type / object_id / project_id / result / entry / summary / changes / metadata + 6 CHECK + 按对象 / 操作人 / 项目 / 时间索引）。口径：字典「删除」= 停用（`enabled=false`，无物理删除；停用不影响存量数据展示）、类型目录固定 region / projectType（阶段 / 成果文件类型走契约枚举）；审计追加写、api 角色无 UPDATE / DELETE（C7-05），保留 ≥6 个月由运维按月清理。种子 #5 `seeds/dicts.mjs`（region 8 项 / projectType 3 项 + 主题色 metadata）与 #6b 补 `dict.manage` / `audit.view`（admin = 契约 26 键全量）。
- calendar/work-calendar（h8 · Push 99）：`0014_work_calendar.sql` 落 `calendar_days`（只存例外：`date` 主键 + `day_type` 两值 `holiday` 放假 / `makeup_workday` 调休上班 + `name` / `note` + `updated_by` + 4 CHECK（类型 / 日期区间 2000-01-01~2100-12-31 / 名称 1~80 / 说明 1~200）+ `(day_type, date)` 索引）与 `calendar_settings`（单行：布尔主键恒 true + `reminder_shift_enabled` + `shift_direction`（forward 顺延 / backward 提前）+ 2 CHECK；迁移即建默认行）。口径：未登记日期按默认规则（周一至周五工作日、周六周日非工作日）—— 不落 365 行 / 年，改年历只增删例外；顺延与 T-N·T+N 实时求值不落表（`GET /api/v1/calendar/*`）；维护动作写审计（`audit_logs.object_type = calendar_day` / `calendar_settings`）；种子 #6b 补 `calendar.manage`（admin = 契约 27 键全量）。年度节假日 / 调休数据属种子 #10（待业务提供，管理入口已就绪）。
- task/order-and-nullable（w2 · Push 122）：`0015_task_order_and_nullable_scope.sql` 给 `tasks` 加 `sort_index`（integer，set default 0 + not null + `ck_tasks_sort_index (>= 0)` + `ix_tasks_project_stage_order (project_id, stage_key, sort_index)`）、`stage_key` 与 `owner_id` drop not null。口径：一组 = 同一项目 + 同一阶段（`stage_key` 为空 = 「未分组」，自成一组、默认序落最后）；位次组内 0 起、密集，回填按迁移前默认读序（`planned_start asc nulls last, created_at, id`）分区排序 —— 迁移前后读序逐行一致；写入只改位次列（同组顺延），不逐个 bump `tasks.version` / `updated_at`，并发由服务层的组行锁保证；`libiaolink_api` 无需额外授权（沿用既有表级 GRANT）。
- 一期不含：问题 / 日报 / 干系人表（随对应模块的切片落地）；字典只落「可运营数据字典」（region / projectType，h7 已落地），模板类种子随各卡片追加。

## 验证（g3 验收）

- **空库迁移成功**：按「迁移命令」执行；迁移后 `schema_migrations` 15 行、业务表 26 张 + 迁移记录表 1 张（h1 起含 0007 的 4 张身份 / 角色表；h3 新增 `blueprints` / `blueprint_versions`；h7 新增 `dict_types` / `dict_items` / `audit_logs`；h8 新增 `calendar_days` / `calendar_settings`；w2 给 `tasks` 加 `sort_index` 并放宽两列可空）。本地演练库 `check:db-schema`：26 表 / 259 列 / 73 索引（含唯一）/ 71 CHECK。
- **种子幂等**：`node scripts/seed.mjs` 连续执行两次，第二次零变更（`dicts` 地区 / 项目类型字典、`roles` 六个内置角色、`role-permissions` 六角色矩阵、`blueprint` 的 default 模板 —— 后两者按「键序归一化后的 payload 比较」判等，库内已修订时不覆盖；`--dry-run` 不改库）。
- **应用角色可写新表**：新表 / 新列由 `roles/0001` 的 default privileges 自动授权（应用角色无需额外 GRANT 即可读写 `upload_sessions` / `idempotency_keys`）。
- **Drizzle 对齐**：`server` 构建后跑 `npm run check:db-schema`（比对表 / 列类型 / 可空性 / 索引 / CHECK 名称）。
- **已合入迁移不可变**：改文件 / 删文件 / 中间插队三种情形均退出码 1，并给出中文原因（`scripts/migrate.mjs` 的 `verifyNoDrift`）。
