# 契约切片草案 · S8-2（ONLYOFFICE 查看器 · 计划 S1）

> 提出：px（**代 wmj 线起草** —— 2026-09-30 指示「并行开 S1 契约草案（代 wmj）」；主责仍属 wmj，请 wmj 评审定案）· 2026-09-30 · 分支 `px`
> 状态：**已定案**（wmj · 2026-09-30；经用户与 wmj 协商，lan 代行审核 / 登记 —— 计划内权限）—— **本文件已按定案标注**：§三 六项口径结论 + 3 条补充答复见下；S3 按本契约实施。
> 归属：契约（`shared/`）属 wmj 线；`docs/` 属 px 线（本文件随 PR 代记）。编号 **S8-2** 为定案编号（wmj 线确认；原「草案占位」收口）。
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


## 三、定案记录（wmj · 2026-09-30 · lan 代行登记）

> 定案方式：本稿随 Push 241 / PR #251 先入 `main`（squash `00dbdc3`）后，经用户与 wmj 协商，由 lan 代行对六项口径与 3 条补充意见定案并登记（计划内 lan 全权负责；先例 = 计划 v1.3 计划内审核）。**六项均按原推荐采纳**，无命名 / 字段调整（契约与生成物维持 paths 87 / schemas 239，无二次生成）：

1. **端点命名**：定 **`preview-content`**（安全定稿首选）；不落 `preview-source` 别名 —— 备选关闭。
2. **`viewer` 字段位**：定 **必填可空**（`PreviewViewer | null`）—— 三态响应字段位恒定；server 4 处 `viewer: null` 占位保留、S3 填真。
3. **`PreviewTarget`**：定 **不新增枚举值** —— 查看器通道不占 target（就绪以 `viewer` 判定）；不做 `office` 值（避免 `preview_artifacts` 缓存键扩值与 DB CHECK 迁移）。
4. **`viewer` 粒度**：定 **四段显式 schema + token**（`documentType` / `document` / `editorConfig` / `permissions`）—— 契约自文档化、S4 直接组装 DocEditor 配置；S3 签发与 S4 组装按同一 Zod schema 解析两侧。
5. **`preview_artifacts` / `preview.job`**：定 **保留** —— Office 自 S3 起不再投递；PDF / image 直通与 structured 二期仍用；退役评估随 S6（若届时定「一期后整体退役」另片评估）。
6. **查看器 token TTL**：定 **900s**（PoC 口径）—— 契约不落该字段；S3 配置下发。

### 三补、补充答复（lan 线复核意见随件定案 · 3 条）

> 来源：lan 线复核意见（PR #251 评论 [issuecomment-5907628938](https://github.com/256-code/LibiaoLink/pull/251#issuecomment-5907628938)）；定案采纳如下：

1. **文本族边界**：txt / csv / html / htm **纳入查看器通道** —— 按 word / cell 映射 `documentType`；S3 实施；S5 追加 1~2 份文本族抽样；DocServer 打不开者确定性降级「请下载」。
2. **响应头 / 错误码补全**：**以安全定稿 §3.2 为准** —— S3 实现须含 `Content-Length` / `X-Content-Type-Options: nosniff` / 禁止 302 到预签名 / 502·503 fail-closed；契约描述补全（OpenAPI 响应描述）**随 S3 同刀**（不阻塞本定案，本定案保持纯文档）。
3. **token TTL**：与上文第 6 项一致，**维持 900s**。

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

- **定案已完成**（wmj · 2026-09-30 · lan 代行登记）：六项口径 + 3 条补充答复结论见 §三；无命名 / 字段调整 —— 契约与生成物维持 PR #251 已入 `main` 形态。
- **S3**（lan）：按本契约实施受控端点（流式读对象 / Bearer 三级校验 / 响应头与错误码 / 无重定向）+ 查看器配置签发（token 构造 / `document.url` 同源生成）+ 文本族映射 + 契约描述补全（同刀）；**S4**（px）随后接线查看器外壳。
- 评审路由：PR 自动请求 wmj（`/shared/` CODEOWNERS）；不代推 wmj 常驻分支（仓库 CONTRIBUTING §5）。

