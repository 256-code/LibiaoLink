# M6 回放证据（CI 真机执行 · 日报与问题）

> 卡片：M6-01 ~ M6-03「日报填报 / 提交 / 补填 + 回写任务进展 + 问题自动生成 + 问题闭环与留痕」（主责 wmj / 评审 lan）｜口径来源：`系统功能书.md` A3-01 ~ A3-13 与 A2-01、`技术设计v0.3-实施与验收.md` §3.7。
> 本文件是 CI 运行日志的逐行转写：仅剥离每行时间戳前缀，并加本说明与元信息表；正文数字与文字未做改动。本地复跑由脚本 `--out` 直接生成（文件名不带 (CI)）。

## 元信息

| 项 | 值 |
|---|---|
| 执行环境 | GitHub Actions `ubuntu-24.04` · job `database`（check run 106689028217） |
| 代码版本 | `fd213ac`（PR #126 头提交；squash 合并提交 `658ad14`） |
| 执行时间 | 2026-09-22 09:25:39Z ~ 09:26:34Z（北京时间 17:25 ~ 17:26） |
| 数据库 | `postgres:18` service 5432，空库迁移 0001 ~ 0023 之后执行 |
| 目标 api | `http://127.0.0.1:3011`（真实 NestJS 进程 + 真 PG，非 mock） |
| 脚本 | `server/scripts/m3-06-stress.mjs` / `server/scripts/m6-replay.mjs` |

## 结论（整理自下方原文）

- 28 项断言全过：P1 ~ P5（环境自检）、R1 ~ R7（日报填报 / 列表 / 详情）、I1 ~ I2（问题自动生成与幂等）、T1 ~ T2（回写任务进展与幂等）、E1 ~ E8（问题四态 / 留痕 / 乐观锁）、G1 ~ G4（删除引用守卫与归档写保护）。
- 回放暴露的真实缺陷（本 PR 内修复）：G1 首次执行返回 500 —— 删除任务的「日报引用计数」SQL 绑定的是标量而非 uuid 数组，PG 报 malformed array literal；改为 `array[` 形式绑定后，409 与 report_ref / issue_ref 明细如期返回。

## 运行日志原文

# M6 回放证据（S6·report-issue：日报 / 问题）

> 卡片：M6-01 ~ M6-03「日报填报 / 提交 / 补填 + 回写任务进展 + 问题自动生成 + 问题闭环与留痕」（主责 wmj，评审 lan）｜口径来源：系统功能书 A3-01 ~ A3-13、A2-01（删除引用守卫）；技术设计v0.3-实施与验收.md §3.7。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-22 17:26:33 +08:00 |
| 目标 | http://127.0.0.1:3011 |
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:5432/libiaolink |
| 代码版本 | f88037d |
| 脚本 | server/scripts/m6-replay.mjs |
| 回放项目 | M6RPL-（含 2 个任务 / 3 条日报 / 1 条问题，跑完硬删） |

## 断言明细

