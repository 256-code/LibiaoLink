import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../data/members";
import { MemberSearchList } from "./MemberSelect";
import { OptionList, type SelectOption } from "./SelectMenu";
import { usePopover } from "./usePopover";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const pad = (value: number) => String(value).padStart(2, "0");
const toKey = (date: Date) =>
  String(date.getFullYear()) + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
const toDate = (key: string) => {
  const parts = key.split("-").map((part) => Number(part));
  return new Date(parts[0] ?? 2026, (parts[1] ?? 1) - 1, parts[2] ?? 1);
};

type InlineCellProps = {
  ariaLabel: string;
  title?: string;
  /** 单元格当前值的展示（表格里的样子）。 */
  display: ReactNode;
  /** 浮层尺寸（用于定位 / 翻转判断）。 */
  width: number;
  height: number;
  /** 触发器（单元格本体）附加类名，如右对齐列用 `justify-self-end`。 */
  triggerClassName?: string;
  /** 浮层内容；`close` 用于选完即关。 */
  render: (close: () => void) => ReactNode;
};

/**
 * 表格行内编辑的通用外壳（Push 64）：单元格本身是按钮，点击在被点的位置弹出浮层（portal 到 body，
 * 不被表格横向滚动裁掉），点浮层外 / Esc 关闭；浮层里的控件不冒泡到行（不会触发行选中的抽屉）。
 */
