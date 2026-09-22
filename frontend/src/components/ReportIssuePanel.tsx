import { useState } from "react";
import { DateRangePicker } from "./DateRangePicker";
import { SelectMenu, type SelectOption } from "./SelectMenu";
import type { ReactNode } from "react";
import {
  ISSUE_STATES,
  issuesForProject,
  reportsForProject,
  type DailyReport,
  type Issue,
  type IssueState,
  type ReportState,
} from "../data/reports";
import { ownersLabel, type ProjectTask } from "../data/tasks";
import type { MeResponse, Project } from "../types";

/**
 * 项目详情「日报及问题」视图（Push 128）：页内四块子视图 —— 日报填写 / 日报记录 / 问题追踪 / 问题看板。
 * - 顶部**页内导航栏**按业务给定样张（本批第 4 轮：四个**键帽按钮**（keycap），紧贴主标签栏下方一排）实现，替代原来的统计条；
 *   Tailwind 任意值等价还原样张的 styled-components 口径（浅灰面 + 0.5em 圆角 + em 口径的实心堆叠投影（键帽侧壁）+ 末层柔和落影，
 *   按下 translate 0.225em 并把堆叠压扁），尺寸按「大小不用太大」收紧为 13px 字号，**不引入 styled-components 依赖**。
 * - 数据口径承 `系统功能书.md` A3：日报字段 A3-01 / 草稿与补填 A3-02 / 提交校验 A3-04 / 自动生成问题 A3-09 / 问题四态 A3-10；处理时限 SLA 见 ADR-026。
 * - 内容列宽：视图整体**全宽**（日报记录 / 问题追踪 / 问题看板 照旧铺满）；只有「日报填写」收成**居中窄栏**
 *   （max-w-3xl = 768px），业务口径「我只要日报填写页面居中然后尺寸舒适一点、像一个表单，其它的不变还是全屏」。
 * - 「日报记录」= **列表 / 表格**（一行一篇；业务口径「日报记录还是做成列表 不要卡片」，原卡片网格已撤），列口径与原来
 *   的卡片一致（时间 + 状态签 + 提交时间 / 填写者 / 今日施工人数 / 关联任务 / 当日完成工作 / 明日计划 / 现场发现问题 /
 *   解决方案或建议 / 现场工作附图），与「问题追踪」同一套表壳（白底 + 圆角 + 行悬停），窄屏横向滚动。
 * - 原型阶段数据存浏览器内存（与任务覆盖表同一层，换项目 / 刷新即重置）：演示数据只挂在示例项目印度 `inmu-0010`，
 *   其余项目从空白开始；「日报填写」提交后**真的会**写进「日报记录」，含「现场发现问题」时按 A3-09 自动生成一条「未分组」问题。
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

/** 日报状态签（A3-02）：草稿 = 灰、已提交 = 绿、补填 = 蓝。 */
const REPORT_TAG_CLASS: Record<ReportState, string> = {
  草稿: "bg-zinc-200 text-zinc-600",
  已提交: "bg-emerald-100 text-emerald-700",
  补填: "bg-sky-100 text-sky-700",
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

/** 下拉选项：与任务抽屉（任务状态 / 紧急重要度）、甘特内筛选同一套 SelectMenu 口径。 */
const ISSUE_CATEGORY_OPTIONS: SelectOption[] = ISSUE_CATEGORIES.map((category) => ({ value: category, label: category }));

/** 表单小框（与任务表行内编辑同一套「白底 + 淡灰描边」口径）。 */
const FORM_INPUT =
  "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400";

/** 表单字段名（浅灰小字，与卡片字段名同一套层级）。 */
const FORM_LABEL = "text-xs font-medium text-zinc-500";

/** 主按钮（提交日报）。 */
const BTN_PRIMARY =
  "rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300";

/** 次按钮（暂存草稿）。 */
const BTN_SECONDARY =
  "rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300";

/** 页内导航栏的四块子视图（业务口径：第一块日报填写、第二块日报记录、第三块问题追踪、第四块问题看板）。 */
type SubTab = "日报填写" | "日报记录" | "问题追踪" | "问题看板";

const SUB_TABS: readonly SubTab[] = ["日报填写", "日报记录", "问题追踪", "问题看板"];

/** 导航项图标（描边口径，1.8px 线宽；按钮内统一 16px 线性图标 + 单行文字）。 */
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16M10 10v9" />
    </svg>
  ),
  问题看板: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <path d="M4.5 6A1.5 1.5 0 016 4.5h1.5A1.5 1.5 0 019 6v12a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 18V6z" />
      <path d="M15 6a1.5 1.5 0 011.5-1.5H18A1.5 1.5 0 0119.5 6v12a1.5 1.5 0 01-1.5 1.5h-1.5A1.5 1.5 0 0115 18V6z" />
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

