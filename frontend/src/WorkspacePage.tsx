/**
 * 工作台「我的任务」页（系统功能书 A6-01 / A6-03；M6-06 前端接线 · Push 230；任务表扩列 · Push 231；面板头「进入项目」深链 + 醒目模式 · Push 232）。
 * 口径复评（2026-09-30 · 业务：「不能有 7 天内时间限制」「时间不限制 另外项目经理是我也要算在我的任务」）：
 * 「我的任务」= 未完成 且（任务负责人含我 或 项目项目经理含我）、不限完成日期窗口；未排期（无预计完成日期）单列一组。
 *
 * 业务口径（2026-09-30）：「同样做标签导航栏 我的任务 我提出的问题先做这两个」→「是这个页面导航栏」（指任务模板页
 * 的下划线标签栏，本页照同一套材质 —— 文字 + 选中下划线、无图标）→「我的任务 是折叠面板 未展开是项目名称和编号
 * 下拉是具体我的任务」→「我提出的问题就参考日报的问题追踪即可 也是折叠面板」→「表格内容要全」（问题表照
 * 「问题追踪」的完整六列：日期 / 问题描述 / 问题归类 / 解决方案或建议 / 问题附图 / 问题是否处理）→「直接把这个搬到
 * 我的任务不就好了」（任务表行口径照项目页任务表）→「这些字段一个不能少懂吗」（Push 231：任务表 = 项目页任务表
 * 全 15 列 —— 任务描述 / 项目经理 / 任务负责人 / 任务状态 / 紧急重要度 / 是否按时交付 / 输出成果文件 / 文件 /
 * 项目进展描述 / 开始日期 / 预计所需天数（窄列，表头空）/ 预计完成日期 / 预计所需施工人数 / 实际完成日期 / 变更关联）。
 * 表仍是**只读** —— 工作台读面不带任务 version，不挂项目页那套点开编辑。折叠面板头常驻**「进入项目」**按钮
 * （Push 232 · 业务口径「增加进入项目按钮」）：落点由调用方给定 —— 「我的任务」= 项目详情缺省标签「项目总览」
 * `#/project/{id}`；「我提出的问题」= 该项目「日报及问题 → 日报记录」（Push 242，见下条）；按钮在面板头右侧、
 * 不参与展开收起。
 *
 * Push 242（业务口径 2026-10-08「这个页面的列要对齐吧 不然不美观」+「删除在项目中查看 进入项目直接进入日报记录页面
 * 替代在项目中查看」）「我提出的问题」两处调整：① 问题表改 **`table-fixed` + `<colgroup>` 固定列宽** —— 各项目
 * 折叠面板的同名列一一对齐（原 `table-auto` 按各自内容算宽，换一个项目列就飘）；② 行尾「在项目中查看」下架，
 * 进入项目的入口收敛到面板头「进入项目」（定标 = 该项目「日报记录」）。
 *
 * 「我的计划」标签（Push 234 · 业务口径「增加一个我的计划页面」→「你只要把导航栏设计好 后续详细设计再说」）：
 * 导航栏第三枚标签 + 路由 `?tab=plan` 本刀就位；页面内容（数据口径 / 布局）随后续详细设计再做 —— 本刀只落登记卡。
 *
 * 醒目模式（Push 232 · 业务口径「同样增加醒目模式」）：开关本体在**标签导航栏最右侧**（同项目总览 / 问题追踪口径
 * 「醒目模式放在标签导航栏的最右侧」），吃的是同一个账号偏好 `focusMode`（App 层持有 / 单键 PATCH、跨设备记忆；
 * 本页只读值、失败走页内提示条）。开 = 任务表整行铺该任务状态底色 + 状态胶囊收口成深色字（TaskBoard 同款两张色表
 * `STATUS_ROW_CLASS` / `STATUS_TAG_TEXT_CLASS`）；切到「我提出的问题」同款（`ISSUE_ROW_CLASS` / `ISSUE_TAG_TEXT_CLASS`）。
 *
 * 数据：
 * - 读面 = GET /api/v1/workspace（frontend/src/workspaceApi.ts）—— 跨项目个人读面，仅会话、无项目路径参数。
 *   四组任务并进本页「按项目」折叠面板：项目顺序 = 组序（已逾期 → 今日待办 → 即将到期 → 未排期）里的首次出现顺序
 *   （最急的在最上），组内保持服务端 plannedEnd 升序；分组 / 排序全由服务端给定，本页不做任何本地日期推导。
 * - 任务表 15 列里聚合读面只带 9 列：项目经理 / 成果文件 / 文件 / 进展描述 / 天数 / 人数 / 按时交付（onTime）/
 *   变更关联**不在 A31 第一刀里** —— 按项目向源接口（GET /projects/{id}/tasks + GET /projects/{id}）回填，
 *   按任务 / 项目 id 对齐（任务表要全，见 useTaskFull）。
 * - 「我提出的问题」四列（日期 / 描述 / 归类 / 状态）来自聚合读面；**「解决方案或建议 / 问题附图」不在 A31 第一刀里** ——
 *   按项目向源接口（GET /api/v1/projects/{id}/issues）回填，按问题 id 对齐（问题表要全，见 useIssueFull）。
 *
 * 标签走地址（`#/my-tasks?tab=raised`，缺省「我的任务」不落参数）—— 与列表筛选态 / 详情页子视图同一口径。
 * 待办（下一刀，业务未提）：「我处理的问题」栏（契约 myIssues.handling 已下发）、工作台内问题快速流转 / 关闭
 * （契约保留 version 正是为此）、任务级深链 `?task=`（一键开任务详情抽屉）。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { AppHeader } from "./components/AppHeader";
import { FocusModeToggle } from "./components/FocusModeToggle";
import { ISSUE_CATEGORY_CLASS, ISSUE_ROW_CLASS, ISSUE_TAG_CLASS, ISSUE_TAG_TEXT_CLASS } from "./components/ReportIssuePanel";
import { PRIORITY_CAPSULE_CLASS, STATUS_CAPSULE_CLASS, STATUS_ROW_CLASS, STATUS_TAG_TEXT_CLASS, resolveColumns, type ColumnDef, type ColumnKey } from "./components/TaskBoard";
import { TrackerDots } from "./components/Tracker";
import { docTypeCapsule } from "./components/DeliverablePicker";
import { dateOnlyText, daysBetweenInclusive } from "./data/tasks";
import type { ReportPhoto } from "./data/reports";
import { usePhotoUrl } from "./fileApi";
import { fetchProject } from "./projectApi";
import { fetchProjectIssues, ISSUE_STATE_NAMES } from "./reportApi";
import { displayStatusLabel, fetchProjectTasks, stageNameOf, type ApiTaskListItem } from "./taskApi";
import { fetchWorkspace, type ApiWorkspace, type ApiWorkspaceIssue, type ApiWorkspaceTask } from "./workspaceApi";
import type { WorkspaceOpenProjects } from "./preferencesApi";
import { projectViewHref, type WorkspaceTab } from "./useHashRoute";
import type { MeResponse } from "./types";

type WorkspacePageProps = {
  me: MeResponse;
  /** 当前标签（地址派生：`#/my-tasks` 缺省「我的任务」/ `#/my-tasks?tab=raised`「我提出的问题」）。 */
  tab: WorkspaceTab;
  /** 切标签：同步渲染并写回地址（replace，不新增历史条目）。 */
  onChangeTab: (tab: WorkspaceTab) => void;
  /** 醒目模式（Push 232 · 业务口径「同样增加醒目模式」）：与项目总览 / 问题追踪同一个账号偏好；null / 缺省 = 偏好尚未取到（按默认「关」渲染，不回写）。 */
  focusMode?: boolean | null;
  /** 保存醒目模式（单键 PATCH）；返回 null = 成功，返回文案 = 失败提示。不传 = 开关只读（偏好落库仍走服务端）。 */
  onFocusModeChange?: (value: boolean) => Promise<string | null>;
  /** 工作台折叠面板展开态（A31 · Push 233 · 业务口径「这个下拉要有记忆」）：按标签分记已展开的项目 id；null / 缺省 = 偏好尚未取到（按全收起渲染，不回写）。 */
  workspaceOpenProjects?: WorkspaceOpenProjects | null;
  /** 保存展开态（单键 PATCH）；返回 null = 成功，返回文案 = 失败提示。不传 = 不做服务端记忆（展开态仅本页内存）。 */
  onWorkspaceOpenProjectsChange?: (value: WorkspaceOpenProjects) => Promise<string | null>;
};

