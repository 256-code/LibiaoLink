# file 模块（S7·file：上传管道 + 版本 / 定档 / 回溯 / 回收站 + 文件库查询与多态关联 + 变更申请即通过（写入 + 读面）+ 预览数据层已落地）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 文件、版本、定档、变更（申请即通过）、预览编排、回收站 |
| 主责 | lan（团队分工.md §2 后端平台） |
| 预留对外接口 | FileService、PreviewService、ChangeService |
| 依据 | 系统功能书 A4-01~A4-18 / D2；技术设计v0.2 §5.1-5.3；契约 shared/src/modules/files.ts；ADR-006（对象键形态）/ ADR-022（不触发 projects.updated_at） |

## 文件

```text
file.controller.ts   # HTTP 面：/api/v1/files（会话 + CSRF 守卫；权限在服务层判定）
file-library.controller.ts  # HTTP 面：/api/v1/projects/{id}/files 文件库列表（会话 + CSRF + ProjectAccessGuard）
change.controller.ts # HTTP 面：/api/v1/change-requests/{id} 变更详情（会话 + CSRF；可见性在服务层按变更所属项目判定，非成员 404）
change-library.controller.ts # HTTP 面：/api/v1/projects/{id}/change-requests 变更记录列表（会话 + CSRF + ProjectAccessGuard）
change.query.ts      # 变更列表查询解析（纯函数）：阶段（多值 / 九阶段字典校验）/ 节点 / 变更文件 / 申请人 / 关键字 / 排序白名单；非法一律 400
change.service.ts    # 读面业务（M4-04 读面）：变更记录列表 / 详情（变更后文件与版本由 file_versions 反查；视图复用写入面映射）
file.query.ts        # 文件库查询解析（纯函数）：筛选（多值 / UUID）/ 关键字 / 排序白名单；非法一律 400
file.service.ts      # 业务：上传管道（发起 / 分片 / 状态 / 完成 / 取消 / 过期清理 EXPIRE_SWEEP_BATCH）+ 生命周期（详情 / 版本链 / 定档 / 回溯 / 回收 / 恢复 / 彻底删除 / 到期清理 RECYCLE_SWEEP_BATCH）+ 变更写入（M4-04：intent=change 完成上传 / 定档后回溯 → change_requests + 版本挂 change_request_id + R01 回写 tasks.change_refs（追加 + 去重、可多条），变更记录先行两段式；视图映射器 toFileView / toVersionView / toChangeRequestView 导出供 change.service.ts 读面复用，避免读写两处口径漂移）
file.repository.ts   # 数据访问：files / file_versions / upload_sessions / file_links / change_requests（M4-04 写 + 读面：listChangeRequests / findChangeRequestJoinedById 内连接 file_versions 反查 fileId / versionId / versionSeq）（写路径由服务层开事务传 tx；关键路径 for update）
file.module.ts       # DI 装配（identity 守卫 / permission / admin 审计；ClockService；FileService + ChangeService 双服务）
index.ts             # 唯一公开出口（跨模块只允许 import 本文件）
```

## 已落接口（M4-01 上传管道 · PR-4 · Push 129；M4-02 版本 / 定档 / 回溯 / 回收站 · PR-5；M4-03 文件库列表 · PR-6；M4-04 变更写入随上传管道复用 · PR-7；M4-04 变更读面 · PR-8）

| 路径 | 说明 | 响应码 | 权限 |
|---|---|---|---|
| `POST /api/v1/files/uploads` | 发起上传（建 draft 文件 + 会话；带 contentHash 回秒传提示） | 201 | `file.upload` |
| `POST /api/v1/files/{id}/uploads/{uploadId}/parts` | 批量取分片预签名 URL（首传 / 续传共用） | 200 | `file.upload` |
| `GET /api/v1/files/{id}/uploads/{uploadId}` | 会话状态（已传 / 缺失分片；续传依据） | 200 | 项目可见即可 |
| `POST /api/v1/files/{id}/uploads/{uploadId}/complete` | 完成（合并 → 校验 → 复制契约键 → 落版本） | 200 | `file.upload` |
| `POST /api/v1/files/{id}/uploads/{uploadId}/abort` | 取消（幂等） | 200 | `file.upload` |
| `GET /api/v1/files/{id}` | 文件详情（含当前版本；回收站文件也可读） | 200 | 项目可见即可 |
| `GET /api/v1/files/{id}/versions` | 版本链（按 seq 升序；只读不删历史） | 200 | 项目可见即可 |
| `POST /api/v1/files/{id}/finalize` | 定档锁版（draft → final；至少 1 个版本；乐观锁） | 200 | `file.upload` |
| `POST /api/v1/files/{id}/rollback` | 回溯生成新版本（复制目标版对象；定档后 = 变更流，M4-04 已落地） | 200 | `file.upload` |
| `POST /api/v1/files/{id}/recycle` | 移入回收站（任意状态可删；保留 30 天可恢复） | 200 | `file.upload` |
| `POST /api/v1/files/{id}/restore` | 恢复（回到进入前状态） | 200 | `file.upload` |
| `POST /api/v1/files/{id}/purge` | 彻底删除（仅管理员；仅回收站文件；对象 + 元数据一并清） | 200 / 403 | 仅系统管理员 |
| `GET /api/v1/projects/{id}/files` | 文件库列表（筛选 / 关键字 / 白名单排序 / 分页；默认排除 recycled） | 200 | 项目可见即可 |
| `GET /api/v1/projects/{id}/change-requests` | 变更记录列表（阶段 / 节点 / 变更文件 / 申请人筛选 + 关键字 + 白名单排序 + 分页） | 200 | 项目可见即可 |
| `GET /api/v1/change-requests/{id}` | 变更详情（变更记录 + 变更后文件 + 变更后版本） | 200 | 项目可见即可（服务层判定，非成员 404） |

