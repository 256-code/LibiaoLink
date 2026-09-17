import { useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ColumnPicker } from "./components/ColumnPicker";
import { TableScrollbar } from "./components/TableScrollbar";
import { DEFAULT_VISIBLE_COLUMNS, ProjectSummary, TaskBoard, type ColumnKey, type VisibleColumns } from "./components/TaskBoard";
import { PROJECT_STAGES } from "./data/projects";
import { PROJECT_TASKS } from "./data/tasks";
import type { MeResponse, Project } from "./types";

type ProjectDetailProps = {
  me: MeResponse;
  project: Project | null;
};

export default function ProjectDetail({ me, project }: ProjectDetailProps) {
  const [activeStage, setActiveStage] = useState<string>(PROJECT_STAGES[0] ?? "项目总览");
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});

  const tasks = PROJECT_TASKS.map((task) => {
    const override = progressOverrides[task.id];
    return override === undefined ? task : { ...task, progress: override };
  });

  const handleSetProgress = (taskId: string, progress: number) => {
    setProgressOverrides((previous) => ({ ...previous, [taskId]: progress }));
  };

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [tableOverflow, setTableOverflow] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>(() => ({ ...DEFAULT_VISIBLE_COLUMNS }));

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
          <a href="#/" className="mt-4 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4">
            返回项目列表
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader me={me} project={project} />
      <main className="w-full px-6 pb-10 pt-6">
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
              <TaskBoard tasks={tasks} onSetProgress={handleSetProgress} visibleColumns={visibleColumns} scrollRef={tableScrollRef} />
            </>
          ) : (
            <TaskBoard tasks={tasks.filter((task) => task.stage === activeStage)} onSetProgress={handleSetProgress} visibleColumns={visibleColumns} scrollRef={tableScrollRef} />
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
