
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MEMBER_DIRECTORY, PROJECT_MANAGERS, memberById, memberByName } from "../data/members";
import {
  PROJECT_MANAGER,
  cnDateFromIso,
  daysBetweenInclusive,
  isCompleteStatus,
  isTaskOverdue,
  isoFromCnDate,
  lateDeliveryLabel,
  progressAfterStatus,
  taskStatus,
  type ProjectTask,
  type TaskPriority,
  type TaskStatus,
} from "../data/tasks";
import { DateRangePicker, type DateRange } from "./DateRangePicker";
import { InlineDateCell } from "./InlineEdit";
import { MemberSelect } from "./MemberSelect";
import { ScrollArea } from "./ScrollArea";
import { SelectMenu, type SelectOption } from "./SelectMenu";
import type { TaskPatch } from "./TaskBoard";
import { TRACKER_LABELS, TRACKER_STEPS, TrackerBar, trackerLabel, trackerStep } from "./Tracker";

const CLOSE_ANIMATION_MS = 170;
/** 「已保存」提示的停留时间。 */
const SAVED_FLASH_MS = 1600;

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

/** 任务状态下拉（与任务表行内同一份五个状态、同一套色签）。 */
const STATUS_OPTIONS: SelectOption[] = (["已延期", "进行中", "已完成", "待开始", "提前完成"] as TaskStatus[]).map((status) => ({
  value: status,
  label: (
    <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_CHIP_CLASS[status]}>{status}</span>
  ),
}));

const PRIORITY_OPTIONS = [
  { value: "高", label: "高" },
  { value: "中", label: "中" },
  { value: "低", label: "低" },
];

/** 抽屉里可编辑控件的统一外观（与任务编辑表单同一套）。 */
const FIELD_CLASS =
  "block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10";

const CAPTION_CLASS = "mt-1 block text-[11px] leading-4 text-zinc-400";

/** 任务编辑保存值：可编辑字段 = 项目经理（项目级）/ 负责人 / 开始与预计完成日期（含联动天数）/ 施工人数 / 紧急重要度 / 进展描述。 */
export type TaskEditSubmit = {
  taskId: string;
  managerId: string;
  owner: string;
  ownerEn: string;
  startDate: string;
  dueDate: string;
  days: number;
  headcount: number;
  priority: TaskPriority;
  note: string;
};

/** 抽屉里的表单草稿（「所见即所存」：抽屉打开期间不随父级刷新重置）。 */
type Draft = {
  managerId: string;
  ownerId: string;
  range: DateRange | null;
  headcount: string;
  priority: TaskPriority;
  note: string;
};

function rangeOf(task: ProjectTask): DateRange | null {
  const from = isoFromCnDate(task.startDate);
  const to = isoFromCnDate(task.dueDate);
  return from === "" || to === "" ? null : { from, to };
}

function draftOf(task: ProjectTask | null, managerId: string): Draft {
  return {
    managerId,
    ownerId: task === null ? "" : memberByName(task.owner)?.id ?? "",
    range: task === null ? null : rangeOf(task),
    headcount: task !== null && task.headcount > 0 ? String(task.headcount) : "",
    priority: task === null ? "中" : task.priority,
    note: task === null ? "" : task.note,
  };
}

type TaskDrawerProps = {
  /** 项目经理（项目级字段：取项目卡片上的经理；不传时回落常量占位）。 */
  manager?: string;
  /** 当前项目经理 id（项目级字段，人员下拉的选中项）。 */
  managerId?: string;
  task: ProjectTask | null;
  /** 抽屉内直接改字段后的即时保存；不传 = 抽屉只读（不渲染可编辑控件）。 */
  onSubmit?: (values: TaskEditSubmit) => void;
  /** 点四格进度条（Push 98；联动口径同任务表 §6.4：0 格 = 待开始、1~3 格 = 进行中、4 格 = 交回完成态派生）。 */
  onProgress?: (taskId: string, progress: number) => void;
  /** 抽屉内直接改任务状态 / 实际完成日期（口径同任务表行内与看板卡片，§6.9）；不传 = 这两项也只读。 */
  onPatch?: (taskId: string, patch: TaskPatch) => void;
  onClose: () => void;
};

