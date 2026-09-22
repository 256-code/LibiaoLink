import { useEffect, useState } from "react";
import { ScrollArea } from "./ScrollArea";
import { DateRangePicker } from "./DateRangePicker";
import type { DateRange } from "./DateRangePicker";
import { managerName } from "../data/managers";
import { PROJECT_TYPES } from "../types";
import type { Project } from "../types";
import {
  SAVED_FILTER_LIMIT,
  SAVED_FILTER_NAME_MAX,
  countMatches,
  criteriaOf,
  emptyCriteria,
  hasCriteria,
  normalizeFilterName,
} from "../savedFilters";
import type { FilterCriteria, SavedFilter } from "../savedFilters";

/** 「液态玻璃」材质（与任务表行内编辑单元格同口径，Push 66 / 67 定稿）：白底 + 发丝描边 + 顶部内高光 + 极轻投影。 */
const GLASS_SURFACE =
  "border-zinc-200/90 bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-[3px] hover:border-zinc-300 hover:bg-white hover:shadow-[0_2px_6px_rgba(15,23,42,0.08)]";

/** 侧栏玻璃底板（液态玻璃，与页面浮层同口径）：半透明白渐变 + 白色发丝边 + 顶缘高光 + 柔和投影 + 背景虚化。 */
const GLASS_PANEL =
  "border-r border-white/80 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.72),rgba(255,255,255,0.5))] " +
  "shadow-[inset_1px_0_0_rgba(255,255,255,0.75),0_8px_32px_rgba(15,23,42,0.14)] backdrop-blur-2xl backdrop-saturate-150";

type CategoryFilterSidebarProps = {
  open: boolean;
  projects: Project[];
  selectedRegions: string[];
  selectedManagerIds: string[];
  selectedTypes: string[];
  dateRange: DateRange | null;
  savedFilters: SavedFilter[];
  appliedSavedFilterId: string | null;
  onToggleRegion: (region: string) => void;
  onToggleManager: (managerId: string) => void;
  onToggleType: (projectType: string) => void;
  onDateRangeChange: (range: DateRange | null) => void;
  onApplySavedFilter: (filter: SavedFilter) => void;
  onDeleteSavedFilter: (id: string) => void;
  onSaveSavedFilter: (input: { id: string | null; name: string; criteria: FilterCriteria }) => void;
  onReset: () => void;
  onClose: () => void;
};

/** 添加 / 编辑常用筛选的编辑态（id = null 为新建）。 */
type ComposeState = {
  id: string | null;
  name: string;
  criteria: FilterCriteria;
};

function countBy(items: string[]): Array<{ value: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return Array.from(map, ([value, count]) => ({ value, count }));
}

function criteriaCount(criteria: FilterCriteria): number {
  return (
    criteria.regions.length +
    criteria.projectTypes.length +
    criteria.managerIds.length +
    (criteria.timeFrom !== null && criteria.timeTo !== null ? 1 : 0)
  );
}

