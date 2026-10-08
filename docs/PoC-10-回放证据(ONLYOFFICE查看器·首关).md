# PoC-10 回放证据（ONLYOFFICE 查看器 · 首关）

> 卡片：PoC-10（主责 lan，协办 wmj、px）｜决策依据：文件模块底层由 LibreOffice 转换预览全面替换为 ONLYOFFICE（自托管社区版，AGPL；形态 = 在线查看器，不启用 Conversion API；不做在线编辑）。首关验收口径：**① view 模式 20/50 并开与资源曲线；② 只读不可绕（JWT 篡改全拒绝）；③ 中文字体与内网拓扑**。任何一项不过即停下改方案；首关通过后再进次关（口径以 `docs/ONLYOFFICE替换执行计划(Office预览).md` 为准）。
> 本文件属垫底记录（代记先例：PoC-5），请 px 复核；数字同步供 ADR-030（wmj 主责）引用。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-30 11:45 ~ 13:00 +08:00 |
| 镜像 | `onlyoffice/documentserver:9.4.0.1`（digest `sha256:3ab6ebc7c605e5a32b7ae3ff19daed4925090245acc8100ce2230bd766c88212`，两处 pin 一致） |
| 容器 | 本机独立容器 `libiaolink-onlyoffice-poc`（`127.0.0.1:8001->80`，接入 `libiaolink-minio_default`），2C4G 起步（4C8G 归因复跑见 §2），仓外 compose |
| 存储 | 复用本仓 MinIO（`libiaolink-minio:9000`），夹具前缀 `poc10/`（收尾即删） |
| 执行环境 | Windows 11 / PowerShell；无头 Edge（`--headless=new`）多实例；Node 24 |
| 代码版本 | `ccebaac`（本次证据提交前一轮）；无契约 / 服务端实现 / DDL / 依赖改动 |
| harness | `server/scripts/poc10/`（viewer.mjs / b6-edit-probe.mjs / storage.mjs / poclib.mjs / http-burst.mjs） |

## 0. 环境定格与两个现场发现

**配置定格（本沙箱工作态）**：`token.enable.browser=true`、`token.enable.request.inbox=true`、`token.enable.request.outbox=false`、`externalRequest.action.blockPrivateIP=false`。JWT 密钥本地生成，不入库、不入证据。

| 编号 | 发现 | 证据与处置 |
|---|---|---|
| F1 | 9.4 起 `externalRequest.action.blockPrivateIP` 默认 true，DocServer 直接拒绝内网拉取（onError -4 / 400）；env `ALLOW_PRIVATE_IP_ADDRESS` 覆盖不到该键；`directIfIn.allowList` 实测不能替代放行 | 就地改容器 `local.json` 为 false 后拉取恢复 200；**升级会覆盖 local.json，生产需把该配置纳入部署清单（次关定稿配置路径）** |
| F2 | `outbox=true` 时 DocServer 拉文档会附加 `Authorization: Bearer <JWT payload={url}>`，与 S3 预签名 URL 冲突：MinIO 400 `InvalidRequest: multiple authentication types` | 抓包与日志存档（仓外 `logs/poc10-capture-outbox-jwt.log`）；本沙箱 outbox=false（view-only 无回调需求）。**次关设计项：若未来启用 outbox 校验，拉取改走「DocServer → 我们 API 受控下载端点（验 Bearer JWT）」，不要对 MinIO 预签名 + outbox 同开** |

## 1. C 组 · 中文字体与内网拓扑（先行，影响 A/B 观测量）

| PASS | C1a | 镜像默认无中文字体 | `fc-list :lang=zh` 结果 = 0 条 |
| PASS | C1b | 安装 Noto Sans CJK SC（Regular + Bold，开源）并跑 `documentserver-generate-allfonts.sh` 后生效 | `fc-list :lang=zh` = 2 条；`AllFonts.js` 含 “Noto Sans CJK SC”；截图对照（装前 `a1-green-view.png` / 装后 `a1-post-font-view.png`） |
| PASS | C2a | DocServer 容器内经内网地址可拉 MinIO 预签名 URL | 容器内 `curl http://libiaolink-minio:9000/...` = 200 |
| PASS | C2b | 反例：容器内不可用宿主环回地址 | `curl http://127.0.0.1:9000/...` = 000（不可达），排除了“靠转回宿主”的伪通过 |

