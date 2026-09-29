import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DateRangePicker } from "./DateRangePicker";
import { MultiOptionList, MultiSelectMenu, type SelectOption } from "./SelectMenu";
import { InlineCell, InlineMultiOptionCell, InlineNumberCell, InlineOptionCell, InlineTextCell } from "./InlineEdit";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, TextareaHTMLAttributes } from "react";
import { ISSUE_STATES, type DailyReport, type Issue, type IssueState, type ReportPhoto } from "../data/reports";
import {
  ISSUE_STATE_NAMES,
  REPORT_STATE_NAMES,
  createReport,
  deleteIssue,
  deleteReport,
  fetchProjectIssues,
  fetchProjectReports,
  updateIssue,
  updateReport,
  type IssueUpdateInput,
  type ReportUpdateInput,
  type ReportWriteInput,
} from "../reportApi";
import { ApiError } from "../api";
import { uploadPhoto, usePhotoUrl } from "../fileApi";
import { stageKeyOfName } from "../taskApi";
import { PROJECT_STAGES } from "../data/projects";
import { lockBodyScroll } from "../scrollLock";
import type { DailySubView } from "../useHashRoute";
import { RowDeleteButton } from "./RowDeleteButton";
import { ScrollArea } from "./ScrollArea";
import type { MeResponse, Project } from "../types";

/**
 * 项目详情「日报及问题」视图（Push 128）：页内四块子视图 —— 日报填写 / 日报记录 / 问题追踪 / 问题看板。
 * - 顶部**页内导航栏**按业务给定样张（本批第 4 轮：四个**键帽按钮**（keycap），紧贴主标签栏下方一排）实现，替代原来的统计条；
 *   Tailwind 任意值等价还原样张的 styled-components 口径（浅灰面 + 0.5em 圆角 + em 口径的实心堆叠投影（键帽侧壁）+ 末层柔和落影，
 *   按下 translate 0.225em 并把堆叠压扁），尺寸按「大小不用太大」收紧为 13px 字号，**不引入 styled-components 依赖**。
 *   每项 = 16px 图标 + 单行 13px 文字；**Push 199**：「问题看板」项图标按业务给样（SVG Repo 16×16 面性圆环感叹号，
 *   `fill="currentColor"`）换下原两块竖列描边图标；**Push 200**：「问题追踪」项图标同样按业务给样改为「文件 + 警示圈」
 *   首版实心样（业务看后反馈「不好看」→ 改浅版：文件描边 + 同一套「圆环 + 感叹号」小警示章），导航栏整排加**吸顶**
 *   （`sticky top-16` = 顶栏 64px 正下方，站灰底 + 毛玻璃），日报填写 / 日报记录两项照旧描边；
 *   **Push 201**：图标再对调 —— 原「问题看板」的「圆环 + 感叹号」徽章**让给「问题追踪」**，「问题看板」改业务给样「放大镜」
 *   （24 视框 `fill="currentColor"` + evenodd；同样不照搬：去 SVGRepo 外壳、黑填充改 `currentColor`、缩 16px 与其余图标同高）；
 *   吸顶条随主标签栏吸顶改叠位（`top` 16 → 123px = 顶栏 64 + 主标签栏 59），并加下内衬兜住键帽投影（业务反馈「图二吸顶后有bug」）。
 *   **Push 214**（业务口径「这几个页面也要做路由」）：四块子视图进地址 `?view=daily&sub=form|records|issues|board` ——
 *   中文标签 ↔ slug 映射见下方 `SUB_TAB_KEYS`，当前块由 `ProjectDetail` 从地址派生后透传（本组件不再自持子视图状态），
 *   缺省「日报填写」form 不落参数；提交后自动切「日报记录」= 写回 `sub=records`。
 * - 数据口径承 `系统功能书.md` A3：日报字段 A3-01 / 草稿与补填 A3-02 / 提交校验 A3-04 / 自动生成问题 A3-09 / 问题三态 A3-10（Push 207 业务口径「取消未分组 未分组就是未解决」修订 —— 原四态的四态 → 三态契约修订挂 wmj 线）；处理时限 SLA 见 ADR-026。
 * - 内容列宽：视图整体**全宽**（日报记录 / 问题追踪 / 问题看板 照旧铺满）；只有「日报填写」收成**居中窄栏**
 *   （max-w-3xl = 768px），业务口径「我只要日报填写页面居中然后尺寸舒适一点、像一个表单，其它的不变还是全屏」。
 * - 「日报记录」= **列表 / 表格**（一行一篇；业务口径「日报记录还是做成列表 不要卡片」，原卡片网格已撤），列口径 = 时间
 *   （+ 状态签 + 提交时间）/ 填写者 / 关联阶段 / 当日完成工作 / 明日计划 / 现场工作附图（Push 199 收窄 —— 业务口径
 *   2026-09-28「只保留 填写者 / 关联任务 / 当日完成工作 / 明日计划 / 现场附图」）——「今日施工人数 / 现场发现问题 /
 *   解决方案或建议」三列**不在列表展示**（表单字段 A3-01 与 A3-09 自动生成问题的口径不变）；
 *   与「问题追踪」同一套表壳（白底 + 圆角 + 行悬停），窄屏横向滚动。
 * - 原型阶段数据存浏览器内存（换项目 / 刷新即重置；任务域已接线，本模块随 M4 日报切片接线）：演示数据只挂在示例项目印度 `inmu-0010`，
 *   其余项目从空白开始；「日报填写」提交后**真的会**写进「日报记录」，含「现场发现问题」时按 A3-09 自动生成一条「未解决」问题（Push 207 起三态：未分组并入未解决）。
 * - Push 198（业务口径 2026-09-28「日报这里关联任务改成关联阶段」）：「关联任务」改「**关联阶段**」——
 *   多选项 = 九个施工阶段（`PROJECT_STAGES` 去掉「项目总览」，与任务表 / 看板同一份口径），不再列具体任务 / 负责人；
 *   关联单位由「任务」改「阶段」后，契约层 `taskIds` → `stageKeys` 的修订挂 wmj 线（见 `前端功能需求.md` §3.8 A21），
 *   原 A3-08「按任务回写项目进展描述」的副作用随之停用（落点待口径定案）。
 * - Push 199（业务口径 2026-09-28「日报记录里面不需要体现这两个 以及施工人数」+「只保留 填写者 / 关联任务 /
 *   当日完成工作 / 明日计划 / 现场附图」）：「日报记录」列表收窄为 **6 列** —— 去掉「今日施工人数 / 现场发现问题 /
 *   解决方案或建议」三列（只改**列表展示**：表单字段 A3-01 与 A3-09 问题生成口径不变，问题记录仍照常生成）；
 *   「关联任务」按 Push 198 口径显示为「关联阶段」；时间列保留（一行一篇、按日期倒序，无时间列无法辨认）。
 * - Push 202（业务口径 2026-09-28「填日报文字提示如图分点」+「问题归类可以多选」+「日报记录英文加上 如图所示」
 *   +「时间格式也要年月日 具体提交时间不需要 已提交状态也不要」+「点击暂存草稿就暂存在日报填写页面吧 …
 *   暂存就保留表单里面填的内容皆可」）：
 *   ① 「日报填写」：「当日完成工作Work completed today」「明日计划Tomorrow's plan」「现场发现问题Problem」三个多行框
 *      **补英文表头**；三行分点占位提示（`1:` / `2:` / `3:`）先落、随后业务看后撤回（「算了 不要提示文字了」）——
 *      三个多行框最终**无占位提示文字**、行数回到原口径（下一个改动即此）；「当日完成工作」是 A3-04 必填（星号保留），
 *      图 1 「明日计划」的必填星当时**未采纳**（Push 205 业务口径「明日计划也是必填项」已改必填）；
 *   ② 「问题归类」由单选改**多选**（`SelectMenu.tsx` 新增 `MultiSelectMenu`：弹层点选不关闭、选中项绿勾，
 *      触发器顿号连接已选项）—— 原型存储口径 = 多值顿号连接（`issueCategories` → `issueCategory` 字符串 / `Issue.category`），
 *      `issue_category` 单值 → 多值的契约修订挂 wmj 线（见 `字段对照清单.md` §二.3 增补）；
 *   ③ 「日报记录」表头中英拼写（时间time / 填写者 / 关联阶段Related stages / 当日完成工作Work completed today /
 *      明日计划Tomorrow's plan / 现场工作附图On-site photos）；时间列改**年月日**（如 `2026年9月16日`）、
 *      撤「提交 HH:MM」小字与状态签（草稿 / 已提交 / 补填不再在列表出现；`state` 仍在数据模型里）；
 *   ④ 「暂存草稿」不写「日报记录」、不切子视图、**不清表单** —— 只保留表单里已填内容 + 顶部提示
 *      （业务口径「暂存就保留表单里面填的内容皆可」；原「左侧草稿卡片」方案已撤回）；
 *   ⑤ 撤「现场发现问题」的琥珀色特殊底 / 琥珀字色（业务口径「这个也不用搞特殊 样式和别的保持一致」）——
 *      标签走 FORM_LABEL、说明走灰色小字，与其它字段同一套；
 *   ⑥ 表单字段标题统一**加粗**（业务口径「标题都标标粗」：`FORM_LABEL` 字重 medium → bold；字色口径不变）；
 *   ⑦ **附图以「复制粘贴」为主入口**（业务口径 2026-09-28「附图要可以复制粘贴 不能全靠选择文件 我们以复制粘贴为主」）：
 *      两个附图区（现场工作附图 / 当前问题附图）改 `AttachmentPicker` —— 形态按业务给的样（虚线卡 + 文件 / 云图标）
 *      **左右分半（无说明文字）**：左半 = **剪贴板图标**（Push 204 由键帽改纯文字、Push 212 续再按业务口径「ctrl v 的地方改成这个图标吧」换成 PasteIcon —— 无键帽材质、字色随半区悬停 / 就绪态转深；垂直居中与右半图标中线齐平 —— 业务口径「位置要居中」；点一下，Ctrl+V 直接粘图；截图 / 复制的图片文件都收；
 *      剪贴板图没有名字时按「剪贴板图片-N.png」命名）、右半 = 文件 / 云图标（点击选择文件，次入口，原生文件框仍在）；
 *      左半里放一个不可见的粘贴落点输入框 —— 浏览器只对有可编辑焦点的元素执行 Ctrl+V 粘贴命令，粘贴一律 preventDefault、不落文字；
 *      附件胶囊可逐个移除。
 * - Push 205（业务口径 2026-09-28「这里应该先填发现的问题 才能填另外三个」+「明日计划也是必填项」）：
 *   ① 「现场发现问题」= **前置开关** —— 为空时「问题归类」「当前问题附图」「解决方案或建议」三项**禁用**（灰底 / 灰字 / 点不开，
 *      与「问题归类」原禁用口径同一套）；填了「现场发现问题」三项立即解禁、清空又回禁用；「现场工作附图」不受影响；
 *   ② 「明日计划」改**必填**（A3-04 口径修订：必填 = 时间 + 当日完成工作 + 明日计划，标签补红色必填星）——
 *      服务端契约 / 校验（reports.ts superRefine、库侧成对 CHECK）的同步修订挂 wmj 线。
 * - Push 206（业务口径 2026-09-28「这个日报记录要大一点效果要如图二所示」+「图三还是文字提示改成图四的吧 然后用户填写后换行
 *   填到表格后也要是换行的」）：
 *   ① 「日报记录」整表放大 —— 字号 xs → sm、单元格内边距 py-2.5 → py-4（表头 py-3.5）、表格 min-w 900 → 1080，
 *      行高随多行内容撑开（业务样 = 图 2 的多维表格：行更高、留白更足）；
 *   ② 「当日完成工作 / 明日计划」两列 whitespace-pre-line —— 用户在多行框里按行写（回车换行），填到表格后**按行换行**显示；
 *   ③ 「现场工作附图」列改**大图瓦片**（PhotoStrip 新增 size 档位 lg：约 128×96、多张自动折行、只出图不带文件名 —— 业务样 = 图 2）；
 *   ④ 分点提示（1: / 2: / 3: 三行灰色小字）曾按图 4 落在「当日完成工作」「明日计划」，并随「这个现场问题也要同上」
 *      扩到「现场发现问题」；随后按业务口径「有了自动的扩展 那这个提示就不要了」**整体撤回**（三个框都不留静态提示）；
 *   ⑤ （同批追加 ·「自动添加序号可以做到吗」+「这个现场问题也要同上」）「当日完成工作 / 明日计划 / 现场发现问题」
 *      三个多行框**自动序号** —— 空框聚焦预置 1: 、回车自动带下一行序号（2: / 3: …）、失焦与提交前 "renumberLines"
 *      统一重排（剥旧号 / 去空行 / 重编）；落库即带序号文本，「日报记录」表格里序号 + 换行一并显示；
 *      判定「现场发现问题」是否算填（前置开关）先剥序号 —— 空框只剩「1: 」不算填；
 *   ⑥ （同批再追加 ·「换行很多时要自动下扩」）「日报填写」四个多行框（当日完成工作 / 明日计划 / 现场发现问题 /
 *      解决方案或建议）改 GrowingTextarea**自动下扩** —— 高度随行数长（下限 = 原 rows 行），不再出内滚动条。
 * - Push 207（业务口径 2026-09-28「责任这一栏不需要 删除吧」+「状态改成图二的三种」+「取消未分组 未分组就是未解决」+
 *   「问题归类也要用不同颜色来展示」+「格式参考这种 然后处理时限不需要 所属任务也不需要」+「文字标题参考图五的来」+
 *   「整体列表样式参考图6 项目总览页面」）：问题侧整批改版 ——
 *   ① 「问题追踪」表格重做：列口径 = 业务样「图五」六列（日期 / 问题描述 / 问题归类 / 解决方案或建议 / 问题附图 /
 *      问题是否处理）—— 列头**纯文字**（首版按图五复刻了小图标与排序小漏斗，随后按同批业务口径「这些图标不需要」整体下架）；
 *      撤「责任 / 处理时限 / 所属任务」三列（业务口径「责任这一栏不需要」+
 *      「处理时限不需要 所属任务也不需要」；三个字段仍在数据模型里，只是不展示）；「提出人」并进问题描述列的灰字小行
 *      （图五没有该列，信息不丢）；「问题描述 / 解决方案或建议」按行换行（whitespace-pre-line —— 承接 Push 206 自动序号）；
 *   ② 行样式 = 业务样「图六」（项目总览任务表）：白卡 + 圆角边框 + 列头 `bg-zinc-50 text-xs font-medium text-zinc-400`
 *      + 行 `px-5 py-2.5` + `divide-zinc-100` 细分割线 + 行悬停 `hover:bg-zinc-50/80`（Push 217 整表比例对齐「日报记录」—— 内边距 px-4 / py-4 / 表头 py-3.5 / 动作列 w-20，见本文件头 Push 217 条）；
 *   ③ 状态三态（业务样「图二」·「状态改成图二的三种」）：未分组并入未解决 —— `ISSUE_STATES` = 未解决 / 处理中 / 已完成；
 *      色签 = 项目总览「任务状态」同款（同批业务口径「这个问题的状态想要和项目总览里面的状态样式同款」）：
 *      未解决 = 待开始 `bg-sky-100 text-sky-700` / 处理中 = 进行中 `bg-amber-100 text-amber-800` /
 *      已完成 `bg-emerald-100 text-emerald-700`（色值 / 圆角 / 内距直接对齐 TaskBoard 的 STATUS_CAPSULE_CLASS 同名档）；
 *      问题看板四列 → **三列**（空列保留）；新建问题初始态 = 未解决；「未分组」字样从问题域整体下线
 *      （四态 → 三态的契约 / 库侧修订挂 wmj 线，见 `系统功能书.md` A3-10 与 `前端功能需求.md` §6.12）；
 *   ④ 问题归类彩色胶囊（业务样「图三 / 图四」·「问题归类也要用不同颜色来展示」）：机械部 `#adcbff` /
 *      采购部 · 项目部 `#ade4ff` / 规划部 `#ace2c5` / 物流原因 `#dcdfe4` / 供应商原因 `#ffea99` / 客户原因 `#ffb5b3` /
 *      客观原因 `#e7b4ff` / 生产原因 `#ffb3dc` / 其它原因 `#ffcea3`（浅底 + 深字）；多选值按「、」拆开逐枚出签，
 *      未知值 / 空值回落浅灰；
 *   ⑤ 「问题附图」列（新增数据面）：`Issue.photos` —— 来源 = 日报「当前问题附图」（提交时带入问题记录），
 *      列里出 40×40 缩略图（点开看大图 · PhotoStrip 新增 `md` 档位）、空 = 「—」；演示问题补内联 SVG 占位图；
 *   ⑥ （同批追加 ·「这个也要1 2 3 同上」）「解决方案或建议」并进自动序号一套 —— 解禁后空框聚焦预置 1: 、
 *      回车续号（2: / 3: …）、失焦与提交前 "renumberLines" 重排（与上三个多行框同一套口径）。
 *   ⑦ （同批追加 ·「增加项目总览 同款醒目模式在问题追踪里面」+「醒目模式放在标签导航栏的最右侧」）「问题追踪」接**醒目模式**——
 *      开关本体由 ProjectDetail 渲染在**标签栏最右侧**（与项目总览同一枚 `FocusModeToggle`、同一个账号偏好；
 *      本视图没有列显隐按钮，它就落在最右），本组件只吃 `focusMode` 布尔做表格呈现：开 = 问题表整行铺该问题状态的
 *      底色 —— 未解决 = 天蓝 sky / 处理中 = 琥珀 amber / 已完成 = emerald，同样压到 **6% 不透明度**、
 *      行悬停抬到 **12%**（与项目总览任务表同一套马卡龙口径），状态列同时收口 = 撤色签底、只留深色字（加粗、透明底）；
 *      关掉 = 行还原（白底 + 行悬停灰）、状态列回「项目总览同款」色签胶囊。
 * - Push 208（业务口径 2026-09-28「问题追溯里面也要可以这样编辑 文字 以及问题归类都要可以修改 文字修改需要点击保存
 *   编辑后时间不变 日报记录同理」）：两块表接**行内编辑**（复用项目总览那套 InlineEdit，业务样 = 项目总览状态列的行内下拉）——
 *   ① 「问题追踪」：**问题描述 / 解决方案或建议**（文字列）= InlineTextCell 多行框 —— **点「保存」才落值**（Esc / 点浮层外 =
 *      取消，原值不动）；**问题归类** = InlineMultiOptionCell（与「问题归类」表单侧同款多选：绿勾选中项、点选不收浮层、
 *      再点取消，落值仍按「、」连接）；**问题是否处理** = InlineOptionCell 三态下拉（色签同项目总览，醒目模式下只留深色字）；
 *   ② 「日报记录」：「当日完成工作 / 明日计划」两列同款文字编辑（业务口径「日报记录同理」）；
 *   ⑤ 「日报记录」的**关联阶段**同批追加行内编辑（业务口径 2026-09-28「这个也要可以编辑筛选选择」）——
 *      浮层 = 与「日报填写」表单侧完全同款的九阶段勾选清单（勾选不收浮层 · 值仍是同一份 REPORT_STAGES 口径）；
 *   ⑥ 关联阶段「显示态」也出彩色色签（同日追加 · 业务口径 2026-09-28「显示也要有颜色」）：StageTags 逐枚出签、
 *      与浮层共用同一张九阶段色表，空值 = 「—」灰字（问题归类显示态色签见 ④，两处同款）。
 *   ③ 「编辑后时间不变」：日期 / 提出日期列**不参与编辑**（单元格里没有可点目标），patch 也从不写 date / raisedAt /
 *      submittedAt —— 改完文字时间列原样；文字列保存前统一过一遍自动序号（renumberLines，与「日报填写」提交口径一致）；
 *   ④ 编辑落原型内存态（setReports / setIssues）：刷新 / 换项目即复位；字段级 PATCH 接口的契约挂 wmj 线。
 *
 * - Push 210（业务口径 2026-09-28「卡片要可以拖动」）：问题看板卡片接**指针拖动**（与「任务进展」看板 Push 108 / 156
 *   同一套口径）—— 按住卡片位移超过 4px = 拖动（没超过 = 点一下开问题详情抽屉）；拖动中卡片跟手（半透明拖动卡 ·
 *   data-drag-ghost）、目标列描边高亮 + 列顶浮出落点槽「放开：移到「X」」，拖到看板 / 列边缘逐帧自动滚；
 *   放开 = 把问题状态改成目标列（同一 patchIssue 内存态：「问题追踪」表 / 计数 / 抽屉同步跟着变）；
 *   同列不是落点（问题没有列内顺序，放开不改动）；Esc / 指针取消 = 原地取消；整段拖动没有原生拖拽参与，滚轮照常可用。
 *
 * - Push 211（业务口径 2026-09-28「要加问题描述标题」）：问题看板**卡面首段补字段名「问题描述」** ——
 *   与其余三段（问题归类 / 解决方案或建议 / 问题附图）同款 11px 浅灰小字；首段不带上间距（Field 增 first 变体）；
 *   「问题追踪」表头 / 问题详情抽屉的「问题描述」口径照旧，三处一致。
 *
 * - Push 212（业务口径 2026-09-28「只保留关联阶段 且不需要隐藏」）：问题详情抽屉**撤「已隐藏 · N」折叠区** ——
 *   中间区只留「关联阶段」一行、改常显（无折叠开关）；其余五枚次要字段整体下架（提出人在抽屉头部已有、
 *   来源日报在页脚已有；提交时间 / 日报状态 / 问题编号不再展示）。
 *   同批（业务口径「抽屉里面可以编辑内容」）：抽屉内**两块表能编辑的字段同样可编辑** —— 问题描述 / 问题归类 /
 *   解决方案或建议 / 关联阶段 / 当日完成工作 / 明日计划 / 问题是否处理（同一套 InlineEdit 组件与落值口径）。
 *   续（业务口径「图片也要可以增删」）：两张附图（问题附图 / 现场工作附图）接 AttachmentPicker —— 复制粘贴 / 选文件**增图**、
 *   × **删图**（与「日报填写」同一套组件与钩子），落 value 走 patchIssue / patchReport 的 photos 字段。
 *
 * - Push 213（业务口径 2026-09-28「日报记录 和 问题追随都要有删除按钮 和之前的删除同款 请你看看有没有合适的位置
 *   这两个任意删除谁都是关联的 都会导致双方都删除 因为他们本质是同一个日报」）：两块表**行尾各加一列动作列**
 *   （固定 48px 槽位 + 同款 RowDeleteButton —— 静止 24px 幽灵态随行悬停浮现、悬停展开 48px 红胶囊「删除」），
 *   槽位是**预留**的：展开只在槽内长大，列宽 / 表宽一格不动（业务反馈「鼠标触碰表格会动」）。
 *   删除语义 = **按「同一篇日报」整组删**：删日报 = 连它派生的全部问题；删问题 = 连它来源的那篇日报；
 *   无派生问题的日报 / 无来源日报的问题只删自己（纯前端内存态，服务端 DELETE 契约挂 wmj 线）。
 *
 * - Push 217（业务口径 2026-09-29「问题追踪的卡片比例也要和日报记录的相同」+「现场工作附图放在明日计划填写下面」）：
 *   ① 「问题追踪」整表**比例对齐「日报记录」**（Push 206 放大后的同一套行列尺寸）—— 列内边距 px-5 → px-4、
 *      单元格 py-2.5 → py-4（表头 px-4 py-3.5）、表头字号 xs → sm（text-zinc-500）、行补 align-top、
 *      行尾动作列 w-[88px] → w-20（px-4×2 + 48 = 80，同「日报记录」槽位）；**「问题附图」列同批改大图瓦片**
 *      （md 40×40 → lg 约 128×96、列 min-w 130 → 440 —— 业务口径「这比例完全不一样啊 包括图片」）；列口径 / 交互不变；
 *   ② 「日报填写」表单**「现场工作附图」整块移到「明日计划」正下方**（原排「解决方案或建议」之后）——
 *      字段集 / 必填口径 / 自动序号 / 前置开关等交互不变，只调块序；
 *   ③ 表格间距收口（业务口径「问题归类去左侧一些这个间距不协调」+「这个在表格里面始终居中」）：
 *      「问题描述」列 min-w-[320px] → min-w-[240px]（描述与「问题归类」之间的空档收窄，归类列及其后各列随之前移）、
 *      「问题是否处理」列单元格 text-center（状态色签在列内**始终水平居中**，三态 / 醒目模式 / 行内改后同款）；
 *   ④ 「问题归类」色签不裁剪（业务口径「会出现截断的问题」）：行内编辑壳 `InlineCell` 加 `wrapContent` 档 ——
 *      「问题追踪」表与问题详情抽屉的归类单元格撤包裹层 `truncate` 裁剪（窄窗 / 列被挤到最小时色签不再被裁掉一角），
 *      色签折行与触发器内衬等其余表现不变；
 *   ⑤ **图片预览层修复**（业务口径「抽屉中点击图片也要居中显示」+「从看板里面点了图片 再从抽屉点图片怎么是这样的 bug」）：
 *      预览层 portal 到 body、图幅上限 min(90vw, calc(100vw - 3rem))、预览层与缩略图的 click / pointerdown 止冒泡、
 *      Esc 捕获阶段只关预览层（根因与口径逐条见 PhotoPreview 头注）；
 *   ⑥ 问题详情抽屉「施工人数」**空值出杠 + 行内可编辑**（业务口径「空用杠来表示 和之前项目总览的抽屉一样」+
 *      「施工人数抽屉也要可以编辑」）：`headcount` 为 null 时不再渲染字面量「null」，与「项目总览」任务详情抽屉同款出
 *      text-zinc-300 的 —；并接 `InlineNumberCell`（项目总览任务表同款：点开浮层 / 0 以上的整数 / 带「人」后缀 /
 *      落值即收浮层），落值走 `PATCH …/reports/{id}` 的 headcount（null = 清空）。
 */

