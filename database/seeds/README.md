# database/seeds/ · 种子数据规格（M0-03）

- 定位：**可重跑、幂等、与迁移分离**的种子数据规格与清单。种子 = 系统运行所需的最小业务字典与模板（**不含**项目 / 用户等业务数据，不含演示与压测数据）。
- 现状：规格与清单定于 M0-03（Push 73）；执行器与首个种子（#6a 角色）已随 h1 落地（Push 74：`scripts/seed.mjs` + `seeds/roles.mjs` / `seeds/index.mjs`），此后 #7 蓝图（h3 · Push 83）、#6b 权限矩阵（h6 · Push 95，`seeds/role-permissions.mjs`）、#5 地区 / 项目类型（h7 · Push 97，`seeds/dicts.mjs`）随各自卡片落地；h8（Push 99）无新增种子文件（`#6b` 补 `calendar.manage` 一键），其余种子随对应卡片追加。实现前不得手工往库里灌数据。
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

- 命令（已落地）：`DATABASE_URL=... node scripts/seed.mjs [--dry-run] [--only=<name>]`；`--dry-run` 打印变更摘要后全部回滚；执行器逐种子独立事务，advisory lock `20260919`（与迁移器 `20260918` 分开）。
- 幂等：按业务键 upsert / 逐字段比对（示例见 `seeds/roles.mjs`）；重复执行结果一致、第二次零变更。
- 不删除：默认不做 DELETE（业务后续调整过的字典项保留）；暂不提供 `--reset`（首个确实需要重置的种子落地时再引入，显式指定、留痕）。**例外**：#6b 权限矩阵**以文件为准** —— 移除键会 DELETE，因为权限是安全面、吊销必须能生效（修订语义见 `seeds/role-permissions.mjs` 顶部）。
- 顺序：dicts → roles / role_permissions → 蓝图（依赖 docType 字典）→ task_nodes / task_templates → 消息模板 → 工作日历（表结构 + 管理入口已随 h8 落地：0014）→ 其余模板（当前注册表实序：dicts → roles → role-permissions → blueprint）。
- 待业务确认的取值集中在文件顶部常量区并标注「可修订」；回执后更新常量并重跑。

## 种子清单（首批 · 对应 M0-03 的九阶段 / 十类成果文件 / 问题归类 / 角色权限矩阵 / 蓝图节点）