- 实现口径（键形态 / 校验顺序 / 错误码 / 过期语义 / worker 清理）见 `server/README.md`「文件上传接口」与 `src/storage/README.md`；真机回放见 `docs/m4-01-回放证据(上传管道S7file).md`（变更回放见 `docs/m4-04-回放证据(变更申请即通过).md`）。
- 审计：`object_type = "file"`（objectId = fileId），上传会话事件经 `metadata.uploadId` 定位；过期清理为 system 审计（actorId = null）。
- **上传入口 `fileId` 分派（Push 130 定案 · wmj）**：`intent=version` 省略 `fileId` = 新建文件；**给出 = 对既有 draft 文件替换 / 追加版本（M4-02 已放开）**——目标 404（不存在 / 不可见）/ 与 `projectId` 不一致 400（`invalid_file`）/ `name` 与归属字段与现状不一致 400（`name_mismatch` / `doc_type_mismatch` / `node_mismatch` / `task_mismatch`）/ 非 draft 409 `FILE_STATE_INVALID`；`duplicateHint` 恒空。`intent=change`（M4-04 已放开）：目标须 final / changed，非该状态 409 `FILE_STATE_INVALID`、会话期间状态变化同样在 complete 时 409；变更载荷落 `upload_sessions.change_payload`，完成时同事务生效（错误码沿用 V0.3 既有，切片守卫已删除）。
- **M4-02 生命周期口径**：状态机 `draft → final → changed → archived`，任意态可 `recycled`；写操作一律带乐观锁 `version`（不匹配 409 `VERSION_CONFLICT`）；定档落 `finalized_*` 成对字段 + 审计 + outbox `file.finalized`；回溯生成新版本（复制对象到新契约键，不删历史），定档后回溯 = 变更流（M4-04 已落地：`change_requests` + 新版本挂 `change_request_id` + 状态 `changed`，详情见下）；回收落 `recycled_*` 三列 + `purge_after`（`FILE_RECYCLE_RETENTION_DAYS`，默认 30 天）；彻底删除仅管理员、仅回收站文件，对象按版本清 + 元数据删 + 留痕（`metadata.deletedVersions`），对象清理在持锁事务内（防并发恢复误删）。详见 `server/README.md`「文件生命周期接口」。
- **M4-03 文件库口径（PR-6）**：完成上传在同一事务写 `file_links`（**project 必写，node / task 有则写**；report / issue 随对应模块落地（change 已随 M4-04 写入）），唯一 `（file_id, object_type, object_id）` + `on conflict do nothing` 保证追加版本幂等；列表读 = 项目可见即可（`ProjectAccessGuard`，非成员 404），**默认排除 recycled**（显式 `filter[status]=recycled` 可查回收站），`filter[uploadedBy]` 口径 = `files.created_by`（追加版本的 `uploaded_by` 不作为筛选口径），非法输入 400 `VALIDATION_FAILED`。详见 `server/README.md`「文件库接口」；真机回放见 `docs/m4-03-回放证据(多态关联与文件库查询).md`。
- **M4-04 变更口径（PR-7 · 写入切片）**：入口 = **复用上传管道**（`intent=change` + `fileId`，目标须 final / changed；非该状态 409 `FILE_STATE_INVALID`、不存在 / 不可见 404、跨项目 400、名称与归属不一致 400），变更载荷随会话落 `upload_sessions.change_payload`；完成上传**同一事务**写 `change_requests`（status = applied，`stageKey` 缺省取文件节点所属阶段）→ 新版本挂 `change_request_id` → `files.status = changed` → `file_links`(change) → R01 回写 `tasks.change_refs`（追加 + 去重）→ 审计（`object_type = change` / `action = create`）→ outbox `change.applied`。**顺序不可颠倒**：`file_versions.change_request_id` 是即时外键，变更记录必须先行。定档后 `rollback` 走同一变更链路（`body.reason` = 变更原因），不再 400。详见 `server/README.md`「变更接口（S7·file · M4-04）」；真机回放见 `docs/m4-04-回放证据(变更申请即通过).md`。
- **M4-04 变更读面（PR-8 · A4-15）**：`GET /projects/{id}/change-requests`（阶段多值 / 节点 / 变更文件 / 申请人筛选 + 关键字命中原因与变更前后摘要 + 白名单排序 `appliedAt` / `createdAt` + 分页；默认 `created_at desc` + id 升序 tie-breaker，与 `ix_change_project` 同序）与 `GET /change-requests/{id}`（变更记录 + 变更后文件 + 变更后版本）。派生字段 `fileId` / `versionId` / `versionSeq` 由 `file_versions.change_request_id` **内连接**反查（一期一变更一版本，数据面不存在「无版本的变更」；迁移 `0021` 为该反查列补**部分索引** `ix_file_versions_change_request` —— 该 FK 列此前无索引，PG 不为外键自动建索引）。视图映射复用写入面的 `toChangeRequestView`（写 / 读同一份字段口径）。`filter[projectId]` 与路径项目不一致、非法阶段 / 排序字段 / 方向 / uuid 一律 400 `VALIDATION_FAILED`（不静默空列表）；非成员 404（列表 `ProjectAccessGuard`、详情服务层按变更所属项目判定，防 IDOR）。**契约零改动**（`ChangeRequest*` 三 schema 与两条路径早已随 M4-04-05 前置切片入 `shared/`）。
- **R01 口径（写入面）**：按「变更文件成果类型 ∈ 任务输出成果文件」（`tasks.deliverable_types @> array[doc_type]`，ADR-024 多值命中、GIN `ix_tasks_deliverable_types`；已随迁移 0018 落地）匹配同项目任务，命中多条全部**追加 + 去重**回写 `tasks.change_refs`（迁移 0020 起为 uuid[]，可多条：已关联过同一变更不重复、否则追加到数组末位 —— 数组顺序 = 关联先后，末位 = 最近一次变更；**一条任务可关联多条变更**，业务要求「变更关联」列展示多条）；回写**不递增**任务乐观锁（变更关联不视为任务编辑）；0 命中只 `warn` 不阻断。注意：`file_links`(change) 记的是**文件 ↔ 变更**，**不**承担「任务 ↔ 变更」明细（PR #111 评审订正）。读面：`Task.changeLinks` 随任务列表 / 详情下发多条（任务 ↔ 变更明细按 `change_refs` 直接取，不按 doc_type 派生）；变更记录读面（PR-8）走 `change_requests` + `file_versions` 反查，不经任务表。
- 文件上传**不触发** `projects.updated_at`（ADR-022 明示「不触发」：文件与变更各有自身时间字段）。

