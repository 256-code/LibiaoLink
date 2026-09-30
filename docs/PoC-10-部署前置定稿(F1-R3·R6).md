# PoC-10 部署前置定稿（F1 / R3 · R6）——次关 N3

> 归属：lan（后端平台线）· 2026-09-30。唯一执行口径见 `docs/ONLYOFFICE替换执行计划(Office预览).md`（本文件为其 N3 的部署部分产出）。
> 用途：供 S2（`deploy/onlyoffice/` 部署清单 / 回滚步骤 / 升级回归项）与 S5（复测断言）**待并入段落**；并入后本条仍在，作为定稿记录。
> 依据：`docs/PoC-10-回放证据(ONLYOFFICE查看器·首关).md`（F1 / F3 / C2 / b7 / R3 / R6）；`docs/PoC-10-安全定稿(R1-R2·受控下载端点).md`（N2：outbox 期望态）。

## 1. F1 / R3：`blockPrivateIP` 运行时配置

### 1.1 事实（首关实测）

- 9.4 起 `externalRequest.action.blockPrivateIP` 默认 `true`：DocServer 直接拒绝内网拉取（onError -4 / 400）。
- env `ALLOW_PRIVATE_IP_ADDRESS` **覆盖不到该键**；`directIfIn.allowList` 实测不能替代放行。
- 就地改容器 `local.json` 后拉取恢复 200（C2a：DocServer 容器内可拉内网地址 200；C2b 反例环回 000）。
- F3：容器 entrypoint **每次启动**按 `JWT_ENABLED` 重写 `token.enable.request.*`（outbox 会回 true）→ 对 `local.json` 的修改必须在**容器启动之后**做，并只重启 docservice 进程（`supervisorctl restart ds:docservice`）；重启容器 / 重建 / 升级会覆盖 → 列为**升级回归项**。

### 1.2 定稿（待并入部署清单）

- 需固化键（沙箱实测组合）：
  - `services.CoAuthoring.externalRequest.action.blockPrivateIP = false`（决定键 —— F1）；
  - `services.CoAuthoring.request-filtering-agent.allowPrivateIPAddress = true`（同批固化；必要性由 S2 复核后定，若冗余则去掉并在清单注记）。
- **落地方式（S2 定案）**：优先「镜像构建期模板 / 挂载配置文件 + 启动后自检」，**不得依赖每次手工改容器**（首关沙箱做法仅作证据）；无论哪种方式，必须包含启动后自检：`blockPrivateIP` 读到 false，否则显式告警 / 不健康。
- `token.enable.request.outbox = true` 为**期望态**（N2 鉴权依赖）；首关复现要点中「outbox 保持 false」为沙箱当时口径，**生产不再沿用**；反向漂移（false）→ 受控端点 401 fail-closed（N2 §3.5）。
- 中文字体（C 组）：生产镜像固化 Noto Sans CJK SC + `documentserver-generate-allfonts.sh`（构建期或首启执行，S2 定案），列为升级回归项。

### 1.3 升级 / 重建回归清单（每次升级或重建后必查）

| # | 检查 | 方法（行为级） | 通过判据 |
|---|---|---|---|
| ① | blockPrivateIP=false 生效 | DocServer 容器内对内网地址拉取探针 | 200（复跑 C2a） |
| ② | outbox=true | 容器 `local.json` 读值 + 一次查看器拉取 | true 且拉取带 Bearer 成功 |
| ③ | 中文字体 | `fc-list :lang=zh` + generate-allfonts 完成 | 字体在位、无乱码（N1 样本冷开） |
| ④ | 受控端点 401 基线 | 无 token / 篡改 token 探针打 `/preview-content` | 401（N2 §7 条件 C4） |
| ⑤ | 示例 app 关闭 | 见 §2 断言 | 不出现示例页面 / 文档会话 |

> 回归留痕：结果记部署日志（升级记录）；异常即回滚上次可用镜像（S2 回滚步骤）。

## 2. R6：示例 app（`ds:example`）

- 事实（b7）：**默认关闭**（直连 `/example/` → 502「Test example is not running」）；手动启动后自身 500（`siteUrl` 指向 `documentserver` 主机名不可解析），**不产生任何文档会话**。
- 定稿要求（待并入部署清单 + 验收断言）：
  - 保持**默认关闭**：不得为排障等目的在生产打开示例服务；
  - 网关（Nginx）**不暴露 `/example/`**：用户侧 / 公网路径不可达；
  - 验收断言（S5 复测纳入）：从网关侧 `GET /example/` → 非 200 且不出现示例页面；直连容器侧 502（关闭态）为合规。
- 升级回归：并入 §1.3 第 ⑤ 项。

## 3. 并入路径

- **S2**：部署清单（配置键 + 落地方式）、升级回归项（§1.3 五项）、回滚步骤关联（字体 / local.json 覆盖项）；R6 断言入部署验收。
- **S5**：复测纳入 §1.3 与 §2 断言（含 R4 并发复测）。
- **N2 衔接**：`/preview-content` 401 基线（§1.3 ④）与 N2 §7 条件 D1~D4 一致。

## 4. 变更记录

| 版本 | 日期 | 变更 | 人 |
|---|---|---|---|
| v1.0 | 2026-09-30 | 首版：F1/R3 配置路径与升级回归清单（五项）；R6 定稿与验收断言；并入路径（S2 / S5） | lan |
