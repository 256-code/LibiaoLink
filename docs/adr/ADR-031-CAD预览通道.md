# ADR-031 CAD 预览通道：二维转换管线 + 三维前端解析

- 状态：草案（Proposed）｜评审：px、lan｜随 PR 合并 main 后转「已采纳（Accepted）」
- 日期：2026-10-13｜决策人：wmj（CAD 域负责人）
- 依据：ADR-007（在线预览管道）、ADR-008（三维与 CAD 查看策略）、ADR-030（Office 预览改由 ONLYOFFICE 承接）、技术设计 v0.1 §4.8、M4-06 留痕（2026-09-28 暂缓）；
  PoC 证据：M4-06-CAD-PoC报告-真实样本补测.md（130 件真实 DWG 全版本）、ADR-008三维PoC报告.md（STEP→WASM→three.js 全链路）

## 背景

CAD 预览是 M4-06 卡片（二维）与 ADR-008（三维）遗留的条件性交付项。2026-10-12/13 PoC 完成后达标条件已满足：

- 二维（dwg/dxf）：ezdxf 1.4.4（MIT）+ libredwg 0.14（GPL）管线，130 个官方真实 DWG 全版本（r14→2018）通过率 97.7%（recover 模式），单图 0.1–0.6s，中文/图层/线宽/线型/CTB 相关项实测通过。
- 三维（STEP/STL/3MF/IGES）：occt-import-js 0.0.23（OpenCASCADE WASM，LGPL-2.1）+ three.js（MIT）**纯前端解析**，真实件（限流环 STEP / 零件8 STL 5.5MB / 防误按罩 3MF）验证通过，NIST 装配体 18 件解析 281ms。
- 用户真实文件实测暴露并解决：GBK 编码实体名乱码（读侧转码）、模型坐标系偏移与 Z-up 轴向（展示层归位）、PNG 位图缩放不可读（SVG 矢量主通道）。

## 决策

1. **二维 CAD（dwg / dxf）**：走**服务端转换管线**（复用 ADR-007 产物通道架构）：
   - 转换引擎 = Python + ezdxf + libredwg（替换退役 LibreOffice 栈；deploy/preview 沙箱骨架复用）；
   - 产物 = **SVG 主通道**（`target: image`，矢量缩放小字可读）+ PDF 备选（`target: pdf`，打印口径），同一次转换双产物，三元组缓存键（`previews/{contentHash}/{pipelineVersion}/{target}`）天然支持；
   - `PreviewTarget` 契约枚举**零新增**（pdf / image 已在，符合 M4-06 留痕口径「CAD 产物 PDF → pdf 通道、SVG → image 通道」）；
   - 读取侧容错链：readfile → ezdxf.recover → 确定性 failed + 原因（D2-05 降级「请下载」）；
   - 渲染器标配**智能视口**（实体中心 MAD 剔除离群 + 主簇裁剪）：真实文件存在离群 INSERT（实测 bloko 块被缩放 3256 倍、跨度 340 万单位），不裁剪则真实内容被压成一点。
   - 落地节奏：转换器镜像与投递恢复（`preview.targets.ts` CAD 映射 + `PREVIEW_PIPELINE_VERSION` 递增）随 M4-06 正式切片，另行排期（px 线运维件）。

2. **三维 CAD（step/stp/iges/stl/3mf/obj/gltf）**：走**前端直读通道**（对齐图片直签模式）：
   - 解析 = occt-import-js WASM（STEP/IGES B-Rep）+ three.js Loader（STL/3MF/OBJ/glTF），**浏览器内完成，零服务端转换、零产物缓存**；
   - 展示 = three.js WebGL（本仓库 CadViewer 组件）；
   - 契约 = FilePreviewKind 增 `cad3d`（前端类型判定 + 短时签名 URL 原对象直读，同图片直签口径 D2-04：禁匿名、短时签名、审计不新增——预览不写操作日志，Push 283 口径）；
   - 生产特性（本轮 PoC 已验证的六点）：GBK 实体名转码（读侧 gbk→utf-8 预转）、点到点/直径测量、轴对齐剖切、爆炸图、装配树（层级/显隐/高亮）、XYZ 坐标轴指示器（gizmo 与主视图同步）+ 模型归位（Z-up→Y-up + 包围盒居中，旋转中心正确）；
   - 权限/审计：读侧与图片通道同口径（短时签名 URL、登录鉴权；预览动作不写审计）。

3. **格式路由总表**（前端判定 + 服务端 viewer 通道对齐）：

| 格式族 | 通道 | 解析位置 |
|---|---|---|
| dwg / dxf | 服务端转换 → SVG(image)/PDF | 转换沙箱 |
| step / stp / iges | cad3d 前端直读 | occt WASM |
| stl / 3mf / obj / gltf | cad3d 前端直读 | three.js Loader |

## 备选与不采用原因

- **二维也走前端解析**（ezdxf 无浏览器 WASM 版；dwg 解析在浏览器不可行）——不采用。
- **三维走服务端转换**（STEP→glTF 预转 + 缓存）：多一条转换管线与产物存储，且真实装配体需 LOD/分件加载，服务端预转无法按客户端视锥裁剪——不采用，保留为超大批量件的后备路径。
- **商业 SDK**（ODA / CAD Exchanger / HOOPS）：许可成本高、与「数据不出内网 + 开源优先」冲突——不采用（v0.1 方案 D 口径维持）。
- **Autodesk APS 云**：硬约束排除（数据不出内网）。

## 影响与后果

- 前端新增依赖 three + occt-import-js（MIT / LGPL-2.1，WASM 动态链接不传染业务代码；打包 three ~600KB gzip + occt wasm ~2.5MB 按需加载——建议动态 import 拆 chunk）。
- 三维通道不投转换队列、不落 preview_artifacts 行——与图片直签一致，运维面零新增。
- 二维转换器镜像（Python 基座 + ezdxf + libredwg + 字体）由 px 线运维落地，M4-06 卡片另行切片；本 ADR 先定架构。
- 风险项：PMI/GD&T 三维标注 occt-import-js 当前不输出（业务确认需要时评估上游 PR 或服务端预转）；50MB+ 装配体性能（Web Worker + LOD，真实大件到位后补测）；libredwg MTEXT 导出 bug（上游 0.14 已修一部分，命中率实测 <3%）。

## 切换触发条件

- 设计部门真实样本大量使用 SHX 大字体导致二维渲染不可读 → 评估 ODA File Converter 替换 libredwg。
- 三维件以 DWG 内嵌 3DSOLID（ACIS）为主 → 三维也走服务端转换（STEP 中转）。
- occt-import-js 上游支持 PMI 导出 → 前端开启 PMI 显示。

## 参考

ADR-007、ADR-008、ADR-030、技术设计 v0.1 §4.8、v0.2 §5.4、M4-06 留痕、docs/adr/ADR-031（本文件）、PoC 报告（M4-06-CAD-PoC报告-真实样本补测.md / ADR-008三维PoC报告.md）