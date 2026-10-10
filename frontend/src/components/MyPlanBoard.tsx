import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toast } from "./Toast";
import { Loader } from "./Loader";
import { PlanNoteCard } from "./PlanNoteCard";
import { PlanNoteEditor, type PlanNoteDraft } from "./PlanNoteEditor";
import { loadMyPreferences, saveMyPlanBoard } from "../preferencesApi";
import {
  PLAN_CATEGORY_MAX,
  PLAN_CATEGORY_NAME_MAX,
  PLAN_NOTE_LIMIT,
  clearLegacyPlanBoard,
  filterPlanNotes,
  newPlanNoteId,
  normalizePlanCategoryName,
  orderPlanNotes,
  planGreeting,
  readLegacyPlanBoard,
  seedPlanBoard,
  type PlanBoard,
  type PlanNote,
} from "../myPlan";

/**
 * 工作台「我的计划」便签墙（第三枚标签 · 业务口径 2026-10-10「照 minimemo3 便签页融入系统」→
 * 「ui直接照搬可以吗 背景颜色也搬过去 卡片的尺寸也要」→「导出导入功能不要」→「填写也要一样」→
 * Push 268「这个也不需要（排序）· 背景换成白色 · 数据接入数据库 · 新增完成按钮 · 完成后只显示在已完成里面」）：
 * 页面形态照 MiniMemo 参考页照搬 —— 纯白背景 + 左侧分类栏（全部便签 / 已完成 / 各分类）+ 「问候 + 大标题 + 计数」头部 +
 * 228px 起跳的 auto-fill 网格 + 198 高圆角卡片（配色 = 同一套 7 色 hex 调色板）；工具条 = 搜索 + 新建便签（排序已下架；不做导出 / 导入）。
 *
 * 存储（Push 268 起 · 账号落库）：整面便签墙按账号存服务端偏好（user_preferences.prefs.myPlanBoard，见 preferencesApi.ts）——
 * 首次打开（账号里从未保存）预置 6 条示例并上云；本机旧键（libiaolink.plan.board.v1）自动迁移上云再清键（迁移失败保留旧键、本机数据兜底、下轮重试）。
 * 保存 = 乐观更新 + 单键 PATCH（串行）；失败保留界面改动并出提示（刷新回滚到账号里最后一次保存）。
 * 完成态：编辑弹窗底栏「完成 / 恢复」——完成后只出现在「已完成」视图（便签墙与分类视图不再显示）。
 */

const BTN_PRIMARY =
  "inline-flex items-center gap-[7px] rounded-[11px] border border-[#1c1917] bg-[#1c1917] px-3.5 py-[9px] text-[13px] font-medium text-[#fdfbf7] shadow-[0_1px_2px_rgba(28,25,23,0.05),0_10px_26px_-16px_rgba(28,25,23,0.22)] transition hover:-translate-y-px hover:bg-[#292524] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

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

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="m8.4 12.3 2.5 2.5 4.7-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

/* ----- 分类栏条目（「全部便签」/「已完成」+ 各分类；选中 = 墨黑底、右侧带条数） ----- */

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

/* ----- 空态（照参考页：虚线圆角容器 + 圆形图标 + 新建按钮） ----- */

function BoardEmpty({ title, text, onNew }: { title: string; text: string; onNew?: () => void }) {
  return (
    <div
      data-plan-empty=""
      className="flex flex-col items-center gap-2.5 rounded-[22px] border-[1.5px] border-dashed border-[#e8e3da] bg-[#faf9f7] px-5 py-[90px] text-center"
    >
      <span className="grid h-[62px] w-[62px] place-items-center rounded-full bg-[#f1ece3] text-[#a8a29e]">
        <NoteIcon />
      </span>
      <p className="mt-1.5 text-base font-semibold text-[#1c1917]">{title}</p>
      <p className="mb-2.5 text-[13px] text-[#78716c]">{text}</p>
      {onNew === undefined ? null : (
        <button type="button" data-plan-empty-new="" onClick={onNew} className={BTN_PRIMARY}>
          <PlusIcon />
          新建便签
        </button>
      )}
    </div>
  );
}