| # | 种子 | 落表（预计） | 业务键 | 口径来源 | 状态 |
|---|---|---|---|---|---|
| 1 | 九阶段 | `dict_types` / `dict_items`（type = stage） | (type, code)：presale ~ acceptance | v0.2 §2.5；A1-12 | 定稿 |
| 2 | 十类成果文件 | `dict_items`（type = docType） | (type, code)：CAD图纸 / 技术协议 / 合同 / 评审单 / 设备清单 / 物料总清单 / 发货装箱单 / 到货单 / 安装完成证明 / 验收单 | v0.2 §2.5；C9-01；门禁 required_doc 与任务 deliverable_types 引用 | 定稿 |
| 3 | 问题归类（10 项） | `dict_items`（type = issueCategory） | (type, code) | v0.2 §2.5 + 评审补充 | 定稿；SLA 时限字段随 ADR-026（metadata，业务待回执） |
| 4 | 紧急重要度（4 项） | `dict_items`（type = priority） | (type, code) | v0.2 §2.5 | 定稿 |
| 5 | 地区 / 项目类型 | `dict_items`（type = region / projectType）+ `metadata.accent` / `accentText` | (type, code) | 业务待回执（v0.3 §7.3 #10） | 已落地（h7 · Push 97，`seeds/dicts.mjs`：region 8 项 / projectType 3 项；**取值仍待业务回执** —— 改常量区重跑即可，库内已修订的不覆盖） |
| 6a | 角色（一期六个内置角色） | `roles` | (role code) | v0.2 §4.1；C3-01 / C3-02 | 已落地（h1 · Push 74，`seeds/roles.mjs`） |
| 6b | 功能权限矩阵（role_permissions 条目） | `role_permissions` | (role_id, permission) | v0.2 §4.1 关键能力列；ADR-011 | 已落地（h6 · Push 95，`seeds/role-permissions.mjs`：六角色 74 条；键唯一来源 = 契约 `PERMISSION_KEYS`，`check:permission-matrix` 三方对齐、admin 全量 27 键（h7 补 `dict.manage` / `audit.view`，h8 补 `calendar.manage`）；幂等复跑 0 变更） |
| 7 | 蓝图（默认模板 + 项目类型覆盖） | `blueprints` / `blueprint_versions` | (project_type, version) | ADR-019；v0.2 §3.3 首批节点清单 | 已落地（h3 · Push 83，`seeds/blueprint.mjs`：默认模板 9 阶段 19 节点 + 版本 1）；节点清单仍待业务补全（可修订常量区，库内已修订时不覆盖） |
| 8 | 任务节点库 / 任务模板 | `task_nodes` / `task_templates` / `task_template_nodes` | (stage_key, node key) | A1-16 / A1-17；对照 `frontend/src/data/templatePresets.ts`（Push 60） | 待业务确认 |
| 9 | 消息模板（R01~R07 文案） | 消息模板表（M5 建表） | (template code) | `docs/rules/R01-R07-内置规则文案.md` | 文案定稿；表结构随 M5 |
| 10 | 工作日历（节假日 / 调休） | `calendar_days` / `calendar_settings`（0014 已落） | (日期, day_type) | D5-01；业务提供 | 表结构 + 管理入口已落地（h8 · Push 99）：`GET / PUT / DELETE /api/v1/calendar/*`（仅 `calendar.manage` 可写）+ 真机回放 30 项断言；**年度节假日 / 调休数据待业务回执**（回执后由管理端录入，或按新种子落地） |

> 待确认（#6a / #6b）：数据范围枚举按 v0.2 §4.1 六角色实际使用的五值先行（`all` / `managed_projects` / `involved_projects` / `own_stakeholders` / `granted`）；C3-02 措辞差（「本部门」未被任何角色使用、「自定义项目集」≈ `granted`）已登记《技术设计v0.3》§7.3 #16 —— h6 矩阵按五值落地、未新增角色；措辞收敛（补角色或改功能书表述）仍待业务 / px 确认。

## 验收口径（随实现）

- 空库迁移后连续执行种子两次：第二次零变更、无重复行（幂等）—— #6a 角色（Push 74）、#7 蓝图（Push 83）、#6b 权限矩阵（h6 · Push 95）、#5 地区 / 项目类型字典（h7 · Push 97：首次 inserted 2 / 11、复跑 0 变更）、#6b 补 `calendar.manage`（h8 · Push 99：inserted 1、复跑 0 变更，六角色 74 条 / 27 键）已按此验证；
- 引用一致性：`node_requirements.doc_type` 与任务 `deliverable_types` 的取值全部命中成果文件字典（检查脚本随 M1 落地）；
- 蓝图校验：种子蓝图通过 v0.2 §3.4 全部校验，能生成 stages / nodes / requirements 全量；
- 业务确认项（#5 / #8 及 #3 的 SLA 时限）在回执前按占位值断言，回执后更新断言。

## 与其它文档的关系

- `database/README.md`：迁移器、角色与权限（种子与迁移同角色执行）；
- `技术设计v0.2-架构与数据模型.md` §2.5（字典第一批）/ §3.3（节点清单）/ §3.4（蓝图校验）；
- `技术设计v0.3-实施与验收.md` §3.1（M0-03 卡片）/ §7.2 / §7.3（M0 决议与业务确认清单）；
- `docs/rules/`：R01~R07 文案（种子 #9 的逐字来源）。
