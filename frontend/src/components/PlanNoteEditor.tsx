import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "../scrollLock";
import { ScrollArea } from "./ScrollArea";
import { useFocusTrapFor } from "./useFocusTrap";
import {
  PLAN_CATEGORY_MAX,
  PLAN_CATEGORY_NAME_MAX,
  PLAN_COLORS,
  PLAN_CONTENT_MAX,
  PLAN_FONTS,
  PLAN_TITLE_MAX,
  normalizePlanCategoryName,
  normalizePlanContent,
  normalizePlanTitle,
  planColorOf,
  type PlanColorId,
  type PlanFontId,
  type PlanNote,
} from "../myPlan";

/** 编辑结果（保存时回传；规范化在保存前完成）。 */
export type PlanNoteDraft = {
  title: string;
  content: string;
  category: string;
  colorId: PlanColorId;
  fontId: PlanFontId;
};

/**
 * 便签编辑弹窗（形态照参考页 MiniMemo 的 NoteEditor，交互按系统弹窗口径收口；Push 266 起弹窗底色 / 取色圆点走同一套 hex 调色板）：
 * 标题 / 内容 + 分类（chips，可加新类）+ 颜色（7 色圆点）+ 字体（简约 / 优雅 / 等宽）；
 * 底部 = 删除（二次确认，仅既有便签）+ 取消 / 保存。Esc / 点遮罩 / 取消 = 放弃本次改动（与新建项目弹窗同口径）。
 * 弹窗带键盘焦点陷阱（useFocusTrapFor）与背景滚动锁（lockBodyScroll），Tab 不游走到便签墙。
 */
