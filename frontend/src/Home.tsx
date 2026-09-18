import { useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { Card } from "./components/Card";
import { CategoryFilterSidebar } from "./components/CategoryFilterSidebar";
import { CategorySwitch } from "./components/CategorySwitch";
import type { DateRange } from "./components/DateRangePicker";
import { NewProjectModal, type NewProjectDraft } from "./components/NewProjectModal";
import { SearchInput } from "./components/SearchInput";
import { openProject } from "./useHashRoute";
import type { MeResponse, Project } from "./types";

type HomeProps = {
  me: MeResponse;
  projects: Project[];
  onCreate: (draft: NewProjectDraft) => void;
};

export default function Home({ me, projects, onCreate }: HomeProps) {
  const expiresText = me.expiresAt === null ? "—" : new Date(me.expiresAt * 1000).toLocaleString("zh-CN");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedManagers, setSelectedManagers] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [sortDesc, setSortDesc] = useState(true);
  const keyword = query.trim().toLowerCase();
  const hasFilters =
    selectedRegions.length > 0 || selectedManagers.length > 0 || selectedTypes.length > 0 || dateRange !== null;
  const filtered = useMemo(() => {
    const matched = projects.filter((project) => {
      if (selectedRegions.length > 0 && !selectedRegions.includes(project.region)) {
        return false;
      }
      if (selectedManagers.length > 0 && !selectedManagers.includes(project.manager)) {
        return false;
      }
      if (selectedTypes.length > 0 && !selectedTypes.includes(project.projectType)) {
        return false;
      }
      if (dateRange !== null) {
        const day = project.updatedAt.slice(0, 10);
        if (day < dateRange.from || day > dateRange.to) {
          return false;
        }
      }
      if (keyword === "") {
        return true;
      }
      return [project.title, project.description, project.region, project.projectType, project.id, project.updatedAt, project.manager].some((field) =>
        field.toLowerCase().includes(keyword),
      );
    });
    const ordered = matched.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0));
    return sortDesc ? ordered : ordered.reverse();
  }, [keyword, projects, selectedRegions, selectedManagers, selectedTypes, dateRange, sortDesc]);
  const resetFilters = () => {
    setSelectedRegions([]);
    setSelectedManagers([]);
    setSelectedTypes([]);
    setDateRange(null);
  };
  const toggleValue = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="min-h-screen">
      <AppHeader me={me} title="项目空间" />

      <CategoryFilterSidebar
        open={filterOpen}
        projects={projects}
        selectedRegions={selectedRegions}
        selectedManagers={selectedManagers}
        selectedTypes={selectedTypes}
        dateRange={dateRange}
        onToggleRegion={(region) => {
          setSelectedRegions((previous) => toggleValue(previous, region));
        }}
        onToggleManager={(manager) => {
          setSelectedManagers((previous) => toggleValue(previous, manager));
        }}
        onToggleType={(projectType) => {
          setSelectedTypes((previous) => toggleValue(previous, projectType));
        }}
        onDateRangeChange={(range) => {
          setDateRange(range);
        }}
        onReset={resetFilters}
        onClose={() => {
          setFilterOpen(false);
        }}
      />

      <main className={"@container w-full pt-0 pb-10 pr-6 pl-6 transition-[padding-left] duration-300 ease-out " + (filterOpen ? "md:pl-[304px]" : "")}>
        <div className="sticky top-16 z-10 -mx-6 mb-6 flex flex-wrap items-center gap-3 bg-[#f5f6f8] px-6 pt-4 pb-2">
          <CategorySwitch
            checked={filterOpen}
            onChange={(next) => {
              setFilterOpen(next);
            }}
          />
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5 text-xs">
            <button
              type="button"
              aria-pressed={sortDesc}
              onClick={() => {
                setSortDesc(true);
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
              onClick={() => {
                setSortDesc(false);
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
              onChange={setQuery}
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
                    setQuery("");
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
            <button
              key={project.id}
              type="button"
              onClick={() => openProject(project.id)}
              className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              <Card
                index={project.index}
                title={project.title}
                description={project.description}
                accent={project.accent}
                projectType={project.projectType}
                manager={project.manager}
                time={project.updatedAt}
              />
            </button>
          ))}
        </div>

        <details className="mt-12 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
          <summary className="cursor-pointer text-zinc-500">令牌声明（id_token，已通过 JWKS 验签）</summary>
          <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(me.claims, null, 2)}</pre>
          <p className="mt-3 text-xs text-zinc-400">令牌到期时间：{expiresText}</p>
        </details>
      </main>

      {isCreateOpen && (
        <NewProjectModal
          onClose={() => setIsCreateOpen(false)}
          onCreate={(draft) => {
            onCreate(draft);
            setIsCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}
