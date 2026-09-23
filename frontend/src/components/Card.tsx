import type { CSSProperties, ReactNode } from "react";
import { RowDeleteButton } from "./RowDeleteButton";

/**
 * 项目卡片（首页）：主题色由字典 projectType 条目的 metadata.accent / accentText 下发（M2-07 · A3），
 * 前端不再硬编码「类型 → 颜色」映射；缺省色在 dicts.ts 的 typeAccent 里兜底。
 * 底部动作条（Push 172）：编辑与删除都是**隐式**的 —— 静止不显示，鼠标悬停卡片 / 键盘聚焦才浮现；
 * 删除 = 任务表行内同款（RowDeleteButton，红底胶囊），排在编辑右侧，占固定 48px 槽位、展开不挤动右侧时间。
 */

/** 半透明投影色（悬停光晕用）：十六进制色 → rgba；其它写法（rgb / 变量）原样返回。 */
function glowOf(color: string): string {
  const hex = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + String(r) + ", " + String(g) + ", " + String(b) + ", 0.35)";
  }
  return hex;
}

type CardProps = {
  seqNo: number;
  code: string;
  description: string;
  /** 项目类型展示名（字典 name；未知码回落码本身）。 */
  typeLabel: string;
  /** 主题色（字典 metadata.accent）。 */
  accentColor?: string;
  /** 徽标文字色（字典 metadata.accentText；浅色底用深灰）。 */
  accentText?: string;
  icon?: ReactNode;
  /** 项目经理展示文本（多位时按「、」连接；Push 136）。 */
  managerNames: string;
  time: string;
  /** 编辑入口（隐式：悬停 / 聚焦才显示）。 */
  onEdit?: () => void;
  /** 删除项目（软删，隐式：与编辑同款；不传 = 不渲染）。 */
  onDelete?: () => void;
};

export function Card({
  seqNo,
  code,
  description,
  typeLabel,
  accentColor = "#feca04",
  accentText = "#313033",
  icon,
  managerNames,
  time,
  onEdit,
  onDelete,
}: CardProps) {
  const seqNoText = String(seqNo).padStart(2, "0");
  const style = { "--card-glow": glowOf(accentColor) } as CSSProperties;
  return (
    <div
      style={style}
      className="project-card group w-full bg-white shadow-[0px_0px_15px_rgba(0,0,0,0.09)] p-7 space-y-3 relative overflow-hidden transition-all duration-300 hover:scale-[1.02]"
    >
      <span
        style={{ backgroundColor: accentColor, color: accentText }}
        className="absolute top-0 left-0 rounded-br-xl px-3 py-1 text-[11px] font-semibold tracking-wide"
      >
        {typeLabel}
      </span>
      <div className="w-20 h-20 rounded-full absolute -right-5 -top-7 bg-zinc-100">
        <p className="absolute bottom-5 left-6 text-2xl font-medium text-zinc-500" title={"项目序号 " + seqNoText}>{seqNoText}</p>
      </div>
      <div className="flex w-full items-center gap-3">
        {icon ?? <span style={{ backgroundColor: accentColor }} className="car-icon block h-9 w-12 shrink-0" />}
        <p className="min-w-0 truncate text-sm text-zinc-400">
          项目经理：<span className="font-medium text-zinc-600" title={managerNames}>{managerNames}</span>
        </p>
      </div>
      <h1 className="font-mono text-xl font-bold tracking-tight">{code}</h1>
      <p className="text-lg text-zinc-500 leading-7">{description}</p>
      <div className="flex items-center gap-3">
        {onEdit === undefined ? null : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            aria-label="编辑项目"
            title="编辑项目"
            className="relative z-10 -ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400/70 opacity-0 transition duration-200 group-hover:text-zinc-400 group-hover:opacity-100 hover:bg-white hover:text-zinc-700 hover:shadow-xs focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onDelete === undefined ? null : (
          <span className="flex h-6 w-12 shrink-0 items-center">
            <RowDeleteButton
              onDelete={() => {
                onDelete();
              }}
              label="删除项目"
            />
          </span>
        )}
        <p className="ml-auto font-mono text-sm text-zinc-400">{time}</p>
      </div>
    </div>
  );
}
