import { useEffect, useRef, useState } from "react";
import { DateRangePicker } from "./DateRangePicker";
import { MultiSelectMenu } from "./SelectMenu";
import type { ReactNode } from "react";
import {
  ISSUE_STATES,
  issuesForProject,
  reportsForProject,
  type DailyReport,
  type Issue,
  type IssueState,
} from "../data/reports";
import { PROJECT_STAGES } from "../data/projects";
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
 * - 数据口径承 `系统功能书.md` A3：日报字段 A3-01 / 草稿与补填 A3-02 / 提交校验 A3-04 / 自动生成问题 A3-09 / 问题四态 A3-10；处理时限 SLA 见 ADR-026。
 * - 内容列宽：视图整体**全宽**（日报记录 / 问题追踪 / 问题看板 照旧铺满）；只有「日报填写」收成**居中窄栏**
 *   （max-w-3xl = 768px），业务口径「我只要日报填写页面居中然后尺寸舒适一点、像一个表单，其它的不变还是全屏」。
 * - 「日报记录」= **列表 / 表格**（一行一篇；业务口径「日报记录还是做成列表 不要卡片」，原卡片网格已撤），列口径 = 时间
 *   （+ 状态签 + 提交时间）/ 填写者 / 关联阶段 / 当日完成工作 / 明日计划 / 现场工作附图（Push 199 收窄 —— 业务口径
 *   2026-09-28「只保留 填写者 / 关联任务 / 当日完成工作 / 明日计划 / 现场附图」）——「今日施工人数 / 现场发现问题 /
 *   解决方案或建议」三列**不在列表展示**（表单字段 A3-01 与 A3-09 自动生成问题的口径不变）；
 *   与「问题追踪」同一套表壳（白底 + 圆角 + 行悬停），窄屏横向滚动。
 * - 原型阶段数据存浏览器内存（换项目 / 刷新即重置；任务域已接线，本模块随 M4 日报切片接线）：演示数据只挂在示例项目印度 `inmu-0010`，
 *   其余项目从空白开始；「日报填写」提交后**真的会**写进「日报记录」，含「现场发现问题」时按 A3-09 自动生成一条「未分组」问题。
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
 *      图 1 「明日计划」的必填星**未采纳** —— A3-04 必填口径不变；
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
 *      **左右分半（无说明文字）**：左半 = `ctrl v` 键帽（业务给样：搜索框键帽风 —— 点一下，Ctrl+V 直接粘图；截图 / 复制的图片文件都收；
 *      剪贴板图没有名字时按「剪贴板图片-N.png」命名）、右半 = 文件 / 云图标（点击选择文件，次入口，原生文件框仍在）；
 *      左半里放一个不可见的粘贴落点输入框 —— 浏览器只对有可编辑焦点的元素执行 Ctrl+V 粘贴命令，粘贴一律 preventDefault、不落文字；
 *      附件胶囊可逐个移除。
 */

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

/** 问题四态色签：未分组 = 灰（还没分派）、未解决 = 红、处理中 = 琥珀（同任务「进行中」）、已完成 = 绿。 */
const ISSUE_TAG_CLASS: Record<IssueState, string> = {
  未分组: "bg-zinc-200 text-zinc-600",
  未解决: "bg-rose-100 text-rose-700",
  处理中: "bg-amber-100 text-amber-800",
  已完成: "bg-emerald-100 text-emerald-700",
};

/** 问题看板列壳：四列固定宽度、横向排布，空列保留。 */
const ISSUE_COLUMN = "flex w-[300px] shrink-0 flex-col rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3";

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
  "其它",
];

/** 日报「关联阶段」可选项（Push 198）：九个施工阶段 —— 与项目总览分组 / 两块看板同一份口径（不含「项目总览」汇总视图）。 */
const REPORT_STAGES: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/** 表单小框（与任务表行内编辑同一套「白底 + 淡灰描边」口径）。 */
const FORM_INPUT =
  "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400";

