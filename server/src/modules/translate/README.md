# translate 模块（内容译文库 · §6.16 ㉕ · Push 301 · px）

| 项 | 口径 |
|---|---|
| 类型 | 横切模块（crosscut；已登记 `server/scripts/check-boundaries.mjs` 的 `CROSSCUT_MODULES`） |
| 契约 | `shared/src/modules/translate.ts`（POST /api/v1/translate · POST /api/v1/translate/batch） |
| 数据 | `content_translations`（迁移 0047；键 = source_lang + target_lang + sha256(source_text)，source_text = 原文） |
| 引擎 | 内网 HY-MT1.5-1.8B（env `TRANSLATE_ORIGIN`，默认 `http://127.0.0.1:5008`；`TRANSLATE_TIMEOUT_MS` 缺省 20s） |
| 文本加工 | `translate.text.ts`：术语保护 / 回换（11 条词表）+ 整句全大写规整 —— 原前端 translateApi.ts 逻辑内聚到服务端 |
| 前端 | `frontend/src/translateApi.ts`（会话缓存 L1；服务端译文库 L2；单条 L3）+ 保存链路预热挂点（task / project 控制器） |

## 行为

- **单条**：库命中直出；未命中调引擎 → 规整 + 术语回换 → upsert 落库 → 返回最终英文（引擎不可用 = 500 INTERNAL，前端静默降级跳过）。
- **批量**：只读查库（不调引擎），一次拿整页已存译文（英文界面切页提速）；未命中条目由前端走单条通道。
- **预热（保存即后台翻译）**：任务（中文标题 / 进展描述 note）与项目（名称 / 描述 / 客户）写入成功后被丢进 `warmup`；
  后台去重（同文本 5 分钟窗口）+ 并发 2 静默翻好落库，从不抛错、不阻塞保存响应。

## 键口径（重要）

- `q` = **原文**（所有通路统一：前端单条 / 批量查库 / 保存链路预热）—— 术语保护 / 回换 / 规整只在服务端做一次；
- 换引擎 / 提质量：把 `TRANSLATE_ENGINE` 升版本、按 engine 列批量重翻即可（旧行自然被覆盖）。

## 与前端旧口径的差异（Push 301 内变更）

- 旧：前端把术语换成 Xq…Y 占位符后 q 发引擎，落库键 = sha256(占位符文本)；开发环境 Vite 特例代理直连 5008。
- 新：q 一律原文、键 = sha256(原文)；前端只与 /api/v1/translate（服务端）对话（Vite 特例代理已删除）。
- 原因：保存链路预热在服务端进行、不经过前端 —— 保护留在前端会出现「同一原文两种键互相命中不了」且预热译文漏保护。

## 验证

- `server/test/translate.test.ts`（单测：库优先短路 / 未命中落库 / 术语保护与回换 / 引擎失败 INTERNAL / 批量只读 / 预热去重与静默）；
- 真机：`node node_modules/vitest/vitest.mjs run` 全绿 + `npm run typecheck` / `npm run build` + `check:boundaries` / `check:db-schema`（迁移 0047 已应用）。
