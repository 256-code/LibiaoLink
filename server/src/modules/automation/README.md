# automation 模块（M5-01 规则引擎内核 · 第一刀）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 规则模型 / 求值 / 回放与留痕（M5-01） |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | `BUILTIN_RULES` / `BUILTIN_MESSAGE_TEMPLATES` / `findTemplate`、`evaluateCondition` / `evaluateOperator` / `evaluateRule`、`renderTemplate`、`resolveScheduleFire` / `mondayOf` / `isoWeekKey` / `dedupeKey`、`replayRules` / `cronTime` |

## 本切片交付（Push 161）

- 纯函数内核（不连库、不取系统时间）：条件求值（白名单操作符）、模板逐字渲染、触发窗口求值（含节假日顺延）、幂等执行键。
- 内置规则 R02 ~ R07 定义 + 逐字文案模板（R01 无通知动作，落点 = 变更生效事务内回写，见 M4-04）。
- 回放器：给定规则集 + 任务数据集 + 业务日 + 日历 → 应发送清单（确定性排序、幂等去重、R07 同负责人合并）。
- 单测 31 例（`test/automation-rules.test.ts` 16 / `test/automation-replay.test.ts` 15：金标逐字、窗口与顺延两态、幂等、合并、缺变量抛错）。

## 边界与后续

- 依赖方向：automation → calendar（`index.ts`：T-N 求值 / 顺延 / 业务日时刻）。不反向依赖业务模块。
- 未落：规则管理端点与运行留痕（M5-06，lan）、调度与补发（M5-02，lan）、企微 / 站内信投递与重试（M5-03 / M5-04，lan）、A01 / A02 / A03 / A14 文案（随 M5-05）。
- 合并文案：R07 同负责人多任务合并为一条（清单形式）的**文本形态**为先行口径（模板 `R07_APP_MERGED`，任务描述以「、」连接为一行）；已登记为 `docs/rules/R01-R07-内置规则文案.md` 待确认项 6，业务回执后按结论改文案与断言。