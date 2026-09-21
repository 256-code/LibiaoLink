# file 模块（占位）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 文件、版本、定档、变更（申请即通过）、预览编排、回收站 |
| 主责 | lan（团队分工.md §2） |
| 预留对外接口 | FileService、PreviewService、ChangeService |

- 状态：**存储接入已就绪**（PR-3：`src/storage/` 的 S3 协议端口 + 适配器 + 真机回放）；本模块业务代码待 M4-01 起落地。
- 落地约定：四层结构 controller / service / repository / events + index.ts 唯一公开出口；跨模块只允许 import 对端 index.ts（npm run check:boundaries），详见 server/README.md。

## 已就绪的上游（M4-01 直接使用）

- `src/storage/index.ts`（经 `ObjectStorage` 端口注入，不直接碰 S3 SDK）：`createMultipartUpload` / `signPartUploadUrl` / `listParts` / `completeMultipartUpload` / `abortMultipartUpload` / `headObject` / `signDownloadUrl` / `copyObject`（complete：暂存键 → 契约键）/ `purgeObject`（**按版本**彻底删除，不要用裸 `DeleteObject`）/ `probe`。
- `buildObjectKey`（键形态）+ `planUpload` / `missingPartNumbers`（分片计划与断点续传）+ `toApiError`（存储失败 → 契约错误码）。
- 数据层已就绪：`files` / `file_versions` / `upload_sessions`（`database/migrations/0005_file_lifecycle.sql`；**分片状态不落表**，以 ListParts 为唯一真相）+ `idempotency_keys`（0006）。
- **键形态（PR-4 实施口径 · 已复核：ADR-006 定案 2026-09-21 / Push 126）**：`contentHash` 在 init 时是可选的（契约）、`seq` 要到完成上传的事务里才定，因此会话先按暂存键 `buildUploadStagingKey`（`…/staging/{sessionId}`）直传；complete 时校验哈希、按 `buildObjectKey`（`…/v{seq}/{contentHash}.{ext}`）用 `copyObject` 复制到契约键、再 `purgeObject` 清理暂存对象，落库的 `file_versions.object_key` 始终是契约形态。代价已登记：完成时一次服务端复制（对象瞬时双份）；单对象 > 5 GiB 需 UploadPartCopy —— 一期由 `UPLOAD_MAX_SIZE_MB`（默认 2048，启动校验 ≤ 5120）挡在下面，放开上限时再补。complete 时的 `contentHash` 一致性校验不得省（与 init 声明不一致 → 422 `FILE_HASH_MISMATCH`，既有契约）。
- **暂存清理必须按版本删**：桶开了版本控制，不带 `versionId` 的 `DeleteObject` 只写 delete marker、数据版本永不回收（lifecycle 已不作为清理手段）→ 一律走 `purgeObject`（列版本 + 批量按版本删）。