/** 工作台三态（首屏加载 / 失败 / 就绪）—— 与「日报及问题」三个列表子视图同一套口径。 */
type WorkspaceState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: ApiWorkspace };

/** 任务四组：本页展示顺序 = 最急的「已逾期」在最前、未排期（无日期）收尾（键名与契约 WorkspaceTasks 同源）。 */
const TASK_GROUPS = ["overdue", "today", "upcoming", "unscheduled"] as const;
type TaskGroupKey = (typeof TASK_GROUPS)[number];

/** 任务分组色签（与项目总览状态色系同一张表：红 = 已逾期、琥珀 = 今天、天蓝 = 即将到期、灰 = 未排期）。 */
const TASK_GROUP_CHIP: Record<TaskGroupKey, string> = {
  overdue: "bg-rose-100 text-rose-700",
  today: "bg-amber-100 text-amber-800",
  upcoming: "bg-sky-100 text-sky-700",
  unscheduled: "bg-zinc-100 text-zinc-600",
};

/** 「液态玻璃」小框的**只读**形态（与 InlineEdit 的 InlineCell 静止态同一档材质）：项目页任务表里
 *  负责人 / 日期格是「点开编辑」的小胶囊；工作台读面不带 version（写不了），只借形、不接交互。 */
const GLASS_FRAME =
  "inline-flex max-w-full items-center gap-1 rounded-lg border border-zinc-200/90 bg-white/75 px-1.5 py-[3px] text-xs backdrop-blur-[3px]";

/** ISO（YYYY-MM-DD）→「M月D日」（项目页任务表日期格的短口径，不带年份；未排期空日期由 DatePill 显示「—」）。 */
function cnDateShort(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    return iso;
  }
  return String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
}

/** 日期格（只读玻璃胶囊；空 = 「—」）—— 与项目页任务表「开始 / 预计完成 / 实际完成」三列同一档显示。 */
function DatePill({ iso }: { iso: string | null }) {
  if (iso === null) {
    return <span className="text-xs text-zinc-300">—</span>;
  }
  return <span className={GLASS_FRAME + " tabular-nums text-zinc-600"}>{cnDateShort(iso)}</span>;
}

/** 次按钮（重新加载）—— 与「日报及问题」的 BTN_SECONDARY 同一档材质。 */
const BTN_SECONDARY =
  "rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900";

/** ISO（YYYY-MM-DD）→「YYYY年M月D日」（与「问题追踪」日期列同一口径；跨项目列表可能跨年，年份要带）。 */
function cnDateFull(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    return iso;
  }
  return String(Number(match[1])) + "年" + String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
}

/** 契约三态（open / in_progress / done）→ 中文 + 色签；与「问题追踪」同源（ISSUE_STATE_NAMES / ISSUE_TAG_CLASS）。
 *  Push 232 起同源补醒目模式两张色表（ISSUE_ROW_CLASS 行底色 / ISSUE_TAG_TEXT_CLASS 状态字色）；
 *  未知值原样兜底（契约受控，兜底只为不炸）。 */
function issueStateOf(state: string): { label: string; className: string; focusRowClass: string; focusTagClass: string } {
  if (state === "open" || state === "in_progress" || state === "done") {
    return { label: ISSUE_STATE_NAMES[state], className: ISSUE_TAG_CLASS[state], focusRowClass: ISSUE_ROW_CLASS[state], focusTagClass: ISSUE_TAG_TEXT_CLASS[state] };
  }
  return { label: state, className: "bg-zinc-100 text-zinc-600", focusRowClass: "hover:bg-zinc-50/80", focusTagClass: "text-zinc-600" };
}

/** 「是否按时交付」列的逾期标注（与项目页任务表 lateDeliveryLabel 同口径；工作台不引项目页的 ProjectTask
 *  模型，直接用聚合读面的 displayStatus + 回填行的 onTime）：展示态 = 已延期 → 「逾期未交付」；
 *  已完成（done / early_done）但 onTime = false → 「逾期已交付」；其余走「按时交付 / —」。 */
