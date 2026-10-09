# S4 回放证据（ONLYOFFICE 查看器外壳 · 前端）

> 卡片：ONLYOFFICE 替换实施切片 **S4**（主责 px）｜口径来源：`docs/ONLYOFFICE替换执行计划(Office预览).md` §4（S4 出口 = 回放证据）｜`docs/契约切片草案(S8-2-ONLYOFFICE查看器).md` §三（查看器四段）｜**R5**（前端错误 UX：超时 / 重试 / 文案 + 降级「请下载」）。
> 结论：**21 / 21 断言全过 + 零残留 + 页面控制台 0 异常**（S4 首跑 · 2026-10-08）；**Push 258 复跑 23 / 23 全过**（2026-10-09）—— 查看器「右上角下载 → 原文件」收口，增量见「Push 258 复跑」。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-10-08 12:07 +08:00 |
| 前端 | http://localhost:3010（隔离 worktree 分支 `codex/s4-onlyoffice-viewer`，基线 `948d485`；`BACKEND_ORIGIN=http://127.0.0.1:3011 npm run dev -- --port 3010`） |
| 目标 api | http://127.0.0.1:3011（主仓 `server/dist`；`ONLYOFFICE_DOCSERVER_API_BASE_URL=http://host.docker.internal:3011`） |
| DocServer | http://127.0.0.1:8001（沙箱容器 `libiaolink-onlyoffice-docs`；JWT_ENABLED=true，密钥与 api 同值） |
| 数据库 | `postgresql://libiaolink_api@127.0.0.1:5433/libiaolink`（沙箱 `libiaolink-pg`） |
| 对象存储 | SeaweedFS 沙箱（容器 `libiaolink-s3` @127.0.0.1:9000；仅沙箱、不代表生产选型 —— 沿用 S2 / S3 口径） |
| 夹具 | `server/scripts/poc10/fixtures/n1-01-fee-summary.xlsx`（12,965B）/ `n1-03-weekly-report.docx`（57,166B）—— 脚本复制为「回放-S4-费用表.xlsx / 回放-S4-周报.docx」经抽屉真选上传 |
| 脚本 | `frontend/scripts/s4-onlyoffice-preview-e2e.mjs`（临时会话 `px-s4-oo-e2e` + 临时项目 `PX-S4OO-xxxxxx`，跑完零残留） |
| 截图 | `s4-onlyoffice-error.png`（降级态）/ `s4-onlyoffice-ready-xlsx.png`（解除阻断 → 重试后就绪）/ `s4-onlyoffice-ready-docx.png`（DOCX 就绪）；Push 258 复跑增 `s4-onlyoffice-native-hit.png`（命中层在位 · 悬停态）/ `s4-onlyoffice-native-hit-hover.png`；均在 `%TEMP%` |

## 断言明细

| PASS | 夹具·P1 | 建临时项目（201）
  - 期望：201 + 项目可见
  - 实际：201 `PX-S4OO-6FE5F7`（seqNo 365）
| PASS | 夹具·T1 | 建一条任务（201）
  - 期望：201
  - 实际：201 `38b0908d-56cb-42ac-bd74-fdc1525066ce`
| PASS | 夹具·D1 | 点任务行打开详情抽屉
  - 期望：抽屉出现
  - 实际：true
| PASS | ①a | 抽屉内上传 XLSX（真夹具）→ 落库（draft）
  - 期望：draft 行 + 文件名
  - 实际：`{"id":"a72892c5-…","name":"回放-S4-费用表.xlsx","status":"draft"}`
| PASS | ①b | Office 行有「预览」入口（title = 在线预览（ONLYOFFICE 查看器））
  - 期望：按钮在位（S4 起 Office / 文本族走查看器通道）
  - 实际：`在线预览（ONLYOFFICE 查看器）`
| PASS | ①c | api.js 被 CDP 网络阻断 → 查看器降级（R5）
  - 期望：`data-oo-status=error` + 「暂无在线预览」+ 原因副行 +「重试」按钮 + 浮层 / 抽屉都在
  - 实际：`{"viewer":true,"fallback":true,"text":"暂无在线预览  查看器脚本加载失败（DocServer 不可达）  重试","retry":true,"overlayKind":"office","drawer":true}`
| PASS | ②a | 解除阻断 → 点「重试」→ 就绪（重试路径闭环）
  - 期望：`data-oo-status=ready` + 编辑器 iframe ≥ 1
  - 实际：`{"found":true,"status":"ready","frames":1}`
