import type { ReactNode } from "react";
import type { CardAccent, ProjectType } from "../types";

const ACCENT_STYLES: Record<CardAccent, { icon: string; hover: string; badge: string }> = {
  blue: { icon: "bg-blue-500", hover: "hover:shadow-[0_12px_28px_rgba(59,130,246,0.35)]", badge: "bg-blue-500 text-white" },
  emerald: { icon: "bg-emerald-500", hover: "hover:shadow-[0_12px_28px_rgba(16,185,129,0.35)]", badge: "bg-emerald-500 text-white" },
  amber: { icon: "bg-[#feca04]", hover: "hover:shadow-[0_12px_28px_rgba(254,202,4,0.35)]", badge: "bg-[#feca04] text-[#313033]" },
  // 预留：未来新增项目类型时启用（如红色 rb / 紫色 vt），当前仅保留蓝 / 绿 / 橙三种
  // rose: { icon: "bg-rose-500", hover: "hover:shadow-[0_12px_28px_rgba(244,63,94,0.35)]", badge: "bg-rose-500 text-white" },
  // violet: { icon: "bg-violet-500", hover: "hover:shadow-[0_12px_28px_rgba(139,92,246,0.35)]", badge: "bg-violet-500 text-white" },
};

type CardProps = {
  seqNo: number;
  code: string;
  description: string;
  accent?: CardAccent;
  projectType: ProjectType;
  icon?: ReactNode;
  managerName: string;
  time: string;
  onEdit?: () => void;
};

export function Card({ seqNo, code, description, accent = "blue", projectType, icon, managerName, time, onEdit }: CardProps) {
  const styles = ACCENT_STYLES[accent];
  const seqNoText = String(seqNo).padStart(2, "0");
  return (
    <div
      className={
        "group w-full bg-white shadow-[0px_0px_15px_rgba(0,0,0,0.09)] p-7 space-y-3 relative overflow-hidden transition-all duration-300 hover:scale-[1.02] " +
        styles.hover
      }
    >
      <span className={"absolute top-0 left-0 rounded-br-xl px-3 py-1 text-[11px] font-semibold tracking-wide " + styles.badge}>
        {projectType}
      </span>
      <div className="w-20 h-20 rounded-full absolute -right-5 -top-7 bg-zinc-100">
        <p className="absolute bottom-5 left-6 text-2xl font-medium text-zinc-500" title={"项目序号 " + seqNoText}>{seqNoText}</p>
      </div>
      <div className="flex w-full items-center gap-3">
        {icon ?? <span className={"car-icon block h-9 w-12 shrink-0 " + styles.icon} />}
        <p className="text-sm text-zinc-400">
          项目经理：<span className="font-medium text-zinc-600">{managerName}</span>
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
            className="relative z-10 -ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400/70 transition duration-200 group-hover:text-zinc-400 hover:bg-white hover:text-zinc-700 hover:shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <p className="ml-auto font-mono text-sm text-zinc-400">{time}</p>
      </div>
    </div>
  );
}
