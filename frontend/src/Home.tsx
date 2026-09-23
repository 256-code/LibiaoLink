import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "./api";
import type { RegionTools } from "./regionTools";
import { AppHeader } from "./components/AppHeader";
import { Card } from "./components/Card";
import { CategoryFilterSidebar } from "./components/CategoryFilterSidebar";
import type { FacetOption } from "./components/CategoryFilterSidebar";
import { CategorySwitch } from "./components/CategorySwitch";
import type { DateRange } from "./components/DateRangePicker";
import { ProjectModal, type ProjectDraft } from "./components/ProjectModal";
import { SearchInput } from "./components/SearchInput";
import { dictLabel, typeAccent, type Dicts } from "./dicts";
import { directoryMemberOptions, directoryName, type DirectoryUser } from "./directory";
import { readStoredSidebarOpen, saveFiltersPref, saveSidebarPref } from "./homePrefs";
import { EMPTY_FACETS, buildListQuery, fetchProjectFacets, fetchProjectList, toUiProject, type ProjectFacets } from "./projectApi";
import { newSavedFilterId, persistSavedFilters, readSavedFilters, sameCriteria } from "./savedFilters";
import type { FilterCriteria, SavedFilter } from "./savedFilters";
import { buildListHash, EMPTY_LIST_QUERY, hasListFilters, initialRouteRestored, openProject, replaceListQuery, useHashRoute } from "./useHashRoute";
import type { ListQueryState } from "./useHashRoute";
import { projectManagerText } from "./types";
import type { MeResponse, Project } from "./types";

type HomeProps = {
  me: MeResponse;
  /** 字典（地区 / 项目类型：下拉项与主题色）。 */
  dicts: Dicts;
  /** 用户目录（项目经理姓名与候选）。 */
  directory: DirectoryUser[];
  /** 地区下拉的「自定义」能力（写地区字典，全站共享），与编辑弹窗共用同一份。 */
  regionTools: RegionTools;
  /** 新建项目：返回 null = 成功（父层刷新列表）；返回文案 = 失败提示（弹窗保持打开）。 */
  onCreate: (draft: ProjectDraft) => Promise<string | null>;
  onEdit: (project: Project) => void;
  /** 服务端写操作后的刷新信号（父层 +1 → 列表与计数重新取数）。 */
  refreshToken: number;
};

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 计数 → 侧栏选项：字典顺序优先、未知码排后；已选但零命中的值保留（否则没办法取消勾选）。 */
function buildOptions(
  counts: Record<string, number>,
  selected: string[],
  labelOf: (value: string) => string,
  order: string[],
): FacetOption[] {
  const values = new Set<string>(Object.keys(counts));
  for (const value of selected) {
    values.add(value);
  }
  const rank = new Map(order.map((value, index) => [value, index]));
  return Array.from(values)
    .map((value) => ({ value, count: counts[value] ?? 0, label: labelOf(value) }))
    .sort((left, right) => {
      const leftRank = rank.get(left.value) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.value) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return right.count - left.count;
    });
}