> 附注：装字体前 Windows 客户端因本机字体回退也能显示中文；服务端字体对跨端一致性（含 PDF 直通等场景）仍必要，已按上表闭环。

## 2. A 组 · 并发（view 模式）

### 2.1 结果矩阵（夹具：docx + xlsx 混排；每用例独立 docKey + 预签名 URL TTL 900s）

| 轮次 | 客户端形态 | 容器 | ready | timeout（300s 级） | cdp-broken/挂死 | error（服务端拒绝类） | readyMs p50 / p95 / max | CPU 峰 | 内存峰 |
|---|---|---|---|---|---|---|---|---|---|
| A2 | 3 实例 × ~17 标签 | 2C4G | **20/20** | 0 | 0 | 0 | 7.1s / 10.2s / 10.2s | 53% | 843MB |
| A3-r2 | 3 实例 × ~17 标签 | 2C4G | 37/50 | 8 | 5 | 0 | 13.4s / 18.3s / 20.0s | 114% | 880MB |
| A3-r3（含网络探针） | 3 实例 × ~17 标签 | 2C4G | 38/50 | 5 | 7 | 0 | 16.7s / 22.3s / 23.2s | 112% | 897MB |
| A3-r4 | 8 实例 × ~7 标签 | 2C4G | 42/50 | 6 | 2 | 0 | 20.4s / 29.1s / 29.5s | 132% | 897MB |
| A3-r5（归因） | 3 实例 × ~17 标签 | **4C8G** | 38/50 | 9 | 3 | 0 | 16.8s / 21.8s / 22.4s | 114% | 902MB |
| A1 基线 | 单开 | 2C4G | 1/1 | 0 | 0 | 0 | 1.3s（冷开含转换） | — | — |

> A3 首轮（11:58 起，harness 早期缺陷）另有记录：37 个在 9~25s 就绪、12 个卡满 300s、1 个页面试探无响应；因当时脚本 CDP 无超时保护，整轮结果未完整落盘，仅存用例 dslog 时间戳与 case-00 截图（`a3-50-00.png`）。r2 起为定档数据。

### 2.2 观察到的“超出行为”

- 服务端**不拒绝、不降级只读、不弹许可**：50 并发全部被受理执行（20/50 无许可墙迹象；CE 的“20 编辑并发”限制不在本次范围——不做在线编辑）。
- 服务端资源余量大：三轮 2C4G 与一轮 4C8G 的曲线同形，CPU 峰 ~1.1 核（上限 2 核的 ~57%）、内存峰 < 0.9GB / 4GB；4C8G 复跑结果与 2C4G 一致 → **“资源型”不成立**。
- 失败的 ~13/50 全部集中在**客户机侧**（无头 Edge 多实例）：
  - 失败形态 = 编辑器模块请求 `net::ERR_ABORTED`（如 `require.js`、`ColorPalette.js`）→ RequireJS “Script error” → 页面永久 loading（300s 后被判 timeout）；部分用例伴随渲染进程断连（CDP 1006）；
  - r3 的 7 个受害用例**全部落在同一浏览器实例**（i%3==2，端口 9422）；该实例留下 Crashpad 转储：`msedge.dll` `0xc0000005`，`ProcessType=browser`（浏览器进程访问违例，仓外 `logs/crashpad-r3/`）；
  - 服务端侧全程静默：nginx error log 0 字节、docservice 运行日志无新增（最后一行仍是启动记录）、无重启；宿主侧 300 并发纯 HTTP 压测（同路径经 `com.docker.backend` 端口代理）900/900 全成——排除端口代理丢包与 DocServer 拒服。
