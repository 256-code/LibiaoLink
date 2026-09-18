import { Fragment, useState, type ReactNode, type RefObject } from "react";
import { PROJECT_STAGES } from "../data/projects";
import { PROJECT_MANAGER, isTaskDone, isTaskOverdue, taskStatus, type ProjectTask, type TaskPriority, type TaskStatus } from "../data/tasks";
import { TaskDrawer } from "./TaskDrawer";
import { Tracker } from "./Tracker";

const STAGE_ORDER: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

export type ColumnKey =
  | "title"
  | "manager"
  | "owner"
  | "status"
  | "priority"
  | "onTime"
  | "deliverable"
  | "files"
  | "note"
  | "start"
  | "days"
  | "due"
  | "headcount"
  | "doneDate"
  | "change";

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  width: string;
  min: number;
  header?: string;
  headerClass?: string;
  locked?: boolean;
};

export const TABLE_COLUMNS: ColumnDef[] = [
  { key: "title", label: "任务描述", width: "340px", min: 340, locked: true },
  { key: "manager", label: "项目经理", width: "0.66fr", min: 66 },
  { key: "owner", label: "任务负责人", width: "0.76fr", min: 76 },
  { key: "status", label: "任务状态", width: "0.68fr", min: 68 },
  { key: "priority", label: "紧急重要度", width: "0.74fr", min: 74 },
  { key: "onTime", label: "是否按时交付", width: "0.86fr", min: 86 },
  { key: "deliverable", label: "输出成果文件", width: "0.86fr", min: 86 },
  { key: "files", label: "文件", width: "0.96fr", min: 96 },
  { key: "note", label: "项目进展描述", width: "0.9fr", min: 90 },
  { key: "start", label: "开始日期", width: "0.66fr", min: 66, headerClass: "text-right" },
  { key: "days", label: "预计所需天数", width: "56px", min: 56, header: "" },
  { key: "due", label: "预计完成日期", width: "0.86fr", min: 86 },
  { key: "headcount", label: "预计所需施工人数", width: "1.08fr", min: 108 },
  { key: "doneDate", label: "实际完成日期", width: "0.86fr", min: 86 },
  { key: "change", label: "变更关联", width: "0.54fr", min: 54 },
];

export type VisibleColumns = Partial<Record<ColumnKey, boolean>>;

export const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
  files: false,
  note: false,
  headcount: false,
};

export function resolveColumns(visible: VisibleColumns): ColumnDef[] {
  const columns = TABLE_COLUMNS.filter((column) => column.locked === true || visible[column.key] !== false);
  const has = (key: ColumnKey) => columns.some((column) => column.key === key);
  if (!has("start") || !has("due")) {
    return columns.filter((column) => column.key !== "days");
  }
  return columns;
}

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  高: "bg-rose-50 text-rose-600",
  中: "bg-amber-50 text-amber-700",
  低: "bg-zinc-100 text-zinc-500",
};

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  已完成: "bg-emerald-500",
  提前完成: "bg-emerald-500",
  进行中: "bg-blue-500",
  已延期: "bg-red-500",
  待开始: "bg-zinc-300",
};

const STATUS_TEXT_CLASS: Record<TaskStatus, string> = {
  已完成: "text-zinc-600",
  提前完成: "text-emerald-700",
  进行中: "text-zinc-600",
  已延期: "text-red-600",
  待开始: "text-zinc-600",
};

type TaskBoardProps = {
  tasks: ProjectTask[];
  onSetProgress?: (taskId: string, progress: number) => void;
  visibleColumns?: VisibleColumns;
  scrollRef?: RefObject<HTMLDivElement | null>;
  collapsed: Record<string, boolean>;
  onToggleStage: (stage: string) => void;
  onToggleAllStages: () => void;
};