export function PlanNoteEditor({
  note,
  categories,
  onSave,
  onDelete,
  onAddCategory,
  onClose,
}: {
  /** null = 新建。 */
  note: PlanNote | null;
  categories: readonly string[];
  onSave: (draft: PlanNoteDraft) => void;
  onDelete: () => void;
  onAddCategory: (name: string) => void;
  onClose: () => void;
}) {
  const isEdit = note !== null;
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [category, setCategory] = useState(note?.category ?? categories[0]);
  const [colorId, setColorId] = useState<PlanColorId>(note?.colorId ?? "white");
  const [fontId, setFontId] = useState<PlanFontId>(note?.fontId ?? "sans");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrapFor(dialogRef);
  useEffect(() => lockBodyScroll(), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const color = planColorOf(colorId);
  const canSave = title.trim() !== "" || content.trim() !== "";
  const handleSave = () => {
    if (!canSave) {
      return;
    }
    onSave({
      title: normalizePlanTitle(title),
      content: normalizePlanContent(content),
      category,
      colorId,
      fontId,
    });
  };

  /** 新建分类：回车 / 失焦提交（空 = 放弃）；已在表里 = 直接选中；到 12 类上限 = 不加也不选。 */
  const commitNewCategory = () => {
    const name = normalizePlanCategoryName(newCategory);
    setAddingCategory(false);
    setNewCategory("");
    if (name === "") {
      return;
    }
    if (categories.includes(name)) {
      setCategory(name);
      return;
    }
    if (categories.length >= PLAN_CATEGORY_MAX) {
      return;
    }
    onAddCategory(name);
    setCategory(name);
  };

  return createPortal(
    <div
      ref={overlayRef}
      data-plan-editor=""
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "编辑便签" : "新建便签"}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/40 p-4"
    >
      <div
        ref={dialogRef}
        onClick={(event) => {
          event.stopPropagation();
        }}
        style={{ backgroundColor: color.bg, borderColor: color.border }}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col rounded-2xl border shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
      >
        <header className="shrink-0 border-b border-black/5 px-6 pb-3 pt-5">
          <h2 className="text-lg font-bold text-zinc-900">{isEdit ? "编辑便签" : "新建便签"}</h2>
          <p className="mt-1 text-sm text-zinc-600">{isEdit ? "改完点「保存」，便签墙立即更新。" : "标题和内容至少填一项才能保存；便签保存在本机浏览器。"}</p>
        </header>

        <ScrollArea ariaLabel="便签编辑表单" viewportClassName="min-h-0 flex-1" className="space-y-4 px-6 py-4" thumbAlwaysVisible>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">标题</span>
            <input
              data-plan-editor-title=""
              value={title}
              maxLength={PLAN_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="如 本周重点"
              className="block w-full appearance-none rounded-lg border border-zinc-300 bg-white/85 px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">内容</span>
            <textarea
              data-plan-editor-content=""
              value={content}
              maxLength={PLAN_CONTENT_MAX}
              onChange={(event) => setContent(event.target.value)}
              rows={8}
              placeholder="一行一条，回车换行"
              className="block min-h-[176px] w-full resize-none appearance-none rounded-lg border border-zinc-300 bg-white/85 px-3 py-2 text-sm leading-relaxed text-zinc-900 shadow-xs outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">
              分类<span className="ml-1 text-xs font-normal text-zinc-500">可加新类（最多 {PLAN_CATEGORY_MAX} 类）</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  data-plan-editor-category={item}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-medium transition " +
                    (category === item
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white/70 text-zinc-600 hover:border-zinc-400")
                  }
                >
                  {item}
                </button>
              ))}
              {addingCategory ? (
                <input
                  autoFocus
                  data-plan-editor-category-new=""
                  value={newCategory}
                  maxLength={PLAN_CATEGORY_NAME_MAX}
                  onChange={(event) => setNewCategory(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitNewCategory();
                    }
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setAddingCategory(false);
                      setNewCategory("");
                    }
                  }}
                  onBlur={commitNewCategory}
                  placeholder="新分类名"
                  className="w-24 rounded-full border border-zinc-900 bg-white px-3 py-1 text-xs font-medium text-zinc-900 outline-none"
                />
              ) : (
                <button
                  type="button"
                  data-plan-editor-category-add=""
                  disabled={categories.length >= PLAN_CATEGORY_MAX}
                  title={categories.length >= PLAN_CATEGORY_MAX ? "最多 " + String(PLAN_CATEGORY_MAX) + " 个分类" : "添加新分类"}
                  onClick={() => setAddingCategory(true)}
                  className="flex items-center gap-1 rounded-full border border-dashed border-zinc-400 bg-white/50 px-3 py-1 text-xs font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ＋ 新分类
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-zinc-700">颜色</span>
              <div className="flex flex-wrap items-center gap-2">
                {PLAN_COLORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-plan-color={item.id}
                    aria-label={"颜色 " + item.label}
                    aria-pressed={colorId === item.id}
                    onClick={() => setColorId(item.id)}
                    style={{ backgroundColor: item.swatch }}
                    className={
                      "flex h-7 w-7 items-center justify-center rounded-full border transition " +
                      (colorId === item.id ? "border-zinc-900 ring-2 ring-zinc-900/25" : "border-black/10 hover:border-zinc-400")
                    }
                  >
                    {colorId === item.id ? (
                      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-zinc-700" aria-hidden="true">
                        <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-zinc-700">字体</span>
              <div className="flex items-start gap-2">
                {PLAN_FONTS.map((item) => (
                  <span key={item.id} className="flex flex-col items-center">
                    <button
                      type="button"
                      data-plan-font={item.id}
                      aria-label={"字体 " + item.label}
                      aria-pressed={fontId === item.id}
                      title={item.hint}
                      onClick={() => setFontId(item.id)}
                      className={
                        "flex h-9 w-12 items-center justify-center rounded-lg border text-base transition " +
                        item.className +
                        " " +
                        (fontId === item.id
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-300 bg-white/70 text-zinc-700 hover:border-zinc-400")
                      }
                    >
                      Aa
                    </button>
                    <span className="mt-1 text-[10px] text-zinc-500">{item.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-black/5 px-6 py-4">
          {isEdit ? (
            confirmingDelete ? (
              <span data-plan-editor-delete-confirm="" className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-rose-600">删除这条便签？</span>
                <button
                  type="button"
                  data-plan-editor-delete-do=""
                  onClick={onDelete}
                  className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-rose-600"
                >
                  确认删除
                </button>
                <button
                  type="button"
                  data-plan-editor-delete-cancel=""
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                data-plan-editor-delete=""
                onClick={() => setConfirmingDelete(true)}
                className="rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-rose-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              >
                删除
              </button>
            )
          ) : (
            <span className="text-xs text-zinc-500">新建的便签还没有保存</span>
          )}
          <span className="flex items-center gap-3">
            <button
              type="button"
              data-plan-editor-cancel=""
              onClick={onClose}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              取消
            </button>
            <button
              type="button"
              data-plan-editor-save=""
              disabled={!canSave}
              onClick={handleSave}
              className="rounded-lg bg-[#1c1917] px-4 py-2 text-sm font-medium text-[#fdfbf7] shadow-sm transition hover:bg-[#292524] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEdit ? "保存修改" : "保存便签"}
            </button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
