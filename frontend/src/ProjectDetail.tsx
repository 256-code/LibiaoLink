import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ColumnPicker } from "./components/ColumnPicker";
import { FocusModeToggle } from "./components/FocusModeToggle";
import { GanttChart } from "./components/GanttChart";
import { ReportIssuePanel } from "./components/ReportIssuePanel";
import { TableScrollbar } from "./components/TableScrollbar";
import { DEFAULT_VISIBLE_COLUMNS, ProjectSummary, TaskBoard, hiddenColumnsOf, visibleColumnsFromHidden, type ColumnKey, type TaskPatch, type VisibleColumns } from "./components/TaskBoard";
import type { TaskEditSubmit } from "./components/TaskDrawer";
import { TaskKanban, type KanbanAddContext } from "./components/TaskKanban";
import type { StagePlacement } from "./components/StageAddCard";
import { PROJECT_STAGES } from "./data/projects";
import { memberNameOf, type Member } from "./data/members";
import type { ProjectTask, TaskStatus } from "./data/tasks";
import type { TemplatePresetNode } from "./data/templatePresets";
import { projectManagerText } from "./types";
import type { MeResponse, Project } from "./types";
import { replaceProjectView, type ProjectView } from "./useHashRoute";
import { ApiError } from "./api";
import {
  createTask,
  deleteTask,
  fetchProjectSummary,
  fetchProjectTasks,
  stageKeyOfName,
  statusWriteValue,
  taskWriteMessage,
  toUiTask,
  updateTask,
  updateTaskProgress,
  type ApiProjectSummary,
  type ApiTask,
  type ApiTaskListItem,
  type TaskCreateInput,
  createTasksFromTemplate,
  type TaskUpdateInput,
} from "./taskApi";

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


type ProjectDetailProps = {
  me: MeResponse;
  project: Project | null;
  /** 顶部标签的当前视图（Push 154 起由地址 `?view=` 派生，缺省「项目总览」）。 */
  view: ProjectView;
  /** 人员候选（GET /api/v1/users → directoryMemberOptions）：项目经理列 / 任务负责人 / 任务详情抽屉的多选共用。 */
  members: readonly Member[];
  /** 任务编辑里改「项目经理」时回写项目（项目经理是项目级字段，Push 136 起可多位）。 */
  onChangeManagers?: (projectId: string, managerIds: string[]) => void;
  /** 任务字段被编辑（按口径刷新项目时间 updatedAt）。 */
  onTaskEdited?: (projectId: string) => void;
  /** 任务表列显隐（A4 · Push 170）：服务端偏好里的隐藏列 key；null / 缺省 = 尚未取到（先用页面默认列）。 */
  taskHiddenColumns?: string[] | null;
  /** 保存列显隐（整体替换 PATCH）；返回 null = 成功，返回文案 = 失败提示。 */
  onTaskHiddenColumnsChange?: (keys: string[]) => Promise<string | null>;
  /** 醒目模式（A4 · §6.13 · Push 171）：服务端偏好里的开关值；null / 缺省 = 偏好尚未取到（按默认「关」渲染）。 */
  focusMode?: boolean | null;
  /** 保存醒目模式（单键 PATCH）；返回 null = 成功，返回文案 = 失败提示。 */
  onFocusModeChange?: (value: boolean) => Promise<string | null>;
};

