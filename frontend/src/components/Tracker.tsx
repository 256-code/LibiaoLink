import { useState } from "react";
import { PROGRESS_STEPS, progressStep } from "../data/tasks";

type TrackerProps = {
  progress: number;
  steps?: number;
  onChange?: (progress: number) => void;
};

export const TRACKER_STEPS = PROGRESS_STEPS;

export const TRACKER_LABELS = ["未开始", "刚开工", "完成一半", "快完成了", "已完成"];

/** 格数换算与 `data/tasks.ts` 共用一套口径（Push 65 起任务状态与进度条联动）。 */
export const trackerStep = progressStep;

export function trackerLabel(progress: number, steps: number = TRACKER_STEPS): string {
  return TRACKER_LABELS[trackerStep(progress, steps)] ?? "";
}

/** 点第 N 格的换算（口径见 §6.4）：点当前已点亮的最后一格回退一格（误点修正），其余点哪格就是几格。 */
export function trackerNextProgress(progress: number, step: number, steps: number = TRACKER_STEPS): number {
  const filled = trackerStep(progress, steps);
  const next = step === filled ? step - 1 : step;
  return next / steps;
}

/**
 * 四格进度点（Push 92 从 `Tracker` 抽出，任务表与任务详情抽屉共用）：
 * 悬停 / 键盘聚焦即预览到该档，点击写进度；`hovered` 由父级持有 —— 抽屉要拿它把档位文字一起预览。
 */
export function TrackerDots({
  progress,
  steps = TRACKER_STEPS,
  hovered,
  onHoverChange,
  onChange,
}: {
  progress: number;
  steps?: number;
  /** 悬停 / 聚焦中的档位（0 = 没有）。 */
  hovered: number;
  onHoverChange: (step: number) => void;
  onChange?: (progress: number) => void;
}) {
  const filled = trackerStep(progress, steps);

  return (
    <span
      className="flex items-end gap-1"
      onMouseLeave={() => {
        onHoverChange(0);
      }}
    >
      {Array.from({ length: steps }, (_item, index) => {
        const step = index + 1;
        const on = step <= filled || step <= hovered;
        return (
          <button
            key={step}
            type="button"
            aria-label={"设置进度 " + (TRACKER_LABELS[step] ?? "")}
            title={"设置进度：" + (TRACKER_LABELS[step] ?? "")}
            onClick={(event) => {
              event.stopPropagation();
              onChange?.(trackerNextProgress(progress, step, steps));
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onMouseEnter={() => {
              onHoverChange(step);
            }}
            onFocus={() => {
              onHoverChange(step);
            }}
            onBlur={() => {
              onHoverChange(0);
            }}
            className={
              "block h-4 w-1.5 cursor-pointer rounded-sm transition-colors " +
              (on ? "bg-emerald-500" : "bg-zinc-200")
            }
          />
        );
      })}
    </span>
  );
}

export function Tracker({ progress, steps = TRACKER_STEPS, onChange }: TrackerProps) {
  const [hovered, setHovered] = useState(0);
  const filled = trackerStep(progress, steps);
  const active = hovered > 0 ? hovered : filled;
  const label = TRACKER_LABELS[active] ?? "";

  return (
    <span className="flex shrink-0 items-center gap-2" title={"项目进度：" + label}>
      <span
        className={
          "w-12 text-right text-[11px] text-zinc-500 transition-opacity " + (hovered > 0 ? "opacity-100" : "opacity-0")
        }
      >
        {label}
      </span>
      <TrackerDots progress={progress} steps={steps} hovered={hovered} onHoverChange={setHovered} onChange={onChange} />
    </span>
  );
}