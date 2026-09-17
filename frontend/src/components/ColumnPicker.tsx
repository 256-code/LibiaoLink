import { useEffect, useRef, useState } from "react";
import { TABLE_COLUMNS, type ColumnKey, type VisibleColumns } from "./TaskBoard";

type ColumnPickerProps = {
  visible: VisibleColumns;
  onToggle: (key: ColumnKey, checked: boolean) => void;
  onReset: () => void;
};

export function ColumnPicker({ visible, onToggle, onReset }: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-3.5 w-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        筛选
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-xs font-medium text-zinc-500">表格显示字段</span>
            <button type="button" onClick={onReset} className="text-xs text-zinc-400 transition hover:text-zinc-700">
              重置
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {TABLE_COLUMNS.map((column) => {
              const locked = column.locked === true;
              const checked = locked || visible[column.key] !== false;
              return (
                <label
                  key={column.key}
                  className={
                    "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm " +
                    (locked ? "cursor-default text-zinc-400" : "cursor-pointer text-zinc-700 hover:bg-zinc-50")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(event) => onToggle(column.key, event.target.checked)}
                    className="h-4 w-4 accent-zinc-900"
                  />
                  <span className="truncate">{column.label}</span>
                  {locked ? <span className="ml-auto text-[10px] text-zinc-300">常显</span> : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
