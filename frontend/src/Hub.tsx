import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "./useLiveRefresh";
import { useT } from "./i18n";
import { AppHeader } from "./components/AppHeader";
import { HubDashboard, type HubDashboardState } from "./components/HubDashboard";
import { HubMap } from "./components/HubMap";
import type { DashboardDataset } from "./dashboardApi";
import { buildMapDistribution, type HubMapDistribution } from "./data/mapProjects";
import { fetchDashboardProgress } from "./dashboardApi";
import { loadDicts } from "./dicts";
import { fetchProjectList, type ApiProject } from "./projectApi";
import { EMPTY_LIST_QUERY, replaceHubView, type HubView } from "./useHashRoute";
import type { MeResponse } from "./types";

/**
 * 仪表盘页（顶层 · 2026-10-15 业务口径「导航栏名称蓝图改成仪表盘」「鼠标滑动蓝图转场展示仪表盘」）：
 * 本页由「蓝图」改名「**仪表盘**」—— 页面本体还是那张世界地图（蓝图），鼠标滑动 / 方向键 / 页边圆钮触发转场，
 * 转入「阶段 × 进度五档」统计视图（形态 = 业务确认过的效果图；取数口径见 data/dashboardProgress.ts）。
 *
 * 转场（2026-10-15「转场效果看这个参考这个页面的顶部渐变、底部渐变」= tympanus《A Collection of Page Transitions》
 * 的「Fade top / Fade bottom」第 11 / 12 号动画）：下滑 = 地图上移淡出、仪表盘自下淡入；上滑 = 反向；
 * 两屏都整卡位移、0.6s ease both，样式在 app.css 的 .hub-deck__view--*。
 *
 * 尺寸（2026-10-15「蓝图页面我不希望有鼠标滚动条 所以尺寸还要优化」）：外框收口成视口高度
 * （h-[100dvh] + overflow-hidden），面板 flex-1，地图 / 统计都按 viewBox 缩放 —— 本页不出滚动条，
 * 滚轮专用于触发转场（面板内部可滚区，例如钉住的「项目梳理」清单，照常滚）。
 *
 * 历史（口径不动，只动了页面命名）：Push 285「登录后默认进入项目空间 首页名称改成蓝图」—— 本页由
 * 「入口页 / 首页」改名「蓝图」，登录后的默认落地改为项目空间 `#/projects`，本页由导航首项 / `#/` 直连进入；
 * Push 188 改版起平面世界地图占满内容区（地图口径见 components/HubMap.tsx；项目立柱的数据口径见
 * data/mapProjects.ts —— 联动键是 projects.region，取数复用现有接口，没有新增契约）。
 *
 * 业务口径 2026-09-30「这三个按钮删除吧」：原来最左侧竖排的三个入口胶囊（项目空间 / 任务模板 / 我的任务，
 * components/HubButton.tsx）与顶部导航栏重复，整列下架（组件文件一并删除），地图从此占满整行；
 * 项目空间 / 任务模板 / 我的任务三个落点地址不变，改由顶部导航栏承接。
 */
type HubNote = "loading" | "none" | { kind: "capped"; n: number; total: number } | "failed";
type HubAnim = "toDashboard" | "toMap" | null;

/** 右侧边缘页面指示器的两屏顺序（Push 333 · 业务口径「页面指示器呢 我没看到」「这个悬浮球不需要」）。 */
const DECK_VIEWS: readonly HubView[] = ["map", "dashboard"];

/** 转场时长（与 app.css 的 .hub-deck__view--* 动画一致）：动画跑完才落定视图。 */
const DECK_ANIM_MS = 620;

/** 数据详情弹窗（Push 336 · 业务口径「点击具体的模块进入详细内容后是弹窗一样的效果 并且不支持鼠标滑动切换页面」）：
 *  弹窗打开时滚轮 / 方向键 / Esc 只属于弹窗，不参与地图 ⇄ 仪表盘转场（弹窗挂在浮层里，本判定是硬闸）。 */
function detailDialogOpen(): boolean {
  return document.querySelector("[data-hub-detail-dialog]") !== null;
}

