import { useEffect, useMemo, useState } from "react";
import { MEMBER_DIRECTORY, PROJECT_MANAGERS, memberById, memberByName } from "../data/members";
import {
  cnDateFromIso,
  daysBetweenInclusive,
  isoFromCnDate,
  taskStatus,
  type ProjectTask,
  type TaskPriority,
} from "../data/tasks";
import { DateRangePicker, type DateRange } from "./DateRangePicker";
import { MemberSelect } from "./MemberSelect";
import { ScrollArea } from "./ScrollArea";
import { SelectMenu } from "./SelectMenu";
import { TRACKER_STEPS, trackerLabel, trackerStep } from "./Tracker";

/** 任务编辑保存值：可编辑字段 = 负责人 / 开始与预计完成日期（含联动天数）/ 施工人数 / 紧急重要度 / 进展描述；项目经理是项目级字段。 */
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

type TaskEditModalProps = {
  task: ProjectTask;
  /** 当前项目经理（项目级字段：project.managerId）。 */
  managerId: string;
  onClose: () => void;
  onSubmit: (values: TaskEditSubmit) => void;
};

const PRIORITY_OPTIONS = [
  { value: "高", label: "高" },
  { value: "中", label: "中" },
  { value: "低", label: "低" },
];

const fieldClass =
  "block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10";

function toRange(task: ProjectTask): DateRange | null {
  const from = isoFromCnDate(task.startDate);
  const to = isoFromCnDate(task.dueDate);
  return from === "" || to === "" ? null : { from, to };
}

/**
 * 任务编辑弹窗（Push 63）：任务表每行的铅笔 / 任务详情抽屉「编辑任务」入口打开。
 * 人员字段用可搜索人员下拉（人员目录 `data/members.ts`，当前为虚构演示成员，不含真实姓名）；
 * 开始 / 预计完成日期用日期区间选择器（与项目空间分类筛选同一套）；天数随日期联动只读；
 * 任务描述 / 成果文件按 A1-17 生成后锁定，状态 / 进度 / 实际完成日期由系统派生 —— 列在只读区，不在本表单修改。
 */
