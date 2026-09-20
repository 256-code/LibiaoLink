# shared/ 契约包（LibiaoLink API）

/api/v1 的契约唯一真相：**Zod schema → OpenAPI 3.1 → TypeScript 类型**，三段式自动生成。
本包是定档任务 g2（S5·契约包）的交付物；错误模型与约定对齐《技术设计v0.2-架构与数据模型.md》§7。

## 目录

```text
shared/
├── src/
│   ├── zod.ts                  zod 唯一扩展点（.openapi 元数据）
│   ├── common/
│   │   ├── errors.ts           错误码 + 统一错误信封（v0.2 §7.2）
│   │   ├── conventions.ts      Uuid / 时间 / 版本 / 幂等键 / 分页 / 排序
│   │   └── dicts.ts            阶段、成果文件、状态机等枚举（v0.2 §2.4 / §2.5）
│   ├── modules/
│   │   ├── projects.ts         项目主数据 + 首页分类 facets
│   │   ├── tasks.ts            任务 + 四格进度（含创建 / 编辑 / 从模板生成）
│   │   ├── templates.ts        任务节点库 + 任务模板（A1-16 / A1-17）
│   │   ├── flow.ts             蓝图 JSON + 流程节点 + 完成门禁
│   │   ├── files.ts            文件与变更（上传 / 版本 / 定档 / 回收站；v0.2 §5）
│   │   ├── identity.ts         登录用户 + /auth/me（ADR-010；g6）
│   │   ├── users.ts            用户目录 + 用户偏好（A2 / A4；M1）
│   │   ├── dicts.ts            数据字典下发（A3；region / projectType）
│   └── openapi.ts              /api/v1 与 /auth/* 路径注册与文档生成
├── scripts/
│   ├── lib.mjs                 渲染 OpenAPI 文档与客户端类型
│   ├── generate.mjs            写生成物（npm run generate）
│   └── check-drift.mjs         漂移校验（npm run check）
└── generated/                  生成物（提交进仓库，禁止手改 —— CONTRIBUTING §14）
    ├── openapi.json
    └── api-types.d.ts
```

## 命令

```bash
cd shared
npm install          # 首次或依赖变更后（锁文件 package-lock.json 必须同步提交）
npm run typecheck    # tsc 严格模式
npm run generate     # 生成 generated/openapi.json 与 generated/api-types.d.ts
npm run check        # 漂移校验：生成结果与仓库内生成物一致才算通过
```

生成链路：修改 src 下的 Zod schema → `npm run generate` → 提交生成物（源与生成物同一 PR）。
CI 已接入本检查（阶段 5 · CI 扩展任务）：PR / main 推送由 `.github/workflows/ci.yml` 的 `shared` job 自动执行 `npm run typecheck` + `npm run check`；本地推送前仍建议手动执行。

## 已定案口径（契约层）

