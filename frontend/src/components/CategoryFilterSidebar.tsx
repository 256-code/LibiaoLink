import { useEffect } from "react";
import { ScrollArea } from "./ScrollArea";
import { DateRangePicker } from "./DateRangePicker";
import type { DateRange } from "./DateRangePicker";
import { managerName } from "../data/managers";
import { PROJECT_TYPES } from "../types";
import type { Project } from "../types";

type CategoryFilterSidebarProps = {
  open: boolean;
  projects: Project[];
  selectedRegions: string[];
  selectedManagerIds: string[];
  selectedTypes: string[];
  dateRange: DateRange | null;
  onToggleRegion: (region: string) => void;
  onToggleManager: (managerId: string) => void;
  onToggleType: (projectType: string) => void;
  onDateRangeChange: (range: DateRange | null) => void;
  onReset: () => void;
  onClose: () => void;
};

function countBy(items: string[]): Array<{ value: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return Array.from(map, ([value, count]) => ({ value, count }));
}

export function CategoryFilterSidebar({
  open,
  projects,
  selectedRegions,
  selectedManagerIds,
  selectedTypes,
  dateRange,
  onToggleRegion,
  onToggleManager,
  onToggleType,
  onDateRangeChange,
  onReset,
  onClose,
}: CategoryFilterSidebarProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  const regions = countBy(projects.map((project) => project.region));
  const managers = countBy(projects.map((project) => project.managerId)).map((option) => ({
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
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50")
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
          " fixed bottom-0 left-0 top-16 z-20 flex w-[280px] flex-col border-r border-zinc-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-out"
        }
      >
        <div className="flex items-start justify-between border-b border-zinc-100 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900">分类筛选</p>
            <p className="mt-0.5 text-xs text-zinc-400">按地区、项目类型、项目经理、项目时间筛选项目</p>
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
            <p className="text-sm font-semibold tracking-wide text-zinc-700">地区</p>
            {renderChips(regions, selectedRegions, onToggleRegion)}
          </section>
          <section>
            <p className="text-sm font-semibold tracking-wide text-zinc-700">项目类型</p>
            {renderChips(types, selectedTypes, onToggleType)}
          </section>
          <section>
            <p className="text-sm font-semibold tracking-wide text-zinc-700">项目经理</p>
            {renderChips(managers, selectedManagerIds, onToggleManager)}
          </section>
          <section>
            <p className="text-sm font-semibold tracking-wide text-zinc-700">项目时间</p>
            <div className="mt-3">
              <DateRangePicker value={dateRange} onChange={onDateRangeChange} hintDate={newestDay} />
            </div>
          </section>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
          <span className="text-xs text-zinc-400">{activeCount === 0 ? "未选择筛选条件" : "已选 " + activeCount + " 项"}</span>
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
