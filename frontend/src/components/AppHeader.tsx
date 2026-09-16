import { useEffect, useRef, useState } from "react";
import type { MeResponse, Project } from "../types";

type AppHeaderProps = {
  me: MeResponse;
  project?: Project | null;
};

export function AppHeader({ me, project }: AppHeaderProps) {
  const user = me.user;
  const displayName = user.displayName ?? user.name ?? "未署名用户";
  const contact = user.email ?? user.name ?? "—";
  const initial = Array.from(displayName)[0] ?? "—";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-6">
        <a href="#/" className="flex shrink-0 items-center gap-3">
          <img src="/libiaolink-logo.svg" alt="LibiaoLink" className="h-11 w-auto" />
          <div className="leading-tight">
            <p className="text-base font-semibold text-zinc-900">LibiaoLink</p>
            <p className="text-xs text-zinc-500">立镖全链路信息平台</p>
          </div>
        </a>
        {project ? (
          <div className="mx-1 hidden min-w-0 border-l border-zinc-200 pl-4 lg:block">
            <p className="truncate text-xs text-zinc-500">
              <a href="#/" className="transition hover:text-zinc-800">项目空间</a>
              <span className="mx-1.5 text-zinc-300">/</span>
              <span className="font-mono text-[13px] font-semibold text-zinc-900">{project.title}</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {project.description} · 项目经理：{project.manager} · 更新于 {project.updatedAt}
            </p>
          </div>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              title={displayName + " · " + contact}
              aria-label="账号菜单"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              {initial}
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-2 w-32 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
              >
                <a
                  role="menuitem"
                  href="/auth/logout"
                  className="block px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100"
                >
                  退出登录
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
