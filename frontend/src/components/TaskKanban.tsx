import { useState, type ReactNode } from "react";
import { memberByName } from "../data/members";
import { lateDeliveryLabel, taskStatus, type ProjectTask, type TaskStatus } from "../data/tasks";
import { MemberAvatar } from "./MemberSelect";
import { TaskDrawer } from "./TaskDrawer";
import { TaskEditModal, type TaskEditSubmit } from "./TaskEditModal";
import { STATUS_TAG_CLASS } from "./TaskBoard";

/**
 * 项目详情页的两块看板（Push 82）：
 * - `owner`「人员任务分配」：列 = 任务负责人（人头维度），看每个人手上接了哪些任务；
 * - `status`「任务进展」：列 = 任务状态（已延期 → 进行中 → 已完成 → 提前完成 → 待开始），看每个状态有哪些任务。
 * 卡片材质按业务样张代码还原（外层壳 + 噪点叠加 + 内层板 + 多层投影），用 Tailwind 任意值实现，不引入 styled-components。
 * 卡片只出任务里真实存在的字段（标题 / 所属阶段 / 日期 / 状态 / 负责人 / 进度 / 是否按时交付）；任务字段里没有「里程碑」这一项，所以阶段一栏的口径是「所属阶段」，不写「阶段性里程碑」。
 * 看板列底部「+ 添加」建的空任务没有阶段，卡片「所属阶段」显示「未分组」，到「项目总览」落在「未分组」组（TaskBoard 兜底）。
 */
export type KanbanMode = "owner" | "status";

/** 「任务进展」看板的列顺序（业务定稿：已延期 → 进行中 → 已完成 → 提前完成 → 待开始）。 */
const STATUS_ORDER: readonly TaskStatus[] = ["已延期", "进行中", "已完成", "提前完成", "待开始"];

/** 阶段色签（卡片「所属阶段」一栏）：按阶段固定色（口径对齐业务样张里的色签）。 */
const STAGE_TAG_CLASS: Record<string, string> = {
  售前规划: "bg-violet-100 text-violet-700",
  设计开发: "bg-sky-100 text-sky-700",
  加工采购: "bg-zinc-200 text-zinc-600",
  组装发货: "bg-rose-100 text-rose-700",
  硬件实施: "bg-emerald-100 text-emerald-700",
  软件部署: "bg-amber-100 text-amber-800",
  试运行: "bg-teal-100 text-teal-700",
  生产阶段: "bg-indigo-100 text-indigo-700",
  验收: "bg-lime-100 text-lime-700",
};

/** 没有阶段的任务（直接在看板「添加」出来的）：卡片「所属阶段」显示「未分组」。 */
const UNGROUPED_STAGE = "未分组";

/** 卡片外壳（样张结构：内边距 9px + 圆角 35px + 壳 + 三层投影）。配色按业务反馈（2026-09-20）改回**白色**：白壳 + 发丝边 + 柔和投影 + 底部内阴影。 */
const CARD_SHELL =
  "relative block w-full rounded-[35px] border border-zinc-900/[0.07] bg-white p-[9px] text-left transition " +
  "[box-shadow:0_18px_40px_-20px_rgba(15,23,42,0.18),0_4px_14px_-8px_rgba(15,23,42,0.06),inset_0_-2px_6px_rgba(15,23,42,0.05)] " +
  "hover:-translate-y-0.5 focus-visible:[outline:2px_solid_rgba(24,24,27,0.3)] focus-visible:[outline-offset:2px]";

/** 细纹叠加（样张：`repeating-conic-gradient` 细纹 + 对比度 105%；白壳上透明度收到 6%，保持干净）。 */
const CARD_NOISE =
  "pointer-events-none absolute inset-0 rounded-[35px] opacity-[0.06] [filter:contrast(105%)] " +
  "bg-[repeating-conic-gradient(#e8e8e8_0.0000001%,#93a1a1_0.000104%)] [background-position:60%_60%] [background-size:600%_600%]";

/** 看板列：列高随视口封顶，列头固定不动，卡片多时在列内滚动 —— 列不再一直往下延伸（Push 85）。 */
const COLUMN_SHELL = "flex h-[calc(100vh-15.5rem)] max-h-[52rem] min-h-[22rem] w-[280px] shrink-0 flex-col";

