import { useState } from "react";
import { PROGRESS_STEPS, progressStep } from "../data/tasks";

type TrackerProps = {
  progress: number;
  steps?: number;
  onChange?: (progress: number) => void;
};

export const TRACKER_STEPS = PROGRESS_STEPS;

export const TRACKER_LABELS = ["未开始", "刚开工", "完成一半", "快完成了", "完成了"];

/** 格数换算与 `data/tasks.ts` 共用一套口径（Push 65 起任务状态与进度条联动）。 */
export const trackerStep = progressStep;

export function trackerLabel(progress: number, steps: number = TRACKER_STEPS): string {
  return TRACKER_LABELS[trackerStep(progress, steps)] ?? "";
}

export function Tracker({ progress, steps = TRACKER_STEPS, onChange }: TrackerProps) {
  const [hovered, setHovered] = useState(0);
  const filled = trackerStep(progress, steps);
  const active = hovered > 0 ? hovered : filled;
  const label = TRACKER_LABELS[active] ?? "";

  return (
    <span
      className="flex shrink-0 items-center gap-2"
      title={"项目进度：" + label}
      onMouseLeave={() => setHovered(0)}
    >
      <span
        className={
          "w-12 text-right text-[11px] text-zinc-500 transition-opacity " +
          (hovered > 0 ? "opacity-100" : "opacity-0")
        }
      >
        {label}
      </span>
      <span className="flex items-end gap-1">
        {Array.from({ length: steps }, (_item, index) => {
          const step = index + 1;
          const on = step <= filled || step <= hovered;
          const next = step === filled ? step - 1 : step;
          return (
            <button
              key={step}
              type="button"
              aria-label={"设置进度 " + (TRACKER_LABELS[step] ?? "")}
              onClick={(event) => {
                event.stopPropagation();
                onChange?.(next / steps);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              onMouseEnter={() => setHovered(step)}
              onFocus={() => setHovered(step)}
              onBlur={() => setHovered(0)}
              className={
                "block h-4 w-1.5 cursor-pointer rounded-sm transition-colors " +
                (on ? "bg-emerald-500" : "bg-zinc-200")
              }
            />
          );
        })}
      </span>
    </span>
  );
}
