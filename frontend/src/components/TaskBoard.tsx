import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { PROJECT_STAGES } from "../data/projects";
import { MEMBER_DIRECTORY, PROJECT_MANAGERS, memberByName } from "../data/members";
import { PROGRESS_STEPS, PROJECT_MANAGER, cnDateFromIso, daysBetweenInclusive, isCompleteStatus, isTaskDone, isoFromCnDate, lateDeliveryLabel, progressAfterStatus, taskStatus, type ProjectTask, type TaskPriority, type TaskStatus } from "../data/tasks";
import { InlineDateCell, InlineMemberCell, InlineNumberCell, InlineOptionCell, InlineTextCell } from "./InlineEdit";
import type { SelectOption } from "./SelectMenu";
import { TaskDrawer } from "./TaskDrawer";
import type { TaskEditSubmit } from "./TaskDrawer";
import { Tracker } from "./Tracker";
import { StageAddCard } from "./StageAddCard";
import type { StagePlacement } from "./StageAddCard";
import type { TemplatePresetNode } from "../data/templatePresets";

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
  { key: "start", label: "开始日期", width: "0.66fr", min: 66 },
  { key: "days", label: "预计所需天数", width: "56px", min: 56, header: "" },
  { key: "due", label: "预计完成日期", width: "0.86fr", min: 86 },
  { key: "headcount", label: "预计所需施工人数", width: "1.08fr", min: 108 },
  { key: "doneDate", label: "实际完成日期", width: "0.86fr", min: 86 },
  { key: "change", label: "变更关联", width: "0.54fr", min: 54 },
];

export type VisibleColumns = Partial<Record<ColumnKey, boolean>>;

export const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
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

/** 状态色标签（表格行内下拉与单元格共用；看板「任务进展」的表头也用同一套，口径 = 业务截图里的五个色签）。 */
export const STATUS_TAG_CLASS: Record<TaskStatus, string> = {
  已延期: "bg-rose-100 text-rose-700",
  进行中: "bg-amber-100 text-amber-800",
  已完成: "bg-emerald-100 text-emerald-700",
  待开始: "bg-sky-100 text-sky-700",
  提前完成: "bg-fuchsia-100 text-fuchsia-700",
};

/** 任务状态可选项（顺序对齐业务截图：已延期 / 进行中 / 已完成 / 待开始 / 提前完成）。 */
const STATUS_OPTIONS: SelectOption[] = (["已延期", "进行中", "已完成", "待开始", "提前完成"] as TaskStatus[]).map((status) => ({
  value: status,
  label: <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_TAG_CLASS[status]}>{status}</span>,
}));

/** 行内编辑能改的任务字段（项目经理是项目级字段，不在其中）。 */
export type TaskPatch = Partial<Pick<ProjectTask, "owner" | "ownerEn" | "startDate" | "dueDate" | "doneDate" | "days" | "headcount" | "priority" | "note" | "progress" | "statusOverride">>;

const PRIORITY_OPTIONS = [
  { value: "高", label: "高" },
  { value: "中", label: "中" },
  { value: "低", label: "低" },
];

