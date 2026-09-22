import { useEffect, useState } from "react";
import Hub from "./Hub";
import Home from "./Home";
import PlaceholderPage from "./PlaceholderPage";
import ProjectDetail from "./ProjectDetail";
import { ApiError, apiFetch, redirectToLogin } from "./api";
import { Loader } from "./components/Loader";
import { ProjectModal, type ProjectDraft } from "./components/ProjectModal";
import { EMPTY_DICTS, loadDicts, type Dicts } from "./dicts";
import { directoryMemberOptions, loadDirectory, type DirectoryUser } from "./directory";
import { createProject, fetchProject, toUiProject, updateProject } from "./projectApi";
import { useHashRoute } from "./useHashRoute";
import type { MeResponse, Project } from "./types";

type ViewState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; me: MeResponse }
  | { kind: "error"; message: string };

/** 写失败 → 面向业务的提示（错误码口径《前端功能需求》§3.7）。 */
function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "PROJECT_CODE_EXISTS") {
      return "项目编号已存在，请换一个编号。";
    }
    if (error.code === "VERSION_CONFLICT") {
      return "数据已被他人更新，请刷新后重试。";
    }
    if (error.code === "PROJECT_ARCHIVED") {
      return "项目已归档，不能修改。";
    }
    if (error.code === "VALIDATION_FAILED") {
      const first = error.details[0];
      return first !== undefined && first.message !== "" ? "参数校验失败：" + first.message : "参数校验失败，请检查填写内容。";
    }
    if (error.status === 403) {
      return "没有权限执行该操作。";
    }
    if (error.status === 404) {
      return "项目不存在或无权访问。";
    }
    return error.message + "（" + error.code + "）";
  }
  return fallback + "：网络异常，请稍后重试。";
}

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  // 参考数据：字典（地区 / 项目类型 + 主题色）与用户目录（项目经理）；失败不阻塞登录，页面用兜底值
  const [dicts, setDicts] = useState<Dicts>(EMPTY_DICTS);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  // 详情页数据（GET /projects/{id}）：列表分页外的项目也能直接打开
  const [detail, setDetail] = useState<Project | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // 写操作后 +1：列表与详情按它重新取数（前端不做本地拼接，以服务端返回为准）
  const [dataVersion, setDataVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
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
        if (cancelled) {
          return;
        }
        setState({ kind: "signed-in", me });
        const [dictResult, directoryResult] = await Promise.allSettled([loadDicts(), loadDirectory()]);
        if (cancelled) {
          return;
        }
        if (dictResult.status === "fulfilled") {
          setDicts(dictResult.value);
        }
        if (directoryResult.status === "fulfilled") {
          setDirectory(directoryResult.value);
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

  const detailId = route.kind === "project" ? route.id : null;
  useEffect(() => {
    if (detailId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    const load = async (): Promise<void> => {
      try {
        const view = await fetchProject(detailId);
        if (!cancelled) {
          setDetail(toUiProject(view));
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setDetail(null);
          if (error instanceof ApiError && error.status !== 404) {
            setNotice(errorMessageOf(error, "加载项目失败"));
          }
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [detailId, dataVersion]);

  /** 新建项目（POST）：返回 null = 成功；返回文案 = 弹窗内提示（编号重复等）。 */
  const handleCreateProject = async (draft: ProjectDraft): Promise<string | null> => {
    try {
      await createProject({
        code: draft.code.trim(),
        name: draft.description.trim(),
        region: draft.region,
        projectType: draft.projectType,
        managerIds: draft.managerIds,
        customer: draft.customer.trim() === "" ? undefined : draft.customer.trim(),
        description: draft.note.trim() === "" ? undefined : draft.note.trim(),
      });
      setDataVersion((value) => value + 1);
      return null;
    } catch (error: unknown) {
      return errorMessageOf(error, "创建项目失败");
    }
  };

  /** 编辑项目（PATCH + 乐观锁 version）：返回 null = 成功；返回文案 = 弹窗内提示。 */
  const handleUpdateProject = async (project: Project, draft: ProjectDraft): Promise<string | null> => {
    try {
      await updateProject(
        project.id,
        {
          code: draft.code.trim(),
          name: draft.description.trim(),
          region: draft.region,
          projectType: draft.projectType,
          managerIds: draft.managerIds,
          customer: draft.customer.trim() === "" ? null : draft.customer.trim(),
          description: draft.note.trim() === "" ? null : draft.note.trim(),
        },
        project.version,
      );
      setDataVersion((value) => value + 1);
      return null;
    } catch (error: unknown) {
      return errorMessageOf(error, "保存项目失败");
    }
  };

  /** 任务抽屉 / 任务表里改「项目经理」：项目级字段，走 PATCH（乐观锁 version）。 */
  const handleChangeManagers = (id: string, managerIds: string[]): void => {
    if (detail === null || detail.id !== id) {
      return;
    }
    const current = detail;
    void updateProject(
      id,
      {
        code: current.code,
        name: current.description,
        region: current.region,
        projectType: current.projectType,
        managerIds,
      },
      current.version,
    )
      .then((view) => {
        setDetail(toUiProject(view));
        setDataVersion((value) => value + 1);
      })
      .catch((error: unknown) => {
        setNotice(errorMessageOf(error, "项目经理修改失败"));
      });
  };

  /**
   * 任务字段被编辑：任务域仍是内存态原型（M3-07 接线），服务端没有变化，故只留口子不刷新。
   */
  const handleTaskEdited = (_id: string): void => {
    void _id;
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

  const noticeBar =
    notice === null ? null : (
      <div
        role="alert"
        className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow-lg"
      >
        <span>{notice}</span>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
          }}
          className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium transition hover:bg-rose-100"
        >
          知道了
        </button>
      </div>
    );

  const editModal =
    editingProject === null ? null : (
      <ProjectModal
        key={editingProject.id + ":" + String(editingProject.version)}
        mode="edit"
        initial={{
          code: editingProject.code,
          description: editingProject.description,
          customer: editingProject.customer ?? "",
          note: editingProject.note ?? "",
          managerIds: editingProject.managerIds,
          projectType: editingProject.projectType,
          region: editingProject.region,
        }}
        regions={dicts.region}
        projectTypes={dicts.projectType}
        managerOptions={directoryMemberOptions(directory)}
        onClose={() => {
          setEditingProject(null);
        }}
        onSubmit={async (draft) => {
          const message = await handleUpdateProject(editingProject, draft);
          if (message === null) {
            setEditingProject(null);
          }
          return message;
        }}
      />
    );

  if (route.kind === "hub") {
    return (
      <>
        <Hub me={state.me} />
        {noticeBar}
      </>
    );
  }

  if (route.kind === "placeholder") {
    return (
      <>
        <PlaceholderPage me={state.me} page={route.page} section={route.section} />
        {noticeBar}
      </>
    );
  }

  if (route.kind === "project") {
    if (detailLoading && detail === null) {
      return (
        <main className="page">
          <Loader />
        </main>
      );
    }
    return (
      <>
        <ProjectDetail me={state.me} project={detail} view={route.view} onChangeManagers={handleChangeManagers} onTaskEdited={handleTaskEdited} />
        {editModal}
        {noticeBar}
      </>
    );
  }

  return (
    <>
      <Home me={state.me} dicts={dicts} directory={directory} onCreate={handleCreateProject} onEdit={setEditingProject} refreshToken={dataVersion} />
      {editModal}
      {noticeBar}
    </>
  );
}
