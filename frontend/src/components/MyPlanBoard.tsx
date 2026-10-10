import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OptionList } from "./SelectMenu";
import { Toast } from "./Toast";
import { usePopover } from "./usePopover";
import { PlanNoteCard } from "./PlanNoteCard";
import { PlanNoteEditor, type PlanNoteDraft } from "./PlanNoteEditor";
import {
  PLAN_CATEGORY_MAX,
  PLAN_CATEGORY_NAME_MAX,
  PLAN_NOTE_LIMIT,
  PLAN_SORT_LABELS,
  filterPlanNotes,
  loadPlanBoard,
  newPlanNoteId,
  normalizePlanCategoryName,
  planGreeting,
  savePlanBoard,
  sortPlanNotes,
  type PlanBoard,
  type PlanNote,
  type PlanSortKey,
} from "../myPlan";

/**
 * 工作台「我的计划」便签墙（第三枚标签 · 业务口径 2026-10-10「照 minimemo3 便签页融入系统」→
 * 「ui直接照搬可以吗 背景颜色也搬过去 卡片的尺寸也要」→「导出导入功能不要」）：
 * 页面形态照 MiniMemo 参考页照搬 —— 奶白背景（#fdfbf7 + 左上暖色径向渐变）+ 左侧分类栏 +
 * 「问候 + 大标题 + 计数」头部 + 228px 起跳的 auto-fill 网格 + 198 高圆角卡片（配色 = 同一套 7 色 hex 调色板）；
 * 工具条 = 搜索 / 排序 / 新建便签（不做导出 / 导入）。
 *
 * 存储口径见 frontend/src/myPlan.ts（本机浏览器保存、退出登录清除；服务端同步待 wmj 线契约扩键）。
 */

const BTN_GHOST =
  "inline-flex items-center gap-[7px] rounded-[11px] border border-[#e8e3da] bg-white px-3.5 py-[9px] text-[13px] font-medium text-[#44403c] transition hover:border-[#d5cdbd] hover:bg-[#faf9f7] hover:text-[#1c1917]";

const BTN_PRIMARY =
  "inline-flex items-center gap-[7px] rounded-[11px] border border-[#1c1917] bg-[#1c1917] px-3.5 py-[9px] text-[13px] font-medium text-[#fdfbf7] shadow-[0_1px_2px_rgba(28,25,23,0.05),0_10px_26px_-16px_rgba(28,25,23,0.22)] transition hover:-translate-y-px hover:bg-[#292524] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

const SORT_OPTIONS = (["updated_desc", "created_desc", "created_asc", "title_asc"] as const).map((key) => ({
  value: key,
  label: PLAN_SORT_LABELS[key],
}));

/* ----- 图标（照参考页同款的细线性图标；系统内联 SVG 口径） ----- */

function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path d="m21 16-4 4-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 20V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m3 8 4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[30px] w-[30px]" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7.9L13.4 21H6.5A2.5 2.5 0 0 1 4 18.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 13.5h-4.6a1.9 1.9 0 0 0-1.9 1.9V21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ----- 分类栏条目（「全部便签」+ 各分类；选中 = 墨黑底、右侧带条数） ----- */

function CategoryItem({
  value,
  label,
  icon,
  count,
  active,
  onClick,
}: {
  value: string;
  label: string;
  icon: ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-plan-category={value}
      aria-pressed={active}
      onClick={onClick}
      className={
        "flex items-center justify-between gap-2.5 rounded-full border border-[#e8e3da] px-3 py-1.5 text-[13.5px] transition lg:rounded-[11px] lg:border-0 lg:px-2.5 lg:py-[9px] " +
        (active ? "bg-[#1c1917] text-[#fdfbf7]" : "text-[#57534e] hover:bg-[#faf9f7]")
      }
    >
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className={"hidden text-[11px] lg:inline " + (active ? "opacity-[0.7]" : "opacity-[0.55]")}>{count}</span>
    </button>
  );
}

