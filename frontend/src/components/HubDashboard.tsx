import { useEffect, useId, useState } from "react";
import { DASHBOARD_BINS } from "../data/dashboardProgress";
import type { DashboardDataset } from "../dashboardApi";
import { stageText, useLocale, useT, type TextKey } from "../i18n";
import { Loader } from "./Loader";

/**
 * 仪表盘视图（蓝图页「蓝图 ⇄ 仪表盘」转场后半屏 · 2026-10-15 业务口径「鼠标滑动蓝图转场展示仪表盘」）：
 * 阶段 × 进度五档横向堆叠条，口径见 data/dashboardProgress.ts（取数 dashboardApi.ts）。
 *
 * 形态照业务确认过的效果图；按口径「多余的注释和文字不需要」只留标题 + 图例 + 数据，
 * 数据来源 / 口径注释等文字全部去掉。画布 1200 × 660（viewBox 缩放填满面板，永不产生滚动条）。
 * 颜色 / 状态样式见 app.css 的 .hub-dash-*；转场样式见 .hub-deck-*。
 */
export type HubDashboardState = "loading" | "ready" | "failed";

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

export function HubDashboard({ data, state }: { data: DashboardDataset | null; state: HubDashboardState }) {
  const t = useT();
  const locale = useLocale();
  /** 每行一条圆角裁剪（柱条两端圆角、段与段之间直角）：id 需要实例级唯一。 */
  const uid = useId().replace(/:/g, "");
  /** Push 334：项目选择器（第一行固定「全部项目」；选中项目即只统计该项目）。 */
  const [pickedId, setPickedId] = useState<string | null>(null);
  useEffect(() => {
    if (pickedId !== null && data !== null && !data.byProject.has(pickedId)) {
      setPickedId(null);
    }
  }, [data, pickedId]);
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
  const head = (
    <div className="hub-dash-head">
      <span className="hub-dash-title">{t("hub.dash.title")}</span>
      <span className="hub-dash-sep" aria-hidden="true">
        ·
      </span>
      <span className="hub-dash-pick">
        <select
          value={pickedId ?? ""}
          aria-label={t("hub.dash.pickProject")}
          onChange={(event) => setPickedId(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">{t("hub.dash.allProjects")}</option>
          {data.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <svg className="hub-dash-pick__caret" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
  if (progress.totalTasks === 0) {
    return (
      <div className="hub-dash-wrap">
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
    <div className="hub-dash-wrap">
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
          return (
            <g key={row.key}>
              <text x={LABEL_X} y={baseline} textAnchor="end" fontSize={14.5} fill="#374151">{row.isUngrouped ? t("hub.dash.ungrouped") : stageText(locale, row.label)}</text>
              <g clipPath={"url(#" + uid + "-clip-" + index + ")"}>
                {row.counts.map((count, bin) => {
                  if (count === 0) {
                    return null;
                  }
                  const width = count * unit;
                  const x = cursor;
                  cursor += width;
                  const binLabel = t(LEGEND_KEYS[bin]);
                  return (
                    <g key={bin}>
                      <rect className="hub-dash__seg" data-bin={DASHBOARD_BINS[bin]} x={x} y={barY} width={width} height={barH} />
                      {width >= 24 ? (
                        <text className="hub-dash__num" data-tone={bin === 0 || bin === 2 ? "dark" : "light"} x={x + width / 2} y={baseline} textAnchor="middle" fontSize={13} fontWeight={600}>{count}</text>
                      ) : null}
                      <title>{binLabel + " · " + count}</title>
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
    </div>
  );
}
