# PoC-2 回放证据（企微通道：免登可用 / 应用消息送达 / 群通道送达 / 限速实测）

> 卡片：i6 · S8·M5-03（PoC-2 · 主责 lan，评审 wmj / px）｜验收口径 = `docs/M5-03-实施方案(企微通道).md` §一 目标四条 + §八 验证与验收；依赖先决见 `docs/M5-03-外部依赖清单(企微通道).md`。
> 状态：**骨架（Push 227 · 2026-10-13）** —— M5-03-1 ~ M5-03-3 的 stub / 回放证据已随各刀 CI 落地（见「stub 侧」列），**真机实测段待外部依赖（A1~A5 / B1~B2 / C2~C3）到位后逐项回填**。
> `docs/` 属 px 线：本文件由 lan 代记，**请 px 复核**（先例：`docs/PoC-4-回放证据(Outbox投递语义).md` 等 12 份 `docs/PoC-*` 证据）。

| 项 | 值 |
|---|---|
| 回放时间 | 待填（真机实测执行后回填） |
| 环境 | 待填（企微环境 + 本机 / CI 复跑组合；本机 PG = `libiaolink-pg` @ `127.0.0.1:55432`） |
| 数据库 | 待填（迁移至 `0046` 无漂移） |
| 代码版本 | 待填（实测时点 `lan` 提交） |
| 脚本（stub / 回放段） | `m5-03-1-wecom-stub-replay.mjs`（21 断言）/ `m5-03-2-aibot-stub-replay.mjs`（20 断言）/ `m5-03-2-group-replay.mjs`（28 断言）/ `m5-03-3-app-replay.mjs`（29 断言）/ `s7-4-automation-wiring-replay.mjs`（23 断言） |
| 口径 | 三分类（permanent / retryable / rate_limited）+ token 特例；群通道 = 智能机器人 + `chatid`（P5 定案 2026-10-12）；限速 = 按会话 30 条/分钟 + 1000 条/小时（数值待 A5 实测回填）；告警出口 = 智能机器人告警群（未配置 / 失败回退结构化日志） |

## 一、验收四条对照（§一 目标 → 证据）

| # | 验收目标 | 现状 | 证据 |
|---|---|---|---|
| ① | 免登可用（SSO 已具备） | 已具备（引用 `docs/实测报告(SSO接入验证).md` 与正式环境 Provider 事实） | 不随本回放（引用既有实测报告） |
| ② | 企微应用消息送达记录 | 待真机（A1 / A2 / A3） | 待填；stub 侧 = `m5-03-3-app-replay.mjs` |
| ③ | 群通道送达记录（智能机器人 + chatid） | 待真机（A4 / B1：「进群 + 激活 + `chatid` 落库 + 推送」全链路） | 待填；stub / Spike 侧 = `m5-03-2-aibot-stub-replay.mjs` / `m5-03-2-group-replay.mjs` + §五 5.3A（2026-10-10 ~ 10-13） |
| ④ | 限速配置实测不超限 | 待真机（A5 / B1） | 待填；Spike 已实测 846607 触发 / 恢复窗口（§五 5.3A） |

## 二、断言明细（真机实测逐行转写 · 待填）

| 结果 | 编号 | 断言 | 期望 | 实际 |
|---|---|---|---|---|
| 待填 | T1 | 应用消息：真实企微送达（A1 / A2 / A3） | errcode=0 + 接收端可见 | 待填 |
| 待填 | T2 | 群通道：绑定 → 推送全链路（B1） | errcode=0 + 群内可见 | 待填 |
| 待填 | T3 | 限速：窗口内不触发 846607；触发后延期重排（A5 / B1） | 无超限丢消息；`deferred` 不消耗重试 | 待填 |
| 待填 | T4 | 失败面：移出群 93001 → dead + 降级（B4）+ 告警 | 站内信 + 告警群留痕 | 待填 |
| 待填 | T5 | 告警出口：告警群推送 / 未配置或失败回退日志（B2） | 推送成功；回退可用 | 待填 |

## 三、依赖先决（阻塞真机段 · 见依赖清单）

- A1 应用凭据（含是否复用 SSO 应用）/ A2 可信 IP / A3 可见范围 / A5 频率配额 —— **待确认**。
- B1 测试群（机器人进群 + 激活 + `chatid` 落库）/ B2 管理员告警群 —— **接入方式已定案（2026-10-12）；待业务执行**。
- C2 密钥注入渠道 / C3 真机落点（测试环境到企微 API 可达性）—— **待确认**。

## 四、复跑（stub / 回放段 · 本机 / CI）

```bash
cd server && node scripts/m5-03-1-wecom-stub-replay.mjs
cd server && node scripts/m5-03-2-aibot-stub-replay.mjs
cd server && node --env-file-if-exists=.env scripts/m5-03-2-group-replay.mjs
cd server && node scripts/m5-03-3-app-replay.mjs
cd server && node --env-file-if-exists=.env scripts/s7-4-automation-wiring-replay.mjs
```

退出码 0 = 断言全过（可当门禁）。
