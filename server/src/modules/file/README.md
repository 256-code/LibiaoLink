# file 模块（S7·file：上传管道 + 版本 / 定档 / 回溯 / 回收站 + 文件库查询与多态关联 + 变更申请即通过（写入 + 读面）+ 预览（数据层 + 转换队列 + 读 API + 产物清理收口）已落地）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 文件、版本、定档、变更（申请即通过）、预览编排（含产物对象清理收口）、回收站 |
| 主责 | lan（团队分工.md §2 后端平台） |
| 预留对外接口 | FileService、PreviewService、PreviewReadService、ChangeService |
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
file.service.ts      # 业务：上传管道（发起 / 分片 / 状态 / 完成 / 取消 / 过期清理 EXPIRE_SWEEP_BATCH）+ 生命周期（详情 / 版本链 / 定档 / 回溯 / 回收 / 恢复 / 彻底删除 / 到期清理 RECYCLE_SWEEP_BATCH）+ 变更写入（M4-04：intent=change 完成上传 / 定档后回溯 → change_requests + 版本挂 change_request_id + R01 回写 tasks.change_refs（追加 + 去重、可多条），变更记录先行两段式；视图映射器 toFileView / toVersionView / toChangeRequestView 导出供 change.service.ts 读面复用，避免读写两处口径漂移）+ 预览产物清理（M4-05 收口：purgeRecycled 按 content_hash 反查引用 —— 有引用则缓存行归属转移、无引用则清对象）
file.repository.ts   # 数据访问：files / file_versions / upload_sessions / file_links / change_requests（M4-04 写 + 读面：listChangeRequests / findChangeRequestJoinedById 内连接 file_versions 反查 fileId / versionId / versionSeq；M4-05 收口：findVersionByContentHash 同内容存活版本反查）（写路径由服务层开事务传 tx；关键路径 for update）
file.module.ts       # DI 装配（identity 守卫 / permission / admin 审计；ClockService；FileService + ChangeService + PreviewService（含 OutboxStore / PreviewRepository / PreviewConverter）+ PreviewReadService）
preview.job.ts       # 预览任务契约（纯函数）：topic `preview.job` / 载荷构造与解析 / 去重键 = 三元组（投递侧与消费侧共用一份，防两端拼装漂移）
preview.targets.ts   # 渲染通道选择（纯函数）：定档预生成投哪些 target（图片→image；PDF / Office（含 xlsx）→pdf；判不出类型不投）
preview.converter.ts # 转换沙箱客户端（M4-05c）：POST /convert 字节流进 / 字节流出 + GET /healthz 自检；错误面分类（可重试 / 确定性）；管线版本比对
preview.repository.ts # 数据访问：preview_artifacts（三元组读 / 首次登记 / ready 成对写 / failed 成对写 / M4-05 收口：listReadyByVersionIds 待清理候选 + reassignOwner 归属转移）
preview.service.ts   # 队列消费（M4-05c）：领 outbox → 读源字节 → 调转换器 → 产物回对象存储 → 更新 preview_artifacts → done / 重试 / dead
preview-read.service.ts # 读 API（M4-05d · PR-11）：GET /files/{id}/preview 三态 / 短时签名 / 仅 ready 写审计 / 版本 404 / 读取侧幂等补投与两类终态降级
index.ts             # 唯一公开出口（跨模块只允许 import 本文件）
```

## 已落接口（M4-01 上传管道 · PR-4 · Push 129；M4-02 版本 / 定档 / 回溯 / 回收站 · PR-5；M4-03 文件库列表 · PR-6；M4-04 变更写入随上传管道复用 · PR-7；M4-04 变更读面 · PR-8；M4-05c 预览转换队列 · PR-10 —— worker 侧无 HTTP 接口，见下「M4-05c 预览队列口径」；M4-05d 预览读 API · PR-11 —— `GET /files/{id}/preview`，见下「M4-05d 读 API 口径」；M4-05e 产物清理 · PR-12 —— 无新增 HTTP 接口（随彻底删除 / 回收站到期收口））

| 路径 | 说明 | 响应码 | 权限 |
|---|---|---|---|
| `POST /api/v1/files/uploads` | 发起上传（建 draft 文件 + 会话；带 contentHash 回秒传提示） | 201 | `file.upload` |
| `POST /api/v1/files/{id}/uploads/{uploadId}/parts` | 批量取分片预签名 URL（首传 / 续传共用） | 200 | `file.upload` |
| `GET /api/v1/files/{id}/uploads/{uploadId}` | 会话状态（已传 / 缺失分片；续传依据） | 200 | 项目可见即可 |
| `POST /api/v1/files/{id}/uploads/{uploadId}/complete` | 完成（合并 → 校验 → 复制契约键 → 落版本） | 200 | `file.upload` |
| `POST /api/v1/files/{id}/uploads/{uploadId}/abort` | 取消（幂等） | 200 | `file.upload` |
| `GET /api/v1/files/{id}` | 文件详情（含当前版本；回收站文件也可读） | 200 | 项目可见即可 |
| `GET /api/v1/files/{id}/versions` | 版本链（按 seq 升序；只读不删历史） | 200 | 项目可见即可 |
| `GET /api/v1/files/{id}/preview` | 预览状态与短时签名地址（三态；`?versionId=` 指定历史版本；not_ready 幂等补投，failed 降级「请下载」） | 200 | 项目可见即可 |
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

- **M4-05c 预览队列口径（PR-10 · D2-04 / D2-05 / D2-06 / D2-07）**：worker 领 outbox topic `preview.job`（切片边界 = 台账「outbox 领取器只落领取 + 消费 + 重试 + dead」，**不含规则 / 通知编排**），串行消费，单条最长占满客户端超时（默认 90s）。链路 = 领任务 → 读库内版本行与文件行（源对象键 / 内容哈希 / 大小 / MIME / 原名）→ `storage.getObject` 直读源字节 → `POST /convert`（**字节流进 / 字节流出**，不传对象键、不带 S3 凭证）→ `storage.putObject` 写 `previews/{contentHash}/{pipelineVersion}/{target}` → `preview_artifacts` 置 ready（`object_key` / `generated_at` 成对）→ outbox done。三元组合围：① 投递侧去重键 = 三元组（同三元组只一条任务；定档用 `appendOutboxIfAbsent`，dead 才唤醒）；② 消费侧先查 `preview_artifacts`（**ready 复用不重转**；**failed 是缓存态，不做原地重试** —— 管线修复由 `pipeline_version` 递增失效）；③ 对象键含三元组（换内容 / 换管线 / 换通道 = 新键，不覆盖旧产物）。
- **M4-05c 失败处置（D2-05 降级「请下载」）**：可重试 = 503 SERVICE_BUSY / 503 SERVICE_UNAVAILABLE / 504 CONVERT_TIMEOUT / 连接失败 / 客户端超时 / 源对象读不到 / 存储抖动 → 按 `PREVIEW_CONVERT_BACKOFF_MS` 指数退避（封顶 30 分钟），到 `PREVIEW_CONVERT_MAX_ATTEMPTS` 次转 dead；确定性 = 400 / 413 / 415 / 422 / 501 / **管线版本不一致** / 超大源文件（> `PREVIEW_CONVERT_MAX_SOURCE_MB`，默认 100MB）/ `structured` 通道一期未启用 → 一次即写 `preview_artifacts.failed`（error ≤ 500 字，直接作降级副行）+ outbox dead。降级只影响预览：文件本体与下载不受影响（出口标准「转换失败不影响下载」）。
- **M4-05c 触发点**：**定档预生成（P1）** = `finalizeFile` 在同一事务投 `preview.job`（只投当前版本、只投一期真能出产物的通道 —— `preview.targets.ts` 的映射：图片 → image、PDF / Office / xlsx → pdf、判不出类型不投）；**其余按需懒生成** = 读取侧（**已随 PR-11 落地**，见下「M4-05d 读 API 口径」）按 `not_ready` 幂等补投（`appendOutboxIfAbsent`）。上传完成**不**投递（draft 可能被替换，白转）。
- **M4-05c 审计口径（D2-07）**：**生成侧不写审计** —— 转换是系统内部副作用（产物状态由 `preview_artifacts` 留痕、任务进度由 `outbox_events.attempts` / `last_error` 留痕），审计只记**用户访问**（读取侧 `object_type = file` + `action = preview`，且**只对 ready 的读取**写，已随 PR-11 落地）；否则一次预览会写两条、把「查看 / 下载」审计计数翻倍。
- **M4-05d 读 API 口径（PR-11 · D2-04 / D2-05 / D2-07 · `preview-read.service.ts`）**：`GET /files/{id}/preview`（可选 `versionId` = 历史版本，缺省 = 当前版本；不属于该文件 / 不存在 → 404）回三态 —— **ready**（三元组命中 → 短时签名 + `expiresAt` / `pipelineVersion` / `generatedAt`）/ **not_ready**（同事务登记 + 幂等补投，前端轮询）/ **failed**（回 `preview_artifacts.error` ≤ 500 字，降级「请下载」，**不原地重试**）；未就绪 / 失败都是 **200 语义**（D2-05 / v0.2 §7.2）。
- **M4-05d 读取侧幂等补投（ADR-007「其余按需懒生成」）**：`not_ready` 时**同事务**「登记 `not_ready` 行（首次）+ `appendOutboxIfAbsent` 投 `preview.job`（去重键 = 三元组、`trigger=read`）」—— 重复请求不重复登记 / 不重复投递，`dead` 任务由这里唤醒。
- **M4-05d 短时签名（D2-04）**：复用 `ObjectStorage.signDownloadUrl`，**不传 `fileName`** → 不改写 `Content-Disposition`（内联渲染，下载地址才用 attachment）；窗口 = `PREVIEW_URL_TTL_SECONDS`（默认 300s）。
- **M4-05d 审计（D2-07）**：只对 **ready** 的读取写**一条** `object_type = file` + `action = preview` + metadata（`versionId` / `target` / `pipelineVersion`）；`not_ready` / `failed` / 404 一律不写（先签名后审计：地址没签发成功就不算一次「查看」）。
- **M4-05d 两类终态降级**（不落表、不投递、不写审计）：① 文件尚无版本（未完成过上传）；② 判不出渲染通道（如 `.zip`）→ 直接 `failed` + 原因，**让前端轮询有终点**。
- **M4-05e 产物清理（PR-12 · M4-05 收口 · 迁移 `0027` 口径 3）**：彻底删除 / 回收站到期（`purgeRecycled`）连带收口 `previews/{contentHash}/{pipelineVersion}/{target}` —— 按 `content_hash` 反查是否还有存活版本引用：**有** → 缓存行**归属转移**到存活版本（行与对象都保留，D2-06「同一内容只转换一次」不因删掉一份重复文件而失效）；**无** → 与版本对象**同序**在持锁事务内清对象（`preview_artifacts` 行随 `file_versions` 外键级联；失败即回滚，不留无行可重试的孤儿对象）。审计 metadata 记 `previewArtifactsPurged` / `previewArtifactsReassigned`。
- **M4-05 剩余**：① 下载切片 `GET /files/{id}/versions/{versionId}/download-url`（契约已在 `shared/`，A4-10「离线下载受权限控制并记日志」）；② 压测（并发 2~4 / 200MB 长跑 / 转换成功率 ≥95% 属 M4-05 压测 / PoC-1 真实样本集）。

## 上游（直接复用，不重复造）

- `src/storage/`（经 `ObjectStorage` 端口注入，不直接碰 S3 SDK）：`createMultipartUpload` / `signPartUploadUrl` / `listParts` / `completeMultipartUpload` / `abortMultipartUpload` / `headObject` / `copyObject`（暂存键 → 契约键）/ `purgeObject`（**按版本**彻底删除）/ `probe`；`buildObjectKey` + `buildUploadStagingKey` + `buildPreviewArtifactKey`（M4-05c：`previews/{contentHash}/{pipelineVersion}/{target}`，键片段走白名单防注入）+ `planUpload` / `missingPartNumbers` + `toApiError`。**M4-05c 新增 `getObject` / `putObject`**（服务端凭据直读 / 直写字节：源字节不出内网、转换器不带 S3 凭证；`getObject` 对象不存在返回 null，不抛错）。
- 数据层：`files` / `file_versions` / `upload_sessions`（`database/migrations/0005_file_lifecycle.sql`；**分片状态不落表**，以 ListParts 为唯一真相）+ `idempotency_keys`（0006）+ `file_links`（`0016_file_links.sql` · M4-03：多态关联，`object_type` 六值 CHECK / 联合唯一幂等 / `(object_type, object_id)` 反查索引）+ `change_requests`（`0001_baseline.sql` · M4-04：一期申请即通过、只追加）+ `file_versions.change_request_id` 反查的部分索引（`0021_file_versions_change_request_index.sql` · M4-04 读面）+ `preview_artifacts`（`0027_preview_artifacts.sql` · M4-05 数据层：三元组缓存键 `content_hash + pipeline_version + target` 唯一 / 状态与契约 `PREVIEW_STATUSES` 同值 / `file_id` / `version_id` = 首次生成登记、读面按三元组命中）+ `audit_logs.action` CHECK 同步扩 `preview` / `download`（一次扩至十值，与契约 `AUDIT_ACTIONS` 同序同值）。
- 横切：`AuditService`（同事务留痕）、`PermissionService`（`file.upload` / `file.download` 与记录级 404）、`ClockService`（会话到期判定 / 预览产物 `generated_at` 与退避基准，禁止直接取系统时间）。
- 平台：`OutboxStore`（M4-05c · `db/outbox.store.ts`：`claim` 单条 SQL 原子领取（`for update skip locked`，不把行锁握满整个转换时长）+ `markDone` / `markRetry`（退避回 pending）/ `markDead`）、`appendOutboxIfAbsent`（M4-05c · `db/outbox.ts`：同 dedupeKey 不覆盖进度、`dead` 才唤醒）。

## 待落地（按卡片）

- **M4-04**：写入面**已落地（PR-7）**、读面**已落地（PR-8）**（列表 / 详情，见上「M4-04 变更口径」「M4-04 变更读面」）；**剩余** = 变更统计（A4-17，无对外契约，口径由后续切片 / 仪表盘定）与通知（A4-18，随 M5；outbox `change.applied` 已埋点）。
- **M4-05**：预览编排（预览鉴权与产物）——**数据层已落地（PR-9 · 迁移 `0027`）**；**转换队列已落地（PR-10 · 迁移 `0028`：outbox `preview.job` 领取器 / 转换沙箱客户端 / 三元组幂等 / 失败降级 / 定档预生成）；**读 API 已落地（PR-11：三态 + 短时签名 + 仅 `ready` 写审计 + 版本 404 + 读取侧幂等补投 + 两类终态降级）**；**产物清理已落地（PR-12：按 `content_hash` 反查引用 —— 有引用则归属转移、无引用清对象与行）**；剩余 = 下载切片（`GET /files/{id}/versions/{versionId}/download-url` 契约已在 `shared/`，仍待实现）与压测（M4-05 出口标准）。
- 后续增强：回收站「到期前提醒 / 批量清理」、审计 `entry = "system"` 字段语义（现为 `entry = "api"` + `actorId = null` 表达系统触发）。