| PASS | P1 | api 可用（/healthz） | 期望：200 | 实际：200 | 先起 api 再跑本脚本 |
| PASS | P2 | 管理员账号可用（roles.code = admin；空库自动建合成管理员） | 期望：非空 userId | 实际："bed404c3-ebde-4ff6-9bf4-712314f86d10" |
| PASS | P3 | 临时会话可用（GET /api/v1/projects） | 期望：200 | 实际：200 0 |
| PASS | P4 | 建回放项目（M6RPL-） | 期望：201 | 实际：201 {"id":"85eea92f-bc43-4db9-befc-cf47a70ac837","code":"M6RPL-20260922092633"} |
| PASS | P5 | 建 2 个任务（回写靶子 + 无引用对照） | 期望：201 x 2 | 实际：{"a":"d642757f-72cb-416e-801b-47edda49d29d","b":"cd6f5bcc-1686-4526-a429-1aa32d514cbc"} |
| PASS | R1 | 新报今天（state=submitted + 关联任务标题同下标 + 系统字段） | 期望：201 / submitted / authorId / taskTitles[0]=任务A | 实际：201 / submitted / {"taskIds":["d642757f-72cb-416e-801b-47edda49d29d"],"taskTitles":["M6RPL-装配工装（日报回写）"]} |
| PASS | R2 | 一人一项目一天一条：重复填报 409 REPORT_ALREADY_EXISTS | 期望：409 REPORT_ALREADY_EXISTS | 实际：409 REPORT_ALREADY_EXISTS |
| PASS | R3 | 未来日期 400 VALIDATION_FAILED | 期望：400 VALIDATION_FAILED | 实际：400 VALIDATION_FAILED |
| PASS | R4 | 补填昨天（state=supplement） | 期望：201 supplement | 实际：201 supplement |
| PASS | R5 | 草稿创建 + 提交（过去日期提交 = 补填 supplement） | 期望：201 draft -> 200 supplement | 实际：201 draft -> 200 supplement |
| PASS | R6 | 日报列表：3 条 + 日期倒序 | 期望：200 / total=3 / 首行 2026-09-22 | 实际：200 / total=3 / 2026-09-22,2026-09-21,2026-09-20 |
| PASS | R7 | 日报详情（A3-01 全字段回读） | 期望：200 + doneWork / issueCategory / suggestion 一致 | 实际：200 {"doneWork":"装配工装 A 段就位并点检","category":"机械部","suggestion":"复测后调整定位销"} |
| PASS | I1 | A3-09：提交自动生成问题（原文 / 归类 / 提出人 / 提出日期 / 任务挂接） | 期望：total=1 + 字段一致 | 实际：200 total=1 {"title":"现场发现：支架尺寸偏差 3mm","category":"机械部","state":"unassigned","dept":"机械部","task":"d642757f-72cb-416e-801b-47edda49d29d"} |
| PASS | T1 | A3-08：提交回写任务进展（【日报 <日期>】标记 + task_events 留痕） | 期望：note 含标记与当日完成工作 / note_change=1 | 实际：{"hasMarker":true,"hasWork":true,"events":1} |
| PASS | I2 | 幂等重放：重编辑已提交日报（重跑副作用）→ 问题仍 1 条、事件不重复 | 期望：issues total=1 / issue_events=1（仅 created） | 实际：issues total=1 / issue_events=1 |
| PASS | T2 | 幂等重放：note 标记只出现一次、note_change 仍 1 条 | 期望：marker x1 / note_change=1 | 实际：marker x1 / note_change=1 |
| PASS | E1 | 四态：unassigned -> open（写一条 state_change） | 期望：200 open / events=2 | 实际：200 open / events=2 |
| PASS | E2 | 四态：open -> in_progress | 期望：200 in_progress | 实际：200 in_progress |
| PASS | E3 | 四态：in_progress -> done（同写 closed_at / closed_by + solution 事件） | 期望：200 done / closedBy=admin / events=5 | 实际：200 done closedBy=bed404c3-ebde-4ff6-9bf4-712314f86d10 / events=5 |
| PASS | E4 | A3-10 允许回退：done -> in_progress（自动清空关闭对） | 期望：200 in_progress / closedAt=null / events=6 | 实际：200 in_progress closedAt=null |
| PASS | E5 | 空更新 400 VALIDATION_FAILED（防刷留痕） | 期望：400 VALIDATION_FAILED | 实际：400 VALIDATION_FAILED |
| PASS | E6 | 乐观锁：过期 version 409 VERSION_CONFLICT | 期望：409 VERSION_CONFLICT | 实际：409 VERSION_CONFLICT |
| PASS | E7 | 问题列表：状态筛选 + 关键字命中 | 期望：in_progress total=1 / 支架 total=1 | 实际：state total=1 / q total=1 |
| PASS | E8 | A3-13 留痕：分派（assignment）与四类事件齐备（created / state_change / solution / assignment） | 期望：ownerId=admin + events=7 + 四类齐备 | 实际：{"owner":"bed404c3-ebde-4ff6-9bf4-712314f86d10","count":7,"types":["created","state_change","state_change","solution","state_change","state_change","assignment"]} |
| PASS | G1 | A2-01：被日报 / 问题引用的任务 DELETE 409（details 带 report_ref / issue_ref） | 期望：409 TASK_HAS_REFERENCES + 两类引用 | 实际：409 TASK_HAS_REFERENCES ["report_ref","issue_ref"] |
| PASS | G2 | 无引用任务可删（200）+ 重复删除 404 | 期望：200 / 404 | 实际：200 / 404 |
| PASS | G3 | 记录级 404：不存在 / 跨项目 id 的日报与问题详情 | 期望：404 / 404 | 实际：404 / 404 |
| PASS | G4 | 归档项目写保护：日报填报 / 问题处理 / 任务删除均 409 PROJECT_ARCHIVED | 期望：409 x 3 | 实际：409 / 409 / 409 |
| WARN | 收尾未完全成功：update or delete on table "users" violates foreign key constraint "audit_logs_actor_id_fkey" on table "audit_logs" |

## 汇总

- 全部断言通过（28 项）：日报填报（A3-01 ~ A3-04）+ 提交副作用幂等（A3-08 / A3-09）+ 归类分派（A3-12）+ 四态与留痕（A3-10 / A3-13）+ 引用守卫（A2-01）+ 归档写保护。

## 验收对照（M6-01 ~ M6-03）

- A3-01 ~ A3-04（日报）= R1 ~ R7：新报（submitted）/ 重复填报 409 REPORT_ALREADY_EXISTS / 未来日期 400 / 补填（supplement）/ 草稿创建 + 提交 / 列表日期倒序 / 详情回读。
- A3-08（回写任务进展）= T1 / T2：tasks.note 追加「【日报 <日期>】<当日完成工作>」+ task_events(note_change)；重编辑已提交日报不重复追加（同任务同日期一次）。
- A3-09（问题自动生成）= I1 / I2：source_report_id 唯一兜底幂等；原文 / 归类 / 提出人 / 提出日期 / 单任务挂接。
- A3-12（归类分派）= I1：部门名归类（机械部 / 采购部 / 规划部 / 项目部）落 owner_department；原因类不自动落部门（null = 待分派）。
- A3-10 / A3-13（四态与留痕）= E1 ~ E8：允许回退且每次实际变化写一条 issue_events（created / state_change / solution / assignment）；关闭写 closed_at / closed_by、回退自动清空；空更新 400、乐观锁 409。
- A2-01（删除引用守卫）= G1 / G2：被日报 / 问题引用的任务 409（details[].code = report_ref / issue_ref）；无引用任务可删、重复删除 404。
- 归档写保护（ADR-027）= G4：归档项目上日报填报 / 问题处理 / 任务删除均 409 PROJECT_ARCHIVED。
- 单测回归（不连库）：server/test/report-issue.test.ts 27 例随 npm test 常跑（日报 18 + 问题 9）；删除引用守卫 server/test/task-remove.test.ts 12 例。
- 复跑：cd server && M6_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink node scripts/m6-replay.mjs --out ../docs/m6-回放证据(日报与问题).md


