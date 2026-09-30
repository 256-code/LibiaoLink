# 契约切片草案 · S8-2（ONLYOFFICE 查看器 · 计划 S1）

> 提出：px（**代 wmj 线起草** —— 2026-09-30 指示「并行开 S1 契约草案（代 wmj）」；主责仍属 wmj，请 wmj 评审定案）· 2026-09-30 · 分支 `px`
> 状态：**草案 · 已按安全定稿 §3.2 / 附条件 C1~C6 起草**（§ 三 口径项请在 PR 评审中答复；如无异议即按本稿定案）。
> 归属：契约（`shared/`）属 wmj 线；`docs/` 属 px 线（本文件随 PR 代记）。编号 **S8-2** 为草案占位（计划 §4 注「编号定案由 wmj 线确定」）。
> 关联：`docs/ONLYOFFICE替换执行计划(Office预览).md`（S1 切片 · D1~D5 / R1~R6）；`docs/PoC-10-安全定稿(R1-R2·受控下载端点).md`（§3.2 端点草案 / §6 S1 归位 / §7 附条件 C1~C6）；`docs/PoC-10-部署前置定稿(F1-R3·R6).md`；`docs/adr/ADR-030-Office预览改由ONLYOFFICE承接.md`。

## 一、本切片改了什么（均为「加字段 / 加 schema / 加路由」，无破坏性变更）

| # | 位置 | 改动 | 依据 |
|---|---|---|---|
| 1 | `shared/src/modules/files.ts` | `FilePreviewResponse` 增 `viewer`（**必填可空**：`PreviewViewer` 或 `null`）；新增 `PREVIEW_VIEWER_KINDS` / `PreviewViewerKind` / `PreviewViewerDocument` / `PreviewViewerDocumentType` / `PreviewViewerEditorConfig` / `PreviewViewerPermissions` / `PreviewViewer` 6 个组件 schema | 计划 S1「FilePreviewResponse 增查看配置 / JWT」；安全定稿 §3.2 |
| 2 | `shared/src/modules/files.ts` | `PreviewTarget` **语义澄清**（仅转换产物通道；查看器通道不占 target、不产产物 —— 就绪以 `viewer` 判定）；**枚举不新增**（不做 `office` 值：避免 preview_artifacts 缓存键扩值与 DB CHECK 迁移） | 计划 S1「PreviewTarget 语义」；ADR-007 三元组缓存键 |
| 3 | `shared/src/openapi.ts` | 注册 `GET /api/v1/files/{id}/versions/{versionId}/preview-content`（tags=files；200 字节流 + 401 + 404 + 405 + 503） | 安全定稿 §3.2（命名采纳 `preview-content`）；附条件 C2 / C6 |
| 4 | `server` 随动（同行最小适配 · 属 lan 线、机械改动）：`preview-read.service.ts` 4 个返回点补 `viewer: null`；`server/test/preview-read.test.ts` 4 处 `toEqual` 同步；`shared/scripts/preview-status-replay.mjs` base 补位 + 6 组新用例 + 5 组路由断言 | 保证 CI 绿（S3 前 viewer 恒空；S3 起填查看器配置） |

**未改（确认项）**：`PREVIEW_TARGETS` / `PREVIEW_STATUSES` 枚举值（No.2 只改描述）；`FilePreviewQuery`；`preview_artifacts` / `preview.job` **保留**（PDF / image 直通仍走产物管道、structured 二期预留；Office 自 S3 起不再投递 —— 本切片只落契约面）。

## 二、提案字段 shape（viewer）

```json
{
  "fileId": "…", "versionId": "…", "status": "ready", "target": null,
  "viewer": {
    "kind": "onlyoffice",
    "docServerUrl": "https://docs.example.com",
    "documentType": "word",
    "document": { "title": "N1-03 项目周报.docx", "url": "https://api.internal/api/v1/files/{id}/versions/{vid}/preview-content", "fileType": "docx", "key": "…" },
    "editorConfig": { "mode": "view", "lang": "zh-CN", "user": { "id": "…", "name": "…" } },
    "permissions": { "edit": false, "download": false, "print": false, "comment": false, "chat": false, "fillForms": false, "protect": true },
    "token": "eyJ…（HS256；对 documentType / document / editorConfig / permissions 逐字签发）"
  },
  "url": null, "expiresAt": null, "pipelineVersion": null, "reason": null, "generatedAt": null
}
```

语义要点（与安全定稿 / 计划对齐）：

