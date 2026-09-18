import { AppHeader } from "./components/AppHeader";
import type { PlaceholderPage as PlaceholderPageKey } from "./useHashRoute";
import type { MeResponse } from "./types";

const PAGES: Record<PlaceholderPageKey, { title: string; note: string }> = {
  templates: { title: "任务模板", note: "任务模板库还没开工：先把入口与路由占好，后续按需求填充。" },
  files: { title: "文件库", note: "文件库还没开工：先把入口与路由占好，后续按需求填充。" },
};

type PlaceholderPageProps = {
  me: MeResponse;
  page: PlaceholderPageKey;
};

/** 占位页：入口页的三个按钮先各自落地，页面内容后续迭代。 */
export default function PlaceholderPage({ me, page }: PlaceholderPageProps) {
  const { title, note } = PAGES[page];
  return (
    <div className="min-h-screen">
      <AppHeader me={me} title={title} />
      <main className="w-full px-6 py-10">
        <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-20 text-center">
          <p className="text-base font-semibold text-zinc-800">{title}</p>
          <p className="mt-2 text-sm text-zinc-500">{note}</p>
          <a href="#/" className="mt-6 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4">
            返回入口页
          </a>
        </div>
      </main>
    </div>
  );
}