/** 日报填写的表单草稿（字段按 A3-01；改子视图不清空，提交 / 暂存后复位）。 */
type ReportDraft = {
  /** 时间（填报日期，ISO） */
  dateIso: string;
  /** 今日施工人数（输入框里是字符串，提交时转数字） */
  headcount: string;
  doneWork: string;
  plan: string;
  foundIssue: string;
  issueCategory: string;
  suggestion: string;
  /** 关联任务（按任务描述多选） */
  tasks: string[];
  /** 现场工作附图（原型只记文件名） */
  photos: string[];
  /** 当前问题附图（「现场发现问题」非空时才填） */
  issuePhotos: string[];
};

/** 新建日报 / 问题的原型 id 序号（同一会话内不重号）。 */
let newReportSeq = 0;
let newIssueSeq = 0;

/** ISO 日期 → 源表口径「M月D日」（与任务日期列、演示日报同一套写法）。 */
function cnDateOf(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    return iso;
  }
  return String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
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
  return { dateIso: todayIso(), headcount: "", doneWork: "", plan: "", foundIssue: "", issueCategory: "", suggestion: "", tasks: [], photos: [], issuePhotos: [] };
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

/** 文件选择（原型：只记录文件名，正式版走站内文件库）。 */
function FilePicker({ field, fileNames, onChange }: { field: string; fileNames: readonly string[]; onChange: (names: string[]) => void }) {
  return (
    <div>
      <input
        data-field={field}
        type="file"
        multiple
        onChange={(event) => onChange(Array.from(event.target.files ?? []).map((file) => file.name))}
        className="block w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-500 transition file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
      />
      {fileNames.length === 0 ? null : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {fileNames.map((name) => (
            <span key={name} className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 「日报记录」的列口径（业务口径「做成列表 不要卡片」，字段仍是 A3-01）。 */
const REPORT_COLUMNS: readonly string[] = [
  "时间",
  "填写者",
  "今日施工人数",
  "关联任务",
  "当日完成工作",
  "明日计划",
  "现场发现问题",
  "解决方案或建议",
  "现场工作附图",
];

/** 一篇日报一行：**列表 / 表格**（业务口径「日报记录还是做成列表 不要卡片」），列内容与原来的卡片一致；
 *  表格壳与「问题追踪」同一套（白底 + 圆角边框 + 行悬停），窄屏横向滚动。现场发现问题非空时带出问题记录当前态。 */
function ReportList({ reports, issueByReport }: { reports: readonly DailyReport[]; issueByReport: Map<string, Issue> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full min-w-[1380px] border-collapse text-left text-xs">
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
            const issue = issueByReport.get(report.id);
            return (
              <tr key={report.id} data-report-row={report.id} className="align-top transition hover:bg-zinc-50/70">
                <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <p className="font-semibold text-zinc-900">{report.date}</p>
                    <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + REPORT_TAG_CLASS[report.state]}>{report.state}</span>
                  </span>
                  <p className="mt-0.5 text-[10px] text-zinc-400">提交 {report.submittedAt}</p>
                </td>
                <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <InitialAvatar name={report.author} />
                    <span className="truncate text-zinc-700">{report.author}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5 text-zinc-700">{report.headcount} 人</td>
                <td className="min-w-[150px] border-b border-zinc-100 px-3 py-2.5 leading-5 text-zinc-700">{report.tasks.length === 0 ? "—" : report.tasks.join("、")}</td>
                <td className="min-w-[210px] border-b border-zinc-100 px-3 py-2.5 leading-5 text-zinc-800">{report.doneWork === "" ? "—" : report.doneWork}</td>
                <td className="min-w-[180px] border-b border-zinc-100 px-3 py-2.5 leading-5 text-zinc-700">{report.plan === "" ? "—" : report.plan}</td>
                <td className="min-w-[250px] border-b border-zinc-100 px-3 py-2.5">
                  {report.foundIssue === "" ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    <div className="rounded-lg bg-amber-50/80 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-medium text-amber-700">现场发现问题</span>
                        {report.issueCategory === "" ? null : (
                          <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">{report.issueCategory}</span>
                        )}
                        <span data-report-issue-link={report.id} className="ml-auto text-[10px] text-zinc-500">
                          {issue === undefined ? "已生成问题记录" : "已生成问题记录 · " + issue.state}
                        </span>
                      </div>
                      <p className="mt-0.5 leading-5 text-zinc-700">{report.foundIssue}</p>
                    </div>
                  )}
                </td>
                <td className="min-w-[180px] border-b border-zinc-100 px-3 py-2.5 leading-5 text-zinc-700">{report.suggestion === "" ? "—" : report.suggestion}</td>
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
  tasks,
  draft,
  onChange,
  onSubmit,
  onSaveDraft,
}: {
  project: Project;
  author: string;
  tasks: readonly ProjectTask[];
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
  if (draft.foundIssue.trim() !== "" && draft.issueCategory === "") {
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
        <span className={FORM_LABEL}>关联任务</span>
        <span className="ml-2 text-[11px] text-zinc-400">可多选；「当日完成工作」关联任务后回写任务「项目进展描述」</span>
        <div data-field="tasks" className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1.5">
          {tasks.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-zinc-400">该项目还没有任务</p>
          ) : (
            tasks.map((task) => {
              const checked = draft.tasks.includes(task.title);
              return (
                <label key={task.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onChange({ tasks: checked ? draft.tasks.filter((title) => title !== task.title) : [...draft.tasks, task.title] })
                    }
                    className="h-3.5 w-3.5 shrink-0 accent-zinc-900"
                  />
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  <span className="shrink-0 text-[10px] text-zinc-400" title={ownersLabel(task.owners, task.ownersEn)}>{task.owners.length === 0 ? "待分配" : task.owners.join("、")}</span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <label className="block">
        <span className={FORM_LABEL}>
          当日完成工作<span className="ml-1 text-rose-500">*</span>
        </span>
        <textarea
          data-field="doneWork"
          value={draft.doneWork}
          onChange={(event) => onChange({ doneWork: event.target.value })}
          rows={3}
          placeholder="如：2 号巷道导轨安装完成 18 组，铜丝镶嵌抽检 6 处合格"
          className={FORM_INPUT + " mt-1 resize-y"}
        />
      </label>

      <label className="block">
        <span className={FORM_LABEL}>明日计划</span>
        <textarea
          data-field="plan"
          value={draft.plan}
          onChange={(event) => onChange({ plan: event.target.value })}
          rows={2}
          placeholder="如：继续 2 号巷道导轨安装，复核格口开口尺寸"
          className={FORM_INPUT + " mt-1 resize-y"}
        />
      </label>

      <div className="rounded-xl bg-amber-50/60 p-4">
        <label className="block">
          <span className="text-xs font-medium text-amber-700">现场发现问题</span>
          <span className="ml-2 text-[11px] text-amber-700/80">填了这里，提交时会自动生成一条问题记录（未分组）</span>
          <textarea
            data-field="foundIssue"
            value={draft.foundIssue}
            onChange={(event) => onChange({ foundIssue: event.target.value })}
            rows={2}
            placeholder="没有问题就留空"
            className={FORM_INPUT + " mt-1 resize-y"}
          />
        </label>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className={FORM_LABEL}>
              问题归类{issueFilled ? <span className="ml-1 text-rose-500">*</span> : null}
            </span>
            <div data-field="issueCategory" className="mt-1">
              <SelectMenu
                value={draft.issueCategory}
                options={ISSUE_CATEGORY_OPTIONS}
                onChange={(next) => onChange({ issueCategory: next })}
                placeholder={issueFilled ? "请选择问题归类" : "（「现场发现问题」非空时必填）"}
                disabled={issueFilled === false}
                ariaLabel="选择问题归类"
              />
            </div>
          </label>
          <div>
            <span className={FORM_LABEL}>当前问题附图</span>
            <div className="mt-1">
              <FilePicker field="issuePhotos" fileNames={draft.issuePhotos} onChange={(names) => onChange({ issuePhotos: names })} />
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
          <FilePicker field="photos" fileNames={draft.photos} onChange={(names) => onChange({ photos: names })} />
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
export function ReportIssuePanel({ project, me, tasks }: { project: Project; me: MeResponse; tasks: readonly ProjectTask[] }) {
  /** 当前子视图（业务口径：第一块日报填写，默认停在这一块）。 */
  const [subTab, setSubTab] = useState<SubTab>(SUB_TABS[0]);
  /** 日报 / 问题（原型内存态：演示数据 + 本次填写新提交的条目）。 */
  const [reports, setReports] = useState<DailyReport[]>(() => reportsForProject(project.id));
  const [issues, setIssues] = useState<Issue[]>(() => issuesForProject(project.id));
  /** 填写草稿（切子视图不丢；提交 / 暂存后复位）。 */
  const [draft, setDraft] = useState<ReportDraft>(() => emptyDraft());
  /** 提交后的提示（切子视图即清掉）。 */
  const [notice, setNotice] = useState<string>("");

  const author = me.user.displayName ?? me.user.name ?? "未署名用户";
  const issueByReport = new Map<string, Issue>(issues.map((issue) => [issue.reportId, issue]));

  /** 提交（已提交）或暂存（草稿）：两条路都写进「日报记录」；含「现场发现问题」时按 A3-09 自动生成一条问题。 */
  const handleSubmit = (state: ReportState) => {
    const dateCn = cnDateOf(draft.dateIso);
    const headcount = Number.parseInt(draft.headcount, 10);
    const report: DailyReport = {
      id: "r-new-" + String(++newReportSeq),
      date: dateCn,
      author,
      submittedAt: clockText(),
      state,
      headcount: Number.isFinite(headcount) ? headcount : 0,
      doneWork: draft.doneWork.trim(),
      plan: draft.plan.trim(),
      foundIssue: draft.foundIssue.trim(),
      issueCategory: draft.foundIssue.trim() === "" ? "" : draft.issueCategory,
      suggestion: draft.suggestion.trim(),
      tasks: draft.tasks,
      photos: draft.photos,
    };
    setReports((previous) => [report, ...previous]);

    let issueState: IssueState | null = null;
    if (state === "已提交" && report.foundIssue !== "") {
      const issue: Issue = {
        id: "i-new-" + String(++newIssueSeq),
        title: report.foundIssue,
        state: "未分组",
        category: report.issueCategory,
        reporter: author,
        owner: "",
        task: report.tasks.length === 0 ? "" : report.tasks[0],
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
      state === "草稿"
        ? "已暂存 " + dateCn + " 的草稿：可在「日报记录」里继续查看。"
        : "已提交 " + dateCn + " 的日报。" + (issueState === null ? "" : "「现场发现问题」已自动生成问题记录（" + issueState + "），见「问题追踪」/「问题看板」。"),
    );
    setSubTab("日报记录");
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
      {/* 页内导航栏（业务样张：四个键帽按钮，紧贴主标签栏下方一排，尺寸收紧） */}
      <nav data-subnav="true" className="flex flex-wrap items-center gap-2">
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
            tasks={tasks}
            draft={draft}
            onChange={(patch) => setDraft((previous) => ({ ...previous, ...patch }))}
            onSubmit={() => handleSubmit("已提交")}
            onSaveDraft={() => handleSubmit("草稿")}
          />
        </div>
      ) : subTab === "日报记录" ? (
        <section className="space-y-3">
          <SectionHeader title="日报记录" hint={"共 " + String(reports.length) + " 篇 · 按日期倒序（新 → 旧）；「现场发现问题」非空会自动生成问题记录"} />
          {reports.length === 0 ? (
            <EmptyCard text="还没有日报。" hint="到「日报填写」填一篇并提交，这里就会出现。" />
          ) : (
            <ReportList reports={reports} issueByReport={issueByReport} />
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
