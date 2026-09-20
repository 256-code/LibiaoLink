import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ColumnPicker } from "./components/ColumnPicker";
import { TableScrollbar } from "./components/TableScrollbar";
import { DEFAULT_VISIBLE_COLUMNS, ProjectSummary, TaskBoard, type ColumnKey, type TaskPatch, type VisibleColumns } from "./components/TaskBoard";
import type { TaskEditSubmit } from "./components/TaskEditModal";
import { TaskKanban, type KanbanAddContext } from "./components/TaskKanban";
import { PROJECT_STAGES } from "./data/projects";
import { isCompleteStatus, isPastDue, progressAfterStatus, statusOverrideAfterProgress, tasksForProject, type ProjectTask, type TaskStatus } from "./data/tasks";
import type { TemplatePresetNode } from "./data/templatePresets";
import { managerName } from "./data/managers";
import type { MeResponse, Project } from "./types";

/** 阶段名（不含「项目总览」汇总视图）。 */
const STAGE_NAMES: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/** 顶部视图标签（Push 82 定稿）：阶段标签不再各占一格，改成「项目总览 + 两块看板」。 */
const VIEW_TABS: readonly string[] = ["项目总览", "人员任务分配", "任务进展"];

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
  /** 顶部视图（Push 82）：阶段标签收进「项目总览」，另两块是看板视图。 */
  const [activeView, setActiveView] = useState<string>(VIEW_TABS[0]);
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});
  /** 任务编辑保存的字段（负责人 / 日期 / 施工人数 / 紧急重要度 / 进展描述；原型阶段存浏览器内存）。 */
  const [taskEdits, setTaskEdits] = useState<Record<string, Partial<ProjectTask>>>({});

  /** 原型阶段只有印度项目（`inmu-0010`）带示例任务数据；其余项目为空列表（正式版按项目取数）。 */
  const baseTasks = tasksForProject(project?.id ?? "");
  /** 从任务模板加进来的任务（原型阶段存浏览器内存；换项目 / 刷新即重置 —— 正式版由后端落库）。 */
  const [addedTasks, setAddedTasks] = useState<ProjectTask[]>([]);
  useEffect(() => {
    setAddedTasks([]);
    setProgressOverrides({});
    setTaskEdits({});
  }, [project?.id]);
  const projectTasks = [...baseTasks, ...addedTasks];

  const tasks = projectTasks.map((task) => {
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
   * 看板「添加 → 阶段任务」：从该阶段的节点池 / 模板里选的节点加进项目（按节点 id 判重）。
   * 任务自带阶段，并带上所在列的负责人 / 状态（与「临时任务」同一套列上下文）。
   */
  const handleKanbanAddNode = (context: KanbanAddContext, stage: string, node: TemplatePresetNode) => {
    setAddedTasks((previous) =>
      previous.some((task) => task.id === node.id) || baseTasks.some((task) => task.id === node.id)
        ? previous
        : [
            ...previous,
            {
              ...taskFromPresetNode(stage, node),
              owner: context.owner,
              ownerEn: context.ownerEn,
              status: context.status,
              statusOverride: context.status,
              progress: progressAfterStatus(context.status, 0),
            },
          ],
    );
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
              <TaskBoard tasks={tasks} skeletonStages={STAGE_NAMES} onSetProgress={handleSetProgress} visibleColumns={visibleColumns} scrollRef={tableScrollRef} collapsed={collapsedStages} onToggleStage={toggleStage} onToggleAllStages={toggleAllStages} onAddNode={handleAddNode} viewStage="项目总览" manager={manager} managerId={project.managerId} onSubmitTaskEdit={handleSubmitTaskEdit} onPatchTask={handlePatchTask} onChangeManager={handleBoardManagerChange} />
            </>
          ) : (
            <TaskKanban
              mode={activeView === "人员任务分配" ? "owner" : "status"}
              tasks={tasks}
              manager={manager}
              managerId={project.managerId}
              onAddTask={handleQuickAdd}
              onAddStageTask={handleKanbanAddNode}
              onSubmitTaskEdit={handleSubmitTaskEdit}
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
