# shared/ 契约包（LibiaoLink API）

/api/v1 的契约唯一真相：**Zod schema → OpenAPI 3.1 → TypeScript 类型**，三段式自动生成。
本包是定档任务 g2（S5·契约包）的交付物；错误模型与约定对齐《技术设计v0.2-架构与数据模型.md》§7。

## 目录

```text
shared/
├── src/
│   ├── zod.ts                  zod 唯一扩展点（.openapi 元数据）
│   ├── common/
│   │   ├── errors.ts           错误码 + 统一错误信封（v0.2 §7.2）
│   │   ├── conventions.ts      Uuid / 时间 / 版本 / 幂等键 / 分页 / 排序
│   │   └── dicts.ts            阶段、成果文件、状态机等枚举（v0.2 §2.4 / §2.5）
│   ├── modules/
│   │   ├── projects.ts         项目主数据 + 首页分类 facets
│   │   ├── tasks.ts            任务 + 四格进度
│   │   └── flow.ts             蓝图 JSON + 流程节点 + 完成门禁
│   └── openapi.ts              /api/v1 路径注册与文档生成
├── scripts/
│   ├── lib.mjs                 渲染 OpenAPI 文档与客户端类型
│   ├── generate.mjs            写生成物（npm run generate）
│   └── check-drift.mjs         漂移校验（npm run check）
└── generated/                  生成物（提交进仓库，禁止手改 —— CONTRIBUTING §14）
    ├── openapi.json
    └── api-types.d.ts
```

## 命令

```bash
cd shared
npm install          # 首次或依赖变更后（锁文件 package-lock.json 必须同步提交）
npm run typecheck    # tsc 严格模式
npm run generate     # 生成 generated/openapi.json 与 generated/api-types.d.ts
npm run check        # 漂移校验：生成结果与仓库内生成物一致才算通过
```

生成链路：修改 src 下的 Zod schema → `npm run generate` → 提交生成物（源与生成物同一 PR）。
CI 已接入本检查（阶段 5 · CI 扩展任务）：PR / main 推送由 `.github/workflows/ci.yml` 的 `shared` job 自动执行 `npm run typecheck` + `npm run check`；本地推送前仍建议手动执行。

## 已定案口径（契约层）

| 主题 | 口径 |
|---|---|
| 前缀 / 编码 | `/api/v1`；JSON；请求与响应字段 camelCase（与 DDL snake_case 一一映射，如 owner_id ↔ ownerId） |
| 分页 | 表格型 `page` / `limit` + `total`；信息流型后续用 cursor |
| 筛选与排序 | `filter[region]=..`（多值逗号分隔）、`sort=field:asc,field2:desc`、`q` 关键字 |
| 乐观锁 | 更新必须回传 `version`；冲突返回 409（VERSION_CONFLICT） |
| 幂等 | 写操作支持 `Idempotency-Key` 头；重复提交返回首次结果 |
| 时间 | 时间戳 ISO8601（UTC 存储，前端按 Asia/Shanghai 展示）；业务日期 `YYYY-MM-DD` |
| 可见性 | 资源不存在与无权访问统一 404 语义（防 IDOR） |
| 错误模型 | 统一信封 `{ code, message, details[], traceId }`；错误码见 src/common/errors.ts（与 v0.2 §7.2 同步维护） |
| 项目编号 | 创建人填写（创建请求必填 code；格式仅前端提示、不做强校验）；唯一性由服务端校验 + 数据库唯一约束保证，重复返回 409 PROJECT_CODE_EXISTS；建后可修改（更新请求可传 code，同样校验唯一性） |
| 主题色 accent | 随项目类型字典（C9）元数据下发；前端不硬编码颜色 |
| 任务状态 | 存储基础态 pending/active/done；展示五态由服务端派生为 `displayStatus`（不写回） |
| 节点门禁 | 完成需过服务端事务内校验；缺件返回 422 + `missing` 明细（NODE_REQUIRED_DOC_MISSING） |
| 蓝图 | 自建 JSON（schemaVersion=1）；导出/导入 round-trip 无损；导入即快照 |

## 本批范围与后续切片

- 本批（g2 第一切片）：项目、任务、流程节点与蓝图（对应阶段 6 纵切的 h1~h4）。
- 后续切片（随对应模块落地补契约，仍在本包内）：文件与预览（file / preview，阶段 7）、
  通知（notify，阶段 8）、搜索与统计（search / dashboard，阶段 8）、迁移工具链（阶段 9）、
  自动化规则与日报/问题（automation / report，阶段 7）。

## 边界与注意事项

- 本包只定义契约与生成物，不含服务端实现与数据库迁移（分别在 server/ 与 database/ 落地）。
- 生成物禁止手改；改契约必须改 src 下的 Zod schema 并重新生成（CONTRIBUTING §14）。
- 消费方（server / frontend）引用方式待仓库结构定案（v0.1 Q15：frontend 原地演进 vs workspace）。
- 依赖说明：Node >= 24；zod 4.6；TypeScript 5.9（openapi-typescript 的 peer 要求 ^5.x）。
  前端当前为 TypeScript 7.0.2 —— 版本差异已登记在 ADR-017「待复核差异」，评审时一并定案。