export function InlineCell({ ariaLabel, title = "点击编辑", display, width, height, triggerClassName, render }: InlineCellProps) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(width, height);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
        onKeyDown={(event) => {
          // Esc 直接关掉浮层（行本身只认 Enter / 空格，不需要拦 Esc）
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          event.stopPropagation();
        }}
        className={
          // 「液态玻璃」小框（Push 66）：可点区域 = 这个框本身 —— 不给负外边距。
          // 静止态 = 白底 + 淡灰描边（Push 67 按业务样张调）；悬停 / 展开时才稍微实一点。
          "inline-flex max-w-full items-center gap-1 rounded-lg border px-1.5 py-[3px] text-left text-xs " +
          "backdrop-blur-[3px] transition " +
          (open
            ? "border-zinc-300 bg-white ring-1 ring-zinc-900/10 shadow-[0_4px_14px_rgba(15,23,42,0.12)] "
            : "border-zinc-200/90 bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.04)] " +
              "hover:border-zinc-300 hover:bg-white hover:shadow-[0_2px_6px_rgba(15,23,42,0.08)] ") +
          (triggerClassName === undefined ? "" : " " + triggerClassName)
        }
      >
        <span className="min-w-0 truncate">{display}</span>
      </button>
      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              data-inline-popover="true"
              onClick={(event) => {
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
              className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              {render(() => {
                setOpen(false);
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type InlineMemberCellProps = {
  value: string;
  options: Member[];
  ariaLabel: string;
  onPick: (member: Member) => void;
  display: ReactNode;
};

/** 行内人员单元格（可搜索人员下拉；项目经理 / 任务负责人两列共用）。 */
export function InlineMemberCell({ value, options, ariaLabel, onPick, display }: InlineMemberCellProps) {
  return (
    <InlineCell
      ariaLabel={ariaLabel}
      title="点击选择成员"
      width={280}
      height={286}
      display={display}
      render={(close) => (
        <MemberSearchList
          options={options}
          value={value}
          ariaLabel={ariaLabel}
          onPick={(member) => {
            onPick(member);
            close();
          }}
        />
      )}
    />
  );
}

type InlineOptionCellProps = {
  value: string;
  options: SelectOption[];
  ariaLabel: string;
  onPick: (value: string) => void;
  display: ReactNode;
};

/** 行内枚举单元格（如紧急重要度）。 */
export function InlineOptionCell({ value, options, ariaLabel, onPick, display }: InlineOptionCellProps) {
  return (
    <InlineCell
      ariaLabel={ariaLabel}
      title="点击选择"
      width={140}
      height={options.length * 34 + 12}
      display={display}
      render={(close) => (
        <OptionList
          options={options}
          value={value}
          ariaLabel={ariaLabel}
          onPick={(next) => {
            onPick(next);
            close();
          }}
        />
      )}
    />
  );
}

/** 行内日期单元格（单个日期的小日历）。 */
export function InlineDateCell({
  valueIso,
  display,
  ariaLabel,
  onChange,
  triggerClassName,
}: {
  valueIso: string;
  display: ReactNode;
  ariaLabel: string;
  onChange: (iso: string) => void;
  triggerClassName?: string;
}) {
  return (
    <InlineCell
      ariaLabel={ariaLabel}
      title="点击选择日期"
      width={264}
      height={336}
      display={display}
      triggerClassName={triggerClassName}
      render={(close) => (
        <MiniCalendar
          value={valueIso}
          onChange={(iso) => {
            onChange(iso);
            close();
          }}
        />
      )}
    />
  );
}

function MiniCalendar({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [view, setView] = useState(() => {
    const base = value === "" ? new Date() : toDate(value);
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const cells = useMemo(() => {
    const year = view.getFullYear();
    const month = view.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(year, month, 1 - offset + index);
      return { key: toKey(date), day: date.getDate(), inMonth: date.getMonth() === month };
    });
  }, [view]);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => {
            setView(new Date(view.getFullYear(), view.getMonth() - 1, 1));
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-zinc-800">
          {String(view.getFullYear()) + "年" + String(view.getMonth() + 1) + "月"}
        </p>
        <button
          type="button"
          aria-label="下个月"
          onClick={() => {
            setView(new Date(view.getFullYear(), view.getMonth() + 1, 1));
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center text-[11px] text-zinc-400">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-y-1">
        {cells.map((cell) => {
          const selected = cell.key === value;
          const base = "flex h-8 w-full items-center justify-center rounded-lg text-xs transition ";
          const tone = selected
            ? "bg-zinc-900 font-semibold text-white "
            : cell.inMonth
              ? "text-zinc-600 hover:bg-zinc-100 "
              : "text-zinc-300 ";
          return (
            <button
              key={cell.key}
              type="button"
              disabled={!cell.inMonth}
              onClick={() => {
                onChange(cell.key);
              }}
              className={base + tone}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2">
        <button
          type="button"
          onClick={() => {
            onChange("");
          }}
          className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-100"
        >
          清除
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(toKey(new Date()));
          }}
          className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-100"
        >
          今天
        </button>
      </div>
    </div>
  );
}

/** 行内数字单元格（预计所需施工人数）。 */
export function InlineNumberCell({
  value,
  display,
  ariaLabel,
  suffix = "人",
  onSave,
}: {
  value: number;
  display: ReactNode;
  ariaLabel: string;
  suffix?: string;
  onSave: (value: number) => void;
}) {
  return (
    <InlineCell
      ariaLabel={ariaLabel}
      title="点击填写"
      width={196}
      height={124}
      display={display}
      render={(close) => (
        <NumberEditor value={value} suffix={suffix} onSave={onSave} onCancel={close} />
      )}
    />
  );
}

function NumberEditor({
  value,
  suffix,
  onSave,
  onCancel,
}: {
  value: number;
  suffix: string;
  onSave: (value: number) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : "");
  const trimmed = text.trim();
  const parsed = trimmed === "" ? 0 : Number(trimmed);
  const invalid = trimmed !== "" && (Number.isNaN(parsed) || parsed < 0);

  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={text}
          aria-label={suffix === "人" ? "预计所需施工人数" : "数值"}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !invalid) {
              onSave(trimmed === "" ? 0 : Math.floor(parsed));
            }
            if (event.key === "Escape") {
              onCancel();
            }
          }}
          className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
        />
        <span className="shrink-0 text-xs text-zinc-400">{suffix}</span>
      </div>
      {invalid ? <p className="mt-1.5 text-[11px] text-rose-500">请填 0 以上的整数</p> : null}
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100"
        >
          取消
        </button>
        <button
          type="button"
          disabled={invalid}
          onClick={() => {
            onSave(trimmed === "" ? 0 : Math.floor(parsed));
          }}
          className="rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  );
}

/** 行内文本单元格（项目进展描述）。 */
export function InlineTextCell({
  value,
  display,
  ariaLabel,
  onSave,
}: {
  value: string;
  display: ReactNode;
  ariaLabel: string;
  onSave: (value: string) => void;
}) {
  return (
    <InlineCell
      ariaLabel={ariaLabel}
      title="点击填写"
      width={268}
      height={186}
      display={display}
      render={(close) => <TextEditor value={value} onSave={onSave} onCancel={close} />}
    />
  );
}

function TextEditor({ value, onSave, onCancel }: { value: string; onSave: (value: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);

  return (
    <div className="p-3">
      <textarea
        autoFocus
        rows={3}
        value={text}
        aria-label="项目进展描述"
        placeholder="补充当前进展、风险或下一步"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm leading-6 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
      />
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            onSave(text.trim());
          }}
          className="rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800"
        >
          保存
        </button>
      </div>
    </div>
  );
}