| 主题 | 口径 |
|---|---|
| 前缀 / 编码 | `/api/v1`；JSON；请求与响应字段 camelCase（与 DDL snake_case 一一映射，如 manager_id ↔ managerId） |
| 分页 | 表格型 `page` / `limit` + `total`；信息流型后续用 cursor |
| 筛选与排序 | `filter[...]=..`（多值逗号分隔，如 region / projectType / managerId）、`sort=field:asc,field2:desc`、`q` 关键字 |
| 项目人员 | 项目级唯一责任人为「项目经理」（`projects.manager_id`，必填；首页筛选用 `filter[managerId]`，多值逗号分隔）；任务级为「任务负责人」（`tasks.owner_id`），两者不同粒度，不可混用 |
| 乐观锁 | 更新必须回传 `version`；冲突返回 409（VERSION_CONFLICT） |
| 幂等 | 写操作支持 `Idempotency-Key` 头；重复提交返回首次结果 |
| 时间 | 时间戳 ISO8601（UTC 存储，前端按 Asia/Shanghai 展示）；业务日期 `YYYY-MM-DD` |
| 可见性 | 资源不存在与无权访问统一 404 语义（防 IDOR） |
| 错误模型 | 统一信封 `{ code, message, details[], traceId }`；错误码见 src/common/errors.ts（与 v0.2 §7.2 同步维护） |
| 项目编号 | 创建人填写（创建请求必填 code；格式仅前端提示、不做强校验）；唯一性由服务端校验 + 数据库唯一约束保证，重复返回 409 PROJECT_CODE_EXISTS；建后可修改（更新请求可传 code，同样校验唯一性） |
| 项目序号 | 服务端创建时分配（`projects.seq_no` ↔ `seqNo`，全库唯一正整数、不可修改、不回收；与项目编号一一对应同一项目）；卡片等展示两位补零，列表支持 `sort=seqNo:asc\|desc` |
| 主题色 accent | 随项目类型字典（C9）元数据下发：`metadata.accent` = CSS 颜色字符串（hex），`metadata.accentText` = 徽标文字色（可缺省，缺省 `#fff`）；前端不硬编码颜色 |
| 任务状态 | 存储基础态 pending/active/done；展示五态由服务端派生为 `displayStatus`（不写回） |
| 任务来源 | 任务从「任务节点库」的节点生成（任务模板 = 名称 + 阶段 + 节点顺序）；同一节点在项目里只留一份（单条重复返回 409；「整套添加」默认跳过并返回 `skipped`）；任务描述 / 成果文件按 A1-17 生成后锁定 |
| 节点门禁 | 完成需过服务端事务内校验；缺件返回 422 + `missing` 明细（NODE_REQUIRED_DOC_MISSING） |
| 蓝图 | 自建 JSON（schemaVersion=1）；导出/导入 round-trip 无损；导入即快照 |
| 认证与会话 | /auth/*（根路径；OIDC authorization_code + PKCE + state；HttpOnly Cookie 会话）；/auth/me 返回 `{ user, claims, expiresAt }`；未认证 401 AUTH_REQUIRED、回调失败 400 AUTH_CALLBACK_FAILED |
| 文件状态 | 五态 draft/final/changed/archived/recycled；定档后不可覆盖，修改必须走变更（FILE_STATE_INVALID 拒绝） |
| 上传 | 分片预签名直传（api 只签名与登记元数据）；`intent=version` 仅草稿替换、`intent=change` 定档后变更；分片未齐 409（UPLOAD_INCOMPLETE）、会话过期 410（UPLOAD_SESSION_EXPIRED）、哈希不符 422（FILE_HASH_MISMATCH，命名对齐技术设计v0.3 §4.8）；分片状态以对象存储 ListParts 为唯一真相（**不落 upload_parts 表**）；内容哈希只做**重复提示**、不做强阻断 |
| 变更 | 一期申请即通过（status=applied）：提交变更后文件与变更字段，完成上传时同事务写 change_requests + 新版本 + 状态 changed + Outbox（R01 / 通知由消费方处理）；缺变更后文件不允许提交 |
| 回收站 | 任意状态可回收（默认保留 30 天，可恢复回原状态）；彻底删除仅管理员且留痕（权限模型落地前为临时口径） |
| 下载与预览地址 | 短时签名 URL + 审计；对象存储禁止匿名读取 |
| 时间区间（A1） | `filter[timeFrom]` / `filter[timeTo]`：`YYYY-MM-DD` 闭区间，按 Asia/Shanghai 日界截断（下界含当日 00:00、上界按次日 00:00 不含）；一期维度映射 `projects.updated_at`（语义以 v0.3 §7#4 ADR 为准）；只传一端合法，`timeFrom > timeTo` 或格式非法返回 400；列表与 facets 同 schema 同口径；列表 `sort` 缺省 = `updatedAt:desc`（最近活动在前）；白名单 `updatedAt` / `createdAt` / `seqNo`（A9 · Push 69：补 `createdAt`，供前端后续「按创建时间」维度升级） |
| 用户目录（A2） | `GET /users`：`q` + 分页，只返回 `status=active`；项为 `{ id, username, displayName, email, status }`（不含 casdoorId / owner / 部门 / 手机号）；默认按 `username` 升序（分页不跳行）；登录用户全员可读，不做数据范围裁剪；项目侧随行下发 `Project.managerName`（列表 / 详情 / 创建与编辑返回；人员停用 / 离职仍返回姓名，取不到为 `null`） |
| 字典（A3） | `GET /dicts` / `GET /dicts/{type}`：一期只下发可运营数据字典 `region` / `projectType`（项 `{ code, name, sort, enabled, metadata }`，`projectType` 必含 `metadata.accent`）；阶段 / 成果文件类型 / 紧急重要度属契约枚举（`src/common/dicts.ts`），前端直接引用、不走接口（避免同一事实两处来源） |
| 用户偏好（A4） | `GET / PATCH /users/me/preferences`：PATCH 合并语义（只传变更键），响应回全量 + `updatedAt`；一期键 `taskTableHiddenColumns`（列 key 白名单校验，未知 key 400）；存储 `user_preferences`（与项目视图 `project_views` 分离）；单用户单写者不带 `version` |
| 项目软删（A5） | `DELETE /projects/{id}`：软删；`If-Match` 回传当前 `version` 防误删（缺失或非数字 400、不匹配 409，不用 body 传 version）；列表 / 详情 / facets / 搜索 / 导出统一不可见；`seqNo` 不回收、`code` 唯一性保留（同编号再建仍 409 PROJECT_CODE_EXISTS）；非成员 / 不存在统一 404；仅项目经理 / 管理员并写审计 |
| 任务列表项（A7） | 列表 `GET /projects/{id}/tasks` 返回 `TaskListItem`（Task 去掉 `changeRef` + 内联 `ownerName` / `changeSummary` / `fileSummary`，免 N+1）；抽屉走 `GET /projects/{id}/tasks/{taskId}`（`TaskDetail`：全字段 + 文件清单）；进度更新响应同 `TaskListItem` 形，前端直接替换行 |
| 任务排序（A8） | 默认顺序 = 阶段顺序（`STAGE_KEYS` 序）+ 组内 `plannedStart ASC NULLS LAST, created_at ASC, id ASC`（稳定，分页不跳行）；`sort` 白名单 `plannedStart` / `plannedEnd` / `actualEnd` / `progress` / `title` / `createdAt`，白名单外 400；一期不新增 `tasks.seq` |
| 任务状态可写（A12） | `PATCH /projects/{id}/tasks/{taskId}` 开放可选 `status`（基础三态 `pending` / `active` / `done`）；服务端同事务回填进度与完成日期：done → `progress=1` 且 `actualEnd` 缺省按当天；active → 进度至少 1 格（0 → 0.25、满格 → 0.75）并清 `actualEnd`；pending → 进度 0 并清 `actualEnd`；「已延期 / 提前完成」是派生展示态、不可写（提交 400）且派生优先 |
| 进度与完成日期（A13） | 进度为离散五档 `0 / 0.25 / 0.5 / 0.75 / 1`（迁移 / 演示数据的任意小数先归一，如 0.49 → 0.5）；`progress<1` 服务端一律清空 `actual_end`（清除完成日期的唯一方式）；`progress=1` 且缺省按当天（Asia/Shanghai）写入；完成日期不进 `PATCH /tasks/{taskId}` |
| 是否按时交付（A14） | 服务端读时派生 `onTime`：完成且不晚于 `plannedEnd` → true；完成晚于 `plannedEnd`（或完成未填日期且已过 `plannedEnd`）→ false；未完成且已过 `plannedEnd` → false + `displayStatus=overdue`（逾期未交付）；派生不出回落迁移存储值，仍无则 `null`；前端「逾期未交付 / 逾期已交付」标签由 `onTime` + `displayStatus` 渲染，不再本地派生 |

## 本批范围与后续切片

- 第一批（g2）：项目、任务、流程节点与蓝图（对应阶段 6 纵切的 h1~h4）。
- 任务节点库与任务模板（A1-16 / A1-17；2026-09-19 定案）：任务模板 CRUD（按阶段）+ 从模板批量生成任务；落库表建议 `task_nodes` / `task_templates` / `task_template_nodes`（见 `前端功能需求.md` §3.8 A11 / `字段对照清单.md` §四）。
- 第二批（S7·file，i1）：文件与变更（上传 / 版本 / 定档 / 变更 / 回收站）；预览（preview）契约随 i3 补。
- 认证与会话（g6）：identity 契约（User / MeResponse / /auth/login 与 /auth/callback 查询参数），随会话后端化落地。
- 对齐清单 A1~A14（Push 49 / 69 / 70）：projects（时间区间 / 软删 / 排序白名单补 `createdAt`）、tasks（列表项与详情 / 排序白名单 / 状态可写与进度联动 / 完成日期 / 逾期派生）、users（用户目录 / 用户偏好）、dicts（数据字典下发）—— A1~A8 决议见 PR #40 评审记录，A9~A14 决议见 PR #42 评审；A2 / A3 为 M1 出口（前端移除硬编码）前提。
- 后续切片（随对应模块落地补契约，仍在本包内）：通知（notify，阶段 8）、
  搜索与统计（search / dashboard，阶段 8）、迁移工具链（阶段 9）、
  自动化规则与日报/问题（automation / report，阶段 7）。

## 边界与注意事项

- 本包只定义契约与生成物，不含服务端实现与数据库迁移（分别在 server/ 与 database/ 落地）。
- 生成物禁止手改；改契约必须改 src 下的 Zod schema 并重新生成（CONTRIBUTING §14）。
- 消费方（server / frontend）引用方式待仓库结构定案（v0.1 Q15：frontend 原地演进 vs workspace）。
- 依赖说明：Node >= 24；zod 4.6；TypeScript 5.9（openapi-typescript 的 peer 要求 ^5.x）。
  前端当前为 TypeScript 7.0.2 —— 版本差异已登记在 ADR-017「待复核差异」，评审时一并定案。
