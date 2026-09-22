import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { Card } from "./components/Card";
import { CategoryFilterSidebar } from "./components/CategoryFilterSidebar";
import { CategorySwitch } from "./components/CategorySwitch";
import type { DateRange } from "./components/DateRangePicker";
import { ProjectModal, type ProjectDraft } from "./components/ProjectModal";
import { SearchInput } from "./components/SearchInput";
import { managerNames } from "./data/managers";
import { readStoredSidebarOpen, saveFiltersPref, saveSidebarPref } from "./homePrefs";
import {
  newSavedFilterId,
  matchesCriteria,
  persistSavedFilters,
  readSavedFilters,
  sameCriteria,
} from "./savedFilters";
import type { FilterCriteria, SavedFilter } from "./savedFilters";
import { buildListHash, EMPTY_LIST_QUERY, hasListFilters, initialRouteRestored, openProject, replaceListQuery, useHashRoute } from "./useHashRoute";
import type { ListQueryState } from "./useHashRoute";
import { PROJECT_TYPES } from "./types";
import type { MeResponse, Project } from "./types";

type HomeProps = {
  me: MeResponse;
  projects: Project[];
  onCreate: (draft: ProjectDraft) => void;
  onEdit: (project: Project) => void;
};

export default function Home({ me, projects, onCreate, onEdit }: HomeProps) {
  const expiresText = me.expiresAt === null ? "—" : new Date(me.expiresAt * 1000).toLocaleString("zh-CN");

  const route = useHashRoute();
  const filters = route.kind === "list" ? route.filters : EMPTY_LIST_QUERY;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // 常用筛选（Push 138）：本地记忆的组合，点一下套用到当前筛选；「哪组正在生效」由条件比较派生，不另存状态
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => readSavedFilters());
  // 侧边栏开合：URL 带参数的入口保持「有筛选自动展开」（既定行为）；无参数的书签入口完全按本地记忆恢复
  const [filterOpen, setFilterOpen] = useState(() => {
    if (initialRouteRestored()) {
      const storedOpen = readStoredSidebarOpen();
      return storedOpen === null ? hasListFilters(filters) : storedOpen;
    }
    return hasListFilters(filters) || readStoredSidebarOpen() === true;
  });
  const knownRegions = useMemo(() => new Set(projects.map((project) => project.region)), [projects]);
  const knownManagerIds = useMemo(() => new Set(projects.flatMap((project) => project.managerIds)), [projects]);
  // 链接里可能带着当前数据不存在的取值（分享过期 / 手改地址）：先丢弃，再由下面的 effect 归一化地址栏
  const activeFilters = useMemo(() => {
    const regions = filters.regions.filter((region) => knownRegions.has(region));
    const managerIds = filters.managerIds.filter((managerId) => knownManagerIds.has(managerId));
    const projectTypes = filters.projectTypes.filter((projectType) => (PROJECT_TYPES as readonly string[]).includes(projectType));
    if (
      regions.length === filters.regions.length &&
      managerIds.length === filters.managerIds.length &&
      projectTypes.length === filters.projectTypes.length
    ) {
      return filters;
    }
    return { ...filters, regions, managerIds, projectTypes };
  }, [filters, knownManagerIds, knownRegions]);
  useEffect(() => {
    if (buildListHash(activeFilters) !== buildListHash(filters)) {
      replaceListQuery(activeFilters);
    }
  }, [activeFilters, filters]);

  const updateFilters = (patch: Partial<ListQueryState>) => {
    const next = { ...activeFilters, ...patch };
    replaceListQuery(next);
    // 用户主动操作（勾选 / 时间区间 / 排序 / 搜索）：更新本地记忆，作为不带参数入口的恢复依据（关键字不写入）
    saveFiltersPref(next);
  };
  const query = activeFilters.q;
  const keyword = query.trim().toLowerCase();
  const hasFilters = hasListFilters(activeFilters);
  const sortDesc = activeFilters.sortDesc;
  const dateRange: DateRange | null =
    activeFilters.timeFrom !== null && activeFilters.timeTo !== null
      ? { from: activeFilters.timeFrom, to: activeFilters.timeTo }
      : null;
  const filtered = useMemo(() => {
    const matched = projects.filter((project) => {
      // 分类条件（地区 / 项目类型 / 项目经理任一命中 / 项目时间闭区间）与「常用筛选」共用同一判定（savedFilters.ts），两边口径不会漂
      if (!matchesCriteria(project, activeFilters)) {
        return false;
      }
      if (keyword === "") {
        return true;
      }
      return [String(project.seqNo), String(project.seqNo).padStart(2, "0"), project.code, project.description, project.region, project.projectType, project.id, project.createdAt, project.updatedAt, managerNames(project.managerIds)].some((field) =>
        field.toLowerCase().includes(keyword),
      );
    });
    const ordered = matched.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0));
    return sortDesc ? ordered : ordered.reverse();
  }, [activeFilters, keyword, projects, sortDesc]);
  const resetFilters = () => {
    updateFilters({ regions: [], projectTypes: [], managerIds: [], timeFrom: null, timeTo: null });
  };
  // 正在生效的常用筛选：条件与某一组等价即高亮（排序 / 关键字不影响判定）
  const appliedSavedFilterId = useMemo(() => {
    if (!hasFilters) {
      return null;
    }
    const matched = savedFilters.find((filter) => sameCriteria(filter, activeFilters));
    return matched === undefined ? null : matched.id;
  }, [activeFilters, hasFilters, savedFilters]);
  const applySavedFilter = (filter: SavedFilter) => {
    updateFilters({
      regions: filter.regions.slice(),
      projectTypes: filter.projectTypes.slice(),
      managerIds: filter.managerIds.slice(),
      timeFrom: filter.timeFrom,
      timeTo: filter.timeTo,
    });
  };
  const deleteSavedFilter = (id: string) => {
    const next = savedFilters.filter((item) => item.id !== id);
    setSavedFilters(next);
    persistSavedFilters(next);
  };
  const saveSavedFilter = ({ id, name, criteria }: { id: string | null; name: string; criteria: FilterCriteria }) => {
    // 保存前按当前数据兜底：丢弃已不存在的地区 / 类型 / 经理（与 URL 参数归一化同一收敛口径）
    const normalized: FilterCriteria = {
      regions: criteria.regions.filter((region) => knownRegions.has(region)),
      projectTypes: criteria.projectTypes.filter((projectType) => (PROJECT_TYPES as readonly string[]).includes(projectType)),
      managerIds: criteria.managerIds.filter((managerId) => knownManagerIds.has(managerId)),
      timeFrom: criteria.timeFrom,
      timeTo: criteria.timeTo,
    };
    const next =
      id === null
        ? [...savedFilters, { id: newSavedFilterId(), name, ...normalized }]
        : savedFilters.map((item) => (item.id === id ? { ...item, name, ...normalized } : item));
    setSavedFilters(next);
    persistSavedFilters(next);
    // 保存即应用（刚定义的一组就是要看的那组）；当前筛选保留的部分以这组为准整体替换
    updateFilters({
      regions: normalized.regions,
      projectTypes: normalized.projectTypes,
      managerIds: normalized.managerIds,
      timeFrom: normalized.timeFrom,
      timeTo: normalized.timeTo,
    });
  };
  const toggleValue = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="min-h-screen">
      <AppHeader me={me} title="项目空间" />

      <CategoryFilterSidebar
        open={filterOpen}
        projects={projects}
        selectedRegions={activeFilters.regions}
        selectedManagerIds={activeFilters.managerIds}
        selectedTypes={activeFilters.projectTypes}
        dateRange={dateRange}
        savedFilters={savedFilters}
        appliedSavedFilterId={appliedSavedFilterId}
        onApplySavedFilter={applySavedFilter}
        onDeleteSavedFilter={deleteSavedFilter}
        onSaveSavedFilter={saveSavedFilter}
        onToggleRegion={(region) => {
          updateFilters({ regions: toggleValue(activeFilters.regions, region) });
        }}
        onToggleManager={(managerId) => {
          updateFilters({ managerIds: toggleValue(activeFilters.managerIds, managerId) });
        }}
        onToggleType={(projectType) => {
          updateFilters({ projectTypes: toggleValue(activeFilters.projectTypes, projectType) });
        }}
        onDateRangeChange={(range) => {
          updateFilters({
            timeFrom: range === null ? null : range.from,
            timeTo: range === null ? null : range.to,
          });
        }}
        onReset={resetFilters}
        onClose={() => {
          setFilterOpen(false);
          saveSidebarPref(false);
        }}
      />

      <main className={"@container w-full pt-0 pb-10 pr-6 pl-6 transition-[padding-left] duration-300 ease-out " + (filterOpen ? "md:pl-[304px]" : "")}>
        <div className="sticky top-16 z-10 -mx-6 mb-6 flex flex-wrap items-center gap-3 bg-[#f5f6f8] px-6 pt-4 pb-2">
          <CategorySwitch
            checked={filterOpen}
            onChange={(next) => {
              setFilterOpen(next);
              saveSidebarPref(next);
            }}
          />
          <div
            role="group"
            aria-label="按项目时间排序"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 text-xs"
          >
            <span className="px-1 text-[10px] font-semibold tracking-[0.18em] text-zinc-400 select-none" aria-hidden="true">
              TIME
            </span>
            <span className="h-3.5 w-px bg-zinc-200" aria-hidden="true" />
            <button
              type="button"
              aria-pressed={sortDesc}
              aria-label="按项目时间降序排列"
              title="按项目时间降序排列（最近活动在前）"
              onClick={() => {
                updateFilters({ sortDesc: true });
              }}
              className={
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition " +
                (sortDesc ? "bg-zinc-900 font-medium text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700")
              }
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M12 5v14M12 19l-5-5M12 19l5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              降序
            </button>
            <button
              type="button"
              aria-pressed={!sortDesc}
              aria-label="按项目时间升序排列"
              title="按项目时间升序排列（最早活动在前）"
              onClick={() => {
                updateFilters({ sortDesc: false });
              }}
              className={
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition " +
                (sortDesc ? "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700" : "bg-zinc-900 font-medium text-white")
              }
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M12 19V5M12 5l-5 5M12 5l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              升序
            </button>
          </div>
          <span className="text-sm text-zinc-400">
            {keyword === "" && !hasFilters ? "共 " + projects.length + " 个项目" : "找到 " + filtered.length + " 个项目"}
          </span>
          <div className="ml-auto flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#feca04] px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm transition hover:brightness-95 active:brightness-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              新建项目
            </button>
            <SearchInput
              value={query}
              onChange={(value) => {
                updateFilters({ q: value });
              }}
              placeholder="搜索名称、国家、时间或项目经理"
              className="w-full sm:w-72"
            />
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">
              {keyword === "" ? "没有符合筛选条件的项目" : "没有匹配「" + query.trim() + "」的项目"}
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              {keyword !== "" && (
                <button
                  type="button"
                  onClick={() => {
                    updateFilters({ q: "" });
                  }}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  清空搜索
                </button>
              )}
              {hasFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  清空筛选
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 @md:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
          {filtered.map((project) => (
            <div
              key={project.id}
              role="link"
              tabIndex={0}
              aria-label={"打开项目 " + project.code}
              onClick={() => openProject(project.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openProject(project.id);
                }
              }}
              className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              <Card
                seqNo={project.seqNo}
                code={project.code}
                description={project.description}
                accent={project.accent}
                projectType={project.projectType}
                managerNames={managerNames(project.managerIds)}
                time={project.createdAt}
                onEdit={() => {
                  onEdit(project);
                }}
              />
            </div>
          ))}
        </div>

        <details className="mt-12 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
          <summary className="cursor-pointer text-zinc-500">令牌声明（id_token，已通过 JWKS 验签）</summary>
          <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(me.claims, null, 2)}</pre>
          <p className="mt-3 text-xs text-zinc-400">令牌到期时间：{expiresText}</p>
        </details>
      </main>

      {isCreateOpen && (
        <ProjectModal
          mode="create"
          onClose={() => setIsCreateOpen(false)}
          onSubmit={(draft) => {
            onCreate(draft);
            setIsCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}