export default function ProjectDetail({ me, project, view, members, onChangeManagers, onTaskEdited, taskHiddenColumns, onTaskHiddenColumnsChange, focusMode, onFocusModeChange }: ProjectDetailProps) {
  /** 顶部视图（Push 82 / 121）：阶段标签收进「项目总览」，另两块是看板视图，最后一块是「日报及问题」；Push 154 起当前标签由地址 `?view=` 派生。 */
  const activeView = VIEW_TABS.find((tab) => VIEW_KEYS[tab] === view) ?? VIEW_TABS[0];
  const projectId = project?.id ?? null;

  /**
   * 任务数据（M3-07 刀 1 后半接线）：列表与汇总卡全部来自服务端任务接口（GET /projects/{id}/tasks 与 /summary）。
   * 原「五层内存覆盖」（进度 / 字段编辑 / 看板顺序 / 行内删除 / 新增任务）随接线整体下线 —— 写成功即回读。
   */
  const [rawTasks, setRawTasks] = useState<ProjectTask[]>([]);
  const [summary, setSummary] = useState<ApiProjectSummary | null>(null);
  /** 取数版本号：换项目、或新建 / 删除 / 排序 / 版本冲突后需要整表重取时 +1。 */
  const [dataVersion, setDataVersion] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  /** 整表重取（新建 / 删除 / 排序 / 版本冲突后调用；换项目由下面这个 effect 自动触发）。 */
  const reloadAll = () => {
    setDataVersion((previous) => previous + 1);
  };

  useEffect(() => {
    if (projectId === null) {
      setRawTasks([]);
      setSummary(null);
      return undefined;
    }
    let alive = true;
    setDataLoading(true);
    void (async () => {
      try {
        const [list, card] = await Promise.all([fetchProjectTasks(projectId), fetchProjectSummary(projectId)]);
        if (!alive) {
          return;
        }
        setRawTasks(list.items.map((item) => toUiTask(item)));
        setSummary(card);
        setDataError(null);
        // 列表一次取满（契约 limit 上限 200）：超了先提示，按需分页随搜索那一刀接线
        if (list.total > list.items.length) {
          setToolError("项目任务共 " + String(list.total) + " 条，本次只取到前 " + String(list.items.length) + " 条");
        }
      } catch (error) {
        if (alive) {
          setDataError(error instanceof ApiError ? error.message : "任务数据加载失败");
        }
      } finally {
        if (alive) {
          setDataLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, dataVersion]);

  /**
   * 展示顺序（Push 111 / A19）：**阶段为主键**（九阶段按项目总览顺序、「未分组」垫底）、**组内按服务端位次 sortIndex** ——
   * 与服务端默认读序（阶段序 → sort_index → id）同一口径；三块视图共用这一份顺序。
   */
  const tasks = useMemo(
    () => [...rawTasks].sort((left, right) => stageRankOf(left.stage) - stageRankOf(right.stage) || left.sortIndex - right.sortIndex),
    [rawTasks],
  );

  /** 当前行（写入要回传它的 version / sortIndex 等）。 */
  const rowOf = (taskId: string): ProjectTask | undefined => tasks.find((task) => task.id === taskId);

  /**
   * 单行替换（PATCH / 进度写入都回单行）：文件摘要从旧行继承；
   * 负责人姓名走用户目录（写回响应不带 ownerNames —— 不补的话改完负责人要刷新才显示）。
   */
  const replaceRow = (view: ApiTaskListItem | ApiTask): void => {
    setRawTasks((current) =>
      current.map((row) => (row.id === view.id ? toUiTask(view, row, (id) => memberNameOf(members, id)) : row)),
    );
  };

  /** 汇总卡重取（最慢 / 最新阶段、逾期与完成数都可能被一次写入改动）。 */
  const refreshSummary = async (): Promise<void> => {
    if (projectId === null) {
      return;
    }
    try {
      setSummary(await fetchProjectSummary(projectId));
    } catch {
      // 汇总卡是次要信息：取不到就保持上一次的值，不打断主流程
    }
  };

  /** 写入失败的统一出口：409 版本冲突顺带整表重取（本地这份已经过期）。 */
  const reportWriteError = (error: unknown): void => {
    if (error instanceof ApiError) {
      setToolError(taskWriteMessage(error));
      if (error.code === "VERSION_CONFLICT") {
        reloadAll();
      }
      return;
    }
    setToolError(error instanceof Error ? error.message : "任务写入失败");
  };

  /** 一次成功写入的收尾：刷新汇总卡 + 通知项目时间变化。 */
  const afterWrite = async (): Promise<void> => {
    await refreshSummary();
    if (projectId !== null) {
      onTaskEdited?.(projectId);
    }
  };

  /**
   * 点四格进度条 / 甘特进度圆点（Push 65 / 67 · §6.4）：只写进度，状态与完成日期的联动（0 格 = 待开始、
   * 1~3 格 = 进行中、4 格 = 完成；已过预计完成日期仍保持「已延期」）由服务端裁决 —— 与原型联动口径一致。
   */
  const handleSetProgress = (taskId: string, progress: number) => {
    const row = rowOf(taskId);
    if (projectId === null || row === undefined) {
      return;
    }
    void (async () => {
      try {
        replaceRow(await updateTaskProgress(projectId, taskId, { progress, version: row.version }));
        await afterWrite();
      } catch (error) {
        reportWriteError(error);
      }
    })();
  };

  /**
   * 状态下拉 / 看板拖列（五态可写 · 2026-09-24 定案）：pending / active / done 为基础三态（服务端同事务联动进度与完成日期），
   * overdue（已延期）/ early_done（提前完成）为显式覆盖 —— 覆盖的生效边界与清除时机全在服务端，前端只提交五态值。
   */
  const handleSetStatus = (taskId: string, status: TaskStatus) => {
    const row = rowOf(taskId);
    if (projectId === null || row === undefined) {
      return;
    }
    void (async () => {
      try {
        replaceRow(await updateTask(projectId, taskId, { status: statusWriteValue(status), version: row.version }));
        await afterWrite();
      } catch (error) {
        reportWriteError(error);
      }
    })();
  };

  /** 实际完成日期（§6.9）：填 = 完成（满格 + 该日期）、清 = 退回进行中（3/4 格，服务端同时清掉完成日期）。 */
  const handleSetActualEnd = (taskId: string, iso: string) => {
    const row = rowOf(taskId);
    if (projectId === null || row === undefined) {
      return;
    }
    void (async () => {
      try {
        const body = iso === "" ? { progress: 0.75, version: row.version } : { progress: 1, actualEnd: iso, version: row.version };
        replaceRow(await updateTaskProgress(projectId, taskId, body));
        await afterWrite();
      } catch (error) {
        reportWriteError(error);
      }
    })();
  };

  /** 表格行内 / 甘特拖动改字段（Push 88）：负责人、开始与预计完成日期（含联动天数）、施工人数、紧急重要度、进展描述。 */
  const handlePatchTask = (taskId: string, patch: TaskPatch) => {
    const row = rowOf(taskId);
    if (projectId === null || row === undefined) {
      return;
    }
    const body: TaskUpdateInput = { version: row.version };
    if (patch.ownerIds !== undefined) {
      body.ownerIds = patch.ownerIds;
    }
    // 日期空串 = 未填（契约 nullable）：清空走显式 null
    if (patch.startDate !== undefined) {
      body.plannedStart = patch.startDate === "" ? null : patch.startDate;
    }
    if (patch.dueDate !== undefined) {
      body.plannedEnd = patch.dueDate === "" ? null : patch.dueDate;
    }
    if (patch.days !== undefined) {
      body.estimatedDays = patch.days;
    }
    if (patch.headcount !== undefined) {
      body.headcount = patch.headcount;
    }
    if (patch.priority !== undefined) {
      body.priority = patch.priority;
    }
    if (patch.note !== undefined) {
      body.note = patch.note;
    }
    void (async () => {
      try {
        replaceRow(await updateTask(projectId, taskId, body));
        await afterWrite();
      } catch (error) {
        reportWriteError(error);
      }
    })();
  };

  /** 任务详情抽屉保存：项目经理（项目级）回写项目，其余字段与行内编辑同一套写入口径。 */
  const handleSubmitTaskEdit = (values: TaskEditSubmit) => {
    if (project === null) {
      return;
    }
    if (values.managerIds.length > 0 && !sameIds(values.managerIds, project.managerIds)) {
      onChangeManagers?.(project.id, values.managerIds);
    }
    handlePatchTask(values.taskId, {
      ownerIds: values.ownerIds,
      startDate: values.startDate,
      dueDate: values.dueDate,
      days: values.days,
      headcount: values.headcount,
      priority: values.priority,
      note: values.note,
    });
  };

  /** 表格行内改「项目经理」：项目级字段（多位，Push 136），回写项目卡片。 */
  const handleBoardManagerChange = (nextManagerIds: string[]) => {
    if (project === null || sameIds(nextManagerIds, project.managerIds)) {
      return;
    }
    onChangeManagers?.(project.id, nextManagerIds);
  };

  /** 任务表行内删除（Push 141 / A25）：软删走接口（有变更引用时 409 TASK_HAS_REFERENCES），成功后本地摘掉这一行。 */
  const handleDeleteTask = (taskId: string) => {
    const row = rowOf(taskId);
    if (projectId === null || row === undefined) {
      return;
    }
    void (async () => {
      try {
        await deleteTask(projectId, taskId, row.version);
        setRawTasks((current) => current.filter((task) => task.id !== taskId));
        await afterWrite();
      } catch (error) {
        reportWriteError(error);
      }
    })();
  };

  /**
   * 看板拖动排序（A19 / A20 · Push 105）：把这张任务插到锚点任务前 / 后 —— 换算成**组内位次**（sortIndex）写回服务端。
   * 位次按「同一项目 + 同一阶段」一组定义（看板列 = 展示顺序的子序列）：锚点与这张任务不在同一阶段时不写顺序
   * （跨阶段拖动由服务端读序还原到自己的阶段段里）。
   */
  const handleReorderTask = (taskId: string, beforeTaskId: string | null, afterTaskId: string | null) => {
    const task = rowOf(taskId);
    const anchorId = beforeTaskId ?? afterTaskId;
    if (projectId === null || task === undefined || anchorId === null) {
      return;
    }
    const anchor = rowOf(anchorId);
    if (anchor === undefined || anchor.stageKey !== task.stageKey) {
      return;
    }
    const group = tasks.filter((item) => item.stageKey === task.stageKey);
    const current = group.findIndex((item) => item.id === taskId);
    const at = group.filter((item) => item.id !== taskId).findIndex((item) => item.id === anchorId);
    if (at < 0) {
      return;
    }
    const target = beforeTaskId === null ? at + 1 : at;
    if (target === current) {
      return;
    }
    void (async () => {
      try {
        await updateTask(projectId, taskId, { sortIndex: target, version: task.version });
        reloadAll();
      } catch (error) {
        reportWriteError(error);
      }
    })();
  };

  /**
   * 位置浮层（Push 111-113）的落点 → 组内位次（A20）：锚点任务在它那一组里的下标，before = 原位、after = 后一位；
   * 组尾（`last`）/ 找不到锚点 = 不给 sortIndex（服务端追加到组尾）。
   */
  const sortIndexFor = (placement: StagePlacement): number | undefined => {
    if (placement.kind === "last") {
      return undefined;
    }
    const anchor = rowOf(placement.taskId);
    if (anchor === undefined) {
      return undefined;
    }
    const at = tasks.filter((task) => task.stageKey === anchor.stageKey).findIndex((task) => task.id === anchor.id);
    if (at < 0) {
      return undefined;
    }
    return placement.kind === "before" ? at : at + 1;
  };

  /**
   * 建一条任务（临时任务 / 模板节点）：POST 只回契约 Task（不带负责人姓名与文件摘要）、且服务端要重排组内位次 ——
   * 所以成功一律整表重取；预设节点自带的列状态（看板「进展」列上下文）在创建后补一次状态写入（创建体没有 status 字段）。
   */
  const createOne = async (body: TaskCreateInput, status: TaskStatus): Promise<boolean> => {
    if (projectId === null) {
      return false;
    }
    try {
      const created = await createTask(projectId, body);
      if (status !== "待开始") {
        await updateTask(projectId, created.id, { status: statusWriteValue(status), version: created.version });
      }
      return true;
    } catch (error) {
      reportWriteError(error);
      return false;
    }
  };

  /** 建完的收尾：整表重取（拿新行的姓名 / 文件摘要与重排后的位次）+ 刷新项目时间。 */
  const afterCreate = () => {
    reloadAll();
    if (projectId !== null) {
      onTaskEdited?.(projectId);
    }
  };

  /** 看板「添加 → 临时任务」（Push 86）：标题由用户自己填，挂到该列（负责人 / 状态按列给，阶段留空 = 未分组）。 */
  const handleQuickAdd = (context: KanbanAddContext, values: { title: string; titleEn: string }) => {
    void (async () => {
      const created = await createOne(
        { stageKey: null, title: values.title, titleEn: values.titleEn === "" ? null : values.titleEn, ownerIds: context.ownerIds, priority: "中" },
        context.status,
      );
      if (created) {
        afterCreate();
      }
    })();
  };

  /**
   * 「＋ 添加 / 整套添加」（项目总览的添加卡片与看板「添加 → 阶段任务」，Push 113）：按阶段建任务，
   * 位置浮层的锚点换算成组内位次；一次多条按传入顺序依次落位（第 k 条的位次 = 锚点位次 + k，整体不颠倒）。
   * M3-07 刀 3 起都带**来源节点库节点**（`sourceNodeId`）：判重由服务端按（项目 × 节点）精确裁决；
   * 来自某块模板的「整套添加」改走模板实例化接口（`POST …/tasks/from-template`，整批同事务 + skipped 清单）。
   */
  const handleAddNodes = (stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement, templateId?: string) => {
    const stageKey = stageKeyOfName(stage);
    const base = sortIndexFor(placement);
    void (async () => {
      if (templateId !== undefined && projectId !== null && nodes.length > 0) {
        try {
          const result = await createTasksFromTemplate(projectId, {
            templateId,
            nodeIds: nodes.map((node) => node.id),
            skipExisting: true,
            priority: "中",
            ...(base === undefined ? {} : { sortIndex: base }),
          });
          if (result.skipped.length > 0) {
            setToolError("有 " + String(result.skipped.length) + " 条节点在这个项目里已经加过，本次已跳过（没有重复创建）。");
          }
          if (result.created.length > 0) {
            afterCreate();
          } else {
            reloadAll();
          }
          return;
        } catch (error) {
          reportWriteError(error);
          return;
        }
      }
      let created = false;
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const body: TaskCreateInput = { stageKey, title: node.title, titleEn: node.titleEn === "" ? null : node.titleEn, sourceNodeId: node.id, priority: "中" };
        if (base !== undefined) {
          body.sortIndex = base + index;
        }
        created = (await createOne(body, "待开始")) || created;
      }
      if (created) {
        afterCreate();
      }
    })();
  };

  /** 添加卡片「任务节点」标签里点一条（Push 61）：直接追加到该阶段末尾（不弹位置浮层）。 */
  const handleAddNode = (stage: string, node: TemplatePresetNode) => {
    handleAddNodes(stage, [node], { kind: "last" });
  };

  /** 看板「添加 → 阶段任务」：节点自带阶段，并带上所在列的负责人 / 状态（与「临时任务」同一套列上下文）。 */
  const handleKanbanAddNode = (context: KanbanAddContext, stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement, templateId?: string) => {
    const stageKey = stageKeyOfName(stage);
    const base = sortIndexFor(placement);
    void (async () => {
      // 来自某块模板的「整套添加」（M3-07 刀 3）：走模板实例化接口一次落库，再按所在列补一次状态写入（创建体没有 status）
      if (templateId !== undefined && projectId !== null && nodes.length > 0) {
        try {
          const result = await createTasksFromTemplate(projectId, {
            templateId,
            nodeIds: nodes.map((node) => node.id),
            skipExisting: true,
            ownerIds: context.ownerIds,
            priority: "中",
            ...(base === undefined ? {} : { sortIndex: base }),
          });
          if (context.status !== "待开始") {
            for (const task of result.created) {
              await updateTask(projectId, task.id, { status: statusWriteValue(context.status), version: task.version });
            }
          }
          if (result.skipped.length > 0) {
            setToolError("有 " + String(result.skipped.length) + " 条节点在这个项目里已经加过，本次已跳过（没有重复创建）。");
          }
          if (result.created.length > 0) {
            afterCreate();
          } else {
            reloadAll();
          }
          return;
        } catch (error) {
          reportWriteError(error);
          return;
        }
      }
      let created = false;
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const body: TaskCreateInput = { stageKey, title: node.title, titleEn: node.titleEn === "" ? null : node.titleEn, sourceNodeId: node.id, ownerIds: context.ownerIds, priority: "中" };
        if (base !== undefined) {
          body.sortIndex = base + index;
        }
        created = (await createOne(body, context.status)) || created;
      }
      if (created) {
        afterCreate();
      }
    })();
  };

  /** 项目经理：项目级字段，姓名随项目下发（契约 managerNames），多位按「、」连接；任务表「项目经理」列与任务详情都用它。 */
  const managers = project === null ? "" : projectManagerText(project);

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [tableOverflow, setTableOverflow] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>(() => ({ ...DEFAULT_VISIBLE_COLUMNS }));
  // 列显隐偏好异步到达：只在首次拿到时套用（之后以用户自己的勾选为准，不被回写覆盖）；保存失败的提示条见 toolError
  const appliedColumnPrefsRef = useRef(false);
  /** 标签栏右侧工具区（列显隐 / 醒目模式）的保存失败文案；null = 无提示。 */
  const [toolError, setToolError] = useState<string | null>(null);
  useEffect(() => {
    if (appliedColumnPrefsRef.current || taskHiddenColumns === null || taskHiddenColumns === undefined) {
      return;
    }
    appliedColumnPrefsRef.current = true;
    setVisibleColumns(visibleColumnsFromHidden(taskHiddenColumns));
  }, [taskHiddenColumns]);
  /**
   * 醒目模式（Push 134，业务口径「默认不启用」）：打开后项目总览的每张任务卡片整行铺该任务状态的底色；关掉 = 保持现状。
   * Push 171 起改**按账号存服务端**（用户偏好键 focusMode，`前端功能需求.md` §6.13）：值由父层给
   * （null = 偏好尚未取到 → 按默认「关」渲染），点击即生效 + 单键 PATCH（父层乐观更新 + 失败回滚）。
   */
  const focus = focusMode === true;
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

  // 列显隐改动 = 立即生效 + 整体替换 PATCH（父层乐观更新 + 失败回滚）；返回文案时在标签栏下方出提示条。
  // 失败时表格保持本次改动（提示条说明「没保存到账号」），下一次改动会带上当前状态整体重存 —— 自愈，不会半套状态。
  const persistColumns = async (next: VisibleColumns): Promise<void> => {
    setToolError((await onTaskHiddenColumnsChange?.(hiddenColumnsOf(next))) ?? null);
  };
  // 醒目模式改动 = 立即生效（父层乐观更新）+ 单键 PATCH；失败回滚并在同一提示条出文案。
  const handleToggleFocusMode = async (checked: boolean): Promise<void> => {
    setToolError((await onFocusModeChange?.(checked)) ?? null);
  };
  const handleToggleColumn = (key: ColumnKey, checked: boolean) => {
    const next = { ...visibleColumns, [key]: checked };
    setVisibleColumns(next);
    void persistColumns(next);
  };

  const resetColumns = () => {
    const next = { ...DEFAULT_VISIBLE_COLUMNS };
    setVisibleColumns(next);
    void persistColumns(next);
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
              <FocusModeToggle checked={focus} onToggle={(checked) => { void handleToggleFocusMode(checked); }} />
              <ColumnPicker visible={visibleColumns} onToggle={handleToggleColumn} onReset={resetColumns} />
            </div>
          ) : null}
        </div>

        {toolError === null ? null : (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <span>{toolError}</span>
            <button
              type="button"
              onClick={() => {
                setToolError(null);
              }}
              className="ml-auto rounded-lg border border-amber-300 px-3 py-1 text-xs font-medium transition hover:bg-amber-100"
            >
              关闭
            </button>
          </div>
        )}

        {dataError === null ? null : (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            <span>任务数据加载失败：{dataError}</span>
            <button
              type="button"
              onClick={reloadAll}
              className="ml-auto rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium transition hover:bg-rose-100"
            >
              重试
            </button>
          </div>
        )}

        {dataLoading && rawTasks.length === 0 && dataError === null ? (
          <p className="mt-4 text-sm text-zinc-400">正在加载任务数据…</p>
        ) : null}

        <div className="mt-6 space-y-4">
          {activeView === "项目总览" ? (
            <>
              {/* 汇总卡（M3-07 刀 1 后半）：最慢 / 最新阶段由服务端按任务聚合（GET /projects/{id}/summary） */}
              <ProjectSummary summary={summary} />
              <TaskBoard tasks={tasks} members={members} skeletonStages={STAGE_NAMES} onSetProgress={handleSetProgress} onSetStatus={handleSetStatus} onSetActualEnd={handleSetActualEnd} visibleColumns={visibleColumns} scrollRef={tableScrollRef} collapsed={collapsedStages} onToggleStage={toggleStage} onToggleAllStages={toggleAllStages} onAddNode={handleAddNode} onAddNodes={handleAddNodes} viewStage="项目总览" managers={managers} managerIds={project.managerIds} onSubmitTaskEdit={handleSubmitTaskEdit} onPatchTask={handlePatchTask} onChangeManagers={handleBoardManagerChange} onDeleteTask={handleDeleteTask} focusMode={focus} />
            </>
          ) : activeView === "甘特图" ? (
            // 甘特图（Push 142）：与项目总览同一份任务数据（服务端任务接口）；拖动改期 / 改进度走同一套写入口径
            <GanttChart tasks={tasks} members={members} onPatchTask={handlePatchTask} onSetProgress={handleSetProgress} />
          ) : activeView === "日报及问题" ? (
            // key = 项目 id：换项目时把日报 / 问题与填写草稿一起复位（原型内存态，见 ReportIssuePanel.tsx）
            <ReportIssuePanel key={project.id} project={project} me={me} tasks={tasks} />
          ) : (
            <TaskKanban
              mode={activeView === "人员任务分配" ? "owner" : "status"}
              tasks={tasks}
              managers={managers}
              managerIds={project.managerIds}
              members={members}
              onAddTask={handleQuickAdd}
              onAddStageTask={handleKanbanAddNode}
              onSubmitTaskEdit={handleSubmitTaskEdit}
              onPatchTask={handlePatchTask}
              onSetStatus={handleSetStatus}
              onSetActualEnd={handleSetActualEnd}
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
