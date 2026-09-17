import { useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { Card } from "./components/Card";
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
  const keyword = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (keyword === "") {
      return projects;
    }
    return projects.filter((project) =>
      [project.title, project.description, project.id, project.updatedAt, project.manager].some((field) => field.toLowerCase().includes(keyword)),
    );
  }, [keyword, projects]);

  return (
    <div className="min-h-screen">
      <AppHeader me={me} />

      <main className="w-full px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold text-zinc-900">项目空间</h1>
              <span className="text-sm text-zinc-400">
                {keyword === "" ? "共 " + projects.length + " 个项目" : "找到 " + filtered.length + " 个项目"}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">选择一个项目进入，账号信息来自公司统一登录令牌。</p>
          </div>
          <div className="flex w-full flex-col items-end gap-3 sm:w-auto">
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
            <p className="text-sm text-zinc-500">没有匹配「{query.trim()}」的项目</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              清空搜索
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
