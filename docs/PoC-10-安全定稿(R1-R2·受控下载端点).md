# PoC-10 安全定稿（R1 / R2 · 受控下载端点）——次关 N2

> 归属：lan（后端平台线）· 2026-09-30。唯一执行口径见 `docs/ONLYOFFICE替换执行计划(Office预览).md`（本文件为该计划 N2 的产出，任何变动随计划走变更记录）。
> 状态：**定稿完成**；契约影响段（§3.2 / §6）待 **wmj 审定**后由 S1 落契约；「ADR-030 待并入段落」（§5）由 N3（wmj）承接；「部署清单待并入段落」（§3.4）由 S2（px）承接。
> 依据：首关证据 `docs/PoC-10-回放证据(ONLYOFFICE查看器·首关).md`（B 组 / F2 / R1 / R2）；抓包（仓外）`D:\poc10-onlyoffice\logs\poc10-capture-outbox-jwt.log`；离线校验（本机，2026-09-30，见 §4 E2）。

## 1. 结论（定稿）

| 风险 | 定稿 | 要点 |
|---|---|---|
| **R1** 预签名 TTL 内可绕 `download=false` 直取原文件 | **采纳 a：受控下载端点**（与 R2 合并设计） | 预览链**全程无预签名**：查看器 `document.url` 指向本仓受控端点；端点凭 DocServer 出站 `Bearer JWT`（outbox）鉴权，服务端 SDK 流式读对象；浏览器 token 泄露不再构成取文件能力 |
| **R2** outbox × S3 预签名 400 | 冻结约束照旧落字；设计归位本文件；实现随 **S3** 触发 | 「禁止 MinIO 预签名与 outbox 同开」不变；受控端点取代预签名后该组合不复存在；生产 `outbox=true` 常开（鉴权依赖），F3「重启改回 true」由事故变为期望态 |

附则：R1 备选 b（更短 TTL + 书面接受）**不再采用**；若 S3 实施中发现 a 不可行，须回计划文件重开 N2 定稿（登记变更记录），不得静默滑入 b。

## 2. 现状与暴露面（定稿依据）

- 现行链路（PoC 实证）：查看器配置 token 的 payload 含 `document.url` = **MinIO 预签名 URL**（沙箱 TTL 900s）；JWT 载荷只签名不加密，浏览器侧可解出该 URL → 任何「可预览」（项目可见）但无 `file.download` 权限的用户，可在 TTL 内直取**原文件**，绕过下载权限点与 `action=download` 审计。
- `editorConfig.mode=view` / `permissions.download=false` 只约束查看器自身行为（DocServer 按 token 判定，B 组 b2 / b6 已证服务端侧不可绕）——**约束不了 URL 持有者的直接 GET**，这是 R1 的实质。
- F2 实证：`outbox=true` 时 DocServer 拉取 `document.url` 会附加 `Authorization: Bearer <JWT>`；URL 若为 S3 预签名，则 MinIO 报 400 `InvalidRequest: multiple authentication types`（双认证冲突）。沙箱因此被迫 `outbox=false`；且容器重启会被 entrypoint 改回 true（F3）——现状是「与配置漂移对抗」，不是可上生产的安全形态。
- 离线校验（2026-09-30，对抓包 3 条 Bearer 逐条重算 HMAC-SHA256，密钥 = 沙箱 `POC10_JWT_SECRET`）：
  - **签名 3/3 通过**（`alg=HS256`）→ 端点可用与 DocServer 共享的 JWT secret 自验 Bearer；
  - claims 恒为 `{payload:{url}, iat, exp}`、`exp − iat = 300s`、逐请求现签 → 短 TTL 由 DocServer 自带；
  - `payload.url` 与 DocServer 实际请求 URL（scheme+host+port+path+query）**逐字相等** → token 可绑定到具体资源，不能换目标重放。
- 关键推论：**Bearer 由 DocServer 逐请求现签、只走服务间链路，浏览器拿不到**；浏览器 token 只暴露 `document.url`（定稿后 = 端点地址，无凭证）。

## 3. 方案设计（受控下载端点 → 落地形态「预览内容端点」）

### 3.1 链路对比

