# workspace 模块（M6-05 第一刀 · 工作台聚合读面 · A6-01 / A6-03 · Push 166）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain · 已登记 check-boundaries 的 DOMAIN_MODULES） |
| 职责 | 工作台聚合读面：我的任务三组（今日待办 / 即将到期 / 已逾期）+ 我的问题两栏（我处理 / 我提出的） |
| 主责 | wmj（团队分工 §2） |
| 对外接口 | `WorkspaceService`（`index.ts` 出口） |

## 本切片交付（第一刀 · Push 166）

- **契约**：`shared/src/modules/workspace.ts` —— `WorkspaceResponseSchema`（`myTasks` 三组 + `myIssues` 两栏）+ 任务项 / 问题项；`shared/src/openapi.ts` 新增 `GET /api/v1/workspace`（tags = workspace）；生成物重出 —— paths 75 → 76、operations 98 → 99、schemas 189 → 194。
- **读（无新表、无迁移）**：跨项目个人读面，无项目路径参数；仅会话（`SessionGuard`），不做功能权限位 —— 数据按记录级可见性过滤（`PermissionService.projectScope`，ADR-011）。
- **分组口径**（第一刀）：任务 = 负责人含我（A23 多值任一位命中）且未完成、未删除；基准日 = Asia/Shanghai 今天（ADR-028）：已逾期 / 今日待办 / 即将到期（今天 + 7 天内，建议值）；未排期（plannedEnd 空）与 7 天外不进工作台；归档项目（ADR-027 冻结）与软删项目不进。
- **排序**：任务组内 plannedEnd 升序 → id 升序；问题未关闭在前 —— 处理时限升序（无时限最后）→ raisedAt → id（已完成后置）。
- **只读边界**：本模块不改任何表（跨模块写路径仍归各领域模块）；负责人姓名聚合 SQL 与 task 模块同源（只读副本）。
- **差异登记**：①「我参与的任务」口径未定（A6-01 原文「我负责 / 我参与」，本刀只做我负责）；②「即将到期」窗口 7 天为建议值（随前端联调复评）；③「我的问题」含已完成（后置排序），如需「仅未关闭」随联调复评；④ A6-04 最新提醒 / A6-07 稍后提醒随消息中心（M5-07 · lan）、A6-02 待我审批一期不启用（C8）、A6-06 快捷入口为前端入口位（无服务端）。
- **测试**：`server/test/workspace.test.ts`（纯函数 + 服务替身）；真机回放见 `server/scripts/m6-replay.mjs` 证据六（CI database job 执行）。
- **评审请求**：「我参与的任务」口径与 7 天窗口请 px（前端联调）/ 业务复核；分组字段用 plannedEnd（预计完成日期）如与业务口径不符请点名。
