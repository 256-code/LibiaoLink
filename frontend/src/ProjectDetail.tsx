import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ColumnPicker } from "./components/ColumnPicker";
import { TableScrollbar } from "./components/TableScrollbar";
import { DEFAULT_VISIBLE_COLUMNS, ProjectSummary, TaskBoard, type ColumnKey, type VisibleColumns } from "./components/TaskBoard";
import { PROJECT_STAGES } from "./data/projects";
import { tasksForProject, type ProjectTask } from "./data/tasks";
import type { TemplatePresetNode } from "./data/templatePresets";
import { managerName } from "./data/managers";
import type { MeResponse, Project } from "./types";

/** 阶段名（不含「项目总览」汇总视图）。 */
const STAGE_NAMES: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

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

type ProjectDetailProps = {
  me: MeResponse;
  project: Project | null;
};

export default function ProjectDetail({ me, project }: ProjectDetailProps) {
  const [activeStage, setActiveStage] = useState<string>(PROJECT_STAGES[0] ?? "项目总览");
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});

  /** 原型阶段只有印度项目（`inmu-0010`）带示例任务数据；其余项目为空列表（正式版按项目取数）。 */
  const baseTasks = tasksForProject(project?.id ?? "");
  /** 从任务模板加进来的任务（原型阶段存浏览器内存；换项目 / 刷新即重置 —— 正式版由后端落库）。 */
  const [addedTasks, setAddedTasks] = useState<ProjectTask[]>([]);
  useEffect(() => {
    setAddedTasks([]);
  }, [project?.id]);
  const projectTasks = [...baseTasks, ...addedTasks];

  const tasks = projectTasks.map((task) => {
    const override = progressOverrides[task.id];
    return override === undefined ? task : { ...task, progress: override };
  });

  const handleSetProgress = (taskId: string, progress: number) => {
    setProgressOverrides((previous) => ({ ...previous, [taskId]: progress }));
  };

  /** 从「任务模板」预设加一个节点到项目：模板里已加过的节点按 id 判重，不重复加。 */
  const handleAddNode = (stage: string, node: TemplatePresetNode) => {
    setAddedTasks((previous) =>
      previous.some((task) => task.id === node.id) || baseTasks.some((task) => task.id === node.id)
        ? previous
        : [...previous, taskFromPresetNode(stage, node)],
    );
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
  const visibleStageNames = activeStage === "项目总览" ? STAGE_NAMES : [activeStage];
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
            {PROJECT_STAGES.map((stage) => {
              const active = stage === activeStage;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setActiveStage(stage)}
                  className={
                    "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition " +
                    (active
                      ? "border-zinc-900 text-zinc-900"
                      : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                  }
                >
                  {stage}
                </button>
              );
            })}
          </div>
          <ColumnPicker visible={visibleColumns} onToggle={handleToggleColumn} onReset={resetColumns} />
        </div>

        <div className="mt-6 space-y-4">
          {activeStage === "项目总览" ? (
            <>
              <ProjectSummary tasks={tasks} />
              <TaskBoard tasks={tasks} skeletonStages={STAGE_NAMES} onSetProgress={handleSetProgress} visibleColumns={visibleColumns} scrollRef={tableScrollRef} collapsed={collapsedStages} onToggleStage={toggleStage} onToggleAllStages={toggleAllStages} onAddNode={handleAddNode} viewStage={activeStage} manager={manager} />
            </>
          ) : (
            <TaskBoard tasks={tasks.filter((task) => task.stage === activeStage)} skeletonStages={[activeStage]} onSetProgress={handleSetProgress} visibleColumns={visibleColumns} scrollRef={tableScrollRef} collapsed={collapsedStages} onToggleStage={toggleStage} onToggleAllStages={toggleAllStages} onAddNode={handleAddNode} viewStage={activeStage} manager={manager} />
          )}
        </div>

        <div
          id="table-scrollbar-bar"
          className={
            "sticky bottom-0 z-10 flex items-center " +
            (tableOverflow ? "mt-4 border-t border-zinc-200 bg-white/95 py-2.5 backdrop-blur" : "h-0 overflow-hidden")
          }
        >
          <TableScrollbar scrollRef={tableScrollRef} onOverflowChange={setTableOverflow} />
        </div>
      </main>
    </div>
  );
}