| 环节 | 现状（PoC） | 定稿（生产） |
|---|---|---|
| 查看器 `document.url` | MinIO 预签名（900s，含存储凭证） | 本仓受控端点绝对 URL（无凭证） |
| 浏览器 token 暴露面 | 可直接下载原文件 | 仅端点地址；调用缺 Bearer → 401 |
| DocServer → 取文档 | 直连 MinIO | 直连本仓 API（outbox `Bearer JWT`） |
| API → 存储 | — | 服务端 S3 SDK 流式读取（`getObject`，不预签名） |
| outbox 配置 | 被迫 false（与预签名互斥） | **常开 true**（鉴权依赖） |
| 用户下载链 | `download-url`（预签名 + `file.download` + download 审计） | **不变**（D4 / 既有契约） |

### 3.2 端点契约草案（待 wmj 审定；S1 契约切片输入）

- 路由草案：`GET /api/v1/files/{id}/versions/{versionId}/preview-content`。命名待 wmj 定（备选 `preview-source`）；语义 = 「交给在线查看器拉取的原文件字节流」，**不是用户下载口**；`versionId` 必填（签发查看器配置时已解析版本，不提供「当前版本」缺省）。
- 鉴权（服务间，非用户会话）：必需 `Authorization: Bearer <JWT>`，三条校验：
  1. **签名**：HS256 + 共享 `ONLYOFFICE_JWT_SECRET`（与 DocServer `JWT_SECRET` 同值，随部署注入）；
  2. **绑定**：`payload.url` == 本请求规范化绝对 URL——实现口径：以服务端配置的「DocServer 视角基址」+ 本请求 path/query 构造，**不信任 Host 头**；不匹配 401；
  3. **时效**：`exp` 未过期（DocServer 现签 TTL 300s；端点留小量时钟漂移容差）。
  任一不过 → 401，统一文案不区分原因；无重定向、无回退。
- 响应：200 + 字节流；`Content-Type` 取版本 `mime`；`Content-Length`；`Content-Disposition: inline`；`Cache-Control: no-store`；`X-Content-Type-Options: nosniff`。
- **禁止 302 到存储预签名**：重定向会让 Bearer 跟随到 MinIO（复现双认证 400），且让预签名回流预览链——违反 R1 定稿不变量。
- 错误：401（缺 token / 签名错 / 过期 / URL 不匹配）；404（文件 / 版本不存在、已回收、或状态不可读——与读面同形，不泄露存在性）；502 / 503（存储 / 依赖故障）；限流与 401 计数由 S3 定（需可观测）。
- 无状态：逐请求校验、不建 nonce 表（DocServer 会重复拉取；不支持「一拉取一次密」）。
- 实现注意：当前抓包仅见 GET（无 Range / HEAD）；S3 以实测抓包断言为准，若出现 HEAD / Range 再补全。

### 3.3 权限 / 审计边界

- 预览资格：仍在**签发查看器配置时**按既有口径判定（项目可见即可，M4-05 定案；不可见 404 防 IDOR），审计 `action=preview` 写在该时点。
- 端点拉取：服务间行为，不落用户审计表；写诊断日志（成功 / 失败计数、fileId / versionId、耗时）；401 率作配置漂移告警（见 §3.4）。
- 下载：`GET /files/{id}/versions/{versionId}/download-url` 链**不动**——`file.download` 权限 + 原对象 + attachment + 原文件名 + `action=download` 审计（A4-10）；预览与下载两条链继续分离。
- `permissions.download=false` / `mode=view` 保留为 UI / 行为面；安全语义转移到端点凭证（本文不变量）。

### 3.4 网络与部署（部署清单待并入段落 → S2 / px）

- API 端点须从 DocServer 容器可达（内网地址）；`externalRequest.action.blockPrivateIP=false` 仍为前置（F1 / R3，同一升级回归项）。
- 端点路由**不进外网入口**（网关规则：仅 DocServer 网段可达 / 公网 404）：纵深防御——内网 Bearer 即便被旁路，外网不可重放。
- `token.enable.request.outbox=true` 固定为期望态（本方案鉴权依赖）；反向漂移（false）→ 端点 401 **fail-closed**（预览报错而非降级泄漏）。
- 巡检：`/preview-content` 401 计数、DocServer 拉取失败日志；升级 / 重建回归项：① outbox=true；② blockPrivateIP=false；③ 401 基线。
- 一期验收断言（S5 复测纳入）：查看器配置 token 中 `document.url` **不含 `X-Amz-`** 等预签名参数；拉取链抓包无任何存储预签名 URL。

