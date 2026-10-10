import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { clearHomePrefs } from "../homePrefs";
import { clearLegacyPlanBoard } from "../myPlan";
import { hasPermission, loadMyPermissions, type MyPermissions } from "../permissions";
import { AUDIT_BASE_HASH, FILES_BASE_HASH, goBackToList, goUpLevel, listHref, upLevelHref } from "../useHashRoute";
import { TopNav } from "./TopNav";
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
  const [permissions, setPermissions] = useState<MyPermissions | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const homeHref = listHref();
  const upHref = upLevelHref();
  const seqNoText = project ? String(project.seqNo).padStart(2, "0") : "";
  /** 「操作记录」菜单项（audit.view）：管理面入口，画像未到 / 无权限不渲染。 */
  const canViewAudit = hasPermission(permissions, "audit.view");
  /** 「文件库」菜单项（Push 261）：文件库页（#/files）全账号可见 —— 读面按项目可见性放开（无单独权限位），
   *  「彻底删除」入口在页面内按 admin 角色收敛。 */

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

  // 「操作记录」入口的权限位（audit.view · C7-04 管理员查询页）：画像未到 / 拉取失败 = 不渲染入口（服务端逐请求仍是最终裁决）。
  useEffect(() => {
    let alive = true;
    loadMyPermissions()
      .then((profile) => {
        if (alive) {
          setPermissions(profile);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 站内跳转统一拦截：带修饰键点击（新标签 / 新窗口）交给浏览器默认行为
  const interceptNav = (action: () => void) => (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    action();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-6">
        <a href={upHref} onClick={interceptNav(goUpLevel)} title="返回上一层级" className="flex shrink-0 items-center gap-3">
          <img src="/libiaolink-logo.svg" alt="LibiaoLink" className="h-11 w-auto" />
          <div className="leading-tight">
            <p className="text-base font-semibold text-zinc-900">LibiaoLink</p>
            <p className="text-xs text-zinc-500">立镖全链路信息平台</p>
          </div>
        </a>
        {/* 顶部导航栏（业务口径 2026-09-30「我要做顶部导航栏 分别是首页 项目空间 任务模版 我的任务」）：
            四个纯文字导航项常驻（同日续口径「去除这个液态效果 只保留文字」）；原来的大页名（项目空间 / 任务模板 / 我的任务）
            由导航的当前项接管，不再重复显示。 */}
        <TopNav />
        {project ? (
          <div className="mx-1 hidden min-w-0 border-l border-zinc-200 pl-4 lg:block">
            <p className="truncate text-xs text-zinc-500">
              <a href={homeHref} onClick={interceptNav(goBackToList)} className="transition hover:text-zinc-800">项目空间</a>
              <span className="mx-1.5 text-zinc-300">/</span>
              <span className="text-zinc-500">
                序号{" "}
                <span className="font-mono text-[13px] font-medium text-zinc-600">{seqNoText}</span>
              </span>
              <span className="mx-1.5 text-zinc-300">/</span>
              <span className="font-mono text-[13px] font-semibold text-zinc-900">{project.code}</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {project.description} · 创建于 {project.createdAt}
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
              className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 hover:text-zinc-900 hover:shadow-[0_6px_18px_rgba(15,23,42,0.18)] active:shadow-[0_2px_8px_rgba(15,23,42,0.16)] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              {initial}
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="menu-pop absolute right-0 top-full z-20 mt-2 w-36 overflow-hidden rounded-xl border border-zinc-200/80 bg-white p-1 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.30),0_4px_12px_-4px_rgba(15,23,42,0.14)]"
              >
                <a
                  role="menuitem"
                  href="/auth/logout"
                  onClick={() => {
                    // 退出登录清除本地记忆：多人共用设备时，避免把上一位用户的筛选选择带给下一位
                    clearHomePrefs();
                    // 「我的计划」便签墙：数据在账号里（Push 268 起）；这里只清尚未迁移上云的本机旧键，不带给下一位用户
                    clearLegacyPlanBoard();
                  }}
                  className="block rounded-lg px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
                >
                  退出登录
                </a>
                {canViewAudit ? (
                  <a
                    role="menuitem"
                    data-account-audit="true"
                    href={AUDIT_BASE_HASH}
                    onClick={() => {
                      setMenuOpen(false);
                    }}
                    className="block rounded-lg px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    操作记录
                  </a>
                ) : null}
                <a
                  role="menuitem"
                  data-account-files="true"
                  href={FILES_BASE_HASH}
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                  className="block rounded-lg px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
                >
                  文件库
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
