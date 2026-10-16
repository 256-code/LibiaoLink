import type { MouseEvent as ReactMouseEvent } from "react";
import type { DashboardChangeWords } from "../data/changeWords";
import type { DashboardDelivery, DashboardDeliveryBucket, DashboardIssues, DashboardProgress, DashboardStatus, DashboardStatusSlice } from "../data/dashboardProgress";
import { useT } from "../i18n";
import { HubDashDelivery } from "./HubDashDelivery";
import { HubDashIssues, type DashboardIssueRow } from "./HubDashIssues";
import { HubDashProgress } from "./HubDashProgress";
import { HubDashStatus } from "./HubDashStatus";
import { HubDashWordCloud } from "./HubDashWordCloud";
import { Loader } from "./Loader";

/**
 * 仪表盘「数据总览」视图（Push 358 · 业务口径 2026-10-16「我要在最左边加一个数据总览 点击后展示的效果如图所示
 * 各图表等比例缩小集中展示 点击效果 鼠标触碰标签效果依旧」+「项目进度一览改成项目进度字样」）：
 * 五张图等比例缩小并排 —— 左列：项目进度（横条）/ 任务状态（饼）/ 问题（柱）；右列：交付时间（柱）+
 * 词频图（云，跨两行，照业务参考图版式）。每格 = 小标题 + 同款图表组件（viewBox 等比缩放，不改任何几何 /
 * 颜色 / 组件）；悬停浮层卡 / 点击只读「数据详情」与单视图逐项同口径（回调全部复用父组件 HubDashboard
 * 的既有实现，浮层卡 / 弹窗仍挂在 .hub-dash-wrap 这一层）。
 *
 * 「问题 / 词频图」读面懒加载（HubDashboard 的 view 跟随 effect：切到「数据总览」即拉这两份）；
 * 面板内加载 / 失败 / 空态与单视图同文案（Loader / hub.dash.failed / 各自 empty 键）。
 * 布局（两列三行网格 / 隔板）见 app.css 的 .hub-dash-overview*；「全部项目」下与单视图一样不可点。
 */
export function HubDashOverview({ progress, status, delivery, issues, issuesState, words, wordsState, canDrill, onProgressTip, onProgressRowTip, onStatusTip, onIssueTip, onIssueRowTip, onDeliveryTip, onDeliveryRateTip, onWordTip, onLeave, onPickCell, onPickStatus, onPickIssue, onPickDelivery, onPickDeliveryRate, onPickDeliveryNote, onPickWord }: {
  readonly progress: DashboardProgress;
  readonly status: DashboardStatus;
  readonly delivery: DashboardDelivery;
  /** 「问题」数据（懒加载；null = 还没拉过）。 */
  readonly issues: DashboardIssues | null;
  readonly issuesState: "idle" | "loading" | "ready" | "failed";
  /** 「词频图」数据（懒加载；null = 还没拉过）。 */
  readonly words: DashboardChangeWords | null;
  readonly wordsState: "idle" | "loading" | "ready" | "failed";
  readonly canDrill: boolean;
  readonly onProgressTip: (event: ReactMouseEvent<SVGGElement>, rowText: string, bin: number, count: number) => void;
  readonly onProgressRowTip: (event: ReactMouseEvent<SVGRectElement>, rowText: string, counts: readonly number[]) => void;
  readonly onStatusTip: (event: ReactMouseEvent<SVGGElement>, slice: DashboardStatusSlice, share: string) => void;
  readonly onIssueTip: (event: ReactMouseEvent<SVGRectElement>, state: string, category: string, count: number) => void;
  readonly onIssueRowTip: (event: ReactMouseEvent<SVGRectElement>, state: string, rows: readonly DashboardIssueRow[]) => void;
  readonly onDeliveryTip: (event: ReactMouseEvent<SVGRectElement>, bucket: DashboardDeliveryBucket, count: number, share: string) => void;
  readonly onDeliveryRateTip: (event: ReactMouseEvent<SVGRectElement>) => void;
  readonly onWordTip: (event: ReactMouseEvent<SVGTextElement>, word: string, count: number) => void;
  readonly onLeave: () => void;
  readonly onPickCell: (rowKey: string, bin: number) => void;
  readonly onPickStatus: (slice: DashboardStatusSlice) => void;
  readonly onPickIssue: (state: string, category: string) => void;
  readonly onPickDelivery: (bucket: DashboardDeliveryBucket) => void;
  readonly onPickDeliveryRate: () => void;
  readonly onPickDeliveryNote: () => void;
  readonly onPickWord: (word: string) => void;
}) {
  const t = useT();
  return (
    <div className="hub-dash-overview">
      <section className="hub-dash-overview__panel" data-panel="progress">
        <h3 className="hub-dash-overview__title">{t("hub.dash.title")}</h3>
        <div className="hub-dash-overview__chart">
          <HubDashProgress progress={progress} canDrill={canDrill} onTip={onProgressTip} onRowTip={onProgressRowTip} onLeave={onLeave} onPick={onPickCell} />
        </div>
      </section>
      <section className="hub-dash-overview__panel" data-panel="status">
        <h3 className="hub-dash-overview__title">{t("hub.dash.status.title")}</h3>
        <div className="hub-dash-overview__chart">
          <HubDashStatus status={status} canDrill={canDrill} onTip={onStatusTip} onLeave={onLeave} onPick={onPickStatus} />
        </div>
      </section>
      <section className="hub-dash-overview__panel" data-panel="issues">
        <h3 className="hub-dash-overview__title">{t("hub.dash.issues.title")}</h3>
        <div className="hub-dash-overview__chart">
          {issuesState === "ready" && issues !== null ? (
            issues.totalIssues === 0 ? (
              <div className="hub-dash-state">{t("hub.dash.issues.empty")}</div>
            ) : (
              <HubDashIssues issues={issues} canDrill={canDrill} onTip={onIssueTip} onRowTip={onIssueRowTip} onLeave={onLeave} onPick={onPickIssue} />
            )
          ) : issuesState === "failed" ? (
            <div className="hub-dash-state">{t("hub.dash.failed")}</div>
          ) : (
            <div className="hub-dash-state">
              <Loader />
            </div>
          )}
        </div>
      </section>
      <section className="hub-dash-overview__panel" data-panel="delivery">
        <h3 className="hub-dash-overview__title">{t("hub.dash.delivery.title")}</h3>
        <div className="hub-dash-overview__chart">
          <HubDashDelivery delivery={delivery} canDrill={canDrill} onTip={onDeliveryTip} onRateTip={onDeliveryRateTip} onLeave={onLeave} onPick={onPickDelivery} onRatePick={onPickDeliveryRate} onNotePick={onPickDeliveryNote} />
        </div>
      </section>
      <section className="hub-dash-overview__panel" data-panel="wordcloud">
        <h3 className="hub-dash-overview__title">{t("hub.dash.wordcloud.title")}</h3>
        <div className="hub-dash-overview__chart">
          {wordsState === "ready" && words !== null ? (
            words.words.length === 0 ? (
              <div className="hub-dash-state">{t("hub.dash.wordcloud.empty")}</div>
            ) : (
              <HubDashWordCloud words={words} canDrill={canDrill} onTip={onWordTip} onLeave={onLeave} onPick={onPickWord} />
            )
          ) : wordsState === "failed" ? (
            <div className="hub-dash-state">{t("hub.dash.failed")}</div>
          ) : (
            <div className="hub-dash-state">
              <Loader />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
