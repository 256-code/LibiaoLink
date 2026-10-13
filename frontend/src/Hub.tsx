import { useEffect, useState } from "react";
import { useLiveRefresh } from "./useLiveRefresh";
import { useT } from "./i18n";
import { AppHeader } from "./components/AppHeader";
import { HubMap } from "./components/HubMap";
import { buildMapDistribution, type HubMapDistribution } from "./data/mapProjects";
import { loadDicts } from "./dicts";
import { fetchProjectList } from "./projectApi";
import { EMPTY_LIST_QUERY } from "./useHashRoute";
import type { MeResponse } from "./types";

/**
 * 蓝图页（顶层 · Push 285 业务口径 2026-10-12「登录后默认进入项目空间 首页名称改成蓝图」：本页由
 * 「入口页 / 首页」改名「**蓝图**」，登录后的默认落地改为项目空间 `#/projects`，本页由导航首项 / `#/` 直连进入）。
 * Push 188 改版起：**平面世界地图占满内容区**。
 * 地图口径见 components/HubMap.tsx；项目立柱的数据口径见 data/mapProjects.ts —— 联动键是 projects.region，
 * 取数复用现有接口（GET /api/v1/projects + GET /api/v1/dicts），**没有新增契约**。
 *
 * 业务口径 2026-09-30「这三个按钮删除吧」：原来最左侧竖排的三个入口胶囊（项目空间 / 任务模板 / 我的任务，
 * components/HubButton.tsx）与顶部导航栏（TopNav：蓝图 / 项目空间 / 任务模板 / 我的任务）重复，整列下架
 * （组件文件一并删除），地图从此占满整行；项目空间 / 任务模板 / 我的任务三个落点地址不变，改由顶部导航栏承接。
 */
type HubNote = "loading" | "none" | { kind: "capped"; n: number; total: number } | "failed";

export default function Hub({ me }: { me: MeResponse }) {
  const t = useT();
  const [distribution, setDistribution] = useState<HubMapDistribution | null>(null);
  /** 提示条内容（Push 301）：存结构化状态、渲染时按当前语言取词（切换语言不用等下一次取数）。 */
  const [note, setNote] = useState<HubNote>("loading");
  const noteText = note === "loading" ? t("hub.loading") : note === "failed" ? t("hub.loadFailed") : note === "none" ? "" : t("hub.capped", { n: note.n, total: note.total });
  useLiveRefresh(["projects", "dicts", "permissions", "users"], async () => {
    const [list, dicts] = await Promise.all([fetchProjectList(EMPTY_LIST_QUERY), loadDicts()]);
    return () => {
      setDistribution(buildMapDistribution(list.items, dicts));
      setNote(list.items.length < list.total ? { kind: "capped", n: list.items.length, total: list.total } : "none");
    };
  }, "hub", distribution !== null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, dicts] = await Promise.all([fetchProjectList(EMPTY_LIST_QUERY), loadDicts()]);
        if (cancelled) {
          return;
        }
        setDistribution(buildMapDistribution(list.items, dicts));
        setNote(list.items.length < list.total ? { kind: "capped", n: list.items.length, total: list.total } : "none");
      } catch {
        if (cancelled) {
          return;
        }
        // 取数失败不挡蓝图页：地图照常可触碰，只是没有立柱
        setDistribution(null);
        setNote("failed");
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
          <HubMap distribution={distribution} note={noteText} />
        </section>
      </main>
    </div>
  );
}