/* ----- 工具条：搜索（照参考页搜索框材质） ----- */

function BoardSearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div data-plan-search="" className="relative mx-auto flex w-full max-w-[460px] flex-1 items-center">
      <span className="pointer-events-none absolute left-3 text-[#a8a29e]">
        <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M20.5 20.5 16.2 16.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder="搜索标题、内容或分类"
        aria-label="搜索标题、内容或分类"
        className="w-full appearance-none rounded-xl border border-[#e8e3da] bg-white py-2.5 pl-9 pr-9 text-[13.5px] text-[#1c1917] outline-none transition placeholder:text-[#b6afa6] focus:border-[#d5cdbd] focus:ring-[3px] focus:ring-black/5 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      />
      {value.length > 0 ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => {
            onChange("");
          }}
          className="absolute right-2 grid h-7 w-7 place-items-center rounded-lg text-[#78716c] transition hover:bg-black/5 hover:text-[#1c1917]"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/* ----- 工具条：排序（照参考页的幽灵按钮 + 下拉） ----- */

function SortMenu({ value, onChange }: { value: PlanSortKey; onChange: (next: PlanSortKey) => void }) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(180, SORT_OPTIONS.length * 34 + 12);
  const selected = SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0];
  return (
    <div data-plan-sort="" className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="排序方式"
        onClick={() => {
          setOpen(!open);
        }}
        className={BTN_GHOST}
      >
        <SortIcon />
        {selected.label}
      </button>
      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              data-plan-sort-popover=""
              className="fixed z-50 overflow-hidden rounded-[14px] border border-[#e8e3da] bg-white shadow-[0_24px_48px_-24px_rgba(28,25,23,0.45)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <OptionList
                options={SORT_OPTIONS}
                value={value}
                ariaLabel="排序方式"
                onPick={(next) => {
                  onChange(next as PlanSortKey);
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

/* ----- 空态（照参考页：虚线圆角容器 + 圆形图标 + 新建按钮） ----- */

function BoardEmpty({ title, text, onNew }: { title: string; text: string; onNew: () => void }) {
  return (
    <div
      data-plan-empty=""
      className="flex flex-col items-center gap-2.5 rounded-[22px] border-[1.5px] border-dashed border-[#e8e3da] bg-white/60 px-5 py-[90px] text-center"
    >
      <span className="grid h-[62px] w-[62px] place-items-center rounded-full bg-[#f1ece3] text-[#a8a29e]">
        <NoteIcon />
      </span>
      <p className="mt-1.5 text-base font-semibold text-[#1c1917]">{title}</p>
      <p className="mb-2.5 text-[13px] text-[#78716c]">{text}</p>
      <button type="button" data-plan-empty-new="" onClick={onNew} className={BTN_PRIMARY}>
        <PlusIcon />
        新建便签
      </button>
    </div>
  );
}

/**
 * 便签墙主体：工具条（搜索 / 排序 / 新建）+ 左侧分类栏 + 「问候 + 标题 + 计数」头部 + 便签网格；
 * 点卡片进编辑弹窗（PlanNoteEditor）。不做导出 / 导入（业务口径 2026-10-10「导出导入功能不要」）。
 */
export function MyPlanBoard() {
  const [board, setBoard] = useState<PlanBoard>(() => loadPlanBoard());
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<PlanSortKey>("updated_desc");
  /** 编辑弹窗：null = 关着；note null = 新建。 */
  const [editor, setEditor] = useState<{ note: PlanNote | null } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  /** 整体写回：先更新界面，再落本机；存储不可用时出提示（改动留在界面上，用户可重试）。 */
  const commit = (next: PlanBoard, okText?: string): void => {
    setBoard(next);
    if (!savePlanBoard(next)) {
      setNotice({ kind: "error", text: "本机存储不可用（隐私模式 / 配额已满）—— 本次改动没有保存，刷新会丢。" });
      return;
    }
    if (okText !== undefined) {
      setNotice({ kind: "ok", text: okText });
    }
  };

  const handleSaveNote = (draft: PlanNoteDraft): void => {
    if (editor === null) {
      return;
    }
    const now = new Date().toISOString();
    const existing = editor.note;
    if (existing === null) {
      if (board.notes.length >= PLAN_NOTE_LIMIT) {
        setEditor(null);
        setNotice({ kind: "error", text: "便签已达上限（" + String(PLAN_NOTE_LIMIT) + " 条）—— 先删掉一些再新建。" });
        return;
      }
      const note: PlanNote = { id: newPlanNoteId(), title: draft.title, content: draft.content, category: draft.category, colorId: draft.colorId, fontId: draft.fontId, createdAt: now, updatedAt: now };
      commit({ notes: [note].concat(board.notes), categories: board.categories });
    } else {
      const notes = board.notes.map((item) => (item.id === existing.id ? { ...item, ...draft, updatedAt: now } : item));
      commit({ notes, categories: board.categories });
    }
    setEditor(null);
  };

  const handleDeleteNote = (): void => {
    if (editor === null || editor.note === null) {
      return;
    }
    const target = editor.note;
    commit({ notes: board.notes.filter((item) => item.id !== target.id), categories: board.categories }, "已删除便签。");
    setEditor(null);
  };

  const handleAddCategory = (name: string): void => {
    const normalized = normalizePlanCategoryName(name);
    if (normalized === "" || board.categories.includes(normalized) || board.categories.length >= PLAN_CATEGORY_MAX) {
      return;
    }
    commit({ notes: board.notes, categories: board.categories.concat(normalized) });
  };

  /** 分类栏「新建分类」：回车 / 失焦提交（空 = 放弃）；已在表里 = 直接选中；到 12 类上限 = 不加。 */
  const commitNewCategory = (): void => {
    const name = normalizePlanCategoryName(newCategory);
    setAddingCategory(false);
    setNewCategory("");
    if (name === "") {
      return;
    }
    if (board.categories.includes(name)) {
      setCategory(name);
      return;
    }
    if (board.categories.length >= PLAN_CATEGORY_MAX) {
      return;
    }
    handleAddCategory(name);
    setCategory(name);
  };

  const visible = sortPlanNotes(filterPlanNotes(board.notes, keyword, category), sort);
  const heading = category === null ? "全部便签" : category;

  return (
    <section
      data-workspace-plan=""
      style={{ background: "radial-gradient(1200px 480px at 12% -8%, #f6eddc 0%, rgba(246, 237, 220, 0) 62%), #fdfbf7" }}
      className="-mx-6 -mb-10 -mt-5 min-h-[calc(100dvh-8rem)] px-6 pb-10 pt-6"
    >
      <div className="mx-auto w-full max-w-[1240px]">
        <div className="flex flex-wrap items-center gap-3">
          <BoardSearch value={keyword} onChange={setKeyword} />
          <span className="ml-auto flex items-center gap-2">
            <SortMenu value={sort} onChange={setSort} />
            <button
              type="button"
              data-plan-new=""
              onClick={() => {
                setEditor({ note: null });
              }}
              className={BTN_PRIMARY}
            >
              <PlusIcon />
              新建便签
            </button>
          </span>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[252px_minmax(0,1fr)]">
          <aside className="flex flex-wrap content-start items-center gap-1.5 rounded-[18px] border border-[#e8e3da] bg-white p-3.5 shadow-[0_1px_2px_rgba(28,25,23,0.05),0_10px_26px_-16px_rgba(28,25,23,0.22)] lg:sticky lg:top-[124px] lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-[3px] lg:self-start">
            <p className="mb-2 hidden px-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a8a29e] lg:block">分类</p>
            <CategoryItem
              value="all"
              label="全部便签"
              icon={<FolderOpenIcon />}
              count={board.notes.length}
              active={category === null}
              onClick={() => {
                setCategory(null);
              }}
            />
            {board.categories.map((item) => (
              <CategoryItem
                key={item}
                value={item}
                label={item}
                icon={<TagIcon />}
                count={board.notes.filter((note) => note.category === item).length}
                active={category === item}
                onClick={() => {
                  setCategory(category === item ? null : item);
                }}
              />
            ))}
            {addingCategory ? (
              <input
                autoFocus
                data-plan-category-new=""
                value={newCategory}
                maxLength={PLAN_CATEGORY_NAME_MAX}
                onChange={(event) => {
                  setNewCategory(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitNewCategory();
                  }
                  if (event.key === "Escape") {
                    setAddingCategory(false);
                    setNewCategory("");
                  }
                }}
                onBlur={commitNewCategory}
                placeholder="新分类名称"
                className="w-full rounded-full border border-dashed border-[#d5cdbd] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1917] outline-none transition placeholder:text-[#b6afa6] focus:border-solid focus:border-[#1c1917] focus:bg-white lg:rounded-[11px]"
              />
            ) : (
              <button
                type="button"
                data-plan-category-add=""
                disabled={board.categories.length >= PLAN_CATEGORY_MAX}
                title={board.categories.length >= PLAN_CATEGORY_MAX ? "最多 " + String(PLAN_CATEGORY_MAX) + " 个分类" : "添加新分类"}
                onClick={() => {
                  setAddingCategory(true);
                }}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-[#e8e3da] px-3 py-1.5 text-[13px] text-[#a8a29e] transition hover:border-[#d5cdbd] hover:bg-[#faf9f7] hover:text-[#1c1917] disabled:cursor-not-allowed disabled:opacity-50 lg:rounded-[11px] lg:px-2.5 lg:py-[9px]"
              >
                <PlusIcon />
                新建分类
              </button>
            )}
            <div className="mt-2 hidden gap-[3px] border-t border-dashed border-[#e8e3da] px-2 pb-1 pt-3 text-[11.5px] text-[#a8a29e] lg:grid">
              <p>数据保存在浏览器本地</p>
              <p data-plan-count="">{"共 " + String(board.notes.length) + " 条便签"}</p>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-[18px]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-[12.5px] tracking-[0.16em] text-[#a8a29e]">{planGreeting()}</p>
                <h1 className="flex items-center gap-2.5 text-[30px] font-bold tracking-[-0.02em] text-[#1c1917]">
                  {heading}
                  <span className="rounded-full bg-[#efeae1] px-2.5 py-[3px] text-xs font-semibold text-[#57534e]">{visible.length}</span>
                </h1>
              </div>
              {keyword.trim() === "" ? null : <p className="pb-1 text-[12.5px] text-[#78716c]">{"正在搜索：" + keyword.trim()}</p>}
            </div>

            {board.notes.length === 0 ? (
              <BoardEmpty
                title="还没有便签"
                text="点「新建便签」，写下第一条计划。"
                onNew={() => {
                  setEditor({ note: null });
                }}
              />
            ) : visible.length === 0 ? (
              <BoardEmpty
                title="没有找到匹配的便签"
                text="换个关键字，或把左侧分类切回「全部便签」。"
                onNew={() => {
                  setEditor({ note: null });
                }}
              />
            ) : (
              <div data-plan-grid="" className="grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] content-start gap-4">
                {visible.map((note) => (
                  <PlanNoteCard
                    key={note.id}
                    note={note}
                    onOpen={() => {
                      setEditor({ note });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {notice === null ? null : (
        <Toast
          kind={notice.kind}
          text={notice.text}
          onClose={() => {
            setNotice(null);
          }}
          anchor={{ name: "data-plan-toast", value: notice.kind }}
        />
      )}

      {editor === null ? null : (
        <PlanNoteEditor
          note={editor.note}
          categories={board.categories}
          onSave={handleSaveNote}
          onDelete={handleDeleteNote}
          onAddCategory={handleAddCategory}
          onClose={() => {
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}
