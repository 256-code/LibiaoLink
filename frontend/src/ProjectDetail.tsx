import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ColumnPicker } from "./components/ColumnPicker";
import { FocusModeToggle } from "./components/FocusModeToggle";
import { GanttChart } from "./components/GanttChart";
import { ReportIssuePanel } from "./components/ReportIssuePanel";
import { TableScrollbar } from "./components/TableScrollbar";
import { DEFAULT_VISIBLE_COLUMNS, ProjectSummary, TaskBoard, type ColumnKey, type TaskPatch, type VisibleColumns } from "./components/TaskBoard";
import type { TaskEditSubmit } from "./components/TaskDrawer";
import { TaskKanban, type KanbanAddContext } from "./components/TaskKanban";
import type { StagePlacement } from "./components/StageAddCard";
import { PROJECT_STAGES } from "./data/projects";
import { isCompleteStatus, isPastDue, isServerTask, isoFromCnDateWithYear, progressAfterStatus, statusOverrideAfterProgress, type ProjectTask, type TaskStatus } from "./data/tasks";
import { ApiError } from "./api";
import { directoryMemberOptions, type DirectoryUser } from "./directory";
import { baseStatusOf, deleteTask, fetchProjectTasks, fetchTaskDetail, toUiTask, updateTask, updateTaskProgress, type ApiTaskListItem, type TaskUpdateBody } from "./taskApi";
import type { TemplatePresetNode } from "./data/templatePresets";
import { projectManagerText } from "./types";
import type { MeResponse, Project } from "./types";
import { replaceProjectView, type ProjectView } from "./useHashRoute";

/** 阶段名（不含「项目总览」汇总视图）。 */
const STAGE_NAMES: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/** 两份项目经理名单是否一致（顺序敏感：名单顺序就是展示顺序，Push 136）。 */
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * 阶段序号（Push 111）：展示顺序以**阶段为主键**，顺序就是项目总览的分组顺序（售前规划 → … → 验收）。
 * 不在九阶段里的（看板「临时任务」建的空任务）= 未分组，垫底 —— 与项目总览里「未分组」固定最后一组的口径一致。
 */
function stageRankOf(stage: string): number {
  const at = STAGE_NAMES.indexOf(stage);
  return at < 0 ? STAGE_NAMES.length : at;
}

/**
 * 顶部视图标签（Push 82 定稿）：阶段标签不再各占一格，改成「项目总览 + 两块看板」；
 * Push 128：再往后加第四个视图「日报及问题」（口径见 components/ReportIssuePanel.tsx）；
 * Push 142：「项目总览」之后再加「甘特图」（口径见 components/GanttChart.tsx）；
 * Push 154：当前标签走地址 `?view=`，刷新 / 收藏 / 分享都停在同一块标签。
 */
const VIEW_TABS = ["项目总览", "甘特图", "人员任务分配", "任务进展", "日报及问题"] as const;
type ViewTab = (typeof VIEW_TABS)[number];

/** 顶部标签 ↔ 地址参数（`?view=`）：缺省「项目总览」（overview）不落参数。 */
const VIEW_KEYS: Record<ViewTab, ProjectView> = {
  "项目总览": "overview",
  "甘特图": "gantt",
  "人员任务分配": "owners",
  "任务进展": "progress",
  "日报及问题": "daily",
};

/** 从任务模板预设加进来的任务：字段先给默认值（负责人 / 日期等留空，后续在任务详情里补）。 */
function taskFromPresetNode(stage: string, node: TemplatePresetNode): ProjectTask {
  return {
    id: node.id,
    stage,
    title: node.title,
    titleEn: node.titleEn,
    owners: [],
    ownersEn: [],
    status: "待开始",
    progress: 0,
    startDate: "",
    dueDate: "",
    doneDate: "",
    days: 0,
    deliverable: "",
    changes: [],
    onTime: "",
    note: "",
    headcount: 0,
    priority: null,
    files: [],
  };
}

let quickTaskSeq = 0;