export default function Home({ me, dicts, directory, regionTools, onCreate, onEdit, refreshToken }: HomeProps) {
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
  // 手改地址 / 分享过期可能带非 UUID 的经理值：先在本地丢弃，再由 effect 归一化地址栏（服务端 400 的兜底见下面 error 分支）
  const activeFilters = useMemo<ListQueryState>(() => {
    const managerIds = filters.managerIds.filter((managerId) => UUID.test(managerId));
    return managerIds.length === filters.managerIds.length ? filters : { ...filters, managerIds };
  }, [filters]);
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
  const keyword = query.trim();
  const hasFilters = hasListFilters(activeFilters);
  const sortDesc = activeFilters.sortDesc;
  const dateRange: DateRange | null =
    activeFilters.timeFrom !== null && activeFilters.timeTo !== null
      ? { from: activeFilters.timeFrom, to: activeFilters.timeTo }
      : null;

  // 关键字防抖：输入时不每个字符打一次接口（250ms 内的最后一次生效）
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(activeFilters.q);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeFilters.q]);
  const requestFilters = useMemo<ListQueryState>(
    () => ({ ...activeFilters, q: debouncedQuery }),
    [activeFilters, debouncedQuery],
  );
  const requestKey = useMemo(() => buildListQuery(requestFilters), [requestFilters]);
  const requestRef = useRef(requestFilters);
  requestRef.current = requestFilters;

  // 服务端数据：列表 + 三组计数（各自排除自己那一维）
  const [items, setItems] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [facets, setFacets] = useState<ProjectFacets>(EMPTY_FACETS);
  const [savedCounts, setSavedCounts] = useState<Record<string, number>>({});
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const current = requestRef.current;
      setLoading(true);
      try {
        const [page, regionFacets, typeFacets, managerFacets] = await Promise.all([
          fetchProjectList(current),
          fetchProjectFacets(current, "regions"),
          fetchProjectFacets(current, "projectTypes"),
          fetchProjectFacets(current, "managerIds"),
        ]);
        if (cancelled) {
          return;
        }
        setItems(page.items.map(toUiProject));
        setTotal(page.total);
        setFacets({
          total: managerFacets.total,
          region: regionFacets.region,
          projectType: typeFacets.projectType,
          managerId: managerFacets.managerId,
          stageKey: regionFacets.stageKey,
          status: regionFacets.status,
        });
        setLoadError(null);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 400) {
          // 非法筛选值（UUID / 日期 / limit）：丢弃整组条件并归一化地址栏，让页面回到可用状态
          replaceListQuery(EMPTY_LIST_QUERY);
          setLoadError("筛选条件无效，已重置为全部项目。");
        } else if (error instanceof ApiError) {
          setLoadError(error.message + "（" + error.code + "）");
        } else {
          setLoadError("网络异常，未能加载项目列表。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [requestKey, reloadToken, refreshToken]);

  // 常用筛选胶囊计数：按该组合单独取一次 total（服务端同口径判定），与当前筛选无关
  useEffect(() => {
    if (savedFilters.length === 0) {
      setSavedCounts({});
      return;
    }
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const entries = await Promise.all(
          savedFilters.map(async (filter): Promise<[string, number]> => {
            const result = await fetchProjectFacets({
              regions: filter.regions,
              projectTypes: filter.projectTypes,
              managerIds: filter.managerIds,
              timeFrom: filter.timeFrom,
              timeTo: filter.timeTo,
              q: "",
              sortDesc: true,
            });
            return [filter.id, result.total];
          }),
        );
        if (!cancelled) {
          setSavedCounts(Object.fromEntries(entries));
        }
      } catch {
        if (!cancelled) {
          setSavedCounts({});
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [savedFilters, reloadToken, refreshToken]);

  const regionOptions = useMemo(
    () =>
      buildOptions(
        facets.region,
        activeFilters.regions,
        (code) => dictLabel(dicts, "region", code),
        dicts.region.map((item) => item.code),
      ),
    [activeFilters.regions, dicts, facets.region],
  );
  const typeOptions = useMemo(
    () =>
      buildOptions(
        facets.projectType,
        activeFilters.projectTypes,
        (code) => dictLabel(dicts, "projectType", code),
        dicts.projectType.map((item) => item.code),
      ),
    [activeFilters.projectTypes, dicts, facets.projectType],
  );
  const managerOptions = useMemo(
    () =>
      buildOptions(
        facets.managerId,
        activeFilters.managerIds,
        (managerId) => directoryName(directory, managerId),
        [],
      ),
    [activeFilters.managerIds, directory, facets.managerId],
  );
  const newestDay = useMemo(
    () => items.reduce((latest, project) => (project.updatedAt > latest ? project.updatedAt : latest), "").slice(0, 10),
    [items],
  );
  const managerChoices = useMemo(() => directoryMemberOptions(directory), [directory]);

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
    // 保存前按当前字典 / 计数兜底：丢弃已不存在的地区 / 类型 / 经理（与 URL 参数归一化同一收敛口径）
    const knownRegions = new Set(Object.keys(facets.region));
    const knownTypes = new Set(Object.keys(facets.projectType));
    const knownManagers = new Set(Object.keys(facets.managerId));
    const normalized: FilterCriteria = {
      regions: criteria.regions.filter((region) => knownRegions.has(region)),
      projectTypes: criteria.projectTypes.filter((projectType) => knownTypes.has(projectType)),
      managerIds: criteria.managerIds.filter((managerId) => knownManagers.has(managerId)),
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
        regions={regionOptions}
        types={typeOptions}
        managers={managerOptions}
        savedFilterCounts={savedCounts}
        newestDay={newestDay}
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
            {keyword === "" && !hasFilters ? "共 " + total + " 个项目" : "找到 " + total + " 个项目"}
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

        {loadError === null ? null : (
          <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => {
                setReloadToken((value) => value + 1);
              }}
              className="ml-auto rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium transition hover:bg-rose-100"
            >
              重试
            </button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">正在加载项目…</p>
          </div>
        ) : null}

        {!loading && items.length === 0 && loadError === null ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">
              {keyword === "" ? "没有符合筛选条件的项目" : "没有匹配「" + keyword + "」的项目"}
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
        ) : null}

        <div className="grid grid-cols-1 gap-6 @md:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
          {items.map((project) => (
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
                typeLabel={dictLabel(dicts, "projectType", project.projectType)}
                accentColor={typeAccent(dicts, project.projectType).color}
                accentText={typeAccent(dicts, project.projectType).text}
                managerNames={projectManagerText(project)}
                time={project.createdAt}
                onEdit={() => {
                  onEdit(project);
                }}
              />
            </div>
          ))}
        </div>

        {total > items.length ? (
          <p className="mt-6 text-center text-xs text-zinc-400">
            已显示前 {items.length} 条，共 {total} 条（一期列表一次最多 200 条）。
          </p>
        ) : null}

        <details className="mt-12 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
          <summary className="cursor-pointer text-zinc-500">令牌声明（id_token，已通过 JWKS 验签）</summary>
          <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(me.claims, null, 2)}</pre>
          <p className="mt-3 text-xs text-zinc-400">令牌到期时间：{expiresText}</p>
        </details>
      </main>

      {isCreateOpen && (
        <ProjectModal
          mode="create"
          regions={dicts.region}
          projectTypes={dicts.projectType}
          regionTools={regionTools}
          managerOptions={managerChoices}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (draft) => {
            const message = await onCreate(draft);
            if (message === null) {
              setIsCreateOpen(false);
            }
            return message;
          }}
        />
      )}
    </div>
  );
}
