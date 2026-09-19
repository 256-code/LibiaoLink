import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PROJECT_MANAGER, isTaskDone, isTaskOverdue, lateDeliveryLabel, taskStatus, type ProjectTask, type TaskPriority, type TaskStatus } from "../data/tasks";
import { ScrollArea } from "./ScrollArea";
import { TRACKER_STEPS, trackerLabel, trackerStep } from "./Tracker";

const CLOSE_ANIMATION_MS = 170;

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

const STATUS_CHIP_CLASS: Record<TaskStatus, string> = {
  已完成: "bg-emerald-50 text-emerald-700",
  提前完成: "bg-emerald-50 text-emerald-700",
  进行中: "bg-blue-50 text-blue-700",
  已延期: "bg-red-50 text-red-600",
  待开始: "bg-zinc-100 text-zinc-500",
};

type TaskDrawerProps = {
  /** 项目经理（项目级字段：取项目卡片上的经理；不传时回落常量占位）。 */
  manager?: string;
  task: ProjectTask | null;
  /** 「编辑任务」入口（打开任务编辑弹窗）；不传时不显示按钮。 */
  onEdit?: (task: ProjectTask) => void;
  onClose: () => void;
};

export function TaskDrawer({ task, manager, onEdit, onClose }: TaskDrawerProps) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const taskId = task === null ? null : task.id;

  useEffect(() => {
    closingRef.current = false;
    setClosing(false);
  }, [taskId]);

  useEffect(() => {
    if (taskId === null) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [taskId]);

  const requestClose = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    if (taskId === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [taskId, requestClose]);

  if (task === null) {
    return null;
  }

  const done = isTaskDone(task);
  const overdue = isTaskOverdue(task);
  /** 「是否按时交付」列的逾期标注（Push 67：逾期不再标在实际完成日期字段）。 */
  const late = lateDeliveryLabel(task);
  const status = taskStatus(task);
  const step = trackerStep(task.progress);
  const stepPct = Math.round((step / TRACKER_STEPS) * 100);
  const progressText = trackerLabel(task.progress);
  const fullOwner = task.ownerEn === "" ? task.owner : task.owner + "(" + task.ownerEn + ")";
  const barClass = done ? "bg-emerald-500" : task.status === "进行中" ? "bg-blue-500" : "bg-zinc-200";
  const dotClass = STATUS_DOT_CLASS[status];
  const statusChipClass = STATUS_CHIP_CLASS[status];
  const dash = <span className="text-zinc-300">—</span>;

  const fields: Array<{ label: string; value: ReactNode }> = [
    {
      label: "项目经理",
      value: <span className="font-medium text-zinc-800">{manager ?? PROJECT_MANAGER}</span>,
    },
    { label: "任务负责人", value: task.owner === "" ? <span className="text-zinc-400">待分配</span> : fullOwner },
    {
      label: "任务状态",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + dotClass} />
          {status}
        </span>
      ),
    },
    {
      label: "紧急重要度",
      value: <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + PRIORITY_CLASS[task.priority]}>{task.priority}</span>,
    },
    {
      label: "是否按时交付",
      value:
        late === "逾期未交付" ? (
          <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">逾期未交付</span>
        ) : late === "逾期已交付" ? (
          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">逾期已交付</span>
        ) : task.onTime === "" ? (
          dash
        ) : (
          <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">{task.onTime}</span>
        ),
    },
    { label: "输出成果文件", value: task.deliverable === "" ? dash : task.deliverable },
    {
      label: "文件",
      value:
        task.files.length === 0 ? (
          dash
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {task.files.map((file) => (
              <span key={file} className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
                {file}
              </span>
            ))}
          </span>
        ),
    },
    { label: "项目进展描述", value: task.note === "" ? dash : task.note },
    { label: "开始日期", value: task.startDate === "" ? dash : task.startDate },
    { label: "预计完成日期", value: task.dueDate === "" ? dash : task.dueDate },
    { label: "预计所需天数", value: task.days > 0 ? task.days + " 天" : dash },
    { label: "预计所需施工人数", value: task.headcount > 0 ? task.headcount + " 人" : dash },
    {
      label: "实际完成日期",
      value:
        task.doneDate !== "" ? task.doneDate : dash,
    },
    {
      label: "变更关联",
      value:
        task.change === "" ? (
          dash
        ) : (
          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
            变更 {task.change}
          </span>
        ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={"drawer-backdrop absolute inset-0 bg-zinc-900/25" + (closing ? " is-closing" : "")}
        onClick={requestClose}
        aria-hidden="true"
      />
      <aside
        key={task.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
        className={
          "drawer-panel absolute right-0 top-0 flex h-full w-[460px] max-w-[94vw] flex-col bg-white shadow-[-24px_0_60px_rgba(15,23,42,0.18)]" +
          (closing ? " is-closing" : "")
        }
      >
        <header className="border-b border-zinc-100 px-6 pb-5 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500">{task.stage}</span>
              <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-medium " + statusChipClass}>{status}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onEdit === undefined ? null : (
                <button
                  type="button"
                  onClick={() => {
                    onEdit(task);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                  编辑任务
                </button>
              )}
              <button
                type="button"
                onClick={requestClose}
                aria-label="关闭任务详情"
                className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          <h2 id="task-drawer-title" className="mt-3.5 text-lg font-semibold leading-7 text-zinc-900">
            {task.title}
          </h2>
          {task.titleEn === "" ? null : <p className="mt-1 text-xs leading-5 text-zinc-400">{task.titleEn}</p>}
        </header>

        <div className="border-b border-zinc-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">项目进度</span>
            <span className="text-sm font-semibold text-zinc-900">{progressText}</span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
            <div className={"h-full rounded-full " + barClass} style={{ width: stepPct + "%" }} />
          </div>
          {overdue ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">
              已超过预计完成日期（{task.dueDate}），当前仍未完成。
            </p>
          ) : null}
        </div>

        <ScrollArea viewportClassName="min-h-0 flex-1" className="px-6 py-1">
          <dl>
            {fields.map((field) => (
              <div
                key={field.label}
                className="grid grid-cols-[96px_1fr] items-start gap-x-4 border-b border-zinc-50 py-3 last:border-b-0"
              >
                <dt className="pt-px text-xs leading-5 text-zinc-400">{field.label}</dt>
                <dd className="text-sm leading-5 text-zinc-800">{field.value}</dd>
              </div>
            ))}
          </dl>
        </ScrollArea>

        <footer className="border-t border-zinc-100 px-6 py-3">
          <p className="text-[11px] text-zinc-400">点击空白处或按 Esc 关闭</p>
        </footer>
      </aside>
    </div>
  );
}