function shortenFileName(name: string): string {
  const chars = Array.from(name);
  return chars.length <= 4 ? name : chars.slice(0, 4).join("") + "…";
}

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={"h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform " + (collapsed ? "" : "rotate-90")}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function TaskRow({ task, columns, selected, onSelect, onProgress }: { task: ProjectTask; columns: ColumnDef[]; selected: boolean; onSelect: () => void; onProgress: (progress: number) => void }) {
  const overdue = isTaskOverdue(task);
  const status = taskStatus(task);
  const dotClass = STATUS_DOT_CLASS[status];
  const fullOwner = task.ownerEn === "" ? task.owner : task.owner + "(" + task.ownerEn + ")";

  const cells: Record<ColumnKey, ReactNode> = {
    title: (
      <div className="flex min-w-0 items-center gap-4 self-stretch pr-8">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-zinc-800" title={task.title + (task.titleEn === "" ? "" : " / " + task.titleEn)}>
            {task.title}
          </p>
          {task.titleEn === "" ? null : (
            <p className="mt-0.5 max-w-[280px] truncate text-[11px] leading-4 text-zinc-400" title={task.titleEn}>{task.titleEn}</p>
          )}
        </div>
        <Tracker progress={task.progress} onChange={onProgress} />
      </div>
    ),
    manager: <span className="truncate text-xs text-zinc-600">{PROJECT_MANAGER}</span>,
    owner: (
      <span className="truncate text-xs text-zinc-600" title={fullOwner}>
        {task.owner}
      </span>
    ),
    status: (
      <span className={"flex items-center gap-1.5 text-xs " + STATUS_TEXT_CLASS[status]}>
        <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + dotClass} />
        {status}
      </span>
    ),
    priority: (
      <span>
        <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + PRIORITY_CLASS[task.priority]}>
          {task.priority}
        </span>
      </span>
    ),
    onTime: (
      <span>
        {task.onTime === "" ? (
          <span className="text-xs text-zinc-300">—</span>
        ) : (
          <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">{task.onTime}</span>
        )}
      </span>
    ),
    deliverable: (
      <span className="min-w-0">
        {task.deliverable === "" ? (
          <span className="text-xs text-zinc-300">—</span>
        ) : (
          <span className="inline-block max-w-full truncate rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">{task.deliverable}</span>
        )}
      </span>
    ),
    files: (
      <span className="min-w-0">
        {task.files.length === 0 ? (
          <span className="text-xs text-zinc-300">—</span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="inline-block max-w-full truncate rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600" title={task.files.join("、")}>{shortenFileName(task.files[0])}</span>
            {task.files.length > 1 ? <span className="text-[10px] text-zinc-400">+{task.files.length - 1}</span> : null}
          </span>
        )}
      </span>
    ),
    note: (
      <span className="min-w-0">
        {task.note === "" ? (
          <span className="text-xs text-zinc-300">—</span>
        ) : (
          <span className="block truncate text-xs text-zinc-600" title={task.note}>{task.note}</span>
        )}
      </span>
    ),
    start: <span className="justify-self-end text-xs tabular-nums text-zinc-600">{task.startDate}</span>,
    days: (
      <span className="relative flex items-center justify-center self-stretch">
        <span className="h-px w-10 bg-zinc-300" />
        <span className="absolute inset-x-0 bottom-1/2 mb-1 text-center text-[11px] leading-none tabular-nums text-zinc-500">{task.days}</span>
      </span>
    ),
    due: <span className="text-xs tabular-nums text-zinc-600">{task.dueDate}</span>,
    headcount: (
      <span className="text-xs tabular-nums text-zinc-600">
        {task.headcount > 0 ? task.headcount + " 人" : <span className="text-zinc-300">—</span>}
      </span>
    ),
    doneDate: (
      <span className="text-xs tabular-nums">
        {task.doneDate !== "" ? (
          <span className="text-zinc-600">{task.doneDate}</span>
        ) : overdue ? (
          <span className="font-medium text-red-600">逾期</span>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </span>
    ),
    change: (
      <span>
        {task.change === "" ? null : (
          <span title={"变更日期 " + task.change} className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
            变更
          </span>
        )}
      </span>
    ),
  };

  return (
    <div
      role="button"
      tabIndex={0}
      title="点击查看任务详情"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={
        "grid cursor-pointer items-center px-5 py-2.5 transition-colors focus-visible:outline-none " +
        (selected ? "bg-amber-50/70 shadow-[inset_3px_0_0_0_#feca04]" : "hover:bg-zinc-50/80 focus-visible:bg-zinc-50")
      }
      style={{ gridTemplateColumns: columns.map((column) => column.width).join(" ") }}
    >
      {columns.map((column) => (
        <Fragment key={column.key}>{cells[column.key]}</Fragment>
      ))}
    </div>
  );
}

