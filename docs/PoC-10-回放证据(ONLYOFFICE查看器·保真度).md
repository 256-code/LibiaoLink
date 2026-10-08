# PoC-10 回放证据（ONLYOFFICE 查看器 · 次关 N1 保真度抽查）

> 卡片：PoC-10（主责 lan，协办 wmj、px）｜执行口径：`docs/ONLYOFFICE替换执行计划(Office预览).md` §3 N1。
> 判据：同一文件分别走 **ONLYOFFICE 查看器** 与 **现行 LibreOffice→PDF** 方案，逐项记录 版式 / 公式 / 图表 / 条件格式 / 字体（宋·黑）/ 分页；**无「内容性失真」为达标**。
> 样本来源：业务反馈无法提供公司真实样本（2026-09-30，lan 转述），经授权由实施方**自建构造样本**（贴近业务形态、含中文与常见办公要素；生成器与样本已入库，sha256 见 §1）。业务后续如能提供真实文件，建议按本模式追加 1~2 份抽样复核（可选）。
> 本文件属垫底记录（代记先例：PoC-5 / 首关），请 px 复核；结论供 ADR-030（wmj 主责）与业务验收引用。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-30 14:08 ~ 14:26 +08:00 |
| 镜像 | `onlyoffice/documentserver:9.4.0.1`（digest `sha256:3ab6ebc7c605e5a32b7ae3ff19daed4925090245acc8100ce2230bd766c88212`；与首关同一 pin） |
| 容器 | 本机独立容器 `libiaolink-onlyoffice-poc`（`127.0.0.1:8001->80`，2C4G，接入 `libiaolink-minio_default`），JWT 开启 |
| 存储 | 本仓 MinIO（`libiaolink-minio:9000`），夹具前缀 `poc10/`（收尾即删） |
| 字体 | 容器内装：Noto Sans CJK SC（开源）+ 宋体/黑体/仿宋/楷体（**测试沙箱自 Windows 宿主拷入，仅作保真度观察，不随镜像分发**；生产字体授权另行评审） |
| 基线 | `deploy/preview`（LibreOffice 25.2.3.2 沙箱）：`POST /convert`（`x-preview-target: pdf`）→ `pypdfium2` 栅格化；其字体自述映射 `simsun→Noto Serif CJK SC`、`simhei→Noto Sans CJK SC`（`/healthz`） |
| 代码版本 | `36a22c3`（lan 线 HEAD；本轮入库 `server/scripts/poc10/`：fidelity 模式、样本生成器、`fixtures/`） |
| 执行环境 | Windows 11 / PowerShell；无头 Edge（`--headless=new`）单实例顺序跑；Node 24 |

## 1. 样本清单（构造样本；生成器 `server/scripts/poc10/make-n1-samples.py`，字节级确定性）

| 样本 | 形态 | 覆盖项 | 字节 | sha256（前 16） |
|---|---|---|---|---|
| `n1-01-fee-summary.xlsx` | 部门费用汇总（2026-08） | 多 Sheet（汇总/明细/图表）、跨表公式（COUNTA/SUM/COUNT/IFERROR）、柱状图+折线图+横向柱状图、条件格式（色阶/数据条/单元格规则）、冻结窗格、数据验证下拉、合并单元格 | 12,965 | `e632473c9add592e` |
| `n1-02-project-ledger.xlsx` | 项目台账（1200 行） | 1200 行×11 列、RANK、嵌套 IF 评级、SUMIFS/COUNTIF、图标集/Top10/数据条/单元格规则、自动筛选、千分位 | 103,224 | `2b2ed5c284142bf5` |
| `n1-03-weekly-report.docx` | 项目周报（复杂版式） | 多级标题、编号列表+项目符号、合并单元格表格（含竖合并）、页眉页脚+页码域、内嵌插图、超链接、中英混排/全角标点 | 57,166 | `ab4a5f95d0c738e0` |
| `n1-04-management-policy.docx` | 管理制度（长文档） | 章条结构（19 条）、显式分页符、46 行跨页长表（表头重复）、引用标注、超链接、页脚页码域 | 41,925 | `55a0bd6b4634e040` |
| `n1-05-official-notice.docx` | 红头通知（公文样式） | 红头（黑体红字）、文号、红色分隔线、仿宋正文+首行缩进、落款右对齐、电子印章插图、版记（抄送/印发） | 47,591 | `e5f04ad317785c9a` |

> 复现：`cd server/scripts/poc10 && python make-n1-samples.py`（openpyxl 3.1.5 / python-docx 1.2.0 / Pillow 12.3.0；固定文档属性时间 + zip 时间戳归一化 → 同脚本重跑字节一致，`fixtures/n1-samples.manifest.json` 随附）。

## 2. 方法与口径