/** 看板「添加 → 临时任务」建的任务（Push 86）：标题 / 英文名由用户自己填，负责人 / 状态按所在列给（阶段留空 → 项目总览里落在「未分组」）。 */
function quickTask(group: { owners: string[]; ownersEn: string[]; status: TaskStatus }, title: string, titleEn: string): ProjectTask {
  quickTaskSeq += 1;
  return {
    id: "quick-" + String(quickTaskSeq) + "-" + String(Date.now()),
    stage: "",
    title,
    titleEn,
    owners: group.owners,
    ownersEn: group.ownersEn,
    status: group.status,
    statusOverride: group.status,
    progress: progressAfterStatus(group.status, 0),
    startDate: "",
    dueDate: "",
    doneDate: "",
    days: 0,
    deliverable: "",
    changes: [],
    onTime: "",
    note: "",
    headcount: 0,
    priority: null,
    files: [],
  };
}

type ProjectDetailProps = {
  me: MeResponse;
  project: Project | null;
  /** 顶部标签的当前视图（Push 154 起由地址 `?view=` 派生，缺省「项目总览」）。 */
  view: ProjectView;
  /** 任务编辑里改「项目经理」时回写项目（项目经理是项目级字段，Push 136 起可多位）。 */
  onChangeManagers?: (projectId: string, managerIds: string[]) => void;
  /** 任务字段被编辑（按口径刷新项目时间 updatedAt）。 */
  onTaskEdited?: (projectId: string) => void;
  /** 用户目录（Push 162）：任务负责人候选与「姓名(工号)」展示走后端目录。 */
  directory?: DirectoryUser[];
  /** 顶部提示条（409 冲突 / 422 完成门禁 / 取数失败）——App 统一渲染。 */
  onNotice?: (message: string) => void;
};

