# ADR-030 在线预览：Office 预览改由 ONLYOFFICE 查看器承接（只读、受控拉取）

- 状态：草案（Proposed）｜评审：**计划内审核**（2026-09-30：原「wmj 审」两项已由计划内审核代行 —— 契约草案与残余风险接受，见 `docs/PoC-10-安全定稿(R1-R2·受控下载端点).md` §7；仅限「ONLYOFFICE 替换执行计划」范围内）｜随 PR 合并 main 后转「已采纳（Accepted）」
- 日期：2026-09-30｜决策人：lan（D1 / D2 / D5）；D3 = 业务 / 法务、D4 = 业务（2026-09-30 口径）
- 依据：`docs/ONLYOFFICE替换执行计划(Office预览).md` §0~§3；`docs/PoC-10-回放证据(ONLYOFFICE查看器·首关).md`；`docs/PoC-10-回放证据(ONLYOFFICE查看器·保真度).md`；`docs/PoC-10-安全定稿(R1-R2·受控下载端点).md`；`docs/PoC-10-部署前置定稿(F1-R3·R6).md`；`系统功能书.md` A4-11 / A4-19 / D2-01 / D2-04 / D2-09；业务 / 法务口径 2026-09-30（自托管满足「不经第三方软件」；ONLYOFFICE 社区版 AGPL 获接受）

## 背景

- 现状（ADR-007）：Office 预览走自建转换管道（LibreOffice headless → PDF），产物进 `previews/`；预览所见的都是「转换件」，与原件存在保真差（Excel 分页 / 字体 / 复杂版式），且预览与下载的产物观感容易混淆。
- 业务约束（不变）：预览在系统内直接查看、不经过第三方软件、不上传第三方云；**不做在线编辑**（系统功能书 A4-19 / D2-09 定档在二期）。
- 2026-09-30 决策链（全部有据）：D1~D5 冻结（计划 §0）；首关三组通过（20/50 并发 / JWT 只读不可绕 8/8 / 中文字体与内网拓扑）；N1 保真度 5/5 无内容性失真（构造样本双侧比对）；N2 安全定稿（受控下载端点：去预签名、outbox Bearer 鉴权）。
- 硬约束：数据不出内网（自托管）；服务端锁死只读；下载仍为**原文件**（权限 + 审计口径不变）。

## 决策

- **形态（D1）**：ONLYOFFICE Docs（自托管）**仅作在线查看器**（`editorConfig.mode="view"`）；**不做在线编辑**；**不采用 Conversion API 形态**（不把第三方引擎作为格式转换 / 分发链）。
- **版本（D2）**：镜像 `onlyoffice/documentserver:9.4.0.1`（digest `sha256:3ab6ebc7c605e5a32b7ae3ff19daed4925090245acc8100ce2230bd766c88212`，pin）；回退规则 9.3.1.2 未触发。
- **合规（D3）**：自托管满足「不经第三方软件」；AGPL 社区版获法务 / 采购接受。
- **范围（D4）**：仅替换「Office 文档预览链」——PDF / 图片直通、用户下载链（原对象 + `file.download` + download 审计）、CAD（ADR-008）、审计口径（C7）不动；**移动端不在业务范围（不做）**。
- **拉取链路（N2 定稿，安全不变量）**：预览链**全程无对象存储预签名**；查看器 `document.url` 指向本仓受控端点（`GET /api/v1/files/{id}/versions/{versionId}/preview-content`，命名以 S1 契约定案为准）；端点凭 DocServer outbox `Bearer JWT` 鉴权（HS256 共享密钥 + `payload.url` 逐字绑定 + ≤300s）并以服务端 SDK 流式读取；`token.enable.request.outbox=true` 为期望态；一切失败 **fail-closed**（不降级泄漏）。
- **不变量**：① 编辑服务端锁死（B 组 8/8 拒绝；b6 客户端篡改 → 服务端拒绝、零持久）；② 下载始终为原文件与原名（`download-url` + `file.download` + download 审计）；③ 自托管、无外发（C 组正反例闭环）。
- **兜底与切换（D5）**：`deploy/preview`（LibreOffice）与 ONLYOFFICE **并存**至切换完成；预览失败降级「请下载」（D2-05）；LibreOffice 退役（S6）以业务确认为准。

