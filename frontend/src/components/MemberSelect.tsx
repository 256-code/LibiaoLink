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
  onPick: (member: Member) => void;
  ariaLabel: string;
};

/** 成员搜索列表（搜索框 + 选项 + 页脚）：人员下拉与任务表行内编辑共用。 */
export function MemberSearchList({ options, value, onPick, ariaLabel }: MemberSearchListProps) {
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
              aria-selected={member.id === value}
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
              {member.id === value ? (
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

type MemberSelectProps = {
  /** 选中的成员 id（"" = 未选）。 */
  value: string;
  onChange: (member: Member) => void;
  options: Member[];
  placeholder?: string;
  ariaLabel: string;
};

/** 人员下拉（可搜索）：姓名 / 拼音 / 岗位都能搜，展示 = 姓名 + 拼音 + 岗位。 */
export function MemberSelect({ value, onChange, options, placeholder = "选择成员", ariaLabel }: MemberSelectProps) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(280, 286);
  const selected = options.find((member) => member.id === value) ?? null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        {selected === null ? (
          <span className="truncate text-zinc-400">{placeholder}</span>
        ) : (
          <>
            <MemberAvatar member={selected} />
            <span className="truncate font-medium text-zinc-800">{selected.name}</span>
            <span className="truncate text-xs text-zinc-400">{selected.handle}</span>
          </>
        )}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-zinc-400">
          <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <MemberSearchList
                options={options}
                value={value}
                ariaLabel={ariaLabel}
                onPick={(member) => {
                  onChange(member);
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