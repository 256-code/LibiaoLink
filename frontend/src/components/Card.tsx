import type { ReactNode } from "react";

export type CardAccent = "violet" | "blue" | "emerald" | "amber" | "rose";

const ACCENT_STYLES: Record<CardAccent, { icon: string; hover: string }> = {
  violet: { icon: "bg-violet-500", hover: "hover:shadow-[0_12px_28px_rgba(139,92,246,0.35)]" },
  blue: { icon: "bg-blue-500", hover: "hover:shadow-[0_12px_28px_rgba(59,130,246,0.35)]" },
  emerald: { icon: "bg-emerald-500", hover: "hover:shadow-[0_12px_28px_rgba(16,185,129,0.35)]" },
  amber: { icon: "bg-amber-500", hover: "hover:shadow-[0_12px_28px_rgba(245,158,11,0.35)]" },
  rose: { icon: "bg-rose-500", hover: "hover:shadow-[0_12px_28px_rgba(244,63,94,0.35)]" },
};

type CardProps = {
  index: string;
  title: string;
  description: string;
  accent?: CardAccent;
  icon?: ReactNode;
  manager: string;
  time: string;
};

export function Card({ index, title, description, accent = "violet", icon, manager, time }: CardProps) {
  const styles = ACCENT_STYLES[accent];
  return (
    <div
      className={
        "w-full bg-white shadow-[0px_0px_15px_rgba(0,0,0,0.09)] p-7 space-y-3 relative overflow-hidden transition-all duration-300 hover:scale-[1.02] " +
        styles.hover
      }
    >
      <div className="w-20 h-20 rounded-full absolute -right-5 -top-7 bg-zinc-100">
        <p className="absolute bottom-5 left-6 text-2xl font-medium text-zinc-500">{index}</p>
      </div>
      <div className="flex w-full items-center gap-3">
        {icon ?? <span className={"car-icon block h-9 w-12 shrink-0 " + styles.icon} />}
        <p className="text-sm text-zinc-400">
          项目经理：<span className="font-medium text-zinc-600">{manager}</span>
        </p>
      </div>
      <h1 className="font-mono text-xl font-bold tracking-tight">{title}</h1>
      <p className="text-lg text-zinc-500 leading-7">{description}</p>
      <p className="text-right font-mono text-sm text-zinc-400">{time}</p>
    </div>
  );
}
