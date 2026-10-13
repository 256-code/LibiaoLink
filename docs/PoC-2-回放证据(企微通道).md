# PoC-2 回放证据（企微通道：免登可用 / 应用消息送达 / 群通道送达 / 限速实测）

> 卡片：i6 · S8·M5-03（PoC-2 · 主责 lan，评审 wmj / px）｜验收口径 = `docs/M5-03-实施方案(企微通道).md` §一 目标四条 + §八 验证与验收；依赖先决见 `docs/M5-03-外部依赖清单(企微通道).md`。
> 状态：**真机段已回填（Push 228 · 2026-10-13）** —— M5-03-1 ~ M5-03-3 的 stub / 回放证据已随各刀 CI 落地；**真机实测（群通道）T2 ~ T5 + T4R（重拉恢复）全通过**（T1 单聊面因范围调整暂缓）—— 断言明细见 §二、落痕见 §五。
> `docs/` 属 px 线：本文件由 lan 代记，**请 px 复核**（先例：`docs/PoC-4-回放证据(Outbox投递语义).md` 等 12 份 `docs/PoC-*` 证据）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-10-13 11:12 ~ 11:36（+08:00 · 本机真机段） |
| 环境 | 真企微环境（智能机器人长连接 · 真机器人）+ 本机 Windows / Docker Desktop + PG `libiaolink-pg` @ `127.0.0.1:55432`（worker 真机消费）；测试群 A（`wrsu…aKSg`）+ 告警群（`wrsu…9vww`）—— 掩码口径 |
| 数据库 | 迁移至 `0046` 无漂移（本机库 · 真机段未改 schema） |
| 代码版本 | `lan` @ `35f5ef1`（Push 227 · PR #322 时点 `dist` 构建；真机段零代码改动） |
| 脚本（stub / 回放段） | `m5-03-1-wecom-stub-replay.mjs`（21 断言）/ `m5-03-2-aibot-stub-replay.mjs`（20 断言）/ `m5-03-2-group-replay.mjs`（28 断言）/ `m5-03-3-app-replay.mjs`（29 断言）/ `s7-4-automation-wiring-replay.mjs`（23 断言）；真机段 = `server/dist/entry/worker.js` 真实消费（证据 = §五 落痕 + 群内目视） |
| 口径 | 三分类（permanent / retryable / rate_limited）+ token 特例；群通道 = 智能机器人 + `chatid`（P5 定案 2026-10-12）；限速 = 群通道按会话 30 条/分钟 + 1000 条/小时（env 默认值 · T3 实证判定链；A5 应用面随单聊面暂缓）；告警出口 = 智能机器人告警群（失败 / 未配置回退结构化日志；真机段实测成功 · T5） |

## 一、验收四条对照（§一 目标 → 证据）

| # | 验收目标 | 现状 | 证据 |
|---|---|---|---|
| ① | 免登可用（SSO 已具备） | 已具备（引用 `docs/实测报告(SSO接入验证).md` 与正式环境 Provider 事实） | 不随本回放（引用既有实测报告） |
| ② | 企微应用消息送达记录 | **本轮范围外**（2026-10-13 范围调整：单聊面暂缓） | 待填；stub 侧 = `m5-03-3-app-replay.mjs` |
| ③ | 群通道送达记录（智能机器人 + chatid） | **已真机通过**（T2 / T3 / T4 / T4R：绑定 → 送达 → 移出死信 → 重拉恢复全链路） | §二 T2 ~ T4R + §五 落痕；stub / Spike 侧 = `m5-03-2-aibot-stub-replay.mjs` / `m5-03-2-group-replay.mjs` + §五 5.3A（2026-10-10 ~ 10-13） |
| ④ | 限速配置实测不超限 | **已真机通过**（T3：窗口满额 → 延期重排 → 窗口翻转自动送达；`deferred` 不消耗重试） | §二 T3 + §五 落痕；Spike 已实测 846607 触发 / 恢复窗口（§五 5.3A） |

## 二、断言明细（真机实测逐行转写 · 已回填 2026-10-13）

