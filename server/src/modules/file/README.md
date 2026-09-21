# file 模块（S7·file：上传管道已落地）

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
file.service.ts      # 业务：发起 / 分片 / 状态 / 完成 / 取消 / 过期清理（EXPIRE_SWEEP_BATCH）
file.repository.ts   # 数据访问：files / file_versions / upload_sessions（写路径由服务层开事务传 tx；关键路径 for update）
file.module.ts       # DI 装配（identity 守卫 / permission / admin 审计；ClockService）
index.ts             # 唯一公开出口（跨模块只允许 import 本文件）
```

## 已落接口（M4-01 上传管道 · PR-4 · Push 129）

| 路径 | 说明 | 响应码 | 权限 |
|---|---|---|---|
| `POST /api/v1/files/uploads` | 发起上传（建 draft 文件 + 会话；带 contentHash 回秒传提示） | 201 | `file.upload` |
| `POST /api/v1/files/{id}/uploads/{uploadId}/parts` | 批量取分片预签名 URL（首传 / 续传共用） | 200 | `file.upload` |
| `GET /api/v1/files/{id}/uploads/{uploadId}` | 会话状态（已传 / 缺失分片；续传依据） | 200 | 项目可见即可 |
| `POST /api/v1/files/{id}/uploads/{uploadId}/complete` | 完成（合并 → 校验 → 复制契约键 → 落版本） | 200 | `file.upload` |
| `POST /api/v1/files/{id}/uploads/{uploadId}/abort` | 取消（幂等） | 200 | `file.upload` |

- 实现口径（键形态 / 校验顺序 / 错误码 / 过期语义 / worker 清理）见 `server/README.md`「文件上传接口」与 `src/storage/README.md`；真机回放见 `docs/m4-01-回放证据(上传管道S7file).md`。
- 审计：`object_type = "file"`（objectId = fileId），上传会话事件经 `metadata.uploadId` 定位；过期清理为 system 审计（actorId = null）。
- **本切片未开放**：`intent=change`（定档后变更）与「对既有 draft 文件追加版本」——契约上传入口没有指向既有文件的 `fileId`；当前均 400 `VALIDATION_FAILED`，已登记待 wmj（契约主责）定案，随 M4-04 落地。
- 文件上传**不触发** `projects.updated_at`（ADR-022 明示「不触发」：文件与变更各有自身时间字段）。

## 上游（直接复用，不重复造）

- `src/storage/`（经 `ObjectStorage` 端口注入，不直接碰 S3 SDK）：`createMultipartUpload` / `signPartUploadUrl` / `listParts` / `completeMultipartUpload` / `abortMultipartUpload` / `headObject` / `copyObject`（暂存键 → 契约键）/ `purgeObject`（**按版本**彻底删除）/ `probe`；`buildObjectKey` + `buildUploadStagingKey` + `planUpload` / `missingPartNumbers` + `toApiError`。
- 数据层：`files` / `file_versions` / `upload_sessions`（`database/migrations/0005_file_lifecycle.sql`；**分片状态不落表**，以 ListParts 为唯一真相）+ `idempotency_keys`（0006）。
- 横切：`AuditService`（同事务留痕）、`PermissionService`（`file.upload` / `file.download` 与记录级 404）、`ClockService`（会话到期判定，禁止直接取系统时间）。

## 待落地（按卡片）

- **M4-02**：文件详情 / 版本链（`GET /files/{id}`、`GET /files/{id}/versions`）/ 定档锁版 / 回溯（生成新版本，不删历史）。
- **M4-03**：回收站（移入 / 恢复原状态 / 彻底删除仅管理员，对象与元数据一并清理、留痕）。
- **M4-04**：变更（申请即通过）——同一事务写 `change_requests` + 新版本 + 状态 changed + Outbox；依赖上传入口 `fileId` 定案。
- **M4-05**：预览编排（预览鉴权与产物，preview 模块）。
- 列表面：`GET /api/v1/projects/{id}/files`（合同已就位，随 M4 后续卡片接入）。