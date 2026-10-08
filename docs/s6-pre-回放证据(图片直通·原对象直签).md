# S6-前置 回放证据（图片直通 · 原对象直签）

> 卡片：ONLYOFFICE 替换实施切片 **S6-前置**（主责 lan；于本回放 PR 内代记，请 px 复核）｜口径来源：`docs/ONLYOFFICE替换执行计划(Office预览).md` §0 D6（图片 → 原对象短时签名直签）+ §4「S6-前置」出口条件（`deploy/preview` 停机状态下图片预览 + 缩略图走通 + 字节与原对象全等）｜ADR-007（缓存三元组）/ D2-04（短时签名 + 禁匿名）/ D2-07（预览审计）｜契约 `FilePreviewResponse`。
> 落点说明：`docs/` 属 px 线；本文件由 lan 随 S6-前置 切片代记（回放脚本与断言同 PR，请 px 复核）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-10-08 14:38:12 +08:00 |
| 目标 api | http://127.0.0.1:3011 |
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink |
| 对象存储 | libiaolink（本地 MinIO 沙箱：仅沙箱、不代表生产选型） |
| 转换器 | http://127.0.0.1:9900 **停机**（出口条件：本回放全程不使用转换器与 worker） |
| 签名窗口 | 300s（`PREVIEW_URL_TTL_SECONDS`） |
| 代码版本 | b1a53a3（回放时工作区含本卡未提交改动） |
| 执行账号 | 管理员（建项目 / 上传 / 读预览 / 定档） |
| 夹具 | PNG-A 红点 70B（sha256 c414cd0e204de974…）/ PNG-B 蓝点 70B（sha256 6a34118ba2e0bf5d…）/ 最小单页 PDF 603B |
| 脚本 | server/scripts/s6-pre-image-direct-replay.mjs |

## 断言明细

| PASS | S0a | api 可用（/healthz + /readyz：含存储探针） |
  - 期望：200 / 200
  - 实际：200 / 200
| PASS | S0b | 转换器停机态（S6-前置 出口条件）：`PREVIEW_CONVERTER_URL` 无监听 |
  - 期望：0（连接拒绝 / 超时）
  - 实际：0（http://127.0.0.1:9900）
  - 说明：任一 HTTP 响应 = 转换器仍在线，出口条件不满足 —— 先 `cd deploy/preview && docker compose down` 再复跑
| PASS | P1 | 建回放项目（为 file 提供 projectId） |
  - 期望：201 + 项目可见
  - 实际：201 {"id":"f55f7ccd-5b9e-4950-b7a8-a025683cc369"}
| PASS | F1 | 上传 1×1 真 PNG（init → 分片直传 → complete） |
  - 期望：200 + 版本 v1 + contentHash 与夹具一致
  - 实际：{"status":200,"seq":1,"hash":"c414cd0e204d…"}
| PASS | I1 | 图片预览：ready + target=image + url 短时签名（原对象）+ pipelineVersion / generatedAt 空 |
  - 期望：ready + target=image + url 非空 + viewer/reason 空 + 产物字段空 + 窗口 ≈ 300s
  - 实际：{"status":"ready","target":"image","urlLen":502,"viewer":null,"pipelineVersion":null,"generatedAt":null,"ttlSeconds":300}
| PASS | I2 | 字节直出（非转换件）：url 直取 sha256 = 上传夹具全等 + PNG magic + Content-Type=image/png + 非 attachment |
  - 期望：200 + sha256=c414cd0e204d… + magic=89504e47 + content-type=image/png
  - 实际：{"status":200,"hash":"c414cd0e204d…","magic":"89504e47","contentType":"image/png","disposition":null}
| PASS | I3 | 签名形状：pathname = /{bucket}/{version.objectKey} + X-Amz-Expires = PREVIEW_URL_TTL_SECONDS + 有签名参数 |
  - 期望：pathname = /libiaolink/{v1 objectKey} + expires = 300
  - 实际：{"pathname":"/libiaolink/projects/f55f7ccd-5b9e-4950-b7a8-a025683cc369/files/d6e9fb59-f69a-4fbd-8660-07322183d569/v1/c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77.png","expires":"300","hasSignature":true}
| PASS | I4 | 审计恰一条 preview：metadata {versionId, target:"image"}（无 pipelineVersion）+ object_id = fileId |
  - 期望：1 条 + versionId=v1 + target=image + pipelineVersion 缺省
  - 实际：{"count":1,"metadata":{"target":"image","versionId":"24e825f9-4046-4a96-81ba-b3a276cab6e1"},"summary":"预览文件：回放-现场图-A.png（版本 v1 · 图片直签）"}
| PASS | I5 | 零投递 / 零产物行：outbox 无 preview.job、preview_artifacts 0 行（读取不发任务、不落产物行） |
  - 期望：jobs=0 + artifacts=0
  - 实际：{"jobs":0,"artifacts":0}
| PASS | F2 | 追加 v2（同文件、新 PNG 蓝点）：draft 期替换 / 追加版本 |
  - 期望：200 + 版本 v2 + hash 与夹具 B 一致
  - 实际：{"status":200,"seq":2,"hash":"6a34118ba2e0…"}
| PASS | I6a | 缺省预览 = 当前版本（v2）：签 v2 原对象 + 字节全等（夹具 B） |
  - 期望：ready + pathname 含 v2 objectKey + sha256(B) + 审计 2 条
  - 实际：{"status":"ready","pathname":"/libiaolink/projects/f55f7ccd-5b9e-4950-b7a8-a025683cc369/files/d6e9fb59-f69a-4fbd-8660-07322183d569/v2/6a34118ba2e0bf5da5ab14cb63b121e2e8b2987a876668a9b2f9c30e1357470b.png","hash":"6a34118ba2e0…","audits":2}
