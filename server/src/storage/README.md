# storage/ · 对象存储接入（S3 协议）

| 字段 | 内容 |
|---|---|
| 类型 | 基础设施层（与 `common/` / `db/` / `config/` 同级） |
| 职责 | 对象存储端口与 S3 适配器：分片会话、预签名直传 / 下载、ListParts、合并 / 中止、HEAD |
| 主责 | lan（团队分工.md §2 后端平台） |
| 依据 | ADR-006（S3 协议抽象 + MinIO 单节点）；技术设计v0.2 §5.1；契约 `shared/src/modules/files.ts` |

## 文件

```text
object-storage.ts     # 端口：ObjectStorage 抽象类 + StorageError + toApiError（错误码映射）
s3-object-storage.ts  # 实现：S3 适配器（唯一处配置协议细节）+ createS3Client / createS3ObjectStorage
object-key.ts         # 对象键构造与校验（片段严格校验，防路径穿越）
part-plan.ts          # 分片计划（S3 协议约束）+ 缺片计算
storage.module.ts     # DI 装配（@Global 导出 ObjectStorage 端口）
index.ts              # 唯一公开出口
```

## 约定

- **只依赖 S3 协议**：换实现（MinIO / SeaweedFS / 云 OSS）只改 `createS3Client` 的 endpoint 与凭据，调用方代码不动。
- **本层不得依赖 `modules/`**：已纳入 `npm run check:boundaries` 规则 3（`common` / `db` / `config` / `storage` 不得依赖业务模块）。
- **分片状态不落表**：以对象存储 ListParts 为唯一真相（2026-09-18 评审定案）；`upload_sessions` 只登记元数据。
- **定档不覆盖物理对象**：版本与内容哈希进键（`object-key.ts`），历史对象天然不可变。
- **api 不代理大文件流量**：分片与下载都走预签名 URL（短时）。

## 错误映射（`toApiError`）

| 存储侧 | `StorageError.code` | 契约错误码 | HTTP |
|---|---|---|---|
| `NoSuchUpload`（会话已中止 / 已清理） | `upload_not_found` | `UPLOAD_SESSION_EXPIRED` | 410 |
| `InvalidPart` / `InvalidPartOrder` / `EntityTooSmall` / `EntityTooLarge` | `part_conflict` | `UPLOAD_INCOMPLETE` | 409 |
| `NoSuchKey` / 404 | `object_not_found` | `NOT_FOUND` | 404 |
| 网络 / 凭据 / 桶配置 / 其它 | `unavailable` | `INTERNAL` | 500 |

客户端只拿到统一信封；原始 S3 错误留在服务端日志，且经 `scrub()` 脱敏（预签名 URL、访问密钥、签名值不进日志，CONTRIBUTING §12）。

## 兼容性要点（真机验证过）

1. **预签名 PUT 只签 `host`**：SDK 新版默认给请求带 CRC32 校验和，会写进预签名查询串并要求浏览器额外带头。已按 `requestChecksumCalculation: "WHEN_REQUIRED"` 关闭 —— 真机验证 URL 干净、浏览器可裸 PUT。
2. **寻址方式**：`S3_FORCE_PATH_STYLE=auto` 时非 AWS 端点自动走 path-style（MinIO / SeaweedFS 必需）。
3. **`entityTooSmall` 是协议约束不是 bug**：非末片必须 ≥ 5 MiB，服务端分片计划（`planUpload`）负责保证。

## 待复核（ADR-006 阶段 0）

MinIO 社区版上游已归档、官方下载渠道 410、Docker Hub 镜像下架；本版本实测 `PutBucketCors` 返回 `NotImplemented`（CORS 走服务端配置）、lifecycle 规则被拒（内置 stale uploads 清理兜底）。是否切换实现属 ADR 变更（wmj 主责），证据与本目录口径见 `deploy/minio/README.md`。
