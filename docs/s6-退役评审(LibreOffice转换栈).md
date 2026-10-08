# S6 退役评审 · LibreOffice 转换栈（deploy/preview）

- 日期：2026-10-08｜执行：lan（代 px 线 · **请 px 复核**）｜计划：`docs/ONLYOFFICE替换执行计划(Office预览).md` §4 S6（前置 = S6-前置 ✅（Push 201）；业务确认 = px 侧五类预览验证，2026-10-08）。
- 对象：`deploy/preview/`（LibreOffice 转换沙箱：converter + edge 转发 + 中文字体自检）。

## 一、消费者归零核查

| # | 核查 | 结论 |
|---|---|---|
| 1 | 转换投递面 | `previewTargetsFor` 常量空表（S6-前置 起）→ `preview.job` 无生产者；定档预生成循环自然空转（单测覆盖） |
| 2 | 图片 | 原对象短时签名直签（`serveImageDirect`）—— 不经转换器（停机态回放 14/14 + 前端 11/11） |
| 3 | Office / 文本族 / PDF | ONLYOFFICE 查看器通道（`viewerChannelFor`）—— S4 回放 21/21 + S5 回归（含 R4 50 并发）+ px 验证 |
| 4 | 下载链 | 独立直签（`download-url`）—— 与转换器无关 |
| 5 | 代码残余 | `preview.converter.ts` / `preview.service.ts` 等为 dormant 路径（被空投递面阻隔）；CI 不构建 / 不启动本栈 |
| 6 | 环境 | 栈已停 + 容器与网络移除（`docker compose down`）；镜像保留 |

## 二、风险评估与回滚

- 功能回退风险：**低** —— 五类预览均已由新链路承接并验证；失败降级「请下载」保留。
- 回滚路径：本栈全量在库（git 历史即全量）→ `docker compose -f deploy/preview/docker-compose.yml up -d` 一键重建；如需把图片恢复走产物通道，回退 S6-前置 的映射改动（`previewTargetsFor`）。
- 数据：本栈无持久化卷；`previews/` 既有产物对象不清理、不动。

## 三、退役动作（本刀 · Push 203）

1. `deploy/preview/README.md` 顶部「已退役」状态行（不再部署 / 启动）。
2. `server/README.md`「修订（Push 203 · S6 退役）」注记 + `server/.env.example` 沙箱段注记（配置保留）。
3. 计划 S6 行 ✅ + §5 R4 / R5 收口 + 实施行「全收官」+ 关联行 + v1.16。
4. 环境：`docker compose -f deploy/preview/docker-compose.yml down`（容器 / 网络移除、镜像保留）。

## 四、结论

**退役评审通过**：`deploy/preview`（LibreOffice）自 2026-10-08 起退役；预览链路 = ONLYOFFICE 查看器（Office / 文本族 / PDF）+ 原对象直签（图片）；`structured` 二期如需恢复转换另行评审。
