import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../data/members";
import { usePopover } from "./usePopover";

const AVATAR_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

/** 头像底色按 id 稳定取色（原型阶段不接头像文件：姓名首字 + 底色）。 */
function toneOf(member: Member): string {
  let hash = 0;
  for (const char of member.id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function MemberAvatar({ member }: { member: Member }) {
  return (
    <span
      aria-hidden="true"
      className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold " + toneOf(member)}
    >
      {Array.from(member.name)[0] ?? "?"}
    </span>
  );
}

type MemberSearchListProps = {
  options: Member[];
  /** 当前选中成员 id（"" = 未选）。 */
  value: string;
  /** 多选模式（Push 136）：已选成员 id 列表；给出时选中判定改看「在不在列表里」，`value` 只作单选回退。 */
  selectedIds?: readonly string[];
  onPick: (member: Member) => void;
  ariaLabel: string;
};

/** 成员搜索列表（搜索框 + 选项 + 页脚）：人员下拉与任务表行内编辑共用。 */
export function MemberSearchList({ options, value, onPick, ariaLabel, selectedIds }: MemberSearchListProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim();
    if (keyword === "") {
      return options;
    }
    const lower = keyword.toLowerCase();
    return options.filter(
      (member) => member.name.includes(keyword) || member.handle.toLowerCase().includes(lower) || member.role.includes(keyword),
    );
  }, [options, query]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((previous) => Math.min(previous + 1, filtered.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((previous) => Math.max(previous - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target !== undefined) {
        onPick(target);
      }
    }
  };

  return (
    <div role="listbox" aria-label={ariaLabel}>
      <div className="border-b border-zinc-100 p-2">
        <input
          ref={searchRef}
          value={query}
          aria-label="搜索成员"
          placeholder="搜索成员"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleSearchKeyDown}
          className="w-full rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-700 outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-1 focus:ring-zinc-300"
        />
      </div>
      <div className="max-h-[200px] overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-400">没有匹配的成员</p>
        ) : (
          filtered.map((member, index) => (
            <button
              key={member.id}
              type="button"
              role="option"
              aria-selected={selectedIds === undefined ? member.id === value : selectedIds.includes(member.id)}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              onClick={() => {
                onPick(member);
              }}
              className={
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition " +
                (index === activeIndex ? "bg-zinc-100" : "")
              }
            >
              <MemberAvatar member={member} />
              <span className="truncate text-sm text-zinc-800">{member.name}</span>
              <span className="truncate text-xs text-zinc-400">{member.handle}</span>
              <span className="ml-auto shrink-0 pl-2 text-[11px] text-zinc-400">{member.role}</span>
              {(selectedIds === undefined ? member.id === value : selectedIds.includes(member.id)) ? (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          ))
        )}
      </div>
      <p className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400">
        共 {options.length} 人 · 按姓名 / 拼音搜索 · 当前为虚构演示成员
      </p>
    </div>
  );
}

type MemberMultiSelectProps = {
  /** 已选成员 id（有序；空数组 = 未选）。 */
  values: string[];
  /** 勾选 / 取消勾选后回传完整选中集（顺序 = 展示顺序）。 */
  onChange: (memberIds: string[]) => void;
  options: Member[];
  placeholder?: string;
  ariaLabel: string;
};

/**
 * 人员多选下拉（Push 136）：已选成员以胶囊列出（每颗可单个 ×移除），点右侧「添加 / 继续添加」开搜索列表接着勾选。
 * 用于「一个项目多位项目经理」「一个任务多位负责人」；与任务表行内多选 `InlineMemberMultiCell` 共用同一个搜索列表，
 * 浮层不随勾选关闭（可以连着点好几位）。
 */
export function MemberMultiSelect({ values, onChange, options, placeholder = "选择成员", ariaLabel }: MemberMultiSelectProps) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(280, 286);
  const selected = values
    .map((id) => options.find((member) => member.id === id))
    .filter((member): member is Member => member !== undefined);
  const toggle = (member: Member) => {
    onChange(values.includes(member.id) ? values.filter((id) => id !== member.id) : [...values, member.id]);
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white p-1.5 transition hover:border-zinc-300">
        {selected.map((member) => (
          <span
            key={member.id}
            className="inline-flex max-w-[200px] items-center gap-1.5 rounded-md bg-zinc-100 py-0.5 pl-0.5 pr-1 text-xs text-zinc-700"
          >
            <MemberAvatar member={member} />
            <span className="truncate">{member.name}</span>
            <button
              type="button"
              aria-label={"移除 " + member.name}
              onClick={() => {
                toggle(member);
              }}
              className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-600"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3 w-3">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => {
            setOpen((previous) => !previous);
          }}
          className="inline-flex min-w-[104px] flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-sm text-zinc-400 transition hover:bg-zinc-50"
        >
          {selected.length === 0 ? placeholder : "继续添加"}
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-zinc-400">
            <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <MemberSearchList
                options={options}
                value=""
                selectedIds={values}
                ariaLabel={ariaLabel}
                onPick={(member) => {
                  toggle(member);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
