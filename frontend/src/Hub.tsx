import { AppHeader } from "./components/AppHeader";
import { HubButton } from "./components/HubButton";
import { projectsHref } from "./useHashRoute";
import type { MeResponse } from "./types";

/** 登录后的入口页：页面中间是各业务模块的入口按钮。 */
export default function Hub({ me }: { me: MeResponse }) {
  // 一期固定三个入口；后续增删或调顺序都在这里改
  const entries = [
    { label: "项目空间", href: projectsHref() },
    { label: "任务模板", href: "#/templates" },
    { label: "文件库", href: "#/files" },
  ];

  return (
    <div className="min-h-screen">
      <AppHeader me={me} />
      <main className="flex min-h-[calc(100vh-4rem)] flex-wrap content-center items-center justify-center gap-8 px-6 py-10">
        {entries.map((entry) => (
          <HubButton key={entry.label} label={entry.label} href={entry.href} />
        ))}
      </main>
    </div>
  );
}