/** 列内滚动区（`kanban-scroll` = `app.css` 里的细滚动条）：卡片列表与列底「+ 添加」都在这里滚。 */
const COLUMN_BODY = "kanban-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1";

/** 卡片内层板（样张：圆角 30px；白卡口径 = 近白面板 + 发丝内边）。 */
const CARD_INNER = "relative block overflow-hidden rounded-[30px] bg-[#fcfcfd] px-4 py-3.5 ring-1 ring-zinc-900/[0.04]";

type TaskKanbanProps = {
  mode: KanbanMode;
  tasks: ProjectTask[];
  /** 项目经理（项目级字段；任务详情抽屉展示用）。 */
  manager: string;
  /** 项目经理 id（任务编辑弹窗的当前选中项）。 */
  managerId: string;
  /** 列表底部的「+ 添加」：建一个空任务（负责人 / 状态按所在列给）。 */
  onAddTask: (group: { owner: string; ownerEn: string; status: TaskStatus }) => void;
  /** 任务编辑保存（与表格共用同一张覆盖表）。 */
  onSubmitTaskEdit?: (values: TaskEditSubmit) => void;
};

type KanbanGroup = {
  /** 列名（负责人姓名或「待分配」/ 状态名）。 */
  key: string;
  /** 该列新建任务时的默认负责人（状态列为空）。 */
  ownerEn: string;
  /** 该列新建任务时的默认状态（负责人列为「待开始」）。 */
  status: TaskStatus;
  items: ProjectTask[];
};

/** 分组：负责人按任务出现顺序排（「待分配」固定垫底）；状态按业务定稿顺序，空列也保留。 */
function groupTasks(tasks: ProjectTask[], mode: KanbanMode): KanbanGroup[] {
  if (mode === "status") {
    return STATUS_ORDER.map((status) => ({
      key: status,
      ownerEn: "",
      status,
      items: tasks.filter((task) => taskStatus(task) === status),
    }));
  }
  const byOwner = new Map<string, KanbanGroup>();
  for (const task of tasks) {
    const key = task.owner === "" ? "待分配" : task.owner;
    const found = byOwner.get(key);
    if (found === undefined) {
      byOwner.set(key, { key, ownerEn: task.ownerEn, status: "待开始", items: [task] });
    } else {
      found.items.push(task);
    }
  }
  const groups = Array.from(byOwner.values());
  return [...groups.filter((group) => group.key !== "待分配"), ...groups.filter((group) => group.key === "待分配")];
}

/** 姓名首字圆圈（负责人不在演示人员目录里时的兜底头像）。 */
function InitialAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[11px] font-semibold text-zinc-600"
    >
      {name === "" ? "?" : Array.from(name)[0]}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-400/40">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: pct + "%" }} />
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-700">{pct}%</span>
    </div>
  );
}

/** 「所属阶段」：任务所属的施工阶段（看板里直接建的任务没有阶段，显示「未分组」）。 */
function StageChip({ stage }: { stage: string }) {
  return (
    <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + (STAGE_TAG_CLASS[stage] ?? "bg-zinc-200 text-zinc-600")}>
      {stage === "" ? UNGROUPED_STAGE : stage}
    </span>
  );
}

