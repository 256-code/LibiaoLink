import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { DashboardDataset } from "../dashboardApi";
import { DASHBOARD_BINS, isTaskInCell, type DashboardStatusSlice } from "../data/dashboardProgress";
import type { TaskStatus } from "../data/tasks";
import { stageText, statusText, useLocale, useT, type TextKey } from "../i18n";
import { displayStatusLabel } from "../taskApi";
import { HubDashDetail } from "./HubDashDetail";
import { HubDashStatus } from "./HubDashStatus";
import { Loader } from "./Loader";
import { SearchSelect, type SearchSelectOption } from "./SearchSelect";

/**
 * 仪表盘视图（蓝图页「蓝图 ⇄ 仪表盘」转场后半屏 · 2026-10-15 业务口径「鼠标滑动蓝图转场展示仪表盘」）：
 * 阶段 × 进度五档横向堆叠条，口径见 data/dashboardProgress.ts（取数 dashboardApi.ts）。
 *
 * 形态照业务确认过的效果图；按口径「多余的注释和文字不需要」只留标题 + 图例 + 数据，
 * 数据来源 / 口径注释等文字全部去掉。画布 1200 × 660（viewBox 缩放填满面板，永不产生滚动条）。
 * 颜色 / 状态样式见 app.css 的 .hub-dash-*；转场样式见 .hub-deck-*。
 *
 * Push 335（2026-10-15 业务口径「鼠标放上去是这样的效果」+「点击某一段是这个只读效果」）：
 * 悬停柱段出浮层卡（行名 + 档位色块 + 档位 + 条数，替代原生 title 灰框）；点柱段打开只读「数据详情」
 * （HubDashDetail）。「如果是全部项目的话不支持点击查看数据来源」—— 选中具体项目时柱段才可点。
 *
 * Push 336（2026-10-15 业务口径「选择的项目也要记住 不随刷新变动而回到全部项目」+「这个选择项目的ui太丑了 和现在的ui完全不符 要重写 要带搜索的选择器」）：
 * 选择器由原生 select 换成全站同款可搜索下拉 SearchSelect（SearchSelect.tsx）；选中项目写回账号偏好
 * user_preferences.prefs.hubDashProject（单键 PATCH，乐观更新 + 失败回滚在 App 层），刷新 / 换设备同账号仍停在同一个项目。
 *
 * Push 339（2026-10-15 业务口径「现在准备做这个任务状态的」+「鼠标触碰效果」+「点击后效果」+
 * 「这些都要参考项目进度一览 之前都做过的」+「在仪表盘页面在底部增加切换的按钮」+「这个按钮再做一个进度一览 靠左不居中」）：
 * 新增「任务状态」视图（HubDashStatus 饼图 = 五态分布 + 色字标签 + 引线）；底部挂两枚勾选框式视图按钮
 * （DashViewSwitch：左「项目进度一览」、右「任务状态」，单选框语义 = 选中态就是当前视图、点已选中的那枚不取消；
 * **靠左与标题条同一条竖线起排**，不再居中）；按钮样式照
 * 业务给的参考代码，见 app.css 的 .hub-dash-switch；**参考代码的白勾 / 脉冲层用 peer-checked: 挂在
 * 内层元素上 —— 兄弟选择器够不到、照抄永不显示，这里改 group-has-[:checked]: 才真正渲染**）。悬停扇区
 * 出浮层卡（状态名 + 色条 + 记录数 / 占比），
 * 点扇区开只读「数据详情」—— 与点柱段同一套口径（「全部项目」不可点）。统计口径 buildDashboardStatus
 * （data/dashboardProgress.ts）、按项目分桶在取数同一轮完成（零额外请求）。
 */
export type HubDashboardState = "loading" | "ready" | "failed";

/** 悬停卡（Push 335 柱段 / Push 339 扇区）：柱段 = 行名 + 档位一行；扇区 = 状态名 + 色条 + 记录数 / 占比两行。 */
type DashTip =
  | {
      readonly kind: "bin";
      readonly left: number;
      readonly top: number;
      readonly row: string;
      readonly bin: number;
      readonly count: number;
    }
  | {
      readonly kind: "status";
      readonly left: number;
      readonly top: number;
      readonly status: TaskStatus;
      readonly count: number;
      readonly share: string;
    };

/** 数据详情打开项（Push 335 / Push 339）：柱段 = 行 × 档；扇区 = 状态。 */
type DashDetailPick =
  | { readonly kind: "cell"; readonly rowKey: string; readonly bin: number }
  | { readonly kind: "status"; readonly status: TaskStatus };

