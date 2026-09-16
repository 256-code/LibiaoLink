import { useEffect, useState } from "react";
import Home from "./Home";
import ProjectDetail from "./ProjectDetail";
import { INITIAL_PROJECTS } from "./data/projects";
import { useHashRoute } from "./useHashRoute";
import type { CardAccent, MeResponse, Project } from "./types";
import type { NewProjectDraft } from "./components/NewProjectModal";

type ViewState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; me: MeResponse }
  | { kind: "error"; message: string };

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const route = useHashRoute();

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/auth/me", { headers: { Accept: "application/json" } });
        if (cancelled) {
          return;
        }
        if (response.status === 401) {
          setState({ kind: "signed-out" });
          return;
        }
        if (!response.ok) {
          throw new Error("HTTP " + String(response.status));
        }
        const me = (await response.json()) as MeResponse;
        if (!cancelled) {
          setState({ kind: "signed-in", me });
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setState({ kind: "error", message: String(error) });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.kind === "signed-out") {
      window.location.replace("/auth/login");
    }
  }, [state]);

  const handleCreateProject = (draft: NewProjectDraft) => {
    setProjects((previous) => {
      const nextNumber = previous.length + 1;
      const accents: readonly CardAccent[] = ["blue", "emerald", "amber", "rose", "violet"];
      const accent = accents[(nextNumber - 1) % accents.length] ?? "blue";
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const updatedAt =
        String(now.getFullYear()) + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
      return [
        ...previous,
        {
          id: "custom-" + String(nextNumber),
          index: String(nextNumber).padStart(2, "0"),
          title: draft.title.trim(),
          description: draft.description.trim(),
          accent,
          updatedAt,
          manager: draft.manager.trim(),
        },
      ];
    });
  };

  if (state.kind === "loading" || state.kind === "signed-out") {
    return (
      <main className="page">
        <div className="card">
          <p className="muted">正在跳转公司统一登录…</p>
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="page">
        <div className="card">
          <h1>加载失败</h1>
          <p className="muted">{state.message}</p>
          <p>
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              重试
            </button>
          </p>
        </div>
      </main>
    );
  }

  if (route.kind === "project") {
    const project = projects.find((item) => item.id === route.id) ?? null;
    return <ProjectDetail me={state.me} project={project} />;
  }

  return <Home me={state.me} projects={projects} onCreate={handleCreateProject} />;
}