/** 行内编辑能改的日报字段（Push 208 · 业务口径「日报记录同理」+ 追加「这个也要可以编辑筛选选择」）：
 *  文字两列 + 关联阶段多选 —— 时间 / 填写者不动（「编辑后时间不变」）。
 *  Push 212 续（业务口径「图片也要可以增删」）：追加**现场工作附图**（photos）—— 抽屉里与两列文字共用同一份 patchReport 内存态。
 *  Push 217 续⑥（业务口径「施工人数抽屉也要可以编辑」）：追加**施工人数**（headcount，契约 number | null，null = 清空）。 */
export type ReportPatch = Partial<Pick<DailyReport, "doneWork" | "plan" | "stageNames" | "photos" | "headcount">>;

/** 行内编辑能改的问题字段（Push 208）：问题描述 / 问题归类 / 解决方案或建议 / 问题状态 —— 日期不动（「编辑后时间不变」）。
 *  Push 212 续：追加**问题附图**（photos）。 */
export type IssuePatch = Partial<Pick<Issue, "title" | "categories" | "solution" | "state" | "photos">>;

/** 卡片外壳（与两块任务看板同一套材质：白壳 + 发丝边 + 三层投影）。 */
const CARD_SHELL =
  "relative block w-full rounded-[35px] border border-zinc-900/[0.07] bg-white p-[9px] text-left transition " +
  "[box-shadow:0_18px_40px_-20px_rgba(15,23,42,0.18),0_4px_14px_-8px_rgba(15,23,42,0.06),inset_0_-2px_6px_rgba(15,23,42,0.05)]";

/** 细纹叠加（同两块看板：白壳上透明度收到 6%）。 */
const CARD_NOISE =
  "pointer-events-none absolute inset-0 rounded-[35px] opacity-[0.06] [filter:contrast(105%)] " +
  "bg-[repeating-conic-gradient(#e8e8e8_0.0000001%,#93a1a1_0.000104%)] [background-position:60%_60%] [background-size:600%_600%]";

/** 卡片内容区（Push 106 口径：只保留外框，内容直接落在壳上）。 */
const CARD_BODY = "relative px-4 py-3.5";

/** 拖动卡片用的半透明壳（与「任务进展」看板同一套：拖动中跟手的那张卡）。 */
const ISSUE_CARD_SHELL_GHOST =
  "relative block w-full rounded-[35px] border border-zinc-900/[0.07] bg-white/[0.6] p-[9px] text-left backdrop-blur-[5px] backdrop-saturate-150 " +
  "[box-shadow:0_18px_40px_-20px_rgba(15,23,42,0.18),0_4px_14px_-8px_rgba(15,23,42,0.06),inset_0_-2px_6px_rgba(15,23,42,0.05)]";

/** 拖动判定阈值（Push 210 · 与「任务进展」看板同一套）：按下后位移不超过这么多像素 = 「点一下看详情」。 */
const DRAG_THRESHOLD = 4;

/** 拖卡片到边缘 = 看板跟着滚（Push 210 · 同「任务进展」Push 156）：进边缘 DRAG_EDGE_PX 内逐帧滚，越深越快。 */
const DRAG_EDGE_PX = 72;
const DRAG_EDGE_MAX_SPEED = 16;

/** 边缘自动滚的速度：按深入边缘的程度 1~16px/帧。 */
function dragEdgeScrollSpeed(depth: number): number {
  return Math.min(Math.max((depth / DRAG_EDGE_PX) * DRAG_EDGE_MAX_SPEED, 1), DRAG_EDGE_MAX_SPEED);
}

/** ScrollArea 的滚动视口（组件内部那层带 data-scroll-area 的 div）—— 按轴找它。 */
function dragScrollAreaViewport(root: ParentNode | null, axis: "horizontal" | "vertical"): HTMLElement | null {
  if (root === null) {
    return null;
  }
  const node = root.querySelector('[data-scroll-area="' + axis + '"]');
  return node instanceof HTMLElement ? node : null;
}

/** 点 (x, y) 落在哪一列问题上（没有 = null）。 */
function dragColumnAtPoint(x: number, y: number): Element | null {
  const under = document.elementFromPoint(x, y);
  return under === null ? null : under.closest("[data-issue-column]");
}

/** 拖卡片到边缘时的逐帧自动滚（Push 210）：横向滚看板本体、纵向滚指针底下那一列（列内列表也是 ScrollArea）。 */
function autoScrollIssueDrag(root: HTMLElement | null, point: { x: number; y: number }): void {
  const viewport = dragScrollAreaViewport(root, "horizontal");
  if (viewport !== null) {
    const rect = viewport.getBoundingClientRect();
    if (point.y >= rect.top - 24 && point.y <= rect.bottom + 24) {
      if (point.x < rect.left + DRAG_EDGE_PX) {
        viewport.scrollLeft -= dragEdgeScrollSpeed(rect.left + DRAG_EDGE_PX - point.x);
      } else if (point.x > rect.right - DRAG_EDGE_PX) {
        viewport.scrollLeft += dragEdgeScrollSpeed(point.x - (rect.right - DRAG_EDGE_PX));
      }
    }
  }
  const under = document.elementFromPoint(point.x, point.y);
  const column = under === null ? null : under.closest("[data-issue-column]");
  const list = dragScrollAreaViewport(column, "vertical");
  if (list === null) {
    return;
  }
  const rect = list.getBoundingClientRect();
  if (point.y < rect.top + DRAG_EDGE_PX) {
    list.scrollTop -= dragEdgeScrollSpeed(rect.top + DRAG_EDGE_PX - point.y);
  } else if (point.y > rect.bottom - DRAG_EDGE_PX) {
    list.scrollTop += dragEdgeScrollSpeed(point.y - (rect.bottom - DRAG_EDGE_PX));
  }
}

/** 问题三态色签（Push 207 · 业务样 = 图二「状态改成图二的三种」；同批再按业务口径「这个问题的状态想要
 *  和项目总览里面的状态样式同款」对齐「项目总览」任务状态胶囊 —— 底色 / 字色直取 TaskBoard 的
 *  STATUS_CAPSULE_CLASS 同名档：未解决 = 待开始 蓝 bg-sky-100 text-sky-700 / 处理中 = 进行中 琥珀
 *  bg-amber-100 text-amber-800 / 已完成 = emerald 绿 bg-emerald-100 text-emerald-700）；
 *  原四态色签（未分组灰 / 未解决红 / 处理中琥珀 / 已完成绿）随「取消未分组 未分组就是未解决」改版下架，
 *  首版实色三态（#ade4ff / #feca04 / #dcdfe4）随本口径下架。 */
const ISSUE_TAG_CLASS: Record<IssueState, string> = {
  open: "bg-sky-100 text-sky-700",
  in_progress: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-700",
};

/** 醒目模式（Push 207 同批追加 ·「增加项目总览 同款醒目模式在问题追踪里面」）的整行底色：与项目总览任务表的
 *  STATUS_ROW_CLASS 同一套口径 —— 状态色系压到 **6% 不透明**、行悬停抬到 **12%**；三态色系对照 =
 *  未解决 / sky（项目总览「待开始」）、处理中 / amber（「进行中」）、已完成 / emerald（「已完成」）。 */
const ISSUE_ROW_CLASS: Record<IssueState, string> = {
  open: "bg-sky-500/[0.06] hover:bg-sky-500/[0.12]",
  in_progress: "bg-amber-500/[0.06] hover:bg-amber-500/[0.12]",
  done: "bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12]",
};

/** 醒目模式下的状态字色：整行已有状态色，撤色签底只留深色字（同 TaskBoard 的 STATUS_TAG_TEXT_CLASS 口径）。 */
const ISSUE_TAG_TEXT_CLASS: Record<IssueState, string> = {
  open: "text-sky-700",
  in_progress: "text-amber-800",
  done: "text-emerald-700",
};

/** 问题归类色签（Push 207 · 业务样 = 图三 / 图四「问题归类也要用不同颜色来展示」）：浅底 + 深字，
 *  色值取自业务样 —— 机械部 #adcbff / 采购部 · 项目部 #ade4ff / 规划部 #ace2c5 / 物流原因 #dcdfe4 /
 *  供应商原因 #ffea99 / 客户原因 #ffb5b3 / 客观原因 #e7b4ff / 生产原因 #ffb3dc / 其它原因 #ffcea3；
 *  未收录 / 空值回落浅灰。多选值（「、」连接）按分类拆开逐枚出签。 */
const ISSUE_CATEGORY_CLASS: Record<string, string> = {
  机械部: "bg-[#adcbff]",
  采购部: "bg-[#ade4ff]",
  规划部: "bg-[#ace2c5]",
  项目部: "bg-[#ade4ff]",
  物流原因: "bg-[#dcdfe4]",
  供应商原因: "bg-[#ffea99]",
  客户原因: "bg-[#ffb5b3]",
  客观原因: "bg-[#e7b4ff]",
  生产原因: "bg-[#ffb3dc]",
  其它原因: "bg-[#ffcea3]",
};

/** 问题归类色签组（契约多值数组逐枚渲染；空数组 = 「未归类」灰签）。 */
function CategoryTags({ values }: { values: readonly string[] }) {
  const items = values.length === 0 ? ["未归类"] : values;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((item, index) => (
        <span
          key={item + "#" + String(index)}
          data-issue-category={item}
          className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 " + (ISSUE_CATEGORY_CLASS[item] ?? "bg-zinc-100")}
        >
          {item}
        </span>
      ))}
    </span>
  );
}

/** 关联阶段色签（Push 208 追加 · 业务口径「要有颜色 两处」· 业务样 = 九阶段各一档浅色）：
 *  售前规划 #adcbff / 设计开发 #ade4ff / 加工采购 #dcdfe4 / 组装发货 #ffb5b3 / 硬件实施 #ace2c5 /
 *  软件部署 #ffcea3 / 试运行 #ffea99 / 生产阶段 #e7b4ff / 验收 #ffb3dc —— 与「问题归类」共用同一张调色盘。 */
const STAGE_TAG_CLASS: Record<string, string> = {
  售前规划: "bg-[#adcbff]",
  设计开发: "bg-[#ade4ff]",
  加工采购: "bg-[#dcdfe4]",
  组装发货: "bg-[#ffb5b3]",
  硬件实施: "bg-[#ace2c5]",
  软件部署: "bg-[#ffcea3]",
  试运行: "bg-[#ffea99]",
  生产阶段: "bg-[#e7b4ff]",
  验收: "bg-[#ffb3dc]",
};

/** 关联阶段色签组（Push 208 追加 · 业务口径 2026-09-28「显示也要有颜色」）：多选值逐枚出签，与浮层
 *  小签同一张色表；空值 = 「—」灰字（与列内其它空态一致）。 */
function StageTags({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <span className="text-zinc-300">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {names.map((item, index) => (
        <span key={item + "#" + String(index)} data-report-stage={item}
          className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 " + (STAGE_TAG_CLASS[item] ?? "bg-zinc-100")}>
          {item}
        </span>
      ))}
    </span>
  );
}

/** 浮层里的小色签（Push 208 追加）：问题归类 / 关联阶段两个多选浮层的选项都按各自的色表出签。 */
function tagChip(name: string, tagClass: string) {
  return <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 " + tagClass}>{name}</span>;
}

/** 问题归类的小色签（浮层用；与表内 CategoryTags 同一张色表）。 */
const categoryChip = (name: string) => tagChip(name, ISSUE_CATEGORY_CLASS[name] ?? "bg-zinc-100");

/** 关联阶段的小色签（浮层用）。 */
const stageChip = (name: string) => tagChip(name, STAGE_TAG_CLASS[name] ?? "bg-zinc-100");
/** 问题状态色签（一处出签：追踪表「问题是否处理」列 + 看板卡片 / 列头共用）。Push 207 追加：壳体与「项目总览」
 *  任务状态胶囊同款（rounded-lg + px-3 py-1.5 + text-[11px] font-medium —— 项目总览侧是可点下拉、悬停深一档；
 *  静态签不挂悬停加深，其余逐项对齐）。`focus` = 醒目模式（仅追踪表传 true）：整行已铺状态底色，色签收口成
 *  只留深色字（透明底 + 加粗 —— 同 TaskBoard 醒目模式状态列口径）；看板卡片 / 列头不传 = 胶囊照旧。 */
function IssueStateTag({ state, focus = false }: { state: IssueState; focus?: boolean }) {
  return (
    <span
      data-issue-state={state}
      className={
        "inline-block " +
        (focus
          ? "text-xs font-semibold " + ISSUE_TAG_TEXT_CLASS[state]
          : "rounded-lg px-3 py-1.5 text-[11px] font-medium " + ISSUE_TAG_CLASS[state])
      }
    >
      {ISSUE_STATE_NAMES[state]}
    </span>
  );
}

/** 问题状态行内下拉的可选项（Push 208）：与「项目总览」任务状态同款 —— 弹层里每项 = 该状态的色签胶囊。 */
const ISSUE_STATE_OPTIONS: SelectOption[] = ISSUE_STATES.map((state) => ({
  value: state,
  label: <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + ISSUE_TAG_CLASS[state]}>{ISSUE_STATE_NAMES[state]}</span>,
}));
/** 问题追踪列头（Push 207 · 业务样 = 图五）：六列**纯文字列名**（同批业务口径 2026-09-28「这些图标不需要」——
 *  首版列头曾带日历 / A 字 / 分栏 / 图片 / 对勾圈小图标与排序小漏斗，随后按上面口径整体下架）。 */
const ISSUE_TABLE_COLUMNS: readonly { key: string; label: string }[] = [
  { key: "date", label: "日期" },
  { key: "title", label: "问题描述" },
  { key: "category", label: "问题归类" },
  { key: "solution", label: "解决方案或建议" },
  { key: "photos", label: "问题附图" },
  { key: "state", label: "问题是否处理" },
];

/** 问题看板列壳（Push 209 改版 · 业务口径「样式参考任务进展的」）：与「任务进展」看板**同一套列壳** —— 原灰底面板
 *  （白底 + 圆角 + 描边）整体下架，列 = 纯列容器（280px 宽、铺满视口、上限 52rem、下限 22rem）；列内 / 列间滚动条
 *  都走 ScrollArea 的隐式口径（原生滚动条隐藏，滚动 / 悬停才浮出自绘滑块）。 */