function lateDeliveryOf(displayStatus: string, onTime: boolean | null): "逾期未交付" | "逾期已交付" | null {
  if (displayStatus === "overdue") {
    return "逾期未交付";
  }
  if ((displayStatus === "done" || displayStatus === "early_done") && onTime === false) {
    return "逾期已交付";
  }
  return null;
}

type ProjectTasks = {
  projectId: string;
  projectCode: string;
  projectName: string;
  items: Array<{ group: TaskGroupKey; task: ApiWorkspaceTask }>;
};

/** 我的任务四组 → 按项目归并（项目顺序 = 组序里的首次出现顺序；组内保持服务端 plannedEnd 升序、未排期收尾）。 */
function groupTasksByProject(data: ApiWorkspace): ProjectTasks[] {
  const byProject = new Map<string, ProjectTasks>();
  for (const group of TASK_GROUPS) {
    for (const task of data.myTasks[group]) {
      let entry = byProject.get(task.projectId);
      if (entry === undefined) {
        entry = { projectId: task.projectId, projectCode: task.projectCode, projectName: task.projectName, items: [] };
        byProject.set(task.projectId, entry);
      }
      entry.items.push({ group, task });
    }
  }
  return Array.from(byProject.values());
}

type ProjectIssues = {
  projectId: string;
  projectCode: string;
  projectName: string;
  issues: ApiWorkspaceIssue[];
};

/** 我提出的问题（服务端已按「未关闭在前、提出日期升序」排好）→ 按项目归并（项目顺序 = 首次出现顺序）。 */
function groupIssuesByProject(issues: readonly ApiWorkspaceIssue[]): ProjectIssues[] {
  const byProject = new Map<string, ProjectIssues>();
  for (const issue of issues) {
    let entry = byProject.get(issue.projectId);
    if (entry === undefined) {
      entry = { projectId: issue.projectId, projectCode: issue.projectCode, projectName: issue.projectName, issues: [] };
      byProject.set(issue.projectId, entry);
    }
    entry.issues.push(issue);
  }
  return Array.from(byProject.values());
}

/** 「解决方案或建议 / 问题附图」两列的数据不在工作台聚合读面（A31 第一刀）里 —— 逐项目向源接口
 *  （GET /projects/{id}/issues，一次取满 limit=200）回填、按问题 id 对齐；单个项目取不到不挡全页：
 *  那几行的两列落「—」，标题行给一句 partial 提示（不静默丢内容）。 */
type IssueFull = { solution: string; photos: ReportPhoto[] };