/** 表单字段名（浅灰小字；Push 202「标题都标标粗」—— 字重 medium → bold）。 */
const FORM_LABEL = "text-xs font-bold text-zinc-500";

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
  /** 现场工作附图（原型只记文件名） */
  photos: string[];
  /** 当前问题附图（「现场发现问题」非空时才填） */
  issuePhotos: string[];
};

/** 新建日报 / 问题的原型 id 序号（同一会话内不重号）。 */
let newReportSeq = 0;
let newIssueSeq = 0;

/** ISO 日期 → 「YYYY年M月D日」（Push 202 起带年：业务口径「时间格式也要年月日」；原「M月D日」写法下架）。 */
function cnDateOf(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    return iso;
  }
  return String(Number(match[1])) + "年" + String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
}

/** ISO 日期 + N 天（问题处理时限用）。 */
function isoPlusDays(iso: string, days: number): string {
  const base = new Date(iso + "T00:00:00");
  base.setDate(base.getDate() + days);
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const day = String(base.getDate()).padStart(2, "0");
  return String(base.getFullYear()) + "-" + month + "-" + day;
}

/** 当天 ISO 日期（YYYY-MM-DD）。 */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return String(now.getFullYear()) + "-" + month + "-" + day;
}

/** 提交时间（HH:MM）。 */
function clockText(): string {
  const now = new Date();
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
}

/** 空表单：日期默认今天，其余留空。 */
function emptyDraft(): ReportDraft {
  return { dateIso: todayIso(), headcount: "", doneWork: "", plan: "", foundIssue: "", issueCategories: [], suggestion: "", stages: [], photos: [], issuePhotos: [] };
}

/** 字段行（浅灰字段名 + 深灰取值），与两块看板卡片同一套口径。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 flex min-w-0 items-baseline gap-2 text-xs">
      <span className="shrink-0 text-zinc-400">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
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

/** 附图图标（右半「点击选择文件」= 业务给的样：文件 + 云；fill=currentColor 随字色）。 */
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 1C9.73478 1 9.48043 1.10536 9.29289 1.29289L3.29289 7.29289C3.10536 7.48043 3 7.73478 3 8V20C3 21.6569 4.34315 23 6 23H7C7.55228 23 8 22.5523 8 22C8 21.4477 7.55228 21 7 21H6C5.44772 21 5 20.5523 5 20V9H10C10.5523 9 11 8.55228 11 8V3H18C18.5523 3 19 3.44772 19 4V9C19 9.55228 19.4477 10 20 10C20.5523 10 21 9.55228 21 9V4C21 2.34315 19.6569 1 18 1H10ZM9 7H6.41421L9 4.41421V7ZM14 15.5C14 14.1193 15.1193 13 16.5 13C17.8807 13 19 14.1193 19 15.5V16V17H20C21.1046 17 22 17.8954 22 19C22 20.1046 21.1046 21 20 21H13C11.8954 21 11 20.1046 11 19C11 17.8954 11.8954 17 13 17H14V16V15.5ZM16.5 11C14.142 11 12.2076 12.8136 12.0156 15.122C10.2825 15.5606 9 17.1305 9 19C9 21.2091 10.7909 23 13 23H20C22.2091 23 24 21.2091 24 19C24 17.1305 22.7175 15.5606 20.9844 15.122C20.7924 12.8136 18.858 11 16.5 11Z"
        fill="currentColor"
      />
    </svg>
  );
}
/** 附图选择（原型：只记文件名，正式版走站内文件库）。
 *  Push 202 同批续：以**复制粘贴**为主入口（业务口径「附图要可以复制粘贴 不能全靠选择文件 我们以复制粘贴为主」）——
 *  点一下虚线框拿到焦点，Ctrl+V 直接粘图（截图 / 复制的图片文件都收；剪贴板图没有名字时按「剪贴板图片-N.png」命名）；
 *  形态按业务给的样（虚线卡 + 文件 / 云图标）本地化：**一分为二** —— 左半「复制粘贴」（主入口）、右半「点击选择文件」（次入口）；
 *  两个贴图区同在一张表单时，Ctrl+V 只投给**最近点过**的那一个（armed 态在左半上可见）。 */
