# M4-05b 回放证据（预览转换器沙箱：镜像 / 沙箱四性 / 中文不乱码 / 通道与错误面）

> 卡片：M4-05「预览管道」的 px 线交付件（镜像 / 部署 / 网络 / 字体）｜口径来源：ADR-007（在线预览管道）、技术设计v0.3 §3.5、ADR-013（converter 限额 2C4G）、lan 的 M4-05b 清单（PR #124 帖）。
> 落点说明：`deploy/` 与 `docs/` 均属 px 线，本文件随交付件记（无需代记复核）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-23 11:09 ~ 11:12 +08:00 |
| 形态 | 独立容器：converter（只挂 internal 网络）+ edge（哑 TCP 中继，发布 `127.0.0.1:9900`） |
| 镜像 | `libiaolink/preview-converter:1.0.0`（本地 ID `sha256:5311a78631e8…`，1.20 GB，amd64/linux） |
| 宿主 | Windows + Docker Desktop：Docker 29.7.2 / Compose v5.5.0 |
| 脚本 | `deploy/preview/service/smoke.mjs`（容器内 28 项断言）+ 宿主侧 `POST /convert` 链路 |
| 结论 | **28 / 28 PASS**；宿主侧 `POST /convert` = 200 + `%PDF-`，`x-pipeline-version: 1.0.0`，pdftotext 回读中文与源一致、pdffonts 内嵌 Noto CJK |

## 一、沙箱四性（ADR-007「不可省」项）

| 断言 | 期望 | 实际 |
|---|---|---|
| 非 root | uid != 0 | `uid=1000` |
| 只读根文件系统 | 写 `/app` 失败 | `EROFS: read-only file system, open /app/.smoke-write-probe` |
| tmpfs 工作目录 | `/tmp` 可写 | PASS（每次转换独立目录 `libiaolink-preview-*`） |
| 无外网 | HTTP 与裸 TCP 均不通 | `fetch http=false` / `TCP 1.1.1.1:443 tcp=false`（internal 网络无默认网关） |
| 超时杀进程 | 504 且不留残留 | `status=504 CONVERT_TIMEOUT`；1.5s 后 `/proc` 中 soffice / oosplash 进程数 = **0** |
| 限额（设置值） | — | `user=1000:1000` `read_only=true` `cap_drop=[ALL]` `no-new-privileges` `mem=2 GiB` `cpus=2` `pids=512` `init=true` `tmpfs=/tmp:1g` |
| 限额（实测） | — | 空闲 `cpu=0.00% / mem≈33 MiB / pids=12` |

## 二、中文字体（PoC-1 硬验收项「中文不乱码」）

- 映射：`fc-match SimSun → Noto Serif CJK SC`；`fc-match SimHei → Noto Sans CJK SC`；`fc-match 微软雅黑 → Noto Sans CJK SC`（构建期断言把关，失效即构建失败）。
- 镜像内 CJK 族：Noto Sans CJK SC / TC / JP / KR / HK + Noto Sans Mono CJK + Noto Serif CJK（同上五区）。
- 端到端：中文 DOCX（正文声明宋体、标题声明黑体）→ PDF 后 `pdffonts`：

```
name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
BAAAAA+NotoSansCJKsc-Bold            Type 1            Builtin          yes yes yes     14  0
CAAAAA+NotoSerifCJKsc-Regular        Type 1            Builtin          yes yes yes     19  0
```

- `pdftotext -layout` 回读（宿主侧产物）：`项目成果文件预览中文验收` / `一二三四五六七八九十，变更申请与阶段门禁。`，无替换字符 U+FFFD。

## 三、通道与错误面（28 项断言全表在 `smoke.mjs`）

| 用例 | 结果 |
|---|---|
| DOCX → PDF（`target=pdf`） | 200，34274 B，`%PDF-`，`x-convert-mode=convert`，耗时 612 ms |
| DOCX → 首屏 PNG（`target=image`） | 200，60470 B，`image/png`，`convert+rasterize`，705 ms |
| PDF → PDF（直通） | 200，字节级一致（sha256 相同），`passthrough`，1 ms |
| PNG → PNG（直通） | 200，字节级一致，`passthrough` |
| `target=structured` | 501 `UNSUPPORTED_TARGET`（一期未启用，xlsx 走 pdf） |
| 未知 target | 400 `BAD_REQUEST` |
| 不支持源类型（.exe） | 415 `UNSUPPORTED_MEDIA` |
| 声明超长 Content-Length | 413 `PAYLOAD_TOO_LARGE` |
| 超时（`CONVERT_TIMEOUT_MS=1`） | 504 `CONVERT_TIMEOUT` + 无残留进程 |

## 四、宿主侧链路（worker 视角，走 `127.0.0.1:9900` → edge → converter）

```
POST http://127.0.0.1:9900/convert
  x-preview-target: pdf
  x-file-name: %E9%A1%B9%E7%9B%AE%E6%88%90%E6%9E%9C%E6%96%87%E4%BB%B6%EF%BC%88%E9%AA%8C%E6%94%B6%E6%A0%B7%E4%BE%8B%EF%BC%89.docx
-> HTTP 200 | 20205 B | %PDF- | x-pipeline-version: 1.0.0 | x-convert-mode: convert | x-convert-duration-ms: 716
```

`GET /healthz`（同一时刻）：

```json
{"ok":true,"service":"preview-converter","pipelineVersion":"1.0.0",
 "engine":{"available":true,"version":"LibreOffice 25.2.3.2 520(Build:2)","rasterizer":"pdftoppm version 25.03.0"},
 "fonts":{"simsun":"Noto Serif CJK SC","simhei":"Noto Sans CJK SC","yahei":"Noto Sans CJK SC","cjkReady":true},
 "limits":{"timeoutMs":60000,"maxBytes":268435456,"maxConcurrency":2,"maxQueue":8,"imageDpi":150,"inflight":0,"queued":0}}
```

## 五、未覆盖 / 已知偏差（如实登记）

1. **未压测**：200MB 级大文件、并发 2~4、长时间运行的内存曲线未测 —— 属 M4-05 压测与 M8 容量验证（ADR-013：converter 限额 2C4G / 并发 2~4）。
2. **版式保真度未验收**：本证据只覆盖「通道打通 + 中文不乱码」硬项；Excel 分页 / 复杂版式的观感需 PoC-1 用业务真实样本过（风险登记在 `deploy/preview/README.md` §八）。
3. **LibreOffice 25.2 的扩展名映射坑**：本镜像内 `--convert-to docx`（按扩展名找导出过滤器）解析不到，`--convert-to docx:MS Word 2007 XML`（显式过滤器名）正常；产品路径只导出 `pdf`（按扩展名解析正常，已实测），故不影响转换器，smoke 的样例生成走显式过滤器名。
4. **edge 只服务沙箱 dev**：生产形态（M8）worker 与 converter 同处 internal 网络、不发布端口，必须删掉 edge。
5. **未验证真实 Office 产出的复杂文件**：样例由容器内 LibreOffice 生成（Writer/Web → DOCX）；真实 Word / Excel 复杂文档的解析成功率要到 PoC-1 样本集上验证。
6. **镜像未发布**：本机构建、未推内网 registry（发布动作在 M8 生产部署形态验证前完成，与 `deploy/minio/` 的镜像固化同口径）。
