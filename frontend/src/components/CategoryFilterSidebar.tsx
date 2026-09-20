import { useEffect } from "react";
import { ScrollArea } from "./ScrollArea";
import { DateRangePicker } from "./DateRangePicker";
import type { DateRange } from "./DateRangePicker";
import { managerName } from "../data/managers";
import { PROJECT_TYPES } from "../types";
import type { Project } from "../types";

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
              <DateRangePicker value={dateRange} onChange={onDateRangeChange} hintDate={newestDay} triggerClassName={GLASS_SURFACE} />
            </div>
          </section>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-zinc-200/70 px-5 py-3">
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