export function ProjectSummary({ tasks }: { tasks: ProjectTask[] }) {
  const total = tasks.length;
  const done = tasks.filter(isTaskDone).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const currentStage =
    STAGE_ORDER.find((stage) => {
      const items = tasks.filter((task) => task.stage === stage);
      return items.length > 0 && items.some((task) => !isTaskDone(task));
    }) ?? "全部完成";

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-xl border border-zinc-200 bg-white px-5 py-3.5">
      <p className="text-xs text-zinc-500">
        当前阶段<span className="ml-1.5 text-sm font-bold text-zinc-800">{currentStage}</span>
      </p>
      <div className="ml-auto flex items-center gap-2.5">
        <span className="text-xs text-zinc-500">整体进度</span>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full rounded-full bg-zinc-900" style={{ width: pct + "%" }} />
        </div>
        <span className="text-sm font-semibold tabular-nums text-zinc-900">{pct}%</span>
        <span className="text-xs text-zinc-400">
          {done}/{total} 完成
        </span>
      </div>
    </div>
  );
}

export function TaskBoard({ tasks, onSetProgress, visibleColumns, scrollRef, collapsed, onToggleStage, onToggleAllStages }: TaskBoardProps) {
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const closeDrawer = () => setSelectedTask(null);
  const columns = resolveColumns(visibleColumns ?? DEFAULT_VISIBLE_COLUMNS);
  const gridTemplate = columns.map((column) => column.width).join(" ");
  const minWidth = columns.reduce((total, column) => total + column.min, 0);

  const groups = STAGE_ORDER.map((stage) => ({
    stage,
    items: tasks.filter((task) => task.stage === stage),
  })).filter((group) => group.items.length > 0);
  const stages = groups.map((group) => group.stage);
  const allCollapsed = stages.length > 0 && stages.every((stage) => collapsed[stage] === true);

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div id="task-board-scroll" ref={scrollRef} className="overflow-x-auto">
        <div style={{ minWidth: minWidth }}>
          <div
            className="grid items-center border-b border-zinc-200 bg-zinc-50/70 px-5 py-2.5 text-xs font-medium text-zinc-400"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {columns.map((column) =>
              column.key === "title" ? (
                <span key={column.key} className="flex min-w-0 items-center gap-2.5">
                  <span className="truncate">{column.header ?? column.label}</span>
                  <button
                    type="button"
                    onClick={onToggleAllStages}
                    disabled={stages.length === 0}
                    aria-label={allCollapsed ? "展开全部阶段" : "收起全部阶段"}
                    title={allCollapsed ? "展开全部阶段" : "收起全部阶段"}
                    className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-3 w-3">
                      {allCollapsed ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 6.5 12 11.5l5-5M7 11.5l5 5 5-5" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5 12 6.5l5 5M7 16.5l5-5 5 5" />
                      )}
                    </svg>
                    {allCollapsed ? "全部展开" : "一键收起"}
                  </button>
                </span>
              ) : (
                <span
                  key={column.key}
                  title={column.label === "" ? undefined : column.label}
                  className={"truncate " + (column.headerClass ?? "")}
                >
                  {column.header ?? column.label}
                </span>
              ),
            )}
          </div>
          {groups.map((group) => {
            const done = group.items.filter(isTaskDone).length;
            const pct = group.items.length === 0 ? 0 : Math.round((done / group.items.length) * 100);
            const isCollapsed = collapsed[group.stage] === true;
            return (
              <section key={group.stage} className="border-b border-zinc-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    onToggleStage(group.stage);
                  }}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2.5 bg-zinc-100 px-5 py-3 text-left transition hover:bg-zinc-200/60"
                >
                  <Chevron collapsed={isCollapsed} />
                  <span className="relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-white px-3 py-1.5 ring-1 ring-zinc-200">
                    <span className="liquid-fill" style={{ height: pct + "%" }} aria-hidden="true" />
                    <span className="relative text-sm font-semibold text-zinc-800">{group.stage}</span>
                    <span className="relative text-xs text-zinc-500">
                      {done}/{group.items.length} 完成
                    </span>
                  </span>
                </button>
                {isCollapsed ? null : (
                  <div className="divide-y divide-zinc-100">
                    {group.items.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        columns={columns}
                        selected={selectedTask !== null && selectedTask.id === task.id}
                        onSelect={() => setSelectedTask(task)}
                        onProgress={(progress) => onSetProgress?.(task.id, progress)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
      </div>
      <TaskDrawer task={selectedTask} onClose={closeDrawer} />
    </>
  );
}