## 上游（直接复用，不重复造）

- `src/storage/`（经 `ObjectStorage` 端口注入，不直接碰 S3 SDK）：`createMultipartUpload` / `signPartUploadUrl` / `listParts` / `completeMultipartUpload` / `abortMultipartUpload` / `headObject` / `copyObject`（暂存键 → 契约键）/ `purgeObject`（**按版本**彻底删除）/ `probe`；`buildObjectKey` + `buildUploadStagingKey` + `planUpload` / `missingPartNumbers` + `toApiError`。
- 数据层：`files` / `file_versions` / `upload_sessions`（`database/migrations/0005_file_lifecycle.sql`；**分片状态不落表**，以 ListParts 为唯一真相）+ `idempotency_keys`（0006）+ `file_links`（`0016_file_links.sql` · M4-03：多态关联，`object_type` 六值 CHECK / 联合唯一幂等 / `(object_type, object_id)` 反查索引）+ `change_requests`（`0001_baseline.sql` · M4-04：一期申请即通过、只追加）+ `file_versions.change_request_id` 反查的部分索引（`0021_file_versions_change_request_index.sql` · M4-04 读面）+ `preview_artifacts`（`0024_preview_artifacts.sql` · M4-05 数据层：三元组缓存键 `content_hash + pipeline_version + target` 唯一 / 状态与契约 `PREVIEW_STATUSES` 同值 / `file_id` / `version_id` = 首次生成登记、读面按三元组命中）+ `audit_logs.action` CHECK 同步扩 `preview`。
- 横切：`AuditService`（同事务留痕）、`PermissionService`（`file.upload` / `file.download` 与记录级 404）、`ClockService`（会话到期判定，禁止直接取系统时间）。

## 待落地（按卡片）

- **M4-04**：写入面**已落地（PR-7）**、读面**已落地（PR-8）**（列表 / 详情，见上「M4-04 变更口径」「M4-04 变更读面」）；**剩余** = 变更统计（A4-17，无对外契约，口径由后续切片 / 仪表盘定）与通知（A4-18，随 M5；outbox `change.applied` 已埋点）。
- **M4-05**：预览编排（预览鉴权与产物，preview 模块）——**数据层已落地（PR-9 · 迁移 `0024`：`preview_artifacts` + `ck_audit_logs_action` 扩 `preview`；契约零改动、生成物零漂移）**；剩余 = 转换器与队列（outbox `preview.job` 领取 / 三元组幂等 / 失败降级）、读 API（三态 + 短时签名 + 仅 `ready` 写审计 + 版本 404）。
- 后续增强：回收站「到期前提醒 / 批量清理」、审计 `entry = "system"` 字段语义（现为 `entry = "api"` + `actorId = null` 表达系统触发）。
