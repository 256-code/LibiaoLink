# automation 模块（M5-01 规则引擎内核 + M5-05 余项 · A 系列）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 规则模型 / 求值 / 回放与留痕（M5-01 内核 + M5-05 余项） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | `BUILTIN_RULES` / `BUILTIN_MESSAGE_TEMPLATES` / `findTemplate` / `BUILTIN_RULE_SUBJECT_KINDS` / `subjectKindOf` / `SUBJECT_TEMPLATE_VARIABLES` / `MERGED_TEMPLATE_SPECS` / `findMergedSpec`、`evaluateCondition` / `evaluateOperator` / `evaluateRule`、`renderTemplate`、`resolveScheduleFire` / `mondayOf` / `isoWeekKey` / `dedupeKey`、`REPLAY_SUBJECT_KINDS`、`replayRules` / `cronTime` / `toTaskSubject` |

## 本切片交付

### M5-01 内核（Push 161）

- 纯函数内核（不连库、不取系统时间）：条件求值（白名单操作符）、模板逐字渲染（缺变量显性抛错）、触发窗口求值（含节假日顺延）、幂等执行键。
- 内置规则 R02 ~ R07 定义 + 逐字文案模板（R01 无通知动作，落点 = 变更生效事务内回写，见 M4-04）。
- 回放器：给定规则集 + 任务数据集 + 业务日 + 日历 → 应发送清单（确定性排序、幂等去重、R07 同负责人合并）。
- 单测 31 例（`test/automation-rules.test.ts` 16 / `test/automation-replay.test.ts` 15）。

### M5-05 余项 · A 系列（Push 163）

- **主体模型**：回放不再限于任务 —— `ReplaySubject`（`kind` + `fields` + `recipients`）承载四类主体（A01 日报名册槽位 / A02 项目日报 / A03 问题 / A14 自定义待办）；任务经 `toTaskSubject` 映射（字段与条件口径不变，既有 31 例零改动全绿）。
- **规则 +4**：A01 日报应填未填（19:30 · 按人合并 · 站内信 + 企微）、A02 日报汇总群播报（19:00 · 群机器人）、A03 问题 SLA（09:00 · T+1 提醒责任人 / T+3 升级项目经理，规则集内两行同 `code`）、A14 自定义待办（提醒日 09:00）；逐字模板 +9 种（`BUILTIN_MESSAGE_TEMPLATES` 8 → 17）。
- **引擎扩项**：`RULE_SCHEDULE_WINDOWS` 增 `T_PLUS_3`、`RULE_RECIPIENTS` 增 `report.member`（契约随本片扩项；paths 74 / operations 95 / schemas 186 计数不变）；标题参与变量渲染；分组合并模板改按 `rule|channel` 查表；新增跳过原因 `subject_mismatch`；消息与明细带 `ruleName`（A03 两窗口可区分）。
- **文案与金标**：`docs/rules/A01-A03-A14-扩展规则文案.md`（建议稿 + 待确认清单 + 主体字段口径表）；`test/automation-a-series.test.ts` **22 例**（四条规则逐字 + 窗口互斥 + 合并 + 幂等 + 模板一致性）。
- **给接线层（M5-02 ~ M5-06 · lan）的口径**：唤醒层按实体快照组主体（字段表见上述 docs/rules 文档）→ 引擎算「应发给谁 / 发什么 / 幂等键」→ 投递层负责渠道、限速、失败降级与重试；模板变量映射见 `SUBJECT_TEMPLATE_VARIABLES`（`@recipient` = 本次解析出的收件人名称）。

## 边界与后续

- 依赖方向：automation → calendar（`index.ts`：T±N 求值 / 顺延 / 业务日时刻）。不反向依赖业务模块。
- 未落（lan 线）：规则管理端点与运行留痕（M5-06）、调度与补发（M5-02）、企微 / 站内信投递与重试（M5-03 / M5-04）、`automation_rules` 落库形态（A03 同 code 两窗口如何落行）。
- 未落（数据面）：`todos` 表与重复规则展开（A14 落库）、漏填名单「已提醒」标记（随 M5-06 发送记录）—— 均已在文案文档登记为差异。
- 合并文案：R07 / A01 的分组形态（同一收件人一条清单式消息）为先行口径（模板 `R07_APP_MERGED` / `A01_INBOX_MERGED` / `A01_WECOM_MERGED`），业务回执后按结论改文案与断言（待确认项见 `docs/rules` 两份文案文件文末清单）。