- **两种就绪形态互斥**：产物通道（pdf / image）→ `url` 非空、`viewer` 空；查看器通道 → `viewer` 非空、`target` / `url` / `expiresAt` / `generatedAt` 空。前端判定 = `viewer !== null ? 查看器外壳 : 产物 URL`（S4 接线）。
- `document.url` = **受控端点绝对 URL**（C1：单一配置基址 + 原始请求 path 同源生成、不信任 Host 头；反向代理 / 多实例按环境注入 —— O2）。浏览器手持 token 只暴露端点地址（无凭证）；端点缺 Bearer → 401（C2 / C4）。
- 三级校验（签名 / `payload.url` 逐字绑定 / `exp` ≤ 300s + 容差）与统一 401 不区分原因、仅 GET（405）、无重定向 —— **S3 实现**（契约面以响应码 + 描述承载）。
- `token` 由 S3 签发（HS256，共享密钥 = DocServer `JWT_SECRET`，随部署注入）；TTL 对齐 PoC（900s）可调 —— 契约不含 TTL 字段。
- `docServerUrl` = **浏览器侧** DocServer 基址（S4 据此加载 `/web-apps/apps/api/documents/api.js`）；与 `document.url` 的「DocServer 视角基址」是两个地址面，均服务端配置下发。


## 三、请 wmj 定案的口径项（评审答复位）

1. **端点命名**：`preview-content`（安全定稿首选 / 本草案采纳）vs `preview-source`（备选）—— 定案前不落路由别名。
2. **`viewer` 必填可空（推荐）vs 可选**：必填可空 = 三态响应字段位恒定（与 `url` / `expiresAt` 等既有字段一致；server 占位 4 处随之）；可选 = 空即缺省位、server 零占位（定案为可选则本 PR 撤 4 处占位）。
3. **`PreviewTarget` 不新增值（推荐）vs 新增 `office`**：新增值须同步 `literals.ts` + DB CHECK 迁移 + 三元组缓存键面（成本大、无消费方），建议不做。
4. **`viewer` 粒度**：四段显式 schema + token（推荐：契约自文档化、S4 直接组装 DocEditor 配置）vs 不透明 `config` 对象 + token（弱类型、漂移风险低）—— 若定案可选者，S3 签发与 S4 组装需按同一 Zod schema 解析两侧。
5. **`preview_artifacts` / `preview.job` 去留**（计划 S1 待定项）：推荐**保留**（PDF / image 直通 + structured 二期仍用；Office 自 S3 起不再投递）；若定「一期后整体退役」随 S6 另片评估。
6. **查看器 token TTL**：900s（PoC 口径）还是更短值 —— 契约面不含该字段，仅请口径确认（S3 配置项）。

## 四、连带影响

1. **生成物**：`paths 86 → 87`、`schemas 233 → 239`（+6 组件）；`npm run generate` + `npm run check` 零漂移（本 PR 已重出）。
2. **服务端随动**（本 PR 同携，lan 线机械改动 / 请 lan 复核）：`preview-read.service.ts` 4 处 `viewer: null` 占位（S3 填真）；`server/test/preview-read.test.ts` 4 处断言同步。
3. **回放脚本**：`shared/scripts/preview-status-replay.mjs` **26 / 26 PASS**（viewer 6 组 + 既有 15 组 + 受控端点路由 5 组 —— 组成本 PR 证据）。
4. **前端（px 线）**：`前端功能需求.md` 预览契约段同步（本 PR）；**页面接线随 S4**（查看器外壳：超时 / 重试 / 降级「请下载」—— R5；`previewKindOf` 分类改动随 S4）。
5. **文档回写**：`技术设计v0.3` §3.5 / ADR-007 缓存键段随 S3 实施回写（本切片不动）；`系统功能书.md` 无字段口径变化（D2-09 已登记承接）。

## 五、本切片不含（避免越界）

- **S3**：受控端点实现（流式读对象 / Bearer 三级校验 / 401 fail-closed / 401 计数）、查看器配置签发（token 构造 / `document.url` 同源生成）、投递侧（`previewTargetsFor` Office 不再投递）。
- **S4**：前端外壳（api.js 加载 / iframe / 超时重试 / 降级文案）。
- **S2**：已交付（`deploy/onlyoffice/` · Push 240 / PR #250 / squash 3c74300）。

## 六、验证证据（本 PR）

- `shared`：`npm run typecheck` / `npm run generate`（paths = 87 / schemas = 239）/ `npm run check` 零漂移 / `npm run build` 全过。
- 契约回放 `shared/scripts/preview-status-replay.mjs`：**26 / 26 PASS**（明细见运行输出）。
- `server`：`npm run typecheck` / `npm test` **758 / 758** / `npm run build` / `npm run check:boundaries`（213 文件 / 919 条依赖 / 0 违规）。
- CI：本 PR 四 job（frontend / shared / server / database）。

## 七、后续

- wmj 定案：如命名 / 字段有调整，同一 PR 内修订（生成物随改）；定案后 S3 按本契约实施端点与签发、S4 接线外壳。
- 评审路由：PR 自动请求 wmj（`/shared/` CODEOWNERS）；不代推 wmj 常驻分支（仓库 CONTRIBUTING §5）。