| PASS | ②b | Esc 先关查看器浮层、抽屉仍在（「Esc 先关内层」）
  - 期望：浮层消失 + 抽屉在
  - 实际：true
| PASS | ③a | 抽屉内上传 DOCX（真夹具）→ 落库（draft）
  - 期望：draft 行 + 文件名
  - 实际：`{"id":"a0962b6f-…","name":"回放-S4-周报.docx","status":"draft"}`
| PASS | ③b | 点「预览」→ 查看器就绪（kind=office / iframe 在位 / caption「下载原文件」/ 抽屉仍在）
  - 期望：ready + iframe ≥ 1 + overlayKind=office + download=true + drawer=true
  - 实际：`{"found":true,"status":"ready","frames":1,"overlayKind":"office","download":true,"drawer":true}`
| PASS | ④a | 查看器签发形状（直取 `GET /files/{id}/preview`）
  - 期望：ready + viewer 非空 / url / target 空 + kind=onlyoffice / documentType=word / fileType=docx / mode=view / permissions（edit=false · download=false · protect=true）
  - 实际：`{"status":200,"viewerKind":"onlyoffice","documentType":"word","mode":"view"}`
| PASS | ④b | document.url = 受控端点绝对 URL（DocServer 视角基址 + /preview-content）+ 无 X-Amz- 预签名参数
  - 期望：前缀 `http://host.docker.internal:3011/api/v1/files/` + 含 `/preview-content` + 无 `X-Amz-`
  - 实际：`http://host.docker.internal:3011/api/v1/files/a0962b6f-…/versions/6276bcd2-…/preview-content`
| PASS | ④c | token 三段 JWT：HS256 复算一致 + exp-iat=900 + 四段逐字
  - 期望：签名一致 + TTL 900 + `document.key` = 版本内容哈希 + `editorConfig.mode=view` + `permissions.download=false`
  - 实际：`{"parts":3,"signatureMatch":true,"ttl":900,"keyMatchesHash":true,"secret":"loaded"}`（密钥仅用于回放侧复算、不落档）
| PASS | ⑤a | DOCX 审计：UI 开查看器 1 条 + 直取 1 条 = 2 条 preview
  - 期望：2 条 + metadata.viewerKind=onlyoffice / documentType=word + 摘要含「ONLYOFFICE 查看器」
  - 实际：`{"count":2,"summary":"预览文件：回放-S4-周报.docx（版本 v1 · ONLYOFFICE 查看器）","metadata":{"versionId":"6276bcd2-…","viewerKind":"onlyoffice","documentType":"word"}}`
| PASS | ⑤b | XLSX 审计：首开 + 重试 = 2 条（每次签发一条）
  - 期望：2
  - 实际：2
| PASS | ⑥ | 受控端点反例：无 token 直取 document.url 同路径 → 401 且无重定向
  - 期望：401 + 无 Location + 未跳转
  - 实际：`{"status":401,"location":null,"redirected":false}`
| PASS | ⑦a | 两份回放文件全部 purge（对象真删 + 元数据删 + 留痕）
  - 期望：total=2 / purged=2
  - 实际：`{"total":2,"purged":2}`
| PASS | ⑦b | 临时项目物理删（200 / 204）
  - 期望：200 / 204
  - 实际：200
| PASS | ⑦c | 项目读面 404（物理删、行不存在）
  - 期望：404
  - 实际：404
| PASS | ⑦d | 零残留：文件 / 关联 / 任务 / 项目 / 会话全 0 行
  - 期望：全 0
  - 实际：`{"files":0,"links":0,"tasks":0,"projects":0,"sessions":0}`
| PASS | ⑧ | 页面控制台无「非预期」异常（排除①的 api.js 阻断注入）
  - 期望：非预期 0
  - 实际：0 条（非预期 0）

## 汇总

- 合计 **21 项：21 通过 / 0 失败**；零残留；页面控制台 0 异常（含阻断注入也是 0 条）。
- R5 三条覆盖：降级（①c：「暂无在线预览」+ 原因副行 +「重试」+ 浮层 caption「下载原文件」）、重试（②a：解除阻断点「重试」→ 重取配置（token 刷新）+ nonce 重建 → ready 闭环）、超时（20s 常量 `READY_TIMEOUT_MS` + 同款降级 UI；本次未真机注入，见下）。

## Push 258 复跑（2026-10-09 · 查看器下载收口）

业务口径（2026-10-09）：「onlyoffice 点击右上角下载都是 pdf 格式…我要文件本身格式」→「不要隐藏原本的下载」→「触碰也要有阴影效果 / 鼠标也要变成小手，效果和旁边的搜索一样」→「现在的是我们下载原文件的按钮，是没问题的」。

