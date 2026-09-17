# LibiaoLink 仓库约定

## 文档同步（每次改动必须遵守）

- 前端（`frontend/`）每次改动（页面 / 交互 / 数据模型 / 接口需求）必须同步更新 `docs/前端功能需求.md`，并与改动同一次推送提交；不允许代码先推、文档滞后。
- 每次推送后在 `docs/开发日志.md` 顶部追加一条记录：`日期 时间 | 作者 | 分支 | Push 序号`；作者 = 当次推送人（团队：`px`、`wmj`、`lan`）。
- 字段口径变化时，同步更新 `docs/字段对照清单.md`。
- 推送前在 `frontend/` 下跑通 `npm run typecheck` 与 `npm run build`（纯文档改动除外）。

## 完整规则

- 仓库协作与开发规则见根目录 `CONTRIBUTING.md`（《通用开发规则》第 11–17 节落地版）；与本文件冲突时，以更严格者为准。
- 代理（AI）在本仓库工作时，必须同时遵守 `CONTRIBUTING.md` 第 12 节（Secrets 与安全）与第 17 节（Definition of Done）。