### 3.5 失败模式（fail-closed 矩阵）

| 故障 | 表现 | 安全姿态 |
|---|---|---|
| outbox 漂移为 false | 端点 401，查看器打不开 | 安全（无预签名可退） |
| JWT 密钥不一致 | 同上 | 安全 |
| API 不可达 | 查看器报错 → 降级「请下载」（S4 / R5 承接） | 安全 |
| 存储故障 | 502 / 503 | 安全 |

### 3.6 残余风险与书面接受

- **内网 Bearer + URL 在 300s 内可重放**：缓解 = 仅内网、短 TTL、URL 逐字绑定、端点不进外网、401 可观测；不以「一次一密」消除（DocServer 会重复拉取，工程不可行）。接受人：lan；请 wmj 在定稿评审中复核。
- 浏览器 token 仍暴露端点 URL（非凭证）：不构成取文件能力；登记以防误判为漏洞。
- 密钥管理：`ONLYOFFICE_JWT_SECRET` 按 CONTRIBUTING §12 走受控来源（缺失 / 空值 fail closed），不入库、不进日志。

## 4. 证据清单

| # | 证据 | 位置 | 结果 |
|---|---|---|---|
| E1 | outbox Bearer 抓包（3 请求 + MinIO 400 对照） | 仓外 `D:\poc10-onlyoffice\logs\poc10-capture-outbox-jwt.log` | DocServer 逐请求现签 Bearer 并附加 |
| E2 | 离线 JWT 校验（临时脚本未入库；密钥不入库） | 本文件 §2 记录 | 3/3：签名通过 / `payload.url` 逐字绑定 / TTL 300s |
| E3 | 首关 B 组：篡改 8/8 拒绝 + b6 服务端权限拒绝 | `docs/PoC-10-回放证据(ONLYOFFICE查看器·首关).md` | DocServer 侧 token 校验链有效 |
| E4 | F2 双认证冲突（与 E1 同源） | 同上 + E1 | 预签名与 outbox 互斥（R2 依据） |

## 5. ADR-030 待并入段落（N3 / wmj 承接）

- **N2 安全不变量**：在线查看器拉取链**无对象存储预签名**；`document.url` 一律指向本仓受控端点；端点鉴权 = DocServer outbox `Bearer JWT`（共享密钥 / `payload.url` 逐字绑定 / ≤300s）；用户下载链独立不动（预签名 + `file.download` + download 审计）。
- **R1 定稿**：受控下载端点（a）；b 不再采用。**R2 定稿**：禁止预签名与 outbox 同开；受控端点取代预签名后 outbox 常开为期望态；实现随 S3。
- **依据**：首关 F2 / R1 / R2 / R3 + 本文件 §4 证据。
- **影响**：ADR-007 → Superseded；部署基线增「outbox 常开 + 端点不进外网 + 401 告警 + 升级回归三项」；S5 验收断言（§3.4 末）。

## 6. 实施归位（S1 / S3 / S5）

| 切片 | 内容 | 入口 |
|---|---|---|
| S1（wmj） | 契约：新增受控端点路由；`FilePreviewResponse` 增查看配置 / JWT（`document.url` = 端点） | §3.2 草案（待审定） |
| S3（lan） | 端点实现（流式、自验 Bearer、fail-closed）+ 配置签发改造；单测 + 回放证据 | §3.2 / §3.3 |
| S5（lan + px） | 回归 / 双轨复测纳入验收断言（token 无预签名参数、抓包无预签名） | §3.4 末 |

S3 回放证据最小用例集：① outbox=true 正常拉取 200（字节与对象全等）；② 无 / 篡改 / 过期 / URL 错配 → 401；③ 无重定向（302 不存在）；④ 配置 token 无 `X-Amz-`；⑤ 401 计数可观测；⑥ 下载链回归（download-url 权限 / 审计不变）。

## 7. 变更记录

| 版本 | 日期 | 变更 | 人 |
|---|---|---|---|
| v1.0 | 2026-09-30 | 首版：R1 定稿 a（受控下载端点）/ R2 定稿；离线 JWT 验证 3/3；ADR-030 与部署清单待并入段落；S1/S3/S5 归位 | lan |
