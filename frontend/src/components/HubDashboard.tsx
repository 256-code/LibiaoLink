import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { DASHBOARD_BINS, isTaskInCell } from "../data/dashboardProgress";
import type { DashboardDataset } from "../dashboardApi";
import { stageText, useLocale, useT, type TextKey } from "../i18n";
import { HubDashDetail } from "./HubDashDetail";
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
 */
export type HubDashboardState = "loading" | "ready" | "failed";

/** 悬停卡（Push 335 · 业务口径「鼠标放上去是这样的效果」）：行名 + 档位色块 + 档位文案 + 该档任务数。
 *  自绘浮层替代浏览器原生 title 灰框（原生框样式不可控、与本页设计不一致）。 */
type DashTip = {
  readonly left: number;
  readonly top: number;
  readonly row: string;
  readonly bin: number;
  readonly count: number;
};

/** 悬停卡尺寸（用于贴边夹紧，避免溢出白卡被裁切）。 */
const TIP_W = 190;
const TIP_H = 84;

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
  /** 悬停卡 + 行高亮（同一行的柱段共用：卡里写行名，图上该行铺一条浅灰底）。 */
  const [tip, setTip] = useState<DashTip | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** 数据详情（Push 335：点柱段打开；记「行键 × 档」，打开时按它筛任务）。 */
  const [detail, setDetail] = useState<{ readonly rowKey: string; readonly bin: number } | null>(null);
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
      left: Math.max(6, Math.min(event.clientX - box.left + 14, box.width - TIP_W - 6)),
      top: Math.max(6, Math.min(event.clientY - box.top + 14, box.height - TIP_H - 6)),
      row: rowText,
      bin,
      count,
    });
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
  /** 标题条：项目进度一览·<选择器>（选择器里的当前项就是标题的后半段）。 */
  const pickedName = pickedId !== null ? data.options.find((option) => option.id === pickedId)?.name ?? t("hub.dash.allProjects") : t("hub.dash.allProjects");
  /** 只有选中具体项目才能点开数据详情（「全部项目」= 混合来源，不给来源明细 —— 业务口径）。 */
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
      <span className="hub-dash-title">{t("hub.dash.title")}</span>
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
                        setDetail({ rowKey: row.key, bin });
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
      {tip !== null ? (
        <div className="hub-dash-tip" style={{ left: tip.left, top: tip.top }}>
          <div className="hub-dash-tip__row">{tip.row}</div>
          <div className="hub-dash-tip__line">
            <span className="hub-dash-tip__dot" data-bin={DASHBOARD_BINS[tip.bin]} />
            <span className="hub-dash-tip__label">{t(LEGEND_KEYS[tip.bin])}</span>
            <span className="hub-dash-tip__count">{tip.count}</span>
          </div>
        </div>
      ) : null}
      {detail !== null && pickedId !== null ? (
        <HubDashDetail
          projectName={pickedName}
          manager={data.managerByProject.get(pickedId) ?? ""}
          tasks={(data.tasksByProject.get(pickedId) ?? []).filter((task) => isTaskInCell(task, detail.rowKey, detail.bin))}
          onClose={() => {
            setDetail(null);
          }}
        />
      ) : null}
    </div>
  );
}