- 结论（归因）：**50 并发下的掉线是回放客户机（多实例无头 Edge）的稳定性边界，不是 ONLYOFFICE 服务端能力上限**；服务端在 2C4G 即无饱和地承载了 50 个 view 会话。生产需在部署环境以真实客户端复测并发（次关/上线前项）。

### 2.3 反向观察（UX 缺口，前端待办）

加载失败/超时的页面表现为**白屏/长转圈，无错误提示与重试**（r2-r5 截图留存）。产品化时我们自己的查看器外壳需加：加载超时判定、失败文案、重试入口（不暴露 DocServer 内部报错）。

## 3. B 组 · JWT 与只读不可绕

| # | 用例 | 期望 | 实际 | 判定 |
|---|---|---|---|---|
| b1 | 无 token | 拒绝 | onError **-20**「文档安全令牌的格式不正确」 | PASS |
| b2 | 篡改 payload 不重签（宣告 edit） | 拒绝 | -20（签名失效） | PASS |
| b3a | 换密钥重签（宣告 edit） | 拒绝 | -20 | PASS |
| b3b | `alg=none` 伪造 | 拒绝 | -20（不接受未签名） | PASS |
| b4 | 过期 token | 拒绝 | **-21**「文档安全令牌已过期」 | PASS |
| b5 | A 的 token 配 B 的 config（B 为带标记夹具） | 以 token payload 为准 | 渲染内容 = **文档 A**（B 的标记文本未出现），客户端标题栏 B 为纯 UI 提示 | PASS |
| b6 | 客户端 config 篡改（token 仍 view，签名后改） | 服务端不得接受编辑 | 见下 §3.1：**服务端当场拒绝并告警；零持久** | PASS |
| b7 | 直连 `/example/`（内置示例） | 不得出现文档会话/内容 | 默认关闭（502「Test example is not running」）；手动启动后自身 500（`siteUrl` 指向 `documentserver` 主机名不可解析），不产生任何会话 | PASS |

### 3.1 b6 深测链（阳性对照 + 同 key 重开核验；脚本 `poc10/b6-edit-probe.mjs`）

| 步骤 | 场景 | 观察 | 结论 |
|---|---|---|---|
| c0 | 合法 edit token（阳性对照，证明输入路径有效） | 真实键入落字，状态栏「所有更改已保存」 | 输入与保存通路有效 |
| c0v | 同 key 重开 | 与 c0 状态一致 | 会话可持久复核 |
| c1 | view token + 签名后把客户端 config 改为 edit | UI 一度渲染出编辑外观，但真实输入触达服务端后被拒：**弹窗「您正在尝试执行您没有权限的操作。请联系您的文档服务器管理员。」** | 服务端以 token 权限为准 |
| c1v | 同 key 视图重开 | 文档内容与原文完全一致（无键入痕迹） | **零持久：只读不可绕成立** |

> 证据截图（仓外，hash 留档）：`b6t-c0-typed.png` / `b6t-c1-typed.png`（拒绝弹窗）/ `b6t-c1-reopen.png`。

## 4. 风险登记（次关 / 生产待办）

| # | 风险 | 说明与建议 |
|---|---|---|
| R1 | token payload 内 `document.url` 为预签名 URL（测试 TTL 900s） | view-only 的 `download=false` 约束不了“URL 持有者直接 GET”——TTL 内可拉原文件。次关定稿：更短 TTL / 专用受控下载端点 / 网关校验；并把下载收口到本仓 API 的权限判定（对齐既有下载切片） |
| R2 | outbox × 预签名冲突（F2） | 生产若启用 outbox 校验，必须走受控下载端点，勿直接对 MinIO 预签名 |
| R3 | `blockPrivateIP` 属运行时 `local.json`（F1） | 升级/重建会覆盖；纳入部署清单与升级回归项 |
| R4 | 50 并发生产复测 | 本机客户机侧不可作为上限依据；部署环境（宿主 Linux + 真实浏览器终端）按下发口径复测 |
| R5 | 前端错误 UX（§2.3） | 查看器外壳加超时/重试/文案 |
| R6 | 示例 app（ds:example） | 保持默认关闭且不在网关暴露 `/example/` |

