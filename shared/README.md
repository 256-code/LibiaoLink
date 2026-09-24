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
│   │   ├── files.ts            文件与变更（上传 / 版本 / 定档 / 回收站 / 文件库查询与多态关联；v0.2 §5）
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
| 前缀 / 编码 | `/api/v1`；JSON；请求与响应字段 camelCase（与 DDL snake_case 一一映射，如 manager_ids ↔ managerIds） |
| 分页 | 表格型 `page` / `limit` + `total`；信息流型后续用 cursor |
| 筛选与排序 | `filter[...]=..`（多值逗号分隔，如 region / projectType / managerId）、`sort=field:asc,field2:desc`、`q` 关键字 |
| 项目人员 | 项目级为「项目经理」**多位**（`projects.manager_ids` uuid[]，至少一位、顺序 = 展示顺序；首页筛选用 `filter[managerId]`，多值逗号分隔、任一位命中即命中，A22 · Push 136）；任务级为「任务负责人」**多位**（`tasks.owner_ids` uuid[]；空数组 = 「待分配」，`filter[ownerId]` 任一位命中即命中，A23 · Push 136）——两者不同粒度，不可混用 |
| 乐观锁 | 更新必须回传 `version`；冲突返回 409（VERSION_CONFLICT） |
| 幂等 | 写操作支持 `Idempotency-Key` 头；重复提交返回首次结果 |
| 时间 | 时间戳 ISO8601（UTC 存储，前端按 Asia/Shanghai 展示）；业务日期 `YYYY-MM-DD` |
| 可见性 | 资源不存在与无权访问统一 404 语义（防 IDOR） |
| 错误模型 | 统一信封 `{ code, message, details[], traceId }`；错误码见 src/common/errors.ts（与 v0.2 §7.2 同步维护） |
| 审计对象类型 | `AUDIT_OBJECT_TYPES`：project / project_member / task / node / stage / dict_item / blueprint / calendar_day / calendar_settings / file（M4-01 · PR-4 新增；审计对象 id = fileId，上传会话事件经 `metadata.uploadId` 定位 —— 扩枚举而非新增 `upload_session`，避免为同一业务对象开两套检索口径） / change（M4-04 变更记录） / stakeholder（j6 干系人） / **daily_report**（M6-01 日报；对象 id = reportId） / **issue**（M6-02 / M6-03 问题；对象 id = issueId，含日报自动生成与手工流转） |
| 审计动作 | `AUDIT_ACTIONS`：create / update / delete / progress / complete / advance / rollback / **preview**（契约切片 · M4-05 前置；D2-07：预览计入查看 / 下载审计 —— 库侧 `ck_audit_logs_action` 已随迁移 `0027`（M4-05 数据层 · lan 线 Push 165）扩为十值）/ **download**（Push 160 定案；A4-10：离线下载受权限控制并记日志 —— 对象类型 file + metadata 记 versionId；库侧已随迁移 `0027` 一次扩至十值） / deny |
| 预览契约 | `GET /api/v1/files/{id}/preview` → `FilePreviewResponse`：`status` = ready / not_ready / failed、`target` = pdf / image / structured（**渲染通道**口径，不按文件格式）、ready 附短时签名 `url` + `expiresAt` + `pipelineVersion` + `generatedAt`，failed 附 `reason`（≤ 500 字；D2-05 降级「请下载」）；可选查询参数 `versionId`（A4-06 历史版本预览，缺省 = 当前版本；不属于该文件 / 不存在 → 404）；未就绪 / 失败为 **200 语义**（对齐 v0.2 §7.2 的 `PREVIEW_NOT_READY` / `PREVIEW_FAILED`）；`not_ready` 时服务端幂等补投生成任务（按三元组去重）、前端轮询 —— 不引入请求约定；审计 = `object_type = file` + `action = preview` + metadata（versionId / target / pipelineVersion），仅返回 ready 的读取写审计；缓存键 = 内容哈希 + `pipelineVersion` + `target`（ADR-007 / v0.2 §5.4 三元组） |
| 项目编号 | 创建人填写（创建请求必填 code；格式仅前端提示、不做强校验）；唯一性由服务端校验 + 数据库唯一约束保证，重复返回 409 PROJECT_CODE_EXISTS；建后可修改（更新请求可传 code，同样校验唯一性） |
| 项目序号 | 服务端创建时分配（`projects.seq_no` ↔ `seqNo`，全库唯一正整数、不可修改、不回收；与项目编号一一对应同一项目）；卡片等展示两位补零，列表支持 `sort=seqNo:asc\|desc` |
| 主题色 accent | 随项目类型字典（C9）元数据下发：`metadata.accent` = CSS 颜色字符串（hex），`metadata.accentText` = 徽标文字色（可缺省，缺省 `#fff`）；前端不硬编码颜色 |
| 任务状态 | 存储基础态 pending/active/done；展示五态由服务端派生为 `displayStatus`（不写回） |
| 任务来源 | 任务从「任务节点库」的节点生成（任务模板 = 名称 + 阶段 + 节点顺序）；同一节点在项目里只留一份（单条重复返回 409；「整套添加」默认跳过并返回 `skipped`）；任务描述 / 成果文件按 A1-17 生成后锁定 |
| 节点门禁 | 完成需过服务端事务内校验；缺件返回 422 + `missing` 明细（NODE_REQUIRED_DOC_MISSING） |
| 蓝图 | 自建 JSON（schemaVersion=1）；导出/导入 round-trip 无损；导入即快照 |
| 认证与会话 | /auth/*（根路径；OIDC authorization_code + PKCE + state；HttpOnly Cookie 会话）；/auth/me 返回 `{ user, claims, expiresAt }`；未认证 401 AUTH_REQUIRED、回调失败 400 AUTH_CALLBACK_FAILED |
| 文件状态 | 五态 draft/final/changed/archived/recycled；定档后不可覆盖，修改必须走变更（FILE_STATE_INVALID 拒绝） |
| 上传 | 分片预签名直传（api 只签名与登记元数据）；`intent=version` 仅草稿替换、`intent=change` 定档后变更；分片未齐 409（UPLOAD_INCOMPLETE）、会话过期 410（UPLOAD_SESSION_EXPIRED）、哈希不符 422（FILE_HASH_MISMATCH，命名对齐技术设计v0.3 §4.8）；分片状态以对象存储 ListParts 为唯一真相（**不落 upload_parts 表**）；内容哈希只做**重复提示**、不做强阻断。**M4-01 落地口径（PR-4）**：会话先写暂存键 `…/staging/{sessionId}` 直传，complete 校验大小 / 哈希后由服务端 `copyObject` 复制到契约键 `…/v{seq}/{contentHash}.{ext}`，落库 `file_versions.object_key` 始终是契约形态（ADR-006 定案）；`contentHash` init 可选、complete 必填。**上传入口 `fileId` 定案（Push 130 · wmj）**：省略 = 新建文件（仅 `intent=version`）；`intent=version` + `fileId` = 对既有 **draft** 文件替换 / 追加版本（非 draft → 409 `FILE_STATE_INVALID`）；`intent=change` **必填** `fileId`（目标须 final / changed，A4-13）；目标不存在 / 无权 → 404、与 `projectId` 不一致 → 400；给出 `fileId` 时名称与归属（`name` / `docType` / `nodeId` / `taskId`）以目标文件现状为准（可省略、填写须一致），`duplicateHint` 恒空。**M4-01 切片内 `intent=change` 与带 `fileId` 的请求一律显式 400**（守卫，防静默新建文件；回放 U21 / U22 固化）；**M4-02 落地（PR-5 · Push 131）**：`intent=version` + `fileId` 已放开（对既有 draft 文件替换 / 追加版本；目标非 draft → 409 `FILE_STATE_INVALID`；名称 / 归属与目标现状不一致 → 400），`intent=change` + `fileId` 已放开（M4-04 · PR-7：目标须 final / changed，非该状态 → 409 `FILE_STATE_INVALID`；变更载荷随会话落 `upload_sessions.change_payload`，完成上传时同事务生效并返回 `changeRequest`） |
| 变更 | 一期申请即通过（status=applied）：提交变更后文件与变更字段，完成上传时同事务写 change_requests + 新版本 + 状态 changed + Outbox（R01 / 通知由消费方处理）；缺变更后文件不允许提交 |
| 回收站 | 任意状态可回收（默认保留 30 天，可恢复回原状态）；彻底删除仅管理员且留痕（权限模型落地前为临时口径） |
| 下载与预览地址 | 短时签名 URL + 审计；对象存储禁止匿名读取 |
| 时间区间（A1） | `filter[timeFrom]` / `filter[timeTo]`：`YYYY-MM-DD` 闭区间，按 Asia/Shanghai 日界截断（下界含当日 00:00、上界按次日 00:00 不含）；**Push 175 起维度映射 `projects.created_at`（项目创建时间；原「最近活动 `updated_at`」口径作废，语义以 v0.3 §7#4 ADR + Push 175 修订为准）**；只传一端合法，`timeFrom > timeTo` 或格式非法返回 400；列表与 facets 同 schema 同口径；列表 `sort` **缺省 = `createdAt:desc`（最近创建的在前，Push 175 修订；原 `updatedAt:desc` 作废）**；白名单 `updatedAt` / `createdAt` / `seqNo`（A9 · Push 69 补 `createdAt`；**Push 175 前端「维度 × 方向」已落地**） |
| 用户目录（A2） | `GET /users`：`q` + 分页，只返回 `status=active`；项为 `{ id, username, displayName, email, status }`（不含 casdoorId / owner / 部门 / 手机号）；默认按 `username` 升序（分页不跳行）；登录用户全员可读，不做数据范围裁剪；项目侧随行下发 `Project.managerNames`（与 `managerIds` 同下标数组；列表 / 详情 / 创建与编辑返回；人员停用 / 离职仍返回姓名，取不到该位为 `null`） |
| 字典（A3） | `GET /dicts` / `GET /dicts/{type}`：一期只下发可运营数据字典 `region` / `projectType`（项 `{ code, name, sort, enabled, metadata }`，`projectType` 必含 `metadata.accent`）；阶段 / 成果文件类型 / 紧急重要度属契约枚举（`src/common/dicts.ts`），前端直接引用、不走接口（避免同一事实两处来源） |
| 用户偏好（A4） | `GET / PATCH /users/me/preferences`：PATCH 合并语义（只传变更键），响应回全量 + `updatedAt`；一期键 `taskTableHiddenColumns`（列 key 白名单校验，未知 key 400）；存储 `user_preferences`（与项目视图 `project_views` 分离）；单用户单写者不带 `version` |
| 分类字段（A1-12） | `region` / `projectType`：首页分类侧边栏与统计的来源（facets 五组里的两组）；创建请求缺省「未分类」（服务端 default，前端表单仍必填、空串 400），更新可改；字典取值由 C9 字典维护（`GET /dicts` 已入契约，落表随 h7） |
| 项目成员（M2-05） | 名册 `project_members`：`role_in_project` 两值 `project_manager` / `project_member`（与全局角色 `roles` 相互独立）；`GET / POST / DELETE /projects/{id}/members`（POST 幂等 upsert：同项目 + 同用户唯一，重复添加 = 覆盖角色且保留 `joinedAt`；`userId` 不存在 404）；不是成员 / 项目不可见统一 404；成员变更按 ADR-022 ② 刷新项目 `updatedAt`；归档项目名册只读（409 PROJECT_ARCHIVED）；记录级**过滤**（非成员 404 裁剪）随 h6 |
| 蓝图组织（ADR-019） | 蓝图按项目类型各一份（`projectType` 缺省 `default`）+ default 兜底；`GET / PUT /blueprint`、`POST /blueprint/publish`、`GET /blueprint/export`、`POST /blueprint/import` 按 `projectType` **精确取**（未建档 404；PUT 首次保存即建档），default 兜底只发生在**项目侧解析**（建项目快照 / 版本解析 / 模板节点池）；发布 = 版本递增（无变更不递增、幂等，比较前做键序归一化）；导入 / 导出 round-trip 无损；导入即快照 |
| 阶段推进与回退（ADR-023） | `GET /projects/{id}/stages`：九阶段状态 + 节点 / 任务完成度（读时派生）；`POST …/stages/{key}/advance` 仅当前 `active` 阶段可推进，服务端门禁 = 该阶段节点全 done + 任务全 done + 各节点必交成果文件齐备（失败 422 `STAGE_GATE_NOT_PASSED` + `details[].code = node_not_done / task_not_done / doc_missing`，**整体一次事务、不部分推进**）；`POST …/rollback` 仅相邻上一阶段、原因必填、不做门禁（首阶段 409 `STAGE_STATE_INVALID`）；`projects.stage_key` 随推进前移 / 回退回移，跟踪列 `advanced_at/by`、`rolled_back_at/by`、`rollback_reason` |
| 节点增删（ADR-020） | `POST /projects/{id}/nodes` 仅项目经理（`admin` 角色 / `projects.manager_ids` 任一位 / 名册 `role_in_project=project_manager`），`nodeKey` 必须命中**项目导入版本**的模板节点池（否则 422 `BLUEPRINT_REF_UNKNOWN`）；`node_key` 项目内唯一：已有未删节点 409 `NODE_ALREADY_EXISTS`，软删后再增补 = 还原同一行（回 `pending`、清完成留痕）；`DELETE …/nodes/{nodeId}` 原因必填 + 软删 + 乐观锁，有成果文件 409 `NODE_HAS_FILES` |
| 项目软删（A5） | `DELETE /projects/{id}`：软删；`If-Match` 回传当前 `version` 防误删（缺失或非数字 400、不匹配 409，不用 body 传 version）；列表 / 详情 / facets / 搜索 / 导出统一不可见；`seqNo` 不回收、`code` 唯一性保留（同编号再建仍 409 PROJECT_CODE_EXISTS）；非成员 / 不存在统一 404；仅项目经理 / 管理员并写审计 |
| 任务列表项（A7） | 列表 `GET /projects/{id}/tasks` 返回 `TaskListItem`（Task + 内联 `ownerNames` / `fileSummary`，免 N+1；**Push 144**：「变更关联」多条由 `Task.changeLinks: TaskChangeLink[]` 随行下发 —— `changeRef` / 单条 `changeSummary` 已下线，一条任务可关联多条变更 = A1-07「追加＋去重」）；抽屉走 `GET /projects/{id}/tasks/{taskId}`（`TaskDetail`：全字段 + 文件清单）；进度更新响应同 `TaskListItem` 形，前端直接替换行 |
| 任务落库口径（A15 / A18 / A19 / A20 · Push 124；A23 · Push 136 修订） | `tasks.stage_key` 放宽可空（未分组）+ `tasks.sort_index`（迁移 0015）；负责人由 `owner_id`（可空）改为 `owner_ids` uuid[]（迁移 0017）——契约 `Task.stageKey` 可空、`Task.ownerIds` 数组（空数组 = 待分配）、`TaskListItem.ownerNames` 同下标数组；`TaskCreateBody.stageKey` 可选可空（缺省 = 未分组，带节点时缺省取节点阶段、不一致 400）、`TaskCreateBody.ownerIds` 可选（缺省 = 项目全部项目经理兜底，显式 `[]` = 待分配）、`TaskCreateBody.sortIndex` 可选（插入位次）；`TaskUpdateBody.ownerIds` 可选（不传 = 不改 / `[]` = 置空 / 传数组 = 整体替换）、`TaskUpdateBody.sortIndex` 可选（组内重排） |
| 任务排序（A8；A15 / A19 / A20 · Push 124 修订） | 默认顺序 = 阶段顺序（`STAGE_KEYS` 序，`stageKey` 为空 = 「未分组」落最后）+ 组内位次 `sortIndex` + `id`（稳定，分页不跳行）；位次由 `tasks.sort_index` 落库（一组 = 同一项目 + 同一阶段，组内 0 起、密集；创建 `sortIndex` = 插入位次、编辑 = 移到第 N 位，越界 = 组尾）；`sort` 白名单 `plannedStart` / `plannedEnd` / `actualEnd` / `progress` / `title` / `createdAt`，白名单外 400；一期不新增 `tasks.seq` |
| 任务状态可写（A12） | `PATCH /projects/{id}/tasks/{taskId}` 开放可选 `status`（基础三态 `pending` / `active` / `done`）；服务端同事务回填进度与完成日期：done → `progress=1` 且 `actualEnd` 缺省按当天；active → 进度至少 1 格（0 → 0.25、满格 → 0.75）并清 `actualEnd`；pending → 进度 0 并清 `actualEnd`；「已延期 / 提前完成」是派生展示态、不可写（提交 400）且派生优先 |
| 进度与完成日期（A13） | 进度为离散五档 `0 / 0.25 / 0.5 / 0.75 / 1`（迁移 / 演示数据的任意小数先归一，如 0.49 → 0.5）；`progress<1` 服务端一律清空 `actual_end`（清除完成日期的唯一方式）；`progress=1` 且缺省按当天（Asia/Shanghai）写入；完成日期不进 `PATCH /tasks/{taskId}` |
| 是否按时交付（A14） | 服务端读时派生 `onTime`：完成且不晚于 `plannedEnd` → true；完成晚于 `plannedEnd`（或完成未填日期且已过 `plannedEnd`）→ false；未完成且已过 `plannedEnd` → false + `displayStatus=overdue`（逾期未交付）；派生不出回落迁移存储值，仍无则 `null`；前端「逾期未交付 / 逾期已交付」标签由 `onTime` + `displayStatus` 渲染，不再本地派生 |
| 锁定字段例外调整（A1-17 / C9-07 · M3-05 续卡 · Push 153） | `PATCH /projects/{id}/tasks/{taskId}/locked-fields`：任务描述（`title`）/ 英文描述（`titleEn`）/ 输出成果文件（`deliverableTypes`）按模板生成后锁定 —— 常规编辑与批量均不含该三项；确需修正时**仅系统管理员**可例外调整、`reason` 必填（1~500）并留痕（审计 `action=update` changes=锁定字段 diff + outbox `task.locked_fields_adjusted`，不写 `task_events`）；至少一个实际变化（空调整 400）；「阶段性里程」一期 `tasks` 表无列，本期不开放（A1-17 映射修订，差异登记） |
| 任务删除（A25 · M3-05 · Push 152） | `DELETE /api/v1/projects/{id}/tasks/{taskId}`：软删（`tasks.deleted_at` / `deleted_by`）—— 列表 / 看板 / 甘特图 / 详情 / 完成门禁一律不可见 + 写留痕；响应 `TaskDeleteResponse = { id, deleted: true }`；**重复删除与已删任务上的任何写操作 = 统一 404**（记录级 404 语义，不新增错误码）；**已有变更关联（`change_refs` 非空）409 `TASK_HAS_REFERENCES`**（系统功能书 A2-01「已产生日报 / 问题 / 变更的任务不允许删除，只能关闭或标记」；日报 / 问题两表随 M5 落地后在守卫处一并加判定）；组内位次同事务压缩、来源节点约束随软删释放（同节点可重建）；权限键 `task.update`（与编辑同一权限位） |
| 任务批量操作（A1-08 · M3-04 · Push 150） | `PATCH /projects/{id}/tasks/batch`：同一组变更应用到 1~100 个 id（重复去重、按首次出现顺序）；`changes` 白名单 = ownerIds / status（三态，done = 批量完成，走同一完成门禁）/ plannedStart / plannedEnd / estimatedDays / headcount / priority / note（语义同单条：null = 清空、缺键 = 不改；不含任务描述 / 成果文件（A1-17 锁定）与 sortIndex）；**逐条独立事务**防长事务，条目级可预期错误降级为 `failures[]`（not_found / archived / gate_not_passed + missing / already_done / version_conflict / invalid_state），成功项照常生效、整体 200；空 changes 400、归档项目入口 409；审计双层：批次一条（`project` 域，summary + metadata = batchId / taskIds / changedFields / 计数 / failures[]，A1-08「整体写审计日志」）+ 逐条字段级一条（`metadata.entry = batch` + 同批 `batchId`）；门禁拒绝沿用 outbox `task.gate_rejected` + 审计 failed |
| 日报（A3-01 ~ A3-04 / A3-08 / A3-09 · M6-01 / M6-02 · Push 155） | **项目嵌套四端点**：`GET /api/v1/projects/{id}/reports`（`filter[dateFrom]` / `filter[dateTo]` / `filter[state]` / `filter[authorId]` + 分页；日期倒序）、`POST …/reports`（`state` 缺省 `submitted`；**一人一项目一天一条**，重复 409 `REPORT_ALREADY_EXISTS`）、`GET|PATCH …/reports/{reportId}`（乐观锁 `version`，`date` 不可改）；**补填 = 对过去日期首次提交**（服务端推导 `supplement`，客户端不可指定；未来日期 400）；提交即触发两件幂等副作用 —— A3-09 自动生成问题（`source_report_id` 唯一兜底）与 A3-08 回写关联任务「项目进展描述」（幂等标记 `【日报 <日期>】`）；`foundIssue` 非空 → `issueCategory` 必填（superRefine） |
| 问题（A3-09 ~ A3-13 · M6-02 / M6-03 · Push 155） | `GET /api/v1/projects/{id}/issues`（`filter[state]` / `filter[category]` / `filter[taskId]` / `filter[reportId]` + `q` + 分页；提出日期倒序；问题追踪表与问题看板同源）、`GET …/issues/{issueId}`（问题 + `events[]` 处理过程留痕，时间正序）、`PATCH …/issues/{issueId}`（状态流转 / 解决方案 / 分派（`ownerDepartment` / `ownerId`）/ 时限 `dueAt`；乐观锁 `version`；**四态允许回退且留痕**，`done → 其它态` 一并清 `closed_at` / `closed_by`；至少一个实际变化，空更新 400）；归类十项为**契约固定枚举**（C9 字典可维护随后，差异登记）；SLA `dueAt` 一期仅落库（提醒 / 升级随规则引擎 M5） |

## 契约切片表（M0-02 · Push 73）

> **本表状态（契约切片 · M4-04 / M4-05 前置 · wmj 评审定案）**：`AUDIT_ACTIONS` 增 `preview`（D2-07 预览计入查看 / 下载审计；库侧 `ck_audit_logs_action` 已随迁移 `0027`（lan 线 Push 165 代记，请 wmj 复核）扩为十值）、`AUDIT_OBJECT_TYPES` 增 `change`（M4-04 变更记录；**预览不新开对象类型** —— 沿用 `file` + `action = preview` + metadata，避免同一 fileId 两套检索口径）；新增预览契约 `FilePreviewResponse` + `GET /api/v1/files/{id}/preview`（含可选 `versionId`；`PreviewStatus` ready / not_ready / failed，后两者 200 语义）与 `PreviewTarget`（pdf / image / structured）。生成物已重出（paths = 60、schemas = 145），`npm run check` 零漂移；定案见 PR #103 评审（wmj）。**追加定案（Push 160）**：`AUDIT_ACTIONS` 再增 `download`（A4-10 离线下载受权限控制并记日志，与 D2-07 预览审计同口径；对象类型沿用 `file` + metadata 记 versionId）；`preview` 的权限口径按「项目可见即可」（与文件详情 / 版本链同口径），下载受 `file.download` 权限点约束；outbox 领取器切片（PR-10）边界 = 只落「领取 + 消费 + 重试 + dead」，不含规则 / 通知编排（不与 i5 重复实现）。

> **本表状态（PR-5 · Push 131）**：M4-01 上传管道（PR-4 · Push 129）—— `AUDIT_OBJECT_TYPES` 增 `file`（跨线改动，请 wmj 评审）；生成物已按 `npm run generate` 重出（openapi.json / api-types.d.ts），`npm run check` 零漂移。**M4-02（版本 / 定档 / 回溯 / 回收站）实现落地，契约零改动**：上传入口 `intent=version` + `fileId` 放开（draft 替换 / 追加版本），`intent=change` 仍 400（随 M4-04）；错误码沿用 V0.3 既有（`VERSION_CONFLICT` / `FILE_STATE_INVALID` / `change_flow_not_open`）。

> **本表状态（Push 143 · M3-03 完成门禁 + ADR-024 成果文件多选）**：`Task` 族 `deliverable` → `deliverableTypes: DocType[]`（数组、服务端去重、空数组 = 不要求；生成后锁定，A1-17）；新增完成门禁端点 `GET /projects/{id}/tasks/{taskId}/can-complete`（`TaskCanCompleteResponse` = `canComplete` + `missing[]` + `warnings[]`）与 `POST /projects/{id}/tasks/{taskId}/complete`（`TaskCompleteBody` = `version` + 可选 `actualEnd` / `note`；`TaskCompleteResponse` = `{ task, warnings }`），缺件明细 `TaskGateMissing`、放行提示 `TaskGateWarning`（`draft_doc_present`）；错误码新增 422 `TASK_REQUIRED_DOC_MISSING` 与 409 `TASK_ALREADY_DONE`。生成物已重出（paths = 62、schemas = 150），`npm run check` 零漂移。

> **本表状态（PR-8 · Push 149 · M4-04 变更读面）**：**契约零改动** —— `ChangeRequest` / `ChangeRequestDetail` / `ChangeRequestListQuery` 三 schema 与 `GET /projects/{id}/change-requests`、`GET /change-requests/{id}` 两条路径在「契约切片 · M4-04 / M4-05 前置」已入（paths = 66 / schemas = 159 不变）；本次为服务端实现落地（列表：阶段 / 节点 / 文件 / 申请人筛选 + 关键字 + 白名单排序 + 分页；详情：变更 + 变更后文件 + 版本；派生字段由 `file_versions.change_request_id` 反查，库侧随迁移 `0021` 补部分索引）。生成物零漂移，`npm run check` 通过。（`shared/` 属 wmj 线，本条随 PR 代记，请 wmj 复核。）

> **本表状态（PR-7 · Push 146 · M4-04 变更写入 + 变更关联多条）**：① 写入面（Push 141）**契约零改动** —— 放开上传入口 `intent=change`（目标须 final / changed；非该状态 409 `FILE_STATE_INVALID`）与「定档后回溯 = 变更流」，删除切片守卫 `intent_change_not_open` / `change_flow_not_open`；② **本批契约改动（跨线，请 wmj 评审）**：`Task.changeRef`（单值）→ `Task.changeLinks: TaskChangeLink[]`（`{ id, reason, appliedAt }`；A1-07「追加＋去重」**可多条**，业务要求「变更关联」列展示多条），`TaskListItem` / `TaskDetail` 的单条 `changeSummary` 下线；生成物已重出（并入 j6 后 paths = 66、schemas = 159 —— 本批新增 `TaskChangeLink` 1 个 schema），`npm run check` 零漂移。变更读面（`GET /projects/{id}/change-requests` / `GET /change-requests/{id}`）与统计（A4-17）随 M4-04 下一切片（按 `tasks.change_refs` 取关联，不再按 doc_type 派生），预览（M4-05）随后。

> **本表状态（Push 144 · j6 干系人台账）**：新增契约 `shared/src/modules/stakeholders.ts` —— `StakeholderSchema`（八业务字段 + `projects[]` 关联 + 台账留痕；六个受保护字段一律 `nullable().optional()`：**无权 = 键不存在，有权但值为空 = null**）、`StakeholderCreateBodySchema`（`projectIds` 可一并关联）/ `StakeholderUpdateBodySchema`（null = 清空）/ `StakeholderListQuerySchema`（`q` / `filter[companyType]` / `filter[projectId]` / 排序白名单）/ `StakeholderListResponseSchema` / `StakeholderProjectLinkBodySchema` / `StakeholderDeleteResponseSchema`；`AUDIT_OBJECT_TYPES` 增 `stakeholder`（跨线改动，请 lan 评审）；OpenAPI 新增 7 条路由（tags=stakeholders；GET / POST `/stakeholders`、GET / PATCH / DELETE `/stakeholders/{stakeholderId}`、POST `/stakeholders/{stakeholderId}/projects`、DELETE `…/projects/{projectId}`）。生成物已重出（paths = 66、schemas = 158），`npm run check` 零漂移。
> **本表状态（Push 150 · M3-04 任务批量操作）**：新增 `PATCH /api/v1/projects/{id}/tasks/batch` —— `TaskBatchBody`（`ids` 1~100、重复 id 去重后按首次出现顺序 + `changes`）+ `TaskBatchChanges`（白名单：ownerIds / status / plannedStart / plannedEnd / estimatedDays / headcount / priority / note；语义同单条编辑：null = 清空、缺键 = 不改；**不含**任务描述 / 成果文件（A1-17 生成后锁定）与 sortIndex）+ `TaskBatchResponse`（total / succeededCount / failedCount / succeeded / failures；`TaskBatchFailureCode` 六值：not_found / archived / gate_not_passed（带 missing[]，与完成门禁同形）/ already_done / version_conflict / invalid_state）；批量完成（changes.status=done）与单条编辑 / `POST …/complete` 共用同一完成门禁；审计双层 = 批次一条（`project` 域，metadata 记 batchId / taskIds / changedFields / 计数 / failures[]，A1-08「整体写审计日志」）+ 逐条字段级一条（entry=batch + 同批 batchId）；无新错误码。并入 main 后与 lan 的 `Task.changeLinks`（`TaskChangeLink` 1 个 schema）叠加，生成物重出（paths = 67、schemas = 164），`npm run check` 零漂移

> **本表状态（Push 152 · M3-05 任务软删）**：新增 `DELETE /api/v1/projects/{id}/tasks/{taskId}`（tags=tasks）—— 响应 `TaskDeleteResponse`（`{ id, deleted: true }`；软删只回标记，前端列表本地移除即可）；**错误码新增 409 `TASK_HAS_REFERENCES`**（已有变更关联的任务不允许删除，系统功能书 A2-01；`details[].code = change_ref` 带 `changeRequestId`）—— 重复删除与已删任务上的一切写操作沿用**统一 404**（不新增错误码，记录级 404 语义）；生成物已重出（**paths = 67 不变**（delete 与既有 `/tasks/{taskId}` 同路径、仅增方法）、**schemas = 165**（+`TaskDeleteResponse`），`npm run check` 零漂移）。

> **本表状态（Push 153 · M3-05 续卡 · 锁定字段例外调整 A1-17 / C9-07）**：新增 `PATCH /api/v1/projects/{id}/tasks/{taskId}/locked-fields`（tags=tasks）—— body `TaskLockedFieldsAdjustBody`（`version` + `reason` 必填 1~500 + 可选 `title` / `titleEn` / `deliverableTypes`；服务端至少一个实际变化，否则 400 `VALIDATION_FAILED`）+ 200 返回 `Task`；**仅系统管理员**（非管理员 403，复用既有 `FORBIDDEN` 与控制器 `task.update` 上下文门禁）；**错误码零新增**（409 `VERSION_CONFLICT` / `PROJECT_ARCHIVED`、404 统一）；生成物已重出（**paths = 68**（+1）、**schemas = 166**（+`TaskLockedFieldsAdjustBody`）），`npm run check` 零漂移。

> 用途：按 ADR-018 八步流水线的第 2 步，「每张卡开工前先登记契约增量」——本表是各里程碑卡片在契约层的预计改动；落地时逐卡把「待新增 / 待修改」改为「已入（Push N）」并同步生成物。
> **本表状态（Push 155 · M6-01 ~ M6-03 日报 / 问题第一刀）**：新增契约 `shared/src/modules/reports.ts`（`DailyReportState` 三值 / `DailyReportWriteState` 二值 / `DailyReport` / `DailyReportCreateBody`（`foundIssue` 非空 → 问题归类必填的 superRefine）/ `DailyReportUpdateBody`（乐观锁 + `date` 不可改）/ `DailyReportListQuery` / `DailyReportListResponse`）与 `shared/src/modules/issues.ts`（`IssueState` 四态 / `IssueCategory` 十项 / `IssueSchema` / `IssueListQuery` / `IssueListResponse` / `IssueUpdateBody` / `IssueEvent` / `IssueDetail`）；路由**项目嵌套**（`GET|POST /api/v1/projects/{id}/reports`、`GET|PATCH …/reports/{reportId}`、`GET …/issues`、`GET|PATCH …/issues/{issueId}`；tags = reports / issues）—— A21 提案的扁平路径（`/reports/{id}`）在 `ProjectAccessGuard` 下拿不到项目上下文，差异登记（前端功能需求.md §3.8 A21）；`PERMISSION_KEYS` 补四键（`report.view` / `report.fill` / `issue.view` / `issue.manage`，27 → 31 键；admin 全量、成员平权经 `PROJECT_MEMBER_IMPLIED_KEYS`）；`AUDIT_OBJECT_TYPES` 增 `daily_report` / `issue`；错误码增 `REPORT_ALREADY_EXISTS`（409）。
> **本表状态（Push 173 · C9-02 字典删除口径修订）**：`shared/src/modules/dicts.ts` 新增 `DELETE /api/v1/dicts/{type}/items/{code}`（物理删除 · 仅 `dict.manage` · 删除前快照写审计 · 未知类型 / 未知条目 404 · 200 = 删除后的整个字典）并在 `shared/src/openapi.ts` 注册 delete path（**paths = 72 不变** —— 与既有 PATCH 同路径、仅增方法，**operations 92 → 93**；**schemas = 182 不变**）；`DictItemSchema.enabled`、`DictReadQuerySchema`（includeDisabled）与 `DictItemUpdateBodySchema.enabled` 标注为**兼容字段 / 兼容参数**（Push 173 起删除走 DELETE，一期不再产生停用项；保留给二期「临时下架」与存量数据）。生成物已重出（`generated/openapi.json` + `generated/api-types.d.ts`），`npm run check` 零漂移。（跨线：契约 + 后端 + 迁移已获业务批准同批落地，请 wmj 评审。）
>
> **Push 174 追加（C9-02 引用守卫）**：`DictItemSchema` 新增 `usageCount`（引用该码的**未删除项目**数：region → `projects.region`、projectType → `projects.project_type`；其余维度恒 0；读侧派生、非库内列），`shared/src/common/errors.ts` 新增错误码 `DICT_ITEM_IN_USE`（409），`openapi.ts` 的 `DELETE /api/v1/dicts/{type}/items/{code}` 补 409 响应、`GET /api/v1/dicts` 摘要点明 `usageCount`；**paths / operations / schemas 计数不变**（只加字段与错误码），生成物重出、`npm run check` 零漂移。
> **本表状态（Push 161 · M5-01 规则引擎内核契约切片）**：新增 `shared/src/modules/automation.ts` —— 规则模型（`AutomationRuleSchema` = code / name / enabled / trigger / conditions / actions / version）与支撑枚举 / schema：`AUTOMATION_RULE_CODES`（R01 ~ R07 + A01 / A02 / A03 / A14）、`RULE_TRIGGER_KINDS`、`RULE_EVENT_TOPICS`（task.completed / change.applied 等 7 个 outbox 主题）、`RULE_SCHEDULE_WINDOWS`（T_MINUS_1 / SAME_DAY / T_PLUS_1 / WEEKLY）、`RULE_CONDITION_OPERATORS`（13 个白名单操作符）、`RULE_ACTION_KINDS`、`NOTIFY_CHANNELS`（wecom_app / wecom_group / inbox / email）、`RULE_RECIPIENTS`、`AUTOMATION_RUN_STATUSES` 与 `AutomationTriggerSchema` / `AutomationConditionSchema` / `AutomationActionSchema` / `AutomationMessageTemplateSchema`。**paths / operations / schemas 计数不变** —— 本切片尚无端点（规则管理端点随 M5-06 · lan 接入时再扩 `openapi.ts`，届时计数一并更新），生成物逐字节不变、`npm run check` 零漂移；引擎实现与金标用例见 `server/src/modules/automation/README.md`、逐字文案基准见 `docs/rules/R01-R07-内置规则文案.md`。
> **本表状态（Push 162 · M6-01 收口 · 日报当日读接口）**：`shared/src/modules/reports.ts` 新增四件 —— `DailyReportDayQuery`（`date` 可选，缺省 = 今天（Asia/Shanghai）、未来日期 400；汇总与应填未填共用）、`DailyReportRosterEntry`（名册成员当日填报状态：`userId` / `username` / `displayName` / `roleInProject` / `reportId` / `state`（null = 未填报）/ `submittedAt`）、`DailyReportMissing`（**A7-05 应填未填**：`memberCount` / `submittedCount` / `draftCount` / `missingCount` / `members[]` / `missingUserIds[]` + 工作日历随行 `isWorkday` / `dayKind` / `dayName`）、`DailyReportSummary`（**A7-01 当日汇总**：`entryCount` / `draftCount` / `headcountTotal` / `issueCount` / `entries[]`）；`openapi.ts` 注册两条读路径 `GET /api/v1/projects/{id}/reports/summary` 与 `GET /api/v1/projects/{id}/reports/missing`（tags = reports，均为 `report.view`）—— **paths 72 → 74、operations 93 → 95、schemas 182 → 185**（本切片增量；并入 main 的 Push 179（M3-07 刀 1 · 汇总卡两字段与紧急重要度三档）后合并基线 = **paths = 74、operations = 95、schemas = 186**）；生成物已重出（`generated/openapi.json` + `generated/api-types.d.ts`），`npm run check` 零漂移。
> **本表状态（Push 163 · M5-05 余项 · 自动化 A 系列枚举扩项）**：`shared/src/modules/automation.ts` 扩两项 —— `RULE_SCHEDULE_WINDOWS` 增 `T_PLUS_3`（基准日后 3 天；A03 升级窗口，ADR-026）、`RULE_RECIPIENTS` 增 `report.member`（日报名册成员；A01 应填未填收件人），两者描述同步更新为按规则标注口径（SAME_DAY 标 A01 / A02 / A14，T_PLUS_1 标 A03 提醒）。**paths / operations / schemas 计数不变**（纯枚举取值扩展，无新端点点位）—— 本切片无端点、automation 模块尚未注册进 OpenAPI 文档（规则管理端点随 M5-06 · lan 入 paths），**生成物逐字节不变**、`npm run check` 零漂移；规则实现与金标见 `server/src/modules/automation/README.md`、文案基准见 `docs/rules/A01-A03-A14-扩展规则文案.md`。
> 现状（契约切片 · Push 162 · M6-01 收口后，并入 Push 179 · M3-07 刀 1）：**paths = 74、operations = 95、schemas = 186**（Push 89 · h4 基线 49 / 117；此后 h6 / h7 / h8 / M4-01~03 / M4-04-05 前置切片 / M3-03 / j6 / PR-7 变更关联多条 / M3-04 / M3-05 锁定字段例外调整 / M6-01~03 日报与问题 / C9-02 字典删除口径 累计），生成物与源码零漂移（Push 71 基线 44 / 108；Push 80 / 81 / 83 / 89 未新增路径，h4 仅新增错误码）。
> 已入契约的族：projects（列表 / 详情 / 创建 / 更新 / 软删 / facets / 时间区间 / 排序白名单）、tasks（列表 / 详情 / 创建 / 编辑 / 进度 / 删除 / 锁定字段例外调整 / from-template / 完成与预检 / 批量 / 变更关联多条）、flow（蓝图保存发布导入导出与版本化 / 项目流程 / 阶段列表与推进回退 / 节点增删 / 完成与预检）、templates（任务节点库 / 任务模板 CRUD）、files（上传会话 / 版本 / 定档 / 回滚 / 回收站 / 下载 / 变更 / 文件库列表 GET /projects/{id}/files（M4-03 起用）/ 预览 GET /files/{id}/preview（M4-04-05 前置切片入，含可选 versionId））、reports（日报列表 / 详情 / 创建 / 编辑 + **当日汇总 `GET …/reports/summary`（A7-01）+ 应填未填 `GET …/reports/missing`（A7-05）** —— Push 162 入 paths）、issues（问题列表 / 详情 / 更新）、identity（/auth/* 四条 + /auth/me）、users（目录 / 偏好）、dicts（region / projectType 下发 + 条目新增 / 更新 / 删除）、stakeholders（干系人台账 CRUD + 项目关联与反查 · j6）、automation（规则模型 / 触发 / 条件 / 动作 / 模板与运行态枚举 —— M5-01 切片入源，端点随 M5-06 入 paths）。

### M1 身份与平台底座（h1 + 平台）

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| 组织 / 角色 / 通讯录同步 | 组织同步为内部作业（worker），**暂无新端点**（数据面 0007 已落 · Push 74；端点仍未开）；用户目录 `q` 补拼音检索口径（ADR-021）。管理端组织维护（D1-06）若做，另补 /departments、/roles 族 | 说明 |
| 字典管理（C9-01 / C9-02） | 已入（h7 · Push 97；Push 168 权限修订；**Push 173 删除口径修订**）：`POST /dicts/{type}/items`（region 登录即可、其余 `dict.manage`）、`PATCH /dicts/{type}/items/{code}`、**`DELETE /dicts/{type}/items/{code}`（物理删行；删除前快照写审计 `action=delete`；未知类型 / 未知条目 404；响应 = 删除后的整个字典）**；`DictItem.enabled` 与 `includeDisabled` 降级为**兼容字段 / 兼容参数**（二期「临时下架」用）；**Push 174：条目被未删除项目引用时 `DELETE` 返回 409 `DICT_ITEM_IN_USE`（不删行、不写审计），下发条目带 `usageCount` 供前端置灰** | 端点 |
| 高风险重认证（D1-05） | 新增 `POST /auth/mfa/verify` | 端点 |
| 幂等 / outbox / 权限策略 | 内部实现，无契约变化（`Idempotency-Key` 已在约定层） | 无 |

### M2 项目纵切（h2）

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| M2-01 项目 CRUD | 已入：CRUD / 软删 / 乐观锁 HTTP 落地（Push 80）+ 本轮补归档写保护错误码 `PROJECT_ARCHIVED`（ADR-027）；`Project.archivedAt` 未加 —— 随归档端点 `/projects/{id}/archive` 与 `archived_at` 列（C4-02 / M6）一并落 | 错误码 / 字段 |
| M2-02 建项目 + 蓝图快照 | 已入（Push 83）：`BlueprintSchema.projectType`（可选）；`BlueprintView` 增 `projectType` / `isDefault` / `publishedVersion`（+ `BlueprintQuerySchema` 按类型取）；`ProjectFlow.blueprintVersion`（0 = 未导入快照）；建项目单事务导入 stages / nodes / requirements | 字段 |
| M2-03 阶段推进 / 回退 | 已入（Push 83）：`GET /projects/{id}/stages`、`POST …/stages/{key}/advance`（正文仅 `version`）、`POST …/rollback`（`reason` 必填 + `version`）；`StageListResponse` = 阶段状态 + 节点 / 任务完成度 + 留痕字段；新增 422 `STAGE_GATE_NOT_PASSED`（+ `BLUEPRINT_NOT_PUBLISHED`）与 409 `NODE_HAS_FILES` / `STAGE_STATE_INVALID` / `NODE_ALREADY_EXISTS` 错误码（ADR-023） | 端点 / 错误码 |
| M2-05 成员与记录级权限 | 已入：`GET / POST / DELETE /projects/{id}/members`（幂等 upsert / 不是成员统一 404，Push 81）；记录级**过滤**（列表 / 详情 / facets / 搜索按成员裁剪）随 h6 | 端点 |
| M2-06 视图 / 关注 | 新增 `/views`（个人 / 公共 CRUD）与 `/follows`（关注 / 取关） | 端点 |
| M2-04 列表 / facets | 已入（A1 / A9）并 HTTP 落地（Push 80：列表与 facets 同一 filter 构造器、上海时区日界、排序白名单 `updatedAt` / `createdAt` / `seqNo`）；**Push 175 修订：时间区间维度改 `created_at`、`sort` 缺省改 `createdAt:desc`（契约描述 + 生成物重出，无 schema 结构变化）** | 无 |

### M3 任务纵切（h3 / h4）

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| M3-01 列表 / 详情 | 已入（A7 / A8）并 HTTP 落地（Push 89）；**快筛参数未做**（`filter[mine]` / `dueToday` / `dueThisWeek` / `overdue` / `incomplete` / `missingDeliverable`，随 k4 接线前按前端实际使用补） | 参数 |
| M3-02 进度与状态 | 已入（A12~A14）并 HTTP 落地（Push 89）；系统置位无契约变化（ADR-025，随调度卡片 i5）；新增 409 `TASK_ALREADY_EXISTS`（`taskNodeId` 判重） | 无 / 错误码 |
| M3-03 完成门禁 | **已入并 HTTP 落地（Push 143）**：新增 `GET /projects/{id}/tasks/{taskId}/can-complete` + `POST …/complete`；`422 TASK_REQUIRED_DOC_MISSING` + `{ missing[], warnings[] }`、409 `TASK_ALREADY_DONE`；`deliverableTypes` 多值同批落地（A4-20 / ADR-024） | 端点 / 错误码 / 字段 |
| M3-04 批量操作 | **已入并 HTTP 落地（Push 150）**：`PATCH /projects/{id}/tasks/batch`（`TaskBatchBody` / `TaskBatchChanges` / `TaskBatchResponse` + `TaskBatchFailureCode` 六值；字段白名单 + 逐条独立事务 + 部分失败清单 `failures[]`，批量完成走同一门禁） | 端点 |
| M3-05 模板锁定与修正 | `deliverableTypes: DocType[]` **已随 M3-03 落地（Push 143）**；锁定字段例外调整（描述 / 英文描述 / 输出成果文件：仅管理员 + 原因必填留痕 + 空调整 400）**已落 Push 153**（`PATCH …/locked-fields` + `TaskLockedFieldsAdjustBody`；ADR-024 / A1-17；「阶段性里程」一期无列，差异登记）—— 与本行同卡的**任务软删（A25）已落 Push 152**（见下行） | 字段 |
| 任务软删（A25） | **已入并 HTTP 落地（Push 152）**：`DELETE /projects/{id}/tasks/{taskId}` + `TaskDeleteResponse` + 409 `TASK_HAS_REFERENCES`；**引用口径按系统功能书 A2-01** —— 已产生变更（`change_refs` 非空）的任务不允许删除（日报 / 问题随 M5 落表后加判定），**不是「任意引用一律拒绝」**；重复删除 = 统一 404（原「被引用即拒绝 + `TASK_DELETED` 501 语义」建议作废） | 端点 / 错误码 |
| 流程节点（h3） | 节点增删已入；权限口径按 ADR-020（403 语义声明，无字段变化） | 说明 |

### M4 文件与预览（i1 / i3）

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| i1 文件管道 | files 族已入（Push 41）：上传会话 / 分片 / 完成 / 中止 / 定档 / 回滚 / 回收站 / 下载；落地时复核错误码（`UPLOAD_INCOMPLETE` / `UPLOAD_SESSION_EXPIRED` / `FILE_HASH_MISMATCH` / `CHANGE_FILE_REQUIRED` 已登记）；**M4-01 复核（PR-4 · Push 129，跨线请 wmj 评审）**：错误码沿用既有（V0.3 命名），`AUDIT_OBJECT_TYPES` 增 `file`（审计对象 id = fileId，上传会话事件经 metadata.uploadId 定位）；**上传入口 `fileId` 定案（Push 130 · wmj）**：`intent=change` 必填 `fileId`、`intent=version` + `fileId` = 既有 draft 文件替换 / 追加版本（见上「上传」行）；M4-01 切片内 `change` / 带 `fileId` 一律显式 400（守卫），**M4-02 落地（PR-5 · Push 131）**：`version + fileId` 已放开（对既有 draft 文件替换 / 追加版本；非 draft → 409 `FILE_STATE_INVALID`、名称 / 归属不一致 → 400），`change + fileId` 仍 400（随 M4-04）；**M4-03 落地（PR-6 · Push 132）**：`GET /projects/{id}/files` 起用（查询 / 响应契约零改动），`file_links` 六类关联表随 0016 迁移落地，写入口径 = 上传完成（project 必写 / node / task 有则写 / 幂等），读面 = 项目可见即可 + 默认排除 recycled | 复核 |
| i3 预览 | **已入（契约切片 · M4-04 / M4-05 前置）**：新增 `GET /files/{id}/preview`（`FilePreviewResponse` = 状态 + 目标 + 短时签名 URL + `pipelineVersion` + `generatedAt`；ready / not_ready / failed 三态，后两者 200 语义对齐 v0.2 §7.2 已登记错误码）+ `PreviewTarget` 枚举（渲染通道）+ 可选 `versionId`（A4-06）；实现（M4-05：converter 沙箱 / 队列 / 缓存 / 失败降级）待落 | 端点 / schema |

### M5 自动化与通知（i8 / notify）

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| i8 规则引擎 | 新增 `/automation/rules` 族（CRUD + 启停 + 试运行）与命中留痕查询；`RATE_LIMITED` 复用 | 端点 |
| notify | 新增 `/notifications`、`/notifications/stream`（SSE）、免打扰与消息偏好 | 端点 |
| R01~R07 文案 | 非契约；文案入仓 `docs/rules/R01-R07-内置规则文案.md`，消息模板表随 M5 | 无 |

### M6 日报 / 问题 / 干系人 / 工作台 / 归档

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| 日报 | **已入并 HTTP 落地（Push 155）**：`/api/v1/projects/{id}/reports` 族（草稿 / 提交 / 补填 / 关联任务；`DailyReport*` 五 schema + `DailyReportState` / `DailyReportWriteState`；补填由服务端按日期推导） | 端点 |
| 问题 | **已入并 HTTP 落地（Push 155）**：`/api/v1/projects/{id}/issues` 族（四态流转 + 处理过程留痕；问题追踪表与看板同源；统计随 M7 仪表盘）；`Issue.dueAt`（ADR-026，一期仅落库）；**四态允许回退** —— 不设流转白名单，不做 `ISSUE_TRANSITION_INVALID`（差异登记：写事件即留痕） | 端点 / 字段 |
| 干系人 | 新增 `/stakeholders`（台账 + 批量导入 + 导出；隐私字段走字段级权限） | 端点 |
| 待办（C2-06） | 新增 `/todos` | 端点 |
| 归档（C4-02 / C4-03） | 新增 `POST /projects/{id}/archive` 与 `GET /projects/{id}/archive`（清单）；写保护 `PROJECT_ARCHIVED`（ADR-027） | 端点 / 错误码 |

### M7 搜索 / 仪表盘 / 导出

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| 搜索 | 新增 `/search`（对象类型过滤 + 高亮；分词先行 pg_trgm，ADR-029） | 端点 |
| 仪表盘 | 新增 dashboard 统计端点（按对象类型聚合） | 端点 |
| 导出 | 新增 `/exports` + 进度查询 | 端点 |

### M8 迁移与上线

| 卡片 | 契约增量 | 类型 |
|---|---|---|
| 迁移工具链 | 内部作业；仅需冻结历史映射字段（ADR-021 用户映射、v0.3 §7.3 #8 阶段映射） | 无 |

### ADR → 契约影响索引（M0 决议 · Push 71）

| ADR | 契约影响 | 落地卡 |
|---|---|---|
| ADR-019 蓝图组织 | 已入（Push 83）：`BlueprintSchema.projectType`、`BlueprintView` 类型标识与发布版本 | M2-02 |
| ADR-020 节点权限 | 已入（Push 83）：接口 403 语义（模板写 = 管理员、增删 / 推进 = 项目经理）；权限矩阵用例随 h6 | M2-05 |
| ADR-021 负责人标识 | Task 族 `ownerIds` 数组（空数组 = 待分配，A23 · Push 136 多位）+ `ownerNames` 同下标数组；撤回 A10 兜底描述；用户目录 q 拼音口径 | M1 / M3 |
| ADR-022 项目时间语义 | 无契约变化（`updatedAt` 已在，语义在服务层）；**Push 175 修订：列表缺省排序与「项目时间」区间筛选维度均由「最近活动 `updated_at`」改为「创建时间 `created_at`」** | M2-04 |
| ADR-023 阶段推进 | 已入（Push 83）：stages 查询 / advance / rollback + `STAGE_GATE_NOT_PASSED` + 缺项明细 | M2-03 |
| ADR-024 成果文件 | **已入（Push 143）**：`deliverableTypes` 数组 + 完成 / 预检端点 + `TASK_REQUIRED_DOC_MISSING` / `TASK_ALREADY_DONE`；锁定字段例外调整留痕 **已落 Push 153**（仅管理员 + `reason` 必填） | M3-03（已落）/ M3-05（已落） |
| ADR-025 进行中置位 | 无契约变化（系统作业） | M3-02 |
| ADR-026 问题 SLA | `Issue.dueAt` | M6 |
| ADR-027 归档 | archive 端点 + `PROJECT_ARCHIVED` | M6 / M7 |
| ADR-028 时区口径 | 无字段变化（展示与日界口径写入公约，见「已定案口径」） | 约定 |
| ADR-029 搜索分词 | 无契约变化（索引与实现） | M7 |

### 维护规则

- 每张卡开工前更新本表（「已入（Push N）」），并在同一 PR 内执行 `npm run generate` + `npm run check`；
- 契约变更属高风险（CONTRIBUTING §15）：需非作者评审；
- 生成物禁止手改（CONTRIBUTING §14）；本表与 `技术设计v0.3-实施与验收.md` §3 的接口表保持同口径，冲突时以本包 src 为准。

## 边界与注意事项

- 本包只定义契约与生成物，不含服务端实现与数据库迁移（分别在 server/ 与 database/ 落地）。
- 生成物禁止手改；改契约必须改 src 下的 Zod schema 并重新生成（CONTRIBUTING §14）。
- 消费方（server / frontend）引用方式待仓库结构定案（v0.1 Q15：frontend 原地演进 vs workspace）。
- 依赖说明：Node >= 24；zod 4.6；TypeScript 5.9（openapi-typescript 的 peer 要求 ^5.x）。
  前端当前为 TypeScript 7.0.2 —— 版本差异已登记在 ADR-017「待复核差异」，评审时一并定案。
