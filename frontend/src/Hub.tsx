import { useEffect, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { HubButton } from "./components/HubButton";
import { HubMap } from "./components/HubMap";
import { buildMapDistribution, type HubMapDistribution } from "./data/mapProjects";
import { loadDicts } from "./dicts";
import { fetchProjectList } from "./projectApi";
import { EMPTY_LIST_QUERY, projectsHref } from "./useHashRoute";
import type { MeResponse } from "./types";

/**
 * 登录后的入口页（Push 188 改版）：**左侧竖排三个入口胶囊 + 右侧平面世界地图**。
 * 地图口径见 components/HubMap.tsx；项目立柱的数据口径见 data/mapProjects.ts —— 联动键是 projects.region，
 * 取数复用现有接口（GET /api/v1/projects + GET /api/v1/dicts），**没有新增契约**。
 */
export default function Hub({ me }: { me: MeResponse }) {
  // 一期固定三个入口；后续增删或调顺序都在这里改
  const entries = [
    { label: "项目空间", href: projectsHref() },
    { label: "任务模板", href: "#/templates" },
    { label: "文件库", href: "#/files" },
  ];

  const [distribution, setDistribution] = useState<HubMapDistribution | null>(null);
  const [note, setNote] = useState("项目数据加载中…");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, dicts] = await Promise.all([fetchProjectList(EMPTY_LIST_QUERY), loadDicts()]);
        if (cancelled) {
          return;
        }
        setDistribution(buildMapDistribution(list.items, dicts));
        setNote(list.items.length < list.total ? "图上只画了前 " + String(list.items.length) + " 个项目（共 " + String(list.total) + " 个）" : "");
      } catch {
        if (cancelled) {
          return;
        }
        // 取数失败不挡入口页：地图照常可触碰，只是没有立柱
        setDistribution(null);
        setNote("项目数据加载失败，地图仍可触碰；刷新重试。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader me={me} />
      <main className="flex min-h-[calc(100vh-4rem)] flex-col gap-8 px-6 py-8 lg:flex-row lg:gap-10 lg:px-10 lg:py-10">
        <nav
          aria-label="业务入口"
          className="flex shrink-0 flex-wrap content-center items-center justify-center gap-4 lg:w-[236px] lg:flex-col lg:flex-nowrap lg:items-center lg:justify-center"
        >
          {entries.map((entry) => (
            <HubButton key={entry.label} label={entry.label} href={entry.href} />
          ))}
        </nav>
        <section className="hub-map-panel group relative flex min-h-[240px] flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/80 p-3 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)] backdrop-blur transition-shadow duration-300 hover:border-zinc-200 hover:shadow-[0_30px_70px_-40px_rgba(15,23,42,0.55)]">
          <HubMap distribution={distribution} note={note} />
        </section>
      </main>
    </div>
  );
}
