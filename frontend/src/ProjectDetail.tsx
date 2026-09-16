import { useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { PROJECT_STAGES } from "./data/projects";
import type { MeResponse, Project } from "./types";

type ProjectDetailProps = {
  me: MeResponse;
  project: Project | null;
};

export default function ProjectDetail({ me, project }: ProjectDetailProps) {
  const [activeStage, setActiveStage] = useState<string>(PROJECT_STAGES[0] ?? "项目总览");

  if (project === null) {
    return (
      <div className="min-h-screen">
        <AppHeader me={me} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-10">
          <p className="text-sm text-zinc-500">未找到该项目，可能已被删除。</p>
          <a href="#/" className="mt-4 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4">
            返回项目列表
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader me={me} project={project} />
      <main className="mx-auto w-full max-w-[1440px] px-6 pb-10 pt-6">
        <div className="border-b border-zinc-200">
          <div className="flex gap-1 overflow-x-auto">
            {PROJECT_STAGES.map((stage) => {
              const active = stage === activeStage;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setActiveStage(stage)}
                  className={
                    "-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition " +
                    (active
                      ? "border-zinc-900 text-zinc-900"
                      : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                  }
                >
                  {stage}
                </button>
              );
            })}
          </div>
        </div>

        <section className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <p className="text-sm text-zinc-500">「{activeStage}」内容待接入</p>
          <p className="mt-1 text-xs text-zinc-400">页面跳转已就绪，数据与业务模块后续开发。</p>
        </section>
      </main>
    </div>
  );
}
