import { z } from "../zod.ts";
import {
  DateTimeSchema,
  PageQuerySchema,
  SortQuerySchema,
  UuidSchema,
  VersionSchema,
  paginated,
} from "../common/conventions.ts";
import { ChangeStatusSchema, DocTypeSchema, FileStatusSchema, StageKeySchema } from "../common/dicts.ts";

/**
 * 文件与变更契约（v0.2 §5.1-5.3；系统功能书 A4-01~A4-18 / D2 的接口面）。
 * 生命周期：draft → final（定档锁版）→ changed（变更后）→ archived（归档只读）→ recycled（回收站，默认 30 天可恢复）。
 * 一期变更「申请即通过、所有人平权」：提交即生成变更记录与新版本；定档后修改必须走变更，不允许直接替换。
 */

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i)
  .openapi("Sha256", { description: "SHA-256 内容哈希（十六进制）；用于重复内容提示与变更前后留痕" });

export const UploadIntentSchema = z.enum(["version", "change"]).openapi("UploadIntent", {
  description:
    "上传意图：version = 新增/替换版本（仅 draft 文件）；change = 定档后变更（同一事务写 change_requests + 新版本 + 状态 changed）",
});

export const UploadSessionStatusSchema = z
  .enum(["active", "completed", "aborted", "expired"])
  .openapi("UploadSessionStatus", { description: "上传会话状态；active 可续传，completed/aborted/expired 不可再用" });

/** 文件版本（file_versions；版本链只追加、不覆盖；定档后新增版本必须携带 changeRequestId）。 */
export const FileVersionSchema = z
  .object({
    id: UuidSchema,
    fileId: UuidSchema,
    seq: z.number().int().positive().openapi({ description: "版本号（同一文件内递增，从 1 开始）" }),
    sizeBytes: z.number().int().min(0),
    contentHash: Sha256Schema,
    mime: z.string().nullable(),
    uploadedBy: UuidSchema,
    uploadedAt: DateTimeSchema,
    changeRequestId: UuidSchema.nullable().openapi({ description: "来源变更；普通版本（草稿期）为空" }),
  })
  .openapi("FileVersion", { description: "文件版本（v0.2 §5.1；对象键 = projects/{projectId}/files/{fileId}/v{seq}/{contentHash}.{ext}）" });

/** 文件（files；版本与状态由服务端维护，客户端不得直接改状态）。 */
export const FileSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    nodeId: UuidSchema.nullable(),
    taskId: UuidSchema.nullable(),
    docType: DocTypeSchema.nullable().openapi({ description: "成果文件类型（十类字典）；普通附件为空" }),
    name: z.string().openapi({ example: "机械设计图纸-v2.docx", description: "原文件名（含中文，保留在元数据）" }),
    status: FileStatusSchema,
    currentVersionId: UuidSchema.nullable(),
    version: VersionSchema,
    createdBy: UuidSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    finalizedAt: DateTimeSchema.nullable().openapi({ description: "定档时间；未定档为空" }),
    finalizedBy: UuidSchema.nullable(),
    recycledAt: DateTimeSchema.nullable().openapi({ description: "进入回收站时间；恢复或彻底删除后清空 / 记录终止" }),
    recycledBy: UuidSchema.nullable(),
    recycledFromStatus: FileStatusSchema.nullable().openapi({ description: "进入回收站前的状态；恢复时回退到该状态" }),
  })
  .openapi("File", { description: "文件（v0.2 §5.2；定档后不可覆盖，修改必须走变更）" });

export const FileDetailSchema = FileSchema.extend({
  currentVersion: FileVersionSchema.nullable(),
}).openapi("FileDetail", { description: "文件详情（含当前版本；版本链走 /files/{id}/versions）" });

export const ChangeRequestSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    nodeId: UuidSchema.nullable(),
    stageKey: StageKeySchema.nullable().openapi({ description: "变更阶段（九阶段字典）" }),
    reason: z.string().openapi({ description: "变更原因（必填）" }),
    beforeSummary: z.string().nullable().openapi({ description: "变更前摘要" }),
    afterSummary: z.string().nullable().openapi({ description: "变更后摘要" }),
    status: ChangeStatusSchema,
    appliedBy: UuidSchema,
    appliedAt: DateTimeSchema,
    createdAt: DateTimeSchema,
    fileId: UuidSchema.openapi({ description: "变更文件（一期单文件一条变更；多文件 change_items 后续扩展）" }),
    versionId: UuidSchema.openapi({ description: "变更后版本（file_versions.change_request_id 反查）" }),
    versionSeq: z.number().int().positive(),
  })
  .openapi("ChangeRequest", { description: "变更记录（v0.2 §5.3；一期申请即通过、全程留痕）" });