/**
 * 便签墙主体：工具条（搜索 / 新建便签 —— 排序已下架）+ 左侧分类栏（全部便签 / 已完成 / 各分类）+「问候 + 标题 + 计数」头部 + 便签网格；
 * 点卡片进编辑弹窗（PlanNoteEditor —— 便签底色整卡铺底 + 顶栏关闭 X / 7 色圆点 / 字体 Aa 分段器 + 大标题 / 记录区 + 分类胶囊 +
 * 底栏「更新于」+ 删除 + 完成 / 恢复 + 保存）。不做导出 / 导入（业务口径 2026-10-10「导出导入功能不要」）。
 */
export function MyPlanBoard() {
  const [board, setBoard] = useState<PlanBoard | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [doneOnly, setDoneOnly] = useState(false);
  /** 编辑弹窗：null = 关着；note null = 新建。 */
  const [editor, setEditor] = useState<{ note: PlanNote | null } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  /** 上云串行链：多笔提交按顺序落库（每笔都是整面便签墙，顺序错乱会互相覆盖）。 */
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  /**
   * 打开读面：GET 偏好 → 首次（账号里从未保存）预置示例上云；本机旧键（Push ≤ 267 的 localStorage）
   * 在账号没数据（或账号为空板而旧键有便签）时迁移上云再清键；迁移失败保留旧键、本机数据兜底展示、下轮打开重试。
   */
  useEffect(() => {
    let alive = true;
    setBoard(null);
    setLoadFailed(false);
    void (async () => {
      try {
        const prefs = await loadMyPreferences();
        if (!alive) {
          return;
        }
        const remote = prefs.myPlanBoard;
        const legacy = readLegacyPlanBoard();
        if (legacy !== null) {
          const shouldMigrate = remote.updatedAt === null || (remote.notes.length === 0 && legacy.notes.length > 0);
          if (shouldMigrate) {
            try {
              const saved = await saveMyPlanBoard(legacy);
              if (!alive) {
                return;
              }
              clearLegacyPlanBoard();
              setBoard({ notes: saved.myPlanBoard.notes, categories: saved.myPlanBoard.categories });
              return;
            } catch {
              if (!alive) {
                return;
              }
              setBoard(legacy);
              return;
            }
          }
          clearLegacyPlanBoard();
          setBoard({ notes: remote.notes, categories: remote.categories });
          return;
        }
        if (remote.updatedAt === null) {
          const seeded = seedPlanBoard();
          setBoard(seeded);
          try {
            await saveMyPlanBoard(seeded);
          } catch {
            // 预置上云失败静默：本次照常可用，之后任何一次保存都会把整面便签墙带上云
          }
          return;
        }
        setBoard({ notes: remote.notes, categories: remote.categories });
      } catch {
        if (alive) {
          setLoadFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  /** 乐观提交：先更新界面，再整面 PATCH 上云（串行）；失败保留界面改动 + 出错误提示。 */
  const commit = (next: PlanBoard, okText?: string): void => {
    setBoard(next);
    saveChain.current = saveChain.current
      .then(() => saveMyPlanBoard(next))
      .then(() => {
        if (okText !== undefined) {
          setNotice({ kind: "ok", text: okText });
        }
      })
      .catch(() => {
        setNotice({ kind: "error", text: "保存失败（网络或服务不可用）—— 改动只在本页，刷新会回滚到账号里最后一次保存。" });
      });
  };

  const handleSaveNote = (draft: PlanNoteDraft): void => {
    if (editor === null || board === null) {
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
      const note: PlanNote = { id: newPlanNoteId(), title: draft.title, content: draft.content, category: draft.category, colorId: draft.colorId, fontId: draft.fontId, done: false, createdAt: now, updatedAt: now };
      commit({ notes: [note].concat(board.notes), categories: board.categories });
      if (doneOnly) {
        setDoneOnly(false);
      }
    } else {
      const notes = board.notes.map((item) => (item.id === existing.id ? { ...item, ...draft, updatedAt: now } : item));
      commit({ notes, categories: board.categories });
    }
    setEditor(null);
  };

  const handleDeleteNote = (): void => {
    if (editor === null || editor.note === null || board === null) {
      return;
    }
    const target = editor.note;
    commit({ notes: board.notes.filter((item) => item.id !== target.id), categories: board.categories }, "已删除便签。");
    setEditor(null);
  };

  /** 完成 / 恢复（Push 268）：编辑弹窗底栏按钮 —— 连同当前草稿一起落一次（草稿为空时保留原内容）。 */
  const handleToggleDone = (draft: { title: string; content: string } | null): void => {
    if (editor === null || editor.note === null || board === null) {
      return;
    }
    const target = editor.note;
    const now = new Date().toISOString();
    const notes = board.notes.map((item) =>
      item.id === target.id ? { ...item, ...(draft ?? {}), done: !target.done, updatedAt: now } : item,
    );
    commit({ notes, categories: board.categories }, target.done ? "已恢复为未完成便签。" : "已完成，收进「已完成」。");
    setEditor(null);
  };

  const handleAddCategory = (name: string): void => {
    if (board === null) {
      return;
    }
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
    if (name === "" || board === null) {
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

  if (board === null) {
    return (
      <section
        data-workspace-plan=""
        className="-mx-6 -mb-10 -mt-5 min-h-[calc(100dvh-8rem)] bg-white px-6 pb-10 pt-6"
      >
        <div className="mx-auto w-full max-w-[1240px]">
          {loadFailed ? (
            <div data-plan-load-failed="" className="rounded-[18px] border border-dashed border-[#e8e3da] bg-white px-6 py-12 text-center">
              <p className="text-sm text-[#57534e]">便签加载失败。</p>
              <p className="mt-1.5 text-xs text-[#a8a29e]">请检查网络后重试；持续失败请联系运维排查接口 GET /api/v1/users/me/preferences。</p>
              <button
                type="button"
                data-plan-load-retry=""
                onClick={() => {
                  setReloadToken((token) => token + 1);
                }}
                className={BTN_PRIMARY + " mt-4"}
              >
                重新加载
              </button>
            </div>
          ) : (
            <div data-plan-loading="" className="flex justify-center py-[120px]">
              <Loader />
            </div>
          )}
        </div>
      </section>
    );
  }

  const visible = orderPlanNotes(filterPlanNotes(board.notes.filter((note) => note.done === doneOnly), keyword, doneOnly ? null : category));
  const activeCount = board.notes.filter((note) => !note.done).length;
  const doneCount = board.notes.filter((note) => note.done).length;
  const heading = doneOnly ? "已完成" : category === null ? "全部便签" : category;

  return (
    <section
      data-workspace-plan=""
      className="-mx-6 -mb-10 -mt-5 min-h-[calc(100dvh-8rem)] bg-white px-6 pb-10 pt-6"
    >
      <div className="mx-auto w-full max-w-[1240px]">
        <div className="flex flex-wrap items-center gap-3">
          <BoardSearch value={keyword} onChange={setKeyword} />
          <span className="ml-auto flex items-center gap-2">
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
              count={activeCount}
              active={!doneOnly && category === null}
              onClick={() => {
                setDoneOnly(false);
                setCategory(null);
              }}
            />
            <CategoryItem
              value="done"
              label="已完成"
              icon={<CheckCircleIcon />}
              count={doneCount}
              active={doneOnly}
              onClick={() => {
                setDoneOnly(true);
                setCategory(null);
              }}
            />
            {board.categories.map((item) => (
              <CategoryItem
                key={item}
                value={item}
                label={item}
                icon={<TagIcon />}
                count={board.notes.filter((note) => !note.done && note.category === item).length}
                active={!doneOnly && category === item}
                onClick={() => {
                  setDoneOnly(false);
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
              <p>数据保存在账号里（换设备可见）</p>
              <p data-plan-count="">{"共 " + String(activeCount) + " 条便签"}</p>
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
            ) : doneOnly && doneCount === 0 ? (
              <BoardEmpty title="还没有已完成的便签" text="把做完的便签点开、按「完成」，它就会收进这里。" />
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
          onToggleDone={handleToggleDone}
          onAddCategory={handleAddCategory}
          onClose={() => {
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}