## 5. 首关结论

- **A 组（服务端侧）通过**：2C4G 承载 20/20 无异常；50 并发服务端受理无拒绝、无降级、无许可墙，资源余量大（≤1.2 核 / ≤0.9GB）；4C8G 复跑曲线同形，排除资源型疑点。客户机侧 16~24% 掉线已归因于回放工具，非服务端问题（登记 R4 生产复测）。
- **B 组通过**：8/8 用例全部拒绝或按 token 约束执行；b6 深测证明“客户端外观可篡、服务端权限不可绕、零持久”。
- **C 组通过**：中文字体服务端闭环；内网拓扑拉取正/反例闭环。
- **首关判定：通过（服务端侧）**，附条件：R1/R2/R3 在次关定稿、R4/R5 进生产/前端待办。`deploy/preview`（LibreOffice）不退役，与 ONLYOFFICE 并存至替换切换完成。

## 6. 复现要点

1. 起容器：`onlyoffice/documentserver:9.4.0.1`（pin digest），`JWT_ENABLED=true` + 自置 `JWT_SECRET`，映射 `127.0.0.1:8001->80`，接入 MinIO 网络；容量按需 `--cpus/--memory`；
2. 容器内：`local.json` 置 `externalRequest.action.blockPrivateIP=false`（F1）；安装 Noto Sans CJK SC 后跑 `documentserver-generate-allfonts.sh`；`outbox` 保持 false（F2）；
3. 夹具上传与预签名：`poc10/storage.mjs`（S3_* 取自 `server/.env`）；
4. 回放：`poc10/viewer.mjs single|burst|tamper`、`poc10/b6-edit-probe.mjs`、`poc10/http-burst.mjs`（用法见 `server/scripts/poc10/README.md`；需要 `POC10_JWT_SECRET`）；
5. 收尾：删 `poc10/` 前缀对象与容器，确认零残留。

## 7. 附件清单（仓外证据，零残留口径：留 hash 后清理）

| 文件 | 字节 | sha256 前 16 位 |
|---|---|---|
| logs/a2-20.json | 5890 | 84bfba6634e9a098 |
| logs/a3-50-r2.json | 36196 | 679a3f10047ba515 |
| logs/a3-50-r3.json | 39038 | 422f7faf34a57682 |
| logs/a3-50-r4.json | 26893 | 73fce747fc606c0c |
| logs/a3-50-r5-4c8g.json | 43792 | 38016b470a27b7fd |
| logs/b.results.jsonl | 3097 | 625b99b832f01358 |
| logs/bfix.results.jsonl | 1127 | 89adf3fd138b7342 |
| logs/b6type.json | 1017 | ef564d9fcc228a3f |
| logs/crashpad-r3/*.dmp（浏览器进程转储） | 10204592 | 688913fc9dbfbc20 |
| shots/a3-50-00.png（run-1 case-00） | 35731 | 1d100cfb5be73d60 |
| shots/bfix-b5.png（b5 内容归属） | 36198 | 94e709d69d0a0c43 |
| shots/bfix-b7.png（直连示例页） | 5611 | f117ea5295e5a037 |
| shots/b6t-c0-typed.png（阳性对照） | 36407 | c50fc67907441127 |
| shots/b6t-c1-typed.png（拒绝弹窗） | 41530 | 6563bf7efac2cadd |
| shots/b6t-c1-reopen.png（重开零持久） | 36140 | ec354ea77cb113a8 |

各轮并发的完整采样曲线（`*-samples.csv`）与逐用例明细（`*.results.jsonl`、`*.dslog.txt`）同在仓外 `D:\poc10-onlyoffice\logs\`。
