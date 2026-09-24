# M4-05d 回放证据（S7·file 预览读 API）

> 卡片：M4-05「在线预览」的读面切片（主责 lan，评审 wmj）｜口径来源：系统功能书 D2-04（短时签名 + 禁匿名）/ D2-05（失败降级「请下载」）/ D2-07（预览计入查看审计）｜技术设计v0.3 §3.5（M4-05 预览：短时签名 + 审计 + 禁匿名）｜v0.2 §7.2（`PREVIEW_NOT_READY` / `PREVIEW_FAILED` 的 200 语义）｜ADR-007（缓存键三元组 / 降级不阻塞下载）｜契约 `FilePreviewResponse`。
> 落点说明：`docs/` 属 px 线；本文件由 lan 随 M4-05 读面卡片代记（回放脚本与断言同 PR，请 px 复核）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-23 15:44:19 +08:00 |
| 目标 | http://127.0.0.1:3011 |
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink |
| 对象存储 | libiaolink（本地 MinIO 沙箱：仅沙箱、不代表生产选型） |
| 转换沙箱 | http://127.0.0.1:9900（deploy/preview/，镜像 libiaolink/preview-converter:1.0.0） |
| 签名窗口 | 300s（`PREVIEW_URL_TTL_SECONDS`） |
| 代码版本 | `8bc5844`（`origin/main` 顶 = Push 168 · PR #145；回放时工作区含本卡未提交改动） |
| 执行账号 | 管理员（建项目 / 上传 / 读预览）；另有**匿名**请求一条（401 断言） |
| 脚本 | server/scripts/m4-preview-read-replay.mjs |

## 断言明细

| PASS | S0 | api 可用（/healthz + /readyz：含存储探针） | 
  - 期望：200 / 200
  - 实际：200 / 200
| PASS | S1 | 转换沙箱可用且管线版本与 server 配置同值（读 API 的三元组与沙箱产物必须同版本） | 
  - 期望：ok=true 且 pipelineVersion=1.0.0
  - 实际：{"ok":true,"pipelineVersion":"1.0.0"}
| PASS | P1 | 建回放项目（为 file 提供 projectId） | 
  - 期望：201 + 项目可见
  - 实际：201 {"id":"f18807fc-5b47-4b63-9cc8-b99be6044a04","code":"M4PRD-20260923074418"}
| PASS | F1 | 上传中文样例（真实上传管道；**上传完成不投递** —— draft 可能被替换，预览走读取侧懒生成） | 
  - 期望：200 + 版本 v1 + 无 preview.job
  - 实际：{"status":200,"version":1,"jobs":0}
| PASS | R1 | 首次读预览 → not_ready：同事务登记 not_ready 行 + 补投 preview.job（trigger=read，去重键 = 三元组） | 
  - 期望：status=not_ready + target/url/reason 为空 + 产物行 not_ready + outbox pending + payload.trigger=read
  - 实际：{"status":"not_ready","target":null,"url":null,"pipelineVersion":"1.0.0","artifact":"not_ready","job":"pending","trigger":"read"}
| PASS | R2 | 重复读预览（未就绪期间再读两次）→ 不重复登记、不重复投递（三元组幂等） | 
  - 期望：产物 1 行 + outbox 1 行
  - 实际：{"artifacts":1,"jobs":1}
| PASS | R3 | not_ready 不写审计（D2-07：预览计入查看 / 下载审计 —— 但只对**送达用户的 ready** 记一次） | 
  - 期望：preview 审计 0 条
  - 实际：{"previewAudits":0}
| PASS | W1 | worker 消费补投的任务 → 产物转 ready（读取侧懒生成闭环：not_ready → 转换 → ready） | 
  - 期望：preview_artifacts.status = ready + object_key = previews/{hash}/{pipeline}/{target}
  - 实际：{"status":"ready","objectKey":"previews/9ef330e7d451a8edf180bfab8487a2fa2207e3327063df4ec4a8cc4a04bdda07/1.0.0/pdf","outbox":"done"}
| PASS | R4 | ready 读预览：三态字段齐全（url / expiresAt / pipelineVersion / generatedAt）且 target = pdf | 
  - 期望：status=ready + target=pdf + url 非空 + pipelineVersion=1.0.0 + generatedAt 非空
  - 实际：{"status":"ready","target":"pdf","urlHost":"http://127.0.0.1:9000/libiaolink/previews/9ef330e7d451a8edf180bfab8487a2fa2207e3327063df4ec4a8cc4a04bdda07/1.0.0/pdf","pipelineVersion":"1.0.0","generatedAt":"2026-09-23T07:44:19.357Z","reason":null}
| PASS | R5 | 短时签名窗口 = PREVIEW_URL_TTL_SECONDS（D2-04：地址短时有效，过期需重新请求） | 
  - 期望：expiresAt 距现在 ≈ 300s（容差 -5s ~ +10s）
  - 实际：实际 300s（2026-09-23T07:49:19.408Z）
| PASS | R6 | 签名地址可直接取回产物（对象存储禁匿名 → 地址即鉴权）：200 + %PDF- + 内嵌 Noto CJK | 
  - 期望：200 + %PDF- + 字体名含 Noto…CJK
  - 实际：{"status":200,"head":"%PDF-","sizeBytes":39689,"cjkFont":true}