/** 柱段悬停卡尺寸（用于贴边夹紧，避免溢出白卡被裁切）。 */
const TIP_W = 190;
const TIP_H = 84;
/** 扇区悬停卡尺寸（同上；形态照业务参考图，比柱段卡高一档）。 */
const STATUS_TIP_W = 200;
const STATUS_TIP_H = 108;

const VIEW_W = 1200;
const VIEW_H = 596;
/** 行标题右对齐基线（英文阶段名最长 "Hardware Implementation"，留 216 宽够放）。 */
const LABEL_X = 216;
const PLOT_X0 = 236;
const PLOT_X1 = 1124;
const PLOT_W = PLOT_X1 - PLOT_X0;
/** 行右侧合计 x（浅灰小字）。 */
const TOTAL_X = 1140;
const ROWS_TOP = 68;
const AXIS_Y = 520;
const TICK_LABEL_Y = 544;
/** 行内柱高（上限 30；行数再多也跟着行高缩）。 */
const BAR_MAX_H = 30;

/** 五档图例（与 DASHBOARD_BINS 同下标）。 */
const LEGEND_KEYS: readonly TextKey[] = ["hub.dash.b0", "hub.dash.b25", "hub.dash.b50", "hub.dash.b75", "hub.dash.b100"];

/** x 轴刻度步长：按最大行合计挑 1 / 2 / 5 / 10 / 20。 */
function tickStepOf(maxTotal: number): number {
  if (maxTotal <= 10) {
    return 1;
  }
  if (maxTotal <= 20) {
    return 2;
  }
  if (maxTotal <= 50) {
    return 5;
  }
  if (maxTotal <= 100) {
    return 10;
  }
  return 20;
}

/** 轴上限：给最大行合计留约 6% 余量再进到整步（18 → 20；44 → 50）。 */
function tickMaxOf(maxTotal: number): { max: number; step: number } {
  const step = tickStepOf(Math.max(maxTotal, 1));
  const target = Math.ceil((maxTotal * 1.06) / step) * step;
  return { max: Math.max(step, target), step };
}

/** 底部视图切换按钮（Push 339 追订 · 业务口径「这个按钮再做一个进度一览 靠左不居中」）：一枚按钮一个视图，
 *  勾选框式样照业务给的参考代码（灰底灰边圆角方框 → 选中蓝底白勾 + 渐变脉冲层，鼠标触碰放大 1.05 + 文字转蓝）。
 *  用单选框语义（同组 name，选中态 = 当前视图，点已选中的那枚不会取消选择）；白勾 / 脉冲层用 group-has-[:checked]:
 *  —— 参考代码的 peer-checked: 挂在内层元素上、兄弟选择器够不到，照抄不生效。 */