/**
 * 任务详情抽屉（Push 63）：点任务行 / 看板卡片打开。
 * **要改直接在抽屉里改**（Push 88 业务口径：「编辑任务」弹窗不再需要）—— 项目经理 / 任务负责人 / 紧急重要度选完即存，
 * 日期区间选完即存，施工人数 / 进展描述失焦时存（值没变不写，避免无谓刷新项目时间）；保存后右下角闪一下「已保存」。
 * 进度自 Push 98 起也能在抽屉里改：进度条长度不变，**四颗点平均分布在条上**（刚开工 / 完成一半 / 快完成了 / 已完成），点哪颗写哪档；
 * 任务状态与实际完成日期自 Push 101 起也能在抽屉里直接改（口径与任务表行内 / 看板卡片完全一致，§6.9：
 * 状态 ↔ 四格进度双向联动、改成非完成态会清空实际完成日期；填实际完成日期 = 完成、清空 = 退回进行中）；
 * 仍只读：是否按时交付（读时派生）、输出成果文件（A1-17 锁定）、文件（走文件库）、变更关联。
 */
export function TaskDrawer({ task, manager, managerId = "", onSubmit, onProgress, onPatch, onClose }: TaskDrawerProps) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const taskId = task === null ? null : task.id;
  const [draft, setDraft] = useState<Draft>(() => draftOf(task, managerId));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** 「已保存」提示（非 0 = 展示中）。 */
  const [savedTick, setSavedTick] = useState(0);
  /** 悬停 / 聚焦中的进度档位（0 = 没有）：悬停时档位文字与进度条一起预览点完的样子。 */
  const [hoveredStep, setHoveredStep] = useState(0);

  useEffect(() => {
    closingRef.current = false;
    setClosing(false);
    setSavedTick(0);
    setHoveredStep(0);
    setDraft(draftOf(task, managerId));
    // 换任务时把草稿重置成新任务的字段；同一个任务上父级刷新不重置，避免打断正在输入的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (savedTick === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSavedTick(0);
    }, SAVED_FLASH_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [savedTick]);

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

  /** 改草稿：ref 与 state 一起写 —— 失焦可能与最后一次输入同一批处理，只写 state 会让失焦读到旧值。 */
  const updateDraft = useCallback((patch: Partial<Draft>) => {
    const next: Draft = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    return next;
  }, []);

  /** 即时保存：把草稿与改动合成一份完整保存值（字段口径同任务表行内编辑）。 */
  const commit = useCallback(
    (patch: Partial<Draft>) => {
      const current = task;
      if (current === null || onSubmit === undefined) {
        return;
      }
      const next = updateDraft(patch);
      const owner = next.ownerId === "" ? null : memberById(next.ownerId) ?? null;
      const headcountText = next.headcount.trim();
      const headcountValue = headcountText === "" ? 0 : Number(headcountText);
      onSubmit({
        taskId: current.id,
        managerId: next.managerId,
        owner: owner?.name ?? "",
        ownerEn: owner?.handle ?? "",
        startDate: next.range === null ? "" : cnDateFromIso(next.range.from),
        dueDate: next.range === null ? "" : cnDateFromIso(next.range.to),
        days: next.range === null ? 0 : daysBetweenInclusive(next.range.from, next.range.to),
        headcount: headcountText === "" || Number.isNaN(headcountValue) ? 0 : Math.floor(headcountValue),
        priority: next.priority,
        note: next.note.trim(),
      });
      setSavedTick(Date.now());
    },
    [onSubmit, task, updateDraft],
  );

  if (task === null) {
    return null;
  }

  const editable = onSubmit !== undefined;
  const canPatch = onPatch !== undefined;
  const overdue = isTaskOverdue(task);
  /** 「是否按时交付」列的逾期标注（Push 67：逾期不再标在实际完成日期字段）。 */
  const late = lateDeliveryLabel(task);
  const status = taskStatus(task);
  const step = trackerStep(task.progress);
  /** 悬停预览：还没点就先亮到悬停那一档（进度条长度不变，只有填充随预览走）。 */
  const shownStep = hoveredStep > 0 ? hoveredStep : step;
  const stepPct = Math.round((shownStep / TRACKER_STEPS) * 100);
  const progressText = hoveredStep > 0 ? TRACKER_LABELS[hoveredStep] ?? "" : trackerLabel(task.progress);
  const fullOwner = task.ownerEn === "" ? task.owner : task.owner + "(" + task.ownerEn + ")";
  /** 进度条与条上那四颗点一律用绿色（与任务表四格点 `bg-emerald-500` 同一个绿）—— 进度条只表达「做了多少」，
   *  状态色由状态签与色点单独表达；业务反馈：灰的看不懂，要和任务表一样绿。 */
  const barClass = "bg-emerald-500";
  /** 点亮的点 = 实心绿 + 白描边（压在绿条上也能看清）。 */
  const dotOnClass = "border-white bg-emerald-500";
  const dotClass = STATUS_DOT_CLASS[status];
  const statusChipClass = STATUS_CHIP_CLASS[status];
  const dash = <span className="text-zinc-300">—</span>;

  const draftDays = draft.range === null ? 0 : daysBetweenInclusive(draft.range.from, draft.range.to);
  const shownDays = editable ? draftDays : task.days;
  const headcountText = draft.headcount.trim();
  const headcountValue = headcountText === "" ? 0 : Number(headcountText);
  const headcountInvalid = headcountText !== "" && (Number.isNaN(headcountValue) || headcountValue < 0);

  /** 失焦才存的字段（施工人数 / 进展描述）：值没变就不写；人数不合法时不写（红字提示留着）。
   *  读 `draftRef` 而不是渲染期的 `draft` —— 失焦可能与最后一次输入同一批处理，渲染期的值会是旧的。 */
  const commitDraft = () => {
    if (onSubmit === undefined) {
      return;
    }
    const current = draftRef.current;
    const text = current.headcount.trim();
    const value = text === "" ? 0 : Number(text);
    if (text !== "" && (Number.isNaN(value) || value < 0)) {
      return;
    }
    const nextHeadcount = text === "" ? 0 : Math.floor(value);
    if (nextHeadcount === task.headcount && current.note.trim() === task.note) {
      return;
    }
    commit({});
  };

  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: "项目经理",
      value: editable ? (
        <>
          <MemberSelect
            value={draft.managerId}
            options={PROJECT_MANAGERS}
            onChange={(member) => {
              commit({ managerId: member.id });
            }}
            placeholder="选择项目经理"
            ariaLabel="选择项目经理"
          />
          <span className={CAPTION_CLASS}>项目级字段，改后全项目同步</span>
        </>
      ) : (
        <span className="font-medium text-zinc-800">{manager ?? PROJECT_MANAGER}</span>
      ),
    },
    {
      label: "任务负责人",
      value: editable ? (
        <>
          <MemberSelect
            value={draft.ownerId}
            options={MEMBER_DIRECTORY}
            onChange={(member) => {
              commit({ ownerId: member.id });
            }}
            placeholder="待分配"
            ariaLabel="选择任务负责人"
          />
          <span className={CAPTION_CLASS}>留空 = 待分配</span>
        </>
      ) : task.owner === "" ? (
        <span className="text-zinc-400">待分配</span>
      ) : (
        fullOwner
      ),
    },
    {
      label: "任务状态",
      value: canPatch ? (
        <>
          <SelectMenu
            value={status}
            options={STATUS_OPTIONS}
            onChange={(next) => {
              if (onPatch === undefined) {
                return;
              }
              const value = next as TaskStatus;
              // 与任务表行内同一套联动（§6.4 / §6.9）：完成态 = 四格全亮、进行中 = 至少一格、待开始 = 清零、已延期 = 保持格数；
              // 手动改成非完成态时，实际完成日期一并清空（Push 67 业务定案）
              onPatch(task.id, {
                statusOverride: value,
                progress: progressAfterStatus(value, task.progress),
                doneDate: isCompleteStatus(value) ? task.doneDate : "",
              });
              setSavedTick(Date.now());
            }}
            ariaLabel="选择任务状态"
          />
          <span className={CAPTION_CLASS}>选完成态 = 四格全亮；改成非完成态会清空实际完成日期</span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + dotClass} />
          {status}
        </span>
      ),
    },
    {
      label: "紧急重要度",
      value: editable ? (
        <SelectMenu
          value={draft.priority}
          options={PRIORITY_OPTIONS}
          onChange={(value) => {
            commit({ priority: value as TaskPriority });
          }}
          ariaLabel="选择紧急重要度"
        />
      ) : (
        <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + PRIORITY_CLASS[task.priority]}>
          {task.priority}
        </span>
      ),
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
    {
      label: "项目进展描述",
      value: editable ? (
        <textarea
          rows={3}
          value={draft.note}
          onChange={(event) => {
            updateDraft({ note: event.target.value });
          }}
          onBlur={commitDraft}
          placeholder="补充当前进展、风险或下一步"
          aria-label="项目进展描述"
          className={FIELD_CLASS + " resize-none leading-6"}
        />
      ) : task.note === "" ? (
        dash
      ) : (
        task.note
      ),
    },
    {
      label: "开始 / 预计完成",
      value: editable ? (
        <>
          <DateRangePicker
            value={draft.range}
            onChange={(next) => {
              commit({ range: next });
            }}
            hintDate={isoFromCnDate(task.startDate)}
            placeholder="选择开始与预计完成日期"
            ariaLabel="选择开始与预计完成日期"
          />
          <span className={CAPTION_CLASS}>天数随日期联动（含首尾）</span>
        </>
      ) : task.startDate === "" && task.dueDate === "" ? (
        dash
      ) : (
        (task.startDate === "" ? "—" : task.startDate) + " → " + (task.dueDate === "" ? "—" : task.dueDate)
      ),
    },
    { label: "预计所需天数", value: shownDays > 0 ? shownDays + " 天" : dash },
    {
      label: "预计所需施工人数",
      value: editable ? (
        <>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft.headcount}
              onChange={(event) => {
                updateDraft({ headcount: event.target.value });
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="未填"
              aria-label="预计所需施工人数"
              className={FIELD_CLASS + (headcountInvalid ? " border-rose-300 focus:border-rose-400 focus:ring-rose-500/15" : "")}
            />
            <span className="shrink-0 text-xs text-zinc-400">人</span>
          </div>
          {headcountInvalid ? <span className="mt-1 block text-[11px] text-rose-500">请填 0 以上的整数</span> : null}
        </>
      ) : task.headcount > 0 ? (
        task.headcount + " 人"
      ) : (
        dash
      ),
    },
    {
      label: "实际完成日期",
      value: canPatch ? (
        <>
          <InlineDateCell
            valueIso={isoFromCnDate(task.doneDate)}
            ariaLabel="修改实际完成日期"
            display={
              task.doneDate !== "" ? <span className="text-zinc-600">{task.doneDate}</span> : <span className="text-zinc-400">—</span>
            }
            onChange={(iso) => {
              if (onPatch === undefined) {
                return;
              }
              // 与任务表行内 / 看板卡片同一套口径：填 = 完成（四格全亮、按工期派生 已完成 / 提前完成）；清 = 退回进行中（3 格）
              onPatch(task.id, {
                doneDate: iso === "" ? "" : cnDateFromIso(iso),
                progress: iso === "" ? (TRACKER_STEPS - 1) / TRACKER_STEPS : 1,
                statusOverride: iso === "" ? "进行中" : undefined,
              });
              setSavedTick(Date.now());
            }}
          />
          <span className={CAPTION_CLASS}>填上 = 完成；清空 = 退回进行中</span>
        </>
      ) : task.doneDate !== "" ? (
        task.doneDate
      ) : (
        dash
      ),
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
          {onProgress === undefined ? (
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div className={"h-full rounded-full " + barClass} style={{ width: stepPct + "%" }} />
            </div>
          ) : (
            <div className="mt-2.5">
              <TrackerBar
                progress={task.progress}
                hovered={hoveredStep}
                onHoverChange={setHoveredStep}
                barClassName={barClass}
                dotOnClassName={dotOnClass}
                onChange={(progress) => {
                  onProgress(task.id, progress);
                  setSavedTick(Date.now());
                  setHoveredStep(0);
                }}
              />
            </div>
          )}
          {overdue ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">
              已超过预计完成日期（{task.dueDate}），当前仍未完成。
            </p>
          ) : null}
        </div>

        <ScrollArea viewportClassName="min-h-0 flex-1" className="px-6 py-1" ariaLabel="任务详情字段">
          <dl>
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[96px_1fr] items-start gap-x-4 border-b border-zinc-50 py-3 last:border-b-0"
              >
                <dt className="pt-px text-xs leading-5 text-zinc-400">{row.label}</dt>
                <dd className="min-w-0 text-sm leading-5 text-zinc-800">{row.value}</dd>
              </div>
            ))}
          </dl>
        </ScrollArea>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-100 px-6 py-3">
          <p className="text-[11px] text-zinc-400">点空白处或按 Esc 关闭</p>
          {savedTick !== 0 ? (
            <p className="text-[11px] font-medium text-emerald-600">已保存</p>
          ) : editable ? (
            <p className="text-[11px] text-zinc-400">改动即时保存（原型暂存浏览器内存）</p>
          ) : null}
        </footer>
      </aside>
    </div>
  );
}