/** 「是否按时交付」：逾期标注优先（与任务表同一口径），其次是数据里的按时交付值。 */
function OnTimeChip({ task }: { task: ProjectTask }) {
  const late = lateDeliveryLabel(task);
  if (late === "逾期未交付") {
    return <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">逾期未交付</span>;
  }
  if (late === "逾期已交付") {
    return <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">逾期已交付</span>;
  }
  if (task.onTime === "") {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  return <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">{task.onTime}</span>;
}

/** 看板卡片：点开任务详情抽屉（抽屉里可进任务编辑弹窗）。 */
function KanbanCard({ task, mode, onOpen }: { task: ProjectTask; mode: KanbanMode; onOpen: () => void }) {
  const status = taskStatus(task);
  const owner = memberByName(task.owner);
  const ownerLabel = task.owner === "" ? "待分配" : task.ownerEn === "" ? task.owner : task.owner + "(" + task.ownerEn + ")";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={"任务：" + task.title}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={CARD_SHELL + " cursor-pointer"}
    >
      <span aria-hidden="true" className={CARD_NOISE} />
      <div className={CARD_INNER}>
        <p className="text-sm leading-5 font-medium text-zinc-800">{task.title}</p>
        {task.titleEn === "" ? null : <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{task.titleEn}</p>}

        {mode === "owner" ? (
          <>
            <Field label="预计完成日期">
              <span className="text-sm text-zinc-800">{task.dueDate === "" ? "—" : task.dueDate}</span>
            </Field>
            <Field label="任务状态">
              <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_TAG_CLASS[status]}>{status}</span>
            </Field>
          </>
        ) : (
          <>
            <Field label="任务负责人">
              <span className="flex min-w-0 items-center gap-1.5">
                {owner === undefined ? <InitialAvatar name={task.owner} /> : <MemberAvatar member={owner} />}
                <span className="truncate text-sm text-zinc-800" title={ownerLabel}>{ownerLabel}</span>
              </span>
            </Field>
            <Field label="开始日期">
              <span className="text-sm text-zinc-800">{task.startDate === "" ? "—" : task.startDate}</span>
            </Field>
          </>
        )}

        <Field label="项目进度">
          <ProgressBar progress={task.progress} />
        </Field>
        <Field label="是否按时交付">
          <OnTimeChip task={task} />
        </Field>
        <Field label="所属阶段">
          <StageChip stage={task.stage} />
        </Field>
      </div>
    </div>
  );
}

function KanbanColumn({ group, mode, onOpenTask, onAdd }: { group: KanbanGroup; mode: KanbanMode; onOpenTask: (task: ProjectTask) => void; onAdd: () => void }) {
  const owner = memberByName(group.key);
  return (
    <section className={COLUMN_SHELL}>
      <header className="mb-3 flex items-center gap-2 px-1">
        {mode === "owner" ? (
          <>
            {owner === undefined ? <InitialAvatar name={group.key} /> : <MemberAvatar member={owner} />}
            <span className="truncate text-sm font-medium text-zinc-700" title={group.key}>{group.key}</span>
          </>
        ) : (
          <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_TAG_CLASS[group.status]}>{group.key}</span>
        )}
        <span className="shrink-0 text-xs text-zinc-400">{group.items.length}项</span>
      </header>
      <div className={COLUMN_BODY}>
        {group.items.map((task) => (
          <KanbanCard key={task.id} task={task} mode={mode} onOpen={() => { onOpenTask(task); }} />
        ))}
        <button
          type="button"
          onClick={onAdd}
          aria-label={"添加任务：" + group.key}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-zinc-200 bg-white py-2.5 text-xs text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className="h-3.5 w-3.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8.5v7M8.5 12h7" strokeLinecap="round" />
          </svg>
          添加
        </button>
      </div>
    </section>
  );
}

export function TaskKanban({ mode, tasks, manager, managerId, onAddTask, onSubmitTaskEdit }: TaskKanbanProps) {
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const groups = groupTasks(tasks, mode);

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-sm text-zinc-500">
        这个项目还没有任务：到「项目总览」点阶段标签，从任务节点 / 模板里挑节点加进来。
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start gap-4 overflow-x-auto pb-3">
        {groups.map((group) => (
          <KanbanColumn
            key={group.key}
            group={group}
            mode={mode}
            onOpenTask={(task) => {
              setSelectedTask(task);
            }}
            onAdd={() => {
              onAddTask({
                owner: mode === "owner" && group.key !== "待分配" ? group.key : "",
                ownerEn: mode === "owner" && group.key !== "待分配" ? group.ownerEn : "",
                status: mode === "status" ? group.status : "待开始",
              });
            }}
          />
        ))}
      </div>
      <TaskDrawer
        task={selectedTask}
        manager={manager}
        onEdit={onSubmitTaskEdit === undefined ? undefined : (task) => {
          setSelectedTask(null);
          setEditingTask(task);
        }}
        onClose={() => {
          setSelectedTask(null);
        }}
      />
      {editingTask !== null && onSubmitTaskEdit !== undefined ? (
        <TaskEditModal
          task={editingTask}
          managerId={managerId}
          onClose={() => {
            setEditingTask(null);
          }}
          onSubmit={(values) => {
            onSubmitTaskEdit(values);
            setEditingTask(null);
          }}
        />
      ) : null}
    </>
  );
}
