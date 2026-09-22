# report-issue 模块（日报与问题）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 日报填报与闭环（M6-01 / M6-02）、问题四态与处理留痕（M6-02 / M6-03） |
| 主责 | wmj（团队分工.md §2） |
| 对外出口 | `ReportService`、`IssueService`（跨模块只允许 import 本目录 `index.ts`） |
| 依赖 | identity（会话/用户）、permission（项目上下文与权限位）、admin（审计）；**不依赖其它业务模块** |
| 契约 | `shared/src/modules/reports.ts` / `issues.ts`；表口径 `database/migrations/0023_daily_reports_issues.sql` |

## 结构

```text
report-issue/
├── report-issue.controller.ts  ReportController（:id/reports 四端点）+ IssueController（:id/issues 三端点）
├── report.service.ts           日报用例：填报 / 编辑 / 提交 / 补填 + A3-08 回写 + A3-09 问题生成
├── report.repository.ts        日报数据访问（列表 / 唯一键判重 / 乐观锁）+ 任务进展回写（A3-08）
├── issue.service.ts            问题用例：四态流转 / 解决方案 / 分派 / 时限 + 留痕
├── issue.repository.ts         问题数据访问（列表 / 详情 / 乐观锁 + issue_events）
├── report-issue.rules.ts       纯规则（状态推导 / 归类→部门 / 筛选解析 / 幂等标记）
├── report-issue.module.ts      NestJS 模块装配
└── index.ts                    唯一公开出口
```

## 接口（路径为项目嵌套 —— 契约提案 A21 的扁平路径在守卫下拿不到项目上下文，差异已登记）

| 方法 | 路径 | 权限位 | 说明 |
|---|---|---|---|
| GET | `/api/v1/projects/{id}/reports` | `report.view` | 列表（日期区间 / 状态 / 提交人 + 分页，日期倒序） |
| POST | `/api/v1/projects/{id}/reports` | `report.fill` | 新报一天（草稿 / 提交）；重复 409 `REPORT_ALREADY_EXISTS` |
| GET | `/api/v1/projects/{id}/reports/{reportId}` | `report.view` | 详情（A3-01 全字段 + 关联任务标题） |
| PATCH | `/api/v1/projects/{id}/reports/{reportId}` | `report.fill` | 编辑 / 提交（乐观锁；`date` 不可改；已提交不允许退回草稿） |
| GET | `/api/v1/projects/{id}/issues` | `issue.view` | 列表（状态 / 归类 / 任务 / 来源日报 + 关键字 + 分页） |
| GET | `/api/v1/projects/{id}/issues/{issueId}` | `issue.view` | 详情（问题 + 处理过程留痕，时间正序） |
| PATCH | `/api/v1/projects/{id}/issues/{issueId}` | `issue.manage` | 状态流转 / 解决方案 / 分派 / 时限；每次写一条事件 |

## 口径（差异登记一并列出）

- **一人一项目一天一条**（`uq_daily_reports_author_date`）：草稿 / 提交 / 补填**共用同一行**；重复填报 409 `REPORT_ALREADY_EXISTS`（提示改用编辑）。一期不做日报版本历史 —— 「补填保留原始提交记录」以状态 `supplement` + `submittedAt` 表达（差异登记）。
- **补填由服务端推导**：`state` 只接受 `draft` / `submitted`；提交过去日期 → `supplement`，提交当天 → `submitted`；未来日期 400（A3-04）。已提交 / 补填行不允许退回草稿。
- **A3-09 问题生成幂等**：提交且 `foundIssue` 非空 → 生成一条 `state=unassigned` 的问题（`source_report_id` 唯一约束兜底；冲突即已生成过，返回空、不重复写事件与审计）；标题超 500 字截短（原文仍在日报行）。
- **A3-12 自动分派（一期口径）**：归类为「机械部 / 采购部 / 规划部 / 项目部」时自动落 `owner_department`；其余归类（原因类）不自动分派 → 归「未分组」兜底（映射在 C9 可维护属二期，差异登记）。
- **A3-08 回写任务进展**：提交后把「当日完成工作」追加到关联任务的「项目进展描述」（`tasks.note`）+ 写 `task_events`（`note_change`）留痕，**幂等标记 = `【日报 <日期>】`**（同一任务同一天只追加一次）；跨域写在 `report.repository.appendTaskProgress` 单点收口，与变更记录 R01 同口径 —— **只动 `note`、不动任务乐观锁版本**。
- **问题四态允许回退**（A3-10）：不设流转白名单，只要求每次变更写一条 `issue_events`（`state_change` / `solution` / `assignment`）；`done → 其它态` 一并清 `closed_at` / `closed_by`（`ck_issues_closed_pairs`）；关闭 = `state=done` 且写 `closed_at` / `closed_by`，审计 `action=complete`。
- **空更新 400**：问题更新必须至少一个实际变化（防刷留痕）；日报编辑同理走契约校验（`doneWork` 等最小长度）。
- **归档项目 409 `PROJECT_ARCHIVED`**（ADR-027）；不可见 / 跨项目 / 不存在统一 404（记录级，h6）。
- **留痕**：审计对象 `daily_report` / `issue`（字段级 changes + metadata）+ outbox `report.submitted` / `issue.created` / `issue.updated`（dedupeKey 带版本或 id）。

## 测试与门禁

- `server/test/report-issue.test.ts`：**27 例**（日报 18 + 问题 9）—— 日报：创建 / 提交当天 / 草稿 / 重复 409 `REPORT_ALREADY_EXISTS` / 补填推导 / 未来日期 400 / 任务归属 400 / 问题生成与自动分派 / 原因类不分派 / A3-09 幂等 / A3-08 回写与幂等 / 草稿 → 提交 / 已提交不可退回 / 编辑后缺归类 400 / 乐观锁 409 / 归档 409 / 跨项目与不存在 404 / 列表筛选；问题：状态流转事件 / 回退清关闭字段 / 分派与时限 / 空更新 400 / 乐观锁 409 / 归档 409 / 404 / 详情留痕正序 / 列表同源。另 `server/test/task-remove.test.ts` 12 例覆盖删除引用守卫（`report_ref` / `issue_ref`）。
- 随 `npm test` 常跑；`check:boundaries` 覆盖跨模块 import（本模块只进口对端 `index.ts`）。
- 真机回放（真 PG + 真 api）随 M3-06 压测 / 联调卡。