const ISSUE_COLUMN = "flex h-[calc(100vh-12.75rem)] max-h-[52rem] min-h-[22rem] w-[280px] shrink-0 flex-col";

/** 问题归类（C9 字典「问题归类」取值，口径见技术设计 v0.2 §6）。 */
const ISSUE_CATEGORIES: readonly string[] = [
  "机械部",
  "采购部",
  "规划部",
  "项目部",
  "物流原因",
  "供应商原因",
  "客户原因",
  "客观原因",
  "生产原因",
  "其它原因",
];

/** 日报「关联阶段」可选项（Push 198）：九个施工阶段 —— 与项目总览分组 / 两块看板同一份口径（不含「项目总览」汇总视图）。 */
const REPORT_STAGES: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/** 表单小框（与任务表行内编辑同一套「白底 + 淡灰描边」口径）。 */
const FORM_INPUT =
  "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400";

/** 表单字段名（浅灰小字；Push 202「标题都标标粗」—— 字重 medium → bold）。 */
const FORM_LABEL = "text-xs font-bold text-zinc-500";

/** 行内编辑触发器 · 文字列（Push 208）：静息 = 文字原样（无白底无描边），悬停给一层淡色可点提示；
 *  -mx-1.5 -my-0.5 与 px-1.5 py-0.5 相抵 —— 文字位置 / 行高与静态展示逐像素对齐，不给表格加高度。 */
const CELL_EDIT_TEXT = "w-full -mx-1.5 -my-0.5 justify-start rounded-lg px-1.5 py-0.5 text-left hover:bg-zinc-900/[0.04]";

/** 行内编辑触发器 · 色签列（Push 208）：问题归类 / 问题状态用 —— 触发器贴着内容（不满宽），四周留 2px 可点外沿。 */
const CELL_EDIT_CHIP = "-m-0.5 rounded-lg p-0.5 hover:bg-zinc-900/[0.04]";


/** 行首序号（自动序号用：1: / 2. / 3、/ 4：都算 —— 重排时先剥掉，再统一按 1: / 2: / 3: 编）。 */
const LINE_NUMBER_HEAD = /^[ 　]*[0-9]+[ 　]*[:：.、．][ 　]*/;

/** 「自动序号」重排（Push 206 续 · 业务口径「自动添加序号可以做到吗」）：剥掉各行行首序号 → 去空行 → 按 1: / 2: / 3: 重编；
 *  空文本 / 全是空行 → 空串（只聚焦自动预置的「1: 」不算有效内容，失焦即还原为空）。 */
function renumberLines(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.replace(LINE_NUMBER_HEAD, "").trim())
    .filter((line) => line !== "");
  return lines.map((line, index) => String(index + 1) + ": " + line).join("\n");
}

/** 主按钮（提交日报）。 */
const BTN_PRIMARY =
  "rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300";

/** 次按钮（暂存草稿）—— Push 202：悬停反馈加明显（业务口径「鼠标放到暂存草稿的ui效果不太明显」）：描边 200 → 400、
 *  背景压到站内次按钮同一档 `hover:bg-zinc-100`、字色转深；禁用态照旧灰字、悬停不再变面。 */
const BTN_SECONDARY =
  "rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:border-zinc-200 disabled:hover:bg-white disabled:hover:text-zinc-300";

/** 页内导航栏的四块子视图（业务口径：第一块日报填写、第二块日报记录、第三块问题追踪、第四块问题看板）。 */
type SubTab = "日报填写" | "日报记录" | "问题追踪" | "问题看板";

const SUB_TABS: readonly SubTab[] = ["日报填写", "日报记录", "问题追踪", "问题看板"];

/**
 * 中文标签 ↔ 地址 slug（Push 214 · 业务口径「这几个页面也要做路由」）：四块子视图进地址 `?view=daily&sub=`，
 * 与主标签栏 `?view=` 同一套「地址即状态」口径 —— 刷新 / 收藏 / 分享 / 上次后退都能停在原块；
 * 缺省「日报填写」= form 不落参数（旧链接 `?view=daily` 原样打开 = 日报填写）。
 */
const SUB_TAB_KEYS: Record<SubTab, DailySubView> = {
  日报填写: "form",
  日报记录: "records",
  问题追踪: "issues",
  问题看板: "board",
};

/** 导航项图标（按钮内统一 16px 图标 + 单行文字）；「日报填写」「日报记录」描边 1.8px；两个「问题*」项各有一枚徽章：
 *  「问题追踪」= Push 199 业务给的 16×16「圆环 + 感叹号」面性样（`fill="currentColor"`）—— Push 201 由「问题看板」让位而来
 *   （Push 200 那版「文件 + 警示圈」下架：业务口径「把问题看板的svg给问题追溯」）；
 *  「问题看板」= Push 201 业务给样「放大镜」（SVGRepo 24 视框）—— **不照搬**：去外壳、黑填充改 `fill="currentColor"`，
 *   `fillRule/clipRule="evenodd"` 保内孔，缩 16px 与其余图标同高（业务口径「问题看板的svg 改成这个」）。 */
const SUB_TAB_ICON: Record<SubTab, ReactNode> = {
  日报填写: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
      <path d="M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6h4.75" />
    </svg>
  ),
  日报记录: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <path d="M13.5 3H6.75A1.75 1.75 0 005 4.75v14.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0019 19.25V8.5L13.5 3z" />
      <path d="M13.5 3v4.75c0 .414.336.75.75.75H19" />
      <path d="M8.75 13h6.5M8.75 16.5h6.5" />
    </svg>
  ),
  问题追踪: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M7.493 0.015C7.442 0.021 7.268 0.039 7.107 0.055C5.234 0.242 3.347 1.208 2.071 2.634C0.66 4.211 -0.057 6.168 0.009 8.253C0.124 11.854 2.599 14.903 6.11 15.771C8.169 16.28 10.433 15.917 12.227 14.791C14.017 13.666 15.27 11.933 15.771 9.887C15.943 9.186 15.983 8.829 15.983 8C15.983 7.171 15.943 6.814 15.771 6.113C14.979 2.878 12.315 0.498 9 0.064C8.716 0.027 7.683 -0.006 7.493 0.015M8.853 1.563C9.967 1.707 11.01 2.136 11.944 2.834C12.273 3.08 12.92 3.727 13.166 4.056C13.727 4.807 14.142 5.69 14.33 6.535C14.544 7.5 14.544 8.5 14.33 9.465C13.916 11.326 12.605 12.978 10.867 13.828C10.239 14.135 9.591 14.336 8.88 14.444C8.456 14.509 7.544 14.509 7.12 14.444C5.172 14.148 3.528 13.085 2.493 11.451C2.279 11.114 1.999 10.526 1.859 10.119C1.618 9.422 1.514 8.781 1.514 8C1.514 6.961 1.715 6.075 2.16 5.16C2.5 4.462 2.846 3.98 3.413 3.413C3.98 2.846 4.462 2.5 5.16 2.16C6.313 1.599 7.567 1.397 8.853 1.563M7.706 4.29C7.482 4.363 7.355 4.491 7.293 4.705C7.257 4.827 7.253 5.106 7.259 6.816C7.267 8.786 7.267 8.787 7.325 8.896C7.398 9.033 7.538 9.157 7.671 9.204C7.803 9.25 8.197 9.25 8.329 9.204C8.462 9.157 8.602 9.033 8.675 8.896C8.733 8.787 8.733 8.786 8.741 6.816C8.749 4.664 8.749 4.662 8.596 4.481C8.472 4.333 8.339 4.284 8.04 4.276C7.893 4.272 7.743 4.278 7.706 4.29M7.786 10.53C7.597 10.592 7.41 10.753 7.319 10.932C7.249 11.072 7.237 11.325 7.294 11.495C7.388 11.78 7.697 12 8 12C8.303 12 8.612 11.78 8.706 11.495C8.763 11.325 8.751 11.072 8.681 10.932C8.616 10.804 8.46 10.646 8.333 10.58C8.217 10.52 7.904 10.491 7.786 10.53Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  ),
  问题看板: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.5 17c1.71 0 3.287-.573 4.55-1.537l4.743 4.744a1 1 0 0 0 1.414-1.414l-4.744-4.744A7.5 7.5 0 1 0 9.5 17zM15 9.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"
        fill="currentColor"
      />
    </svg>
  ),
};

/**
 * 页内导航栏按钮材质（本批第 4 轮：按业务新样张换成**键帽按钮**（keycap），等价还原样张的 styled-components 口径，
 * 不引入 styled-components 依赖）：
 * - 面 = **白**（业务口径「灰色的不太好看，我想不点击也是问题看板这个时候的颜色」：静止态一律白面，不再用样张的浅灰
 *   `#f0f0f0`）+ `border-radius: 0.5em` + `text-shadow: 0 0.0625em 0 #fff`（样张 button）；
 * - 立体 = 样张那串**实心堆叠投影**（`0 .0625em #efefef` → `0 .425em #cacaca`，共 7 层当键帽侧壁）+ 末层柔和落影
 *   `0 0.425em 0.5em #cecece`；全部用 em，字号一改整套厚度自动跟着缩；
 * - 按下 = `translate: 0 0.225em` + 堆叠压扁（样本 `button:active`），`transition: 0.15s ease`；
 * - 尺寸按「大小不用太大」收紧：13px 字号（`padding: 0.375em 1em`）+ 16px 图标，不再占满整行；
 * - 当前项与未选项**面一致（都是白）**，靠文字区分：当前项 = 黑字 700、未选项 = 中灰字 600（悬停转深）。
 */
const SUBNAV_KEY =
  "relative inline-flex shrink-0 select-none items-center gap-1.5 rounded-[0.5em] px-[1em] py-[0.375em] text-[13px] leading-none transition-all duration-150 ease-out [text-shadow:0_0.0625em_0_#fff] active:translate-y-[0.225em]";

/** 未选中：**白键帽**（业务口径「灰色的不太好看，我想不点击也是问题看板这个时候的颜色」—— 静止态一律白面，
 *   不再用样张的浅灰面）+ 中灰字；悬停面微压暗、字色转深，按下走样张的压扁口径。 */
const SUBNAV_KEY_IDLE =
  "bg-white font-semibold text-zinc-600 hover:bg-[#fafafa] hover:text-zinc-900 " +
  "[box-shadow:inset_0_0.0625em_0_0_#ffffff,0_0.0625em_0_0_#f2f2f2,0_0.125em_0_0_#ededed,0_0.25em_0_0_#e2e2e2,0_0.3125em_0_0_#dedede,0_0.375em_0_0_#dcdcdc,0_0.425em_0_0_#cacaca,0_0.425em_0.5em_0_#cecece] " +
  "active:[box-shadow:inset_0_0.03em_0_0_#ffffff,0_0.03em_0_0_#f2f2f2,0_0.0625em_0_0_#ededed,0_0.125em_0_0_#e2e2e2,0_0.125em_0_0_#dedede,0_0.2em_0_0_#dcdcdc,0_0.225em_0_0_#cacaca,0_0.225em_0.375em_0_#cecece]";

/** 选中（当前子视图）：同样是白键帽，靠**黑字加粗（字重 700）** 区分（面与未选项一致）。 */
const SUBNAV_KEY_CURRENT =
  "bg-white text-zinc-900 [font-weight:700] " +
  "[box-shadow:inset_0_0.0625em_0_0_#ffffff,0_0.0625em_0_0_#f2f2f2,0_0.125em_0_0_#ededed,0_0.25em_0_0_#e2e2e2,0_0.3125em_0_0_#dedede,0_0.375em_0_0_#dcdcdc,0_0.425em_0_0_#cacaca,0_0.425em_0.5em_0_#cecece] " +
  "active:[box-shadow:inset_0_0.03em_0_0_#ffffff,0_0.03em_0_0_#f2f2f2,0_0.0625em_0_0_#ededed,0_0.125em_0_0_#e2e2e2,0_0.125em_0_0_#dedede,0_0.2em_0_0_#dcdcdc,0_0.225em_0_0_#cacaca,0_0.225em_0.375em_0_#cecece]";

/** 日报填写的表单草稿（字段按 A3-01；改子视图不清空；Push 202 起「暂存草稿」= 保留内容不清空，只有提交后复位）。 */
type ReportDraft = {
  /** 时间（填报日期，ISO） */
  dateIso: string;
  /** 今日施工人数（输入框里是字符串，提交时转数字） */
  headcount: string;
  doneWork: string;
  plan: string;
  foundIssue: string;
  /** 问题归类（C9 字典十项；**可多选**，Push 202「问题归类可以多选」） */
  issueCategories: string[];
  suggestion: string;
  /** 关联阶段（按阶段名多选；九阶段口径） */
  stages: string[];
  /** 现场工作附图（名单 + 图片预览地址；Push 202 同批续「图片要可以预览」） */
  photos: ReportPhoto[];
  /** 当前问题附图（「现场发现问题」非空时才填） */
  issuePhotos: ReportPhoto[];
};

/** ISO 日期 → 「YYYY年M月D日」（Push 202 起带年：业务口径「时间格式也要年月日」；原「M月D日」写法下架）。 */
function cnDateOf(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    return iso;
  }
  return String(Number(match[1])) + "年" + String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
}

/** 当天 ISO 日期（YYYY-MM-DD）。 */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return String(now.getFullYear()) + "-" + month + "-" + day;
}

/** 空表单：日期默认今天，其余留空。 */
function emptyDraft(): ReportDraft {
  return { dateIso: todayIso(), headcount: "", doneWork: "", plan: "", foundIssue: "", issueCategories: [], suggestion: "", stages: [], photos: [], issuePhotos: [] };
}

/** 接口错误 → 页面提示文案（ApiError.message 已是服务端中文口径）。 */
function friendlyError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** 可落库的附图文件 id（用户中途删掉的、上传中 / 失败的都不在内）。 */
function readyFileIds(photos: readonly ReportPhoto[]): string[] {
  return photos.filter((photo) => photo.pending === undefined && photo.fileId !== "").map((photo) => photo.fileId);
}

/** 提交 / 暂存前拦「图片还在上传 / 上传失败」（返回空串 = 放行）。 */
function uploadBlockingMessage(draft: ReportDraft): string {
  const photos = draft.photos.concat(draft.issuePhotos);
  if (photos.some((photo) => photo.pending === "uploading")) {
    return "还有图片在上传中，请等上传完成后再提交。";
  }
  if (photos.some((photo) => photo.pending === "failed")) {
    return "有图片上传失败，请先移除失败图片（或重新粘贴）再提交。";
  }
  return "";
}

/** 界面 patch → 契约日报写体（只带被改字段；plan 空串 = 清空 → null）。 */
function reportUpdateBody(current: DailyReport, patch: ReportPatch): ReportUpdateInput {
  const body: ReportUpdateInput = { version: current.version };
  if (patch.doneWork !== undefined) {
    body.doneWork = patch.doneWork;
  }
  if (patch.plan !== undefined) {
    body.plan = patch.plan === "" ? null : patch.plan;
  }
  if (patch.stageNames !== undefined) {
    body.stageKeys = patch.stageNames.map(stageKeyOfName).filter((key): key is string => key !== null);
  }
  if (patch.photos !== undefined) {
    body.photoFileIds = readyFileIds(patch.photos);
  }
  if (patch.headcount !== undefined) {
    // Push 217 续⑥（业务口径「施工人数抽屉也要可以编辑」）：施工人数 —— 明确带 null（＝清空）；
    // 与 plan 的「空串转 null」不同，这里本来就是 number | null，原样透传。
    body.headcount = patch.headcount;
  }
  return body;
}

/** 界面 patch → 契约问题写体（solution 空串 = 清空 → null）。 */
function issueUpdateBody(current: Issue, patch: IssuePatch): IssueUpdateInput {
  const body: IssueUpdateInput = { version: current.version };
  if (patch.title !== undefined) {
    body.title = patch.title;
  }
  if (patch.categories !== undefined) {
    body.categories = patch.categories;
  }
  if (patch.solution !== undefined) {
    body.solution = patch.solution === "" ? null : patch.solution;
  }
  if (patch.state !== undefined) {
    body.state = patch.state;
  }
  if (patch.photos !== undefined) {
    body.photoFileIds = readyFileIds(patch.photos);
  }
  return body;
}

/** 新建体口径（Push 216 接真）：`DailyReportCreateBodySchema` 里 headcount / plan / foundIssue / issueCategories / suggestion
 *  都是**可选非空**（`z.string().min(1).optional()`）—— 空值必须**省字段**；显式传 null 会被 Zod 拒（invalid_type）。
 *  只有 PATCH 更新体（`DailyReportUpdateBodySchema`）才用 null 表示「清空」，所以这一层只在 create 路径上做。 */
function createBody(body: ReportWriteInput): ReportWriteInput {
  const next: ReportWriteInput = { ...body };
  if (next.headcount === null) {
    delete next.headcount;
  }
  if (next.plan === null) {
    delete next.plan;
  }
  if (next.suggestion === null) {
    delete next.suggestion;
  }
  if (next.foundIssue === null) {
    delete next.foundIssue;
    delete next.issueCategories;
  }
  return next;
}

/** 去掉 create 专有的 date 字段（PATCH 编辑体不含 date —— 填报日期不可改）。 */
function withoutDate(body: ReportWriteInput): Omit<ReportWriteInput, "date"> {
  return {
    state: body.state,
    headcount: body.headcount,
    doneWork: body.doneWork,
    plan: body.plan,
    foundIssue: body.foundIssue,
    issueCategories: body.issueCategories,
    suggestion: body.suggestion,
    stageKeys: body.stageKeys,
    photoFileIds: body.photoFileIds,
    issuePhotoFileIds: body.issuePhotoFileIds,
  };
}

/** 卡片字段行（Push 209 改版 · 业务口径 2026-09-28「问题看板是这样的 要这些内容 然后样式参考任务进展的」）：
 *  字段名独占一行浅灰小字、取值在下一行 —— 与「任务进展」看板卡片的 Field 同一套口径（业务样 = 图一）。
 *  Push 211（业务口径「要加问题描述标题」）：增 first 变体 —— 卡面首段用它（不带上间距 mt-3）。 */
function Field({ label, children, first = false }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={first ? "" : "mt-3"}>
      <p className="text-[11px] text-zinc-500">{label}</p>
      <div className="mt-1 min-w-0">{children}</div>
    </div>
  );
}

/** 提交人 / 提出人的姓名头。 */
function InitialAvatar({ name }: { name: string }) {
  const initial = Array.from(name)[0] ?? "—";
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-medium text-zinc-600">
      {initial}
    </span>
  );
}

/** 区块标题（子视图标题 + 一行口径说明）。 */
function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <span className="text-xs text-zinc-400">{hint}</span>
    </div>
  );
}