export function CategoryFilterSidebar({
  open,
  projects,
  selectedRegions,
  selectedManagerIds,
  selectedTypes,
  dateRange,
  savedFilters,
  appliedSavedFilterId,
  onToggleRegion,
  onToggleManager,
  onToggleType,
  onDateRangeChange,
  onApplySavedFilter,
  onDeleteSavedFilter,
  onSaveSavedFilter,
  onReset,
  onClose,
}: CategoryFilterSidebarProps) {
  // 「添加」后的编辑态：勾选落在草稿上（不动当前筛选），保存 = 入库 + 立即生效（见《前端功能需求》§一.3）
  const [compose, setCompose] = useState<ComposeState | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (compose !== null) {
        setCompose(null);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, compose]);

  // 关面板即退出编辑态（下次打开是干净的浏览态）
  useEffect(() => {
    if (!open) {
      setCompose(null);
    }
  }, [open]);

  const regions = countBy(projects.map((project) => project.region));
  // 项目经理计数（Push 136）：一个项目挂多位经理时，每位经理各计一次（计数 = 该项目里有他）
  const managers = countBy(projects.flatMap((project) => project.managerIds)).map((option) => ({
    ...option,
    label: managerName(option.value),
  }));
  const types = PROJECT_TYPES.map((type) => ({
    value: type,
    count: projects.filter((project) => project.projectType === type).length,
  })).filter((option) => option.count > 0);
  const newestDay = projects.reduce(
    (latest, project) => (project.updatedAt > latest ? project.updatedAt : latest),
    "",
  ).slice(0, 10);

  const activeCount =
    selectedRegions.length + selectedManagerIds.length + selectedTypes.length + (dateRange === null ? 0 : 1);

  // 编辑态下四组胶囊改「勾选到草稿」；非编辑态维持原有「点一下改当前筛选」
  const regionSelection = compose === null ? selectedRegions : compose.criteria.regions;
  const managerSelection = compose === null ? selectedManagerIds : compose.criteria.managerIds;
  const typeSelection = compose === null ? selectedTypes : compose.criteria.projectTypes;
  const rangeSelection: DateRange | null =
    compose === null
      ? dateRange
      : compose.criteria.timeFrom !== null && compose.criteria.timeTo !== null
        ? { from: compose.criteria.timeFrom, to: compose.criteria.timeTo }
        : null;

  const toggleValue = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const patchDraft = (patch: Partial<FilterCriteria>) => {
    setCompose((current) => (current === null ? current : { ...current, criteria: { ...current.criteria, ...patch } }));
  };
  const handleToggleRegion = (region: string) => {
    if (compose === null) {
      onToggleRegion(region);
      return;
    }
    patchDraft({ regions: toggleValue(compose.criteria.regions, region) });
  };
  const handleToggleManager = (managerId: string) => {
    if (compose === null) {
      onToggleManager(managerId);
      return;
    }
    patchDraft({ managerIds: toggleValue(compose.criteria.managerIds, managerId) });
  };
  const handleToggleType = (projectType: string) => {
    if (compose === null) {
      onToggleType(projectType);
      return;
    }
    patchDraft({ projectTypes: toggleValue(compose.criteria.projectTypes, projectType) });
  };
  const handleDateRangeChange = (range: DateRange | null) => {
    if (compose === null) {
      onDateRangeChange(range);
      return;
    }
    patchDraft({ timeFrom: range === null ? null : range.from, timeTo: range === null ? null : range.to });
  };

  const draftCount = compose === null ? 0 : criteriaCount(compose.criteria);
  const canSave = compose !== null && normalizeFilterName(compose.name) !== "" && hasCriteria(compose.criteria);
  const canCompose = compose === null && savedFilters.length < SAVED_FILTER_LIMIT;
  const submitCompose = () => {
    if (compose === null || !canSave) {
      return;
    }
    onSaveSavedFilter({ id: compose.id, name: normalizeFilterName(compose.name), criteria: compose.criteria });
    setCompose(null);
  };

  const renderChips = (options: Array<{ value: string; count: number; label?: string }>, selected: string[], onToggle: (value: string) => void) => (
    <div className="mt-3 flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onToggle(option.value);
            }}
            className={
              "rounded-full border px-3 py-1 text-xs transition " +
              (isSelected
                ? "border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_8px_rgba(15,23,42,0.18)]"
                : GLASS_SURFACE + " text-zinc-600")
            }
          >
            {option.label ?? option.value}
            <span className={"ml-1 " + (isSelected ? "text-white/60" : "text-zinc-400")}>{option.count}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={
          (open ? "opacity-100" : "pointer-events-none opacity-0") +
          " fixed inset-x-0 bottom-0 top-16 z-20 bg-zinc-900/30 transition-opacity duration-300 md:hidden"
        }
      />
      <aside
        id="category-filter-panel"
        aria-label="分类筛选"
        className={
          (open ? "translate-x-0" : "-translate-x-full") +
          " fixed bottom-0 left-0 top-16 z-20 flex w-[280px] flex-col transition-transform duration-300 ease-out " + GLASS_PANEL
        }
      >
        <div className="flex items-start justify-between border-b border-zinc-200/70 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900">分类筛选</p>
            <p className="mt-0.5 text-xs text-zinc-400">按常看组合、地区、项目类型、项目经理、项目时间筛选项目</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭筛选"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <ScrollArea viewportClassName="min-h-0 flex-1" className="space-y-6 px-5 py-5" ariaLabel="筛选条件">
          <section>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold tracking-wide text-zinc-700">常用筛选</p>
              <button
                type="button"
                onClick={() => {
                  setCompose({ id: null, name: "", criteria: emptyCriteria() });
                }}
                disabled={!canCompose}
                title={
                  savedFilters.length >= SAVED_FILTER_LIMIT
                    ? "最多保存 " + SAVED_FILTER_LIMIT + " 组常用筛选"
                    : "把常看的分类勾成一组，命名保存"
                }
                className={
                  "rounded-lg px-2 py-1 text-xs font-medium transition " +
                  (canCompose ? "text-zinc-700 hover:bg-zinc-100" : "cursor-not-allowed text-zinc-300")
                }
              >
                + 添加
              </button>
            </div>

            {compose !== null && (
              <div className="mt-3 rounded-xl border border-amber-300/80 bg-amber-50/80 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <p className="text-xs font-semibold text-zinc-700">
                  {compose.id === null ? "新建常用筛选" : "编辑常用筛选"}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                  在下方分类里勾选多项（可跨组），名称可自定义；保存后即出现在「常用筛选」并立即生效。
                </p>
                <input
                  value={compose.name}
                  onChange={(event) => {
                    const value = event.target.value.slice(0, SAVED_FILTER_NAME_MAX);
                    setCompose((current) => (current === null ? current : { ...current, name: value }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitCompose();
                    }
                  }}
                  maxLength={SAVED_FILTER_NAME_MAX}
                  autoFocus
                  placeholder="筛选名称（自定义，如：我关注的项目）"
                  aria-label="常用筛选名称"
                  className="mt-2 w-full rounded-lg border border-zinc-200/90 bg-white/85 px-2.5 py-1.5 text-xs text-zinc-700 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                  <span className="text-[11px] text-zinc-500">
                    已选 {draftCount} 项
                    {!hasCriteria(compose.criteria) ? "（至少选 1 项）" : ""}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCompose(null);
                      }}
                      className="whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={submitCompose}
                      disabled={!canSave}
                      className={
                        "whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition " +
                        (canSave ? "bg-zinc-900 text-white hover:bg-zinc-700" : "cursor-not-allowed bg-zinc-200 text-zinc-400")
                      }
                    >
                      保存
                    </button>
                  </span>
                </div>
              </div>
            )}

            {savedFilters.length === 0 ? (
              compose === null ? (
                <p className="mt-3 text-xs leading-5 text-zinc-400">
                  还没有常用筛选 —— 点「添加」，勾选常看的分类、起个名字保存。
                </p>
              ) : null
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {savedFilters.map((filter) => {
                  const applied = filter.id === appliedSavedFilterId;
                  const count = countMatches(projects, filter);
                  return (
                    <span
                      key={filter.id}
                      className={
                        "group/chip inline-flex items-center overflow-hidden rounded-full border transition " +
                        (applied
                          ? "border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_8px_rgba(15,23,42,0.18)]"
                          : GLASS_SURFACE + " text-zinc-600")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onApplySavedFilter(filter);
                        }}
                        title={"应用「" + filter.name + "」（命中 " + count + " 个项目）"}
                        className="inline-flex max-w-[168px] items-center px-3 py-1 text-xs"
                      >
                        <span className="truncate">{filter.name}</span>
                        <span className={"ml-1 " + (applied ? "text-white/60" : "text-zinc-400")}>{count}</span>
                      </button>
                      <span
                        className={
                          "flex max-w-0 items-center overflow-hidden opacity-0 transition-all duration-200 " +
                          (applied ? "text-white/70" : "text-zinc-400") +
                          " group-hover/chip:max-w-[44px] group-hover/chip:opacity-100 group-focus-within/chip:max-w-[44px] group-focus-within/chip:opacity-100"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setCompose({ id: filter.id, name: filter.name, criteria: criteriaOf(filter) });
                          }}
                          aria-label={"编辑常用筛选 " + filter.name}
                          title="编辑 / 改名"
                          className={
                            "shrink-0 rounded-full py-0.5 pl-1.5 pr-0.5 transition " +
                            (applied ? "hover:text-white" : "hover:text-zinc-900")
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
                            <path d="M4 20h4L18 10l-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteSavedFilter(filter.id);
                          }}
                          aria-label={"删除常用筛选 " + filter.name}
                          title="删除"
                          className={
                            "shrink-0 rounded-full py-0.5 pl-0.5 pr-2 transition " +
                            (applied ? "hover:text-white" : "hover:text-zinc-900")
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </section>
          <section>
            <p className="text-sm font-semibold tracking-wide text-zinc-700">地区</p>
            {renderChips(regions, regionSelection, handleToggleRegion)}
          </section>
          <section>
            <p className="text-sm font-semibold tracking-wide text-zinc-700">项目类型</p>
            {renderChips(types, typeSelection, handleToggleType)}
          </section>
          <section>
            <p className="text-sm font-semibold tracking-wide text-zinc-700">项目经理</p>
            {renderChips(managers, managerSelection, handleToggleManager)}
          </section>
          <section>
            <p className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-zinc-700">
              项目时间
              <span
                role="img"
                tabIndex={0}
                aria-label="项目时间口径：项目最近活动时间——修改项目信息、推进阶段或变更任务时更新；上传文件、写日报不更新"
                title="项目最近活动时间：修改项目信息、推进阶段或变更任务时更新；上传文件、写日报不更新。"
                className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold tracking-normal text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                i
              </span>
            </p>
            <div className="mt-3">
              <DateRangePicker value={rangeSelection} onChange={handleDateRangeChange} hintDate={newestDay} triggerClassName={GLASS_SURFACE} />
            </div>
          </section>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-zinc-200/70 px-5 py-3">
          <span className="text-xs text-zinc-400">
            {compose === null
              ? activeCount === 0
                ? "未选择筛选条件"
                : "已选 " + activeCount + " 项"
              : "常用筛选编辑中：已勾选 " + draftCount + " 项"}
          </span>
          <button
            type="button"
            onClick={onReset}
            disabled={activeCount === 0}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-medium transition " +
              (activeCount === 0 ? "cursor-not-allowed text-zinc-300" : "text-zinc-700 hover:bg-zinc-100")
            }
          >
            重置
          </button>
        </div>
      </aside>
    </>
  );
}