环境与首跑同（api 127.0.0.1:3001 / DocServer 10.1.7.169:8001 / PG 5433 / SeaweedFS 9000），差别：前端 = 主仓 dev `http://10.1.7.169:3000`（真机 LAN 地址，非安全源）。

修订 / 新增断言：

- ①b 入口断言改「`data-file-preview-open` · 文案『预览』」+ 轮询（原 title 断言随 UI 演进失效）；
- ③b 增 `nativeDownload`：查看器就绪时原位命中层在位（`data-file-preview-native-download`，几何 = 原生下载子按钮盒：距右 92 / top 4 / 24×24）；
- ③c 悬停反馈对齐原生：pointer 小手 + 灰底（8% 黑遮罩、白底合成 ≈ `#EAEAEA`、图标透出、圆角 4px、无阴影）；截图 `s4-onlyoffice-native-hit-hover.png`；
- ③d（新）命中层真点击 → **原文件字节落盘**：`Browser.setDownloadBehavior` 定向临时目录 + 20s 轮询 —— 落盘名 = 夹具原名（`回放-S4-周报.docx`）、sha256 与夹具逐字节一致、无 `.crdownload` 残留，且 `download` 审计 +1；
- ④a / ④c 改口径：`document.permissions.download=true`（图标保持可见；点击由命中层接管）+ `permissions` 嵌 `document`（顶层无；token 载荷同步）。

结果：**23 / 23 全过 + 零残留 + 控制台 0 异常**（①–⑧ 与首跑同口径，新增 ③d）。

**真机行为实测（有头 Chrome 154 · 回放脚本之外）**：页面的源是 http 内网（非安全源）时，Chrome 对从该页发起的**一切**下载（http 直链与 `blob:` 都在内）都标「不安全下载 → 未确认 *.crdownload」等用户「保留」；对照实验（同一 `blob:` 流程换安全源 `http://127.0.0.1:3000`）干净落盘 `px-blob.docx` —— 判定看**发起页面的源**，blob 不豁免。结论：应用侧保证「字节 = 原文件、文件名 = 原名」；彻底消除「保留」提示归部署侧（①站点升 https（下载字节需同源化，避免混合内容）；②Chrome 策略把该源标记为安全（`OverrideSecurityRestrictionsOnInsecureOrigin` / chrome://flags）。
## 未覆盖 / 风险登记

- **超时分支未真机注入**：需 DocServer 半连不响应才触发，本次以「阻断 → api.js onerror → error」为主路径；timeout 与 error 走同一降级 UI，记 S5 真实终端复测的可选注入项。
- **DocServer 内错误（`onError` 事件）路径**：组件同款降级（文案「查看器错误：…」）；本次未构造 DocServer 侧错误用例（如损坏文件），S5 可补。
- **401 直取为脚本侧 Node fetch**：服务间校验六反例已由 S3 证据（`docs/s8-2-回放证据(S3·受控预览端点).md`）覆盖；本卡只回归「无 token → 401」这一条前端相关不变量。
- **阻断注入是测试态**：`Network.setBlockedURLs` 仅存在于回放脚本，不进产品代码。
- **移动端不涉及**（一期口径：桌面浏览器）。

## 复跑

```bash
# 1) 前端 dev（worktree）
cd frontend && BACKEND_ORIGIN=http://127.0.0.1:3011 npm run dev -- --port 3010

# 2) api（3011；密钥 = deploy/onlyoffice/.env 的 OO_JWT_SECRET，与容器 JWT_SECRET 同值）
cd server && PORT=3011 ONLYOFFICE_JWT_SECRET=<同值> \
  ONLYOFFICE_DOCSERVER_API_BASE_URL=http://host.docker.internal:3011 \
  node --env-file-if-exists=.env dist/entry/api.js

# 3) 回放（PG 模块用主仓 node_modules；默认端口 3010 / 3011 / 9412）
cd frontend && PG_MODULE=file:///D:/LibiaoLink/server/node_modules/pg/lib/index.js \
  node scripts/s4-onlyoffice-preview-e2e.mjs
```

> 沙箱提示：DocServer / S3 / PG / 预览转换器容器须先起（deploy/onlyoffice、deploy/minio、deploy/preview 沙箱脚本，见各自 README）。查看器通道下 S3 容器**不需要**接入 DocServer 内网 —— `document.url` 指向 api（`host.docker.internal:3011`），字节由 api 侧自读对象存储直写。
