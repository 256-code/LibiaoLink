import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePopover } from "./usePopover";

/** 选项文案：普通枚举用字符串，带色标签的枚举（如任务状态）直接用 ReactNode。 */
export type SelectOption = { value: string; label: ReactNode };

type OptionListProps = {
  options: SelectOption[];
  value: string;
  onPick: (value: string) => void;
  ariaLabel: string;
};

/** 选项列表（单选 + 勾选态）：普通下拉与任务表行内编辑共用。 */
export function OptionList({ options, value, onPick, ariaLabel }: OptionListProps) {
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));

  return (
    <div role="listbox" aria-label={ariaLabel} className="p-1">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          onMouseEnter={() => {
            setActiveIndex(index);
          }}
          onClick={() => {
            onPick(option.value);
          }}
          className={
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 transition " +
            (index === activeIndex ? "bg-zinc-100" : "")
          }
        >
          {option.label}
          {option.value === value ? (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </button>
      ))}
    </div>
  );
}

type SelectMenuProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** 前置条件未满足时禁用（与原先原生 select 的 disabled 同口径：灰底灰字、点不开）。 */
  disabled?: boolean;
};

/** 普通下拉（不可搜索）：状态 / 紧急重要度这类枚举字段。 */
export function SelectMenu({ value, options, onChange, placeholder = "请选择", ariaLabel, disabled = false }: SelectMenuProps) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(160, options.length * 34 + 12);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setOpen((previous) => !previous);
        }}
        className={
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition " +
          (disabled
            ? "cursor-not-allowed border-zinc-200 bg-zinc-50"
            : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50")
        }
      >
        {selected === null ? (
          <span className="truncate text-zinc-400">{placeholder}</span>
        ) : (
          <span className={"truncate font-medium " + (disabled ? "text-zinc-400" : "text-zinc-800")}>{selected.label}</span>
        )}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={"ml-auto h-4 w-4 shrink-0 " + (disabled ? "text-zinc-300" : "text-zinc-400")}>
          <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              data-select-popover="true"
              className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <OptionList
                options={options}
                value={value}
                ariaLabel={ariaLabel}
                onPick={(next) => {
                  onChange(next);
                  setOpen(false);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