export const ChangeRequestDetailSchema = ChangeRequestSchema.extend({
  file: FileSchema,
  version: FileVersionSchema,
}).openapi("ChangeRequestDetail");

export const ChangeRequestListQuerySchema = z
  .object({
    "filter[stageKey]": z.string().optional().openapi({ description: "阶段（多值逗号分隔）" }),
    "filter[nodeId]": UuidSchema.optional(),
    "filter[fileId]": UuidSchema.optional(),
    "filter[appliedBy]": UuidSchema.optional(),
    "filter[projectId]": UuidSchema.optional(),
    q: z.string().optional().openapi({ description: "关键字（变更原因 / 变更前后摘要）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
    sort: SortQuerySchema.optional(),
  })
  .openapi("ChangeRequestListQuery");

export const ChangeRequestListResponseSchema = paginated(ChangeRequestSchema).openapi("ChangeRequestListResponse");

export const ChangeIntentBodySchema = z
  .object({
    reason: z.string().min(1).max(1000).openapi({ description: "变更原因（必填；无变更后文件不允许提交）" }),
    beforeSummary: z.string().max(2000).optional(),
    afterSummary: z.string().max(2000).optional(),
    stageKey: StageKeySchema.optional(),
  })
  .openapi("ChangeIntentBody", { description: "变更申请字段（随上传会话提交，完成上传时同事务生效）" });

const UploadCreateBaseSchema = z.object({
  projectId: UuidSchema,
  name: z.string().min(1).max(255),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .openapi({ description: "字节数；上限由服务端配置（UPLOAD_MAX_SIZE_MB），超出返回 400 VALIDATION_FAILED" }),
  mime: z.string().max(200).optional(),
  contentHash: Sha256Schema.optional().openapi({
    description: "客户端计算的内容哈希；传入时若命中已有内容则返回 duplicateHint（A4-04，提示后可确认继续）；complete 时必须回传",
  }),
  docType: DocTypeSchema.optional(),
  nodeId: UuidSchema.optional(),
  taskId: UuidSchema.optional(),
});

/**
 * 发起上传：version = 草稿期新增 / 替换版本（fileId 省略 = 新建文件，给出 = 对既有 draft 文件替换 / 追加版本）；
 * change = 定档后变更（fileId 与 change 均必填；A4-13 申请即通过，完成上传时同事务生效）。
 */
export const UploadCreateBodySchema = z
  .discriminatedUnion("intent", [
    UploadCreateBaseSchema.extend({
      intent: z.literal("version"),
      fileId: UuidSchema.optional().openapi({
        description: "目标文件（可选）：省略 = 新建文件；给出 = 对既有未定档（draft）文件替换 / 追加新版本（系统功能书 A2-10「未定档文件可直接替换」）。目标非 draft → 409 FILE_STATE_INVALID；不存在 / 无权 → 404；与 projectId 不一致 → 400；给出时名称与归属（name / docType / nodeId / taskId）以目标文件现状为准 —— 可省略，填写则须与目标文件一致（不一致 400）；duplicateHint 恒为空",
      }),
    }),
    UploadCreateBaseSchema.extend({
      intent: z.literal("change"),
      fileId: UuidSchema.openapi({
        description: "变更目标文件（必填，A4-13）：须为已定档（final / changed）状态；非该状态 → 409 FILE_STATE_INVALID；不存在 / 无权 → 404；与 projectId 不一致 → 400；名称与归属（name / docType / nodeId / taskId）以目标文件现状为准 —— 可省略，填写则须与目标文件一致（不一致 400）；duplicateHint 恒为空",
      }),
      change: ChangeIntentBodySchema,
    }),
  ])
  .openapi("UploadCreateBody", { description: "发起上传（分片直传；返回预签名分片 URL 的获取入口）。intent=version：fileId 省略 = 新建文件、给出 = 对既有 draft 文件替换 / 追加版本；intent=change：fileId 必填 = 定档后变更（申请即通过，完成上传时同事务生效）" });

export const UploadSessionSchema = z
  .object({
    id: UuidSchema,
    fileId: UuidSchema,
    intent: UploadIntentSchema,
    partSizeBytes: z.number().int().positive(),
    totalParts: z.number().int().positive(),
    status: UploadSessionStatusSchema,
    createdAt: DateTimeSchema,
    expiresAt: DateTimeSchema,
  })
  .openapi("UploadSession", { description: "上传会话（服务端只登记元数据；分片状态以对象存储 ListParts 为准）" });

export const DuplicateHintSchema = z
  .object({
    fileId: UuidSchema,
    name: z.string(),
    sizeBytes: z.number().int().min(0),
    uploadedBy: UuidSchema,
    uploadedAt: DateTimeSchema,
  })
  .openapi("DuplicateHint", { description: "同内容哈希的既有文件提示（用户确认后可继续上传，不做强阻断）" });

export const UploadCreateResponseSchema = z
  .object({
    file: FileSchema,
    upload: UploadSessionSchema,
    duplicateHint: DuplicateHintSchema.nullable(),
  })
  .openapi("UploadCreateResponse");

export const UploadPartsBodySchema = z
  .object({
    partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(1000),
  })
  .openapi("UploadPartsBody", { description: "批量获取分片预签名 URL（首传与断点续传共用；续传前先查会话状态拿缺失分片）" });

export const UploadPartUrlSchema = z
  .object({
    partNumber: z.number().int().min(1).max(10000),
    url: z.string().openapi({ description: "预签名 PUT URL（浏览器直传对象存储，api 不代理大文件流量）" }),
    expiresAt: DateTimeSchema,
  })
  .openapi("UploadPartUrl");

export const UploadPartsResponseSchema = z
  .object({
    uploadId: UuidSchema,
    partSizeBytes: z.number().int().positive(),
    parts: z.array(UploadPartUrlSchema),
    expiresAt: DateTimeSchema,
  })
  .openapi("UploadPartsResponse");

export const UploadSessionViewSchema = UploadSessionSchema.extend({
  uploadedPartNumbers: z.array(z.number().int()).openapi({ description: "已上传分片（来自对象存储 ListParts）" }),
  missingPartNumbers: z.array(z.number().int()).openapi({ description: "缺失分片（断点续传只补这些）" }),
}).openapi("UploadSessionView");

export const UploadCompleteBodySchema = z
  .object({
    contentHash: Sha256Schema.openapi({ description: "完成时回传；与 init 提供值不一致返回 422 FILE_HASH_MISMATCH" }),
  })
  .openapi("UploadCompleteBody");

export const UploadAbortResponseSchema = z.object({ upload: UploadSessionSchema }).openapi("UploadAbortResponse");

export const UploadCompleteResponseSchema = z
  .object({
    file: FileSchema,
    version: FileVersionSchema,
    changeRequest: ChangeRequestSchema.nullable().openapi({ description: "intent=change 时的变更记录；version 意图为空" }),
  })
  .openapi("UploadCompleteResponse");

export const FileVersionListResponseSchema = z
  .object({
    items: z.array(FileVersionSchema),
    total: z.number().int().min(0),
  })
  .openapi("FileVersionListResponse");

export const FileFinalizeBodySchema = z.object({ version: VersionSchema }).openapi("FileFinalizeBody", {
  description: "定档（锁版）：至少存在 1 个版本；定档后不可覆盖或替换",
});

export const FileRollbackBodySchema = z
  .object({
    toVersionId: UuidSchema.openapi({ description: "回溯目标版本" }),
    reason: z.string().min(1).max(1000).openapi({ description: "回溯原因（留痕；定档 / 已变更文件按变更流处理）" }),
    version: VersionSchema,
  })
  .openapi("FileRollbackBody", { description: "回溯生成新版本（不删除历史版本；定档后回溯走变更、申请即通过）" });

export const FileRollbackResponseSchema = z
  .object({
    file: FileSchema,
    version: FileVersionSchema,
    changeRequest: ChangeRequestSchema.nullable(),
  })
  .openapi("FileRollbackResponse");

export const FileRecycleBodySchema = z
  .object({
    version: VersionSchema,
    reason: z.string().max(1000).optional(),
  })
  .openapi("FileRecycleBody", { description: "移入回收站（任意状态可删；默认保留 30 天，可恢复）" });

export const FileRestoreBodySchema = z.object({ version: VersionSchema }).openapi("FileRestoreBody");

export const FilePurgeBodySchema = z
  .object({
    version: VersionSchema,
    reason: z.string().max(1000).optional(),
  })
  .openapi("FilePurgeBody", { description: "彻底删除（仅管理员；对象与元数据一并清理，操作留痕）" });

export const FilePurgeResponseSchema = z.object({ fileId: UuidSchema, purgedAt: DateTimeSchema }).openapi("FilePurgeResponse");

export const FileDownloadUrlResponseSchema = z
  .object({
    url: z.string().openapi({ description: "短时签名下载地址（写查看 / 下载审计；对象存储禁止匿名读取）" }),
    fileName: z.string(),
    sizeBytes: z.number().int().min(0),
    expiresAt: DateTimeSchema,
  })
  .openapi("FileDownloadUrlResponse");

/**
 * 预览目标（渲染通道口径 · wmj 评审定案 · PR #103）：按前端渲染方式定义，不按文件格式；格式差异由产物 MIME 表达。
 * 缓存键 = 内容哈希 + pipelineVersion + target（ADR-007 / v0.2 §5.4 三元组）。
 * pdf = PDF 查看器通道（Office / PDF 转出；CAD 产物格式随 M4-06 PoC 定）；image = 图片查看器通道（图片直出、图片型兜底、含矢量 SVG）；structured = 结构化表格渲染通道（一期未启用时 xlsx 走 pdf）。
 */
export const PREVIEW_TARGETS = ["pdf", "image", "structured"] as const;
export const PreviewTargetSchema = z.enum(PREVIEW_TARGETS).openapi("PreviewTarget", {
  description:
    "预览目标（渲染通道）：pdf PDF 查看器通道（Office / PDF 转出；CAD 若 PoC 产物为 PDF 也走这里） / image 图片查看器通道（图片直出、Office 图片型兜底、含矢量 SVG 产物 —— CAD 若 PoC 只能出 SVG 也走这里） / structured 结构化表格渲染通道（一期未启用时 xlsx 走 pdf 通道）",
});

/**
 * 预览状态（D2-05：未就绪与失败都是 200 语义，不是失败响应 —— 前端据此置占位 / 降级「请下载」）。
 * ready 时 url 必填；not_ready / failed 时 url 为空。
 */
export const PREVIEW_STATUSES = ["ready", "not_ready", "failed"] as const;
export const PreviewStatusSchema = z.enum(PREVIEW_STATUSES).openapi("PreviewStatus", {
  description:
    "预览状态：ready 产物就绪（附短时签名 URL） / not_ready 尚未生成（服务端幂等补投生成任务、按三元组去重，前端轮询至 ready / failed —— 不引入请求约定） / failed 转换失败（记原因并降级「请下载」）",
});

/** 预览查询参数（A4-06：任意历史版本可预览与下载；缺省 = 当前版本；不属于该文件 / 不存在 → 404）。 */
export const FilePreviewQuerySchema = z
  .object({
    versionId: UuidSchema.optional().openapi({ description: "指定历史版本（A4-06）；缺省 = 当前版本；不属于该文件 / 不存在 → 404" }),
  })
  .openapi("FilePreviewQuery");

/** 预览状态响应（GET /files/{id}/preview；D2-04 短时签名 + 禁止匿名读取、D2-05 失败降级、D2-06 缓存、D2-07 审计）。 */
export const FilePreviewResponseSchema = z
  .object({
    fileId: UuidSchema,
    versionId: UuidSchema.nullable().openapi({ description: "本次预览对应版本（查询参数指定时随指定，缺省 = 当前版本）；无版本为空" }),
    status: PreviewStatusSchema,
    target: PreviewTargetSchema.nullable().openapi({ description: "已就绪产物的目标（渲染通道）；未就绪 / 失败为空" }),
    url: z
      .string()
      .nullable()
      .openapi({ description: "短时签名预览地址（仅 ready；未就绪 / 失败为空；对象存储禁止匿名读取）" }),
    expiresAt: DateTimeSchema.nullable().openapi({ description: "签名到期时间；未就绪 / 失败为空" }),
    pipelineVersion: z
      .string()
      .nullable()
      .openapi({ description: "产物对应的转换管线版本（服务端配置下发，如 PREVIEW_PIPELINE_VERSION；客户端不解析，用于缓存失效 / 排障）；未生成过为空" }),
    reason: z
      .string()
      .max(500)
      .nullable()
      .openapi({ description: "失败原因（仅 failed，最长 500 字；D2-05 记录原因，不影响下载）" }),
    generatedAt: DateTimeSchema.nullable().openapi({ description: "产物生成时间（仅 ready；对齐 preview_artifacts.generated_at —— 查看时间在审计里）" }),
  })
  .openapi("FilePreviewResponse", { description: "文件预览状态与短时签名地址（异步产物；未就绪 / 失败为 200 语义 —— not_ready 时服务端幂等补投生成任务，前端轮询至 ready / failed）" });

export const FileListQuerySchema = z
  .object({
    "filter[nodeId]": UuidSchema.optional(),
    "filter[taskId]": UuidSchema.optional(),
    "filter[status]": z.string().optional().openapi({ description: "文件状态（多值逗号分隔）：draft / final / changed / archived / recycled" }),
    "filter[docType]": z.string().optional().openapi({ description: "成果文件类型（多值逗号分隔，取值见 DocType 字典）" }),
    "filter[uploadedBy]": UuidSchema.optional(),
    q: z.string().optional().openapi({ description: "关键字（文件名）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
    sort: SortQuerySchema.optional(),
  })
  .openapi("FileListQuery");

export const FileListResponseSchema = paginated(FileSchema).openapi("FileListResponse");