/** 子视图空态。 */
function EmptyCard({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-6 py-12 text-center">
      <p className="text-sm text-zinc-500">{text}</p>
      <p className="mt-1.5 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}

/** 剪贴板图的「无名」判定：空名，或浏览器从位图生成的通用名（Chrome 粘图恒为 `image.png` 这类）。 */
function isClipboardGenericName(name: string): boolean {
  return name === "" || /^image\.(png|jpe?g|gif|webp)$/i.test(name);
}

/** 附图图标（右半「点击选择文件」= 业务给的样：文件 + 云；fill=currentColor 随字色；Push 212 续按业务口径「小一点 太大了」缩到 16px）。 */
function UploadIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 1C9.73478 1 9.48043 1.10536 9.29289 1.29289L3.29289 7.29289C3.10536 7.48043 3 7.73478 3 8V20C3 21.6569 4.34315 23 6 23H7C7.55228 23 8 22.5523 8 22C8 21.4477 7.55228 21 7 21H6C5.44772 21 5 20.5523 5 20V9H10C10.5523 9 11 8.55228 11 8V3H18C18.5523 3 19 3.44772 19 4V9C19 9.55228 19.4477 10 20 10C20.5523 10 21 9.55228 21 9V4C21 2.34315 19.6569 1 18 1H10ZM9 7H6.41421L9 4.41421V7ZM14 15.5C14 14.1193 15.1193 13 16.5 13C17.8807 13 19 14.1193 19 15.5V16V17H20C21.1046 17 22 17.8954 22 19C22 20.1046 21.1046 21 20 21H13C11.8954 21 11 20.1046 11 19C11 17.8954 11.8954 17 13 17H14V16V15.5ZM16.5 11C14.142 11 12.2076 12.8136 12.0156 15.122C10.2825 15.5606 9 17.1305 9 19C9 21.2091 10.7909 23 13 23H20C22.2091 23 24 21.2091 24 19C24 17.1305 22.7175 15.5606 20.9844 15.122C20.7924 12.8136 18.858 11 16.5 11Z"
        fill="currentColor"
      />
    </svg>
  );
}
/** 粘贴入口图标（Push 212 续 · 业务口径「ctrl v 的地方改成这个图标吧」→「两个图标不协调」）：业务给的 1024 视框「剪贴板 + 文件」图。
 *  原图直接缩到 16px 时字形只占视框 81%、线圈仅 ~41 单位（≈0.68px），与右半「文件 + 云」（24 视框 / 2 单位描边 ⇒ 16px 下 1.33px）又细又小 ≈ 不协调；
 *  对齐口径：viewBox 收成 "40 40 944 944"（字形内容 828×890 居中，四周各留 40）并给 strokeWidth="38" ⇒
 *  线圈 ≈ 79 单位 × 16/944 ≈ 1.34px ≈ 右半 1.33px，字形占宽 ≈ 866/944 ≈ 91.7% ≈ 右半 22/24；round 转角与站内图标同观感。
 *  形状仍是原图三条 path（未改一笔），只改视框与描边。 */
function PasteIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="40 40 944 944" fill="currentColor" stroke="currentColor" strokeWidth="38" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" className={className}>
      <path d="M922.21 787.33l0.31-0.45c0.32-0.5 0.62-1 0.9-1.51l0.06-0.12c0.3-0.56 0.57-1.14 0.81-1.72l0.18-0.46q0.27-0.66 0.48-1.35c0.06-0.17 0.11-0.35 0.16-0.53q0.24-0.81 0.42-1.65v-0.18c0.12-0.62 0.21-1.24 0.28-1.86v-0.52c0-0.48 0.06-1 0.07-1.46v-363.9a21.51 21.51 0 0 0-21.5-21.5H487.81a21.53 21.53 0 0 0-21.5 21.57L468 935.76a21.51 21.51 0 0 0 21.5 21.44h256.07c0.71 0 1.42 0 2.13-0.11 0.23 0 0.45-0.07 0.68-0.1 0.47-0.06 0.94-0.12 1.41-0.21 0.29-0.06 0.58-0.15 0.87-0.22s0.79-0.18 1.17-0.3 0.57-0.2 0.85-0.3 0.77-0.25 1.14-0.41 0.51-0.24 0.77-0.36 0.77-0.35 1.14-0.55 0.49-0.29 0.74-0.44 0.73-0.41 1.08-0.65 0.56-0.41 0.84-0.62 0.59-0.42 0.87-0.65a19.92 19.92 0 0 0 1.59-1.46l158.9-160.49a19 19 0 0 0 1.25-1.43l0.35-0.43c0.32-0.37 0.65-0.75 0.86-1.14zM509.38 433.12H883V753.7H745.58a21.5 21.5 0 0 0-21.5 21.5v139H510.91z m331 376.23l-73.34 74.07V796.7h85.85z" />
      <path d="M138.92 751.28V201.57h86v10.75a38.14 38.14 0 0 0 11.1 26.8 37.62 37.62 0 0 0 26.8 11.1h246a37.9 37.9 0 0 0 37.89-37.9v-10.75h71.47v118.06h40.9V181.12a20.49 20.49 0 0 0-20.45-20.45h-91.91v-9.84a38.13 38.13 0 0 0-11.1-26.8 37.59 37.59 0 0 0-26.78-11.1h-58.17a68.64 68.64 0 0 0-129.69 0h-58.17A37.63 37.63 0 0 0 236 124a38.16 38.16 0 0 0-11.09 26.8v9.84H118.47A20.49 20.49 0 0 0 98 181.12V771.7a20.07 20.07 0 0 0 0.11 2c0 0.29 0.07 0.58 0.12 0.86l0.07 0.46c0 0.23 0.06 0.46 0.11 0.68 0.09 0.43 0.2 0.85 0.33 1.35v0.12c0 0.16 0.08 0.31 0.13 0.48 0.14 0.45 0.31 0.89 0.47 1.32v0.11c0 0.15 0.11 0.3 0.17 0.45 0.15 0.36 0.33 0.72 0.5 1.07l0.13 0.26c0.07 0.16 0.15 0.32 0.23 0.48s0.33 0.56 0.5 0.83l0.2 0.33a5.58 5.58 0 0 0 0.34 0.56c0.14 0.21 0.3 0.42 0.46 0.63l0.27 0.36c0.15 0.2 0.3 0.41 0.46 0.61l0.56 0.63 0.3 0.32c0.15 0.18 0.31 0.35 0.47 0.51a4.58 4.58 0 0 0 0.46 0.42l0.28 0.26c0.24 0.22 0.48 0.44 0.74 0.66l0.47 0.36 0.3 0.23 0.83 0.6 0.43 0.27 0.16 0.09c0.37 0.23 0.74 0.46 1.13 0.67a4.8 4.8 0 0 0 0.45 0.22c0.45 0.23 0.89 0.45 1.36 0.64l0.41 0.15c0.48 0.19 1 0.37 1.45 0.52 0.15 0 0.3 0.08 0.53 0.14 0.47 0.13 0.94 0.26 1.41 0.35 0.22 0 0.45 0.08 0.67 0.11l0.48 0.07c0.28 0.05 0.56 0.09 0.85 0.12 0.51 0.06 1.07 0.08 1.68 0.09H382.55v-40.81z m126.9-597.45h92.24v-18.38a27.76 27.76 0 1 1 55.52 0v18.35h92.25v55.5h-240z" />
      <path d="M385.83 117.05a18.39 18.39 0 1 0 0 36.78h3v-0.24a18.38 18.38 0 0 0-3-36.51z" />
    </svg>
  );
}
/** 图片预览层（业务口径「图片要可以预览」）：点缩略图放大看；点任意处 / Esc 关。
 *  Push 217 续④（业务口径「抽屉中点击图片也要居中显示」+「从看板里面点了图片 再从抽屉点图片怎么是这样的 bug」）：
 *  1) 预览层改 **portal 到 body** —— 抽屉壳 .drawer-panel 带 ll-drawer-in 入场动画（animation-fill-mode: both），
 *     动画结束后它的 computed transform 仍是 matrix(1,0,0,1,0,0)（≠ none）⇒ 它就是 fixed 后代的 containing block：
 *     预览层的 fixed inset-0 会退化成「只盖抽屉面板（460px）」而不是整个视口，大图因此贴面板顶 / 溢出到面板外、
 *     和看板入口的正常预览层叠成两层。portal 到 body 后 containing block 回到视口，两处入口同一居中口径。
 *  2) 图幅上限 90vw → min(90vw, calc(100vw - 3rem))：保留 90vw 留白，同时不超过预览层内容宽（减去 p-6 的 48px），
 *     极窄窗口下大图也不会溢出预览层。
 *  3) 预览层自带 stopPropagation（click / pointerdown）—— React 的 portal 事件沿 **React 树**继续冒泡：
 *     看板卡片的整卡 onClick / onPointerDown 会把「点预览层关掉」当成「点卡片」，预览一关抽屉就被带着打开
 *     （业务截图里「看板预览 + 抽屉预览」两层同屏的另一半原因）。同 InlineEdit 浮层的 portal 口径。
 *  4) Esc 改**捕获阶段**监听并止住传播：预览层在最上层时 Esc 只关预览层（再按一次才轮到抽屉自己的 Esc）。 */
function PhotoPreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      data-photo-preview=""
      role="dialog"
      aria-label={"预览 " + name}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/60 p-6"
    >
      <figure className="flex max-h-full max-w-full flex-col items-center">
        <img src={url} alt={name} className="max-h-[80vh] max-w-[min(90vw,calc(100vw-3rem))] rounded-xl bg-white p-1 shadow-2xl" />
        <figcaption className="mt-2 text-center text-xs text-white/80">{name}</figcaption>
      </figure>
    </div>,
    document.body,
  );
}

/** 单枚附图瓦片（Push 216）：预览地址本地 blob 优先、否则懒取服务端预览签名；pending 态出「上传中 / 上传失败」标记。 */
function PhotoTile({ item, index, isLarge, isThumb, editingAt, editingText, editingExt, setEditingText, setEditingAt, commitRename, startRename, onRename, onRemove, onPreview }: {
  item: ReportPhoto;
  index: number;
  isLarge: boolean;
  isThumb: boolean;
  editingAt: number | null;
  editingText: string;
  editingExt: string;
  setEditingText: (text: string) => void;
  setEditingAt: (at: number | null) => void;
  commitRename: () => void;
  startRename: (at: number) => void;
  onRename?: (at: number, name: string) => void;
  onRemove?: (at: number) => void;
  onPreview: (url: string, name: string) => void;
}) {
  const url = usePhotoUrl(item.fileId, item.url);
  const editing = editingAt === index;
  return (
    <span
      data-attachment={item.name}
      title={isLarge || isThumb ? item.name : undefined}
      className={
        isLarge || isThumb
          ? "relative inline-flex shrink-0"
          : "inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600"
      }
    >
      {url === null ? null : (
        <button
          type="button"
          data-attachment-thumb=""
          aria-label={"预览 " + item.name}
          onClick={(event) => {
            // Push 217 续④：看板卡片整卡可点（开抽屉），缩略图的预览点击若冒泡 = 「预览层 + 抽屉」同时打开、
            // 两层预览叠着（业务截图）；这里止住冒泡，点图只出预览层。
            event.stopPropagation();
            onPreview(url, item.name);
          }}
          className="shrink-0 rounded-md transition hover:opacity-80"
        >
          <img
            src={url}
            alt={item.name}
            className={
              (isLarge ? "h-24 w-32 rounded-lg border border-zinc-200 object-cover" : isThumb ? "h-10 w-10 rounded-md border border-zinc-200 object-cover" : "h-8 w-8 rounded-md border border-zinc-200 object-cover") +
              (item.pending === "failed" ? " ring-1 ring-rose-400" : item.pending === "uploading" ? " opacity-60" : "")
            }
          />
        </button>
      )}
      {editing ? (
        <input
          data-attachment-input=""
          value={editingText}
          autoFocus
          onChange={(event) => setEditingText(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitRename();
            }
            if (event.key === "Escape") {
              setEditingAt(null);
            }
          }}
          className="w-20 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] text-zinc-700 outline-none focus:border-zinc-400"
        />
      ) : null}
      {item.pending === undefined ? null : isLarge || isThumb ? (
        <span
          className={
            "pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg px-1 py-0.5 text-center text-[10px] leading-3 text-white " +
            (item.pending === "failed" ? "bg-rose-600/85" : "bg-zinc-900/70")
          }
        >
          {item.pending === "uploading" ? "上传中…" : "上传失败"}
        </span>
      ) : (
        <span className={"text-[10px] " + (item.pending === "failed" ? "text-rose-500" : "text-zinc-400")}>
          {item.pending === "uploading" ? "上传中…" : "上传失败"}
        </span>
      )}
      {isLarge || isThumb ? null : editing && editingExt !== "" ? (
        <span className="text-[10px] text-zinc-400">{editingExt}</span>
      ) : onRename === undefined || item.pending !== undefined ? (
        <span>{item.name}</span>
      ) : (
        <button
          type="button"
          data-rename-attachment=""
          aria-label={"重命名 " + item.name}
          title="点名字可自定义"
          onClick={() => startRename(index)}
          className="max-w-[9rem] truncate text-left transition hover:text-zinc-900 hover:underline"
        >
          {item.name}
        </button>
      )}
      {onRemove === undefined ? null : isLarge || isThumb ? (
        // Push 212 续：md / lg 瓦片走**角标**移除（absolute 覆盖在图上，不占行宽 —— 保证大瓦片仍能并排折行）。
        <button
          type="button"
          data-action="remove-attachment"
          aria-label={"移除 " + item.name}
          onClick={() => onRemove(index)}
          title="移除这张图"
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-200 bg-white text-[11px] leading-none text-zinc-500 shadow-sm transition hover:bg-zinc-100 hover:text-zinc-800"
        >
          ×
        </button>
      ) : (
        <button
          type="button"
          data-action="remove-attachment"
          aria-label={"移除 " + item.name}
          onClick={() => onRemove(index)}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
        >
          ×
        </button>
      )}
    </span>
  );
}

/** 附图清单：图片出**缩略图**（点开预览层看大图）、非图片出文件名胶囊；表单里再带 × 可逐个移除。
 *  Push 206 加 size 档位：sm（默认 —— 表单贴图区：32×32 小缩略图 + 文件名胶囊）/ lg（「日报记录」列表用：
 *  约 128×96 大图瓦片、多张自动折行、只出图不带文件名 —— 业务样 = 图 2；名字放 title 提示）。
 *  Push 207 再加 md（40×40 紧凑缩略图、只出图不带文件名 —— 业务样 = 图五；Push 217 起「问题追踪」表改用 lg，
 *  现用于「问题看板」卡片与问题详情抽屉的贴图区）。 */