| PASS | R7 | ready 读预览写一条 preview 审计（object_type=file + metadata = versionId / target / pipelineVersion） | 
  - 期望：1 条 + object_id = fileId + metadata 对齐 + summary 含文件名
  - 实际：{"total":1,"entry":{"action":"preview","objectType":"file","objectId":"15c10508-80eb-4a04-a75d-96ad285b2adb","metadata":{"target":"pdf","versionId":"35a1f3d0-4d30-468f-988a-52e2322c33f4","pipelineVersion":"1.0.0"},"summary":"预览文件：中文样例-M4-05d.html（版本 v1 · 通道 pdf）"}}
| PASS | V1 | 版本路由（A4-06）：缺省 = 当前版本（v2 内容哈希，尚未生成 → not_ready 并补投）；versionId 指定历史版本 → 按该版本三元组（v1 已 ready，不串版本、不重复投递） | 
  - 期望：详情 currentVersion = v2；缺省读 → v2 + not_ready + v2 三元组 1 条任务；指定 v1 → v1 + ready + v1 三元组仍 1 条任务
  - 实际：{"v2Upload":{"status":200,"seq":2},"detailCurrent":"v2","current":{"status":"not_ready","versionId":"v2","jobs":1},"history":{"status":"ready","versionId":"v1","jobs":1}}
  - 说明：v1 的产物在证据二已 ready；指定 v1 读的仍是同一三元组（不再新增任务）；v2 尚未生成 → 读取侧懒生成补投
| PASS | N1 | versionId 不属于该文件 / 不存在 → 404（防 IDOR，不泄露文件存在性之外的信息） | 
  - 期望：404
  - 实际：404 {"code":"NOT_FOUND","message":"版本不存在或不属于该文件","details":[],"traceId":"e05c5276-ec80-4c4c-b5b4-d0b8ca1824dd"}
| PASS | N2 | 文件不存在 → 404（与不可见同形） | 
  - 期望：404
  - 实际：404 {"code":"NOT_FOUND","message":"文件不存在","details":[],"traceId":"e2e75567-16ec-4c6e-9754-dc733027138d"}
| PASS | N3 | 禁匿名（D2-04：预览地址短时签名 + 访问需鉴权）→ 无会话请求 401 | 
  - 期望：401
  - 实际：401 {"code":"AUTH_REQUIRED","message":"未登录","details":[],"traceId":"3e157d05-92a2-4138-acde-acc854c0a265"}
| PASS | X1 | 产物为 failed（缓存态）→ 返回失败原因并降级「请下载」；**不原地重投**（等 pipeline_version 递增才失效） | 
  - 期望：status=failed + reason 非空 + pipelineVersion 回填 + outbox 0 行
  - 实际：{"status":"failed","reason":"回放注入：模拟转换确定性失败（CONVERT_FAILED），降级「请下载查看」","pipelineVersion":"1.0.0","jobs":0}
| PASS | Z1 | 判不出渲染通道的类型（.zip）→ 终态降级 failed（不落表、不投递、不写审计），前端轮询有终点 | 
  - 期望：status=failed + reason 含「暂不支持在线预览」+ 产物 0 行 + outbox 0 行 + 审计不增
  - 实际：{"status":"failed","reason":"该文件类型暂不支持在线预览，请下载查看","artifacts":0,"jobs":0,"previewAuditsBefore":2,"previewAuditsAfter":2}

## 汇总

- ✅ 全部断言通过（18 项）：三态（ready / not_ready / failed）/ 读取侧幂等补投与懒生成闭环 / 短时签名与窗口 / 仅 ready 写审计 / 版本路由与 404 / 禁匿名 / 判不出通道终态降级。

## 未覆盖 / 风险登记

- **压测未做**：并发 2~4、200MB 级长跑内存曲线、转换成功率 ≥95%（PoC-1 真实样本集）不在本脚本范围（属 M4-05 压测 / M8 容量验证）。
- **failed 注入方式**：证据五的 failed 产物行由脚本直接注入（模拟转换确定性失败），而非等真实转换失败 —— 真实失败如何写 failed 由 M4-05c 证据（超大源文件 / `.zip` 不投递）覆盖；本脚本只证**读面在 failed 缓存态下的行为**（回原因、不原地重投）。
- **预览产物对象的清理未接**：彻底删除 / 回收站到期目前只清 `projects/` 前缀下的版本对象，`previews/` 前缀的产物对象需按 `content_hash` 反查引用后清理（M4-05 收口项）。
- **枚举边界**：v1 历史版本在证据二已经 ready，证据三只断言「按版本路由到对应三元组」，未重复覆盖 ready 分支。

## 复跑

```bash
cd deploy/preview && docker compose up -d            # 转换沙箱（首次需 build）
cd server && npm run build && npm run start:api &     # api（BASE_URL）
OUTBOX_POLL_MS=1000 npm run start:worker &            # worker（消费补投的 preview.job）
cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
  node --env-file-if-exists=.env scripts/m4-preview-read-replay.mjs --out "../docs/m4-05d-回放证据(预览读API).md"
```