function AttachmentPicker({ field, fileNames, onChange, ariaLabel }: { field: string; fileNames: readonly string[]; onChange: (names: string[]) => void; ariaLabel: string }) {
  /** 本区是否是「最近点过的贴图区」——点一下左半（粘贴落点拿到焦点）置位，粘贴事件按它路由。 */
  const [armed, setArmed] = useState(false);
  /** 粘贴落点（左半里的不可见输入框：浏览器只对有可编辑焦点的元素执行 Ctrl+V 粘贴命令）。 */
  const sinkRef = useRef<HTMLInputElement | null>(null);
  /** 粘贴图命名序号（截图多数没有名字 → 剪贴板图片-1.png / -2.png …）。 */
  const pasteSeq = useRef(0);
  /** 最新 props（document 级粘贴监听不随每次输入重挂）。 */
  const latest = useRef({ fileNames, onChange });
  latest.current = { fileNames, onChange };

  /** 把一批新附件并进已有清单（粘贴与选文件共用；按现有顺序追加，同名不去重）。 */
  const appendNames = (names: readonly string[]) => {
    if (names.length === 0) {
      return;
    }
    latest.current.onChange(latest.current.fileNames.concat(names));
  };

  /** 剪贴板 / 文件框里的一批文件 → 文件名；其中没有图片时返回 false（不拦截这次粘贴）。 */
  const appendImages = (files: readonly File[]): boolean => {
    const images = files.filter((file) => file.type.indexOf("image/") === 0);
    if (images.length === 0) {
      return false;
    }
    appendNames(
      images.map((file) => {
        if (isClipboardGenericName(file.name) === false) {
          return file.name;
        }
        pasteSeq.current += 1;
        const slash = file.type.indexOf("/");
        return "剪贴板图片-" + String(pasteSeq.current) + "." + (slash >= 0 ? file.type.slice(slash + 1) : "png");
      }),
    );
    return true;
  };

  /** 一次粘贴：剪贴板里有图就留下（并 preventDefault，不让图片落成输入框内容）。 */
  const onPasteImage = (event: { clipboardData: DataTransfer | null; preventDefault: () => void }) => {
    if (appendImages(Array.from(event.clipboardData?.files ?? []))) {
      event.preventDefault();
    }
  };

  /** document 级粘贴监听：兜底 —— 焦点在别处（如刚点过右半）时，仍投给「最近点过的贴图区」。 */
  useEffect(() => {
    if (!armed) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      onPasteImage(event);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [armed]);

  return (
    <div>
      <div
        data-paste-zone={field}
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        onFocus={() => setArmed(true)}
        className={
          "overflow-hidden rounded-xl border border-dashed bg-white transition " +
          (armed ? "border-zinc-400 ring-2 ring-zinc-900/5" : "border-zinc-300 hover:border-zinc-400")
        }
      >
        <div className="grid grid-cols-2 divide-x divide-zinc-200 text-center">
          <div className="relative">
            <button
              type="button"
              data-paste-half=""
              aria-label="复制粘贴（点一下再按 Ctrl+V 粘图）"
              onClick={() => sinkRef.current?.focus()}
              className={"flex w-full items-center justify-center px-2 py-3 transition " + (armed ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600")}
            >
              <span className={"rounded-[3px] px-2 py-1 text-[11px] font-bold uppercase leading-none transition [background:linear-gradient(-225deg,#d5dbe4,#f8f8f8)] [box-shadow:inset_0_-2px_0_0_#cdcde6,inset_0_0_1px_1px_#fff,0_1px_2px_1px_rgba(30,35,90,0.4)] " + (armed ? "text-zinc-600" : "text-[#969faf]")}>
                ctrl v
              </span>
            </button>
            {/* 粘贴落点：不可见、不可点，只借它的可编辑焦点接浏览器的 Ctrl+V（粘贴被 preventDefault，不会落文字） */}
            <input
              ref={sinkRef}
              data-paste-sink=""
              data-paste-hint={armed ? "armed" : "idle"}
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
            aria-label="点击选择文件（可多选）"
            className="flex cursor-pointer items-center justify-center px-2 py-3 text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-600"
          >
            <UploadIcon />
            <input
              data-field={field}
              type="file"
              multiple
              onChange={(event) => {
                appendNames(Array.from(event.target.files ?? []).map((file) => file.name));
                event.target.value = "";
              }}
              className="hidden"
            />
          </label>
        </div>
      </div>      {fileNames.length === 0 ? null : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {fileNames.map((name, index) => (
            <span key={name + "#" + String(index)} data-attachment={name} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
              {name}
              <button
                type="button"
                data-action="remove-attachment"
                aria-label={"移除 " + name}
                onClick={() => onChange(fileNames.filter((_, at) => at !== index))}
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
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
 *  （Push 199 收窄后不再带问题记录当前态 —— 问题态仍在「问题追踪 / 问题看板」可查。） */
function ReportList({ reports }: { reports: readonly DailyReport[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-left text-xs">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            {REPORT_COLUMNS.map((title) => (
              <th key={title} className="whitespace-nowrap border-b border-zinc-200 px-3 py-2.5 font-medium">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            return (
              <tr key={report.id} data-report-row={report.id} className="align-top transition hover:bg-zinc-50/70">
                <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5">
                  {/* Push 202：时间列只留年月日（业务口径「时间格式也要年月日 具体提交时间不需要 已提交状态也不要」）——
                      状态签与「提交 HH:MM」小字一并下架（state 字段仍保留在数据模型里） */}
                  <p className="font-semibold text-zinc-900">{report.date}</p>
                </td>
                <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <InitialAvatar name={report.author} />
                    <span className="truncate text-zinc-700">{report.author}</span>
                  </span>
                </td>
                <td className="min-w-[150px] border-b border-zinc-100 px-3 py-2.5 leading-5 text-zinc-700">{report.stages.length === 0 ? "—" : report.stages.join("、")}</td>
                <td className="min-w-[210px] border-b border-zinc-100 px-3 py-2.5 leading-5 text-zinc-800">{report.doneWork === "" ? "—" : report.doneWork}</td>
                <td className="min-w-[180px] border-b border-zinc-100 px-3 py-2.5 leading-5 text-zinc-700">{report.plan === "" ? "—" : report.plan}</td>
                <td className="min-w-[120px] border-b border-zinc-100 px-3 py-2.5">
                  {report.photos.length === 0 ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {report.photos.map((photo) => (
                        <span key={photo} className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
                          {photo}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 一条问题记录（问题看板的一张卡）：未分组 = 还没分派责任（显示「待分派」）。 */
function IssueCard({ issue }: { issue: Issue }) {
  return (
    <div data-issue-card={issue.id} className={CARD_SHELL}>
      <span aria-hidden="true" className={CARD_NOISE} />
      <div className={CARD_BODY}>
        <div className="flex items-center gap-2">
          <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + ISSUE_TAG_CLASS[issue.state]}>{issue.state}</span>
          <span className="ml-auto text-[10px] text-zinc-400">{issue.reporter} 提出</span>
        </div>
        <p className="mt-1.5 text-sm font-bold leading-5 text-zinc-900">{issue.title}</p>
        <Field label="问题归类">
          <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700">
            {issue.category === "" ? "未归类" : issue.category}
          </span>
        </Field>
        <Field label="责任">
          {issue.owner === "" ? <span className="text-sm text-amber-600">待分派</span> : <span className="text-sm text-zinc-800">{issue.owner}</span>}
        </Field>
        <Field label="提出日期">
          <span className="text-sm text-zinc-800">{issue.raisedAt}</span>
        </Field>
        <Field label="处理时限">
          <span className="text-sm text-zinc-800">{issue.dueAt}</span>
        </Field>
        <Field label="所属任务">
          <span className="text-xs leading-5 text-zinc-800">{issue.task === "" ? "—" : issue.task}</span>
        </Field>
        {issue.solution === "" ? null : (
          <div className="mt-3 rounded-lg bg-emerald-50/70 px-2.5 py-2">
            <p className="text-[11px] font-medium text-emerald-700">解决方案 / 回复</p>
            <p className="mt-0.5 text-xs leading-5 text-zinc-700">{issue.solution}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** 问题追踪：一条问题一行的表格（列口径与问题看板卡片一致）。 */
function IssueTable({ issues }: { issues: readonly Issue[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            {["问题描述", "问题归类", "状态", "提出人", "提出日期", "处理时限", "责任", "所属任务", "解决方案 / 回复"].map((title) => (
              <th key={title} className="whitespace-nowrap border-b border-zinc-200 px-3 py-2.5 font-medium">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} data-issue-row={issue.id} className="align-top transition hover:bg-zinc-50/70">
              <td className="min-w-[260px] border-b border-zinc-100 px-3 py-2.5 font-medium text-zinc-800">{issue.title}</td>
              <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5">
                <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700">
                  {issue.category === "" ? "未归类" : issue.category}
                </span>
              </td>
              <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5">
                <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + ISSUE_TAG_CLASS[issue.state]}>{issue.state}</span>
              </td>
              <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5 text-zinc-700">{issue.reporter}</td>
              <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5 text-zinc-700">{issue.raisedAt}</td>
              <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5 text-zinc-700">{issue.dueAt}</td>
              <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5 text-zinc-700">
                {issue.owner === "" ? <span className="text-amber-600">待分派</span> : issue.owner}
              </td>
              <td className="min-w-[180px] border-b border-zinc-100 px-3 py-2.5 text-zinc-700">{issue.task === "" ? "—" : issue.task}</td>
              <td className="min-w-[240px] border-b border-zinc-100 px-3 py-2.5 text-zinc-600">{issue.solution === "" ? "—" : issue.solution}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 「日报填写」表单（字段按 A3-01；校验口径 A3-04：日期 + 当日完成工作必填，「现场发现问题」非空时问题归类必填）。 */
function ReportFillForm({
  project,
  author,
  draft,
  onChange,
  onSubmit,
  onSaveDraft,
}: {
  project: Project;
  author: string;
  draft: ReportDraft;
  onChange: (patch: Partial<ReportDraft>) => void;
  onSubmit: () => void;
  onSaveDraft: () => void;
}) {
  const missing: string[] = [];
  if (draft.dateIso === "") {
    missing.push("时间");
  }
  if (draft.doneWork.trim() === "") {
    missing.push("当日完成工作");
  }
  if (draft.foundIssue.trim() !== "" && draft.issueCategories.length === 0) {
    missing.push("问题归类");
  }
  const issueFilled = draft.foundIssue.trim() !== "";

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
        <div data-field="stages" className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1.5">
          {REPORT_STAGES.map((stage) => {
            const checked = draft.stages.includes(stage);
            return (
              <label key={stage} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({ stages: checked ? draft.stages.filter((name) => name !== stage) : [...draft.stages, stage] })
                  }
                  className="h-3.5 w-3.5 shrink-0 accent-zinc-900"
                />
                <span className="min-w-0 flex-1 truncate">{stage}</span>
              </label>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className={FORM_LABEL}>
          当日完成工作Work completed today<span className="ml-1 text-rose-500">*</span>
        </span>
        {/* Push 202：表头补英文；占位提示按业务口径「算了 不要提示文字了」不落（无 placeholder） */}
        <textarea
          data-field="doneWork"
          value={draft.doneWork}
          onChange={(event) => onChange({ doneWork: event.target.value })}
          rows={3}
          className={FORM_INPUT + " mt-1 resize-y"}
        />
      </label>

      <label className="block">
        {/* Push 202：表头补英文；占位提示按业务口径「算了 不要提示文字了」不落（图 1 的必填星同样未采纳 —— A3-04 口径不变） */}
        <span className={FORM_LABEL}>明日计划Tomorrow's plan</span>
        <textarea
          data-field="plan"
          value={draft.plan}
          onChange={(event) => onChange({ plan: event.target.value })}
          rows={2}
          className={FORM_INPUT + " mt-1 resize-y"}
        />
      </label>

      {/* Push 202：撤掉「现场发现问题」的琥珀色特殊底与琥珀字色（业务口径「这个也不用搞特殊 样式和别的保持一致」）——
          标签走 FORM_LABEL、说明走灰色小字，与其它字段同一套 */}
      <div>
        <label className="block">
          <span className={FORM_LABEL}>现场发现问题Problem</span>
          <span className="ml-2 text-[11px] text-zinc-400">填了这里，提交时会自动生成一条问题记录（未分组）</span>
          <textarea
            data-field="foundIssue"
            value={draft.foundIssue}
            onChange={(event) => onChange({ foundIssue: event.target.value })}
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
            <span className={FORM_LABEL}>当前问题附图</span>
            <div className="mt-1">
              <AttachmentPicker field="issuePhotos" fileNames={draft.issuePhotos} onChange={(names) => onChange({ issuePhotos: names })} ariaLabel="当前问题附图：点击后 Ctrl+V 粘贴图片" />
            </div>
          </div>
        </div>
      </div>

      <label className="block">
        <span className={FORM_LABEL}>解决方案或建议</span>
        <textarea
          data-field="suggestion"
          value={draft.suggestion}
          onChange={(event) => onChange({ suggestion: event.target.value })}
          rows={2}
          placeholder="如：建议由采购联系供应商走补件流程"
          className={FORM_INPUT + " mt-1 resize-y"}
        />
      </label>

      <div>
        <span className={FORM_LABEL}>现场工作附图</span>
        <div className="mt-1">
          <AttachmentPicker field="photos" fileNames={draft.photos} onChange={(names) => onChange({ photos: names })} ariaLabel="现场工作附图：点击后 Ctrl+V 粘贴图片" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
        <button type="submit" data-action="submit" disabled={missing.length > 0} className={BTN_PRIMARY}>
          提交日报
        </button>
        <button type="button" data-action="draft" onClick={onSaveDraft} disabled={draft.dateIso === ""} className={BTN_SECONDARY}>
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
export function ReportIssuePanel({ project, me }: { project: Project; me: MeResponse }) {
  /** 当前子视图（业务口径：第一块日报填写，默认停在这一块）。 */
  const [subTab, setSubTab] = useState<SubTab>(SUB_TABS[0]);
  /** 日报 / 问题（原型内存态：演示数据 + 本次填写新提交的条目）。 */
  const [reports, setReports] = useState<DailyReport[]>(() => reportsForProject(project.id));
  const [issues, setIssues] = useState<Issue[]>(() => issuesForProject(project.id));
  /** 填写草稿（切子视图不丢；「暂存草稿」保留内容，提交后复位）。 */
  const [draft, setDraft] = useState<ReportDraft>(() => emptyDraft());
  /** 提交后的提示（切子视图即清掉）。 */
  const [notice, setNotice] = useState<string>("");

  const author = me.user.displayName ?? me.user.name ?? "未署名用户";

  /** 提交（已提交）：写进「日报记录」；含「现场发现问题」时按 A3-09 自动生成一条问题；表单复位并切到「日报记录」。 */
  const handleSubmit = () => {
    const dateCn = cnDateOf(draft.dateIso);
    const headcount = Number.parseInt(draft.headcount, 10);
    const report: DailyReport = {
      id: "r-new-" + String(++newReportSeq),
      date: dateCn,
      author,
      submittedAt: clockText(),
      state: "已提交",
      headcount: Number.isFinite(headcount) ? headcount : 0,
      doneWork: draft.doneWork.trim(),
      plan: draft.plan.trim(),
      foundIssue: draft.foundIssue.trim(),
      // Push 202：问题归类可多选 —— 原型存储口径 = 多值顿号连接（单值列 `issue_category` 的多值修订挂 wmj 线）
      issueCategory: draft.foundIssue.trim() === "" ? "" : draft.issueCategories.join("、"),
      suggestion: draft.suggestion.trim(),
      stages: draft.stages,
      photos: draft.photos,
    };
    setReports((previous) => [report, ...previous]);

    let issueState: IssueState | null = null;
    if (report.foundIssue !== "") {
      const issue: Issue = {
        id: "i-new-" + String(++newIssueSeq),
        title: report.foundIssue,
        state: "未分组",
        category: report.issueCategory,
        reporter: author,
        owner: "",
        // Push 198：关联单位改为阶段后，自动生成的问题不再带「所属任务」（口径修订见 前端功能需求.md §3.8 A21）
        task: "",
        raisedAt: dateCn,
        dueAt: cnDateOf(isoPlusDays(draft.dateIso, 2)),
        solution: "",
        reportId: report.id,
      };
      setIssues((previous) => [issue, ...previous]);
      issueState = issue.state;
    }

    setDraft(emptyDraft());
    setNotice(
      "已提交 " + dateCn + " 的日报。" + (issueState === null ? "" : "「现场发现问题」已自动生成问题记录（" + issueState + "），见「问题追踪」/「问题看板」。"),
    );
    setSubTab("日报记录");
  };

  /** 暂存草稿（Push 202 修订）：不写「日报记录」、不切子视图、**不清表单** —— 只保留表单里已填内容 + 顶部提示
   *  （业务口径「点击暂存草稿就暂存在日报填写页面吧 … 暂存就保留表单里面填的内容皆可」；原「左侧草稿卡片」方案已撤回）。 */
  const handleSaveDraft = () => {
    setNotice("已暂存：内容保留在表单里，可继续修改；提交后才写进「日报记录」。");
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
          setSubTab(tab);
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
            onChange={(patch) => setDraft((previous) => ({ ...previous, ...patch }))}
            onSubmit={handleSubmit}
            onSaveDraft={handleSaveDraft}
          />
        </div>
      ) : subTab === "日报记录" ? (
        <section className="space-y-3">
          <SectionHeader title="日报记录" hint={"共 " + String(reports.length) + " 篇 · 按日期倒序（新 → 旧）；「现场发现问题」非空会自动生成问题记录"} />
          {reports.length === 0 ? (
            <EmptyCard text="还没有日报。" hint="到「日报填写」填一篇并提交，这里就会出现。" />
          ) : (
            <ReportList reports={reports} />
          )}
        </section>
      ) : subTab === "问题追踪" ? (
        <section className="space-y-3">
          <SectionHeader title="问题追踪" hint={"共 " + String(issues.length) + " 条 · 由日报「现场发现问题」自动生成，按提出日期倒序"} />
          {issues.length === 0 ? (
            <EmptyCard text="还没有问题记录。" hint="日报里填了「现场发现问题」并提交，这里就会自动落一条。" />
          ) : (
            <IssueTable issues={issues} />
          )}
        </section>
      ) : (
        <section className="space-y-3">
          <SectionHeader title="问题看板" hint="四态：未分组 → 未解决 → 处理中 → 已完成（空列保留）" />
          {issues.length === 0 ? (
            <EmptyCard text="还没有问题记录。" hint="日报里填了「现场发现问题」并提交，这里就会自动落一条。" />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {ISSUE_STATES.map((state) => {
                const items = issues.filter((issue) => issue.state === state);
                return (
                  <section key={state} data-issue-column={state} className={ISSUE_COLUMN}>
                    <div className="flex items-center gap-2">
                      <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + ISSUE_TAG_CLASS[state]}>{state}</span>
                      <span className="ml-auto text-xs text-zinc-400">{items.length} 项</span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {items.length === 0 ? (
                        <p className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-zinc-300 px-3 text-center text-xs text-zinc-400">
                          暂无问题
                        </p>
                      ) : (
                        items.map((issue) => <IssueCard key={issue.id} issue={issue} />)
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
