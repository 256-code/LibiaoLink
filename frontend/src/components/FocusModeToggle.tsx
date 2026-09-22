type FocusModeToggleProps = {
  checked: boolean;
  onToggle: (checked: boolean) => void;
};

/**
 * 五个任务状态的色签（Push 134）：口径 = 图一里五个状态色，顺序同状态下拉——
 * 已延期 / 进行中 / 已完成 / 待开始 / 提前完成（与 `TaskBoard.STATUS_TAG_CLASS` 的色系一一对应，取 500 档实色）。
 */
const FOCUS_MODE_TINTS: readonly string[] = ["#f43f5e", "#f59e0b", "#10b981", "#0ea5e9", "#d946ef"];

/** 五个状态色**各占 1/5** 的横向色带（业务口径「各个状态的颜色的平均占比」；硬边分段，一眼看出是平均占比）。 */
const FOCUS_MODE_FILL =
  "linear-gradient(to right, " +
  FOCUS_MODE_TINTS.map((tint, index) => tint + " " + String(index * 20) + "% " + String((index + 1) * 20) + "%").join(", ") +
  ")";

/**
 * 「醒目模式」开关（Push 134，业务口径见 `前端功能需求.md` §6.13）：
 * 外形对齐业务给的参考样式 —— 未勾选 = 白底 + 灰描边圆角方框；勾选 = 方框整体换成五个状态色的平均占比色带；
 * 文字固定「醒目模式」，默认不启用（`checked` 由调用方给，项目总览里默认 false）。
 */
export function FocusModeToggle({ checked, onToggle }: FocusModeToggleProps) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={
          "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-2 shadow-md transition-all duration-500 peer-hover:scale-105 peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-900/25 peer-focus-visible:ring-offset-1 " +
          (checked ? "border-transparent" : "border-zinc-400 bg-white")
        }
        style={checked ? { backgroundImage: FOCUS_MODE_FILL } : undefined}
      />
      <span className="text-sm font-medium text-zinc-700">醒目模式</span>
    </label>
  );
}
