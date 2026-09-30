/**
 * 工作台「我的任务」页（系统功能书 A6-01 / A6-03；M6-06 前端接线 · Push 230）。
 *
 * 业务口径（2026-09-30）：「同样做标签导航栏 我的任务 我提出的问题先做这两个」→「是这个页面导航栏」（指任务模板页
 * 的下划线标签栏，本页照同一套材质 —— 文字 + 选中下划线、无图标）→「我的任务 是折叠面板 未展开是项目名称和编号
 * 下拉是具体我的任务」→「我提出的问题就参考日报的问题追踪即可 也是折叠面板」→「表格内容要全」（问题表照
 * 「问题追踪」的完整六列：日期 / 问题描述 / 问题归类 / 解决方案或建议 / 问题附图 / 问题是否处理）→「直接把这个搬到
 * 我的任务不就好了」（任务表行口径照项目页任务表：四格进度点 / 负责人 / 状态 / 紧急重要度 / 逾期未交付 /
 * 开始·预计·实际日期；**只读** —— 工作台读面不带任务 version，不挂项目页那套点开编辑）。
 *
 * 数据：
 * - 读面 = GET /api/v1/workspace（frontend/src/workspaceApi.ts）—— 跨项目个人读面，仅会话、无项目路径参数。
 *   三组任务并进本页「按项目」折叠面板：项目顺序 = 组序（已逾期 → 今日待办 → 即将到期）里的首次出现顺序
 *   （最急的在最上），组内保持服务端 plannedEnd 升序；分组 / 排序全由服务端给定，本页不做任何本地日期推导。
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
import { ISSUE_CATEGORY_CLASS, ISSUE_TAG_CLASS } from "./components/ReportIssuePanel";
import { PRIORITY_CAPSULE_CLASS, STATUS_CAPSULE_CLASS } from "./components/TaskBoard";
import { TrackerDots } from "./components/Tracker";
import type { ReportPhoto } from "./data/reports";
import { usePhotoUrl } from "./fileApi";
import { fetchProjectIssues, ISSUE_STATE_NAMES } from "./reportApi";
import { displayStatusLabel, stageNameOf } from "./taskApi";
import { fetchWorkspace, type ApiWorkspace, type ApiWorkspaceIssue, type ApiWorkspaceTask } from "./workspaceApi";
import { projectViewHref, type WorkspaceTab } from "./useHashRoute";
import type { MeResponse } from "./types";

type WorkspacePageProps = {
  me: MeResponse;
  /** 当前标签（地址派生：`#/my-tasks` 缺省「我的任务」/ `#/my-tasks?tab=raised`「我提出的问题」）。 */
  tab: WorkspaceTab;
  /** 切标签：同步渲染并写回地址（replace，不新增历史条目）。 */
  onChangeTab: (tab: WorkspaceTab) => void;
};

/** 工作台三态（首屏加载 / 失败 / 就绪）—— 与「日报及问题」三个列表子视图同一套口径。 */
type WorkspaceState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: ApiWorkspace };

/** 任务三组：本页展示顺序 = 最急的「已逾期」在最前（键名与契约 WorkspaceTasks 同源）。 */
const TASK_GROUPS = ["overdue", "today", "upcoming"] as const;
type TaskGroupKey = (typeof TASK_GROUPS)[number];

const TASK_GROUP_LABEL: Record<TaskGroupKey, string> = { overdue: "已逾期", today: "今日待办", upcoming: "即将到期" };

/** 任务分组色签（与项目总览状态色系同一张表：红 = 已逾期、琥珀 = 今天、天蓝 = 7 天内）。 */
const TASK_GROUP_CHIP: Record<TaskGroupKey, string> = {
  overdue: "bg-rose-100 text-rose-700",
  today: "bg-amber-100 text-amber-800",
  upcoming: "bg-sky-100 text-sky-700",
};