- **查看器侧**：`viewer.mjs fidelity` —— 每份样本独立 `docKey`、view-only JWT（`download/print/comment/edit=false`）、经内网预签名 URL 拉取；xlsx **逐个 Sheet 点击切换**后截屏，docx 用 **PageDown 翻页**（每步含工具条/状态栏，页码指示可见）后截屏；全程收集控制台异常、`net::ERR_*`、≥400 响应。
- **基线侧**：`POST http://127.0.0.1:9900/convert`（`x-preview-target: pdf`、`x-file-name`），PDF 经 `pypdfium2` 栅格化逐页留档。
- **判读**：① 截图矩阵逐项目视（版式/公式/图表/条件格式/字体/分页）；② **数值独立复算**（Python 直接读夹具原始数据求和/比值，与两侧渲染值对照）。
- 结果面：查看器 5/5 `ready`（冷开 0.7~1.6s，含服务端转换），**控制台 0 异常、0 网络失败**；基线 5/5 转换 200（0.9~2.2s）。

## 3. 结果矩阵（逐项）

| 样本 | 版式 | 公式 | 图表 | 条件格式 | 字体（宋·黑） | 分页 |
|---|---|---|---|---|---|---|
| n1-01 | ✅ 合并/冻结/列宽一致 | ✅ 与独立复算一致：合计 38,678.96 / 28,872.16 / 22,157.44 / 89,708.56；明细 12 笔 = 233,581.92；培训费占比 24.7% | ✅ 3 张图完整（柱/折线/横向，含中文标题图例） | ✅ 色阶+数据条+单元格规则（未触发态一致） | ✅ 宋体/黑体按族渲染，无 tofu | 基线 8 页（打印分列） vs 查看器 3 Sheet（呈现形态不同，内容完整） |
| n1-02 | ✅ 1200 行滚动、冻结、筛选器 | ✅ 结余/执行率/嵌套 IF/RANK/SUMIFS 一致；三状态 SUMIFS 之和 = 支出总额 2,397,363.90；整体执行率 79.4% | ✅ 分状态柱状图 | ✅ 图标集+数据条+Top10（最高支出 5,430.38 双侧同为命中项）+「超预算」红字 | ✅ | 基线 64 页（打印分页） vs 查看器整表滚动（呈现形态不同，内容完整） |
| n1-03 | ✅ 多级标题/列表/合并表格/页眉页脚/插图/链接 | ✅ 页码域「第 2 页 / 共 2 页」 | —（插图正常） | — | ✅ 宋/黑/楷；中英混排与全角标点正常 | ✅ 2 页 = 基线 2 页 |
| n1-04 | ✅ 章条、分页符、跨页长表**表头重复**、参考文献、超链接 | ✅ 末尾参考文献 [1][2][3] 完整 | — | — | ✅ | ⚠ 查看器 5 页 vs 基线 6 页（见 D1；内容逐条核对无缺失） |
| n1-05 | ✅ 红头/文号/红线/仿宋正文首行缩进/落款右对齐/印章/版记 | ✅ 页码域 | —（印章插图正常） | — | ✅ 黑体红头 + 仿宋正文 | ✅ 2 页 = 基线 2 页 |

## 4. 差异登记（观察项；均非「内容性失真」）

| # | 差异 | 说明与判定 |
|---|---|---|
| D1 | 分页：n1-04 查看器 5 页 vs 基线 6 页 | 字体度量/行高不同导致断页点不同；已逐条核对 19 条条文 + 46 行长表（含末行）+ 参考文献 + 超链接全部在位 → 非内容丢失 |
| D2 | 断行位置：n1-03 第 3 条列表（「（编号：MOM-2026-0918）；」换行点） | 文字内容一致，仅排版断行不同 |
| D3 | 印章插图尺寸：基线渲染略大于查看器 | 锚点、顺序、页面位置一致；为图片缩放的渲染差异 |
| D4 | 第三方库产出的图表 XML 在查看器渲染为「空图」 | openpyxl 默认图表缺显式系列样式且分类轴 `axPos=l`（Excel 实际产物为显式样式 + `axPos=b`）；生成器补齐后两侧一致（§5 FIX-1）。**存量文件如来自非 Excel/WPS 工具，建议抽样复核** |
| D5 | 首次打开右上角「多页视图」提示浮层 | 产品 UI 提示，非文档内容；harness 自动点击「知道了」关闭（截图矩阵含关闭前后对照） |

## 5. 夹具修正记录（发现 → 修正 → 复核；均只影响夹具质量）