| PASS | I6b | 历史版本（?versionId=v1）：签 v1 原对象 + 字节全等（夹具 A）+ 审计记 v1（不串版本） |
  - 期望：ready + pathname 含 v1 objectKey + sha256(A) + 审计 3 条（末条 versionId=v1）
  - 实际：{"status":"ready","pathname":"/libiaolink/projects/f55f7ccd-5b9e-4950-b7a8-a025683cc369/files/d6e9fb59-f69a-4fbd-8660-07322183d569/v1/c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77.png","hash":"c414cd0e204d…","audits":3,"last":{"target":"image","versionId":"24e825f9-4046-4a96-81ba-b3a276cab6e1"}}
| PASS | I7 | 定档（P1 触发点）后仍零投递 / 零产物行：`previewTargetsFor` 空表 → 预生成循环空转 |
  - 期望：200 + status=final + jobs=0 + artifacts=0
  - 实际：{"status":200,"fileStatus":"final","jobs":0,"artifacts":0}
| PASS | I8 | PDF 对照（非图片不受影响）：ready + viewer.documentType=pdf（url / target 空 / 无产物无投递） |
  - 期望：ready + viewer.kind=onlyoffice/pdf + url null + target null + jobs 0 + artifacts 0 + 审计 4 条
  - 实际：{"status":"ready","target":null,"url":null,"viewerKind":"onlyoffice","documentType":"pdf","jobs":0,"artifacts":0,"audits":4}
| INFO | 收尾对账（零残留）：projects=0 / files=0 / audits=0 / outbox=0｜桶前缀 projects/f55f7ccd-5b9e-4950-b7a8-a025683cc369/ 已清 |

## 汇总

- ✅ 全部断言通过（14 项）：停机态前置（S0b）+ 图片直签就绪形态（ready / target=image / 产物字段空）+ 字节与原对象全等（非转换件）+ 签名形状与窗口 + 审计恰一条 + 零投递 / 零产物行 + 版本路由（v1 / v2 不串）+ 定档后零投递 + PDF 对照（查看器通道不受影响）。

## 未覆盖 / 风险登记

- **浏览器侧缩略图 / 浮层走查**：本脚本只断言 API 层（签发 / 字节 / 审计 / 投递 / 产物）；前端缩略图（<img> 直出）与大图浮层在**同停机态**下由前端 CDP 脚本复跑，截图见 `docs/s6-pre-回放证据(图片直通·原对象直签).md` 前端小节。
- **停机态是出口条件**：转换器在线时本脚本拒绝执行（S0b）——若需在转换器在线时复跑，先 `cd deploy/preview && docker compose down`。
- **缩略图为前端直出**：无服务端缩略图端点 —— 前端缩略图复用同一 preview url（原对象直签），本切片零前端改动（预期）。
- **产物通道为保留段**：`preview_artifacts` / `preview.job` 消费路径仍随 structured 二期保留；S6 退役评审另行处置（D5 双轨在 S6 评审通过前不变）。

## 复跑

```bash
# 前置：停转换器（出口条件）
cd deploy/preview && docker compose down
# api（BASE_URL = 默认 3011；preview 栈不在线）
cd server && npm run build && node --env-file-if-exists=.env dist/entry/api.js
# 回放（库侧收尾含 audit_logs 删除：用 migrator 角色）
cd server && S6_PRE_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
  node --env-file-if-exists=.env scripts/s6-pre-image-direct-replay.mjs \
  --out "../docs/s6-pre-回放证据(图片直通·原对象直签).md" --json "../docs/s6-pre-回放证据(图片直通·原对象直签).json"
```

## 前端小节（缩略图 / 大图浮层 · 停机态）

- 脚本：`frontend/scripts/s6-pre-image-direct-e2e.mjs`（headless Chromium（本机 Edge · CDP）；与 API 回放同一停机态 —— 转换器 / worker 不在线）。
- 前置：前端 dev :3000（`BACKEND_ORIGIN=http://127.0.0.1:3011`）+ api :3011 + 沙箱 PG :55432 + MinIO :9000（`CHROME_PATH` 指向本机浏览器；`REPLAY_USER` 建临时会话）。
- 结果：**11 / 11 全过 + 零残留（文件 / 关联 / 任务 / 项目 / 会话全 0 行）+ 页面控制台 0 异常**：
  - ① 任务行 → 详情抽屉「文件」行 = 上传 PNG（详情接口下发）；
  - ③ 缩略图 `img src` = **原对象短时签名**（路径 `/projects/{id}/files/{id}/v1/…` + `X-Amz-Signature` + `X-Amz-Expires=300` + **不含 `previews/`**）+ 真实渲染（`naturalWidth>0`）；
  - ④ 点缩略图 → 大图浮层（同源签名地址渲染 + 抽屉仍在）；⑤ Esc 先关浮层、抽屉仍在；
  - ⑥ 收尾：purge 1/1 → 项目物理删 200 → 会话撤销 → 零残留。
- 截图（`%TEMP%`）：`s6-pre-image-thumb.png`（抽屉文件行缩略图 = 红点 PNG + 文件名 + 下载入口）/ `s6-pre-image-overlay.png`（大图浮层 + caption「下载原文件」）。
- 说明：本切片**零前端实现改动**（`fileApi` url 通道裁决不变）；脚本为回放新增。
