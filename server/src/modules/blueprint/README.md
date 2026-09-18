# blueprint 模块（占位）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 蓝图（全局一份、版本化）、校验、导入 |
| 主责 | wmj（团队分工.md §2） |
| 预留对外接口 | BlueprintService、ImportService |

- 状态：g4 骨架占位（仅本说明，无代码）。
- 落地约定：四层结构 controller / service / repository / events + index.ts 唯一公开出口；跨模块只允许 import 对端 index.ts（npm run check:boundaries），详见 server/README.md。