function PhotoStrip({ items, onRemove, onRename, strip, size = "sm" }: { items: readonly ReportPhoto[]; onRemove?: (at: number) => void; onRename?: (at: number, name: string) => void; strip?: string; size?: "sm" | "md" | "lg" }) {
  const isLarge = size === "lg";
  /** 列表里的紧凑缩略图档（40×40、名字进 title）。 */
  const isThumb = size === "md";
  /** 大图预览（Push 216：存已解析的展示地址 —— 本地 blob 或服务端预览签名）。 */
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  /** 正在改名的第几份（null = 没有在改名）；业务口径「图片名称可以自定义」。 */
  const [editingAt, setEditingAt] = useState<number | null>(null);
  /** 编辑中的**主名**（后缀不参与编辑 —— 业务口径「自定义把图片png格式删了怎么办」：格式由系统保留）。 */
  const [editingText, setEditingText] = useState("");
  /** 编辑中保留的后缀（含点；没后缀 = 空串）。 */
  const [editingExt, setEditingExt] = useState("");
  /** 提交改名：空名 / 没变 = 原样（不写回）。 */
  const commitRename = () => {
    if (editingAt === null || onRename === undefined) {
      setEditingAt(null);
      return;
    }
    const base = editingText.trim();
    const next = base === "" ? items[editingAt].name : base + editingExt;
    if (next !== items[editingAt].name) {
      onRename(editingAt, next);
    }
    setEditingAt(null);
  };

  /** 开始改名：主名进输入框、后缀原位保留（图片 png 格式不会被改掉）。 */
  const startRename = (at: number) => {
    const name = items[at].name;
    const dot = name.lastIndexOf(".");
    const hasExt = dot > 0 && dot < name.length - 1;
    setEditingAt(at);
    setEditingText(hasExt ? name.slice(0, dot) : name);
    setEditingExt(hasExt ? name.slice(dot) : "");
  };
  if (items.length === 0) {
    return null;
  }
  return (
    <div data-attachment-strip={strip} className={isLarge ? "mt-1.5 flex flex-wrap items-start gap-2" : isThumb ? "flex flex-wrap items-center gap-1.5" : "mt-1.5 flex flex-wrap items-center gap-1.5"}>
      {items.map((item, index) => (
        <PhotoTile
          key={item.name + "#" + String(index)}
          item={item}
          index={index}
          isLarge={isLarge}
          isThumb={isThumb}
          editingAt={editingAt}
          editingText={editingText}
          editingExt={editingExt}
          setEditingText={setEditingText}
          setEditingAt={setEditingAt}
          commitRename={commitRename}
          startRename={startRename}
          onRename={onRename}
          onRemove={onRemove}
          onPreview={(url, name) => setPreview({ url, name })}
        />
      ))}
      {preview === null ? null : <PhotoPreview url={preview.url} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** 附图选择（原型：名字 + 图片预览地址，正式版走站内文件库）。
 *  Push 202 同批续：以**复制粘贴**为主入口（业务口径「附图要可以复制粘贴 不能全靠选择文件 我们以复制粘贴为主」）——
 *  点一下虚线框**左半**（`Ctrl + V` 半区）拿到焦点，Ctrl+V 直接粘图（截图 / 复制的图片文件都收；剪贴板图没有名字时按「剪贴板图片-N.png」命名）；
 *  形态按业务给的样（虚线卡 + 文件 / 云图标）本地化：**左右分半、无说明文字** —— 左半**剪贴板图标**（主入口；Push 204 起键帽材质下架 —— 业务口径「做成文字吧」、Push 212 续文字换 PasteIcon —— 「ctrl v 的地方改成这个图标吧」；h-full 撑满 44px 行、垂直居中 —— 「位置要居中」）、
 *  右半文件 / 云图标（点击选择文件 · 次入口）；图片存 `URL.createObjectURL` 本地预览地址、**同时立即上传站内文件库**
 *  （Push 216 接真：完成回填 `fileId` —— 提交时随 `photoFileIds` 落 `file_links`；上传中 / 失败在瓦片上出标记）；
 *  两个贴图区同在一张表单时，Ctrl+V 只投给**最近点过**的那一个（armed 态在左半上可见）。
 *  Push 205：「当前问题附图」加**前置开关**（业务口径「先填发现的问题 才能填另外三个」）—— disabled 时整卡灰底 / 灰字、
 *  两半都点不开（左半按钮 disabled、粘贴落点不可聚焦、文件框 disabled、文档级粘贴监听不挂）。 */
function AttachmentPicker({ projectId, field, items, onChange, ariaLabel, disabled = false, size = "sm", variant = "card" }: { projectId: string; field: string; items: readonly ReportPhoto[]; onChange: (items: ReportPhoto[]) => void; ariaLabel: string; disabled?: boolean; /** Push 212 续：主题图清单档位（sm = 表单胶囊档；抽屉沿用各自图幅 —— 问题附图 md / 现场工作附图 lg）。 */ size?: "sm" | "md" | "lg"; /** Push 212 续：形态 —— card = 表单那张虚线贴图卡（业务样）；compact = 紧凑小图标入口（问题详情抽屉用 —— 业务口径「框太大了 不需要」）。 */ variant?: "card" | "compact" }) {
  /** 本区是否是「最近点过的贴图区」——点一下左半（粘贴落点拿到焦点）置位，粘贴事件按它路由。 */
  const [armed, setArmed] = useState(false);
  /** 粘贴落点（左半里的不可见输入框：浏览器只对有可编辑焦点的元素执行 Ctrl+V 粘贴命令）。 */
  const sinkRef = useRef<HTMLInputElement | null>(null);
  /** 粘贴图命名序号（截图多数没有名字 → 剪贴板图片-1.png / -2.png …）。 */
  const pasteSeq = useRef(0);
  /** 最新 props（document 级粘贴监听不随每次输入重挂）。 */
  const latest = useRef({ items, onChange });
  latest.current = { items, onChange };
  /** 就绪态 = 已点过左半 **且未禁用**（禁用态一律不亮、不接粘贴）。 */
  const armedNow = armed && disabled === false;
  /** 紧凑形态（抽屉）：不套虚线卡 —— 只留两枚小图标入口（粘贴 / 选文件）。 */
  const compact = variant === "compact";

  /** 把一批新附件并进已有清单（粘贴与选文件共用；按现有顺序追加，同名不去重）。 */
  const appendItems = (next: readonly ReportPhoto[]) => {
    if (next.length === 0) {
      return;
    }
    latest.current.onChange(latest.current.items.concat(next));
  };

  /** 按条目引用回填（用户中途删掉 = 找不到、自然忽略）。 */
  const updateEntry = (entry: ReportPhoto, update: (current: ReportPhoto) => ReportPhoto) => {
    latest.current.onChange(latest.current.items.map((item) => (item === entry ? update(item) : item)));
  };

  /** 单张上传（Push 216 接真）：文件库直传完成回填 fileId；失败标「uploaded failed」等待用户删除重贴。 */
  const startUpload = async (file: File, entry: ReportPhoto) => {
    try {
      const fileId = await uploadPhoto(projectId, file, entry.name);
      updateEntry(entry, (current) => ({ ...current, fileId, pending: undefined }));
    } catch {
      updateEntry(entry, (current) => ({ ...current, pending: "failed" }));
    }
  };

  /** 一批文件 → 附件（Push 216 接真：本地 blob 预览 + 立即上传文件库；`imagesOnly` = 粘贴路径只收图）。 */
  const toItems = (files: readonly File[], imagesOnly: boolean): ReportPhoto[] => {
    const picked = imagesOnly ? files.filter((file) => file.type.indexOf("image/") === 0) : files;
    return picked.map((file) => {
      const isImage = file.type.indexOf("image/") === 0;
      let name = file.name;
      if (isImage && isClipboardGenericName(file.name)) {
        pasteSeq.current += 1;
        const slash = file.type.indexOf("/");
        const ext = slash >= 0 ? file.type.slice(slash + 1) : "png";
        name = "剪贴板图片-" + String(pasteSeq.current) + "." + ext;
      }
      const entry: ReportPhoto = { fileId: "", name, url: isImage ? URL.createObjectURL(file) : null, pending: "uploading" };
      void startUpload(file, entry);
      return entry;
    });
  };

  /** 一次粘贴：剪贴板里有图就留下（并 preventDefault，不让图片落成输入框内容）。 */
  const onPasteImage = (event: { clipboardData: DataTransfer | null; preventDefault: () => void }) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    const next = toItems(files, true);
    if (next.length > 0) {
      appendItems(next);
      event.preventDefault();
    }
  };

  /** document 级粘贴监听：兜底 —— 焦点在别处（如刚点过右半）时，仍投给「最近点过的贴图区」。 */
  useEffect(() => {
    if (!armed || disabled) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      onPasteImage(event);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [armed, disabled]);

  return (
    <div>
      {/* Push 204 同批：卡片自身不再可聚焦 —— 原来 tabIndex=0 + onFocus 兜就绪态，点右半「选择文件」时浏览器的
          焦点落点是这张卡片，左半被重新点亮、Ctrl+V 被一直劫持（业务口径「点击ctrl v 再点右侧图标就会卡ctrl v一直被点击的bug」）；
          就绪态只由左半（点击 → 粘贴落点聚焦）驱动。 */}
      <div
        data-paste-zone={field}
        data-paste-disabled={disabled ? "true" : "false"}
        role="group"
        aria-label={ariaLabel}
        aria-disabled={disabled}
        className={
          compact
            ? "relative flex items-center gap-1"
            : "overflow-hidden rounded-xl border border-dashed transition " +
              (disabled
                ? "border-zinc-200 bg-zinc-50"
                : armedNow
                  ? "border-zinc-400 bg-white ring-2 ring-zinc-900/5"
                  : "border-zinc-300 bg-white hover:border-zinc-400")
        }
      >
        <div className={compact ? "flex items-center gap-1" : "grid grid-cols-2 divide-x divide-zinc-200 text-center"}>
          <div className="relative">
            <button
              type="button"
              data-paste-half=""
              aria-label="复制粘贴（点一下再按 Ctrl+V 粘图）"
              disabled={disabled}
              onClick={() => {
                if (disabled) {
                  return;
                }
                sinkRef.current?.focus();
              }}
              className={
                compact
                  ? "flex h-7 w-7 items-center justify-center rounded-lg transition " +
                    (disabled
                      ? "cursor-not-allowed text-zinc-300"
                      : armedNow
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600")
                  : "flex h-full w-full items-center justify-center px-2 py-3 transition " +
                    (disabled
                      ? "cursor-not-allowed text-zinc-300"
                      : armedNow
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600")
              }
            >
              {/* Push 204：键帽下架、改纯文字（业务口径「做成文字吧」）—— 去渐变底 / 内阴影 / 圆角材质；字色随半区悬停 / 就绪态转深（不再单独写字色）
                  垂直居中（业务口径「位置要居中」）：h-full 撑满右半图标定高的 44px 行。
                  Push 212 续（业务口径「ctrl v 的地方改成这个图标吧」→「小一点 太大了」）：文字换**剪贴板图标**（PasteIcon —— 与右半「文件 + 云」同款 currentColor / 16px 口径）。 */}
              <PasteIcon className={compact ? "h-4 w-4" : "h-5 w-5"} />
            </button>
            {/* 粘贴落点：不可见、不可点，只借它的可编辑焦点接浏览器的 Ctrl+V（粘贴被 preventDefault，不会落文字） */}
            <input
              ref={sinkRef}
              data-paste-sink=""
              data-paste-hint={armedNow ? "armed" : "idle"}
              disabled={disabled}
              aria-hidden="true"
              tabIndex={-1}
              onFocus={() => setArmed(true)}
              onBlur={() => setArmed(false)}
              onChange={() => undefined}
              className="pointer-events-none absolute left-1/2 top-1/2 h-px w-px -translate-x-1/2 -translate-y-1/2 opacity-0"
            />
          </div>
          <label
            data-file-half=""
            aria-label={disabled ? "先填「现场发现问题」后可选择文件" : "点击选择文件（可多选）"}
            onClick={() => {
              if (disabled) {
                return;
              }
              // 右半是文件入口：点它 = 放弃本区粘贴就绪态（修「点右半点亮左半、Ctrl+V 卡住」），并让粘贴落点失焦。
              setArmed(false);
              sinkRef.current?.blur();
            }}
            className={
              compact
                ? "flex h-7 w-7 items-center justify-center rounded-lg transition " +
                  (disabled ? "cursor-not-allowed text-zinc-300" : "cursor-pointer text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600")
                : "flex items-center justify-center px-2 py-3 transition " +
                  (disabled ? "cursor-not-allowed text-zinc-300" : "cursor-pointer text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600")
            }
          >
            <UploadIcon className={compact ? "h-4 w-4" : "h-5 w-5"} />
            <input
              data-field={field}
              type="file"
              multiple
              disabled={disabled}
              onChange={(event) => {
                appendItems(toItems(Array.from(event.target.files ?? []), false));
                event.target.value = "";
              }}
              className="hidden"
            />
          </label>
        </div>
      </div>
      <PhotoStrip
        items={items}
        strip={field}
        size={size}
        onRemove={(at) => onChange(items.filter((_, index) => index !== at))}
        onRename={(at, name) => onChange(items.map((item, index) => (index === at ? { ...item, name } : item)))}
      />
    </div>
  );
}
/** 「日报记录」的列口径（业务口径「做成列表 不要卡片」，字段仍是 A3-01）；
 *  Push 199 收窄 = 时间 / 填写者 / 关联阶段 / 当日完成工作 / 明日计划 / 现场工作附图 六列 ——「今日施工人数 /
 *  现场发现问题 / 解决方案或建议」只从列表展示去掉（表单字段与 A3-09 问题生成口径不变）；
 *  Push 202 = 六列表头改**中英拼写**（时间time / 填写者 / 关联阶段Related stages / 当日完成工作Work completed today /
 *  明日计划Tomorrow's plan / 现场工作附图On-site photos），时间列改**年月日**、撤状态签与「提交 HH:MM」小字。 */
const REPORT_COLUMNS: readonly string[] = [
  "时间time",
  "填写者",
  "关联阶段Related stages",
  "当日完成工作Work completed today",
  "明日计划Tomorrow's plan",
  "现场工作附图On-site photos",
];

/** 一篇日报一行：**列表 / 表格**（业务口径「日报记录还是做成列表 不要卡片」），列内容与原来的卡片一致；
 *  表格壳与「问题追踪」同一套（白底 + 圆角边框 + 行悬停），窄屏横向滚动。
 *  （Push 199 收窄后不再带问题记录当前态 —— 问题态仍在「问题追踪 / 问题看板」可查。）
 *  Push 206（业务口径「这个日报记录要大一点效果要如图二所示」+「用户填写后换行 填到表格后也要是换行的」）：
 *  整表放大（字号 xs → sm、单元格内边距 py-2.5 → py-4、表头 py-3.5、表格 min-w 900 → 1080）+「当日完成工作 / 明日计划」
 *  两列 whitespace-pre-line 按行换行 + 「现场工作附图」列 PhotoStrip 大图瓦片（size 档位 lg）。 */
function ReportList({ reports, onPatch, onDelete }: { reports: readonly DailyReport[]; onPatch: (id: string, patch: ReportPatch) => void; onDelete: (id: string) => void }) {
  return (
    <div data-report-table="" className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            {REPORT_COLUMNS.map((title) => (
              <th key={title} className="whitespace-nowrap border-b border-zinc-200 px-4 py-3.5 font-medium">
                {title}
              </th>
            ))}
            {/* Push 213（业务口径「日报记录 和 问题追随都要有删除按钮 … 请你看看有没有合适的位置」）：行尾动作列 ——
                与任务表同一个 48px 槽位、同款 RowDeleteButton（静止 24px 幽灵态、悬停展开红胶囊「删除」），行内不动其它列。 */}
            <th className="w-20 border-b border-zinc-200 px-4 py-3.5 font-medium">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            return (
              <tr key={report.id} data-report-row={report.id} className="group align-top transition hover:bg-zinc-50/70">
                <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-4">
                  {/* Push 202：时间列只留年月日（业务口径「时间格式也要年月日 具体提交时间不需要 已提交状态也不要」）——
                      状态签与「提交 HH:MM」小字一并下架（state 字段仍保留在数据模型里） */}
                  {/* Push 207 同批追加：时间列**去加粗**（业务口径「问题追踪里面的时间不用加粗」· 业务样 = 图里日报记录时间列）
                      —— 字重回常规、字色对齐「问题追踪」日期列 text-zinc-700（不再用 font-semibold / zinc-900） */}
                  <p data-report-date="" className="text-zinc-700">{cnDateOf(report.date)}</p>
                  {report.state === "submitted" ? null : (
                    <span
                      data-report-state={report.state}
                      className={
                        "mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium " +
                        (report.state === "draft" ? "bg-zinc-100 text-zinc-600" : "bg-amber-100 text-amber-800")
                      }
                    >
                      {REPORT_STATE_NAMES[report.state]}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-4">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <InitialAvatar name={report.author} />
                    <span className="truncate text-zinc-700">{report.author}</span>
                  </span>
                </td>
                <td className="min-w-[150px] border-b border-zinc-100 px-4 py-4 leading-6 text-zinc-700">
                  {/* Push 208 追加（业务口径「这个也要可以编辑筛选选择」+ 同日追加「显示也要有颜色」）：关联阶段行内可改 ——
                      浮层 = 与表单同款九阶段勾选清单；显示态 = StageTags 色签组（逐枚出签、与浮层共用一张色表） */}
                  <InlineCell
                    ariaLabel={"修改关联阶段（" + report.date + "）"}
                    title="点击选择（可多选）"
                    width={220}
                    height={REPORT_STAGES.length * 30 + 12}
                    bare
                    triggerClassName={CELL_EDIT_TEXT}
                    display={<StageTags names={report.stageNames} />}
                    render={() => (
                      <MultiOptionList
                        values={report.stageNames}
                        options={REPORT_STAGES}
                        ariaLabel={"修改关联阶段（" + report.date + "）"}
                        onChange={(next) => {
                          onPatch(report.id, { stageNames: next });
                        }}
                        renderLabel={stageChip}
                      />
                    )}
                  />
                </td>
                <td className="min-w-[240px] whitespace-pre-line break-words border-b border-zinc-100 px-4 py-4 leading-6 text-zinc-800">
                  {/* Push 208「日报记录同理」：当日完成工作行内可改（文字修改需要点击保存 · 时间列不动） */}
                  <InlineTextCell
                    bare
                    value={report.doneWork}
                    ariaLabel={"修改当日完成工作（" + report.date + "）"}
                    triggerClassName={CELL_EDIT_TEXT}
                    placeholder="填写当日完成的工作，点「保存」生效"
                    display={
                      report.doneWork === "" ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        <span data-report-done="" className="block whitespace-pre-line break-words">{report.doneWork}</span>
                      )
                    }
                    onSave={(text) => {
                      onPatch(report.id, { doneWork: renumberLines(text) });
                    }}
                  />
                </td>
                <td className="min-w-[200px] whitespace-pre-line break-words border-b border-zinc-100 px-4 py-4 leading-6 text-zinc-700">
                  {/* Push 208：明日计划行内可改（同款文字编辑：点「保存」才落值） */}
                  <InlineTextCell
                    bare
                    value={report.plan}
                    ariaLabel={"修改明日计划（" + report.date + "）"}
                    triggerClassName={CELL_EDIT_TEXT}
                    placeholder="填写明日计划，点「保存」生效"
                    display={
                      report.plan === "" ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        <span data-report-plan="" className="block whitespace-pre-line break-words">{report.plan}</span>
                      )
                    }
                    onSave={(text) => {
                      onPatch(report.id, { plan: renumberLines(text) });
                    }}
                  />
                </td>
                <td className="min-w-[440px] border-b border-zinc-100 px-4 py-4">
                  {/* 只读展示（同上 · 业务口径「太丑了 取消修改」）：附图增删在「日报填写」表单与抽屉里做。 */}
                  {report.photos.length === 0 ? <span className="text-zinc-400">—</span> : <PhotoStrip items={report.photos} size="lg" />}
                </td>
                <td className="w-20 border-b border-zinc-100 px-4 py-4 align-top" data-report-delete-cell="">
                  {/* 行尾动作槽位（任务表同款：RowDeleteButton 注释里那套「展开只吃预留的 48px 槽位」）——
                      幽灵态 24px → 悬停 48px **只在槽内长大**，单元格内容宽不变 ⇒ 表格列宽/表宽一格不动。
                      px-4(16×2) + 48 = 80 = w-20，列宽正好对上表头。业务反馈：「鼠标触碰表格会动」。 */}
                  <span data-report-delete-slot="" className="flex h-6 w-12 shrink-0 items-center">
                    <RowDeleteButton
                      label={"删除日报（" + report.date + "）—— 会连同这篇日报派生的问题一起删除"}
                      onDelete={() => {
                        onDelete(report.id);
                      }}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 一条问题记录（问题看板的一张卡 · Push 209 改版 —— 业务口径 2026-09-28「问题看板是这样的 要这些内容 然后样式
 *  参考任务进展的」）：卡面与业务样「图一」对齐 —— 只出**问题内容**四段：问题描述（多行 pre-line）/ 问题归类（彩色
 *  色签）/ 解决方案或建议（多行 pre-line，有才显示）/ 问题附图（40×40 缩略图，有才显示）；字段名 = 独占一行的浅灰小字。
 *  样式 = 与「任务进展」看板卡片同一套材质（CARD_SHELL 白壳 + 发丝边 + 三层投影 + 细纹），点一下开「问题详情」抽屉。
 *  同批下架（图一没有）：状态签 / 提出人 / 提出日期 —— 状态看列头、其余进抽屉（Push 207 的「责任 / 处理时限 / 所属任务」
 *  不再展示口径照旧不变）。Push 210（业务口径「卡片要可以拖动」）：卡片接指针拖动 —— 按住拖到别的列 = 改问题状态（细节见 IssueBoard）。Push 211（业务口径「要加问题描述标题」）：首段问题描述补「问题描述」字段名 —— 卡面四段全部有字段名。 */
function IssueCard({ issue, onOpen, onPointerDownDrag, dragging = false, ghost = false }: {
  issue: Issue;
  onOpen: () => void;
  onPointerDownDrag?: (issueId: string, node: HTMLElement, event: ReactPointerEvent<HTMLDivElement>) => void;
  dragging?: boolean;
  ghost?: boolean;
}) {
  return (
    <div
      role={ghost ? undefined : "button"}
      tabIndex={ghost ? undefined : 0}
      aria-hidden={ghost ? true : undefined}
      aria-label={ghost ? undefined : "问题：" + issue.title}
      title={onPointerDownDrag === undefined ? undefined : "点一下看问题详情（含来源日报内容）；按住卡片拖到别的列 = 改问题状态"}
      data-issue-card={issue.id}
      onClick={onOpen}
      onPointerDown={onPointerDownDrag === undefined ? undefined : (event) => { onPointerDownDrag(issue.id, event.currentTarget, event); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={(ghost ? ISSUE_CARD_SHELL_GHOST : CARD_SHELL) + (dragging ? " cursor-grabbing" : " cursor-pointer")}
    >
      <span aria-hidden="true" className={CARD_NOISE} />
      <div className={CARD_BODY}>
        <Field label="问题描述" first>
          <p data-issue-card-title="" className="whitespace-pre-line break-words text-sm leading-5 text-zinc-900">{issue.title}</p>
        </Field>
        <Field label="问题归类">
          <CategoryTags values={issue.categories} />
        </Field>
        {issue.solution === "" ? null : (
          <Field label="解决方案或建议">
            <p data-issue-card-solution="" className="whitespace-pre-line break-words text-sm leading-5 text-zinc-700">{issue.solution}</p>
          </Field>
        )}
        {issue.photos.length === 0 ? null : (
          <Field label="问题附图">
            <PhotoStrip items={issue.photos} size="md" />
          </Field>
        )}
      </div>
    </div>
  );
}

/** 按下卡片、还没到拖动阈值时的暂存（Push 210）。 */
type PendingIssueDrag = {
  issueId: string;
  pointerId: number;
  /** 按下时的坐标：用来判「过没过阈值」。 */
  x: number;
  y: number;
  /** 卡片 DOM：真拖起来之后把指针捕获在它身上（鼠标滑出窗口再放开也收得到 pointerup）。 */
  node: HTMLElement;
  dragging: boolean;
};

/**
 * 「问题看板」列板 + 卡片拖动（Push 210 · 业务口径 2026-09-28「卡片要可以拖动」）：
 * 与「任务进展」看板同一套指针拖动口径 —— 按住卡片位移超过 DRAG_THRESHOLD 才算拖动（没超过 = 点一下开
 * 问题详情抽屉）；拖动中卡片跟手（半透明拖动卡），非当前列描边高亮 + 列顶浮出落点槽；拖到看板 / 列边缘逐帧自动滚；
 * 放开 = 把问题状态改成目标列（同一 patchIssue 内存态：「问题追踪」表 / 计数 / 抽屉同步跟着变）。
 * 同列不是落点（问题没有列内顺序，放开不改动）；Esc / 指针取消 = 原地取消；整段拖动没有原生拖拽参与，滚轮照常可用。
 */
function IssueBoard({ issues, onPatch, onOpen }: {
  issues: readonly Issue[];
  onPatch: (id: string, patch: IssuePatch) => void;
  onOpen: (id: string) => void;
}) {
  /** 正在拖动的卡片 id（null = 没在拖）。 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 当前落点列（null = 不在任何别的列上；同列不算落点）。 */
  const [dropState, setDropState] = useState<IssueState | null>(null);
  /** 按下卡片、还没过拖动阈值时的暂存（没过阈值就还是「点一下看详情」）。 */
  const pendingRef = useRef<PendingIssueDrag | null>(null);
  /** 拖动中鼠标的最后位置：滚轮 / 边缘自动滚时鼠标可以不动，落点按这个位置重算。 */
  const pointerRef = useRef({ x: 0, y: 0 });
  /** 拖动收尾那一下的 click 不当成「打开抽屉」。 */
  const suppressClickRef = useRef(false);
  /** 跟着鼠标走的拖动卡片：直接用 DOM 改 transform，不走 state（每帧都要动）。 */
  const ghostRef = useRef<HTMLDivElement | null>(null);
  /** 看板本体：拖到边缘自动滚按它找横向视口。 */
  const boardRef = useRef<HTMLDivElement | null>(null);
  /** 抓取偏移：按下时鼠标在卡片内的位置 + 卡片宽度，拖动卡按这个对齐。 */
  const grabRef = useRef({ dx: 0, dy: 0, width: 0 });
  /** 最新问题表 / 落点判定 / 落值回调（指针与每帧回调里读，免得闭包吃到旧值）。 */
  const issuesRef = useRef(issues);
  const dropStateAtRef = useRef<(x: number, y: number) => IssueState | null>(() => null);
  const patchRef = useRef(onPatch);

  /** 鼠标底下是「哪一列」：别的列才是落点 —— 同列放开不改状态，所以同列不给提示；指针压到看板左右边缘之外时
   *  夹回看板可视范围再判一次（同「任务进展」看板口径）。 */
  const dropStateAt = (x: number, y: number, issueId: string): IssueState | null => {
    const issue = issuesRef.current.find((item) => item.id === issueId);
    if (issue === undefined) {
      return null;
    }
    let column = dragColumnAtPoint(x, y);
    if (column === null) {
      const board = dragScrollAreaViewport(boardRef.current, "horizontal");
      if (board !== null) {
        const rect = board.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom && x >= rect.left - 64 && x <= rect.right + 64) {
          column = dragColumnAtPoint(Math.min(Math.max(x, rect.left + 1), rect.right - 1), y);
        }
      }
    }
    if (column === null) {
      return null;
    }
    const key = column.getAttribute("data-issue-column");
    if (key === null || key === issue.state) {
      return null;
    }
    return ISSUE_STATES.find((state) => state === key) ?? null;
  };

  // 三个「最新实现」的 ref：指针 / 每帧回调里读最新实现，免得闭包吃到上一轮的函数
  useEffect(() => {
    issuesRef.current = issues;
    patchRef.current = onPatch;
    dropStateAtRef.current = (x, y) => {
      const pending = pendingRef.current;
      return pending === null ? null : dropStateAt(x, y, pending.issueId);
    };
  });

  /**
   * 指针拖动（Push 210）：① 按下卡片后位移超过 DRAG_THRESHOLD 才算真拖动（没过阈值 = 点一下看详情）；
   * ② 拖动中鼠标动一下就更新落点；③ 放开时落在哪一列就交给 patchIssue 改状态；④ Esc / 指针取消 = 原地取消。
   * 整段拖动没有原生拖拽参与，所以滚轮照常可用。
   */
  useEffect(() => {
    /** 收尾（放开 / Esc / 指针取消）：清掉暂存与落点，恢复页面文字选择。 */
    const endDrag = () => {
      pendingRef.current = null;
      document.body.style.userSelect = "";
      setDraggingId(null);
      setDropState(null);
    };
    const handleMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const pending = pendingRef.current;
      if (pending === null || pending.dragging) {
        return;
      }
      if (Math.abs(event.clientX - pending.x) + Math.abs(event.clientY - pending.y) < DRAG_THRESHOLD) {
        return;
      }
      pending.dragging = true;
      try {
        // 指针捕获在卡片上：鼠标滑出窗口再放开也收得到 pointerup
        pending.node.setPointerCapture(pending.pointerId);
      } catch {
        // 指针已经不在了（例如刚抬起）：忽略，落点照样按下面的逻辑算
      }
      const rect = pending.node.getBoundingClientRect();
      grabRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width };
      document.body.style.userSelect = "none";
      suppressClickRef.current = true;
      setDraggingId(pending.issueId);
      setDropState(dropStateAtRef.current(event.clientX, event.clientY));
    };
    const handleUp = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending === null) {
        return;
      }
      const wasDragging = pending.dragging;
      const target = wasDragging ? dropStateAt(event.clientX, event.clientY, pending.issueId) : null;
      pendingRef.current = null;
      document.body.style.userSelect = "";
      setDraggingId(null);
      setDropState(null);
      if (!wasDragging || target === null) {
        return;
      }
      patchRef.current(pending.issueId, { state: target });
    };
    const handleCancel = () => {
      endDrag();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingRef.current !== null) {
        endDrag();
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  /** 拖动中按帧重算落点：鼠标可以不动、容器在滚（滚轮 / 边缘自动滚），槽位得跟着走。 */
  useEffect(() => {
    if (draggingId === null) {
      return;
    }
    let raf = window.requestAnimationFrame(function tick() {
      const ghost = ghostRef.current;
      if (ghost !== null) {
        const grab = grabRef.current;
        ghost.style.transform = "translate(" + (pointerRef.current.x - grab.dx) + "px," + (pointerRef.current.y - grab.dy) + "px)";
      }
      autoScrollIssueDrag(boardRef.current, pointerRef.current);
      const next = dropStateAtRef.current(pointerRef.current.x, pointerRef.current.y);
      setDropState((prev) => (prev === next ? prev : next));
      raf = window.requestAnimationFrame(tick);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [draggingId]);

  /** 按下卡片：先只记「可能拖动」，真拖动由上面的指针循环判定。 */
  const beginCardDrag = (issueId: string, node: HTMLElement, event: ReactPointerEvent<HTMLDivElement>) => {
    pendingRef.current = { issueId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, node, dragging: false };
    pointerRef.current = { x: event.clientX, y: event.clientY };
    suppressClickRef.current = false;
  };

  /** 点一下卡片 = 打开问题详情抽屉；拖动收尾那一下的 click 不算。 */
  const openIssueCard = (issueId: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpen(issueId);
  };

  /** 拖动中的那张问题（用来画跟着鼠标走的拖动卡）。 */
  const draggingIssue = draggingId === null ? null : issues.find((issue) => issue.id === draggingId) ?? null;

  return (
    <div data-issue-board="" ref={boardRef}>
      <ScrollArea axis="horizontal" ariaLabel="问题看板：横向滚动查看全部列" viewportClassName="pb-3" className="flex items-start gap-4">
        {ISSUE_STATES.map((state) => {
          const items = issues.filter((issue) => issue.state === state);
          const isTarget = dropState === state;
          return (
            <section
              key={state}
              data-issue-column={state}
              className={ISSUE_COLUMN + (isTarget ? " rounded-[28px] ring-2 ring-emerald-400/70 ring-offset-4 ring-offset-white" : "")}
            >
              <header className="mb-3 flex items-center gap-2 px-1">
                <IssueStateTag state={state} />
                <span className="shrink-0 text-xs text-zinc-400">{items.length}项</span>
              </header>
              <ScrollArea viewportClassName="min-h-0 flex-1" className="flex flex-col gap-3 pr-1" ariaLabel={"问题卡片：" + state}>
                {isTarget ? (
                  <div
                    data-issue-drop-slot="true"
                    className="flex items-center justify-center rounded-[35px] border-2 border-dashed border-emerald-400/70 bg-emerald-50/60 px-3 py-6 text-center text-[11px] font-medium text-emerald-700"
                  >
                    {"放开：移到「" + state + "」"}
                  </div>
                ) : null}
                {items.length === 0 ? (
                  isTarget ? null : (
                    <p className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-zinc-300 px-3 text-center text-xs text-zinc-400">
                      暂无问题
                    </p>
                  )
                ) : (
                  items.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onOpen={() => {
                        openIssueCard(issue.id);
                      }}
                      dragging={draggingId === issue.id}
                      onPointerDownDrag={beginCardDrag}
                    />
                  ))
                )}
              </ScrollArea>
            </section>
          );
        })}
      </ScrollArea>
      {draggingIssue === null ? null : (
        <div
          ref={ghostRef}
          data-drag-ghost="true"
          aria-hidden="true"
          style={{ width: grabRef.current.width === 0 ? undefined : grabRef.current.width }}
          className="pointer-events-none fixed left-0 top-0 z-50 will-change-transform"
        >
          <IssueCard issue={draggingIssue} ghost onOpen={() => undefined} />
        </div>
      )}
    </div>
  );
}

/** 问题追踪：一条问题一行的表格（Push 207 改版）。列口径 = 业务样「图五」六列 —— 日期 / 问题描述 / 问题归类 /
 *  解决方案或建议 / 问题附图 / 问题是否处理（列头带小图标）；撤「责任 / 处理时限 / 所属任务」（业务口径「责任这一栏
 *  不需要 删除吧」+「处理时限不需要 所属任务也不需要」）；「提出人」并进问题描述列的灰字小行（图五没有这一列，
 *  信息不丢）；「问题描述 / 解决方案或建议」按行换行（whitespace-pre-line —— 承接 Push 206 自动序号）。
 *  行样式 = 业务样「图六」（项目总览任务表）：白卡 + 圆角边框 + 列头 bg-zinc-50 小字 + 行 px-5 py-2.5 /
 *  divide-zinc-100 细分割线 / hover:bg-zinc-50/80。
 *  Push 217（业务口径 2026-09-29「问题追踪的卡片比例也要和日报记录的相同」+ 同批追加「这比例完全不一样啊 包括图片」）：
 *  整表**比例对齐「日报记录」** —— 列内边距 px-5 → px-4、单元格 py-2.5 → py-4（表头 px-4 py-3.5）、
 *  表头字号 xs → sm（text-zinc-500）、行补 align-top、行尾动作列 w-[88px] → w-20（px-4×2 + 48 = 80，与「日报记录」同槽位）；
 *  「问题附图」列图幅 md（40×40）→ **lg 大图瓦片**（约 128×96、多张折行 —— 与「日报记录 → 现场工作附图」同一档）、
 *  列宽 min-w-[130px] → 440；列口径 / 交互不变。
 *  Push 217 续（业务口径「问题归类去左侧一些这个间距不协调」+「这个在表格里面始终居中」）：
 *  「问题描述」列 min-w-[320px] → min-w-[240px] —— 收窄描述与「问题归类」之间的空档，归类列（及其后各列）随之前移；
 *  「问题是否处理」列单元格补 text-center —— 状态色签（InlineOptionCell 触发器 = 行内级盒）在列内**始终水平居中**；
 *  另（业务口径「会出现截断的问题」）：归类单元格改 `wrapContent` —— 包裹层撤 `truncate` 裁剪，窄窗 / 列被挤到最小时色签不再被裁掉一角。
 *  Push 207 同批追加「增加项目总览 同款醒目模式在问题追踪里面」：`focus` = 醒目模式开 —— 整行铺该问题状态的
 *  底色（ISSUE_ROW_CLASS · 6% / 悬停 12%，与项目总览任务表同一套口径），状态列只留深色字；关 = 原样。 */
function IssueTable({ issues, focus, onPatch, onDelete }: { issues: readonly Issue[]; focus: boolean; onPatch: (id: string, patch: IssuePatch) => void; onDelete: (issue: Issue) => void }) {
  return (
    <div data-issue-table="" className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            {ISSUE_TABLE_COLUMNS.map((column) => (
              <th key={column.key} data-issue-head={column.key} className="whitespace-nowrap border-b border-zinc-200 px-4 py-3.5 font-medium">
                {column.label}
              </th>
            ))}
            {/* Push 213（业务口径「日报记录 和 问题追随都要有删除按钮 … 请你看看有没有合适的位置」）：行尾动作列 ——
                与「日报记录」/ 任务表同一个 48px 槽位与同款 RowDeleteButton；删问题 = 连它来源的那篇日报一起删（同一篇日报整组）。 */}
            <th className="w-20 border-b border-zinc-200 px-4 py-3.5 font-medium">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {issues.map((issue) => (
            <tr key={issue.id} data-issue-row={issue.id} className={"group align-top transition-colors " + (focus ? ISSUE_ROW_CLASS[issue.state] : "hover:bg-zinc-50/80")}>
              <td className="whitespace-nowrap px-4 py-4 text-zinc-700">{cnDateOf(issue.raisedAt)}</td>
              <td className="min-w-[240px] px-4 py-4">
                {/* Push 217 续（业务口径「问题归类去左侧一些这个间距不协调」）：min-w 320 → 240 —— 收窄本列与
                    「问题归类」之间的空档，归类列（及其后各列）随之前移；描述 / 「提出人」小行仍按行换行，不截断。 */}
                {/* Push 208：问题描述行内可改 —— 文字修改需要点击保存，日期列（提出日期）不动 */}
                <InlineTextCell
                  bare
                  value={issue.title}
                  ariaLabel={"修改问题描述（" + issue.raisedAt + "）"}
                  triggerClassName={CELL_EDIT_TEXT}
                  placeholder="修改问题描述，点「保存」生效"
                  display={<span data-issue-title="" className="block whitespace-pre-line break-words leading-6 text-zinc-800">{issue.title}</span>}
                  onSave={(text) => {
                    onPatch(issue.id, { title: renumberLines(text) });
                  }}
                />
                <p className="mt-1 text-[11px] leading-4 text-zinc-400">提出人：{issue.reporter}</p>
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                {/* Push 208：问题归类行内可改 —— 浮层 = 表单侧同款多选（绿勾 · 点选不收浮层），落值按「、」连接 */}
                {/* Push 217 续③（业务口径「会出现截断的问题」）：wrapContent —— 撤包裹层 truncate 裁剪：窄窗 / 列被挤到
                    最小时色签不再被裁掉一角（色签折行 / 触发器内衬等其他表现不变，壳档位见 InlineCell）。 */}
                <InlineMultiOptionCell
                  bare
                  wrapContent
                  values={issue.categories}
                  options={ISSUE_CATEGORIES}
                  ariaLabel={"修改问题归类（" + issue.raisedAt + "）"}
                  renderLabel={categoryChip}
                  triggerClassName={CELL_EDIT_CHIP}
                  display={<CategoryTags values={issue.categories} />}
                  onChange={(values) => {
                    onPatch(issue.id, { categories: values });
                  }}
                />
              </td>
              <td className="min-w-[280px] px-4 py-4">
                {/* Push 208：解决方案或建议行内可改（文字列同款：点「保存」才落值） */}
                <InlineTextCell
                  bare
                  value={issue.solution}
                  ariaLabel={"修改解决方案或建议（" + issue.raisedAt + "）"}
                  triggerClassName={CELL_EDIT_TEXT}
                  placeholder="补充解决方案或建议，点「保存」生效"
                  display={<span data-issue-solution="" className="block whitespace-pre-line break-words leading-6 text-zinc-600">{issue.solution === "" ? "—" : issue.solution}</span>}
                  onSave={(text) => {
                    onPatch(issue.id, { solution: renumberLines(text) });
                  }}
                />
              </td>
              <td className="min-w-[440px] px-4 py-4">
                {/* 只读展示：附图增删在「日报填写」表单与问题详情抽屉里做（业务口径「太丑了 取消修改」）。
                    Push 217 续（业务口径「这比例完全不一样啊 包括图片」）：图幅 md（40×40）→ lg（约 128×96 大图瓦片、
                    多张自动折行、只出图不带文件名 —— 与「日报记录 → 现场工作附图」同一档），列宽同口径 min-w-[440px]。 */}
                {issue.photos.length === 0 ? <span className="text-zinc-400">—</span> : <PhotoStrip items={issue.photos} size="lg" />}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-center">
                {/* Push 217 续（业务口径「这个在表格里面始终居中」）：text-center —— 触发器是行内级盒（inline-flex），
                    状态色签在列内**始终水平居中**（三态 / 醒目模式 / 行内改后同款；列宽再变也不贴左沿）。 */}
                {/* Push 208：问题是否处理行内可改 —— 单态下拉（业务样 = 项目总览状态列那枚），色签壳直接复用 IssueStateTag */}
                <InlineOptionCell
                  bare
                  value={issue.state}
                  options={ISSUE_STATE_OPTIONS}
                  ariaLabel={"修改问题状态（" + issue.raisedAt + "）"}
                  triggerClassName={CELL_EDIT_CHIP}
                  display={<IssueStateTag state={issue.state} focus={focus} />}
                  onPick={(value) => {
                    onPatch(issue.id, { state: value as IssueState });
                  }}
                />
              </td>
              <td className="w-20 px-4 py-4" data-issue-delete-cell="">
                {/* 同上：预留 48px 动作槽位，幽灵态 24px → 悬停 48px 只在槽内长大，不推挤左侧列
                    （业务反馈「问题追踪的没做好 鼠标触碰表格会动」）。px-4(16×2) + 48 = 80 = w-20（Push 217 与「日报记录」同槽位）。 */}
                <span data-issue-delete-slot="" className="flex h-6 w-12 shrink-0 items-center">
                  <RowDeleteButton
                    label={"删除问题（" + issue.raisedAt + "）—— 会连同来源日报一起删除"}
                    onDelete={() => {
                      onDelete(issue);
                    }}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 自动下扩的多行框（Push 206 续 · 业务口径「换行很多时要自动下扩」）：行数多起来高度随内容长，不出内滚动条；
 *  高度下限 = rows 行（空框不塌），其余 props（data-field / 事件 / 样式）原样透传给原生 textarea。 */
function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const value = props.value;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    el.style.height = "auto";
    el.style.height = String(el.scrollHeight + (el.offsetHeight - el.clientHeight)) + "px";
  }, [value]);
  return <textarea {...props} ref={ref} />;
}

/** 关联阶段勾选清单（Push 198 表单侧口径 · 只服务「日报填写」表单 —— 「日报记录」的行内编辑浮层走
 *  九阶段复选行 —— 点一行勾 / 取消勾（**点选不收浮层**，可连着勾几个），值 = 勾选顺序的数组。
 *  dataField = 表单侧的 data-field 钩子（回放探针用）；行内浮层不传（浮层自带 data-inline-popover 钩子）。 */
function StageChecklist({
  values,
  onChange,
  dataField,
  boxClass,
}: {
  values: readonly string[];
  onChange: (next: string[]) => void;
  dataField?: string;
  boxClass: string;
}) {
  return (
    <div data-field={dataField} className={boxClass}>
      {REPORT_STAGES.map((stage) => {
        const checked = values.includes(stage);
        return (
          <label key={stage} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? values.filter((name) => name !== stage) : [...values, stage])}
              className="h-3.5 w-3.5 shrink-0 accent-zinc-900"
            />
            <span className="min-w-0 flex-1 truncate">{stage}</span>
          </label>
        );
      })}
    </div>
  );
}
/** 「日报填写」表单（字段按 A3-01；校验口径 A3-04 + Push 205：日期 + 当日完成工作 + 明日计划必填；
 *  「现场发现问题」= 前置开关 —— 非空时问题归类必填，且「问题归类 / 当前问题附图 / 解决方案或建议」三项才可填；
 *  Push 206 续：「当日完成工作 / 明日计划」自动序号 —— 聚焦预置 1: 、回车补下一行序号、失焦 / 提交前重排；
 *  四个多行框均走自动下扩（换行多时随内容长高 ——「换行很多时要自动下扩」）。
 *  Push 217（业务口径 2026-09-29「现场工作附图放在明日计划填写下面」）：块序调整 —— 「现场工作附图」移到
 *  「明日计划」正下方（原排「解决方案或建议」之后）；字段集 / 必填 / 交互口径不变。 */
function ReportFillForm({
  project,
  author,
  draft,
  submitting = false,
  onChange,
  onSubmit,
  onSaveDraft,
}: {
  project: Project;
  author: string;
  draft: ReportDraft;
  /** 提交 / 暂存请求在飞（Push 216 接真）：两枚按钮转「提交中…」并禁用。 */
  submitting?: boolean;
  onChange: (patch: Partial<ReportDraft>) => void;
  onSubmit: () => void;
  onSaveDraft: () => void;
}) {
  // 自动序号（Push 206 续）：判定「现场发现问题」有没有真填内容先剥掉行首序号 —— 空框只剩「1: 」不算填
  const issueFilled = renumberLines(draft.foundIssue) !== "";
  const missing: string[] = [];
  if (draft.dateIso === "") {
    missing.push("时间");
  }
  if (draft.doneWork.trim() === "") {
    missing.push("当日完成工作");
  }
  if (draft.plan.trim() === "") {
    missing.push("明日计划");
  }
  if (issueFilled && draft.issueCategories.length === 0) {
    missing.push("问题归类");
  }

  /** 回车「自动序号」（Push 206 续 · 业务口径「自动添加序号可以做到吗」；Push 207 同批扩到「解决方案或建议」·「这个也要1 2 3 同上」）：
   *  光标处插入「换行 + 下一行序号」（2: / 3: …）并补回光标。失焦 / 提交前还会统一 "renumberLines"
   *  重排 —— 中途删改、行序乱掉也能归位。 */
  const numberOnEnter = (field: "doneWork" | "plan" | "foundIssue" | "suggestion") => (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    const value = field === "doneWork" ? draft.doneWork : field === "plan" ? draft.plan : field === "foundIssue" ? draft.foundIssue : draft.suggestion;
    const caret = target.selectionStart === null ? value.length : target.selectionStart;
    const before = value.slice(0, caret);
    const insert = "\n" + String(before.split("\n").length + 1) + ": ";
    const nextValue = before + insert + value.slice(caret);
    onChange(field === "doneWork" ? { doneWork: nextValue } : field === "plan" ? { plan: nextValue } : field === "foundIssue" ? { foundIssue: nextValue } : { suggestion: nextValue });
    const nextCaret = before.length + insert.length;
    requestAnimationFrame(() => target.setSelectionRange(nextCaret, nextCaret));
  };

  return (
    <form
      data-fill-form="true"
      onSubmit={(event) => {
        event.preventDefault();
        if (missing.length === 0) {
          onSubmit();
        }
      }}
      className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className={FORM_LABEL}>项目名称</span>
          <span data-field="projectName" className="mt-1 flex items-center rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-2 text-sm text-zinc-600">
            {project.description}（{project.code}）
          </span>
        </label>
        <div className="block">
          <span className={FORM_LABEL}>
            时间<span className="ml-1 text-rose-500">*</span>
          </span>
          {/* 时间 = 站内日期选择器（与分类筛选 / 任务编辑同一套 DateRangePicker，单选模式），不用浏览器原生日期控件 */}
          <div data-field="date" className="mt-1">
            <DateRangePicker
              mode="single"
              value={draft.dateIso === "" ? null : { from: draft.dateIso, to: draft.dateIso }}
              onChange={(next) => onChange({ dateIso: next === null ? "" : next.from })}
              hintDate={draft.dateIso}
              placeholder="选择日期"
              ariaLabel="选择填报日期"
              triggerClassName="border-zinc-200 bg-white px-2.5! py-2 text-sm!"
            />
          </div>
        </div>
        <label className="block">
          <span className={FORM_LABEL}>提交人</span>
          <span data-field="author" className="mt-1 flex items-center rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-2 text-sm text-zinc-600">{author}</span>
        </label>
        <label className="block">
          <span className={FORM_LABEL}>今日施工人数</span>
          <input
            data-field="headcount"
            type="number"
            min="0"
            value={draft.headcount}
            onChange={(event) => onChange({ headcount: event.target.value })}
            placeholder="如 12"
            className={FORM_INPUT + " mt-1"}
          />
        </label>
      </div>

      <div>
        <span className={FORM_LABEL}>关联阶段</span>
        <span className="ml-2 text-[11px] text-zinc-400">可多选；标记「当日完成工作」对应的项目阶段</span>
        {/* Push 208：清单本体抽成 StageChecklist —— 「日报记录」的行内编辑浮层复用同一份（两处口径永远一致） */}
        <StageChecklist
          values={draft.stages}
          onChange={(next) => onChange({ stages: next })}
          dataField="stages"
          boxClass="mt-1 max-h-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1.5"
        />
      </div>

      <label className="block">
        <span className={FORM_LABEL}>
          当日完成工作Work completed today<span className="ml-1 text-rose-500">*</span>
        </span>
        {/* Push 202：表头补英文；占位提示按业务口径「算了 不要提示文字了」不落（无 placeholder）。
            Push 206：按图 4 复落的分点提示随后按业务口径「有了自动的扩展 那这个提示就不要了」撤回 ——
            不落静态提示（自动序号见空框聚焦预置「1: 」+ 回车续号） */}
        <GrowingTextarea
          data-field="doneWork"
          value={draft.doneWork}
          onChange={(event) => onChange({ doneWork: event.target.value })}
          onFocus={(event) => {
            // 自动序号（Push 206 续）：空框聚焦预置「1: 」，用户直接写内容、序号随回车自动排（没写内容失焦后还原为空）
            if (draft.doneWork === "") {
              onChange({ doneWork: "1: " });
              const target = event.currentTarget;
              requestAnimationFrame(() => target.setSelectionRange(target.value.length, target.value.length));
            }
          }}
          onBlur={() => {
            const next = renumberLines(draft.doneWork);
            if (next !== draft.doneWork) {
              onChange({ doneWork: next });
            }
          }}
          onKeyDown={numberOnEnter("doneWork")}
          rows={3}
          className={FORM_INPUT + " mt-1 resize-y"}
        />
      </label>

      <label className="block">
        {/* Push 202：表头补英文；占位提示按业务口径「算了 不要提示文字了」不落。
            Push 205：业务口径「明日计划也是必填项」—— 补红色必填星（A3-04 必填口径同步修订） */}
        <span className={FORM_LABEL}>
          明日计划Tomorrow's plan<span className="ml-1 text-rose-500">*</span>
        </span>
        <GrowingTextarea
          data-field="plan"
          value={draft.plan}
          onChange={(event) => onChange({ plan: event.target.value })}
          onFocus={(event) => {
            // 自动序号（Push 206 续）：同「当日完成工作」—— 空框聚焦预置「1: 」、回车自动排下一行序号
            if (draft.plan === "") {
              onChange({ plan: "1: " });
              const target = event.currentTarget;
              requestAnimationFrame(() => target.setSelectionRange(target.value.length, target.value.length));
            }
          }}
          onBlur={() => {
            const next = renumberLines(draft.plan);
            if (next !== draft.plan) {
              onChange({ plan: next });
            }
          }}
          onKeyDown={numberOnEnter("plan")}
          rows={2}
          className={FORM_INPUT + " mt-1 resize-y"}
        />
      </label>

      {/* Push 217（业务口径 2026-09-29「现场工作附图放在明日计划填写下面」）：整块移到「明日计划」正下方
          （原排「解决方案或建议」之后）；字段集 / 交互不变。 */}
      <div>
        <span className={FORM_LABEL}>现场工作附图</span>
        <div className="mt-1">
          <AttachmentPicker projectId={project.id} field="photos" items={draft.photos} onChange={(items) => onChange({ photos: items })} ariaLabel="现场工作附图：点击后 Ctrl+V 粘贴图片" />
        </div>
      </div>

      {/* Push 202：撤掉「现场发现问题」的琥珀色特殊底与琥珀字色（业务口径「这个也不用搞特殊 样式和别的保持一致」）——
          标签走 FORM_LABEL、说明走灰色小字，与其它字段同一套 */}
      <div>
        <label className="block">
          <span className={FORM_LABEL}>现场发现问题Problem</span>
          <span className="ml-2 text-[11px] text-zinc-400">填了这里，提交时会自动生成一条问题记录（未解决）</span>
          {/* Push 206 续：业务口径「这个现场问题也要同上」—— 补自动序号（空框聚焦预置 1: 、回车续号、失焦重排） */}
          <GrowingTextarea
            data-field="foundIssue"
            value={draft.foundIssue}
            onChange={(event) => onChange({ foundIssue: event.target.value })}
            onFocus={(event) => {
              // 自动序号：空框聚焦预置「1: 」，用户直接写内容、序号随回车自动排（没写内容失焦后还原为空）
              if (draft.foundIssue === "") {
                onChange({ foundIssue: "1: " });
                const target = event.currentTarget;
                requestAnimationFrame(() => target.setSelectionRange(target.value.length, target.value.length));
              }
            }}
            onBlur={() => {
              const next = renumberLines(draft.foundIssue);
              if (next !== draft.foundIssue) {
                onChange({ foundIssue: next });
              }
            }}
            onKeyDown={numberOnEnter("foundIssue")}
            rows={2}
            className={FORM_INPUT + " mt-1 resize-y"}
          />
        </label>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className={FORM_LABEL}>
              问题归类{issueFilled ? <span className="ml-1 text-rose-500">*</span> : null}
            </span>
            <div data-field="issueCategory" className="mt-1">
              <MultiSelectMenu
                values={draft.issueCategories}
                options={ISSUE_CATEGORIES}
                onChange={(next) => onChange({ issueCategories: next })}
                placeholder={issueFilled ? "请选择问题归类（可多选）" : "（「现场发现问题」非空时必填）"}
                disabled={issueFilled === false}
                ariaLabel="选择问题归类（可多选）"
              />
            </div>
          </label>
          <div>
            {/* Push 205：「现场发现问题」= 前置开关（业务口径「先填发现的问题 才能填另外三个」）—— 为空时本项禁用 */}
            <span className={FORM_LABEL}>当前问题附图</span>
            {issueFilled ? null : <span className="ml-2 text-[11px] text-zinc-400">（「现场发现问题」非空后可填）</span>}
            <div className="mt-1">
              <AttachmentPicker projectId={project.id} field="issuePhotos" items={draft.issuePhotos} onChange={(items) => onChange({ issuePhotos: items })} ariaLabel="当前问题附图：点击后 Ctrl+V 粘贴图片" disabled={issueFilled === false} />
            </div>
          </div>
        </div>
      </div>

      <label className="block">
        {/* Push 205：「现场发现问题」= 前置开关 —— 为空时本项禁用（灰底灰字，占位提示同「问题归类」禁用口径）。
            Push 207 追加（业务口径「这个也要1 2 3 同上」）：本框并进自动序号一套 —— 解禁后空框聚焦预置 1: 、
            回车续号、失焦重排（禁用态点不进来，预置自然不会触发） */}
        <span className={FORM_LABEL}>解决方案或建议</span>
        <GrowingTextarea
          data-field="suggestion"
          value={draft.suggestion}
          onChange={(event) => onChange({ suggestion: event.target.value })}
          onFocus={(event) => {
            // 自动序号（同「当日完成工作」一套）：空框聚焦预置「1: 」，用户直接写内容、序号随回车自动排
            if (draft.suggestion === "") {
              onChange({ suggestion: "1: " });
              const target = event.currentTarget;
              requestAnimationFrame(() => target.setSelectionRange(target.value.length, target.value.length));
            }
          }}
          onBlur={() => {
            const next = renumberLines(draft.suggestion);
            if (next !== draft.suggestion) {
              onChange({ suggestion: next });
            }
          }}
          onKeyDown={numberOnEnter("suggestion")}
          disabled={issueFilled === false}
          rows={2}
          placeholder={issueFilled ? "如：建议由采购联系供应商走补件流程" : "（「现场发现问题」非空后可填）"}
          className={FORM_INPUT + " mt-1 resize-y disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
        <button type="submit" data-action="submit" disabled={missing.length > 0 || submitting} className={BTN_PRIMARY}>
          {submitting ? "提交中…" : "提交日报"}
        </button>
        <button type="button" data-action="draft" onClick={onSaveDraft} disabled={draft.dateIso === "" || submitting} className={BTN_SECONDARY}>
          暂存草稿
        </button>
        <span data-fill-hint className={"text-xs " + (missing.length === 0 ? "text-zinc-400" : "text-rose-500")}>
          {missing.length === 0 ? "填写完成后提交；提交后可在「日报记录」里看到这一篇。" : "还差：" + missing.join("、")}
        </span>
      </div>
    </form>
  );
}

/** 「日报及问题」视图：页内四个键帽按钮（日报填写 / 日报记录 / 问题追踪 / 问题看板）+ 对应内容。 */
/** 抽屉关闭动画时长（同「任务详情抽屉」：先播 170ms 退场动画再真正卸载）。 */
const CLOSE_ANIMATION_MS = 170;

/** 问题详情抽屉（Push 209 · 业务口径 2026-09-28「点击要出现抽屉 是关于这个问题的日报内容」）：
 *  卡面只留摘要，点开抽屉看全量 —— 上半 = 问题本身（问题描述 / 问题归类 / 解决方案或建议 / 问题附图），下半 = 来源日报
 *  （当日完成工作 / 日期 / 填写者 / 明日计划 / 现场工作附图 / 问题是否处理 / 施工人数），
 *  中间 = 「关联阶段」一行（Push 212 起常显 —— 业务口径「只保留关联阶段 且不需要隐藏」：原「已隐藏 · 6」折叠区整块撤除，
 *  其余五枚次要字段下架；提出人在抽屉头部、来源日报在页脚本就有）。
 *  壳与交互动效复用「任务详情抽屉」那套（drawer-backdrop / drawer-panel 两枚全局类 + Esc / 点遮罩关闭 + 锁页面滚动）。
 *  Push 212 同批（业务口径「抽屉里面可以编辑内容」）：抽屉内**两块表能编辑的字段这里同样可编辑** —— 问题描述 / 问题归类 /
 *  解决方案或建议（IssuePatch）+ 关联阶段 / 当日完成工作 / 明日计划（ReportPatch）+ 问题是否处理（IssuePatch）；文字列点
 *  「保存」才落值、Esc / 点浮层外 = 取消（与两块表同一套 InlineEdit 口径）；日期 / 填写者 / 施工人数保持只读（「编辑后时间不变」）。
 *  续（业务口径「图片也要可以增删」）：问题附图 / 现场工作附图接 AttachmentPicker（与「日报填写」同款：点左半 Ctrl+V 粘贴 /
 *  右半选文件 = 增图，胶囊 / 瓦片上的 × = 删图），落值走 patchIssue({ photos }) / patchReport({ photos })。 */
function IssueDrawer({ projectId, issue, report, onPatchIssue, onPatchReport, onClose }: {
  projectId: string;
  issue: Issue;
  report: DailyReport | null;
  onPatchIssue: (id: string, patch: IssuePatch) => void;
  onPatchReport: (id: string, patch: ReportPatch) => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => lockBodyScroll(), [issue.id]);

  const requestClose = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [requestClose]);
  /** 上半：问题本身（业务样 = 图二前四行；Push 212 同批：前三行接行内编辑 —— 与「问题追踪」表同一套组件与落值口径）。 */
  const rows: { key: string; label: string; value: ReactNode }[] = [
    {
      key: "title",
      label: "问题描述",
      value: (
        <InlineTextCell
          bare
          value={issue.title}
          ariaLabel={"修改问题描述（" + issue.raisedAt + "）"}
          triggerClassName={CELL_EDIT_TEXT}
          placeholder="修改问题描述，点「保存」生效"
          display={<span data-issue-title="" className="block whitespace-pre-line break-words">{issue.title}</span>}
          onSave={(text) => {
            onPatchIssue(issue.id, { title: renumberLines(text) });
          }}
        />
      ),
    },
    {
      key: "category",
      label: "问题归类",
      value: (
        <InlineMultiOptionCell
          bare
          wrapContent
          values={issue.categories}
          options={ISSUE_CATEGORIES}
          ariaLabel={"修改问题归类（" + issue.raisedAt + "）"}
          renderLabel={categoryChip}
          triggerClassName={CELL_EDIT_CHIP}
          display={<CategoryTags values={issue.categories} />}
          onChange={(values) => {
            onPatchIssue(issue.id, { categories: values });
          }}
        />
      ),
    },
    {
      key: "solution",
      label: "解决方案或建议",
      value: (
        <InlineTextCell
          bare
          value={issue.solution}
          ariaLabel={"修改解决方案或建议（" + issue.raisedAt + "）"}
          triggerClassName={CELL_EDIT_TEXT}
          placeholder="补充解决方案或建议，点「保存」生效"
          display={<span data-issue-solution="" className="block whitespace-pre-line break-words">{issue.solution === "" ? "—" : issue.solution}</span>}
          onSave={(text) => {
            onPatchIssue(issue.id, { solution: renumberLines(text) });
          }}
        />
      ),
    },
    {
      key: "issuePhotos",
      label: "问题附图",
      // Push 212 续（业务口径「图片也要可以增删」）：与「日报填写 → 当前问题附图」同一套 AttachmentPicker —— 复制粘贴 / 选文件增图、
      // × 删图（改名随组件口径）；图幅沿用抽屉原样 md。
      value: (
        <AttachmentPicker
          projectId={projectId}
          variant="compact"
          field="issuePhotos"
          size="md"
          items={issue.photos}
          onChange={(items) => {
            onPatchIssue(issue.id, { photos: items });
          }}
          ariaLabel="问题附图：点击后 Ctrl+V 粘贴图片，或点右半选择文件"
        />
      ),
    },
  ];

  /** 下半：来源日报（问题是否处理 = 问题侧状态、施工人数 = 日报侧人数；业务样 = 图二后七行）。
   *  Push 212 同批：当日完成工作 / 明日计划 / 问题是否处理接行内编辑（与「日报记录」「问题追踪」同一套口径）。 */
  const reportRows: { key: string; label: string; value: ReactNode }[] =
    report === null
      ? [{ key: "report", label: "来源日报", value: <span className="text-zinc-400">未找到（原型内存态可能已复位）</span> }]
      : [
          {
            key: "doneWork",
            label: "当日完成工作",
            value: (
              <InlineTextCell
                bare
                value={report.doneWork}
                ariaLabel={"修改当日完成工作（" + report.date + "）"}
                triggerClassName={CELL_EDIT_TEXT}
                placeholder="填写当日完成的工作，点「保存」生效"
                display={<span data-report-done="" className="block whitespace-pre-line break-words">{report.doneWork === "" ? "—" : report.doneWork}</span>}
                onSave={(text) => {
                  onPatchReport(report.id, { doneWork: renumberLines(text) });
                }}
              />
            ),
          },
          { key: "date", label: "日期", value: cnDateOf(report.date) },
          {
            key: "author",
            label: "填写者",
            value: (
              <span className="flex items-center gap-1.5">
                <InitialAvatar name={report.author} />
                <span>{report.author}</span>
              </span>
            ),
          },
          {
            key: "plan",
            label: "明日计划",
            value: (
              <InlineTextCell
                bare
                value={report.plan}
                ariaLabel={"修改明日计划（" + report.date + "）"}
                triggerClassName={CELL_EDIT_TEXT}
                placeholder="填写明日计划，点「保存」生效"
                display={<span data-report-plan="" className="block whitespace-pre-line break-words">{report.plan === "" ? "—" : report.plan}</span>}
                onSave={(text) => {
                  onPatchReport(report.id, { plan: renumberLines(text) });
                }}
              />
            ),
          },
          {
            key: "reportPhotos",
            label: "现场工作附图",
            // Push 212 续（业务口径「图片也要可以增删」）：与「日报填写 → 现场工作附图」同一套 AttachmentPicker；图幅沿用抽屉原样 lg。
            value: (
              <AttachmentPicker
                projectId={projectId}
                variant="compact"
                field="photos"
                size="lg"
                items={report.photos}
                onChange={(items) => {
                  onPatchReport(report.id, { photos: items });
                }}
                ariaLabel="现场工作附图：点击后 Ctrl+V 粘贴图片，或点右半选择文件"
              />
            ),
          },
          {
            key: "state",
            label: "问题是否处理",
            value: (
              <InlineOptionCell
                bare
                value={issue.state}
                options={ISSUE_STATE_OPTIONS}
                ariaLabel={"修改问题状态（" + issue.raisedAt + "）"}
                triggerClassName={CELL_EDIT_CHIP}
                display={<IssueStateTag state={issue.state} />}
                onPick={(value) => {
                  onPatchIssue(issue.id, { state: value as IssueState });
                }}
              />
            ),
          },
          {
            key: "headcount",
            label: "施工人数",
            // Push 217 续⑤（业务口径「空用杠来表示 和之前项目总览的抽屉一样」）：headcount 是 number | null，
            // 没填（null）时直接 String() 会渲染出字面量「null」；空值改出灰杠 —— 与「项目总览」任务详情抽屉
            // 里同一字段的空态同一个样式（text-zinc-300 的 —）。
            // Push 217 续⑥（业务口径「施工人数抽屉也要可以编辑」）：接行内数字编辑 —— 与「项目总览」任务表 /
            // 任务抽屉同一套口径（InlineNumberCell：点开浮层、0 以上的整数、空 / 0 = 未填出杠、带「人」后缀）；
            // 落值走 PATCH .../reports/{id} 的 headcount（契约 number | null，null = 清空）。
            value: (
              <InlineNumberCell
                value={report.headcount ?? 0}
                ariaLabel={"修改施工人数（" + report.date + "）"}
                display={report.headcount === null || report.headcount === 0 ? <span className="text-zinc-300">—</span> : report.headcount + " 人"}
                onSave={(value) => {
                  onPatchReport(report.id, { headcount: value === 0 ? null : value });
                }}
              />
            ),
          },
        ];
  /** 中间区：只留「关联阶段」一行、常显（Push 212 · 业务口径「只保留关联阶段 且不需要隐藏」——
   *  原「已隐藏 · N」折叠区与其余五枚次要字段整块撤除）；同批接行内多选（与「日报记录」表同款九阶段清单）。 */
  const stagesRow: { key: string; label: string; value: ReactNode } = {
    key: "stages",
    label: "关联阶段",
    value:
      report === null ? (
        <span className="text-zinc-400">—</span>
      ) : (
        <InlineCell
          ariaLabel={"修改关联阶段（" + report.date + "）"}
          title="点击选择（可多选）"
          width={220}
          height={REPORT_STAGES.length * 30 + 12}
          bare
          triggerClassName={CELL_EDIT_TEXT}
          display={<StageTags names={report.stageNames} />}
          render={() => (
            <MultiOptionList
              values={report.stageNames}
              options={REPORT_STAGES}
              ariaLabel={"修改关联阶段（" + report.date + "）"}
              onChange={(next) => {
                onPatchReport(report.id, { stageNames: next });
              }}
              renderLabel={stageChip}
            />
          )}
        />
      ),
  };

  const rowView = (row: { key: string; label: string; value: ReactNode }) => (
    <div key={row.key} data-issue-field={row.key} className="grid grid-cols-[96px_1fr] items-start gap-x-4 border-b border-zinc-50 py-3 last:border-b-0">
      <dt className="pt-px text-xs leading-5 text-zinc-400">{row.label}</dt>
      <dd className="min-w-0 text-sm leading-5 text-zinc-800">{row.value}</dd>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50">
      <div
        className={"drawer-backdrop absolute inset-0 bg-zinc-900/25" + (closing ? " is-closing" : "")}
        onClick={requestClose}
        aria-hidden="true"
      />
      <aside
        data-issue-drawer=""
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-drawer-title"
        className={
          "drawer-panel absolute right-0 top-0 flex h-full w-[460px] max-w-[94vw] flex-col bg-white shadow-[-24px_0_60px_rgba(15,23,42,0.18)]" +
          (closing ? " is-closing" : "")
        }
      >        <header className="border-b border-zinc-100 px-6 pb-5 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500">问题详情</span>
              <IssueStateTag state={issue.state} />
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="关闭问题详情"
              className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h2 id="issue-drawer-title" className="mt-3.5 whitespace-pre-line break-words text-lg font-semibold leading-7 text-zinc-900">
            {issue.title}
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{cnDateOf(issue.raisedAt)} · {issue.reporter} 提出</p>
        </header>
        <ScrollArea viewportClassName="min-h-0 flex-1" className="px-6 py-1" ariaLabel="问题详情字段">
          <dl>{rows.map(rowView)}</dl>
          <dl>{rowView(stagesRow)}</dl>
          <dl>{reportRows.map(rowView)}</dl>
        </ScrollArea>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-100 px-6 py-3">
          <p className="text-[11px] text-zinc-400">来源日报：{issue.reportId}；点空白处或按 Esc 关闭</p>
        </footer>
      </aside>
    </div>
  );
}

export function ReportIssuePanel({ project, me, focusMode, sub, onChangeSub }: {
  project: Project;
  me: MeResponse;
  /** 醒目模式（Push 207 同批追加）：与项目总览**同一个账号偏好**（App 层持有、ProjectDetail 透传）；开关本体在标签栏最右侧，这里只吃值做表格呈现；null = 偏好尚未取到 → 按默认「关」渲染。 */
  focusMode?: boolean | null;
  /** 当前页内子视图（Push 214 起由地址 `?view=daily&sub=` 派生：form = 日报填写（缺省）/ records / issues / board）。 */
  sub: DailySubView;
  /** 切页内子视图（写回地址 · replace，不新增历史条目）。 */
  onChangeSub: (sub: DailySubView) => void;
}) {
  /** 当前子视图（地址是唯一来源：slug → 中文标签；不认识的取值已在路由层落回 form）。 */
  const subTab = SUB_TABS.find((tab) => SUB_TAB_KEYS[tab] === sub) ?? SUB_TABS[0];
  /** 醒目模式（Push 207 同批追加 ·「增加项目总览 同款醒目模式在问题追踪里面」）：投影到本地布尔（null = 关）。 */
  const focus = focusMode === true;
  /** 日报 / 问题（Push 216 接真：来自服务端；项目内成员读写）。 */
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  /** 首屏加载态（loading / ready / error）。 */
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  /** 最新两份数据（写回调里读最新 version，不随渲染闭包过期）。 */
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  /** 填写草稿（切子视图不丢；「暂存草稿」写库后保留内容，提交后复位）。 */
  const [draft, setDraft] = useState<ReportDraft>(() => emptyDraft());
  /** 当前表单对应的草稿行 id（Push 216：暂存 = 写库 state=draft；提交 = 把这条草稿 PATCH 成已提交；null = 还没暂存过）。 */
  const [draftId, setDraftId] = useState<string | null>(null);
  /** 写请求防重入（提交 / 暂存）。 */
  const [saving, setSaving] = useState(false);
  /** 操作提示（提交 / 暂存 / 删除 / 失败）。 */
  const [notice, setNotice] = useState<string>("");
  /** 问题详情抽屉（Push 209 · 业务口径「点击要出现抽屉 是关于这个问题的日报内容」）：存打开的问题 id，
   *  渲染时现找问题与来源日报 —— 行内编辑改过之后抽屉里也始终是最新值。 */
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);

  /** 拉取两份列表（首屏 / 写失败后重取）。 */
  const reload = useCallback(async () => {
    try {
      const [nextReports, nextIssues] = await Promise.all([fetchProjectReports(project.id), fetchProjectIssues(project.id)]);
      setReports(nextReports);
      setIssues(nextIssues);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setNotice(friendlyError(error, "日报 / 问题加载失败。"));
    }
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 行内编辑落值（Push 216 接真）：先本地乐观更新，PATCH 回包替换该行；失败提示并重取（409 乐观锁冲突同路）。
   *  日期 / 提交时间一律不碰（「编辑后时间不变」）；文字列在保存时统一过一遍自动序号（与「日报填写」提交口径一致）；
   *  「当日完成工作」是契约必填，清空会被服务端拒绝 —— 前端先拦。 */
  const patchReport = (id: string, patch: ReportPatch) => {
    if (patch.doneWork !== undefined && patch.doneWork === "") {
      setNotice("「当日完成工作」不能为空。");
      return;
    }
    const current = reportsRef.current.find((item) => item.id === id);
    if (current === undefined) {
      return;
    }
    setReports((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    void updateReport(project.id, id, reportUpdateBody(current, patch))
      .then((updated) => {
        setReports((previous) => previous.map((item) => (item.id === id ? updated : item)));
      })
      .catch((error) => {
        setNotice(friendlyError(error, "日报修改失败。"));
        void reload();
      });
  };

  /** 问题行内编辑落值（Push 216 接真）：同日报一套 —— 乐观更新 + PATCH 回包替换；提出日期不动。 */
  const patchIssue = (id: string, patch: IssuePatch) => {
    if (patch.title !== undefined && patch.title === "") {
      setNotice("「问题描述」不能为空。");
      return;
    }
    if (patch.categories !== undefined && patch.categories.length === 0) {
      setNotice("「问题归类」至少保留一项。");
      return;
    }
    const current = issuesRef.current.find((item) => item.id === id);
    if (current === undefined) {
      return;
    }
    setIssues((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    void updateIssue(project.id, id, issueUpdateBody(current, patch))
      .then((updated) => {
        setIssues((previous) => previous.map((item) => (item.id === id ? updated : item)));
      })
      .catch((error) => {
        setNotice(friendlyError(error, "问题修改失败。"));
        void reload();
      });
  };

  /** 删除日报（Push 216 接真）：服务端成对删除（连带派生问题）—— 本地按来源关系清两表、关掉被删的抽屉 / 表单草稿。 */
  const deleteReportUnit = (reportId: string) => {
    void deleteReport(project.id, reportId)
      .then(() => {
        setReports((previous) => previous.filter((item) => item.id !== reportId));
        setIssues((previous) => previous.filter((item) => item.reportId !== reportId));
        setOpenIssueId((current) => {
          if (current === null) {
            return current;
          }
          const open = issuesRef.current.find((item) => item.id === current);
          return open !== undefined && open.reportId === reportId ? null : current;
        });
        setDraftId((current) => (current === reportId ? null : current));
        setNotice("已删除该日报；它派生的全部问题随日报一起删除。");
      })
      .catch((error) => {
        setNotice(friendlyError(error, "日报删除失败。"));
        void reload();
      });
  };

  /** 问题侧删除（Push 216 接真）：服务端成对删除 —— 有来源日报连那篇日报整组删；无来源日报只摘这一条。 */
  const deleteIssueUnit = (issue: Issue) => {
    void deleteIssue(project.id, issue.id)
      .then((result) => {
        setIssues((previous) =>
          previous.filter((item) => item.id !== issue.id && (issue.reportId === "" || item.reportId !== issue.reportId)),
        );
        if (result.cascadedReportId !== null) {
          const cascaded = result.cascadedReportId;
          setReports((previous) => previous.filter((item) => item.id !== cascaded));
          setDraftId((current) => (current === cascaded ? null : current));
        }
        setOpenIssueId((current) => (current === issue.id ? null : current));
        setNotice(result.cascadedReportId === null ? "已删除该问题。" : "已删除该问题；来源日报随问题一起删除。");
      })
      .catch((error) => {
        setNotice(friendlyError(error, "问题删除失败。"));
        void reload();
      });
  };


  /** 抽屉要展示的问题 / 它的来源日报（现找现用）。 */
  const openIssue = openIssueId === null ? null : issues.find((item) => item.id === openIssueId) ?? null;
  const openIssueReport = openIssue === null ? null : reports.find((item) => item.id === openIssue.reportId) ?? null;

  const author = me.user.displayName ?? me.user.name ?? "未署名用户";

  /** 表单 → 契约日报写体（state 由调用方给；空值口径：plan / suggestion 空串清空 → null）。 */
  const draftWriteBody = (state: "draft" | "submitted"): ReportWriteInput => {
    const foundIssueText = renumberLines(draft.foundIssue);
    const headcount = Number.parseInt(draft.headcount, 10);
    const plan = renumberLines(draft.plan);
    const suggestion = renumberLines(draft.suggestion);
    return {
      date: draft.dateIso,
      state,
      headcount: Number.isFinite(headcount) ? headcount : null,
      doneWork: renumberLines(draft.doneWork),
      plan: plan === "" ? null : plan,
      foundIssue: foundIssueText === "" ? null : foundIssueText,
      issueCategories: foundIssueText === "" ? null : draft.issueCategories,
      suggestion: suggestion === "" ? null : suggestion,
      stageKeys: draft.stages.map(stageKeyOfName).filter((key): key is string => key !== null),
      photoFileIds: readyFileIds(draft.photos),
      issuePhotoFileIds: readyFileIds(draft.issuePhotos),
    };
  };

  /** 提交（已提交）：写库（有本表单草稿 = PATCH 把草稿提交，否则新建）→ 服务端按 A3-09 自动生成问题（幂等）；
   *  成功后重取两表、表单复位并切「日报记录」。 */
  const handleSubmit = () => {
    if (saving) {
      return;
    }
    const blocking = uploadBlockingMessage(draft);
    if (blocking !== "") {
      setNotice(blocking);
      return;
    }
    const body = draftWriteBody("submitted");
    const draftRow = draftId === null ? null : reportsRef.current.find((item) => item.id === draftId) ?? null;
    const dateCn = cnDateOf(draft.dateIso);
    const hasIssue = body.foundIssue !== null;
    setSaving(true);
    const write =
      draftRow === null
        ? createReport(project.id, createBody(body))
        : updateReport(project.id, draftRow.id, { ...withoutDate(body), version: draftRow.version });
    write
      .then(() => {
        setDraft(emptyDraft());
        setDraftId(null);
        setNotice(
          "已提交 " + dateCn + " 的日报" + (hasIssue ? "；「现场发现问题」已自动生成问题记录（未解决），见「问题追踪」/「问题看板」。" : "。"),
        );
        onChangeSub("records");
        return reload();
      })
      .catch((error) => {
        setNotice(friendlyError(error, "日报提交失败。"));
        void reload();
      })
      .finally(() => {
        setSaving(false);
      });
  };

  /** 暂存草稿（Push 216 接真 · 业务口径「接真后草稿到底写不写库 写」）：写库 state=draft（同日多条不设限；
   *  已有本表单草稿 = 更新那一条）；契约「当日完成工作」必填 —— 暂存同样先填，否则服务端 400。 */
  const handleSaveDraft = () => {
    if (saving) {
      return;
    }
    if (renumberLines(draft.doneWork) === "") {
      setNotice("暂存草稿也需要先填「当日完成工作」。");
      return;
    }
    const blocking = uploadBlockingMessage(draft);
    if (blocking !== "") {
      setNotice(blocking);
      return;
    }
    const body = draftWriteBody("draft");
    const draftRow = draftId === null ? null : reportsRef.current.find((item) => item.id === draftId) ?? null;
    setSaving(true);
    const write =
      draftRow === null
        ? createReport(project.id, createBody(body))
        : updateReport(project.id, draftRow.id, { ...withoutDate(body), version: draftRow.version });
    write
      .then((saved) => {
        if (draftRow === null) {
          setDraftId(saved.id);
        }
        setNotice("已暂存：草稿已写入「日报记录」（可继续修改，点「提交日报」后生效）。");
        return reload();
      })
      .catch((error) => {
        setNotice(friendlyError(error, "草稿暂存失败。"));
        void reload();
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const tabButton = (tab: SubTab) => {
    const active = tab === subTab;
    return (
      <button
        key={tab}
        type="button"
        data-subnav-item={tab}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          onChangeSub(SUB_TAB_KEYS[tab]);
          setNotice("");
        }}
        className={SUBNAV_KEY + " " + (active ? SUBNAV_KEY_CURRENT : SUBNAV_KEY_IDLE)}
      >
        {SUB_TAB_ICON[tab]}
        <span>{tab}</span>
      </button>
    );
  };

  return (
    // 列宽（业务口径「我只要日报填写页面居中然后尺寸舒适一点、像一个表单，其它的不变还是全屏」）：
    // 整块视图**全宽**（不封顶、不居中）—— 日报记录 / 问题追踪 / 问题看板 照旧铺满；
    // 只有「日报填写」那一块在下面单独收成居中窄栏。
    <div className="w-full space-y-5">
      {/* 页内导航栏（业务样张：四个键帽按钮，紧贴主标签栏下方一排，尺寸收紧）；
          Push 200 吸顶（业务口径「做吸顶效果」）；Push 201 修吸顶三处 bug（业务口径「图二吸顶后有bug」+「这里的字被吞掉了」
          +「这个中间有条缝可以有办法解决一下吗」）：滚动时叠在**主标签栏**下面 —— top = 122px（设计位 123 = 顶栏 64 + 主标签栏 59，
          **向上多叠 1px**）：吸顶条下边框在带缩放的屏上（Windows 150% 等）被按设备像素吸附成 0.67px，栏高 59 → 58.67、
          下沿实际落在 122.67 —— 钉 123 会露 0.33px 缝、滚动内容从缝里闪过；多叠的 1px 正好藏进主标签栏下边框（1x 下视觉不变）；
          站灰底 + 毛玻璃兜住滚动内容；
          下内衬 8 → 16px：原来装不下键帽的立体堆叠投影（最深 0.425em ≈ 5.5px + 落影 blur 0.5em ≈ 6.5px ≈ 12px），
          投影尾巴会糊到下方「日报记录」标题上、标题还被横幅下沿齐刷刷切一刀；
          **mb 用 +4px 而不是负值**：本面板是 space-y-5（Tailwind v4 的 space-y 走 margin-bottom，写在元素自身上）——
          负 mb 会把下面第一块内容拽进横幅里（上一版 -mb-4 = 下方内容被横幅盖住 16px，区块标题只剩几像素的「被吞」残影）；
          现在 底内衬 16 + mb 4 = 20px，正好是 space-y-5 的节奏：键帽、横幅、下方内容三者位置都回到设计值；
          -mx-6 / -mt-2 + 同值内衬抵消：横幅铺满行宽、键帽位置与原来一致；
          z-10（低于主标签栏 z-20）：往上滚时本条从主标签栏下面滑过去，不会反压住它。 */}
      <nav data-subnav="true" className="sticky top-[122px] z-10 -mx-6 -mt-2 mb-1 flex flex-wrap items-center gap-2 bg-[#f5f6f8]/95 px-6 pt-2 pb-4 backdrop-blur">
        {SUB_TABS.map((tab) => tabButton(tab))}
      </nav>

      {notice === "" ? null : (
        <p data-subnav-notice className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
          {notice}
        </p>
      )}

      {subTab === "日报填写" ? (
        /* 日报填写 = 居中窄栏（max-w-3xl = 768px，像一张表单）；其余三块子视图仍是全宽 */
        <div className="mx-auto w-full max-w-3xl">
          <ReportFillForm
            project={project}
            author={author}
            draft={draft}
            submitting={saving}
            onChange={(patch) => setDraft((previous) => ({ ...previous, ...patch }))}
            onSubmit={handleSubmit}
            onSaveDraft={handleSaveDraft}
          />
        </div>
      ) : loadState === "loading" ? (
        /* Push 216 接真：三个列表子视图共用同一份首屏加载态 */
        <EmptyCard text="加载中…" hint="正在从服务端取该项目的日报与问题记录。" />
      ) : loadState === "error" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white/50 px-6 py-12 text-center">
          <p className="text-sm text-zinc-500">日报 / 问题加载失败。</p>
          <button
            type="button"
            onClick={() => {
              setNotice("");
              void reload();
            }}
            className={BTN_SECONDARY}
          >
            重新加载
          </button>
        </div>
      ) : subTab === "日报记录" ? (
        <section className="space-y-3">
          <SectionHeader title="日报记录" hint={"共 " + String(reports.length) + " 篇 · 按日期倒序（新 → 旧）；「现场发现问题」非空会自动生成问题记录"} />
          {reports.length === 0 ? (
            <EmptyCard text="还没有日报。" hint="到「日报填写」填一篇并提交，这里就会出现。" />
          ) : (
            <ReportList reports={reports} onPatch={patchReport} onDelete={deleteReportUnit} />
          )}
        </section>
      ) : subTab === "问题追踪" ? (
        <section className="space-y-3">
          {/* 醒目模式开关不在这里：按业务口径「醒目模式放在标签导航栏的最右侧」由 ProjectDetail 渲染在主标签栏右侧工具区 */}
          <SectionHeader title="问题追踪" hint={"共 " + String(issues.length) + " 条 · 由日报「现场发现问题」自动生成，按提出日期倒序"} />
          {issues.length === 0 ? (
            <EmptyCard text="还没有问题记录。" hint="日报里填了「现场发现问题」并提交，这里就会自动落一条。" />
          ) : (
            <IssueTable issues={issues} focus={focus} onPatch={patchIssue} onDelete={deleteIssueUnit} />
          )}
        </section>
      ) : (
        <section className="space-y-3">
          <SectionHeader title="问题看板" hint="三态：未解决 → 处理中 → 已完成（空列保留；按住卡片拖到别的列 = 改状态）" />
          {issues.length === 0 ? (
            <EmptyCard text="还没有问题记录。" hint="日报里填了「现场发现问题」并提交，这里就会自动落一条。" />
          ) : (
            <IssueBoard issues={issues} onPatch={patchIssue} onOpen={(id) => { setOpenIssueId(id); }} />
          )}
        </section>
      )}

      {/* 问题详情抽屉（Push 209）：点看板卡片打开，Esc / 点遮罩关闭 */}
      {openIssue === null ? null : <IssueDrawer projectId={project.id} issue={openIssue} report={openIssueReport} onPatchIssue={patchIssue} onPatchReport={patchReport} onClose={() => { setOpenIssueId(null); }} />}
    </div>
  );
}
