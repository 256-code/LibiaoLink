# deploy/madlad/ · 内网翻译服务（MADLAD-400-3B · 接替 LibreTranslate）

用途：承担 LibiaoLink 中译英机器翻译（导出报告「项目进展描述」列 + 全站手打内容后台预翻译）。
形态：**CTranslate2 int8 + google/madlad400-3b-mt（T5 架构 · Apache-2.0）** 独立容器 —— 纯内网 CPU 推理、数据零外发、无 API Key；接口与 `deploy/libretranslate`（LibreTranslate）**完全兼容**（`POST /translate`），前端只需把 `TRANSLATE_ORIGIN` 指到本服务。

决策背景（2026-10-13）：LibreTranslate 内核 Argos/OPUS-MT 小模型质量不足（「基督城」→ Christian City、「分拨中心」→ Dial、「分拣」→ separation），用户要求换「Apache 系的 MADLAD」；候选评估见 `前端功能需求.md` §6.16 ㉒。

## 启动（三步）

```bash
cd deploy/madlad

# 第一步：准备模型（下载 + 转换，一次性；约 20-40 分钟，详见 scripts/prepare-model.sh 头注）
bash scripts/prepare-model.sh

# 第二步：起服务
cp .env.example .env        # 按需改端口/线程
docker compose up -d --build

# 第三步：验证
curl http://127.0.0.1:5006/health
curl -X POST http://127.0.0.1:5006/translate -H "Content-Type: application/json" -d "{\"q\":\"第一批设备已到港，等待清关\",\"source\":\"zh\",\"target\":\"en\",\"format\":\"text\"}"
```

模型加载约 20s（首次监听前），healthcheck 的 start_period 给到 180s；`docker compose ps` 等 STATUS 变 healthy。

### 迁移到目标机器（40G 内存）

推荐直接搬运已转换的模型产物（免下载免转换）：
```bash
# 源机器：打包（约 3GB）
tar -C deploy/madlad/data -czf model_ct2.tar.gz model_ct2
# 目标机器：放置后起服务
tar -C deploy/madlad/data -xzf model_ct2.tar.gz
docker compose up -d --build
```
若目标机器要自己下载转换：跑 `scripts/prepare-model.sh` 即可（需要 ~20GB 空闲磁盘 + ~12GB 空闲内存）。

## 前端切换

开发环境：`frontend/.env`（或 .env.local）设 `TRANSLATE_ORIGIN=http://127.0.0.1:5006`，重启 Vite 即生效；
生产环境：把 nginx/网关的 `/api/v1/translate` 上游指到本服务（契约相同）。
回滚：把 TRANSLATE_ORIGIN 指回 5005（LibreTranslate 未删，可并存对比）。

## 实测（2026-10-13 · 本机 dev 沙箱 · 40G 机器同款配置可参照）

| 项 | 结果 |
|---|---|
| 引擎 / 量化 | CTranslate2 4.8.3 · int8（model.bin 2.95GB） |
| 速度 | 热翻译 0.75–1.5s/句（beam 4 · intra_threads 4 · 20 逻辑核笔记本）；模型加载约 20s |
| 内存 | 常驻约 3-4GB（int8 权重 + 推理峰值） |
| 离线 | 模型与依赖全部本地（ModelScope 下载 + 转换一次），运行期零外网 |

质量对比（与 LibreTranslate 现状同句对照，节选）：

| 源文 | LibreTranslate | MADLAD-400 |
|---|---|---|
| 新西兰基督城仓配项目已完成联调，进入试运行阶段 | New Zealand Christian City Warming Project... | The **Christchurch** warehousing project in New Zealand has completed coordination and entered the pilot operation phase. |
| 仓配中心的分拣线安装调试进度正常 | separation line... Debugging... | Installation and commissioning of the **sorting line** in the warehouse centre is proceeding normally. |
| 深圳分拨中心将于下周开始设备调试 | Shenzhen **Dial** will... | Shenzhen **Distribution Center** will start commissioning the equipment next week. |
| 第一批设备已到港，等待清关 | The first equipment has arrived and is awaiting clearance | The first **shipment** of equipment has arrived and is awaiting **customs** clearance. |

遗留（继续靠前端术语表兜底，机制不变）：立镖 → 仍会误作 Rittal；联调 → coordination 不够精确（术语表固定 Integration Testing）；仓配 → warehousing（术语表固定 Warehouse and Distribution Center）。
术语保护占位符（Xq…Y，见 `frontend/src/translateApi.ts`）实测**原样透传**，前端保护式强翻译无需改动。

## 规格与注意事项

- 模型：`google/madlad400-3b-mt`（3B · T5 · 400+ 语言 · Apache-2.0 许可，商用友好）；
  本服务只用 zh→en（`<2en>` 语言标记），能力上支持任意 MADLAD 语向（改请求的 target 即可）。
- **陷阱（实测）**：加载 tokenizer 时 transformers 5.x 提示可加 `fix_mistral_regex=True` —— 切勿开启：
  该开关会把 `<2en>` 标记拆成 5 个 token，译文直接崩溃。默认加载即正确。
- 数据目录 `data/` 不进库（根 .gitignore 已忽略）；`data/madlad400-3b-mt/`（fp32 原始文件）转换成功后
  可删（重转需重下）。
- 资源调参：`MADLAD_BEAM_SIZE`（4 默认；降至 1 提速约 2-3 倍、质量略降）、`MADLAD_INTRA_THREADS`、
  `MADLAD_CPUS` / `MADLAD_MEM_LIMIT`（compose 资源上限）。
- 端口默认只发回环；跨机联调改 `MADLAD_BIND_IP=0.0.0.0`。