| # | 现象 | 修正 | 复核 |
|---|---|---|---|
| FIX-1 | 图表系列不可见（仅坐标轴） | 生成器为每系列补显式填充、分类轴 `axPos=b`（Excel 风格） | 修正后与基线渲染一致 |
| FIX-2 | n1-02「整体执行率」= 0.0% | 公式自引用（B6/B5）→ B5/B4 | 79.4%（基线同值） |
| FIX-3 | n1-01「培训费占比」显示 32.2%（实为办公费占比） | 引用列错（C12/E12）→ D12/E12 | 24.7%，与独立复算一致 |

> 三项均由「数值独立复算 + 侧别对照」发现，反向验证了 N1 判读方法的有效性。

## 6. 判据结论

- 五项观察项（版式 / 公式 / 图表 / 条件格式 / 字体 / 分页）**均无内容性失真**：无乱码/tofu、公式值一致、图表与条件格式可见且语义一致、长文档内容完整；
- 差异仅 D1~D3（排版度量/断行/图片缩放类）与 D4/D5（工具链与 UI 类，已登记处置）；不构成替换阻碍；
- **N1 达标**（判据满足）。`deploy/preview`（LibreOffice）不退役，与 ONLYOFFICE 并存至切换完成（D5 口径）。

## 7. 复现要点

1. 样本：`python make-n1-samples.py` 重建（sha256 与 §1 对照）；
2. 容器：同首关，**注意 F3** —— 容器每次启动会把 `token.enable.request.outbox` 重置回 true（S3 预签名拉取 400），须在容器启动后改 `local.json` 并 `supervisorctl restart ds:docservice`（只重启进程）；字体安装后跑 `documentserver-generate-allfonts.sh`；
3. 回放：`viewer.mjs fidelity --files n1-01,...,n1-05 --label <标签>`（`--probe` 可输出帧内 DOM 探针；`--word-steps` 自定义翻页）；
4. 基线：`deploy/preview` up → `POST /convert` → `pypdfium2` 栅格化；
5. 收尾：删容器、清 `poc10/` 前缀对象、清无头浏览器 profile（零残留）。

## 8. 附件清单（仓外证据，留 hash 后清理）

| 文件 | 字节 | sha256 前 16 |
|---|---|---|
| shots/n1e-n1-01-sheet-1.png（汇总） | 89100 | 6037185046643876 |
| shots/n1e-n1-01-sheet-3.png（图表） | 87848 | 31ff06f1adeda852 |
| shots/n1e-n1-02-00-default.png（台账） | 195370 | 7a5b13ec562fdbc6 |
| shots/n1e-n1-02-sheet-2.png（统计） | 73653 | 838d36225991d12b |
| shots/n1d-n1-03-00-default.png | 84493 | 07a7bf53c429362f |
| shots/n1d-n1-03-page-3.png（插图/链接） | 54373 | 56767559bced72f4 |
| shots/n1d-n1-04-00-default.png | 60148 | f39fc8895727493b |
| shots/n1d-n1-04-page-4.png | 31846 | 35085d470939416c |
| shots/tail2-n1-04-step-1.png（尾页：长表尾部+参考文献） | 55756 | f2464d3e019973fd |
| shots/n1d-n1-05-00-default.png | 68285 | 2364566a1d574c3d |
| shots/n1d-n1-05-page-2.png（印章/版记） | 58422 | 1d7993e812863f9f |
| baseline png/n1-01-fee-summary-p01.png | 132375 | e7ae7292bc038f7e |
| baseline png/n1-01-fee-summary-p05.png（图表页） | 93409 | 3f15236e436cfd82 |
| baseline png/n1-02-project-ledger-p01.png | 596975 | 9e57fefe5488114b |
| baseline png/n1-02-project-ledger-p64.png（统计图表页） | 13266 | bf6eefe39cd0928f |
| baseline png/n1-03-weekly-report-p01.png | 364070 | 8024f53480282bea |
| baseline png/n1-03-weekly-report-p02.png | 191595 | be48b0a32dc5f326 |
| baseline png/n1-04-management-policy-p01.png | 264273 | 1e63bb11b084dad8 |
| baseline png/n1-04-management-policy-p06.png（尾页） | 70066 | e47b7842297c219d |
| baseline png/n1-05-official-notice-p01.png | 306223 | db1438fab9176601 |
| baseline png/n1-05-official-notice-p02.png | 56499 | 774c3191377f2c44 |
| logs/n1d.json（5/5 ready，0 异常） | 6307 | 2ae249a6e85a9133 |
| logs/n1e.json（修正后复跑） | 2804 | a3331718da1a7b5b |
| logs/tail2.json（n1-04 尾页定向复核） | 1045 | d8878a32a9b85c9a |

> 基线完整页 PNG（n1-01 8 页 / n1-02 64 页 / n1-03 2 页 / n1-04 6 页 / n1-05 2 页）、转换耗时（`convert-results.json`）、PDF 页数与页面尺寸（`pdf-summary.json`）同在仓外 `D:\poc10-onlyoffice\n1-baseline\`。