type TaskBoardProps = {
  tasks: ProjectTask[];
  onSetProgress?: (taskId: string, progress: number) => void;
  visibleColumns?: VisibleColumns;
  scrollRef?: RefObject<HTMLDivElement | null>;
  collapsed: Record<string, boolean>;
  onToggleStage: (stage: string) => void;
  onToggleAllStages: () => void;
  /** 没有数据也要出分组头的阶段（原型阶段没有任务的项目：只出阶段骨架，展开后没有任务行）。 */
  skeletonStages?: readonly string[];
  /** 「添加任务」：从任务模板预设里挑节点加进项目（不传 = 阶段标签点不开右侧卡片）。 */
  onAddNode?: (stage: string, node: TemplatePresetNode) => void;
  /** 加一条 / 一批并指定插入位置（Push 113：点「＋ 添加」先弹位置浮层，选完才加进项目）。不传 = 点一条直接加到该阶段最后。 */
  onAddNodes?: (stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => void;
  /** 项目经理（项目级字段：取项目卡片上的经理；不传时回落常量占位）。 */
  manager?: string;
  /** 项目经理 id（项目级字段：编辑弹窗「项目经理」下拉的当前选中项）。 */
  managerId?: string;
  /** 任务编辑保存：负责人 / 日期（含联动天数）/ 施工人数 / 紧急重要度 / 进展描述 + 项目经理 id。 */
  onSubmitTaskEdit?: (values: TaskEditSubmit) => void;
  /** 表格行内编辑：只改任务字段（负责人 / 日期（含联动天数）/ 施工人数 / 紧急重要度 / 进展描述）。 */
  onPatchTask?: (taskId: string, patch: TaskPatch) => void;
  /** 表格行内改「项目经理」：项目级字段，回写项目（不传 = 该列仍是只读文本）。 */
  onChangeManager?: (managerId: string) => void;
  /** 当前视图的阶段（「项目总览」或某个阶段）：换阶段时把右侧卡片关掉。 */
  viewStage?: string;
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

function TaskRow({ task, columns, selected, onSelect, onProgress, onEdit, manager, managerId, onChangeManager, onPatch }: { task: ProjectTask; columns: ColumnDef[]; selected: boolean; onSelect: () => void; onProgress: (progress: number) => void; onEdit: () => void; manager: string; managerId: string; onChangeManager?: (managerId: string) => void; onPatch?: (patch: TaskPatch) => void }) {
  /** 「是否按时交付」列的逾期标注（Push 67：逾期不再标在实际完成日期列）。 */
  const late = lateDeliveryLabel(task);
  const status = taskStatus(task);
  const dotClass = STATUS_DOT_CLASS[status];
  const fullOwner = task.ownerEn === "" ? task.owner : task.owner + "(" + task.ownerEn + ")";
  const ownerMember = memberByName(task.owner);
  const startIso = isoFromCnDate(task.startDate);
  const dueIso = isoFromCnDate(task.dueDate);
  const doneIso = isoFromCnDate(task.doneDate);
  /** 行内改任一日期时，把两个显示日期与联动天数一起写回（含首尾）。 */
  const patchRange = (nextStartIso: string, nextDueIso: string) => {
    onPatch?.({
      startDate: nextStartIso === "" ? "" : cnDateFromIso(nextStartIso),
      dueDate: nextDueIso === "" ? "" : cnDateFromIso(nextDueIso),
      days: nextStartIso !== "" && nextDueIso !== "" ? daysBetweenInclusive(nextStartIso, nextDueIso) : 0,
    });
  };

  const cells: Record<ColumnKey, ReactNode> = {
    title: (
      <div className="flex min-w-0 items-center gap-4 self-stretch pr-8">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-900" title={task.title + (task.titleEn === "" ? "" : " / " + task.titleEn)}>
            {task.title}
          </p>
          {task.titleEn === "" ? null : (
            <p className="mt-0.5 max-w-[280px] truncate text-[11px] leading-4 text-zinc-400" title={task.titleEn}>{task.titleEn}</p>
          )}
        </div>
        <Tracker progress={task.progress} onChange={onProgress} />
        <button
          type="button"
          aria-label="编辑任务"
          title="编辑任务"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="shrink-0 rounded-lg p-1.5 text-zinc-400 opacity-0 transition hover:bg-white hover:text-zinc-600 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    ),
    manager:
      onChangeManager === undefined ? (
        <span className="truncate text-xs text-zinc-600">{manager}</span>
      ) : (
        <InlineMemberCell
          value={managerId}
          options={PROJECT_MANAGERS}
          ariaLabel="修改项目经理"
          display={<span className="text-zinc-600">{manager}</span>}
          onPick={(member) => {
            onChangeManager(member.id);
          }}
        />
      ),
    owner:
      onPatch === undefined ? (
        task.owner === "" ? (
          <span className="text-xs text-zinc-300">待分配</span>
        ) : (
          <span className="truncate text-xs text-zinc-600" title={fullOwner}>
            {task.owner}
          </span>
        )
      ) : (
        <InlineMemberCell
          value={ownerMember?.id ?? ""}
          options={MEMBER_DIRECTORY}
          ariaLabel="修改任务负责人"
          display={
            task.owner === "" ? (
              <span className="text-zinc-300">待分配</span>
            ) : (
              <span className="text-zinc-600" title={fullOwner}>
                {task.owner}
              </span>
            )
          }
          onPick={(member) => {
            onPatch({ owner: member.name, ownerEn: member.handle });
          }}
        />
      ),
    status:
      onPatch === undefined ? (
        <span className={"inline-flex items-center gap-1.5 text-xs " + STATUS_TEXT_CLASS[status]}>
          <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + dotClass} />
          {status}
        </span>
      ) : (
        <InlineOptionCell
          value={status}
          options={STATUS_OPTIONS}
          ariaLabel="修改任务状态"
          display={<span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_TAG_CLASS[status]}>{status}</span>}
          onPick={(value) => {
            const next = value as TaskStatus;
            // 状态与四格进度条联动（Push 65）：选 已完成 / 提前完成 → 四格全亮；进行中 → 至少亮一格；待开始 → 清零；已延期 → 保持当前格数
            // 手动改成非完成态（待开始 / 进行中 / 已延期）时，实际完成日期一并清空（Push 67 业务定案）
            onPatch({
              statusOverride: next,
              progress: progressAfterStatus(next, task.progress),
              doneDate: isCompleteStatus(next) ? task.doneDate : "",
            });
          }}
        />
      ),
    priority: (
      <span>
        {onPatch === undefined ? (
          <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + PRIORITY_CLASS[task.priority]}>
            {task.priority}
          </span>
        ) : (
          <InlineOptionCell
            value={task.priority}
            options={PRIORITY_OPTIONS}
            ariaLabel="修改紧急重要度"
            display={
              <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + PRIORITY_CLASS[task.priority]}>
                {task.priority}
              </span>
            }
            onPick={(value) => {
              onPatch({ priority: value as TaskPriority });
            }}
          />
        )}
      </span>
    ),
    onTime: (
      <span>
        {late === "逾期未交付" ? (
          <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">逾期未交付</span>
        ) : late === "逾期已交付" ? (
          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">逾期已交付</span>
        ) : task.onTime === "" ? (
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
        {onPatch === undefined ? (
          task.note === "" ? (
            <span className="text-xs text-zinc-300">—</span>
          ) : (
            <span className="block truncate text-xs text-zinc-600" title={task.note}>{task.note}</span>
          )
        ) : (
          <InlineTextCell
            value={task.note}
            ariaLabel="修改项目进展描述"
            display={task.note === "" ? <span className="text-zinc-300">—</span> : <span className="text-zinc-600" title={task.note}>{task.note}</span>}
            onSave={(value) => {
              onPatch({ note: value });
            }}
          />
        )}
      </span>
    ),
    start:
      onPatch === undefined ? (
        <span className="text-xs tabular-nums text-zinc-600">{task.startDate}</span>
      ) : (
        <InlineDateCell
          valueIso={startIso}
          ariaLabel="修改开始日期"
          triggerClassName="tabular-nums text-zinc-600"
          display={task.startDate === "" ? <span className="text-zinc-300">—</span> : task.startDate}
          onChange={(iso) => {
            patchRange(iso, dueIso);
          }}
        />
      ),
    days: (
      <span className="relative flex items-center justify-center self-stretch">
        <span className="h-px w-10 bg-zinc-300" />
        <span className="absolute inset-x-0 bottom-1/2 mb-1 text-center text-[11px] leading-none tabular-nums text-zinc-500">{task.days}</span>
      </span>
    ),
    due:
      onPatch === undefined ? (
        <span className="text-xs tabular-nums text-zinc-600">{task.dueDate}</span>
      ) : (
        <InlineDateCell
          valueIso={dueIso}
          ariaLabel="修改预计完成日期"
          triggerClassName="tabular-nums text-zinc-600"
          display={task.dueDate === "" ? <span className="text-zinc-300">—</span> : task.dueDate}
          onChange={(iso) => {
            patchRange(startIso, iso);
          }}
        />
      ),
    headcount: (
      <span className="text-xs tabular-nums text-zinc-600">
        {onPatch === undefined ? (
          task.headcount > 0 ? (
            task.headcount + " 人"
          ) : (
            <span className="text-zinc-300">—</span>
          )
        ) : (
          <InlineNumberCell
            value={task.headcount}
            ariaLabel="修改预计所需施工人数"
            display={task.headcount > 0 ? task.headcount + " 人" : <span className="text-zinc-300">—</span>}
            onSave={(value) => {
              onPatch({ headcount: value });
            }}
          />
        )}
      </span>
    ),
    doneDate: (
      <span className="text-xs tabular-nums">
        {onPatch === undefined ? (
          task.doneDate !== "" ? (
            <span className="text-zinc-600">{task.doneDate}</span>
          ) : (
            <span className="text-zinc-400">—</span>
          )
        ) : (
          <InlineDateCell
            valueIso={doneIso}
            ariaLabel="修改实际完成日期"
            triggerClassName="tabular-nums"
            display={
              task.doneDate !== "" ? (
                <span className="text-zinc-600">{task.doneDate}</span>
              ) : (
                <span className="text-zinc-400">—</span>
              )
            }
            onChange={(iso) => {
              // 填实际完成日期 = 完成（四格全亮、状态按工期派生）；清空 = 退回进行中（3 格），与状态 / 进度条同一套口径
              onPatch({
                doneDate: iso === "" ? "" : cnDateFromIso(iso),
                progress: iso === "" ? (PROGRESS_STEPS - 1) / PROGRESS_STEPS : 1,
                statusOverride: iso === "" ? "进行中" : undefined,
              });
            }}
          />
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
        "group grid cursor-pointer items-center px-5 py-2.5 transition-colors focus-visible:outline-none " +
        (selected ? "bg-amber-50/70 shadow-[inset_3px_0_0_0_#feca04]" : "hover:bg-zinc-50/80 focus-visible:bg-zinc-50")
      }
      style={{ gridTemplateColumns: columns.map((column) => column.width).join(" ") }}
    >
      {columns.map((column) => (
        <Fragment key={column.key}>
          {column.key === "title" ? (
            cells[column.key]
          ) : (
            // 单元格内容一律居中于列标题（Push 67 业务口径）；任务描述列保持左对齐（内含四格进度条 + 铅笔）
            <div className="flex min-w-0 items-center justify-center self-stretch">{cells[column.key]}</div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function ProjectSummary({ tasks }: { tasks: ProjectTask[] }) {
  const total = tasks.length;
  const done = tasks.filter(isTaskDone).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  /** 没有任务的项目（原型阶段除印度外）：当前阶段给占位符，不写「全部完成」这种会误读的结论。 */
  const currentStage =
    total === 0
      ? "—"
      : (STAGE_ORDER.find((stage) => {
          const items = tasks.filter((task) => task.stage === stage);
          return items.length > 0 && items.some((task) => !isTaskDone(task));
        }) ?? "全部完成");

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
        {/* 没有任务的项目（原型阶段除印度外）：不显示 0/0 完成这种没有意义的计数 */}
        {total === 0 ? null : (
          <span className="text-xs text-zinc-400">
            已完成 {done}/{total}
          </span>
        )}
      </div>
    </div>
  );
}

export function TaskBoard({ tasks, onSetProgress, visibleColumns, scrollRef, collapsed, onToggleStage, onToggleAllStages, skeletonStages, onAddNode, onAddNodes, viewStage, manager, managerId, onSubmitTaskEdit, onPatchTask, onChangeManager }: TaskBoardProps) {
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  /** 右侧「任务节点 / 模板」卡片停在哪个阶段（点阶段标签打开）。 */
  const [cardStage, setCardStage] = useState<string | null>(null);
  /** 卡片的落点（Push 67：固定在表格表头正下方、左边缘对齐「项目经理」列，不浮在页面右上角、也不跟着点击跑）。 */
  const [cardBox, setCardBox] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const boardCardRef = useRef<HTMLDivElement | null>(null);
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  const closeDrawer = () => setSelectedTask(null);
  /** 抽屉里的任务按 id 取当前值（Push 98）：抽屉里点四格进度、卡片上改实际完成日期后，抽屉要立刻跟着变 ——
   *  不能拿点击那一刻的任务快照，否则父级刷新后抽屉还显示旧进度。 */
  const drawerTask = selectedTask === null ? null : tasks.find((task) => task.id === selectedTask.id) ?? selectedTask;
  const columns = resolveColumns(visibleColumns ?? DEFAULT_VISIBLE_COLUMNS);
  const gridTemplate = columns.map((column) => column.width).join(" ");
  const minWidth = columns.reduce((total, column) => total + column.min, 0);
  /** 项目里已有的任务 id：添加任务时用来判断节点是不是已经加过。 */
  const existingTaskIds = new Set(tasks.map((task) => task.id));
  /**
   * 该阶段现有任务（Push 113）：给「点 ＋ 添加 → 选位置」当锚点 —— `tasks` 已经是展示顺序
   * （阶段为主键、组内按看板顺序表），所以这里的先后 = 项目总览里这些任务的先后。
   */
  const stageTasksOf = (stage: string) =>
    tasks.filter((task) => task.stage === stage).map((task) => ({ id: task.id, title: task.title }));
  // 换阶段标签（顶部）时把卡片关掉，避免卡片停在上一个阶段的上下文里
  useEffect(() => {
    setCardStage(null);
  }, [viewStage]);

  /**
   * 量落点（Push 67，业务定稿版）：卡片**顶部与所点阶段的分组头在同一水平线**（卡顶 = 分组头顶，卡片正好贴在这一阶段左边，
   * 页面滚到哪都保持这条水平线），左边缘对齐「项目经理」列（该列被列显隐关掉时回落到表格右边、始终夹在表格内）。
   */
  const measureCardBox = (stage: string) => {
    const wrap = boardWrapRef.current;
    const board = boardCardRef.current;
    const header = headerRowRef.current;
    if (wrap === null || board === null || header === null) {
      return null;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const stageHeader = board.querySelector('[data-stage-header="' + stage + '"]');
    // 分组头找不到（异常情况）时回落到表头下沿
    const topRect = stageHeader === null ? null : stageHeader.getBoundingClientRect();
    const cardWidth = Math.min(400, wrapRect.width - 48);
    const managerCell = header.querySelector('[data-column="manager"]');
    const managerRect = managerCell === null ? null : managerCell.getBoundingClientRect();
    // 回落到右边（项目经理列被列显隐关掉时），并保证卡片不出表格
    const naturalLeft = managerRect === null ? boardRect.right - 24 - cardWidth : managerRect.left;
    const minLeft = boardRect.left + 16;
    const maxLeft = boardRect.right - 24 - cardWidth;
    const top = topRect === null ? headerRect.bottom + 10 : topRect.top;
    return {
      top: Math.round(top - wrapRect.top),
      left: Math.round(Math.max(minLeft, Math.min(maxLeft, naturalLeft)) - wrapRect.left),
      maxHeight: Math.round(Math.max(320, Math.min(window.innerHeight * 0.72, boardRect.bottom - top - 16))),
    };
  };

  /** 点阶段标签：再点同一个 = 关掉；开的时候先量好落点，避免卡片先闪在旧位置。 */
  const toggleCard = (stage: string) => {
    if (cardStage === stage) {
      setCardStage(null);
      return;
    }
    setCardBox(measureCardBox(stage));
    setCardStage(stage);
  };

  // 表格尺寸变化（列显隐 / 阶段折叠 / 换项目）与窗口缩放时重新量落点
  useEffect(() => {
    if (cardStage === null) {
      return;
    }
    const update = () => {
      setCardBox(cardStage === null ? null : measureCardBox(cardStage));
    };
    update();
    window.addEventListener("resize", update);
    // 表格横向滚动时「项目经理」列会跟着动，卡片跟着列走
    const scroller = scrollRef?.current ?? null;
    scroller?.addEventListener("scroll", update);
    const observer = new ResizeObserver(update);
    if (boardCardRef.current !== null) {
      observer.observe(boardCardRef.current);
    }
    return () => {
      window.removeEventListener("resize", update);
      scroller?.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [cardStage, scrollRef]);

  /** 阶段不在九阶段里的任务（看板「添加」直接建的空任务）归到「未分组」组，依旧能在表里看到。 */
  const stageOf = (task: ProjectTask) => (task.stage === "" ? "未分组" : task.stage);
  const groups = [...STAGE_ORDER, "未分组"]
    .map((stage) => ({
      stage,
      items: tasks.filter((task) => stageOf(task) === stage),
    }))
    .filter((group) => group.items.length > 0 || (skeletonStages?.includes(group.stage) ?? false));
  const stages = groups.map((group) => group.stage);
  const allCollapsed = stages.length > 0 && stages.every((stage) => collapsed[stage] === true);

  return (
    <>
      <div ref={boardWrapRef} className="relative">
      <div ref={boardCardRef} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div id="task-board-scroll" ref={scrollRef} className="overflow-x-auto">
        <div style={{ minWidth: minWidth }}>
          <div
            ref={headerRowRef}
            className="grid items-center border-b border-zinc-200 bg-zinc-50/70 px-5 py-2.5 text-xs font-medium text-zinc-400"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {columns.map((column) =>
              column.key === "title" ? (
                <span key={column.key} data-column={column.key} className="flex min-w-0 items-center gap-2.5">
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
                  data-column={column.key}
                  title={column.label === "" ? undefined : column.label}
                  className={"truncate text-center " + (column.headerClass ?? "")}
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
                <div
                  data-stage-header={group.stage}
                  role="button"
                  tabIndex={0}
                  aria-expanded={!isCollapsed}
                  onClick={() => {
                    onToggleStage(group.stage);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggleStage(group.stage);
                    }
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 bg-zinc-100 px-5 py-3 text-left transition hover:bg-zinc-200/60"
                >
                  <Chevron collapsed={isCollapsed} />
                  {/* 点这个阶段标签 = 开 / 关右侧「任务节点 + 模板」卡片（再点同一个标签就关掉；折叠 / 展开仍点整行或左侧箭头） */}
                  <button
                    type="button"
                    data-stage-pill="true"
                    aria-expanded={cardStage === group.stage}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCard(group.stage);
                    }}
                    title="打开右侧卡片：这个阶段的任务节点 + 模板（预览 / 添加到项目）"
                    className={
                      "relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-white px-3 py-1.5 ring-1 transition " +
                      (cardStage === group.stage ? "ring-2 ring-[#feca04]/70" : "ring-zinc-200 hover:ring-zinc-300")
                    }
                  >
                    <span className="liquid-fill" style={{ height: pct + "%" }} aria-hidden="true" />
                    <span className="relative text-sm font-semibold text-zinc-800">{group.stage}</span>
                    {/* 空阶段（只出骨架的项目）：只留阶段名，不显示 0/0 完成 */}
                    {group.items.length === 0 ? null : (
                      <span className="relative text-xs text-zinc-500">
                        已完成 {done}/{group.items.length}
                      </span>
                    )}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="relative h-3 w-3 text-zinc-400">
                      <path d="M4 5h16v14H4z" />
                      <path d="M14.5 5v14" />
                    </svg>
                  </button>
                </div>
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
                        onEdit={() => {
                          setSelectedTask(task);
                        }}
                        manager={manager ?? PROJECT_MANAGER}
                        managerId={managerId ?? ""}
                        onChangeManager={onChangeManager}
                        onPatch={onPatchTask === undefined ? undefined : (patch) => onPatchTask(task.id, patch)}
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
      {cardStage !== null && (onAddNode !== undefined || onAddNodes !== undefined) ? (
        <StageAddCard
          stage={cardStage}
          existingTaskIds={existingTaskIds}
          onAddNode={onAddNode}
          placement={onAddNodes === undefined ? undefined : { tasks: stageTasksOf(cardStage) }}
          onAddNodes={onAddNodes}
          onClose={() => setCardStage(null)}
          style={cardBox === null ? { top: 10, left: 24 } : cardBox}
        />
      ) : null}
      </div>
      <TaskDrawer
        task={drawerTask}
        manager={manager ?? PROJECT_MANAGER}
        managerId={managerId ?? ""}
        onSubmit={onSubmitTaskEdit}
        onProgress={onSetProgress}
        onPatch={onPatchTask}
        onClose={closeDrawer}
      />
    </>
  );
}