function DashViewSwitch({ view, checked, label, onSelect }: {
  readonly view: "progress" | "status";
  readonly checked: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}) {
  return (
    <label className="group flex cursor-pointer items-center" data-switch={view}>
      <input
        type="radio"
        name="hub-dash-view"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => {
          if (event.target.checked) {
            onSelect();
          }
        }}
      />
      <span className="relative flex h-8 w-8 items-center justify-center rounded-md border-2 border-gray-400 bg-gray-100 shadow-md transition-all duration-500 group-hover:scale-105 peer-checked:border-blue-500 peer-checked:bg-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/60">
        <span className="absolute inset-0 rounded-md bg-gradient-to-br from-white/30 to-white/10 opacity-0 transition-all duration-500 group-has-[:checked]:animate-pulse group-has-[:checked]:opacity-100" />
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="hidden h-5 w-5 scale-50 text-white transition-transform duration-500 group-has-[:checked]:block group-has-[:checked]:scale-100">
          <path clipRule="evenodd" fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 10-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" />
        </svg>
      </span>
      <span className="ml-3 font-medium text-gray-700 transition-colors duration-300 group-hover:text-blue-500">{label}</span>
    </label>
  );
}
export function HubDashboard({ data, state, rememberedDashProject, onDashProjectChange }: {
  data: DashboardDataset | null;
  state: HubDashboardState;
  /** 账号记的常驻项目（Push 336 · 业务口径「选择的项目也要记住 不随刷新变动而回到全部项目」；null = 全部项目）。 */
  rememberedDashProject: string | null;
  /** 把选中项目写回账号偏好（Push 336；App 层乐观更新 + 失败回滚 + Toast）。 */
  onDashProjectChange: (projectId: string | null) => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  /** 每行一条圆角裁剪（柱条两端圆角、段与段之间直角）：id 需要实例级唯一。 */
  const uid = useId().replace(/:/g, "");
  /** Push 334：项目选择器（第一行固定「全部项目」；选中项目即只统计该项目）；Push 336：初值取账号常驻项目。 */
  const [pickedId, setPickedId] = useState<string | null>(rememberedDashProject);
  /** 仪表盘页内视图（Push 339 · 业务口径「在仪表盘页面在底部增加切换的按钮」）：progress = 项目进度一览（堆叠条）；status = 任务状态（饼图）。底部切换按钮驱动。 */
  const [view, setView] = useState<"progress" | "status">("progress");
  /** 悬停卡 + 行高亮（同一行的柱段共用：卡里写行名，图上该行铺一条浅灰底）。 */
  const [tip, setTip] = useState<DashTip | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** 数据详情（Push 335：点柱段打开；Push 339：点扇区打开；记「行 × 档」或「状态」，打开时按它筛任务）。 */
  const [detail, setDetail] = useState<DashDetailPick | null>(null);
  /** 已失效的常驻项目只清一次（Push 336）：PATCH 失败回滚时不再重复请求，避免打转。 */
  const staleClearedRef = useRef<string | null>(null);
  /** 常驻项目（Push 336）：偏好晚到（首屏 prefs 未回）/ 换账号 / 保存失败回滚时跟随 —— 与本地选中同值即空转。 */
  useEffect(() => {
    setPickedId(rememberedDashProject);
  }, [rememberedDashProject]);
  /** 常驻的项目已不存在（被删）：界面回落「全部项目」，并把账号偏好一并清掉（只清一次）。 */
  useEffect(() => {
    if (pickedId !== null && data !== null && !data.byProject.has(pickedId)) {
      setPickedId(null);
      if (rememberedDashProject === pickedId && staleClearedRef.current !== pickedId) {
        staleClearedRef.current = pickedId;
        void onDashProjectChange(null);
      }
    }
  }, [data, pickedId, rememberedDashProject, onDashProjectChange]);
  /** 「全部项目」不支持点击查看数据来源（业务口径）：退到全部项目 / 切项目时关掉已开的数据详情。 */
  useEffect(() => {
    if (pickedId === null) {
      setDetail(null);
    }
  }, [pickedId]);
  /** 悬停柱段：把鼠标位置换算成白卡内的坐标（贴边夹紧），卡里写行名 / 档位 / 条数。 */
  const showTip = (event: ReactMouseEvent<SVGGElement>, rowText: string, bin: number, count: number): void => {
    const wrap = wrapRef.current;
    if (wrap === null) {
      return;
    }
    const box = wrap.getBoundingClientRect();
    setTip({
      kind: "bin",
      left: Math.max(6, Math.min(event.clientX - box.left + 14, box.width - TIP_W - 6)),
      top: Math.max(6, Math.min(event.clientY - box.top + 14, box.height - TIP_H - 6)),
      row: rowText,
      bin,
      count,
    });
  };
  /** 悬停扇区（Push 339 · 业务口径「鼠标触碰效果」）：卡里写状态名 / 记录数 / 占比（形态照业务参考图）。 */
  const showStatusTip = (event: ReactMouseEvent<SVGGElement>, slice: DashboardStatusSlice, share: string): void => {
    const wrap = wrapRef.current;
    if (wrap === null) {
      return;
    }
    const box = wrap.getBoundingClientRect();
    setTip({
      kind: "status",
      left: Math.max(6, Math.min(event.clientX - box.left + 14, box.width - STATUS_TIP_W - 6)),
      top: Math.max(6, Math.min(event.clientY - box.top + 14, box.height - STATUS_TIP_H - 6)),
      status: slice.status,
      count: slice.count,
      share,
    });
  };
  /** 切视图（Push 339）：先关掉旧视图的浮层卡 / 数据详情（详情对应的柱段已不在画面上）。 */
  const switchView = (next: "progress" | "status"): void => {
    setView(next);
    setTip(null);
    setHoverRow(null);
    setDetail(null);
  };

  if (state === "failed") {
    return <div className="hub-dash-state">{t("hub.dash.failed")}</div>;
  }
  if (state !== "ready" || data === null) {
    return (
      <div className="hub-dash-state">
        <Loader />
      </div>
    );
  }
  const progress = pickedId === null ? data.all : data.byProject.get(pickedId) ?? data.all;
  /** 任务状态分布（Push 339）：与进度同一套项目选择（同一轮取数里分桶，切换不发请求）。 */
  const statusView = pickedId === null ? data.statusAll : data.statusByProject.get(pickedId) ?? data.statusAll;
  /** 标题条：<视图名>·<选择器>（选择器里的当前项就是标题的后半段；视图名随底部切换走）。 */
  const pickedName = pickedId !== null ? data.options.find((option) => option.id === pickedId)?.name ?? t("hub.dash.allProjects") : t("hub.dash.allProjects");
  /** 只有选中具体项目才能点开数据详情（「全部项目」= 混合来源，不给来源明细 —— 业务口径；柱段 / 扇区同一套）。 */
  const canDrill = pickedId !== null;
  /** 选择器选项（Push 336）：第一行固定「全部项目」（value ""），其余按项目名。 */
  const pickOptions: readonly SearchSelectOption[] = [{ value: "", label: t("hub.dash.allProjects") }, ...data.options.map((option) => ({ value: option.id, label: option.name }))];
  /** 选中项目（Push 336）：立即上屏并按账号记住（乐观）；切项目即关掉已开的数据详情。 */
  const pickProject = (next: string | null): void => {
    setPickedId(next);
    setDetail(null);
    void onDashProjectChange(next);
  };
  const head = (
    <div className="hub-dash-head">
      <span className="hub-dash-title">{view === "progress" ? t("hub.dash.title") : t("hub.dash.status.title")}</span>
      <span className="hub-dash-sep" aria-hidden="true">
        •
      </span>
      <div className="hub-dash-pick">
        <SearchSelect
          options={pickOptions}
          value={pickedId ?? ""}
          onChange={(value) => pickProject(value === "" ? null : value)}
          placeholder={t("hub.dash.allProjects")}
          ariaLabel={t("hub.dash.pickProject")}
          searchPlaceholder={t("hub.dash.pickSearch")}
          emptyText={t("hub.dash.pickEmpty")}
        />
      </div>
    </div>
  );
  if (progress.totalTasks === 0) {
    return (
      <div ref={wrapRef} className="hub-dash-wrap">
        {head}
        <div className="hub-dash-state">{t("hub.dash.empty")}</div>
      </div>
    );
  }
  const rows = progress.rows;
  const maxTotal = rows.reduce((max, row) => Math.max(max, row.total), 0);
  const { max: tickMax, step } = tickMaxOf(maxTotal);
  const unit = PLOT_W / tickMax;
  const rowH = (AXIS_Y - ROWS_TOP) / rows.length;
  const barH = Math.min(BAR_MAX_H, Math.max(rowH - 12, 16));
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) {
    ticks.push(value);
  }
  const barYOf = (index: number): number => ROWS_TOP + index * rowH + (rowH - barH) / 2;
  return (
    <div ref={wrapRef} className="hub-dash-wrap">
      {head}
      {view === "progress" ? (
        <svg className="hub-dash" viewBox={"0 0 " + VIEW_W + " " + VIEW_H} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("hub.dash.aria")}>
          <defs>
            {rows.map((row, index) => (
              <clipPath key={row.key} id={uid + "-clip-" + index}>
                <rect x={PLOT_X0} y={barYOf(index)} width={Math.max(row.total * unit, 0)} height={barH} rx={6} />
              </clipPath>
            ))}
          </defs>
          {LEGEND_KEYS.map((key, index) => (
            <g key={key}>
              <rect className="hub-dash__swatch" data-bin={DASHBOARD_BINS[index]} x={40 + index * 150} y={10} width={14} height={14} rx={3} />
              <text x={60 + index * 150} y={22} fontSize={13} fill="#4b5563">{t(key)}</text>
            </g>
          ))}
          {ticks.map((value) => (
            <line key={value} x1={PLOT_X0 + value * unit} y1={ROWS_TOP - 8} x2={PLOT_X0 + value * unit} y2={AXIS_Y} stroke="#e5e7eb" strokeDasharray="3,4" />
          ))}
          {rows.map((row, index) => {
            const barY = barYOf(index);
            const baseline = barY + barH / 2 + 4.5;
            let cursor = PLOT_X0;
            const rowText = row.isUngrouped ? t("hub.dash.ungrouped") : stageText(locale, row.label);
            return (
              <g key={row.key} onMouseEnter={() => setHoverRow(row.key)} onMouseLeave={() => { setHoverRow(null); setTip(null); }}>
                {hoverRow === row.key ? (
                  <rect className="hub-dash__rowband" x={16} y={barY - 7} width={VIEW_W - 32} height={barH + 14} rx={8} />
                ) : null}
                <text x={LABEL_X} y={baseline} textAnchor="end" fontSize={14.5} fill="#374151">{rowText}</text>
                <g clipPath={"url(#" + uid + "-clip-" + index + ")"}>
                  {row.counts.map((count, bin) => {
                    if (count === 0) {
                      return null;
                    }
                    const width = count * unit;
                    const x = cursor;
                    cursor += width;
                    return (
                      <g
                        key={bin}
                        onMouseEnter={(event) => showTip(event, rowText, bin, count)}
                        onMouseMove={(event) => showTip(event, rowText, bin, count)}
                        onMouseLeave={() => setTip(null)}
                        onClick={canDrill ? () => {
                          setTip(null);
                          setDetail({ kind: "cell", rowKey: row.key, bin });
                        } : undefined}
                      >
                        <rect className="hub-dash__seg" data-bin={DASHBOARD_BINS[bin]} data-drill={canDrill ? "true" : "false"} x={x} y={barY} width={width} height={barH} />
                        {width >= 24 ? (
                          <text className="hub-dash__num" data-tone={bin === 0 || bin === 2 ? "dark" : "light"} x={x + width / 2} y={baseline} textAnchor="middle" fontSize={13} fontWeight={600}>{count}</text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
                <text x={TOTAL_X} y={baseline} fontSize={13} fill="#9ca3af">{row.total}</text>
              </g>
            );
          })}
          <line x1={PLOT_X0 - 8} y1={AXIS_Y} x2={PLOT_X1 + 8} y2={AXIS_Y} stroke="#b8bec6" />
          {ticks.map((value) => (
            <text key={value} x={PLOT_X0 + value * unit} y={TICK_LABEL_Y} textAnchor="middle" fontSize={12} fill="#8a9099">{value}</text>
          ))}
        </svg>
      ) : (
        <HubDashStatus
          status={statusView}
          canDrill={canDrill}
          onTip={showStatusTip}
          onLeave={() => setTip(null)}
          onPick={(slice) => {
            setTip(null);
            setDetail({ kind: "status", status: slice.status });
          }}
        />
      )}
      <div className="hub-dash-switch">
        <DashViewSwitch view="progress" checked={view === "progress"} label={t("hub.dash.title")} onSelect={() => switchView("progress")} />
        <DashViewSwitch view="status" checked={view === "status"} label={t("hub.dash.status.title")} onSelect={() => switchView("status")} />
      </div>
      {tip !== null ? (
        tip.kind === "bin" ? (
          <div className="hub-dash-tip" style={{ left: tip.left, top: tip.top }}>
            <div className="hub-dash-tip__row">{tip.row}</div>
            <div className="hub-dash-tip__line">
              <span className="hub-dash-tip__dot" data-bin={DASHBOARD_BINS[tip.bin]} />
              <span className="hub-dash-tip__label">{t(LEGEND_KEYS[tip.bin])}</span>
              <span className="hub-dash-tip__count">{tip.count}</span>
            </div>
          </div>
        ) : (
          <div className="hub-dash-tip hub-dash-tip--status" data-status={tip.status} style={{ left: tip.left, top: tip.top }}>
            <div className="hub-dash-tip__statusTitle">{statusText(locale, tip.status)}</div>
            <div className="hub-dash-tip__statusBody">
              <span className="hub-dash-tip__statusBar" />
              <span className="hub-dash-tip__statusRows">
                <span className="hub-dash-tip__statusRow">
                  <span className="hub-dash-tip__statusLabel">{t("hub.dash.status.count")}</span>
                  <span className="hub-dash-tip__statusValue">{tip.count}</span>
                </span>
                <span className="hub-dash-tip__statusRow">
                  <span className="hub-dash-tip__statusLabel">{t("hub.dash.status.share")}</span>
                  <span className="hub-dash-tip__statusValue">{tip.share}</span>
                </span>
              </span>
            </div>
          </div>
        )
      ) : null}
      {detail !== null && pickedId !== null ? (
        <HubDashDetail
          projectName={pickedName}
          manager={data.managerByProject.get(pickedId) ?? ""}
          tasks={(data.tasksByProject.get(pickedId) ?? []).filter((task) => detail.kind === "cell" ? isTaskInCell(task, detail.rowKey, detail.bin) : displayStatusLabel(task.displayStatus) === detail.status)}
          onClose={() => {
            setDetail(null);
          }}
        />
      ) : null}
    </div>
  );
}
