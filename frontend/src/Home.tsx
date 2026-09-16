import { useMemo, useState } from "react";
import { Card, type CardAccent } from "./components/Card";
import { NewProjectModal, type NewProjectDraft } from "./components/NewProjectModal";
import { SearchInput } from "./components/SearchInput";
import type { MeResponse } from "./App";

type Project = {
  id: string;
  index: string;
  title: string;
  description: string;
  accent: CardAccent;
  updatedAt: string;
  manager: string;
};

const PROJECTS: Project[] = [
  { id: "cnbj-0001", index: "01", title: "CNBJ-20260708-0001", description: "中国包裹分拣", accent: "blue", updatedAt: "2026-07-08 08:15", manager: "李伟" },
  { id: "usca-0002", index: "02", title: "USCA-20260708-0002", description: "美国包裹分拣", accent: "emerald", updatedAt: "2026-07-08 09:02", manager: "王芳" },
  { id: "debe-0003", index: "03", title: "DEBE-20260708-0003", description: "德国包裹分拣", accent: "amber", updatedAt: "2026-07-08 09:47", manager: "陈晨" },
  { id: "jptk-0004", index: "04", title: "JPTK-20260708-0004", description: "日本包裹分拣", accent: "rose", updatedAt: "2026-07-08 10:20", manager: "刘洋" },
  { id: "gbln-0005", index: "05", title: "GBLN-20260708-0005", description: "英国包裹分拣", accent: "violet", updatedAt: "2026-07-08 11:05", manager: "赵磊" },
  { id: "frly-0006", index: "06", title: "FRLY-20260708-0006", description: "法国包裹分拣", accent: "blue", updatedAt: "2026-07-08 13:12", manager: "孙悦" },
  { id: "krsl-0007", index: "07", title: "KRSL-20260708-0007", description: "韩国包裹分拣", accent: "emerald", updatedAt: "2026-07-08 14:38", manager: "周涛" },
  { id: "thbk-0008", index: "08", title: "THBK-20260708-0008", description: "泰国包裹分拣", accent: "amber", updatedAt: "2026-07-08 15:09", manager: "吴敏" },
  { id: "vnsg-0009", index: "09", title: "VNSG-20260708-0009", description: "越南包裹分拣", accent: "rose", updatedAt: "2026-07-08 16:24", manager: "郑凯" },
  { id: "inmu-0010", index: "10", title: "INMU-20260708-0010", description: "印度包裹分拣", accent: "violet", updatedAt: "2026-07-08 17:41", manager: "冯雪" },
  { id: "brsp-0011", index: "11", title: "BRSP-20260708-0011", description: "巴西包裹分拣", accent: "blue", updatedAt: "2026-07-08 08:52", manager: "何俊" },
  { id: "clsc-0012", index: "12", title: "CLSC-20260708-0012", description: "智利包裹分拣", accent: "emerald", updatedAt: "2026-07-08 10:33", manager: "许静" },
  { id: "pelm-0013", index: "13", title: "PELM-20260708-0013", description: "秘鲁包裹分拣", accent: "amber", updatedAt: "2026-07-08 12:07", manager: "高峰" },
  { id: "grat-0014", index: "14", title: "GRAT-20260708-0014", description: "希腊包裹分拣", accent: "rose", updatedAt: "2026-07-08 13:55", manager: "林娜" },
  { id: "plwa-0015", index: "15", title: "PLWA-20260708-0015", description: "波兰包裹分拣", accent: "violet", updatedAt: "2026-07-08 15:18", manager: "罗成" },
  { id: "nlan-0016", index: "16", title: "NLAN-20260708-0016", description: "荷兰包裹分拣", accent: "blue", updatedAt: "2026-07-08 16:46", manager: "梁爽" },
  { id: "sesk-0017", index: "17", title: "SESK-20260708-0017", description: "瑞典包裹分拣", accent: "emerald", updatedAt: "2026-07-08 09:28", manager: "宋扬" },
  { id: "chzh-0018", index: "18", title: "CHZH-20260708-0018", description: "瑞士包裹分拣", accent: "amber", updatedAt: "2026-07-08 11:39", manager: "唐磊" },
  { id: "noos-0019", index: "19", title: "NOOS-20260708-0019", description: "挪威包裹分拣", accent: "rose", updatedAt: "2026-07-08 14:02", manager: "韩雪" },
  { id: "zajn-0020", index: "20", title: "ZAJN-20260708-0020", description: "南非包裹分拣", accent: "violet", updatedAt: "2026-07-08 17:15", manager: "曹阳" },
];

type HomeProps = {
  me: MeResponse;
};

export default function Home({ me }: HomeProps) {
  const user = me.user;
  const displayName = user.displayName ?? user.name ?? "未署名用户";
  const contact = user.email ?? user.name ?? "—";
  const expiresText = me.expiresAt === null ? "—" : new Date(me.expiresAt * 1000).toLocaleString("zh-CN");

  const [projects, setProjects] = useState<Project[]>(PROJECTS);
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

  const handleCreateProject = (draft: NewProjectDraft) => {
    setProjects((previous) => {
      const nextNumber = previous.length + 1;
      const accents: readonly CardAccent[] = ["blue", "emerald", "amber", "rose", "violet"];
      const accent = accents[(nextNumber - 1) % accents.length] ?? "blue";
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const updatedAt =
        String(now.getFullYear()) + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
      return [
        ...previous,
        {
          id: "custom-" + String(nextNumber),
          index: String(nextNumber).padStart(2, "0"),
          title: draft.title.trim(),
          description: draft.description.trim(),
          accent,
          updatedAt,
          manager: draft.manager.trim(),
        },
      ];
    });
    setIsCreateOpen(false);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-6">
          <img src="/libiaolink-logo.svg" alt="LibiaoLink" className="h-11 w-auto" />
          <div className="leading-tight">
            <p className="text-base font-semibold text-zinc-900">LibiaoLink</p>
            <p className="text-xs text-zinc-500">立镖全链路信息平台</p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right leading-tight">
              <p className="text-sm font-medium text-zinc-800">{displayName}</p>
              <p className="text-xs text-zinc-500">{contact}</p>
            </div>
            <a
              href="/auth/logout"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              退出登录
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-6 py-10">
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
            <Card
              key={project.id}
              index={project.index}
              title={project.title}
              description={project.description}
              accent={project.accent}
              manager={project.manager}
              time={project.updatedAt}
            />
          ))}
        </div>

        <details className="mt-12 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
          <summary className="cursor-pointer text-zinc-500">令牌声明（id_token，已通过 JWKS 验签）</summary>
          <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(me.claims, null, 2)}</pre>
          <p className="mt-3 text-xs text-zinc-400">令牌到期时间：{expiresText}</p>
        </details>
      </main>

      {isCreateOpen && (
        <NewProjectModal onClose={() => setIsCreateOpen(false)} onCreate={handleCreateProject} />
      )}
    </div>
  );
}