/** 转场只吃「页面级」滚轮：落点上游有可滚动祖先（例如钉住的「项目梳理」清单）时放行给内部滚动。 */
function scrollableAncestorWithin(target: EventTarget | null, boundary: HTMLElement): boolean {
  let node = target instanceof HTMLElement ? target : null;
  while (node !== null && node !== boundary) {
    if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

export default function Hub({ me, routeView, rememberedView, onViewChange, rememberedDashProject, onDashProjectChange }: {
  me: MeResponse;
  /** 地址里的视图（`#/?view=dashboard`；null = 地址没写，落账号记忆的常驻视图）—— Push 332。 */
  routeView: HubView | null;
  /** 账号记的常驻视图（user_preferences.prefs.hubView；地址没写时用它）—— Push 332。 */
  rememberedView: HubView;
  onViewChange: (view: HubView) => void;
  /** 账号记的仪表盘常驻项目（user_preferences.prefs.hubDashProject；null = 全部项目）—— Push 336。 */
  rememberedDashProject: string | null;
  /** 记下 / 清除仪表盘常驻项目（Push 336；乐观更新由 App 层负责）。 */
  onDashProjectChange: (projectId: string | null) => Promise<void>;
}) {
  const t = useT();
  /** 提示条内容（Push 301）：存结构化状态、渲染时按当前语言取词（切换语言不用等下一次取数）。 */
  const [note, setNote] = useState<HubNote>("loading");
  const [distribution, setDistribution] = useState<HubMapDistribution | null>(null);
  const [view, setView] = useState<HubView>(routeView ?? rememberedView);
  const [anim, setAnim] = useState<HubAnim>(null);
  const [dash, setDash] = useState<DashboardDataset | null>(null);
  const [dashState, setDashState] = useState<HubDashboardState>("loading");
  const deckRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HubView>(routeView ?? rememberedView);
  const animRef = useRef<HubAnim>(null);
  const dashStateRef = useRef<HubDashboardState>("loading");
  const dashLoadingRef = useRef(false);
  const projectsRef = useRef<readonly ApiProject[] | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const noteText = note === "loading" ? t("hub.loading") : note === "failed" ? t("hub.loadFailed") : note === "none" ? "" : t("hub.capped", { n: note.n, total: note.total });

  const updateDashState = useCallback((next: HubDashboardState) => {
    dashStateRef.current = next;
    setDashState(next);
  }, []);

  /** 拉统计（纯取数、不落状态）：首转 / 失败重试 / 变更静默刷新共用。 */
  const pullDashboard = useCallback(async (projects?: readonly ApiProject[]): Promise<DashboardDataset | null> => {
    try {
      return await fetchDashboardProgress(projects ?? projectsRef.current ?? undefined);
    } catch {
      return null;
    }
  }, []);

  /** 转入仪表盘前确保有数据：未就绪拉一次（转场先走，拉完再渲染数据，中途显示加载球）。 */
  const ensureDashboard = useCallback(() => {
    if (dashStateRef.current === "ready" || dashLoadingRef.current) {
      return;
    }
    dashLoadingRef.current = true;
    if (dashStateRef.current === "failed") {
      updateDashState("loading");
    }
    void (async () => {
      const data = await pullDashboard();
      dashLoadingRef.current = false;
      if (data === null) {
        updateDashState("failed");
        return;
      }
      setDash(data);
      updateDashState("ready");
    })();
  }, [pullDashboard, updateDashState]);

  /** 触发转场：动画期间锁住再次触发；动画跑完落定视图（与 CSS 时长同步）。 */
  const startTransition = useCallback((next: HubView) => {
    if (animRef.current !== null || viewRef.current === next) {
      return;
    }
    if (next === "dashboard") {
      ensureDashboard();
    }
    const nextAnim: HubAnim = next === "dashboard" ? "toDashboard" : "toMap";
    animRef.current = nextAnim;
    setAnim(nextAnim);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      animRef.current = null;
      viewRef.current = next;
      setAnim(null);
      setView(next);
      // Push 332：视图落定即写回地址（replace · 刷新 / 收藏 / 分享都停这一屏）并按账号记住（地址带参数时以地址为准）。
      replaceHubView(next);
      onViewChange(next);
    }, DECK_ANIM_MS);
  }, [ensureDashboard, onViewChange]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
  }, []);

  /**
   * 地址 / 账号记忆与当前视图对齐（Push 332 · 业务口径「还是做路由吧 这个页面要记住 因为不同的人想常驻的页面可能不一样」）：
   * ① 地址显式带视图（`?view=dashboard`）时以地址为准；② 地址不带参数时落账号记忆的常驻视图。
   * 两者都只在「当前不在这一屏」时瞬时对齐 —— 它是落地定位，不是滚轮 / 按钮触发的翻页（不走转场）。
   */
  useEffect(() => {
    const target = routeView ?? rememberedView;
    if (target === "dashboard") {
      ensureDashboard();
    }
    if (target === viewRef.current || animRef.current !== null) {
      return;
    }
    viewRef.current = target;
    setView(target);
  }, [routeView, rememberedView, ensureDashboard]);

  useEffect(() => {
    const deck = deckRef.current;
    if (deck === null) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      if (detailDialogOpen() || scrollableAncestorWithin(event.target, deck)) {
        return;
      }
      event.preventDefault();
      if (animRef.current !== null) {
        return;
      }
      const delta = event.deltaY;
      if (Math.abs(delta) < 8) {
        return;
      }
      if (delta > 0 && viewRef.current === "map") {
        startTransition("dashboard");
      } else if (delta < 0 && viewRef.current === "dashboard") {
        startTransition("map");
      }
    };
    deck.addEventListener("wheel", onWheel, { passive: false });
    return () => deck.removeEventListener("wheel", onWheel);
  }, [startTransition]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (detailDialogOpen() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "PageDown") {
        if (viewRef.current === "map") {
          event.preventDefault();
          startTransition("dashboard");
        }
      } else if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Escape") {
        if (viewRef.current === "dashboard") {
          event.preventDefault();
          startTransition("map");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startTransition]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, dicts] = await Promise.all([fetchProjectList(EMPTY_LIST_QUERY), loadDicts()]);
        if (cancelled) {
          return;
        }
        projectsRef.current = list.items;
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

  useLiveRefresh(["projects", "dicts", "tasks", "permissions", "users"], async () => {
    const [list, dicts] = await Promise.all([fetchProjectList(EMPTY_LIST_QUERY), loadDicts()]);
    /** 统计只在已就绪后才跟着刷新（没转过场就不预拉）。 */
    const nextDash = dashStateRef.current === "ready" ? ((await pullDashboard(list.items)) ?? dash) : dash;
    return () => {
      projectsRef.current = list.items;
      setDistribution(buildMapDistribution(list.items, dicts));
      setNote(list.items.length < list.total ? { kind: "capped", n: list.items.length, total: list.total } : "none");
      if (nextDash !== dash) {
        setDash(nextDash);
      }
    };
  }, "hub", distribution !== null);

  const mapSideClass = anim === "toDashboard" ? "hub-deck__view--out-top" : anim === "toMap" ? "hub-deck__view--in-top" : "";
  const dashSideClass = anim === "toDashboard" ? "hub-deck__view--in-bottom" : anim === "toMap" ? "hub-deck__view--out-bottom" : "";
  const mapParked = view === "dashboard" && anim === null;
  const dashParked = view === "map" && anim === null;
  /** 指示器跟随转场目标：点球即先变色（转场途中也即时反馈），落定后与地址 / 账号记忆一致。 */
  const indicatorView: HubView = anim === "toDashboard" ? "dashboard" : anim === "toMap" ? "map" : view;
  const deckViewClass = "hub-deck__view absolute inset-0 overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/80 p-3 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)] backdrop-blur";

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden overscroll-none">
      <AppHeader me={me} />
      <main className="relative min-h-0 flex-1 px-6 py-5 lg:px-10 lg:py-6">
        <section ref={deckRef} data-hub-deck="" className="relative h-full overflow-hidden">
          <div data-parked={mapParked ? "true" : "false"} className={deckViewClass + " " + mapSideClass}>
            <HubMap distribution={distribution} note={noteText} />
          </div>
          <div data-parked={dashParked ? "true" : "false"} className={deckViewClass + " " + dashSideClass}>
            <HubDashboard data={dash} state={dashState} rememberedDashProject={rememberedDashProject} onDashProjectChange={onDashProjectChange} />
          </div>
          <nav className="hub-deck-dots" aria-label={t("hub.dots.label")}>
            {DECK_VIEWS.map((item) => (
              <button
                key={item}
                type="button"
                className="hub-deck-dots__dot"
                data-view={item}
                data-active={indicatorView === item ? "true" : "false"}
                aria-current={indicatorView === item ? "true" : undefined}
                aria-label={t(item === "map" ? "hub.dots.map" : "hub.dots.dashboard")}
                onClick={() => startTransition(item)}
              />
            ))}
          </nav>
        </section>
      </main>
    </div>
  );
}
