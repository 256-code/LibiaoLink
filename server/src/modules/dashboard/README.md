# dashboard 模块（占位）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 统计与下钻（基础仪表盘） |
| 主责 | lan（团队分工.md §2） |
| 预留对外接口 | DashboardService |

- 状态：g4 骨架占位（仅本说明，无代码）。
- 落地约定：四层结构 controller / service / repository / events + index.ts 唯一公开出口；跨模块只允许 import 对端 index.ts（npm run check:boundaries），详见 server/README.md。