export default function ProjectDetail({ me, project, view, directory = [], onChangeManagers, onTaskEdited, onNotice }: ProjectDetailProps) {
  /** 顶部视图（Push 82 / 121）：阶段标签收进「项目总览」，另两块是看板视图，最后一块是「日报及问题」；Push 154 起当前标签由地址 `?view=` 派生。 */
  const activeView = VIEW_TABS.find((tab) => VIEW_KEYS[tab] === view) ?? VIEW_TABS[0];
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});
  /** 原型内存任务（节点 / 临时任务）的字段覆盖（Push 162 起只管这类任务；真任务写面走 taskApi 后重新取数）。 */
  const [taskEdits, setTaskEdits] = useState<Record<string, Partial<ProjectTask>>>({});
  /**
   * 看板拖出来的任务顺序（Push 105）：存任务 id 顺序，空数组 = 用默认顺序。
   * 原型阶段存浏览器内存（与任务覆盖表同一层），换项目 / 刷新即重置 —— 正式版由后端落库（见 `前端功能需求.md` §3.8 A19）。
   */
  const [taskOrder, setTaskOrder] = useState<string[]>([]);
  /** 原型内存任务的删除表（Push 141；真任务删除走 DELETE 接口，不在此表）。 */
  const [deletedTaskIds, setDeletedTaskIds] = useState<string[]>([]);

  /** 服务端任务（M3-07 接线：`GET /projects/{id}/tasks`；TaskListItem 直接渲染 15 列表格）。 */
  const [serverTasks, setServerTasks] = useState<ProjectTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  /** 取数版本（写回成功后 +1 重新拉列表：前端不做本地拼接，以服务端返回为准）。 */
  const [taskVersion, setTaskVersion] = useState(0);
  const reloadTasks = () => setTaskVersion((value) => value + 1);

  /** 负责人 id → 工号（真用户目录）：任务负责人展示「姓名(工号)」。 */
  const usernameOf = (id: string): string => directory.find((user) => user.id === id)?.username ?? "";

  const projectId = project?.id ?? null;
  useEffect(() => {
    if (projectId === null) {
      setServerTasks([]);
      return;
    }
    let cancelled = false;
    setTasksLoading(true);
    const load = async (): Promise<void> => {
      try {
        const items = await fetchProjectTasks(projectId);
        if (!cancelled) {
          setServerTasks(items.map((item) => toUiTask(item, usernameOf)));
          setTasksError(null);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setTasksError(error instanceof ApiError ? error.message : "任务加载失败");
        }
      } finally {
        if (!cancelled) {
          setTasksLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // usernameOf 依赖 directory：目录后到时按新目录重新映射「姓名(工号)」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskVersion, directory]);

  /** 从任务模板 / 节点加进来的任务（原型内存态：写面仍本地；正式创建接口见 A10 / A11）。 */
  const [addedTasks, setAddedTasks] = useState<ProjectTask[]>([]);
  useEffect(() => {
    setAddedTasks([]);
    setProgressOverrides({});
    setTaskEdits({});
    setTaskOrder([]);
    setDeletedTaskIds([]);
  }, [projectId]);
  /** 表格数据源 = 服务端任务 + 原型内存新增（真任务字段以服务端为准）。 */
  const baseTasks = serverTasks;
  const projectTasks = [...baseTasks, ...addedTasks].filter((task) => !deletedTaskIds.includes(task.id));

  /**
   * 看板顺序（Push 105）：排过的按 `taskOrder` 走，没排过的（新加的任务等）接在后面、保持原有先后（稳定排序）。
   * 全套任务共用这一套顺序，两块看板的「列」只是它的子序列 —— 所以列内插入位 = 在这套顺序里插到目标位置。
   */
  const orderedTasks =
    taskOrder.length === 0
      ? projectTasks
      : projectTasks
          .map((task, index) => {
            const at = taskOrder.indexOf(task.id);
            return { task, key: at < 0 ? taskOrder.length + index : at };
          })
          .sort((left, right) => left.key - right.key)
          .map((entry) => entry.task);

  /**
   * 展示顺序（Push 111，业务口径「应该按照项目总览的顺序排 —— 某个工作人员在项目总览下从上到下的任务顺序」）：
   * **阶段为主键**（项目总览的分组顺序）、**组内按看板顺序表**（拖动 / 插入位置定的先后）。
   * 三块视图拿到的都是这一份顺序 —— 人员任务分配看板的列内顺序因此与项目总览自上而下一致；
   * 项目总览本来就是按阶段分组渲染的，组内顺序不受影响。
   */
  const stagedTasks = orderedTasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => stageRankOf(left.task.stage) - stageRankOf(right.task.stage) || left.index - right.index)
    .map((entry) => entry.task);

  const tasks = stagedTasks.map((task) => {
    if (isServerTask(task)) {
      return task;
    }
    const edit = taskEdits[task.id];
    const override = progressOverrides[task.id];
    const withEdit = edit === undefined ? task : { ...task, ...edit };
    return override === undefined ? withEdit : { ...withEdit, progress: override };
  });

  /**
   * 点四格进度条：进度 + 联动状态一起写（0 格 = 待开始、1~3 格 = 进行中、4 格 = 交回完成态派生，Push 65；
   * Push 67 修正：已过预计完成日期的任务点进度条保持「已延期」，不会被改成「待开始 / 进行中」）。
   */
  /** 写失败统一提示（409 冲突 / 422 完成门禁 / 其它）：不改本地数据，提示后按服务端重新取数对齐。 */
  const reportWriteError = (error: unknown, fallback: string): void => {
    if (error instanceof ApiError) {
      if (error.status === 409 && error.code === "VERSION_CONFLICT") {
        onNotice?.("数据已被他人更新，请刷新后重试。");
        return;
      }
      if (error.status === 422 && error.code === "TASK_REQUIRED_DOC_MISSING") {
        const missing = error.details
          .map((detail) => detail.message)
          .filter((message) => message !== "")
          .join("；");
        onNotice?.(missing === "" ? "缺少必交成果文件，无法完成任务。" : missing);
        return;
      }
      onNotice?.(error.message === "" ? fallback : error.message);
      return;
    }
    onNotice?.(fallback);
  };

  /** 进度接口回的是列表项（含 ownerNames）：贴回列表 —— 文件名等详情字段沿用原值。 */
  const applyListItem = (item: ApiTaskListItem): void => {
    setServerTasks((previous) =>
      previous.map((task) => (task.id === item.id ? { ...toUiTask(item, usernameOf), files: task.files } : task)),
    );
  };

  /** 真任务行内改动 → PATCH body（只发改动过的字段：缺键 = 不改、null = 清空）。 */
  const patchBodyOf = (current: ProjectTask, patch: TaskPatch): TaskUpdateBody | null => {
    const body: TaskUpdateBody = { version: current.version ?? 0 };
    if (patch.ownerIds !== undefined) {
      body.ownerIds = patch.ownerIds;
    }
    if (patch.startDate !== undefined) {
      const iso = isoFromCnDateWithYear(patch.startDate, current.dateIso?.start ?? null);
      body.plannedStart = iso === "" ? null : iso;
    }
    if (patch.dueDate !== undefined) {
      const iso = isoFromCnDateWithYear(patch.dueDate, current.dateIso?.due ?? null);
      body.plannedEnd = iso === "" ? null : iso;
    }
    if (patch.days !== undefined) {
      body.estimatedDays = patch.days === 0 ? null : patch.days;
    }
    if (patch.headcount !== undefined) {
      body.headcount = patch.headcount === 0 ? null : patch.headcount;
    }
    if (patch.priority !== undefined) {
      body.priority = patch.priority;
    }
    if (patch.note !== undefined) {
      body.note = patch.note === "" ? null : patch.note;
    }
    if (patch.statusOverride !== undefined) {
      const base = baseStatusOf(patch.statusOverride);
      if (base === null) {
        // 「已延期」是服务端派生展示态（A14 派生优先）：不可写 —— 提示后不提交
        onNotice?.("「已延期」由预计完成日期派生，不能直接改；可改预计完成日期或进度。");
        return null;
      }
      // 状态与进度 / 完成日期的联动由服务端同事务完成（TaskUpdateBody.status），不再单独写进度
      body.status = base;
      return body;
    }
    if (Object.keys(body).length <= 1) {
      return null;
    }
    return body;
  };

  /** 任务表行内删除（Push 141 · A25）：真任务走 DELETE 软删；原型内存任务仍从本地列表移除。 */
  const handleDeleteTask = (taskId: string) => {
    const current = tasks.find((task) => task.id === taskId);
    if (current === undefined) {
      return;
    }
    if (!isServerTask(current) || project === null) {
      setDeletedTaskIds((previous) => (previous.includes(taskId) ? previous : [...previous, taskId]));
      return;
    }
    const id = project.id;
    void (async () => {
      try {
        await deleteTask(id, taskId);
        reloadTasks();
        onTaskEdited?.(id);
      } catch (error: unknown) {
        reportWriteError(error, "删除任务失败");
        reloadTasks();
      }
    })();
  };

  /**
   * 点四格进度条（Push 65 / 67 口径；M3-07 接线）：真任务写 `PATCH …/progress`（服务端联动状态与完成日期），
   * 原型内存任务保持本地覆盖表口径。
   */
  const handleSetProgress = (taskId: string, progress: number) => {
    const current = tasks.find((task) => task.id === taskId);
    if (current === undefined) {
      return;
    }
    if (!isServerTask(current) || project === null) {
      const nextStatus = statusOverrideAfterProgress(progress, isPastDue(current));
      setProgressOverrides((previous) => ({ ...previous, [taskId]: progress }));
      setTaskEdits((previous) => ({
        ...previous,
        [taskId]: {
          ...previous[taskId],
          statusOverride: nextStatus,
          // 进度退回非完成态时，实际完成日期一并清空（Push 67 业务定案）
          ...(nextStatus === undefined || isCompleteStatus(nextStatus) ? {} : { doneDate: "" }),
        },
      }));
      return;
    }
    const id = project.id;
    const version = current.version ?? 0;
    void (async () => {
      try {
        const updated = await updateTaskProgress(id, taskId, { progress, version });
        applyListItem(updated);
        onTaskEdited?.(id);
      } catch (error: unknown) {
        reportWriteError(error, "进度更新失败");
        reloadTasks();
      }
    })();
  };

  /**
   * 看板拖动排序（Push 105）：把这张任务插到 `beforeTaskId` 前面；落在列尾时插到 `afterTaskId` 后面（两个都 null = 不动顺序）。
   * 只动顺序、不动任务字段；顺序表里还没有的任务（新加的 / 从模板加进来的）接到后面，保证顺序表覆盖全部任务。
   */
  const handleReorderTask = (taskId: string, beforeTaskId: string | null, afterTaskId: string | null) => {
    if (project === null || (beforeTaskId === null && afterTaskId === null)) {
      return;
    }
    const known = taskOrder.length === 0 ? projectTasks.map((task) => task.id) : taskOrder;
    const ids = known.filter((id) => id !== taskId);
    const afterIndex = afterTaskId === null ? -1 : ids.indexOf(afterTaskId);
    const at = beforeTaskId === null ? (afterIndex < 0 ? ids.length : afterIndex + 1) : ids.indexOf(beforeTaskId);
    const next = at < 0 ? [...ids, taskId] : [...ids.slice(0, at), taskId, ...ids.slice(at)];
    for (const task of projectTasks) {
      if (!next.includes(task.id)) {
        next.push(task.id);
      }
    }
    setTaskOrder(next);
    onTaskEdited?.(project.id);
  };

  /** 任务抽屉保存：项目经理变化回写项目（项目级）；真任务 PATCH（只发改动字段），原型内存任务进覆盖表。 */
  const handleSubmitTaskEdit = (values: TaskEditSubmit) => {
    if (project === null) {
      return;
    }
    if (values.managerIds.length > 0 && !sameIds(values.managerIds, project.managerIds)) {
      onChangeManagers?.(project.id, values.managerIds);
    }
    const current = tasks.find((task) => task.id === values.taskId);
    if (current === undefined) {
      return;
    }
    if (!isServerTask(current)) {
      setTaskEdits((previous) => ({
        ...previous,
        [values.taskId]: {
          owners: values.owners,
          ownersEn: values.ownersEn,
          startDate: values.startDate,
          dueDate: values.dueDate,
          days: values.days,
          headcount: values.headcount,
          priority: values.priority,
          note: values.note,
        },
      }));
      onTaskEdited?.(project.id);
      return;
    }
    const id = project.id;
    const startIso = values.startDate === "" ? null : isoFromCnDateWithYear(values.startDate, current.dateIso?.start ?? null);
    const dueIso = values.dueDate === "" ? null : isoFromCnDateWithYear(values.dueDate, current.dateIso?.due ?? null);
    const note = values.note.trim();
    const body: TaskUpdateBody = { version: current.version ?? 0 };
    if (!sameIds(values.ownerIds, current.ownerIds ?? [])) {
      body.ownerIds = values.ownerIds;
    }
    if (startIso !== (current.dateIso?.start ?? null)) {
      body.plannedStart = startIso;
    }
    if (dueIso !== (current.dateIso?.due ?? null)) {
      body.plannedEnd = dueIso;
    }
    if (values.days !== current.days) {
      body.estimatedDays = values.days === 0 ? null : values.days;
    }
    if (values.headcount !== current.headcount) {
      body.headcount = values.headcount === 0 ? null : values.headcount;
    }
    if (values.priority !== (current.priority ?? null)) {
      body.priority = values.priority;
    }
    if (note !== current.note) {
      body.note = note === "" ? null : note;
    }
    if (Object.keys(body).length <= 1) {
      // 值没变不写（口径：避免无谓刷新项目时间）
      return;
    }
    void (async () => {
      try {
        await updateTask(id, values.taskId, body);
        reloadTasks();
        onTaskEdited?.(id);
      } catch (error: unknown) {
        reportWriteError(error, "任务保存失败");
        reloadTasks();
      }
    })();
  };

  /**
   * 表格行内编辑 / 甘特图拖动（M3-07 接线）：真任务写 `PATCH …/tasks/{id}`（实际完成日期走 `/progress`），
   * 原型内存任务保持本地覆盖表。
   */
  const handlePatchTask = (taskId: string, patch: TaskPatch) => {
    const current = tasks.find((task) => task.id === taskId);
    if (current === undefined) {
      return;
    }
    if (!isServerTask(current)) {
      // 行内改状态会同时带进度（四格联动）：进度仍走进度覆盖表，避免被旧值盖回去
      if (patch.progress !== undefined) {
        const nextProgress = patch.progress;
        setProgressOverrides((previous) => ({ ...previous, [taskId]: nextProgress }));
      }
      setTaskEdits((previous) => ({ ...previous, [taskId]: { ...previous[taskId], ...patch } }));
      if (project !== null) {
        onTaskEdited?.(project.id);
      }
      return;
    }
    if (project === null) {
      return;
    }
    const id = project.id;
    const version = current.version ?? 0;
    // 实际完成日期：填 = 完成（progress 1 + 完成日期）、清 = 退回进行中（进度 3 格）—— 契约里只有进度接口能改它（A13）
    if (patch.doneDate !== undefined) {
      const iso = patch.doneDate === "" ? "" : isoFromCnDateWithYear(patch.doneDate, current.dateIso?.done ?? null);
      void (async () => {
        try {
          const updated =
            iso === ""
              ? await updateTaskProgress(id, taskId, { progress: 0.75, version })
              : await updateTaskProgress(id, taskId, { progress: 1, actualEnd: iso, version });
          applyListItem(updated);
          onTaskEdited?.(id);
        } catch (error: unknown) {
          reportWriteError(error, "实际完成日期更新失败");
          reloadTasks();
        }
      })();
      return;
    }
    const body = patchBodyOf(current, patch);
    if (body === null) {
      return;
    }
    void (async () => {
      try {
        await updateTask(id, taskId, body);
        reloadTasks();
        onTaskEdited?.(id);
      } catch (error: unknown) {
        reportWriteError(error, "任务更新失败");
        reloadTasks();
      }
    })();
  };

  /** 表格行内改「项目经理」：项目级字段（多位，Push 136），回写项目卡片。 */
  const handleBoardManagerChange = (nextManagerIds: string[]) => {
    if (project === null || sameIds(nextManagerIds, project.managerIds)) {
      return;
    }
    onChangeManagers?.(project.id, nextManagerIds);
  };

  /** 从「任务模板」预设加一个节点到项目：模板里已加过的节点按 id 判重，不重复加。 */
  const handleAddNode = (stage: string, node: TemplatePresetNode) => {
    setAddedTasks((previous) =>
      previous.some((task) => task.id === node.id) || baseTasks.some((task) => task.id === node.id)
        ? previous
        : [...previous, taskFromPresetNode(stage, node)],
    );
  };

  /** 看板「添加 → 临时任务」：标题由用户自己填，挂到该列（负责人 / 状态按列给，阶段留空）；与其它任务编辑一样刷新项目时间。 */
  const handleQuickAdd = (context: KanbanAddContext, values: { title: string; titleEn: string }) => {
    setAddedTasks((previous) => [...previous, quickTask(context, values.title, values.titleEn)]);
    if (project !== null) {
      onTaskEdited?.(project.id);
    }
  };

  /**
   * 把新加的任务插进看板顺序表（Push 111，业务口径「人员要指定位置放入」）：
   * `last`（默认）不动顺序表 —— 顺序表里没有的新任务本来就排最后，按「阶段为主键」的展示顺序落在**该阶段段的末尾**；
   * `before` / `after` 以某张同阶段任务为锚插进去；一次加多个时按传入顺序**整段**插在锚点位置，不会倒序。
   * 只动顺序表，卡片上的负责人 / 状态等字段不受影响。
   */
  const insertNewTasksIntoOrder = (taskIds: readonly string[], placement: StagePlacement) => {
    if (placement.kind === "last" || taskIds.length === 0) {
      return;
    }
    setTaskOrder((previous) => {
      const known = previous.length === 0 ? projectTasks.map((task) => task.id) : previous;
      const rest = known.filter((id) => !taskIds.includes(id));
      const anchorIndex = rest.indexOf(placement.taskId);
      const at = anchorIndex < 0 ? rest.length : placement.kind === "before" ? anchorIndex : anchorIndex + 1;
      const next = [...rest.slice(0, at), ...taskIds, ...rest.slice(at)];
      for (const task of projectTasks) {
        if (!next.includes(task.id)) {
          next.push(task.id);
        }
      }
      return next;
    });
  };

  /**
   * 项目总览卡片的「＋ 添加 / 整套添加」（Push 113，业务口径「我要点击这个添加后选择位置」）：
   * 点添加先弹位置浮层、选完再按这个位置插进看板顺序表 —— 与看板那条路径同一套口径（`insertNewTasksIntoOrder`），
   * 区别只是任务用预设节点自带的负责人 / 状态（没有看板列的上下文）。
   */
  const handleAddNodes = (stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => {
    const knownIds = new Set<string>([...baseTasks.map((task) => task.id), ...addedTasks.map((task) => task.id)]);
    const fresh = nodes.filter((node) => !knownIds.has(node.id));
    if (fresh.length === 0) {
      return;
    }
    setAddedTasks((previous) => [...previous, ...fresh.map((node) => taskFromPresetNode(stage, node))]);
    insertNewTasksIntoOrder(fresh.map((node) => node.id), placement);
    if (project !== null) {
      onTaskEdited?.(project.id);
    }
  };

  /**
   * 看板「添加 → 阶段任务」：从该阶段的节点池 / 模板里挑的节点加进项目（按节点 id 判重）。
   * 任务自带阶段，并带上所在列的负责人 / 状态（与「临时任务」同一套列上下文）。
   * Push 111：`nodes` 可以一次多个（「整套添加」），`placement` = 该阶段内的插入位置。
   */
  const handleKanbanAddNode = (context: KanbanAddContext, stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => {
    const knownIds = new Set<string>([...baseTasks.map((task) => task.id), ...addedTasks.map((task) => task.id)]);
    const fresh = nodes.filter((node) => !knownIds.has(node.id));
    if (fresh.length === 0) {
      return;
    }
    setAddedTasks((previous) => [
      ...previous,
      ...fresh.map((node) => ({
        ...taskFromPresetNode(stage, node),
        owners: context.owners,
        ownersEn: context.ownersEn,
        status: context.status,
        statusOverride: context.status,
        progress: progressAfterStatus(context.status, 0),
      })),
    ]);
    insertNewTasksIntoOrder(fresh.map((node) => node.id), placement);
    if (project !== null) {
      onTaskEdited?.(project.id);
    }
  };

  /** 抽屉打开时按需取任务详情（M3-01）：列表不下发文件名，抽屉的「文件」行按详情给（Push 162）。 */
  const loadTaskFiles = useCallback(
    async (taskId: string): Promise<string[]> => {
      if (projectId === null) {
        return [];
      }
      const detail = await fetchTaskDetail(projectId, taskId);
      return detail.files.map((file) => file.name);
    },
    [projectId],
  );

  /** 项目经理：项目级字段，姓名随项目下发（契约 managerNames），多位按「、」连接；任务表「项目经理」列与任务详情都用它。 */
  const managers = project === null ? "" : projectManagerText(project);

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [tableOverflow, setTableOverflow] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>(() => ({ ...DEFAULT_VISIBLE_COLUMNS }));
  /**
   * 醒目模式（Push 134，业务口径「默认不启用」）：打开后项目总览的每张任务卡片整行铺该任务状态的底色；
   * 关掉 = 保持现状。原型阶段存浏览器内存（换项目时保留、刷新回默认关），正式版口径见 `前端功能需求.md` §6.13。
   */
  const [focusMode, setFocusMode] = useState(false);
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});
  /**
   * 阶段骨架常显（Push 61 调整）：没有任务的阶段也保留分组头（只有阶段名、组内没有任务行），
   * 所以点「添加任务」加出任务后，其余阶段的分组头不会消失。
   */
  const visibleStageNames = STAGE_NAMES;
  const allCollapsed = visibleStageNames.length > 0 && visibleStageNames.every((stage) => collapsedStages[stage] === true);
  const toggleAllStages = () => {
    if (allCollapsed) {
      setCollapsedStages({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const stage of visibleStageNames) {
      next[stage] = true;
    }
    setCollapsedStages(next);
  };
  const toggleStage = (stage: string) => {
    setCollapsedStages((previous) => ({ ...previous, [stage]: previous[stage] !== true }));
  };

  const handleToggleColumn = (key: ColumnKey, checked: boolean) => {
    setVisibleColumns((previous) => ({ ...previous, [key]: checked }));
  };

  const resetColumns = () => {
    setVisibleColumns({ ...DEFAULT_VISIBLE_COLUMNS });
  };

  if (project === null) {
    return (
      <div className="min-h-screen">
        <AppHeader me={me} />
        <main className="w-full px-6 py-10">
          <p className="text-sm text-zinc-500">未找到该项目，可能已被删除。</p>
          <a href="#/projects" className="mt-4 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4">
            返回项目列表
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader me={me} project={project} />
      <main className="w-full px-6 pb-10 pt-3">
        <div className="flex items-center gap-3 border-b border-zinc-200">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {VIEW_TABS.map((tab) => {
              const active = tab === activeView;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => replaceProjectView(project.id, VIEW_KEYS[tab])}
                  aria-current={active ? "page" : undefined}
                  className={
                    "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition " +
                    (active
                      ? "border-zinc-900 text-zinc-900"
                      : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                  }
                >
                  {tab}
                </button>
              );
            })}
          </div>
          {activeView === "项目总览" ? (
            <div className="flex shrink-0 items-center gap-4">
              <FocusModeToggle checked={focusMode} onToggle={setFocusMode} />
              <ColumnPicker visible={visibleColumns} onToggle={handleToggleColumn} onReset={resetColumns} />
            </div>
          ) : null}
        </div>

        <div className="mt-6 space-y-4">
          {activeView === "项目总览" ? (
            <>
              {tasksLoading || tasksError !== null ? (
                <p
                  role={tasksError === null ? undefined : "alert"}
                  className={"text-xs " + (tasksError === null ? "text-zinc-500" : "text-rose-600")}
                >
                  {tasksError === null ? "正在加载任务…" : "任务加载失败：" + tasksError}
                </p>
              ) : null}
              <ProjectSummary tasks={tasks} />
              <TaskBoard tasks={tasks} skeletonStages={STAGE_NAMES} onSetProgress={handleSetProgress} visibleColumns={visibleColumns} scrollRef={tableScrollRef} collapsed={collapsedStages} onToggleStage={toggleStage} onToggleAllStages={toggleAllStages} onAddNode={handleAddNode} onAddNodes={handleAddNodes} viewStage="项目总览" managers={managers} managerIds={project.managerIds} members={directoryMemberOptions(directory)} managerOptions={directoryMemberOptions(directory)} loadTaskFiles={loadTaskFiles} onSubmitTaskEdit={handleSubmitTaskEdit} onPatchTask={handlePatchTask} onChangeManagers={handleBoardManagerChange} onDeleteTask={handleDeleteTask} focusMode={focusMode} />
            </>
          ) : activeView === "甘特图" ? (
            // 甘特图（Push 142）：与项目总览同一份任务数据（含内存态新增 / 编辑 / 删除）；拖动改期 / 改进度写回同一张内存态覆盖表
            <GanttChart tasks={tasks} onPatchTask={handlePatchTask} onSetProgress={handleSetProgress} />
          ) : activeView === "日报及问题" ? (
            // key = 项目 id：换项目时把日报 / 问题与填写草稿一起复位（原型内存态，见 ReportIssuePanel.tsx）
            <ReportIssuePanel key={project.id} project={project} me={me} tasks={tasks} />
          ) : (
            <TaskKanban
              mode={activeView === "人员任务分配" ? "owner" : "status"}
              tasks={tasks}
              managers={managers}
              managerIds={project.managerIds}
              members={directoryMemberOptions(directory)}
              managerOptions={directoryMemberOptions(directory)}
              onAddTask={handleQuickAdd}
              onAddStageTask={handleKanbanAddNode}
              onSubmitTaskEdit={handleSubmitTaskEdit}
              onPatchTask={handlePatchTask}
              onReorderTask={handleReorderTask}
              onSetProgress={handleSetProgress}
            />
          )}
        </div>

        {activeView === "项目总览" ? (
        <div
          id="table-scrollbar-bar"
          className={
            "sticky bottom-0 z-10 flex items-center " +
            (tableOverflow ? "mt-4 border-t border-zinc-200 bg-white/95 py-2.5 backdrop-blur" : "h-0 overflow-hidden")
          }
        >
          <TableScrollbar scrollRef={tableScrollRef} onOverflowChange={setTableOverflow} />
        </div>
        ) : null}
      </main>
    </div>
  );
}
