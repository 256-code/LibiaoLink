import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ColumnPicker } from "./components/ColumnPicker";
import { ReportIssuePanel } from "./components/ReportIssuePanel";
import { TableScrollbar } from "./components/TableScrollbar";
import { DEFAULT_VISIBLE_COLUMNS, ProjectSummary, TaskBoard, type ColumnKey, type TaskPatch, type VisibleColumns } from "./components/TaskBoard";
import type { TaskEditSubmit } from "./components/TaskDrawer";
import { TaskKanban, type KanbanAddContext } from "./components/TaskKanban";
import type { StagePlacement } from "./components/StageAddCard";
import { PROJECT_STAGES } from "./data/projects";
import { isCompleteStatus, isPastDue, progressAfterStatus, statusOverrideAfterProgress, tasksForProject, type ProjectTask, type TaskStatus } from "./data/tasks";
import type { TemplatePresetNode } from "./data/templatePresets";
import { managerName } from "./data/managers";
import type { MeResponse, Project } from "./types";

/** 阶段名（不含「项目总览」汇总视图）。 */
const STAGE_NAMES: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/**
 * 阶段序号（Push 111）：展示顺序以**阶段为主键**，顺序就是项目总览的分组顺序（售前规划 → … → 验收）。
 * 不在九阶段里的（看板「临时任务」建的空任务）= 未分组，垫底 —— 与项目总览里「未分组」固定最后一组的口径一致。
 */
function stageRankOf(stage: string): number {
  const at = STAGE_NAMES.indexOf(stage);
  return at < 0 ? STAGE_NAMES.length : at;
}

/**
 * 顶部视图标签（Push 82 定稿）：阶段标签不再各占一格，改成「项目总览 + 两块看板」；
 * Push 128：再往后加第四个视图「日报及问题」（口径见 components/ReportIssuePanel.tsx）。
 */
const VIEW_TABS: readonly string[] = ["项目总览", "人员任务分配", "任务进展", "日报及问题"];

/** 从任务模板预设加进来的任务：字段先给默认值（负责人 / 日期等留空，后续在任务详情里补）。 */
function taskFromPresetNode(stage: string, node: TemplatePresetNode): ProjectTask {
  return {
    id: node.id,
    stage,
    title: node.title,
    titleEn: node.titleEn,
    owner: "",
    ownerEn: "",
    status: "待开始",
    progress: 0,
    startDate: "",
    dueDate: "",
    doneDate: "",
    days: 0,
    deliverable: "",
    change: "",
    onTime: "",
    note: "",
    headcount: 0,
    priority: "中",
    files: [],
  };
}

let quickTaskSeq = 0;

/** 看板「添加 → 临时任务」建的任务（Push 86）：标题 / 英文名由用户自己填，负责人 / 状态按所在列给（阶段留空 → 项目总览里落在「未分组」）。 */
function quickTask(group: { owner: string; ownerEn: string; status: TaskStatus }, title: string, titleEn: string): ProjectTask {
  quickTaskSeq += 1;
  return {
    id: "quick-" + String(quickTaskSeq) + "-" + String(Date.now()),
    stage: "",
    title,
    titleEn,
    owner: group.owner,
    ownerEn: group.ownerEn,
    status: group.status,
    statusOverride: group.status,
    progress: progressAfterStatus(group.status, 0),
    startDate: "",
    dueDate: "",
    doneDate: "",
    days: 0,
    deliverable: "",
    change: "",
    onTime: "",
    note: "",
    headcount: 0,
    priority: "中",
    files: [],
  };
}

type ProjectDetailProps = {
  me: MeResponse;
  project: Project | null;
  /** 任务编辑里改「项目经理」时回写项目（项目经理是项目级字段）。 */
  onChangeManager?: (projectId: string, managerId: string) => void;
  /** 任务字段被编辑（按口径刷新项目时间 updatedAt）。 */
  onTaskEdited?: (projectId: string) => void;
};

