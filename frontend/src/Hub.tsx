import { useEffect, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { HubMap } from "./components/HubMap";
import { buildMapDistribution, type HubMapDistribution } from "./data/mapProjects";
import { loadDicts } from "./dicts";
import { fetchProjectList } from "./projectApi";
import { EMPTY_LIST_QUERY } from "./useHashRoute";
import type { MeResponse } from "./types";

/**
 * 登录后的入口页（Push 188 改版）：**平面世界地图占满内容区**。
 * 地图口径见 components/HubMap.tsx；项目立柱的数据口径见 data/mapProjects.ts —— 联动键是 projects.region，
 * 取数复用现有接口（GET /api/v1/projects + GET /api/v1/dicts），**没有新增契约**。
 *
 * 业务口径 2026-09-30「这三个按钮删除吧」：原来最左侧竖排的三个入口胶囊（项目空间 / 任务模板 / 我的任务，
 * components/HubButton.tsx）与顶部导航栏（TopNav：首页 / 项目空间 / 任务模板 / 我的任务）重复，整列下架
 * （组件文件一并删除），地图从此占满整行；项目空间 / 任务模板 / 我的任务三个落点地址不变，改由顶部导航栏承接。
 */
export default function Hub({ me }: { me: MeResponse }) {
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
      <main className="flex min-h-[calc(100vh-4rem)] flex-col px-6 py-8 lg:px-10 lg:py-10">
        <section className="hub-map-panel group relative flex min-h-[240px] flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/80 p-3 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)] backdrop-blur transition-shadow duration-300 hover:border-zinc-200 hover:shadow-[0_30px_70px_-40px_rgba(15,23,42,0.55)]">
          <HubMap distribution={distribution} note={note} />
        </section>
      </main>
    </div>
  );
}
