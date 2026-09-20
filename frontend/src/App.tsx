import { useEffect, useState } from "react";
import Hub from "./Hub";
import Home from "./Home";
import PlaceholderPage from "./PlaceholderPage";
import ProjectDetail from "./ProjectDetail";
import { apiFetch, redirectToLogin } from "./api";
import { Loader } from "./components/Loader";
import { ProjectModal, type ProjectDraft } from "./components/ProjectModal";
import { INITIAL_PROJECTS } from "./data/projects";
import { useHashRoute } from "./useHashRoute";
import { PROJECT_TYPE_ACCENTS } from "./types";
import type { MeResponse, Project } from "./types";

type ViewState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; me: MeResponse }
  | { kind: "error"; message: string };

/** 展示用时间戳（YYYY-MM-DD HH:mm）；接后端后 createdAt 由服务端生成。 */
function nowText(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return String(now.getFullYear()) + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
}

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await apiFetch("/auth/me");
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
      redirectToLogin();
    }
  }, [state]);

  const handleCreateProject = (draft: ProjectDraft) => {
    setProjects((previous) => {
      const nextNumber = previous.reduce((max, project) => Math.max(max, project.seqNo), 0) + 1;
      const timestamp = nowText();
      return [
        ...previous,
        {
          id: "custom-" + String(nextNumber),
          seqNo: nextNumber,
          code: draft.code.trim(),
          description: draft.description.trim(),
          region: "未分类",
          projectType: draft.projectType,
          accent: PROJECT_TYPE_ACCENTS[draft.projectType],
          createdAt: timestamp,
          updatedAt: timestamp,
          managerId: draft.managerId,
        },
      ];
    });
  };

  const handleUpdateProject = (id: string, draft: ProjectDraft) => {
    setProjects((previous) =>
      previous.map((project) =>
        project.id === id
          ? {
              ...project,
              code: draft.code.trim(),
              description: draft.description.trim(),
              projectType: draft.projectType,
              accent: PROJECT_TYPE_ACCENTS[draft.projectType],
              updatedAt: nowText(),
              managerId: draft.managerId,
            }
          : project,
      ),
    );
  };

  /** 任务编辑里改「项目经理」：项目经理是项目级字段（projects.manager_id），回写后本项目所有任务行与项目卡片同步，并刷新项目时间。 */
  const handleChangeManager = (id: string, managerId: string) => {
    setProjects((previous) =>
      previous.map((project) => (project.id === id ? { ...project, managerId, updatedAt: nowText() } : project)),
    );
  };

  /** 任务字段被编辑：按「任务变更刷新项目时间」口径刷新最近活动（updatedAt）。 */
  const handleTaskEdited = (id: string) => {
    setProjects((previous) => previous.map((project) => (project.id === id ? { ...project, updatedAt: nowText() } : project)));
  };

  if (state.kind === "loading") {
    return (
      <main className="page">
        <Loader />
      </main>
    );
  }

  if (state.kind === "signed-out") {
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

  const editModal =
    editingProject === null ? null : (
      <ProjectModal
        key={editingProject.id}
        mode="edit"
        initial={{
          code: editingProject.code,
          description: editingProject.description,
          managerId: editingProject.managerId,
          projectType: editingProject.projectType,
        }}
        onClose={() => {
          setEditingProject(null);
        }}
        onSubmit={(draft) => {
          handleUpdateProject(editingProject.id, draft);
          setEditingProject(null);
        }}
      />
    );

  if (route.kind === "hub") {
    return <Hub me={state.me} />;
  }

  if (route.kind === "placeholder") {
    return <PlaceholderPage me={state.me} page={route.page} section={route.section} />;
  }

  if (route.kind === "project") {
    const project = projects.find((item) => item.id === route.id) ?? null;
    return (
      <>
        <ProjectDetail me={state.me} project={project} onChangeManager={handleChangeManager} onTaskEdited={handleTaskEdited} />
        {editModal}
      </>
    );
  }

  return (
    <>
      <Home me={state.me} projects={projects} onCreate={handleCreateProject} onEdit={setEditingProject} />
      {editModal}
    </>
  );
}
