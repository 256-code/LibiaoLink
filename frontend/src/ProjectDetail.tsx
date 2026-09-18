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
  onEdit: (project: Project) => void;
};

export default function ProjectDetail({ me, project, onEdit }: ProjectDetailProps) {
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
          <button
            type="button"
            onClick={() => {
              onEdit(project);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            编辑项目
          </button>
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
