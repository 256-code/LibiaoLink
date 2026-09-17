# LibiaoLink 仓库约定

## 文档同步（每次改动必须遵守）

- 前端（`frontend/`）每次改动（页面 / 交互 / 数据模型 / 接口需求）必须同步更新 `前端功能需求.md`，并与改动同一次推送提交；不允许代码先推、文档滞后。
- 每次推送后在 `开发日志.md` 顶部追加一条记录：`日期 时间 | 作者 | 分支 | Push 序号`；作者 = 当次推送人（团队：`px`、`wmj`、`lan`）。
- 字段口径变化时，同步更新 `字段对照清单.md`。
- 推送前在 `frontend/` 下跑通 `npm run typecheck` 与 `npm run build`（纯文档改动除外）。

## 分支与推送

- 先推自己的常驻分支（`px` / `wmj` / `lan`），再经 PR 合入 `main`；禁止直接推送 `main`。
- 合并方式 squash-only；合并后常驻分支保留、不删除（规则集 `resident-branches-no-deletion`）。

## 分工与路由（谁负责哪块）

- 团队：`px`（前端 + 运维，交付负责人）、`wmj`（后端 A：领域负责人，兼技术负责人）、`lan`（后端 B：平台负责人）；完整口径见根目录 `团队分工.md`。

| 范围 | 主责 | 评审 / 协办 |
|---|---|---|
| `frontend/`、`assets/`、`deploy/`、`.github/`、`docs/` | px | wmj、lan |
| `前端功能需求.md`、`字段对照清单.md`、`README.md`、`开发日志.md`、`团队分工.md` | px | wmj |
| 后端领域：identity/org、project、blueprint/node、task、report/issue、stakeholder、automation、admin（字典 / 审计） | wmj | lan |
| 后端平台：file、preview、notify、outbox 队列调度、search、dashboard、迁移工具链 | lan | wmj |
| API 契约（Zod / OpenAPI / 生成客户端）、ADR、`技术设计*.md` | wmj | lan、px |
| `系统功能书.md`（定档口径，与源文档双处同步） | 变更提出人 | wmj（技术可行性）、px（实现一致性） |

- 代理（AI）动手前先按上表判断归属，改动只落在本线目录内；跨线改动（契约、字段口径、部署、权限）先对齐归属人再开工。
- 分支：改动推给归属人的常驻分支（`px` / `wmj` / `lan`）再走 PR；不代他人创建或推送常驻分支（CONTRIBUTING.md 第 5 节）。
- 后端目录（`server/`、`database/`、`shared/`）尚未落地；落地前涉及后端的改动先落文档与契约（`技术设计v0.2-架构与数据模型.md`、`前端功能需求.md`）。
- 高风险变更（CONTRIBUTING.md 第 15 节）必须取得另一名合格评审者批准；评审路由见 `.github/CODEOWNERS`。

## 完整规则

- 仓库协作与开发规则见根目录 `CONTRIBUTING.md`（《通用开发规则》第 5、11–17 节落地版）；与本文件冲突时，以更严格者为准。
- 代理（AI）在本仓库工作时，必须同时遵守 `CONTRIBUTING.md` 第 12 节（Secrets 与安全）与第 17 节（Definition of Done）。