| 结果 | 编号 | 断言 | 期望 | 实际 |
|---|---|---|---|---|
| 范围外 | T1 | 应用消息：真实企微送达（A1 / A2 / A3） | errcode=0 + 接收端可见 | 2026-10-13 范围调整：单聊面暂缓 |
| 通过 | T2 | 群通道：绑定 → 推送全链路（B1） | errcode=0 + 群内可见 | 2026-10-13 11:15：绑定（`chatid` 32 字符 · 掩码 `wrsu…aKSg`）→ outbox `#8998` → 受理成功（errcode=0）→ `deliveries#2 sent`；**群内可见（用户确认）**；注：首次消费撞长连接建立中 → 重试 1 次后成功（`attempts=1`） |
| 通过 | T3 | 限速：窗口内不触发 846607；触发后延期重排（B1） | 无超限丢消息；`deferred` 不消耗重试 | 2026-10-13 11:22：预置分钟窗口满额（count=30）→ 第 31 次拒 → 延期重排至 03:23:00Z（`attempts=0` · `deliveries#3 deferred`）；11:23:00 窗口翻转 → 11:23:01 自动送达（`#8999 done` · `deliveries#4 sent` · 新窗口 count=1）；**群内可见（用户确认）** |
| 通过 | T4 | 失败面：移出群 93001 → dead + 降级（B4）+ 告警 | 站内信 + 告警群留痕 | 2026-10-13 11:33：用户移出机器人 → outbox `#9000` → `errcode=93001 not allow send msg in room`（permanent）→ dead（无重试退避）；降级站内信 `notifications#33`（项目经理 · unread · 「【项目群播报未送达，已降级为站内信】」前缀 + 原文）；死信告警即时推送（见 T5） |
| 通过 | T4R | 移出后重拉恢复（追加项 · §九 风险 ④ 链路闭环） | 重拉免激活 + 推送恢复 | 2026-10-13 11:36：用户重拉机器人 → outbox `#9001` → 受理成功（errcode=0 · 0 重试）→ `deliveries#6 sent`（11:36:16）；**群内可见（用户确认）** |
| 通过 | T5 | 告警出口：告警群推送 / 未配置或失败回退日志（B2） | 推送成功；回退可用 | 2026-10-13 11:33：告警群收到 `【LibiaoLink 告警】outbox.dead`（用户确认）；日志「告警已推企微告警群：outbox.dead · chatid ****9vww」；回退路径本轮未触发（由实现 + 单测承担） |

## 三、依赖先决（阻塞真机段 · 见依赖清单）

- A1 应用凭据（含是否复用 SSO 应用）/ A2 可信 IP / A3 可见范围 / A5 频率配额 —— **暂缓（2026-10-13 范围调整：单聊面本轮不做）**。
- B1 测试群（机器人进群 + 激活 + `chatid` 落库）/ B2 管理员告警群 —— **B1 接入方式已定案（2026-10-12）· 测试群可复用；B2 已落实（2026-10-13：告警群 + 机器人激活 · `chatid` 已提供）**。
- C2 密钥注入渠道 / C3 真机落点（测试环境到企微 API 可达性）—— **本机已具备（2026-10-13 真机段实证：`server/.env` 注入 · git 忽略；长连接 + 实发成功）；生产注入随部署方案**。

## 四、复跑（stub / 回放段 · 本机 / CI）

```bash
cd server && node scripts/m5-03-1-wecom-stub-replay.mjs
cd server && node scripts/m5-03-2-aibot-stub-replay.mjs
cd server && node --env-file-if-exists=.env scripts/m5-03-2-group-replay.mjs
cd server && node scripts/m5-03-3-app-replay.mjs
cd server && node --env-file-if-exists=.env scripts/s7-4-automation-wiring-replay.mjs
```

退出码 0 = 断言全过（可当门禁）。

## 五、落痕（本机 PG · 2026-10-13 真机段）

| 编号 | 落痕（outbox / notify_deliveries / notifications） |
|---|---|
| T2 | `outbox #8998 done`（attempts=1 —— 首次消费撞长连接建立中 · 重试 1 次后成功）；`notify_deliveries #2 wecom_group sent`（03:15:45Z）；群内可见（用户确认） |
| T3 | `notify_rate_counters` 预置 `group:c87de8b66fd5:w60000` @03:22Z count=30 → `outbox #8999` 首轮 `deferred`（attempts=0 · available_at=03:23:00Z · 日志「延期重排（不消耗重试次数，至 2026-10-13T03:23:00.000Z）」）→ 窗口翻转自动重试 → `#8999 done`（attempts=0）；`deliveries #3 deferred` / `#4 sent`（03:23:01Z）；新窗口 count 重置 = 1；群内可见（用户确认） |
| T4 | `outbox #9000 dead`（errcode=93001 permanent · 日志「群播报确定性失败（转 dead）」）；`deliveries #5 dead`；降级 `notifications #33`（type=reminder · source_dedupe_key=`M5-03-PoC2:T4:2026-10-13:c504` · unread）；告警日志「告警已推企微告警群：outbox.dead · chatid ****9vww」 |
| T4R | `outbox #9001 done`（attempts=0）；`deliveries #6 sent`（03:36:16Z）；群内可见（用户确认） |
| T5 | 告警群收到 `【LibiaoLink 告警】outbox.dead`（用户确认） |
| T5+（同场发现 · 非计划项） | 探针路径复报实证：`outbox.dead_letter` ×3 —— 11:37:45 / 11:42:45 / 11:47:45（每 5 分钟一轮 · 同一死信 `#9000`）；成因 = 探针状态口径 + 抑制窗口（5 分钟）恰等于探针周期（5 分钟）竞态穿透 + 即时 / 探针 code 分离；已登记方案 §九（修复随 Push 229） |

> 运行时口径：worker = `server/dist/entry/worker.js`（`server/.env` 注入 · git 忽略 · 真机段零代码改动）；限速桶键 = `group:<chatBucketId>:w60000` / `:w3600000`（`chatBucketId` = sha256(chatid) 前 12 位 —— 计数键 / 日志不含 chatid 明文）；chatid 一律掩码（`wrsu…aKSg` / `wrsu…9vww`）。