export default function ProjectDetail({ me, project, onChangeManager, onTaskEdited }: ProjectDetailProps) {
  /** 顶部视图（Push 82 / 121）：阶段标签收进「项目总览」，另两块是看板视图，最后一块是「日报及问题」。 */
  const [activeView, setActiveView] = useState<string>(VIEW_TABS[0]);
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});
  /** 任务编辑保存的字段（负责人 / 日期 / 施工人数 / 紧急重要度 / 进展描述；原型阶段存浏览器内存）。 */
  const [taskEdits, setTaskEdits] = useState<Record<string, Partial<ProjectTask>>>({});
  /**
   * 看板拖出来的任务顺序（Push 105）：存任务 id 顺序，空数组 = 用默认顺序。
   * 原型阶段存浏览器内存（与任务覆盖表同一层），换项目 / 刷新即重置 —— 正式版由后端落库（见 `前端功能需求.md` §3.8 A19）。
   */
  const [taskOrder, setTaskOrder] = useState<string[]>([]);

  /** 原型阶段只有印度项目（`inmu-0010`）带示例任务数据；其余项目为空列表（正式版按项目取数）。 */
  const baseTasks = tasksForProject(project?.id ?? "");
  /** 从任务模板加进来的任务（原型阶段存浏览器内存；换项目 / 刷新即重置 —— 正式版由后端落库）。 */
  const [addedTasks, setAddedTasks] = useState<ProjectTask[]>([]);
  useEffect(() => {
    setAddedTasks([]);
    setProgressOverrides({});
    setTaskEdits({});
    setTaskOrder([]);
  }, [project?.id]);
  const projectTasks = [...baseTasks, ...addedTasks];

  /**
   * 看板顺序（Push 105）：排过的按 `taskOrder` 走，没排过的（新加的任务等）接在后面、保持原有先后（稳定排序）。
   * 全套任务共用这一套顺序，两块看板的「列」只是它的子序列 —— 所以列内插入位 = 在这套顺序里插到目标位置。
   */
  const orderedTasks =
    taskOrder.length === 0
      ? projectTasks
      : projectTasks
          .map((task, index) => {
            const at = taskOrder.indexOf(task.id);
            return { task, key: at < 0 ? taskOrder.length + index : at };
          })
          .sort((left, right) => left.key - right.key)
          .map((entry) => entry.task);

  /**
   * 展示顺序（Push 111，业务口径「应该按照项目总览的顺序排 —— 某个工作人员在项目总览下从上到下的任务顺序」）：
   * **阶段为主键**（项目总览的分组顺序）、**组内按看板顺序表**（拖动 / 插入位置定的先后）。
   * 三块视图拿到的都是这一份顺序 —— 人员任务分配看板的列内顺序因此与项目总览自上而下一致；
   * 项目总览本来就是按阶段分组渲染的，组内顺序不受影响。
   */
  const stagedTasks = orderedTasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => stageRankOf(left.task.stage) - stageRankOf(right.task.stage) || left.index - right.index)
    .map((entry) => entry.task);

  const tasks = stagedTasks.map((task) => {
    const edit = taskEdits[task.id];
    const override = progressOverrides[task.id];
    const withEdit = edit === undefined ? task : { ...task, ...edit };
    return override === undefined ? withEdit : { ...withEdit, progress: override };
  });

  /**
   * 点四格进度条：进度 + 联动状态一起写（0 格 = 待开始、1~3 格 = 进行中、4 格 = 交回完成态派生，Push 65；
   * Push 67 修正：已过预计完成日期的任务点进度条保持「已延期」，不会被改成「待开始 / 进行中」）。
   */
  const handleSetProgress = (taskId: string, progress: number) => {
    const current = tasks.find((task) => task.id === taskId);
    const nextStatus = statusOverrideAfterProgress(progress, current !== undefined && isPastDue(current));
    setProgressOverrides((previous) => ({ ...previous, [taskId]: progress }));
    setTaskEdits((previous) => ({
      ...previous,
      [taskId]: {
        ...previous[taskId],
        statusOverride: nextStatus,
        // 进度退回非完成态时，实际完成日期一并清空（Push 67 业务定案）
        ...(nextStatus === undefined || isCompleteStatus(nextStatus) ? {} : { doneDate: "" }),
      },
    }));
  };

  /**
   * 看板拖动排序（Push 105）：把这张任务插到 `beforeTaskId` 前面；落在列尾时插到 `afterTaskId` 后面（两个都 null = 不动顺序）。
   * 只动顺序、不动任务字段；顺序表里还没有的任务（新加的 / 从模板加进来的）接到后面，保证顺序表覆盖全部任务。
   */
  const handleReorderTask = (taskId: string, beforeTaskId: string | null, afterTaskId: string | null) => {
    if (project === null || (beforeTaskId === null && afterTaskId === null)) {
      return;
    }
    const known = taskOrder.length === 0 ? projectTasks.map((task) => task.id) : taskOrder;
    const ids = known.filter((id) => id !== taskId);
    const afterIndex = afterTaskId === null ? -1 : ids.indexOf(afterTaskId);
    const at = beforeTaskId === null ? (afterIndex < 0 ? ids.length : afterIndex + 1) : ids.indexOf(beforeTaskId);
    const next = at < 0 ? [...ids, taskId] : [...ids.slice(0, at), taskId, ...ids.slice(at)];
    for (const task of projectTasks) {
      if (!next.includes(task.id)) {
        next.push(task.id);
      }
    }
    setTaskOrder(next);
    onTaskEdited?.(project.id);
  };

  /** 任务编辑保存：项目经理变化回写项目（项目级），其余字段进任务覆盖表；同时刷新项目时间。 */
  const handleSubmitTaskEdit = (values: TaskEditSubmit) => {
    if (project === null) {
      return;
    }
    if (values.managerId !== "" && values.managerId !== project.managerId) {
      onChangeManager?.(project.id, values.managerId);
    }
    setTaskEdits((previous) => ({
      ...previous,
      [values.taskId]: {
        owner: values.owner,
        ownerEn: values.ownerEn,
        startDate: values.startDate,
        dueDate: values.dueDate,
        days: values.days,
        headcount: values.headcount,
        priority: values.priority,
        note: values.note,
      },
    }));
    onTaskEdited?.(project.id);
  };

  /** 表格行内编辑：只覆盖被改的字段（与弹窗共用同一张覆盖表），并刷新项目时间。 */
  const handlePatchTask = (taskId: string, patch: TaskPatch) => {
    if (project === null) {
      return;
    }
    // 行内改状态会同时带进度（四格联动）：进度仍走进度覆盖表，避免被旧值盖回去
    if (patch.progress !== undefined) {
      const nextProgress = patch.progress;
      setProgressOverrides((previous) => ({ ...previous, [taskId]: nextProgress }));
    }
    setTaskEdits((previous) => ({ ...previous, [taskId]: { ...previous[taskId], ...patch } }));
    onTaskEdited?.(project.id);
  };

  /** 表格行内改「项目经理」：项目级字段，回写项目卡片。 */
  const handleBoardManagerChange = (nextManagerId: string) => {
    if (project === null || nextManagerId === project.managerId) {
      return;
    }
    onChangeManager?.(project.id, nextManagerId);
  };

  /** 从「任务模板」预设加一个节点到项目：模板里已加过的节点按 id 判重，不重复加。 */
  const handleAddNode = (stage: string, node: TemplatePresetNode) => {
    setAddedTasks((previous) =>
      previous.some((task) => task.id === node.id) || baseTasks.some((task) => task.id === node.id)
        ? previous
        : [...previous, taskFromPresetNode(stage, node)],
    );
  };

  /** 看板「添加 → 临时任务」：标题由用户自己填，挂到该列（负责人 / 状态按列给，阶段留空）；与其它任务编辑一样刷新项目时间。 */
  const handleQuickAdd = (context: KanbanAddContext, values: { title: string; titleEn: string }) => {
    setAddedTasks((previous) => [...previous, quickTask(context, values.title, values.titleEn)]);
    if (project !== null) {
      onTaskEdited?.(project.id);
    }
  };

  /**
   * 把新加的任务插进看板顺序表（Push 111，业务口径「人员要指定位置放入」）：
   * `last`（默认）不动顺序表 —— 顺序表里没有的新任务本来就排最后，按「阶段为主键」的展示顺序落在**该阶段段的末尾**；
   * `before` / `after` 以某张同阶段任务为锚插进去；一次加多个时按传入顺序**整段**插在锚点位置，不会倒序。
   * 只动顺序表，卡片上的负责人 / 状态等字段不受影响。
   */
  const insertNewTasksIntoOrder = (taskIds: readonly string[], placement: StagePlacement) => {
    if (placement.kind === "last" || taskIds.length === 0) {
      return;
    }
    setTaskOrder((previous) => {
      const known = previous.length === 0 ? projectTasks.map((task) => task.id) : previous;
      const rest = known.filter((id) => !taskIds.includes(id));
      const anchorIndex = rest.indexOf(placement.taskId);
      const at = anchorIndex < 0 ? rest.length : placement.kind === "before" ? anchorIndex : anchorIndex + 1;
      const next = [...rest.slice(0, at), ...taskIds, ...rest.slice(at)];
      for (const task of projectTasks) {
        if (!next.includes(task.id)) {
          next.push(task.id);
        }
      }
      return next;
    });
  };

  /**
   * 项目总览卡片的「＋ 添加 / 整套添加」（Push 113，业务口径「我要点击这个添加后选择位置」）：
   * 点添加先弹位置浮层、选完再按这个位置插进看板顺序表 —— 与看板那条路径同一套口径（`insertNewTasksIntoOrder`），
   * 区别只是任务用预设节点自带的负责人 / 状态（没有看板列的上下文）。
   */
  const handleAddNodes = (stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => {
    const knownIds = new Set<string>([...baseTasks.map((task) => task.id), ...addedTasks.map((task) => task.id)]);
    const fresh = nodes.filter((node) => !knownIds.has(node.id));
    if (fresh.length === 0) {
      return;
    }
    setAddedTasks((previous) => [...previous, ...fresh.map((node) => taskFromPresetNode(stage, node))]);
    insertNewTasksIntoOrder(fresh.map((node) => node.id), placement);
    if (project !== null) {
      onTaskEdited?.(project.id);
    }
  };

  /**
   * 看板「添加 → 阶段任务」：从该阶段的节点池 / 模板里挑的节点加进项目（按节点 id 判重）。
   * 任务自带阶段，并带上所在列的负责人 / 状态（与「临时任务」同一套列上下文）。
   * Push 111：`nodes` 可以一次多个（「整套添加」），`placement` = 该阶段内的插入位置。
   */
  const handleKanbanAddNode = (context: KanbanAddContext, stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => {
    const knownIds = new Set<string>([...baseTasks.map((task) => task.id), ...addedTasks.map((task) => task.id)]);
    const fresh = nodes.filter((node) => !knownIds.has(node.id));
    if (fresh.length === 0) {
      return;
    }
    setAddedTasks((previous) => [
      ...previous,
      ...fresh.map((node) => ({
        ...taskFromPresetNode(stage, node),
        owner: context.owner,
        ownerEn: context.ownerEn,
        status: context.status,
        statusOverride: context.status,
        progress: progressAfterStatus(context.status, 0),
      })),
    ]);
    insertNewTasksIntoOrder(fresh.map((node) => node.id), placement);
    if (project !== null) {
      onTaskEdited?.(project.id);
    }
  };

  /** 项目经理：项目级字段，取项目卡片上的经理（`managerId` → 姓名），任务表「项目经理」列与任务详情都用它。 */
  const manager = project === null ? "" : managerName(project.managerId);

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [tableOverflow, setTableOverflow] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>(() => ({ ...DEFAULT_VISIBLE_COLUMNS }));
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});
  /**
   * 阶段骨架常显（Push 61 调整）：没有任务的阶段也保留分组头（只有阶段名、组内没有任务行），
   * 所以点「添加任务」加出任务后，其余阶段的分组头不会消失。
   */
  const visibleStageNames = STAGE_NAMES;
  const allCollapsed = visibleStageNames.length > 0 && visibleStageNames.every((stage) => collapsedStages[stage] === true);
  const toggleAllStages = () => {
    if (allCollapsed) {
      setCollapsedStages({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const stage of visibleStageNames) {
      next[stage] = true;
    }
    setCollapsedStages(next);
  };
  const toggleStage = (stage: string) => {
    setCollapsedStages((previous) => ({ ...previous, [stage]: previous[stage] !== true }));
  };

  const handleToggleColumn = (key: ColumnKey, checked: boolean) => {
    setVisibleColumns((previous) => ({ ...previous, [key]: checked }));
  };

  const resetColumns = () => {
    setVisibleColumns({ ...DEFAULT_VISIBLE_COLUMNS });
  };

  if (project === null) {
    return (
      <div className="min-h-screen">
        <AppHeader me={me} />
        <main className="w-full px-6 py-10">
          <p className="text-sm text-zinc-500">未找到该项目，可能已被删除。</p>
          <a href="#/projects" className="mt-4 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4">
            返回项目列表
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader me={me} project={project} />
      <main className="w-full px-6 pb-10 pt-3">
        <div className="flex items-center gap-3 border-b border-zinc-200">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {VIEW_TABS.map((view) => {
              const active = view === activeView;
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => setActiveView(view)}
                  className={
                    "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition " +
                    (active
                      ? "border-zinc-900 text-zinc-900"
                      : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                  }
                >
                  {view}
                </button>
              );
            })}
          </div>
          {activeView === "项目总览" ? (
            <ColumnPicker visible={visibleColumns} onToggle={handleToggleColumn} onReset={resetColumns} />
          ) : null}
        </div>

        <div className="mt-6 space-y-4">
          {activeView === "项目总览" ? (
            <>
              <ProjectSummary tasks={tasks} />
              <TaskBoard tasks={tasks} skeletonStages={STAGE_NAMES} onSetProgress={handleSetProgress} visibleColumns={visibleColumns} scrollRef={tableScrollRef} collapsed={collapsedStages} onToggleStage={toggleStage} onToggleAllStages={toggleAllStages} onAddNode={handleAddNode} onAddNodes={handleAddNodes} viewStage="项目总览" manager={manager} managerId={project.managerId} onSubmitTaskEdit={handleSubmitTaskEdit} onPatchTask={handlePatchTask} onChangeManager={handleBoardManagerChange} />
            </>
          ) : activeView === "日报及问题" ? (
            // key = 项目 id：换项目时把日报 / 问题与填写草稿一起复位（原型内存态，见 ReportIssuePanel.tsx）
            <ReportIssuePanel key={project.id} project={project} me={me} tasks={tasks} />
          ) : (
            <TaskKanban
              mode={activeView === "人员任务分配" ? "owner" : "status"}
              tasks={tasks}
              manager={manager}
              managerId={project.managerId}
              onAddTask={handleQuickAdd}
              onAddStageTask={handleKanbanAddNode}
              onSubmitTaskEdit={handleSubmitTaskEdit}
              onPatchTask={handlePatchTask}
              onReorderTask={handleReorderTask}
              onSetProgress={handleSetProgress}
            />
          )}
        </div>

        {activeView === "项目总览" ? (
        <div
          id="table-scrollbar-bar"
          className={
            "sticky bottom-0 z-10 flex items-center " +
            (tableOverflow ? "mt-4 border-t border-zinc-200 bg-white/95 py-2.5 backdrop-blur" : "h-0 overflow-hidden")
          }
        >
          <TableScrollbar scrollRef={tableScrollRef} onOverflowChange={setTableOverflow} />
        </div>
        ) : null}
      </main>
    </div>
  );
}