function useIssueFull(issues: readonly ApiWorkspaceIssue[]): { full: Map<string, IssueFull>; partial: boolean } {
  const [full, setFull] = useState<Map<string, IssueFull>>(new Map());
  const [partial, setPartial] = useState(false);
  useEffect(() => {
    if (issues.length === 0) {
      setFull(new Map());
      setPartial(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const projectIds = Array.from(new Set(issues.map((issue) => issue.projectId)));
      const results = await Promise.all(
        projectIds.map(async (projectId) => {
          try {
            return { list: await fetchProjectIssues(projectId) };
          } catch {
            return { list: null };
          }
        }),
      );
      if (cancelled) {
        return;
      }
      const next = new Map<string, IssueFull>();
      let failed = 0;
      for (const result of results) {
        if (result.list === null) {
          failed += 1;
          continue;
        }
        for (const item of result.list) {
          next.set(item.id, { solution: item.solution, photos: item.photos });
        }
      }
      setFull(next);
      setPartial(failed > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [issues]);
  return { full, partial };
}

/** 「我的任务」任务表扩列（Push 231 · 业务口径「这些字段一个不能少」）：项目页任务表 15 列里，
 *  工作台聚合读面（A31 第一刀）只带 9 列 —— 项目经理 / 输出成果文件 / 文件 / 项目进展描述 / 预计所需天数 /
 *  预计所需施工人数 / 是否按时交付（onTime）/ 变更关联不在那里。按项目向源接口回填
 *  （GET /projects/{id}/tasks 一次取满 + GET /projects/{id} 取项目经理名），按任务 id / 项目 id 对齐；
 *  单个项目取不到不挡全页：对应列落「—」，标题行给 partial 提示（与 useIssueFull 同一套降级口径）。 */
type TaskFull = {
  /** 任务 id → 列表行（含 ownerNames / fileSummary / deliverableTypes / note / estimatedDays / headcount / onTime / changeLinks）。 */
  detail: Map<string, ApiTaskListItem>;
  /** 项目 id → 项目经理名数组（展示时「、」连接；未取到 = 无该键）。 */
  managers: Map<string, string[]>;
};

function useTaskFull(data: ApiWorkspace): { full: TaskFull; partial: boolean; ready: boolean } {
  const [full, setFull] = useState<TaskFull>(() => ({ detail: new Map(), managers: new Map() }));
  const [partial, setPartial] = useState(false);
  /** 回填是否跑完（成功 / 失败都算跑完）：e2e 的等待锚点；跑完前对应列先按「—」渲染。 */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const all = [...data.myTasks.overdue, ...data.myTasks.today, ...data.myTasks.upcoming, ...data.myTasks.unscheduled];
    if (all.length === 0) {
      setFull({ detail: new Map(), managers: new Map() });
      setPartial(false);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void (async () => {
      const projectIds = Array.from(new Set(all.map((task) => task.projectId)));
      const results = await Promise.all(
        projectIds.map(async (projectId) => {
          const [taskList, managerNames] = await Promise.all([
            fetchProjectTasks(projectId).then((result) => result.items).catch(() => null),
            fetchProject(projectId).then((project) => project.managerNames).catch(() => null),
          ]);
          return { projectId, taskList, managerNames };
        }),
      );
      if (cancelled) {
        return;
      }
      const detail = new Map<string, ApiTaskListItem>();
      const managers = new Map<string, string[]>();
      let failed = 0;
      for (const result of results) {
        if (result.taskList === null) {
          failed += 1;
        } else {
          for (const item of result.taskList) {
            detail.set(item.id, item);
          }
        }
        if (result.managerNames === null) {
          failed += 1;
        } else {
          managers.set(result.projectId, result.managerNames.filter((name): name is string => name !== null && name !== ""));
        }
      }
      setFull({ detail, managers });
      setPartial(failed > 0);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);
  return { full, partial, ready };
}

/** 折叠面板（业务口径「未展开是项目名称和编号 下拉是具体我的任务」「也是折叠面板」）：
 *  收起 = 项目名称 + 编号（+ 右侧摘要 + 「进入项目」按钮）；展开 = 该项目下的内容（任务表 / 问题表）。
 *  「进入项目」是面板头里的独立锚点（Push 232）：点它走调用方给定的深链（Push 242 起按标签区分 ——
 *  「我的任务」= 总览 / 「我提出的问题」= 该项目「日报记录」），不切换展开态。
 *  展开态 Push 233 起受控 + 按账号记忆（业务口径「这个下拉要有记忆」）：由 App 层偏好 workspaceOpenProjects 按标签分记
 *  已展开的项目 id（刷新 / 同账号换设备保持；不进地址）；面板壳 = 白卡 + 圆角描边 + 行悬停（与站内表格壳同一套材质）。 */
function ProjectPanel({ projectId, projectCode, projectName, summary, href, open, onToggle, children }: {
  projectId: string;
  projectCode: string;
  projectName: string;
  /** 收起态右侧摘要（计数 / 逾期小签）。 */
  summary: ReactNode;
  /** 「进入项目」深链（Push 242 起由调用方给定：任务表 = 总览 / 问题表 = 该项目「日报记录」）。 */
  href: string;
  /** 展开态（Push 233 起受控：由账号偏好按项目 id 记忆 —— 见 WorkspacePage 的 openProjects / openIds）。 */
  open: boolean;
  /** 切换展开态（点面板头触发；「进入项目」是独立锚点、不触发）。 */
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section data-workspace-panel={projectId} data-open={open ? "true" : "false"} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="flex items-center gap-3 py-3 pl-4 pr-3 transition hover:bg-zinc-50">
        <button
          type="button"
          data-workspace-panel-toggle=""
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={"h-4 w-4 shrink-0 text-zinc-400 transition-transform " + (open ? "rotate-90" : "")}>
            <path d="M9.5 5.5 16 12l-6.5 6.5" />
          </svg>
          <span className="min-w-0 truncate text-sm font-semibold text-zinc-900">{projectName}</span>
          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-zinc-600">{projectCode}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">{summary}</span>
        </button>
        <a
          href={href}
          data-workspace-project-link={projectId}
          title={"进入项目：" + projectName + "（" + projectCode + "）"}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
        >
          进入项目
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3 w-3">
            <path d="M9.5 5.5 16 12l-6.5 6.5" />
          </svg>
        </a>
      </div>
      {open ? <div className="border-t border-zinc-100 px-4 pb-4 pt-3">{children}</div> : null}
    </section>
  );
}

/** 收起态摘要（我的任务）：共 N 项 + 逾期 / 今日 / 未排期三枚小签（要不要展开一眼能判）。 */
function TaskPanelSummary({ items }: { items: ProjectTasks["items"] }) {
  const overdue = items.filter((item) => item.group === "overdue").length;
  const today = items.filter((item) => item.group === "today").length;
  const unscheduled = items.filter((item) => item.group === "unscheduled").length;
  return (
    <>
      <span className="text-xs font-normal text-zinc-400">{"共 " + String(items.length) + " 项"}</span>
      {overdue === 0 ? null : (
        <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + TASK_GROUP_CHIP.overdue}>{"已逾期 " + String(overdue)}</span>
      )}
      {today === 0 ? null : (
        <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + TASK_GROUP_CHIP.today}>{"今日 " + String(today)}</span>
      )}
      {unscheduled === 0 ? null : (
        <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + TASK_GROUP_CHIP.unscheduled}>{"未排期 " + String(unscheduled)}</span>
      )}
    </>
  );
}

/** 展开区 ① 我的任务表：列口径 = 项目页任务表全列（Push 231 · 业务口径「这些字段一个不能少」）——
 *  表头 / 列壳直接复用项目页的 TABLE_COLUMNS（同序 / 同宽 / 同 min，列宽用 grid 模板还原），15 列一个不少：
 *  任务描述（+ 四格进度点；原「已逾期 / 今日待办 / 即将到期」分组签按业务口径「这个不要展示」已下线，
 *  组序仍由服务端给定、由行序体现）/ 项目经理 / 任务负责人 / 任务状态 / 紧急重要度 / 是否按时交付 /
 *  输出成果文件 / 文件 / 项目进展描述 / 开始日期 / 预计所需天数（窄列，表头空）/ 预计完成日期 /
 *  预计所需施工人数 / 实际完成日期 / 变更关联。只读形态（工作台读面不带 version）：借项目页的形
 *  （色签 / 玻璃胶囊 / 空值「—」），不挂点开编辑；数据 = 聚合读面的 9 列 + useTaskFull 回填的扩展字段。 */
const TASK_COLUMNS: ColumnDef[] = resolveColumns({});

function TaskTable({ projectId, items, full, ready, focus }: {
  projectId: string;
  items: ProjectTasks["items"];
  /** 回填的扩展字段（useTaskFull）。 */
  full: TaskFull;
  /** 回填是否跑完（data-workspace-task-full 锚点；跑完前对应列先按「—」渲染）。 */
  ready: boolean;
  /** 醒目模式（Push 232）：整行铺任务状态底色 + 状态胶囊收口成深色字（口径 = 项目页 TaskBoard）。 */
  focus: boolean;
}) {
  const gridTemplate = TASK_COLUMNS.map((column) => column.width).join(" ");
  const minWidth = TASK_COLUMNS.reduce((total, column) => total + column.min, 0);
  const managerText = (full.managers.get(projectId) ?? []).join("、");
  return (
    <div data-workspace-task-table="" data-workspace-task-full={ready ? "true" : "false"} data-workspace-task-focus={focus ? "true" : "false"} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="overflow-x-auto">
        <div style={{ minWidth: minWidth }}>
          <div
            data-workspace-task-head=""
            className="grid items-center border-b border-zinc-200 bg-zinc-50 px-5 py-2.5 text-xs font-medium text-zinc-400"
            style={{ gridTemplateColumns: gridTemplate, minWidth: minWidth }}
          >
            {TASK_COLUMNS.map((column) =>
              column.key === "title" ? (
                <span key={column.key} data-column={column.key} className="truncate">{column.label}</span>
              ) : (
                <span key={column.key} data-column={column.key} title={column.label === "" ? undefined : column.label} className={"truncate text-center " + (column.headerClass ?? "")}>
                  {column.header ?? column.label}
                </span>
              ),
            )}
          </div>
          <div className="divide-y divide-zinc-100">
            {items.map(({ task }) => {
              const detail = full.detail.get(task.id);
              const status = displayStatusLabel(task.displayStatus);
              const stage = stageNameOf(task.stageKey);
              const subtitle = (stage === "" ? "临时任务" : stage) + (task.titleEn === null || task.titleEn === "" ? "" : " · " + task.titleEn);
              const ownerText = task.ownerNames.map((name) => name ?? "").filter((name) => name !== "").join("、");
              const priorityClass =
                task.priority === null ? "" : ((PRIORITY_CAPSULE_CLASS as Record<string, string | undefined>)[task.priority] ?? "bg-zinc-100 text-zinc-500");
              const onTime = detail === undefined ? null : detail.onTime;
              const late = lateDeliveryOf(task.displayStatus, onTime);
              const deliverableTypes = detail === undefined ? [] : detail.deliverableTypes;
              const fileSummary = detail === undefined ? null : detail.fileSummary;
              const note = detail === undefined ? null : detail.note;
              const derivedDays = task.plannedStart !== null && task.plannedEnd !== null ? daysBetweenInclusive(task.plannedStart, task.plannedEnd) : 0;
              const days = (detail === undefined ? null : detail.estimatedDays) ?? derivedDays;
              const headcount = detail === undefined ? null : detail.headcount;
              const changes = detail === undefined ? [] : detail.changeLinks;
              const changeTitle =
                changes.length === 0
                  ? undefined
                  : changes.map((change) => "变更 " + dateOnlyText(change.appliedAt) + (change.reason === null || change.reason === "" ? "" : "（" + change.reason + "）")).join("；");
              const cells: Record<Exclude<ColumnKey, "title">, ReactNode> = {
                manager:
                  managerText === "" ? (
                    <span className="text-xs text-zinc-300">—</span>
                  ) : (
                    <span className="truncate text-xs text-zinc-600" title={managerText}>{managerText}</span>
                  ),
                owner:
                  task.ownerIds.length === 0 ? (
                    <span className="text-xs text-zinc-300">待分配</span>
                  ) : (
                    <span className={GLASS_FRAME + " min-w-0 text-zinc-600"} title={ownerText}>
                      <span className="min-w-0 truncate">{ownerText}</span>
                    </span>
                  ),
                status: (
                  <span
                    data-workspace-task-status={task.displayStatus}
                    className={
                      "inline-block " +
                      (focus
                        ? "px-1.5 py-[3px] text-xs font-semibold " + STATUS_TAG_TEXT_CLASS[status]
                        : "rounded-lg px-3 py-1.5 text-[11px] font-medium " + STATUS_CAPSULE_CLASS[status])
                    }
                  >
                    {status}
                  </span>
                ),
                priority:
                  task.priority === null ? (
                    <span className="text-xs text-zinc-300">—</span>
                  ) : (
                    <span className={"inline-block rounded-lg px-3 py-1.5 text-[11px] font-medium " + priorityClass}>{task.priority}</span>
                  ),
                onTime: (
                  <span>
                    {late === "逾期未交付" ? (
                      <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">逾期未交付</span>
                    ) : late === "逾期已交付" ? (
                      <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">逾期已交付</span>
                    ) : onTime === null ? (
                      <span className="text-xs text-zinc-300">—</span>
                    ) : (
                      <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">按时交付</span>
                    )}
                  </span>
                ),
                deliverable: (
                  <span className="flex min-w-0 items-center gap-1">
                    {deliverableTypes.length === 0 ? (
                      <span className="text-xs text-zinc-300">—</span>
                    ) : (
                      <>
                        <span className="min-w-0 truncate" title={deliverableTypes.join("、")}>
                          {docTypeCapsule(deliverableTypes[0])}
                        </span>
                        {deliverableTypes.length > 1 ? <span className="text-[10px] text-zinc-400">+{deliverableTypes.length - 1}</span> : null}
                      </>
                    )}
                  </span>
                ),
                files:
                  fileSummary === null || fileSummary.total === 0 ? (
                    <span className="text-xs text-zinc-300">—</span>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1">
                      <span
                        className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-600"
                        title={"共 " + String(fileSummary.total) + " 份（未定档 " + String(fileSummary.draft) + " / 已定档 " + String(fileSummary.final) + "）"}
                      >
                        {fileSummary.total} 份
                      </span>
                      {fileSummary.draft > 0 ? <span className="text-[10px] text-amber-600">未定档 {fileSummary.draft}</span> : null}
                    </span>
                  ),
                note:
                  note === null || note === "" ? (
                    <span className="text-xs text-zinc-300">—</span>
                  ) : (
                    <span className="block min-w-0 truncate text-xs text-zinc-600" title={note}>{note}</span>
                  ),
                start: <DatePill iso={task.plannedStart} />,
                days: (
                  <span data-workspace-task-days={String(days)} className="relative flex items-center justify-center self-stretch">
                    <span className="h-px w-10 bg-zinc-300" />
                    <span className="absolute inset-x-0 bottom-1/2 mb-1 text-center text-[11px] leading-none tabular-nums text-zinc-500">{days}</span>
                  </span>
                ),
                due: <DatePill iso={task.plannedEnd} />,
                headcount: (
                  <span className="text-xs tabular-nums text-zinc-600">
                    {headcount !== null && headcount > 0 ? headcount + " 人" : <span className="text-zinc-300">—</span>}
                  </span>
                ),
                doneDate: <DatePill iso={task.actualEnd} />,
                change: (
                  <span data-workspace-task-change={String(changes.length)} className="flex items-center gap-1" title={changeTitle}>
                    {changes.length === 0 ? null : (
                      <>
                        <span className="inline-block whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">变更</span>
                        {changes.length > 1 ? <span className="text-[10px] text-zinc-400">+{changes.length - 1}</span> : null}
                      </>
                    )}
                  </span>
                ),
              };
              return (
                <div
                  key={task.id}
                  data-workspace-task={task.id}
                  className={"grid items-center px-5 py-2.5 transition-colors " + (focus ? STATUS_ROW_CLASS[status] : "hover:bg-zinc-50/80")}
                  style={{ gridTemplateColumns: gridTemplate, minWidth: minWidth }}
                >
                  {TASK_COLUMNS.map((column) =>
                    column.key === "title" ? (
                      <div key={column.key} data-column={column.key} className="flex min-w-0 items-center gap-4 self-stretch">
                        <div className="min-w-0 flex-1">
                          <p data-workspace-task-title="" className="truncate text-sm font-bold text-zinc-900" title={task.title + (task.titleEn === null ? "" : " / " + task.titleEn)}>
                            {task.title}
                          </p>
                          {subtitle === "" ? null : <p className="mt-0.5 max-w-[280px] truncate text-[11px] leading-4 text-zinc-400" title={subtitle}>{subtitle}</p>}
                        </div>
                        <span data-workspace-task-dots={String(task.progress)} className="shrink-0">
                          <TrackerDots progress={task.progress} hovered={0} onHoverChange={() => { /* 只读展示：不接悬停预览 */ }} />
                        </span>
                      </div>
                    ) : (
                      <div key={column.key} data-column={column.key} className="flex min-w-0 items-center justify-center self-stretch">
                        {cells[column.key]}
                      </div>
                    ),
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 问题归类色签组（与「问题追踪」同一张色表 ISSUE_CATEGORY_CLASS；空数组 = 「未归类」灰签）。 */
function CategoryTags({ values }: { values: readonly string[] }) {
  const items = values.length === 0 ? ["未归类"] : values;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((item, index) => (
        <span key={item + "#" + String(index)} data-issue-category={item} className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 " + (ISSUE_CATEGORY_CLASS[item] ?? "bg-zinc-100")}>
          {item}
        </span>
      ))}
    </span>
  );
}

/** 附图大图预览层（与「问题追踪」同款：点遮罩 / Esc 关闭；Push 216 口径）。 */
function PhotoPreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
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

/** 单枚问题附图瓦片：懒取服务端预览签名（usePhotoUrl），点开 = 大图预览层。 */
function IssuePhotoTile({ photo, onPreview }: { photo: ReportPhoto; onPreview: (url: string, name: string) => void }) {
  const url = usePhotoUrl(photo.fileId, photo.url);
  if (url === null) {
    return <span aria-hidden="true" className="inline-block h-24 w-32 shrink-0 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />;
  }
  return (
    <button
      type="button"
      data-issue-photo={photo.name}
      title={photo.name}
      aria-label={"预览 " + photo.name}
      onClick={() => {
        onPreview(url, photo.name);
      }}
      className="shrink-0 rounded-lg transition hover:opacity-80"
    >
      <img src={url} alt={photo.name} className="h-24 w-32 rounded-lg border border-zinc-200 object-cover" />
    </button>
  );
}

/** 问题附图列（与「问题追踪」同一档：lg 大图瓦片约 128×96、多张折行；空 = 「—」）。 */
function IssuePhotos({ photos }: { photos: readonly ReportPhoto[] }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  if (photos.length === 0) {
    return <span className="text-zinc-400">—</span>;
  }
  return (
    <span className="flex flex-wrap items-start gap-2">
      {photos.map((photo, index) => (
        <IssuePhotoTile
          key={photo.fileId + "#" + String(index)}
          photo={photo}
          onPreview={(url, name) => {
            setPreview({ url, name });
          }}
        />
      ))}
      {preview === null ? null : <PhotoPreview url={preview.url} name={preview.name} onClose={() => { setPreview(null); }} />}
    </span>
  );
}

/** 展开区 ② 我提出的问题表（列口径照「问题追踪」完整六列）：日期 / 问题描述 / 问题归类 / 解决方案或建议 /
 *  问题附图 / 问题是否处理（窄屏横向滚动）。
 *  Push 242：① `table-fixed` + `<colgroup>` 定死列宽（见 ISSUE_COL_WIDTHS）—— 各项目面板的同名列一一对齐
 *  （原 `table-auto` 各自按内容算宽、换一个项目列就飘；业务口径「这个页面的列要对齐吧 不然不美观」）；
 *  ② 行尾「在项目中查看」下架 —— 进项目的入口收敛到面板头「进入项目」（定标 = 该项目「日报记录」）。 */
const ISSUE_COL_WIDTHS = ["10%", "21%", "10%", "21%", "27%", "11%"] as const;

function IssueTable({ issues, full, focus }: { issues: readonly ApiWorkspaceIssue[]; full: Map<string, IssueFull>; focus: boolean }) {
  return (
    <div data-workspace-issue-table="" data-workspace-issue-focus={focus ? "true" : "false"} className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full min-w-[1280px] table-fixed border-collapse text-left text-sm">
        {/* 定死六列宽度：跨面板同名列的 x 坐标逐列一致；长文本按列宽换行、不再把列撑开 */}
        <colgroup>
          {ISSUE_COL_WIDTHS.map((width, index) => (
            <col key={String(index)} style={{ width }} />
          ))}
        </colgroup>
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">日期</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题描述</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题归类</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">解决方案或建议</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题附图</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题是否处理</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {issues.map((issue) => {
            const state = issueStateOf(issue.state);
            const detail = full.get(issue.id);
            return (
              <tr key={issue.id} data-workspace-issue={issue.id} className={"align-top transition-colors " + (focus ? state.focusRowClass : "hover:bg-zinc-50/80")}>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{cnDateFull(issue.raisedAt)}</td>
                <td className="px-4 py-3">
                  <span className="block whitespace-pre-line break-words leading-6 text-zinc-800">{issue.title}</span>
                </td>
                <td className="px-4 py-3">
                  <CategoryTags values={issue.categories} />
                </td>
                <td className="px-4 py-3">
                  <span data-workspace-issue-solution="" className="block whitespace-pre-line break-words leading-6 text-zinc-600">
                    {detail === undefined || detail.solution === "" ? "—" : detail.solution}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <IssuePhotos photos={detail === undefined ? [] : detail.photos} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-center">
                  <span
                    data-issue-state={issue.state}
                    className={
                      "inline-block " +
                      (focus ? "text-xs font-semibold " + state.focusTagClass : "rounded px-1.5 py-0.5 text-[11px] font-medium " + state.className)
                    }
                  >
                    {state.label}
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

/** 空态 / 加载态卡（与「日报及问题」子视图空态同一套虚线卡）。 */
function EmptyCard({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-6 py-12 text-center">
      <p className="text-sm text-zinc-500">{text}</p>
      <p className="mt-1.5 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}

/** 三枚标签（业务口径「我的任务 我提出的问题先做这两个」→ Push 234「增加一个我的计划页面」；样式 = 任务模板页的下划线标签栏，文字 + 选中下划线）。 */
const TABS: ReadonlyArray<{ key: WorkspaceTab; label: string }> = [
  { key: "tasks", label: "我的任务" },
  { key: "raised", label: "我提出的问题" },
  { key: "plan", label: "我的计划" },
];

/** 标签 ① 我的任务：按项目的折叠面板 + 照项目页任务表全 15 列的任务表（Push 231）。 */
function MyTasksView({ data, focus, openIds, onToggleProject }: { data: ApiWorkspace; focus: boolean; openIds: ReadonlySet<string>; onToggleProject: (projectId: string) => void }) {
  const projects = groupTasksByProject(data);
  const total = data.myTasks.overdue.length + data.myTasks.today.length + data.myTasks.upcoming.length + data.myTasks.unscheduled.length;
  const { full, partial, ready } = useTaskFull(data);
  return (
    <section data-workspace-tasks="" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">我的任务</h2>
        <span data-workspace-task-total="" className="text-xs text-zinc-400">
          {"共 " + String(total) + " 项 · 跨 " + String(projects.length) + " 个项目 · 基准日 " + cnDateFull(data.today)}
        </span>
        {partial ? (
          <span data-workspace-task-partial="" className="text-xs text-amber-600">
            有项目的任务全列（项目经理 / 成果文件 / 文件 / 进展描述 / 天数 / 人数 / 变更关联）没取到（那几列显示「—」）—— 刷新重试。
          </span>
        ) : null}
      </div>
      {projects.length === 0 ? (
        <EmptyCard text="当前没有需要推进的任务。" hint="口径：我是任务负责人或项目项目经理、任务未完成；不限完成日期（已逾期 / 今天 / 远期 / 未排期都收）。" />
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <ProjectPanel
              key={project.projectId}
              projectId={project.projectId}
              projectCode={project.projectCode}
              projectName={project.projectName}
              summary={<TaskPanelSummary items={project.items} />}
              href={projectViewHref(project.projectId, "overview")}
              open={openIds.has(project.projectId)}
              onToggle={() => {
                onToggleProject(project.projectId);
              }}
            >
              <TaskTable projectId={project.projectId} items={project.items} full={full} ready={ready} focus={focus} />
            </ProjectPanel>
          ))}
        </div>
      )}
    </section>
  );
}

/** 标签 ② 我提出的问题：按项目的折叠面板 + 照「问题追踪」六列的问题表。 */
function RaisedIssuesView({ issues, focus, openIds, onToggleProject }: { issues: readonly ApiWorkspaceIssue[]; focus: boolean; openIds: ReadonlySet<string>; onToggleProject: (projectId: string) => void }) {
  const projects = groupIssuesByProject(issues);
  const { full, partial } = useIssueFull(issues);
  return (
    <section data-workspace-issues="" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">我提出的问题</h2>
        <span data-workspace-issue-total="" className="text-xs text-zinc-400">
          {"共 " + String(issues.length) + " 条 · 跨 " + String(projects.length) + " 个项目 · 未关闭在前"}
        </span>
        {partial ? (
          <span data-workspace-issue-partial="" className="text-xs text-amber-600">
            有项目的「解决方案或建议 / 问题附图」没取到（那几行显示「—」）—— 刷新重试。
          </span>
        ) : null}
      </div>
      {projects.length === 0 ? (
        <EmptyCard text="还没有你提出的问题。" hint="在项目「日报及问题 → 问题追踪」里由你记录的问题（reporterId = 我）会出现在这里。" />
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <ProjectPanel
              key={project.projectId}
              projectId={project.projectId}
              projectCode={project.projectCode}
              projectName={project.projectName}
              summary={<span className="text-xs font-normal text-zinc-400">{"共 " + String(project.issues.length) + " 条"}</span>}
              href={projectViewHref(project.projectId, "daily", "records")}
              open={openIds.has(project.projectId)}
              onToggle={() => {
                onToggleProject(project.projectId);
              }}
            >
              <IssueTable issues={project.issues} full={full} focus={focus} />
            </ProjectPanel>
          ))}
        </div>
      )}
    </section>
  );
}

/** 标签 ③ 我的计划（Push 234 · 业务口径「增加一个我的计划页面」→「你只要把导航栏设计好 后续详细设计再说」）：
 *  导航栏（第三枚标签）与路由（`?tab=plan`）本刀就位；页面内容（数据口径 / 布局）随后续详细设计再做 —— 本刀只落登记卡。
 *  锚点 data-workspace-plan 供回放断言「切到该标签」用。 */
function MyPlanView() {
  return (
    <section data-workspace-plan="" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">我的计划</h2>
        <span className="text-xs text-zinc-400">导航栏与路由已就位 · 页面内容待详细设计</span>
      </div>
      <EmptyCard text="「我的计划」页面还没开工。" hint="本刀只落导航栏与路由（#/my-tasks?tab=plan）；数据口径与布局随后续详细设计再做。" />
    </section>
  );
}

/** 工作台「我的任务」页：三枚标签（我的任务 / 我提出的问题 / 我的计划）共用一份 GET /api/v1/workspace 聚合数据。
 *  Push 233：折叠面板展开态接账号偏好（workspaceOpenProjects，按标签各记一组项目 id）——「这个下拉要有记忆」。
 *  Push 234：第三枚标签「我的计划」就位（页面内容待详细设计）。 */
export default function WorkspacePage({ me, tab, onChangeTab, focusMode, onFocusModeChange, workspaceOpenProjects, onWorkspaceOpenProjectsChange }: WorkspacePageProps) {
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });
  /** 重新加载令牌：bump 一次重新取数（错误态的「重新加载」用）。 */
  const [reloadToken, setReloadToken] = useState(0);
  /** 醒目模式（Push 232）：值由 App 层按账号偏好给；null / 缺省 = 偏好尚未取到 → 按默认「关」渲染。 */
  const focus = focusMode === true;
  /** 醒目模式保存失败文案（null = 无提示）：乐观更新 + 失败回滚在 App 层，本页只出提示条。 */
  const [focusError, setFocusError] = useState<string | null>(null);
  /** 醒目模式改动（Push 232）：点一下即生效（App 层乐观更新）+ 单键 PATCH；失败回滚并在页内提示条出文案。 */
  const handleToggleFocusMode = async (checked: boolean): Promise<void> => {
    setFocusError((await onFocusModeChange?.(checked)) ?? null);
  };

  /** 展开态（Push 233 · 业务口径「这个下拉要有记忆」）：偏好由 App 层持有并单键 PATCH；null / 缺省 = 偏好尚未取到 → 按全收起渲染。
   *  未接 onWorkspaceOpenProjectsChange 时退回本页内存态（面板仍可展开 / 收起，只是不跨刷新）。 */
  const [localOpenProjects, setLocalOpenProjects] = useState<WorkspaceOpenProjects>({ tasks: [], raised: [] });
  const openProjects = workspaceOpenProjects ?? localOpenProjects;
  /** 展开态保存失败文案（null = 无提示）：乐观更新 + 失败回滚在 App 层，本页只出提示条。 */
  const [panelError, setPanelError] = useState<string | null>(null);
  /** 切换某个项目面板：按标签各自去重增删（不按顺序消费），整个对象单键 PATCH。 */
  const handleToggleProject = (which: "tasks" | "raised", projectId: string): void => {
    const currentIds = which === "raised" ? openProjects.raised : openProjects.tasks;
    const nextIds = currentIds.includes(projectId) ? currentIds.filter((id) => id !== projectId) : currentIds.concat(projectId);
    const next: WorkspaceOpenProjects = which === "raised" ? { ...openProjects, raised: nextIds } : { ...openProjects, tasks: nextIds };
    if (onWorkspaceOpenProjectsChange === undefined) {
      setLocalOpenProjects(next);
      return;
    }
    void (async () => {
      setPanelError((await onWorkspaceOpenProjectsChange(next)) ?? null);
    })();
  };
  const taskOpenIds = new Set(openProjects.tasks);
  const raisedOpenIds = new Set(openProjects.raised);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const data = await fetchWorkspace();
        if (!cancelled) {
          setState({ kind: "ready", data });
        }
      } catch {
        // 401 已由 apiRequest 统一跳登录；其余（网络 / 5xx…）落本页错误态
        if (!cancelled) {
          setState({ kind: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <div className="min-h-screen">
      <AppHeader me={me} />
      <main className="w-full px-6 pb-10 pt-3">
        <div data-workspace-page="" className="w-full space-y-5">
          {/* 标签导航栏（Push 230：与任务模板页的下划线标签栏同一套材质 —— 文字 + 选中下划线）。
              Push 235 吸顶（业务口径「任务模版和我的任务都要做吸顶效果」）：滚动时停在应用顶栏（h-16 = 64px）正下方，
              站灰底 + 毛玻璃兜住滚动内容；-mx-6 -mt-3 + 同值内衬抵消：横幅铺满行宽、三枚标签与醒目模式开关位置与原来一致。 */}
          <nav data-workspace-tabs="" aria-label="工作台标签" className="sticky top-16 z-20 -mx-6 -mt-3 flex items-center gap-3 border-b border-zinc-200 bg-[#f5f6f8]/95 px-6 pt-3 backdrop-blur">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {TABS.map((item) => {
                const active = item.key === tab;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-workspace-tab={item.key}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      onChangeTab(item.key);
                    }}
                    className={
                      "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition " +
                      (active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            {/* 醒目模式（Push 232 · 业务口径「同样增加醒目模式」）：开关落在标签导航栏最右侧
                （同项目总览 / 问题追踪口径「醒目模式放在标签导航栏的最右侧」） */}
            <span data-workspace-focus-toggle="" className="shrink-0">
              <FocusModeToggle
                checked={focus}
                onToggle={(checked) => {
                  void handleToggleFocusMode(checked);
                }}
              />
            </span>
          </nav>

          {focusError === null ? null : (
            <p role="alert" data-workspace-focus-error="" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {focusError}
            </p>
          )}

          {panelError === null ? null : (
            <p role="alert" data-workspace-panel-error="" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {panelError}
            </p>
          )}

          {state.kind === "loading" ? (
            <EmptyCard text="加载中…" hint="正在拉取工作台聚合数据（GET /api/v1/workspace）。" />
          ) : state.kind === "error" ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white/50 px-6 py-12 text-center">
              <p className="text-sm text-zinc-500">工作台加载失败。</p>
              <p className="text-xs text-zinc-400">请检查网络后重试；持续失败请联系运维排查接口 GET /api/v1/workspace。</p>
              <button
                type="button"
                onClick={() => {
                  setReloadToken((previous) => previous + 1);
                }}
                className={BTN_SECONDARY}
              >
                重新加载
              </button>
            </div>
          ) : tab === "raised" ? (
            <RaisedIssuesView
              issues={state.data.myIssues.raised}
              focus={focus}
              openIds={raisedOpenIds}
              onToggleProject={(projectId) => {
                handleToggleProject("raised", projectId);
              }}
            />
          ) : tab === "plan" ? (
            <MyPlanView />
          ) : (
            <MyTasksView
              data={state.data}
              focus={focus}
              openIds={taskOpenIds}
              onToggleProject={(projectId) => {
                handleToggleProject("tasks", projectId);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