/** 「液态玻璃」小框的**只读**形态（与 InlineEdit 的 InlineCell 静止态同一档材质）：项目页任务表里
 *  负责人 / 日期格是「点开编辑」的小胶囊；工作台读面不带 version（写不了），只借形、不接交互。 */
const GLASS_FRAME =
  "inline-flex max-w-full items-center gap-1 rounded-lg border border-zinc-200/90 bg-white/75 px-1.5 py-[3px] text-xs backdrop-blur-[3px]";

/** ISO（YYYY-MM-DD）→「M月D日」（项目页任务表日期格的短口径；工作台任务都落在 7 天窗口内，不带年份）。 */
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
 *  未知值原样兜底（契约受控，兜底只为不炸）。 */
function issueStateOf(state: string): { label: string; className: string } {
  if (state === "open" || state === "in_progress" || state === "done") {
    return { label: ISSUE_STATE_NAMES[state], className: ISSUE_TAG_CLASS[state] };
  }
  return { label: state, className: "bg-zinc-100 text-zinc-600" };
}

type ProjectTasks = {
  projectId: string;
  projectCode: string;
  projectName: string;
  items: Array<{ group: TaskGroupKey; task: ApiWorkspaceTask }>;
};

/** 我的任务三组 → 按项目归并（项目顺序 = 组序里的首次出现顺序；组内保持服务端 plannedEnd 升序）。 */
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

/** 折叠面板（业务口径「未展开是项目名称和编号 下拉是具体我的任务」「也是折叠面板」）：
 *  收起 = 项目名称 + 编号（+ 右侧摘要）；展开 = 该项目下的内容（任务表 / 问题表）。
 *  展开态是本页本地状态（不进地址）；面板壳 = 白卡 + 圆角描边 + 行悬停（与站内表格壳同一套材质）。 */
function ProjectPanel({ projectId, projectCode, projectName, summary, children }: {
  projectId: string;
  projectCode: string;
  projectName: string;
  /** 收起态右侧摘要（计数 / 逾期小签）。 */
  summary: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section data-workspace-panel={projectId} data-open={open ? "true" : "false"} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <button
        type="button"
        data-workspace-panel-toggle=""
        aria-expanded={open}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-zinc-50"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={"h-4 w-4 shrink-0 text-zinc-400 transition-transform " + (open ? "rotate-90" : "")}>
          <path d="M9.5 5.5 16 12l-6.5 6.5" />
        </svg>
        <span className="min-w-0 truncate text-sm font-semibold text-zinc-900">{projectName}</span>
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-zinc-600">{projectCode}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">{summary}</span>
      </button>
      {open ? <div className="border-t border-zinc-100 px-4 pb-4 pt-3">{children}</div> : null}
    </section>
  );
}

/** 收起态摘要（我的任务）：共 N 项 + 逾期 / 今日两枚小签（要不要展开一眼能判）。 */
function TaskPanelSummary({ items }: { items: ProjectTasks["items"] }) {
  const overdue = items.filter((item) => item.group === "overdue").length;
  const today = items.filter((item) => item.group === "today").length;
  return (
    <>
      <span className="text-xs font-normal text-zinc-400">{"共 " + String(items.length) + " 项"}</span>
      {overdue === 0 ? null : (
        <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + TASK_GROUP_CHIP.overdue}>{"已逾期 " + String(overdue)}</span>
      )}
      {today === 0 ? null : (
        <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + TASK_GROUP_CHIP.today}>{"今日 " + String(today)}</span>
      )}
    </>
  );
}

/** 展开区 ① 我的任务表：行口径直接照项目页任务表搬（业务口径「直接把这个搬到我的任务不就好了」）——
 *  任务描述 + 四格进度点 / 分组 / 任务负责人 / 任务状态 / 紧急重要度 / 是否按时交付 / 开始日期 / 预计完成日期 /
 *  实际完成日期。只读形态（工作台读面不带 version）：状态 / 紧急 / 负责人 / 日期借项目页的形，不挂点开编辑；
 *  项目页有、本项目读面没有的列（项目经理 / 成果文件 / 文件 / 进展描述 / 变更关联）不画空列，随读面扩列再接。 */
