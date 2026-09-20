# database/seeds/ · 种子数据规格（M0-03）

- 定位：**可重跑、幂等、与迁移分离**的种子数据规格与清单。种子 = 系统运行所需的最小业务字典与模板（**不含**项目 / 用户等业务数据，不含演示与压测数据）。
- 现状：本目录先定规格与清单（M0-03，Push 73）；执行脚本随 M1 卡片实现（dicts / roles 等表随 M1 迁移落地）。实现前不得手工往库里灌数据。
- 归属：wmj（后端领域）；评审 lan、px。

## 与迁移的分界

| 维度 | migrations/ | seeds/ |
|---|---|---|
| 内容 | 结构变更（DDL） | 业务字典与模板数据（DML） |
| 追加性 | 只追加、不可修改（CONTRIBUTING §14） | 可重跑、可修订（幂等 upsert） |
| 记录 | `schema_migrations`（checksum 漂移校验） | 不写 `schema_migrations`，不参与漂移校验 |
| 触发 | 部署 / 运维手工 | 部署 / 运维手工（**应用启动不自动执行**） |
| 角色 | `libiaolink_migrator` | `libiaolink_migrator`（不引入第二个写字角色） |

## 执行约定（随实现落地）

- 命令：`DATABASE_URL=... node scripts/seed.mjs [--dry-run] [--only=<name>]`；`--dry-run` 只打印将执行的 upsert 摘要。
- 幂等：按业务键 `insert ... on conflict (业务键) do update`；重复执行结果一致、不产生重复行。
- 不删除：默认不做 DELETE（业务后续调整过的字典项保留）；确需重置用 `--reset <name>`（显式指定、留痕）。
- 顺序：dicts → roles / role_permissions → 蓝图（依赖 docType 字典）→ task_nodes / task_templates → 消息模板 → 工作日历。
- 待业务确认的取值集中在文件顶部常量区并标注「可修订」；回执后更新常量并重跑。

## 种子清单（首批 · 对应 M0-03 的九阶段 / 十类成果文件 / 问题归类 / 角色权限矩阵 / 蓝图节点）

| # | 种子 | 落表（预计） | 业务键 | 口径来源 | 状态 |
|---|---|---|---|---|---|
| 1 | 九阶段 | `dict_types` / `dict_items`（type = stage） | (type, code)：presale ~ acceptance | v0.2 §2.5；A1-12 | 定稿 |
| 2 | 十类成果文件 | `dict_items`（type = docType） | (type, code)：CAD图纸 / 技术协议 / 合同 / 评审单 / 设备清单 / 物料总清单 / 发货装箱单 / 到货单 / 安装完成证明 / 验收单 | v0.2 §2.5；C9-01；门禁 required_doc 与任务 deliverable_types 引用 | 定稿 |
| 3 | 问题归类（10 项） | `dict_items`（type = issueCategory） | (type, code) | v0.2 §2.5 + 评审补充 | 定稿；SLA 时限字段随 ADR-026（metadata，业务待回执） |
| 4 | 紧急重要度（4 项） | `dict_items`（type = priority） | (type, code) | v0.2 §2.5 | 定稿 |
| 5 | 地区 / 项目类型 | `dict_items`（type = region / projectType）+ `metadata.accent` / `accentText` | (type, code) | 业务待回执（v0.3 §7.3 #10） | 占位（最小样例，标注可修订） |
| 6 | 角色与权限矩阵 | `roles` / `role_permissions` | (role code) | v0.2 §4.1；C3-01 / C3-02 | 定稿（一期角色集） |
| 7 | 蓝图（默认模板 + 项目类型覆盖） | `blueprints` / `blueprint_versions` | (project_type, version) | ADR-019；v0.2 §3.3 首批节点清单 | 结构定稿；节点清单待业务补全 |
| 8 | 任务节点库 / 任务模板 | `task_nodes` / `task_templates` / `task_template_nodes` | (stage_key, node key) | A1-16 / A1-17；对照 `frontend/src/data/templatePresets.ts`（Push 60） | 待业务确认 |
| 9 | 消息模板（R01~R07 文案） | 消息模板表（M5 建表） | (template code) | `docs/rules/R01-R07-内置规则文案.md` | 文案定稿；表结构随 M5 |
| 10 | 工作日历（节假日 / 调休） | 日历表（D5 建表） | (日期) | D5-01；业务提供 | 待业务提供 |

## 验收口径（随实现）

- 空库迁移后连续执行种子两次：第二次零变更、无重复行（幂等）；
- 引用一致性：`node_requirements.doc_type` 与任务 `deliverable_types` 的取值全部命中成果文件字典（检查脚本随 M1 落地）；
- 蓝图校验：种子蓝图通过 v0.2 §3.4 全部校验，能生成 stages / nodes / requirements 全量；
- 业务确认项（#5 / #8 及 #3 的 SLA 时限）在回执前按占位值断言，回执后更新断言。

## 与其它文档的关系

- `database/README.md`：迁移器、角色与权限（种子与迁移同角色执行）；
- `技术设计v0.2-架构与数据模型.md` §2.5（字典第一批）/ §3.3（节点清单）/ §3.4（蓝图校验）；
- `技术设计v0.3-实施与验收.md` §3.1（M0-03 卡片）/ §7.2 / §7.3（M0 决议与业务确认清单）；
- `docs/rules/`：R01~R07 文案（种子 #9 的逐字来源）。
