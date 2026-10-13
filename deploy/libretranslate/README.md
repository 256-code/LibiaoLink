# deploy/libretranslate/ · 内网翻译服务（报告英文译文通道）

用途：给「项目总览导出 PDF」的「项目进展描述」列提供 zh→en 机器翻译（当前全库仅 4 条短句，量小）。
形态：官方 LibreTranslate（Flask + Argos/OPUS-MT 小模型）独立容器 —— **纯内网推理、数据零外发、无 API Key**、CPU 可跑；端口默认只发回环 `127.0.0.1:5005`。

对应需求：`前端功能需求.md` §6.16 ⑭（译文方案评估）→ ⑮（本目录 = 实测结论落地）。

## 启动

```bash
cd deploy/libretranslate
node scripts/seed-models.mjs --with-packages   # 预置模型（第一次必须跑，见「踩坑」）
docker compose up -d
docker compose ps                              # 等 STATUS 变 healthy（约 30s）
```

验证（宿主机）：

```bash
curl http://127.0.0.1:5005/languages
curl -X POST http://127.0.0.1:5005/translate -H "Content-Type: application/json" -d "{\"q\":\"第一批设备已到港，等待清关\",\"source\":\"zh\",\"target\":\"en\",\"format\":\"text\"}"
```

浏览器打开 <http://127.0.0.1:5005> 有自带界面，可人工试译。

交付形态可关掉自带网页界面：把 compose 里注释的 LT_DISABLE_WEB_UI: "true" 打开即可（首页 404、只留 /translate 等 API；用户侧一律走 LibiaoLink 自己的界面，不需要感知本服务）。

## 实测（2026-10-10 · 本机 dev 沙箱）

| 项 | 结果 |
|---|---|
| 版本 | v1.9.6（`libretranslate/libretranslate:latest`，镜像构建 2026-09-28，image id 前缀 b9eeb383） |
| 真实数据 | 4 条真实进展描述 zh→en 全部翻译成功 |
| 速度 | 冷启动首条 1.1–2.3s；热翻译 67–800ms / 条（2 workers） |
| 内存 | 常驻 ~630MB（2 workers 起；每 worker 首次用到时各自加载模型） |
| 离线首启 | 预置模型后容器启动日志无任何 Download / Install 动作，断外网可用 |
| 质量 | Argos/OPUS-MT 小模型水平：短技术句及格（示例：第一批设备已到港，等待清关 → The first equipment has arrived and is awaiting clearance）；「冻结版」等词直译、非 ChatGPT 级 —— 仍是机翻，不承诺客户级文风 |

## 踩坑（为什么必须跑 seed-models.mjs）

LibreTranslate 1.9.x 每次翻译前要先做英文/中文本句切分，分句模型走 **MiniSBD onnx**
（`en.onnx` 184KB / `zh-hans.onnx` 602KB），运行期从 **GitHub Releases** 下载 ——
办公网网关对 GitHub 的 TLS 时通时断（容器内下载高发 `UNEXPECTED_EOF_WHILE_READING`，失败时 `POST /translate` 直接 500）。

`seed-models.mjs` 在宿主机走 Node 原生 https（`rejectUnauthorized=false` 兼容网关替换证书）预下载进挂载目录
`data/argos/minisbd/`，容器运行时缓存命中即跳过下载 —— 这是本目录存在的主要原因。

同一脚本 `--with-packages` 还会预置 zh↔en 语言包（~165MB，来源 argos-net.com），
让容器首启完全离线；不加该参数则容器首启自行下载（本机实测容器网络可达 argos-net.com）。

## 数据目录（不进库，见根 .gitignore）

| 路径 | 内容 | 说明 |
|---|---|---|
| `data/argos/minisbd/` | 分句模型 2 个 onnx | seed 脚本预置（必需） |
| `data/argos/packages/` | 语言包（zh↔en 各一份） | `--with-packages` 时预置；容器首启自行安装时也落这里 |
| `data/argos/seed/` | 语言包原始 `.argosmodel` | 仅安装素材，可删（删后重跑脚本会重下） |

新增语向（改 `LT_LOAD_ONLY`）需重跑 `--with-packages` 并同步改 `LANGUAGE_PACKAGES` 清单。

## 接线状态（2026-10-10）

- **前端已接线**（`前端功能需求.md` §6.16 ⑯）：导出报告「项目进展描述」列英译走 `POST /api/v1/translate`（前端 `src/translateApi.ts`，契约 = 本服务的 /translate：`{ q, source, target, format }` → `{ translatedText }`）；
- **开发环境**：Vite 代理 `/api/v1/translate → http://127.0.0.1:5005/translate`（`frontend/vite.config.ts`，`TRANSLATE_ORIGIN` 可覆盖；规则排在通用 `/api/v1` 之前先命中）—— 前端/导出脚本不直连本服务端口；
- **生产环境**：由后端 `server/` 按同契约实现代理 + 缓存（当前未实现；未实现期间前端取不到译文会静默降级为只出中文，导出不受影响）；
- 缓存建议：译文可落库（任务表附加列或独立翻译缓存表，键 = 原文哈希）避免重复翻；机翻结果建议人工可改；
- 端口：容器只发回环，后端在同机/同内网直连即可，无鉴权需求（内网、只读翻译接口）。

## 许可与合规备注

- LibreTranslate 本体为 **AGPL-3.0**（其语言模型为 CC-BY / OPUS-MT 系，随包说明）；
- 本项目以**未修改的官方镜像**独立部署、仅经 HTTP 调用、不分发其代码 —— 与其他仓库代码无静态链接；
- 更细的生产合规口径（镜像固化、离线包、许可复核）建议按仓库惯例交由 wmj / lan 复核后再定档。
