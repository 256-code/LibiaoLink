import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { REGION_NAME_MAX, type RegionTools } from "../regionTools";
import type { DictItem } from "../dicts";
import { OptionList } from "./SelectMenu";
import type { SelectOption } from "./SelectMenu";
import { usePopover } from "./usePopover";

type RegionSelectProps = {
  /** 当前地区值（字典码 / 自定义值）。 */
  value: string;
  /** 字典 region 项（GET /api/v1/dicts，已按 sort 升序）。 */
  regions: DictItem[];
  /** 「＋ 添加地区」的落地方式（写地区字典，全站共享），由 App 层实现。 */
  tools: RegionTools;
  onChange: (value: string) => void;
  ariaLabel: string;
};

/**
 * 地区下拉候选：字典项（按 sort 升序）→ 当前值兜底（存量值 / 已停用或他处自定义的值），按值去重。
 * 兜底项必须保留：编辑一个地区不在字典候选里的项目时，触发器仍要显示当前值（不能空白）。
 */
function buildRegionOptions(regions: DictItem[], value: string): SelectOption[] {
  const options: SelectOption[] = [];
  const seen = new Set<string>();
  const push = (code: string, name: string): void => {
    if (seen.has(code)) {
      return;
    }
    seen.add(code);
    options.push({ value: code, label: <span className="truncate">{name}</span> });
  };
  for (const item of regions) {
    push(item.code, item.name);
  }
  if (value !== "") {
    push(value, value);
  }
  return options;
}

/**
 * 项目地区下拉（Push 167；Push 168 按业务口径修订）：与任务域 SelectMenu 同一套自绘下拉（原实现是原生 select ——
 * 弹层样式由浏览器控制，与全站不一致），浮层贴弹窗右侧弹出；顶部固定一行「＋ 添加地区」。
 * 新增落点 = **地区字典**（C9-02 修订：任何登录用户都能加 —— 保存后全站可见、可在首页按它筛选；
 * 改名 / 排序 / 停用仍归管理员）。名称校验：非空、不超过 REGION_NAME_MAX 字、不含英文逗号
 * （filter[region] 是多值逗号分隔，逗号会被拆成两个筛选值）。
 */
export function RegionSelect({ value, regions, tools, onChange, ariaLabel }: RegionSelectProps) {
  const options = useMemo(() => buildRegionOptions(regions, value), [regions, value]);
  /** 浮层高度估算：选项最多按 8 行 + 顶部「添加地区」一行（超出部分列表内滚动）。 */
  const visibleRows = Math.min(options.length, 8);
  // 优先贴触发器右侧（Push 167）：地区列表长，落上下会压住弹窗里的其它字段；右侧放不下自动回落上下定位
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(280, visibleRows * 34 + 58, "right");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? null;

  /** 收起浮层并复位「添加」分支（关闭后不留残留输入 / 报错）。 */
  const close = (): void => {
    setOpen(false);
    setAdding(false);
    setDraft("");
    setError(null);
    setPending(false);
  };

  useEffect(() => {
    if (open && adding) {
      inputRef.current?.focus();
    }
  }, [open, adding]);

  const submitAdd = async (): Promise<void> => {
    const name = draft.trim();
    if (name === "") {
      setError("地区名称不能为空。");
      return;
    }
    if (name.length > REGION_NAME_MAX) {
      setError("地区名称最长 " + String(REGION_NAME_MAX) + " 个字。");
      return;
    }
    if (name.includes(",")) {
      setError("地区名称不能包含英文逗号。");
      return;
    }
    const existed = options.find((option) => option.value === name);
    if (existed !== undefined) {
      onChange(existed.value);
      close();
      return;
    }
    setPending(true);
    const result = await tools.onAdd(name);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChange(result.code);
    close();
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitAdd();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setAdding(false);
      setDraft("");
      setError(null);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
          }
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        {selected === null ? (
          <span className="truncate text-zinc-400">请选择地区</span>
        ) : (
          <span className="truncate font-medium text-zinc-800">{selected.label}</span>
        )}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-zinc-400">
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
              {adding ? (
                <div className="p-2">
                  <input
                    ref={inputRef}
                    value={draft}
                    aria-label="新地区名称"
                    placeholder="输入地区名称，如 东南亚"
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setError(null);
                    }}
                    onKeyDown={handleDraftKeyDown}
                    className="w-full rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-700 outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-1 focus:ring-zinc-300"
                  />
                  <p className="mt-1.5 text-[11px] text-zinc-400">
                    保存后写入地区字典（C9）：全站可选（所有项目的地区下拉都能选到），并可在首页按它筛选；改名 / 停用由管理员维护。
                  </p>
                  {error === null ? null : (
                    <p role="alert" className="mt-1 text-[11px] text-rose-600">
                      {error}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setDraft("");
                        setError(null);
                      }}
                      className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition hover:bg-zinc-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        void submitAdd();
                      }}
                      className="rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pending ? "添加中…" : "添加"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium text-blue-600 transition hover:bg-blue-50"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      添加地区
                    </button>
                  </div>
                  <div className="border-t border-zinc-100" />
                  <div className="max-h-[280px] overflow-y-auto">
                    <OptionList
                      options={options}
                      value={value}
                      ariaLabel={ariaLabel}
                      onPick={(next) => {
                        onChange(next);
                        close();
                      }}
                    />
                  </div>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