function TaskTable({ items }: { items: ProjectTasks["items"] }) {
  return (
    <div data-workspace-task-table="" className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">任务描述</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">分组</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">任务负责人</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">任务状态</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">紧急重要度</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">是否按时交付</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">开始日期</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">预计完成日期</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">实际完成日期</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {items.map(({ group, task }) => {
            const status = displayStatusLabel(task.displayStatus);
            const stage = stageNameOf(task.stageKey);
            const subtitle = (stage === "" ? "临时任务" : stage) + (task.titleEn === null || task.titleEn === "" ? "" : " · " + task.titleEn);
            const ownerText = task.ownerNames.map((name) => name ?? "").filter((name) => name !== "").join("、");
            const priorityClass =
              task.priority === null ? "" : ((PRIORITY_CAPSULE_CLASS as Record<string, string | undefined>)[task.priority] ?? "bg-zinc-100 text-zinc-500");
            return (
              <tr key={task.id} data-workspace-task={task.id} className="align-middle transition-colors hover:bg-zinc-50/80">
                <td className="min-w-[300px] px-4 py-3">
                  <span className="flex min-w-0 items-center gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-zinc-900" title={task.title + (task.titleEn === null ? "" : " / " + task.titleEn)}>{task.title}</span>
                      {subtitle === "" ? null : <span className="mt-0.5 block max-w-[280px] truncate text-[11px] leading-4 text-zinc-400">{subtitle}</span>}
                    </span>
                    <span data-workspace-task-dots={String(task.progress)} className="shrink-0">
                      <TrackerDots progress={task.progress} hovered={0} onHoverChange={() => { /* 只读展示：不接悬停预览 */ }} />
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + TASK_GROUP_CHIP[group]}>{TASK_GROUP_LABEL[group]}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {task.ownerIds.length === 0 ? (
                    <span className="text-xs text-zinc-300">待分配</span>
                  ) : (
                    <span className={GLASS_FRAME + " text-zinc-600"} title={ownerText}>{ownerText}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span data-workspace-task-status={task.displayStatus} className={"inline-block rounded-lg px-3 py-1.5 text-[11px] font-medium " + STATUS_CAPSULE_CLASS[status]}>{status}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {task.priority === null ? (
                    <span className="text-xs text-zinc-300">—</span>
                  ) : (
                    <span className={"inline-block rounded-lg px-3 py-1.5 text-[11px] font-medium " + priorityClass}>{task.priority}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {task.displayStatus === "overdue" ? (
                    <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">逾期未交付</span>
                  ) : (
                    <span className="text-xs text-zinc-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3"><DatePill iso={task.plannedStart} /></td>
                <td className="whitespace-nowrap px-4 py-3"><DatePill iso={task.plannedEnd} /></td>
                <td className="whitespace-nowrap px-4 py-3"><DatePill iso={task.actualEnd} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
 *  问题附图 / 问题是否处理 + 行尾「在项目中查看」（窄屏横向滚动）。 */
function IssueTable({ issues, full }: { issues: readonly ApiWorkspaceIssue[]; full: Map<string, IssueFull> }) {
  return (
    <div data-workspace-issue-table="" className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">日期</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题描述</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题归类</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">解决方案或建议</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题附图</th>
            <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 font-medium">问题是否处理</th>
            <th className="w-[110px] border-b border-zinc-200 px-4 py-2.5 font-medium">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {issues.map((issue) => {
            const state = issueStateOf(issue.state);
            const detail = full.get(issue.id);
            return (
              <tr key={issue.id} data-workspace-issue={issue.id} className="align-top transition-colors hover:bg-zinc-50/80">
                <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{cnDateFull(issue.raisedAt)}</td>
                <td className="min-w-[240px] px-4 py-3">
                  <span className="block whitespace-pre-line break-words leading-6 text-zinc-800">{issue.title}</span>
                </td>
                <td className="px-4 py-3">
                  <CategoryTags values={issue.categories} />
                </td>
                <td className="min-w-[280px] px-4 py-3">
                  <span data-workspace-issue-solution="" className="block whitespace-pre-line break-words leading-6 text-zinc-600">
                    {detail === undefined || detail.solution === "" ? "—" : detail.solution}
                  </span>
                </td>
                <td className="min-w-[440px] px-4 py-3">
                  <IssuePhotos photos={detail === undefined ? [] : detail.photos} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-center">
                  <span data-issue-state={issue.state} className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + state.className}>{state.label}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <a
                    href={projectViewHref(issue.projectId, "daily", "issues")}
                    title={"在项目中查看：" + issue.projectCode + " → 日报及问题 → 问题追踪"}
                    className="text-xs font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-900 hover:underline"
                  >
                    在项目中查看
                  </a>
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

/** 两个标签（业务口径「我的任务 我提出的问题先做这两个」；样式 = 任务模板页的下划线标签栏，文字 + 选中下划线）。 */
const TABS: ReadonlyArray<{ key: WorkspaceTab; label: string }> = [
  { key: "tasks", label: "我的任务" },
  { key: "raised", label: "我提出的问题" },
];

/** 标签 ① 我的任务：按项目的折叠面板 + 三组任务表。 */
function MyTasksView({ data }: { data: ApiWorkspace }) {
  const projects = groupTasksByProject(data);
  const total = data.myTasks.overdue.length + data.myTasks.today.length + data.myTasks.upcoming.length;
  return (
    <section data-workspace-tasks="" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">我的任务</h2>
        <span data-workspace-task-total="" className="text-xs text-zinc-400">
          {"共 " + String(total) + " 项 · 跨 " + String(projects.length) + " 个项目 · 基准日 " + cnDateFull(data.today)}
        </span>
      </div>
      {projects.length === 0 ? (
        <EmptyCard text="当前没有需要推进的任务。" hint="口径：任务负责人含我、未完成、预计完成日期在今天起 7 天内（含已逾期）；未排期与更远的任务不进这里。" />
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <ProjectPanel
              key={project.projectId}
              projectId={project.projectId}
              projectCode={project.projectCode}
              projectName={project.projectName}
              summary={<TaskPanelSummary items={project.items} />}
            >
              <TaskTable items={project.items} />
            </ProjectPanel>
          ))}
        </div>
      )}
    </section>
  );
}

/** 标签 ② 我提出的问题：按项目的折叠面板 + 照「问题追踪」六列的问题表。 */
function RaisedIssuesView({ issues }: { issues: readonly ApiWorkspaceIssue[] }) {
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
            >
              <IssueTable issues={project.issues} full={full} />
            </ProjectPanel>
          ))}
        </div>
      )}
    </section>
  );
}

/** 工作台「我的任务」页：两个标签（我的任务 / 我提出的问题）共用一份 GET /api/v1/workspace 聚合数据。 */
export default function WorkspacePage({ me, tab, onChangeTab }: WorkspacePageProps) {
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });
  /** 重新加载令牌：bump 一次重新取数（错误态的「重新加载」用）。 */
  const [reloadToken, setReloadToken] = useState(0);

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
      <AppHeader me={me} title="我的任务" />
      <main className="w-full px-6 pb-10 pt-3">
        <div data-workspace-page="" className="w-full space-y-5">
          {/* 标签导航栏（Push 230：与任务模板页的下划线标签栏同一套材质 —— 文字 + 选中下划线） */}
          <nav data-workspace-tabs="" aria-label="工作台标签" className="flex items-center gap-3 border-b border-zinc-200">
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
          </nav>

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
            <RaisedIssuesView issues={state.data.myIssues.raised} />
          ) : (
            <MyTasksView data={state.data} />
          )}
        </div>
      </main>
    </div>
  );
}