export function TaskEditModal({ task, managerId: currentManagerId, onClose, onSubmit }: TaskEditModalProps) {
  const initial = useMemo(
    () => ({
      managerId: currentManagerId,
      ownerId: memberByName(task.owner)?.id ?? "",
      range: toRange(task),
      headcount: task.headcount > 0 ? String(task.headcount) : "",
      priority: task.priority,
      note: task.note,
    }),
    [currentManagerId, task],
  );

  const [managerId, setManagerId] = useState(initial.managerId);
  const [ownerId, setOwnerId] = useState(initial.ownerId);
  const [range, setRange] = useState<DateRange | null>(initial.range);
  const [headcount, setHeadcount] = useState(initial.headcount);
  const [priority, setPriority] = useState<TaskPriority>(initial.priority);
  const [note, setNote] = useState(initial.note);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const days = range === null ? 0 : daysBetweenInclusive(range.from, range.to);
  const headcountText = headcount.trim();
  const headcountValue = headcountText === "" ? 0 : Number(headcountText);
  const headcountInvalid = headcountText !== "" && (Number.isNaN(headcountValue) || headcountValue < 0);
  const dirty =
    managerId !== initial.managerId ||
    ownerId !== initial.ownerId ||
    JSON.stringify(range) !== JSON.stringify(initial.range) ||
    headcount.trim() !== initial.headcount.trim() ||
    priority !== initial.priority ||
    note.trim() !== initial.note;

  const status = taskStatus(task);
  const progressText = trackerLabel(task.progress);
  const progressPct = Math.round((trackerStep(task.progress) / TRACKER_STEPS) * 100);

  const readOnlyFields: Array<{ label: string; value: string }> = [
    { label: "任务状态", value: status },
    { label: "项目进度", value: progressText + "（" + String(progressPct) + "%）" },
    { label: "实际完成日期", value: task.doneDate === "" ? "—" : task.doneDate },
    { label: "输出成果文件", value: task.deliverable === "" ? "—" : task.deliverable },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="编辑任务"
        className="relative flex h-fit max-h-[92vh] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/80 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.99),rgba(255,255,255,0.95))] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_rgba(15,23,42,0.28)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <header className="shrink-0 border-b border-zinc-100 px-6 pb-4 pt-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500">{task.stage}</span>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">编辑任务</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭编辑任务"
              className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h2 className="mt-3 text-base font-semibold leading-6 text-zinc-900">{task.title}</h2>
          {task.titleEn === "" ? null : <p className="mt-0.5 text-xs leading-5 text-zinc-400">{task.titleEn}</p>}
        </header>

        <ScrollArea viewportClassName="min-h-0 flex-1" className="px-6 py-4" ariaLabel="任务编辑字段" thumbAlwaysVisible>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-600">项目经理</span>
              <MemberSelect
                value={managerId}
                options={PROJECT_MANAGERS}
                onChange={(member) => {
                  setManagerId(member.id);
                }}
                placeholder="选择项目经理"
                ariaLabel="选择项目经理"
              />
              <span className="mt-1 block text-[11px] leading-4 text-zinc-400">项目级字段，保存后全项目同步</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-600">任务负责人</span>
              <MemberSelect
                value={ownerId}
                options={MEMBER_DIRECTORY}
                onChange={(member) => {
                  setOwnerId(member.id);
                }}
                placeholder="选择任务负责人"
                ariaLabel="选择任务负责人"
              />
              <span className="mt-1 block text-[11px] leading-4 text-zinc-400">留空 = 待分配</span>
            </label>

            <div className="col-span-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-zinc-600">开始日期 → 预计完成日期</span>
                <span className="text-[11px] text-zinc-400">
                  预计所需天数 <span className="font-medium text-zinc-600">{days > 0 ? String(days) + " 天" : "—"}</span>
                </span>
              </div>
              <div className="mt-1.5">
                <DateRangePicker
                  value={range}
                  onChange={setRange}
                  hintDate={isoFromCnDate(task.startDate)}
                  placeholder="选择开始与预计完成日期"
                  ariaLabel="选择开始与预计完成日期"
                />
              </div>
              <span className="mt-1 block text-[11px] leading-4 text-zinc-400">天数随日期联动（含首尾）</span>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-600">预计所需施工人数</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={headcount}
                  onChange={(event) => {
                    setHeadcount(event.target.value);
                  }}
                  placeholder="未填"
                  className={
                    fieldClass + (headcountInvalid ? " border-rose-300 focus:border-rose-400 focus:ring-rose-500/15" : "")
                  }
                />
                <span className="shrink-0 text-xs text-zinc-400">人</span>
              </div>
              {headcountInvalid ? (
                <span className="mt-1 block text-[11px] text-rose-500">请填 0 以上的整数</span>
              ) : (
                <span className="mt-1 block text-[11px] leading-4 text-zinc-400">非必填</span>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-600">紧急重要度</span>
              <SelectMenu
                value={priority}
                options={PRIORITY_OPTIONS}
                onChange={(value) => {
                  setPriority(value as TaskPriority);
                }}
                ariaLabel="选择紧急重要度"
              />
              <span className="mt-1 block text-[11px] leading-4 text-zinc-400">新建任务默认「中」</span>
            </label>

            <label className="col-span-2 block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-600">项目进展描述</span>
              <textarea
                rows={2}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="补充当前进展、风险或下一步"
                className={fieldClass + " resize-none leading-6"}
              />
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-4 py-3">
            <p className="text-[11px] font-medium text-zinc-500">只读字段（按字段口径不在本表单修改）</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {readOnlyFields.map((field) => (
                <div key={field.label} className="flex min-w-0 items-baseline gap-1.5">
                  <dt className="shrink-0 text-[11px] text-zinc-400">{field.label}</dt>
                  <dd className="truncate text-[11px] text-zinc-700" title={field.value}>
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">
              任务描述 / 成果文件按 A1-17 锁定；状态 / 进度 / 实际完成日期由进度与日期派生；文件走文件库。
            </p>
          </div>
        </ScrollArea>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-100 bg-white/70 px-6 py-3">
          <p className="text-[11px] leading-4 text-zinc-400">保存后立即更新任务行；当前原型未接后端、暂存浏览器内存</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!dirty || headcountInvalid}
              onClick={() => {
                const owner = ownerId === "" ? null : memberById(ownerId) ?? null;
                onSubmit({
                  taskId: task.id,
                  managerId,
                  owner: owner?.name ?? "",
                  ownerEn: owner?.handle ?? "",
                  startDate: range === null ? "" : cnDateFromIso(range.from),
                  dueDate: range === null ? "" : cnDateFromIso(range.to),
                  days,
                  headcount: headcountText === "" ? 0 : Math.floor(headcountValue),
                  priority,
                  note: note.trim(),
                });
              }}
              className="rounded-lg bg-[#feca04] px-3.5 py-2 text-xs font-medium text-zinc-900 shadow-sm transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存修改
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