## 备选与不采用原因

- 维持 ADR-007 自建转换管道：保真与体验上限受限、每格式维护成本高；业务已确认替换（本 ADR 取代之）。
- ONLYOFFICE Conversion API 形态：形成「第三方引擎转换 + 分发转换件」的新链路，与「查看器直读原文件」的体验与边界不符；不采用（D1）。
- Collabora Online / WPS 365 / 金山中台：合规与体验评估不优于本方案（详见 ADR-007 备选段与 D3 口径）；不采用。
- 在线编辑（一期）：系统功能书定档在二期（A4-19 / D2-09）；本期仅查看器并服务端锁死。

## 影响与后果

- **ADR-007 → 被取代（Superseded）**：其「自建转换管道」结论停止执行；`deploy/preview` 作为并存兜底保留至 S6 退役。
- **ADR-013（部署与容量）修订指向**：新增 ONLYOFFICE DocServer 容器预算（首关实测：2C4G 沙箱 20 并发 p50 ≈ 7.1s；50 并发服务端 ≤1.2 核 / <0.9GB、零饱和；生产配额与真实终端复测（R4）在 S5 后回写）；组件清单与入口规则（`/preview-content` 仅内网）随 S2 落部署清单。
- **ADR-017（版本基线与依赖升级）修订指向**：依赖清单增 `onlyoffice/documentserver`（pin 版本 + digest；升级独立 PR + 回归）；local.json 覆盖项（`blockPrivateIP` / outbox / 字体 / 401 基线 / 示例 app）列入升级回归（见部署前置定稿）。
- **契约与实现归位**：S1 契约（受控端点路由 + `FilePreviewResponse` 查看配置 / JWT）、S3 服务端（受控端点 + 配置签发）、S4 前端（查看器外壳 + R5 降级）、S5 回归与双轨（R4 门禁 + 验收断言）、S6 退役 LibreOffice —— 均见执行计划 §4。
- **残差（书面接受）**：内网 Bearer 300s 内可重放（条件 D1~D4，S5 复核点）；TOCTOU（签发后退权 300s 窗口，影响极低）。
- **待同步（跨线，按流程）**：`系统功能书.md` D2-01 的引擎括注（「自建转换管道」）由变更提出人按《系统功能书》流程提交、wmj（技术可行性）/ px（实现一致性）复核 —— 本 ADR 不代改（登记于执行计划）。

## 切换触发条件

- DocServer 厂商策略 / 许可变化使自托管不可行 → 重评估替代（Collabora 等）或回退；
- 保真度 / 并发出现不可接受回归 → 回退 LibreOffice 管道（S6 前始终保留）；
- 业务启用在线编辑（二期）→ 由「查看器」升级为「编辑器」需新增 ADR（编辑锁 / 审计 / 回调链另议）。

## 参考

- `docs/ONLYOFFICE替换执行计划(Office预览).md`（唯一执行口径：D1~D5 / 首关 / 次关 N1~N3 / 实施切片 S1~S6 / R1~R6 归位）
- `docs/PoC-10-回放证据(ONLYOFFICE查看器·首关).md` / `docs/PoC-10-回放证据(ONLYOFFICE查看器·保真度).md`
- `docs/PoC-10-安全定稿(R1-R2·受控下载端点).md`（含计划内审核记录 §7）/ `docs/PoC-10-部署前置定稿(F1-R3·R6).md`
- `系统功能书.md` A4-11 / A4-19 / D2-01 / D2-04 / D2-05 / D2-09；`团队分工.md` §6 第 10~11 项
