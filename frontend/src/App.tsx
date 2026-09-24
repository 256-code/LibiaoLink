import { useEffect, useState } from "react";
import Hub from "./Hub";
import Home from "./Home";
import PlaceholderPage from "./PlaceholderPage";
import ProjectDetail from "./ProjectDetail";
import { ApiError, apiFetch, redirectToLogin } from "./api";
import { Loader } from "./components/Loader";
import { ProjectModal, type ProjectDraft } from "./components/ProjectModal";
import type { DictTools } from "./dictTools";
import { hasPermission, loadMyPermissions, type MyPermissions } from "./permissions";
import {
  createDictItem,
  deleteDictItem,
  EMPTY_DICTS,
  loadDicts,
  nextDictSort,
  type DictTypeCode,
  type DictTypeResult,
  type Dicts,
} from "./dicts";
import { directoryMemberOptions, loadDirectory, type DirectoryUser } from "./directory";
import { createProject, deleteProject, fetchProject, toUiProject, updateProject } from "./projectApi";
import { loadMyPreferencesWithLegacyMigration, saveFocusMode, saveHomeSavedFilters, saveTaskTableHiddenColumns } from "./preferencesApi";
import type { SavedFilter } from "./savedFilters";
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
    if (error.code === "DICT_ITEM_EXISTS") {
      return "该名称已被占用：请换一个名称，或联系管理员处理。";
    }
    if (error.code === "DICT_ITEM_IN_USE") {
      // A3 删除守卫（Push 174）：服务端文案自带「哪个条目 + 多少个项目在用」，原样透出比前端复述更准。
      return error.message;
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
  // 参考数据：字典（地区 / 项目类型 + 主题色）、用户目录（项目经理）与本人偏好（常用筛选）；失败不阻塞登录，页面用兜底值
  const [dicts, setDicts] = useState<Dicts>(EMPTY_DICTS);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  // 常用筛选（A24 · Push 169 落库）：按账号存服务端，换设备同账号可见（契约 users.ts homeSavedFilters）
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  // 任务表列显隐（A4 · Push 170）：同样按账号存服务端；null = 偏好尚未取到（先用页面默认列）
  const [taskTableHiddenColumns, setTaskTableHiddenColumns] = useState<string[] | null>(null);
  // 醒目模式（A4 · §6.13 · Push 171）：同样按账号存服务端；null = 偏好尚未取到（页面按默认「关」渲染，不回写）
  const [focusMode, setFocusMode] = useState<boolean | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  // 详情页数据（GET /projects/{id}）：列表分页外的项目也能直接打开
  const [detail, setDetail] = useState<Project | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // 写操作后 +1：列表与详情按它重新取数（前端不做本地拼接，以服务端返回为准）
  const [dataVersion, setDataVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** 权限画像（Push 172 重新接线）：管理入口的呈现层收敛 —— 字典治理（dict.manage）与删除项目（project.delete）。 */
  const [permissions, setPermissions] = useState<MyPermissions | null>(null);
  /** 待确认删除的项目（卡片删除先出确认条，第二下才真删）：null = 没有待确认的删除。 */
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
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
        const [dictResult, directoryResult, prefsResult, permissionsResult] = await Promise.allSettled([
          loadDicts(),
          loadDirectory(),
          loadMyPreferencesWithLegacyMigration(),
          loadMyPermissions(),
        ]);
        if (cancelled) {
          return;
        }
        if (dictResult.status === "fulfilled") {
          setDicts(dictResult.value);
        }
        if (permissionsResult.status === "fulfilled") {
          setPermissions(permissionsResult.value);
        }
        if (directoryResult.status === "fulfilled") {
          setDirectory(directoryResult.value);
        }
        if (prefsResult.status === "fulfilled") {
          setSavedFilters(prefsResult.value.homeSavedFilters);
          setTaskTableHiddenColumns(prefsResult.value.taskTableHiddenColumns);
          setFocusMode(prefsResult.value.focusMode);
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
      });
      setDataVersion((value) => value + 1);
      return null;
    } catch (error: unknown) {
      return errorMessageOf(error, "创建项目失败");
    }
  };

  /** 字典写操作后的缓存替换（Push 173）：只换**当前类型**（写响应只带该类型；不本地拼接顺序，以服务端返回为准）。 */
  const applyDictType = (type: DictTypeCode, result: DictTypeResult): void => {
    setDicts((previous) => (type === "region" ? { ...previous, region: result.items } : { ...previous, projectType: result.items }));
  };

  /**
   * 字典「＋ 添加」（Push 167 地区起；Push 172 抽成两类共用一个实现）：写**数据字典**（C9-01 读 / C9-02 写）——
   * region 任何登录用户都能加（Push 168 业务口径「全站共享、非管理员也能加」）、projectType 需 dict.manage；
   * 保存后全站可见（所有项目的下拉都能选到）、可在首页按它筛选。码重复 409 / 无权限 403 由浮层内联提示。
   * Push 173：删除 = **物理删行**，删除无记忆 —— 同码可重新新增（按全新条目：本次颜色、排到末尾），界面无「恢复」字样。
   */
  const handleDictAdd: DictTools["onAdd"] = async (type, input) => {
    try {
      applyDictType(
        type,
        await createDictItem(type, {
          code: input.name,
          name: input.name,
          sort: nextDictSort(dicts[type]),
          enabled: true,
          metadata: input.metadata,
        }),
      );
      return null;
    } catch (error: unknown) {
      return errorMessageOf(error, type === "region" ? "添加地区失败" : "添加项目类型失败");
    }
  };

  /**
   * 字典「删除」（Push 173 起 = **物理删行**，C9-02 修订）：仅管理员（dict.manage，服务端裁决）。
   * 删除不影响存量数据展示（项目仍按原码 / 原名渲染；projects.region / project_type 是 text 冗余码，无外键），
   * 只是不再进下拉候选与首页筛选项；成功后条目立刻从候选里消失，同码可重新新增。
   * Push 174 引用守卫：被项目卡片引用的条目不给删 —— 前端删除位已置灰，万一缓存陈旧，服务端仍回 409 DICT_ITEM_IN_USE。
   */
  const handleDictDelete: DictTools["onDelete"] = async (type, code) => {
    try {
      applyDictType(type, await deleteDictItem(type, code));
      return null;
    } catch (error: unknown) {
      return errorMessageOf(error, type === "region" ? "删除地区失败" : "删除项目类型失败");
    }
  };

  /**
   * 删除项目（A5；Push 172 接上入口）：软删 + If-Match 回传当前 version 防误删；卡片上的删除是隐式的，
   * 点一下先出确认条（项目是数据级操作），确认后才调 DELETE —— 成功后 dataVersion +1 刷新列表 / 详情。
   */
  const handleConfirmDeleteProject = async (): Promise<void> => {
    const project = pendingDelete;
    if (project === null) {
      return;
    }
    setPendingDelete(null);
    try {
      await deleteProject(project.id, project.version);
      setDataVersion((value) => value + 1);
    } catch (error: unknown) {
      setNotice(errorMessageOf(error, "删除项目失败"));
    }
  };

  /**
   * 常用筛选（A24 · Push 169）：整体替换 PATCH —— 乐观更新（胶囊立即出现 / 消失），服务端返回后以它为准。
   * 失败回滚到上一次状态（服务端没落库，界面不能停在假状态）并把文案交给 Home 顶部的提示条。
   */
  const handleSaveSavedFilters = async (items: SavedFilter[]): Promise<string | null> => {
    const previous = savedFilters;
    setSavedFilters(items);
    try {
      const prefs = await saveHomeSavedFilters(items);
      setSavedFilters(prefs.homeSavedFilters);
      return null;
    } catch (error: unknown) {
      setSavedFilters((current) => (current === items ? previous : current));
      return errorMessageOf(error, "常用筛选保存失败");
    }
  };

  /**
   * 任务表列显隐（A4 · Push 170）：整体替换 PATCH —— 与常用筛选同一套乐观更新 + 失败回滚；
   * 返回文案交给 ProjectDetail 的提示条。
   */
  const handleSaveTaskHiddenColumns = async (keys: string[]): Promise<string | null> => {
    const previous = taskTableHiddenColumns;
    setTaskTableHiddenColumns(keys);
    try {
      const prefs = await saveTaskTableHiddenColumns(keys);
      setTaskTableHiddenColumns(prefs.taskTableHiddenColumns);
      return null;
    } catch (error: unknown) {
      setTaskTableHiddenColumns((current) => (current === keys ? previous : current));
      return errorMessageOf(error, "列显隐保存失败");
    }
  };

  /**
   * 醒目模式（A4 · §6.13 · Push 171）：点一下即生效 + 单键 PATCH —— 与列显隐同一套乐观更新 + 失败回滚；
   * 返回文案交给 ProjectDetail 的提示条（服务端没落库，界面不能停在假状态）。
   */
  const handleSaveFocusMode = async (value: boolean): Promise<string | null> => {
    const previous = focusMode;
    setFocusMode(value);
    try {
      const prefs = await saveFocusMode(value);
      setFocusMode(prefs.focusMode);
      return null;
    } catch (error: unknown) {
      setFocusMode((current) => (current === value ? previous : current));
      return errorMessageOf(error, "醒目模式保存失败");
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
   * 任务字段被编辑（M3-07 刀 1 后半接线）：任务写入会 touch 项目 updated_at（ADR-022 ④），
   * 这里只轻量刷新项目列表（详情里那一行已由 ProjectDetail 自己回读），下次回到首页能看到新时间。
   */
  const handleTaskEdited = (_id: string): void => {
    void _id;
    setDataVersion((value) => value + 1);
  };

  /** 字典下拉的「自定义 + 删除」能力（新建与编辑弹窗共用同一份）。 */
  const dictTools: DictTools = {
    onAdd: handleDictAdd,
    onDelete: handleDictDelete,
  };

  /** 权限分叉（Push 172）：字典治理 = dict.manage；删项目 = project.delete（服务端逐请求仍是最终裁决）。 */
  const canManageDicts = hasPermission(permissions, "dict.manage");
  const canDeleteProject = hasPermission(permissions, "project.delete");
  /**
   * 建 / 改项目（Push 173）：画像**未到时乐观放行**（网络抖动不该把有权限的账号挡在门外；服务端仍是最终裁决），
   * 已知缺位才收敛入口 —— 首页「新建项目」出禁用观感 + 提示条、卡片编辑入口不渲染。
   */
  const canCreateProject = permissions === null || hasPermission(permissions, "project.create");
  const canUpdateProject = permissions === null || hasPermission(permissions, "project.update");

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

  /**
   * 底部提示区（一个 fixed 容器装两条，避免同时出现时叠在一起）：
   * ① 删除项目确认条（Push 172：卡片隐式删除的第二下）—— 非阻断式确认，项目是数据级操作；
   * ② 既有错误提示条（如项目经理修改失败）。
   */
  const bottomBars = (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {pendingDelete === null ? null : (
        <div
          role="dialog"
          aria-label="确认删除项目"
          className="pointer-events-auto flex items-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 shadow-lg"
        >
          <span>
            删除项目 <span className="font-mono font-semibold">{pendingDelete.code}</span>（{pendingDelete.description}）？删除后列表与详情不再可见。
          </span>
          <button
            type="button"
            onClick={() => {
              setPendingDelete(null);
            }}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              void handleConfirmDeleteProject();
            }}
            className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-medium text-white transition hover:brightness-95"
          >
            删除
          </button>
        </div>
      )}
      {notice === null ? null : (
        <div
          role="alert"
          className="pointer-events-auto flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow-lg"
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
      )}
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
          managerIds: editingProject.managerIds,
          projectType: editingProject.projectType,
          region: editingProject.region,
        }}
        dicts={dicts}
        dictTools={dictTools}
        canManageDicts={canManageDicts}
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
        {bottomBars}
      </>
    );
  }

  if (route.kind === "placeholder") {
    return (
      <>
        <PlaceholderPage me={state.me} page={route.page} section={route.section} />
        {bottomBars}
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
        <ProjectDetail
          me={state.me}
          project={detail}
          view={route.view}
          members={directoryMemberOptions(directory)}
          onChangeManagers={handleChangeManagers}
          onTaskEdited={handleTaskEdited}
          taskHiddenColumns={taskTableHiddenColumns}
          onTaskHiddenColumnsChange={handleSaveTaskHiddenColumns}
          focusMode={focusMode}
          onFocusModeChange={handleSaveFocusMode}
        />
        {editModal}
        {bottomBars}
      </>
    );
  }

  return (
    <>
      <Home
        me={state.me}
        dicts={dicts}
        directory={directory}
        dictTools={dictTools}
        canManageDicts={canManageDicts}
        canDeleteProject={canDeleteProject}
        canCreateProject={canCreateProject}
        canUpdateProject={canUpdateProject}
        onDeleteProject={(project) => {
          setPendingDelete(project);
        }}
        savedFilters={savedFilters}
        onSavedFiltersChange={handleSaveSavedFilters}
        onCreate={handleCreateProject}
        onEdit={setEditingProject}
        refreshToken={dataVersion}
      />
      {editModal}
      {bottomBars}
    </>
  );
}
