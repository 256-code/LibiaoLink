
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { memberNameOf, type Member } from "../data/members";
import {
  TEMP_TASK_STAGE,
  cnDateFromIso,
  dateOnlyText,
  ownersLabel,
  daysBetweenInclusive,
  lateDeliveryLabel,
  type ProjectTask,
  type TaskPriority,
  type TaskStatus,
} from "../data/tasks";
import { applyFileChange, ensurePreviewOutcome, fetchChangeRequest, fetchDownloadUrl, finalizeFile, previewKindOf, triggerDownload, usePhotoUrl, type ChangeRequestDetail, type FilePreviewKind, type PreviewViewerConfig } from "../fileApi";
import { lockBodyScroll } from "../scrollLock";
import { fetchTaskDetail, stageKeyOfName, stageNameOf, type TaskFileBrief } from "../taskApi";
import { DateRangePicker, type DateRange } from "./DateRangePicker";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { FileTypeIcon } from "./FileTypeIcon";
import { InlineDateCell } from "./InlineEdit";
import { MemberMultiSelect } from "./MemberSelect";
import { RowDeleteButton } from "./RowDeleteButton";
import { DeliverableCell, docTypeChip } from "./DeliverablePicker";
import { ScrollArea } from "./ScrollArea";
import { SelectMenu, type SelectOption } from "./SelectMenu";
import { TRACKER_LABELS, TRACKER_STEPS, TrackerBar, trackerLabel, trackerStep } from "./Tracker";
const CLOSE_ANIMATION_MS = 170;
/** 「已保存」提示的停留时间。 */
const SAVED_FLASH_MS = 1600;

/**
 * 抽屉页标签（Push 254 · 业务口径「抽屉上方增加 页面标签导航栏 任务详情 变更申请 变更记录三个页面」）：
 * 任务详情 = 原抽屉内容（进度 + 字段清单）；变更申请 = 对已定档文件发起变更（A4-13 申请即通过；未定档文件行尾「定档」就地补前置门 —— Push 254 续）；
 * 变更记录 = 任务「变更关联」（R01 回写）逐条回溯 —— 列表带短原因，全文按需经变更详情接口取。
 */
type DrawerTab = "detail" | "change" | "history";
const DRAWER_TABS: Array<{ key: DrawerTab; label: string }> = [
  { key: "detail", label: "任务详情" },
  { key: "change", label: "变更申请" },
  { key: "history", label: "变更记录" },
];

/** 可变更文件状态（A4-13）：只有已定档（final）/ 已变更（changed）文件可以发起变更；Push 254 续：任务已定档时的 draft 文件同视为已定档（见 taskFinalized）。 */
const CHANGEABLE_STATUS: Record<string, boolean> = { final: true, changed: true };

/** 变更申请页的文件状态签（这一页要讲清「能不能变更」—— 与「文件」行不标定档的展示口径分开）。 */
const CHANGE_FILE_STATUS_TEXT: Record<string, string> = {
  final: "已定档",
  changed: "已变更",
  draft: "未定档",
  archived: "已归档",
  recycled: "回收站",
};

/** 变更阶段下拉（A4-13「变更阶段」）：九阶段字典，与任务表阶段同名同序。 */
const CHANGE_STAGE_OPTIONS: SelectOption[] = ["售前规划", "设计开发", "加工采购", "组装发货", "硬件实施", "软件部署", "试运行", "生产阶段", "验收"].map((name) => ({ value: stageKeyOfName(name) ?? name, label: name }));

/** 变更阶段展示（空 / 未知 → 「—」）。 */
function stageLabelOf(stageKey: string | null): string {
  const label = stageNameOf(stageKey);
  return label === "" ? "—" : label;
}

/** 文件状态标签（Push 226 续修）：**只标非定档档位** —— 「未定档 / 已定档」不再出现在文件清单里
 *  （业务口径 2026-09-29：定档是整个项目的定档安排，不由单个文件区分；定档功能后续单独开发）。 */
const FILE_STATUS_LABEL: Record<string, string> = {
  changed: "已变更",
  archived: "已归档",
  recycled: "回收站",
};
const FILE_STATUS_CLASS: Record<string, string> = {
  changed: "bg-sky-50 text-sky-700",
  archived: "bg-zinc-100 text-zinc-500",
  recycled: "bg-zinc-100 text-zinc-400",
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  高: "bg-rose-50 text-rose-600",
  中: "bg-amber-50 text-amber-700",
  低: "bg-zinc-100 text-zinc-500",
};

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  已完成: "bg-emerald-500",
  提前完成: "bg-emerald-500",
  进行中: "bg-blue-500",
  已延期: "bg-red-500",
  待开始: "bg-zinc-300",
};

const STATUS_CHIP_CLASS: Record<TaskStatus, string> = {
  已完成: "bg-emerald-50 text-emerald-700",
  提前完成: "bg-emerald-50 text-emerald-700",
  进行中: "bg-blue-50 text-blue-700",
  已延期: "bg-red-50 text-red-600",
  待开始: "bg-zinc-100 text-zinc-500",
};

/** 任务状态下拉（与任务表行内同一份五个状态、同一套色签）。 */
const STATUS_OPTIONS: SelectOption[] = (["已延期", "进行中", "已完成", "待开始", "提前完成"] as TaskStatus[]).map((status) => ({
  value: status,
  label: (
    <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_CHIP_CLASS[status]}>{status}</span>
  ),
}));

const PRIORITY_OPTIONS = [
  { value: "高", label: "高" },
  { value: "中", label: "中" },
  { value: "低", label: "低" },
];

/** 抽屉里可编辑控件的统一外观（与任务编辑表单同一套）。 */
const FIELD_CLASS =
  "block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10";

const CAPTION_CLASS = "mt-1 block text-[11px] leading-4 text-zinc-400";

/** 任务编辑保存值：可编辑字段 = 项目经理（项目级，多位）/ 任务负责人（多位）/ 开始与预计完成日期（含联动天数）/ 施工人数 / 紧急重要度 / 进展描述。 */
export type TaskEditSubmit = {
  taskId: string;
  /** 项目经理 id 名单（项目级字段，Push 136）：至少一位，回写项目。 */
  managerIds: string[];
  /** 任务负责人 id（多位，契约 ownerIds）：空数组 = 待分配。 */
  ownerIds: string[];
  /** 开始 / 预计完成日期（ISO，YYYY-MM-DD；空串 = 未填）。 */
  startDate: string;
  dueDate: string;
  days: number;
  headcount: number;
  priority: TaskPriority;
  /** 输出成果文件（2026-10-08 · 业务口径「文件输出成果也要可以选择」：常规编辑开放）。 */
  deliverableTypes: string[];
  note: string;
};

/** 抽屉里的表单草稿（「所见即所存」：抽屉打开期间不随父级刷新重置）。 */
type Draft = {
  /** 任务描述（Push 196：临时任务可改，中文必填 / 英文可留空）。 */
  title: string;
  titleEn: string;
  managerIds: string[];
  ownerIds: string[];
  range: DateRange | null;
  headcount: string;
  priority: TaskPriority;
  deliverableTypes: string[];
  note: string;
};

function rangeOf(task: ProjectTask): DateRange | null {
  const from = task.startDate;
  const to = task.dueDate;
  return from === "" || to === "" ? null : { from, to };
}

function draftOf(task: ProjectTask | null, managerIds: string[]): Draft {
  return {
    title: task === null ? "" : task.title,
    titleEn: task === null ? "" : task.titleEn,
    managerIds,
    ownerIds: task === null ? [] : [...task.ownerIds],
    range: task === null ? null : rangeOf(task),
    headcount: task !== null && task.headcount > 0 ? String(task.headcount) : "",
    priority: task === null || task.priority === null ? "中" : task.priority,
    deliverableTypes: task === null ? [] : [...task.deliverableTypes],
    note: task === null ? "" : task.note,
  };
}

type TaskDrawerProps = {
  /** 项目经理展示文本（项目级字段：多位按「、」连接；不传时回落常量占位）。 */
  managers?: string;
  /** 当前项目经理 id 名单（项目级字段，人员多选下拉的选中项，Push 136）。 */
  managerIds?: string[];
  task: ProjectTask | null;
  /** 抽屉内直接改字段后的即时保存；不传 = 抽屉只读（不渲染可编辑控件）。 */
  onSubmit?: (values: TaskEditSubmit) => void;
  /**
   * 任务描述改名（Push 196 / Push 197 收窄）：只对**未归入阶段的「临时任务」**开放（阶段任务与节点 / 模板生成的任务按 A1-17 锁定，抽屉内只读）；
   * 失焦即存；不传 = 该行不渲染。
   */
  onRename?: (taskId: string, title: string, titleEn: string) => void;
  /** 点四格进度条（Push 98；联动口径同任务表 §6.4：0 格 = 待开始、1~3 格 = 进行中、4 格 = 交回完成态派生）。 */
  onProgress?: (taskId: string, progress: number) => void;
  /** 任务状态下拉（五态；联动由服务端裁决）；不传 = 状态字段只读。 */
  onSetStatus?: (taskId: string, status: TaskStatus) => void;
  /** 实际完成日期（填 = 完成、清 = 退回进行中）；不传 = 该字段只读。 */
  /**
   * 任务定档（Push 252 · 业务口径「在抽屉中每个任务在任务状态旁边加一个定档按钮状态，有二次提示」）：
   * 头部状态签旁「定档」开关点开 = 就地二次确认；确认后由调用方 POST …/tasks/{taskId}/finalize
   * （置位后任务不支持任何修改 —— 服务端 409 TASK_FINALIZED 兜底）；不传 = 未定档任务不渲染开关。
   */
  onSetActualEnd?: (taskId: string, iso: string) => void;
  onFinalize?: (taskId: string) => void;
  /**
   * 任务文件上传（Push 226 · 「文件」那一刀前端接线）：选完文件由调用方分片直传文件库并关联本任务（taskId）；
   * onProgress 供抽屉内「上传中 N/M」提示（done = 已完成份数）。不传 = 「文件」行只读（保留计数展示、无上传入口）。
   */
  onUploadFiles?: (taskId: string, files: File[], onProgress?: (done: number, total: number) => void) => Promise<void>;
  /**
   * 任务文件删除（Push 226 续）：抽屉清单里「删除」= 移入回收站（M4-02，30 天内可恢复），由调用方执行
   * （成功后整表重取刷新计数）；不传 = 清单不显示删除入口。
   */
  onDeleteFile?: (fileId: string) => Promise<void>;
  /**
   * 任务文件改名（Push 226 续二 · 业务口径「名称要可以修改」）：清单里点文件名进编辑 —— 只改主名、
   * 后缀由系统保留（同日报附图口径）；回车 / 失焦提交、Esc 取消、空名 / 没改不写回。由调用方执行并整表重取。
   * 不传 = 文件名只读。
   */
  onRenameFile?: (fileId: string, name: string) => Promise<void>;
  /** 当前登录人姓名（Push 254 · 「变更申请」页「变更申请人 / 填写者」只读展示 —— 提交时由服务端记 appliedBy）。 */
  actorName?: string;
  /**
   * 变更生效后的父级刷新（Push 254 · 抽屉「变更申请」页）：提交成功 = 变更记录 + 文件新版本 + 任务
   * 「变更关联」（R01 同事务回写）都已落库 —— 由调用方整表重取，把最新文件状态与变更关联带回来；
   * 不传 = 提交后只刷新抽屉内的文件清单。
   */
  onChanged?: () => void;
  /** 任务文件清单（详情接口 GET /projects/{id}/tasks/{taskId}）：不传 = 只显示列表随行计数（fileSummary）。 */
  projectId?: string;
  /** 人员候选（GET /api/v1/users 目录）：项目经理 / 任务负责人两个多选共用。 */
  members: readonly Member[];
  onClose: () => void;
};

/**
 * 任务详情抽屉（Push 63）：点任务行 / 看板卡片打开。
 * **要改直接在抽屉里改**（Push 88 业务口径：「编辑任务」弹窗不再需要）—— 项目经理 / 任务负责人 / 紧急重要度选完即存，
 * 日期区间选完即存，施工人数 / 进展描述失焦时存（值没变不写，避免无谓刷新项目时间）；保存后右下角闪一下「已保存」。
 * 进度自 Push 98 起也能在抽屉里改：进度条长度不变，**四颗点平均分布在条上**（刚开工 / 完成一半 / 快完成了 / 已完成），点哪颗写哪档；
 * 任务状态与实际完成日期自 Push 101 起也能在抽屉里直接改（口径与任务表行内 / 看板卡片完全一致，§6.9：
 * 状态 ↔ 四格进度双向联动、改成非完成态会清空实际完成日期；填实际完成日期 = 完成、清空 = 退回进行中）；
 * 仍只读：是否按时交付（读时派生）、变更关联（输出成果文件 2026-10-08 起可改 —— 业务口径「文件输出成果也要可以选择」）；
 * 「文件」自 Push 226 起可在抽屉内直接上传（点击「＋ 上传文件」→ 分片直传文件库并关联本任务；上传完成自动重取清单）；
 * 文件名 / 文档类型 / 状态清单随详情接口（GET …/tasks/{taskId}）下发；Push 226 续：清单里每份文件可「删除」（= 移入回收站，二次确认），
 * 图片文件点**缩略图**看大图预览（懒取短时签名 —— 点开才请求）；**点文件名改名**（Push 226 续二 · 只改主名、后缀保留）；
 * 每份文件可「下载」（Push 226 续四 · 原文件 attachment 签名 —— 与预览转换件区分；预览浮层 caption 也挂了「下载原文件」）；「未定档 / 已定档」不做文件级展示（定档是整个项目的安排，功能后续单独开发），
 * 版本 / 定档 / 回收站管理等文件库操作仍走站内文件库（后续切片）。
 * 任务描述（中文 / 英文）自 Push 196 起对「临时任务」开放（**Push 197 收窄：仅未归入阶段的临时任务** —— 业务口径 2026-09-28「这个不是临时任务 不能修改」；失焦即存，中文名必填），
 * 阶段任务与节点 / 模板生成的任务仍锁定（抽屉里不出这一行，服务端同口径 400 兜底）。
 */
export function TaskDrawer({ task, managers, managerIds = [], members, onSubmit, onRename, onProgress, onSetStatus, onSetActualEnd, onFinalize, onChanged, actorName, onUploadFiles, onDeleteFile, onRenameFile, projectId, onClose }: TaskDrawerProps) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const taskId = task === null ? null : task.id;
  const [draft, setDraft] = useState<Draft>(() => draftOf(task, managerIds));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** 「已保存」提示（非 0 = 展示中）。 */
  const [savedTick, setSavedTick] = useState(0);
  /** 悬停 / 聚焦中的进度档位（0 = 没有）：悬停时档位文字与进度条一起预览点完的样子。 */
  const [hoveredStep, setHoveredStep] = useState(0);
  /** 「文件」行详情清单（Push 226）：null = 还没取到（或未接线）；[] = 确实没有文件。 */
  const [files, setFiles] = useState<TaskFileBrief[] | null>(null);
  /** 清单重取版本号：上传完成后 +1。 */
  const [filesTick, setFilesTick] = useState(0);
  /** 上传中的份数进度（null = 没有上传）。 */
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  /** 预览浮层（Push 226 续 / 续三 · S4 两通道）：点清单里的图片 / PDF → 产物浮层（大图 / 内置查看器 iframe）；
   *  Office / 文本族 → ONLYOFFICE 查看器外壳（viewer 配置逐字下发）。nonce = 重试自增，强制重建查看器（重取 token）。null = 未开。 */
  const [preview, setPreview] = useState<{
    pane: { mode: "url"; url: string } | { mode: "viewer"; viewer: PreviewViewerConfig };
    name: string;
    kind: FilePreviewKind;
    fileId: string;
    nonce: number;
  } | null>(null);
  /** 正在取预览签名的文件 id（null = 没有）。 */
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  /** 预览 / 下载取不到时的一行灰字提示（null = 不显示）。 */
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  /** 正在取下载签名的文件 id（Push 226 续四；null = 没有）。 */
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);
  /** 待二次确认删除的文件 id（null = 没有）。 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  /** 定档二次确认条（Push 252）：开关点开 = 就地提示「定档后不支持任何修改」，确认才调接口落库。 */
  const [finalizeConfirm, setFinalizeConfirm] = useState(false);
  /** 正在改名的文件 id（Push 226 续二；null = 没有在改名）。 */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** 编辑中的**主名**（后缀不参与编辑 —— 同日报口径「自定义把图片png格式删了怎么办」：格式由系统保留）。 */
  const [renameText, setRenameText] = useState("");
  /** 编辑中保留的后缀（含点；没后缀 = 空串）。 */
  const [renameExt, setRenameExt] = useState("");
  /** 页标签（Push 254）：默认「任务详情」；换任务时回到默认页。 */
  const [tab, setTab] = useState<DrawerTab>("detail");
  /** 「变更申请」页（A4-13 十三列字段面）：目标文件 / 变更阶段 / 变更内容描述 / 变更原因 / 变更前后 / 变更后文件。 */
  const [changeTargetId, setChangeTargetId] = useState<string | null>(null);
  const [changeStage, setChangeStage] = useState("");
  const [changeContent, setChangeContent] = useState("");
  const [changeCause, setChangeCause] = useState("");
  const [changeBefore, setChangeBefore] = useState("");
  const [changeAfter, setChangeAfter] = useState("");
  const [changeFile, setChangeFile] = useState<File | null>(null);
  const changeInputRef = useRef<HTMLInputElement | null>(null);
  /** 变更提交中（防连点）与提交结果（成功绿条 / 失败红条）。 */
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeDone, setChangeDone] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  /** 「变更文件」就地定档（Push 254 续 · 业务反馈「这个选择不了啊」）：未定档文件行尾「定档」→ 就地二次确认 → 定档后该行随即可选。 */
  const [changeFinalizeId, setChangeFinalizeId] = useState<string | null>(null);
  const [changeFinalizeBusy, setChangeFinalizeBusy] = useState(false);
  const [changeFinalizeDone, setChangeFinalizeDone] = useState<string | null>(null);
  /** 「变更记录」页：展开中的变更 id 与其详情（列表只带短原因，全文按需取；note = 取不到的一行灰字）。 */
  const [changeDetailId, setChangeDetailId] = useState<string | null>(null);
  const [changeDetail, setChangeDetail] = useState<ChangeRequestDetail | null>(null);
  const [changeDetailNote, setChangeDetailNote] = useState<string | null>(null);
  const [changeDetailBusy, setChangeDetailBusy] = useState(false);

  useEffect(() => {
    closingRef.current = false;
    setClosing(false);
    setSavedTick(0);
    setHoveredStep(0);
    setFiles(null);
    setFilesTick(0);
    setUploading(null);
    setPreview(null);
    setPreviewBusy(null);
    setPreviewNote(null);
    setDownloadBusy(null);
    setPendingDelete(null);
    setFinalizeConfirm(false);
    setRenamingId(null);
    setRenameText("");
    setRenameExt("");
    setTab("detail");
    setChangeTargetId(null);
    // 变更阶段默认 = 任务所属阶段（临时任务没有阶段 → 留空，提交前必选）
    setChangeStage(task === null ? "" : task.stageKey ?? stageKeyOfName(task.stage) ?? "");
    setChangeContent("");
    setChangeCause("");
    setChangeBefore("");
    setChangeAfter("");
    setChangeFile(null);
    setChangeBusy(false);
    setChangeDone(false);
    setChangeError(null);
    setChangeFinalizeId(null);
    setChangeFinalizeBusy(false);
    setChangeFinalizeDone(null);
    setChangeDetailId(null);
    setChangeDetail(null);
    setChangeDetailNote(null);
    setChangeDetailBusy(false);
    setDraft(draftOf(task, managerIds));
    // 换任务时把草稿重置成新任务的字段；同一个任务上父级刷新不重置，避免打断正在输入的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (projectId === undefined || taskId === null) {
      return undefined;
    }
    let alive = true;
    void (async () => {
      try {
        const detail = await fetchTaskDetail(projectId, taskId);
        if (alive) {
          setFiles(detail.files);
        }
      } catch {
        // 清单取不到不打断抽屉：计数仍走列表随行摘要（fileSummary）
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, taskId, filesTick]);

  useEffect(() => {
    if (taskId === null) {
      return;
    }
    // Push 186：锁滚动时按滚动条实测宽度补 padding-right，否则抽屉一开一关会把整张表横向撑开再缩回（浏览器看起来是「抖一下」）。
    // 细节与还原口径见 frontend/src/scrollLock.ts。
    return lockBodyScroll();
  }, [taskId]);

  useEffect(() => {
    if (savedTick === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSavedTick(0);
    }, SAVED_FLASH_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [savedTick]);

  const requestClose = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    if (taskId === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (finalizeConfirm) {
          // 「Esc 先关内层」（Push 252）：二次确认条开着时先收确认条，不连带关抽屉
          setFinalizeConfirm(false);
          return;
        }
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [taskId, requestClose, finalizeConfirm]);

  /** 改草稿：ref 与 state 一起写 —— 失焦可能与最后一次输入同一批处理，只写 state 会让失焦读到旧值。 */
  const updateDraft = useCallback((patch: Partial<Draft>) => {
    const next: Draft = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    return next;
  }, []);

  /** 即时保存：把草稿与改动合成一份完整保存值（字段口径同任务表行内编辑）。 */
  const commit = useCallback(
    (patch: Partial<Draft>) => {
      const current = task;
      if (current === null || onSubmit === undefined) {
        return;
      }
      const next = updateDraft(patch);
      const headcountText = next.headcount.trim();
      const headcountValue = headcountText === "" ? 0 : Number(headcountText);
      onSubmit({
        taskId: current.id,
        managerIds: next.managerIds,
        ownerIds: next.ownerIds,
        startDate: next.range === null ? "" : next.range.from,
        dueDate: next.range === null ? "" : next.range.to,
        days: next.range === null ? 0 : daysBetweenInclusive(next.range.from, next.range.to),
        headcount: headcountText === "" || Number.isNaN(headcountValue) ? 0 : Math.floor(headcountValue),
        priority: next.priority,
        deliverableTypes: next.deliverableTypes,
        note: next.note.trim(),
      });
      setSavedTick(Date.now());
    },
    [onSubmit, task, updateDraft],
  );

  if (task === null) {
    return null;
  }

  const editable = onSubmit !== undefined;
  /** 任务描述改名（Push 196 / Push 197 收窄）：只有**未归入阶段**的「临时任务」能改 —— 归入阶段的任务即便没有来源节点也锁定（A1-17；服务端同口径 400 兜底）。 */
  const titleEditable = onRename !== undefined && task.stage === "" && task.nodeId === null && task.sourceNodeId === null;
  const canEditStatus = onSetStatus !== undefined;
  const canEditActualEnd = onSetActualEnd !== undefined;
  /** 逾期提示与服务端展示态同一口径（已延期 = 未完成且过了预计完成日期）。 */
  const overdue = task.status === "已延期";
  /** 「是否按时交付」的逾期标注（服务端展示态 + onTime 派生）。 */
  const late = lateDeliveryLabel(task);
  const status = task.status;
  const step = trackerStep(task.progress);
  /** 悬停预览：还没点就先亮到悬停那一档（进度条长度不变，只有填充随预览走）。 */
  const shownStep = hoveredStep > 0 ? hoveredStep : step;
  const stepPct = Math.round((shownStep / TRACKER_STEPS) * 100);
  const progressText = hoveredStep > 0 ? TRACKER_LABELS[hoveredStep] ?? "" : trackerLabel(task.progress);
  const fullOwners = ownersLabel(task.owners);
  /** 进度条与条上那四颗点一律用绿色（与任务表四格点 `bg-emerald-500` 同一个绿）—— 进度条只表达「做了多少」，
   *  状态色由状态签与色点单独表达；业务反馈：灰的看不懂，要和任务表一样绿。 */
  const barClass = "bg-emerald-500";
  /** 点亮的点 = 实心绿 + 白描边（压在绿条上也能看清）。 */
  const dotOnClass = "border-white bg-emerald-500";
  const dotClass = STATUS_DOT_CLASS[status];
  const statusChipClass = STATUS_CHIP_CLASS[status];
  const dash = <span className="text-zinc-300">—</span>;

  const draftDays = draft.range === null ? 0 : daysBetweenInclusive(draft.range.from, draft.range.to);
  const shownDays = editable ? draftDays : task.days;
  const headcountText = draft.headcount.trim();
  const headcountValue = headcountText === "" ? 0 : Number(headcountText);
  const headcountInvalid = headcountText !== "" && (Number.isNaN(headcountValue) || headcountValue < 0);
  /** 任务描述校验（Push 196）：中文名必填 —— 输入过程中为空只标红提示，失焦时还原成原值、不写库。 */
  const titleInvalid = titleEditable && draft.title.trim() === "";
  /** 「变更申请」页只读展示：变更时间（提交当天 = 系统记录口径）与变更申请人（当前登录人）。 */
  const changeToday = dateOnlyText(new Date().toISOString());
  const changeApplicant = actorName === undefined || actorName === "" ? "当前登录人" : actorName;

  /** 「文件」行（Push 226）：选文件 → 调用方分片直传（关联本任务）→ 完成后重取清单（列表计数由调用方刷新）。 */
  const beginFileUpload = (picked: FileList | null) => {
    if (picked === null || onUploadFiles === undefined) {
      return;
    }
    const list = Array.from(picked);
    if (list.length === 0) {
      return;
    }
    setUploading({ done: 0, total: list.length });
    void onUploadFiles(task.id, list, (done, total) => {
      setUploading({ done, total });
    }).finally(() => {
      setUploading(null);
      setFilesTick((tick) => tick + 1);
    });
  };

  /** 预览（Push 226 续 · S4 两通道裁决）：点开才懒取 —— 预览读取会写「查看」审计，不该随清单一开就铺开申请。
   *  viewer = ONLYOFFICE 查看器外壳（Office / 文本族）；url = 产物浮层（图片大图 / PDF iframe）；
   *  unavailable = 确定性降级（failed / 判不出通道 —— 服务端 reason 或「请下载查看」口径）。 */
  const openPreview = async (fileId: string, name: string) => {
    if (previewBusy !== null) {
      return;
    }
    setPreviewBusy(fileId);
    setPreviewNote(null);
    const outcome = await ensurePreviewOutcome(fileId);
    setPreviewBusy(null);
    const kind = previewKindOf(name) ?? "image";
    if (outcome.kind === "unavailable") {
      setPreviewNote(outcome.reason ?? "暂不支持在线预览，请下载查看");
      return;
    }
    if (outcome.kind === "viewer") {
      setPreview({ pane: { mode: "viewer", viewer: outcome.viewer }, name, kind, fileId, nonce: 0 });
      return;
    }
    setPreview({ pane: { mode: "url", url: outcome.url }, name, kind, fileId, nonce: 0 });
  };

  /** 查看器外壳「重试」（S4 · R5）：重取查看器配置（token 随签发刷新）+ nonce 自增强制重建；
   *  仍取不到（failed / 超时）→ 关浮层 + 一行灰字降级提示。 */
  const retryPreview = async (fileId: string, name: string) => {
    if (previewBusy !== null) {
      return;
    }
    setPreviewBusy(fileId);
    const outcome = await ensurePreviewOutcome(fileId);
    setPreviewBusy(null);
    if (outcome.kind === "unavailable") {
      setPreview(null);
      setPreviewNote(outcome.reason ?? "暂不支持在线预览，请下载查看");
      return;
    }
    setPreview((previous) => {
      if (previous === null || previous.fileId !== fileId) {
        return previous;
      }
      const pane = outcome.kind === "viewer"
        ? { mode: "viewer" as const, viewer: outcome.viewer }
        : { mode: "url" as const, url: outcome.url };
      return { pane, name, kind: previous.kind, fileId, nonce: previous.nonce + 1 };
    });
  };

  /** 下载原文件（Push 226 续四 · 业务口径「下载为什么都是pdf 你是不是签名调用错了」）：取当前版本的
   *  attachment 短时签名（原文件字节 + 原文件名；服务端写 download 审计），再触发浏览器落盘 ——
   *  与预览区分（S4）：Office / 文本族走 ONLYOFFICE 查看器渲染、图片 / PDF 走产物浮层；下载始终拿原文件。 */
  const downloadFile = async (fileId: string) => {
    if (downloadBusy !== null) {
      return;
    }
    setDownloadBusy(fileId);
    setPreviewNote(null);
    try {
      const signed = await fetchDownloadUrl(fileId);
      triggerDownload(signed.url, signed.fileName);
    } catch (error) {
      setPreviewNote(error instanceof Error && error.message !== "" ? error.message : "下载失败，请稍后再试");
    } finally {
      setDownloadBusy(null);
    }
  };

  /** 开始改名（Push 226 续二）：主名进输入框、后缀原位保留（图片 png 格式不会被改掉）。 */
  const startFileRename = (file: TaskFileBrief) => {
    const dot = file.name.lastIndexOf(".");
    const hasExt = dot > 0 && dot < file.name.length - 1;
    setRenamingId(file.id);
    setRenameText(hasExt ? file.name.slice(0, dot) : file.name);
    setRenameExt(hasExt ? file.name.slice(dot) : "");
  };

  /** 提交改名（Push 226 续二）：空名 / 没改 = 原样不写回；由调用方执行，完成重取清单（表格列由调用方整表重取刷新）。 */
  const commitFileRename = (file: TaskFileBrief) => {
    const base = renameText.trim();
    const next = base === "" ? file.name : base + renameExt;
    setRenamingId(null);
    if (onRenameFile === undefined || next === file.name) {
      return;
    }
    void onRenameFile(file.id, next).finally(() => {
      setFilesTick((tick) => tick + 1);
    });
  };

  /** 删除文件（Push 226 续 · 移入回收站）：二次确认后由调用方执行，完成重取清单（表格计数由调用方整表重取刷新）。 */
  const confirmFileDelete = (fileId: string) => {
    setPendingDelete(null);
    if (onDeleteFile === undefined) {
      return;
    }
    void onDeleteFile(fileId).finally(() => {
      setFilesTick((tick) => tick + 1);
    });
  };

  /** 失焦才存的字段（施工人数 / 进展描述）：值没变就不写；人数不合法时不写（红字提示留着）。
   *  读 `draftRef` 而不是渲染期的 `draft` —— 失焦可能与最后一次输入同一批处理，渲染期的值会是旧的。 */
  const commitDraft = () => {
    if (onSubmit === undefined) {
      return;
    }
    const current = draftRef.current;
    const text = current.headcount.trim();
    const value = text === "" ? 0 : Number(text);
    if (text !== "" && (Number.isNaN(value) || value < 0)) {
      return;
    }
    const nextHeadcount = text === "" ? 0 : Math.floor(value);
    if (nextHeadcount === task.headcount && current.note.trim() === task.note) {
      return;
    }
    commit({});
  };

  /**
   * 任务描述改名（Push 196）：失焦即存（与施工人数 / 进展描述同一套「值没变不写」）；
   * 中文名必填 —— 清空失焦时还原成原值、不写库。
   */
  const commitTitle = () => {
    if (!titleEditable || onRename === undefined) {
      return;
    }
    const current = draftRef.current;
    const nextTitle = current.title.trim();
    if (nextTitle === "") {
      updateDraft({ title: task.title });
      return;
    }
    const nextTitleEn = current.titleEn.trim();
    if (nextTitle === task.title && nextTitleEn === task.titleEn) {
      return;
    }
    updateDraft({ title: nextTitle, titleEn: nextTitleEn });
    onRename(task.id, nextTitle, nextTitleEn);
    setSavedTick(Date.now());
  };

  /** 任务已定档（Push 254 续 · 业务口径「不是已经定档了吗 为什么变更申请里面还是未定档」）：定档的可见口径是任务级动作（抽屉开关 / 表格侧签），已定档任务的 draft 文件同视为「定档后的文件」。 */
  const taskFinalized = task !== null && task.finalizedAt !== null;
  /** 可变更的目标文件（A4-13；Push 254 续）：状态 final / changed 的行，或任务已定档时的 draft 行。 */
  const changeableFiles = (files ?? []).filter((file) => CHANGEABLE_STATUS[file.status] === true || (taskFinalized && file.status === "draft"));
  /** 当前选中的变更目标（清单刷新后可能消失 —— 找不到按未选处理）。 */
  const changeTarget = (files ?? []).find((file) => file.id === changeTargetId) ?? null;

  /** 变更后文件选择（单份；选完在页面上显示文件名）。 */
  const pickChangeFile = (picked: FileList | null) => {
    if (picked === null) {
      return;
    }
    const list = Array.from(picked);
    if (list.length === 0) {
      return;
    }
    setChangeFile(list[0]);
    setChangeDone(false);
    setChangeError(null);
  };

  /**
   * 提交变更（A4-13 提交校验 + 一期「申请即通过」）：变更文件 / 变更内容描述 / 变更阶段 / 变更后文件四道必填 ——
   * 前端先拦一道（服务端同口径兜底：非定档 409 FILE_STATE_INVALID / 缺校验 400）；
   * 变更原因（选填）非空时与内容描述合并记入契约 reason（读面「变更原因」按该文本展示）；
   * 分片直传（intent=change）完成即生效：变更记录 + 新版本 + 文件状态 changed + R01 回写任务关联。
   * 成功后重取抽屉内文件清单，并让调用方整表重取（文件计数 / 变更关联回流）。
   */
  const submitChange = () => {
    if (changeBusy || projectId === undefined) {
      return;
    }
    if (changeTarget === null) {
      setChangeError("请选择变更文件");
      return;
    }
    if (changeContent.trim() === "") {
      setChangeError("请填写变更内容描述");
      return;
    }
    if (changeStage === "") {
      setChangeError("请选择变更阶段");
      return;
    }
    if (changeFile === null) {
      setChangeError("请选择变更后文件");
      return;
    }
    const cause = changeCause.trim();
    const reason = cause === "" ? changeContent.trim() : changeContent.trim() + "；变更原因：" + cause;
    setChangeBusy(true);
    setChangeDone(false);
    setChangeError(null);
    void applyFileChange(projectId, changeTarget, changeFile, {
      reason,
      beforeSummary: changeBefore,
      afterSummary: changeAfter,
      stageKey: changeStage,
    }, taskFinalized)
      .then(() => {
        setChangeDone(true);
        setChangeTargetId(null);
        setChangeContent("");
        setChangeCause("");
        setChangeBefore("");
        setChangeAfter("");
        setChangeFile(null);
        setFilesTick((tick) => tick + 1);
        onChanged?.();
      })
      .catch((error: unknown) => {
        setChangeError(error instanceof Error && error.message !== "" ? error.message : "变更提交失败，请稍后再试");
      })
      .finally(() => {
        setChangeBusy(false);
      });
  };

  /**
   * 「变更文件」就地定档（Push 254 续 · 业务反馈「这个选择不了啊」）：未定档文件行尾「定档」把变更前置门
   * （A4-13：只有已定档文件可以发起变更）就地补上 —— POST /files/{id}/finalize（draft → final 锁版；
   * 挂接任务随文件定档一并锁定，此后修改走变更）→ 重取文件清单 → 自动选中该文件。
   */
  const finalizeForChange = (fileId: string) => {
    if (changeFinalizeBusy || projectId === undefined) {
      return;
    }
    setChangeFinalizeBusy(true);
    setChangeError(null);
    void finalizeFile(fileId)
      .then(() => {
        setChangeFinalizeId(null);
        setChangeFinalizeDone(fileId);
        setChangeTargetId(fileId);
        setFilesTick((tick) => tick + 1);
        onChanged?.();
      })
      .catch((error: unknown) => {
        setChangeError(error instanceof Error && error.message !== "" ? error.message : "定档失败，请稍后再试");
      })
      .finally(() => {
        setChangeFinalizeBusy(false);
      });
  };

  /** 变更记录展开 / 收起（列表短文本 → 详情全文按需取；再点同一条 = 收起）。 */
  const toggleChangeDetail = (id: string) => {
    if (changeDetailBusy) {
      return;
    }
    if (changeDetailId === id) {
      setChangeDetailId(null);
      setChangeDetail(null);
      setChangeDetailNote(null);
      return;
    }
    setChangeDetailId(id);
    setChangeDetail(null);
    setChangeDetailNote(null);
    setChangeDetailBusy(true);
    void fetchChangeRequest(id)
      .then((detail) => {
        setChangeDetail(detail);
      })
      .catch((error: unknown) => {
        setChangeDetailNote(error instanceof Error && error.message !== "" ? error.message : "记录取不到");
      })
      .finally(() => {
        setChangeDetailBusy(false);
      });
  };

  const rows: Array<{ label: string; value: ReactNode }> = [
    // 任务描述（Push 196 / Push 197 收窄）：只有未归入阶段的「临时任务」出这一行；阶段任务与节点 / 模板生成的任务保持锁定（不渲染可编辑控件）
    ...(titleEditable
      ? [
          {
            label: "任务描述",
            value: (
              <>
                <input
                  value={draft.title}
                  onChange={(event) => {
                    updateDraft({ title: event.target.value });
                  }}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="任务名称（必填）"
                  aria-label="任务描述（中文）"
                  className={FIELD_CLASS + (titleInvalid ? " border-rose-300 focus:border-rose-400 focus:ring-rose-500/15" : "")}
                />
                <input
                  value={draft.titleEn}
                  onChange={(event) => {
                    updateDraft({ titleEn: event.target.value });
                  }}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="英文名（可留空）"
                  aria-label="任务描述（英文）"
                  className={FIELD_CLASS + " mt-1.5"}
                />
                <span className={CAPTION_CLASS}>临时任务可直接改（改完即存；中文名必填，留空自动还原）</span>
              </>
            ),
          },
        ]
      : []),
    {
      label: "项目经理",
      value: editable ? (
        <>
          <MemberMultiSelect
            values={draft.managerIds}
            options={members}
            onChange={(memberIds) => {
              // 至少留一位（对齐契约 projects.manager_ids 非空）：全取消时不写
              if (memberIds.length === 0) {
                return;
              }
              commit({ managerIds: memberIds });
            }}
            placeholder="选择项目经理"
            ariaLabel="选择项目经理"
          />
          <span className={CAPTION_CLASS}>项目级字段（可多位，按勾选顺序展示），改后全项目同步</span>
        </>
      ) : (
        <span className="font-medium text-zinc-800">{managers ?? ""}</span>
      ),
    },
    {
      label: "任务负责人",
      value: editable ? (
        <>
          <MemberMultiSelect
            values={draft.ownerIds}
            options={members}
            onChange={(memberIds) => {
              commit({ ownerIds: memberIds });
            }}
            placeholder="待分配"
            ariaLabel="选择任务负责人"
          />
          <span className={CAPTION_CLASS}>可多位；全部取消 = 待分配</span>
        </>
      ) : task.owners.length === 0 ? (
        <span className="text-zinc-400">待分配</span>
      ) : (
        fullOwners
      ),
    },
    {
      label: "任务状态",
      value: canEditStatus ? (
        <>
          <SelectMenu
            value={status}
            options={STATUS_OPTIONS}
            onChange={(next) => {
              // 五态写入（2026-09-24 定案）：进度与完成日期的联动由服务端同事务裁决（口径与原型一致）
              onSetStatus(task.id, next as TaskStatus);
              setSavedTick(Date.now());
            }}
            ariaLabel="选择任务状态"
          />
          <span className={CAPTION_CLASS}>选完成态 = 四格全亮；改成非完成态会清空实际完成日期</span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + dotClass} />
          {status}
        </span>
      ),
    },
    {
      label: "紧急重要度",
      value: editable ? (
        <SelectMenu
          value={draft.priority}
          options={PRIORITY_OPTIONS}
          onChange={(value) => {
            commit({ priority: value as TaskPriority });
          }}
          ariaLabel="选择紧急重要度"
        />
      ) : task.priority === null ? (
        dash
      ) : (
        <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + PRIORITY_CLASS[task.priority]}>
          {task.priority}
        </span>
      ),
    },
    {
      label: "是否按时交付",
      value:
        late === "逾期未交付" ? (
          <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">逾期未交付</span>
        ) : late === "逾期已交付" ? (
          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">逾期已交付</span>
        ) : task.onTime !== true ? (
          dash
        ) : (
          <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">按时交付</span>
        ),
    },
    {
      // 输出成果文件（2026-10-08 · 业务口径「文件输出成果也要可以选择」）：只读色签改可点选择（搜索 + 十类多选，
      // 彩签全量摊开）；勾选即存（与其它字段同一套写入口径）。不传 onSubmit（只读抽屉）= 静态色签。
      label: "输出成果文件",
      value: editable ? (
        <DeliverableCell
          all
          values={draft.deliverableTypes}
          onChange={(next) => {
            commit({ deliverableTypes: next });
          }}
        />
      ) : task.deliverableTypes.length === 0 ? (
        dash
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {task.deliverableTypes.map((docType) => (
            <span key={docType}>{docTypeChip(docType)}</span>
          ))}
        </span>
      ),
    },
    {
      label: "文件",
      value: (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {task.files.total === 0 ? (
              <span className="text-xs text-zinc-400">暂无文件</span>
            ) : (
              <>
                <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-600">
                  共 {task.files.total} 份
                </span>
              </>
            )}
            {onUploadFiles === undefined ? null : (
              <button
                type="button"
                data-drawer-upload="true"
                onClick={() => { uploadInputRef.current?.click(); }}
                disabled={uploading !== null}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading === null ? "＋ 上传文件" : uploading.done === 0 ? "上传中…" : "上传中 " + String(uploading.done) + "/" + String(uploading.total)}
              </button>
            )}
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              data-file-upload-input="true"
              className="hidden"
              aria-label="选择要上传到本任务的文件"
              onChange={(event) => {
                beginFileUpload(event.currentTarget.files);
                // 清空 value：同一份文件再选一次仍会触发 change
                event.currentTarget.value = "";
              }}
            />
          </div>
          {files === null || files.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {files.map((file) => {
                const previewKind = previewKindOf(file.name);
                const previewing = previewBusy === file.id;
                const confirming = pendingDelete === file.id;
                return (
                  <li key={file.id} data-drawer-file-item="true" className="group flex min-w-0 items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50/70 px-2.5 py-1.5 transition-colors hover:bg-zinc-100">
                    {previewKind === "image" ? <FileThumb fileId={file.id} name={file.name} onOpen={() => { void openPreview(file.id, file.name); }} /> : <FileTypeIcon name={file.name} />}
                    {renamingId === file.id ? (
                      <span className="flex min-w-0 flex-1 items-center gap-0.5">
                        <input
                          data-file-rename-input="true"
                          value={renameText}
                          autoFocus
                          onChange={(event) => { setRenameText(event.target.value); }}
                          onBlur={() => { commitFileRename(file); }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.stopPropagation();
                              commitFileRename(file);
                            }
                            if (event.key === "Escape") {
                              // 只取消本次改名，不连带关抽屉（与预览浮层同一条「Esc 先关内层」口径）
                              event.stopPropagation();
                              setRenamingId(null);
                            }
                          }}
                          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 outline-none focus:border-zinc-400"
                        />
                        {renameExt === "" ? null : <span className="shrink-0 text-xs text-zinc-400">{renameExt}</span>}
                      </span>
                    ) : onRenameFile === undefined ? (
                      previewKind !== null ? (
                        <button
                          type="button"
                          data-file-preview-open="true"
                          onClick={() => { void openPreview(file.id, file.name); }}
                          disabled={previewing}
                          title="点击预览"
                          className="min-w-0 flex-1 truncate text-left text-xs text-zinc-700 transition-colors hover:text-zinc-900 disabled:text-zinc-400"
                        >
                          {file.name}
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-xs text-zinc-700" title={file.name}>{file.name}</span>
                      )
                    ) : (
                      <button
                        type="button"
                        data-file-rename="true"
                        onClick={() => { startFileRename(file); }}
                        title="点名字可自定义（后缀由系统保留）"
                        className="min-w-0 flex-1 truncate text-left text-xs text-zinc-700 transition-colors hover:text-zinc-900"
                      >
                        {file.name}
                      </button>
                    )}
                    {file.docType === null ? null : <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{file.docType}</span>}
                    {FILE_STATUS_LABEL[file.status] === undefined ? null : (
                      <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " + (FILE_STATUS_CLASS[file.status] ?? "bg-zinc-100 text-zinc-500")}>
                        {FILE_STATUS_LABEL[file.status]}
                      </span>
                    )}
                    {previewing && previewKind === "image" ? <span className="shrink-0 text-[10px] text-zinc-400">预览中…</span> : null}
                    {previewKind === "pdf" || previewKind === "office" ? (
                      <button
                        type="button"
                        data-file-preview-open="true"
                        onClick={() => { void openPreview(file.id, file.name); }}
                        disabled={previewing}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                      >
                        {previewing ? "预览中…" : "预览"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-file-download="true"
                      onClick={() => { void downloadFile(file.id); }}
                      disabled={downloadBusy === file.id}
                      title="下载原文件（原格式落盘）"
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                    >
                      {downloadBusy === file.id ? "下载中…" : "下载"}
                    </button>
                    {onDeleteFile === undefined ? null : confirming ? (
                      <span data-file-delete-confirm="true" className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => { confirmFileDelete(file.id); }} className="flex h-6 shrink-0 items-center justify-center rounded-full bg-red-500 px-2.5 text-[11px] font-semibold leading-none text-white shadow-[0_1px_2px_rgba(220,38,38,0.25)] transition-colors hover:bg-red-600">确认删除</button>
                        <button type="button" onClick={() => { setPendingDelete(null); }} className="flex h-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 px-2.5 text-[11px] font-medium leading-none text-zinc-600 transition-colors hover:bg-zinc-200">取消</button>
                      </span>
                    ) : (
                      <span data-file-delete="true" className="flex h-6 w-12 shrink-0 items-center">
                        <RowDeleteButton
                          onDelete={() => { setPendingDelete(file.id); }}
                          label={"删除（移入回收站，30 天内可恢复）：" + file.name}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {previewNote === null ? null : <p data-file-preview-note="true" className="text-[11px] text-zinc-400">{previewNote}</p>}
        </div>
      ),
    },
    {
      label: "项目进展描述",
      value: editable ? (
        <textarea
          rows={3}
          value={draft.note}
          onChange={(event) => {
            updateDraft({ note: event.target.value });
          }}
          onBlur={commitDraft}
          placeholder="补充当前进展、风险或下一步"
          aria-label="项目进展描述"
          className={FIELD_CLASS + " resize-none leading-6"}
        />
      ) : task.note === "" ? (
        dash
      ) : (
        task.note
      ),
    },
    {
      label: "开始 / 预计完成",
      value: editable ? (
        <>
          <DateRangePicker
            value={draft.range}
            onChange={(next) => {
              commit({ range: next });
            }}
            hintDate={task.startDate}
            placeholder="选择开始与预计完成日期"
            ariaLabel="选择开始与预计完成日期"
          />
          <span className={CAPTION_CLASS}>天数随日期联动（含首尾）</span>
        </>
      ) : task.startDate === "" && task.dueDate === "" ? (
        dash
      ) : (
        (task.startDate === "" ? "—" : cnDateFromIso(task.startDate)) + " → " + (task.dueDate === "" ? "—" : cnDateFromIso(task.dueDate))
      ),
    },
    { label: "预计所需天数", value: shownDays > 0 ? shownDays + " 天" : dash },
    {
      label: "预计所需施工人数",
      value: editable ? (
        <>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft.headcount}
              onChange={(event) => {
                updateDraft({ headcount: event.target.value });
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="未填"
              aria-label="预计所需施工人数"
              className={FIELD_CLASS + (headcountInvalid ? " border-rose-300 focus:border-rose-400 focus:ring-rose-500/15" : "")}
            />
            <span className="shrink-0 text-xs text-zinc-400">人</span>
          </div>
          {headcountInvalid ? <span className="mt-1 block text-[11px] text-rose-500">请填 0 以上的整数</span> : null}
        </>
      ) : task.headcount > 0 ? (
        task.headcount + " 人"
      ) : (
        dash
      ),
    },
    {
      label: "实际完成日期",
      value: canEditActualEnd ? (
        <>
          <InlineDateCell
            valueIso={task.doneDate}
            ariaLabel="修改实际完成日期"
            display={
              task.doneDate !== "" ? <span className="text-zinc-600">{cnDateFromIso(task.doneDate)}</span> : <span className="text-zinc-400">—</span>
            }
            onChange={(iso) => {
              // 填 = 完成（四格全亮）；清 = 退回进行中（进度 3 格）—— 状态联动交给服务端
              onSetActualEnd(task.id, iso);
              setSavedTick(Date.now());
            }}
          />
          <span className={CAPTION_CLASS}>填上 = 完成；清空 = 退回进行中</span>
        </>
      ) : task.doneDate !== "" ? (
        cnDateFromIso(task.doneDate)
      ) : (
        dash
      ),
    },
    {
      label: "变更关联",
      value:
        task.changes.length === 0 ? (
          dash
        ) : (
          <span className="flex flex-col gap-1">
            {task.changes.map((change) => (
              <span key={change.id} className="flex flex-wrap items-center gap-1.5">
                <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  变更 {dateOnlyText(change.appliedAt)}
                </span>
                {change.reason === "" ? null : <span className="text-xs text-zinc-500">{change.reason}</span>}
              </span>
            ))}
          </span>
        ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={"drawer-backdrop absolute inset-0 bg-zinc-900/25" + (closing ? " is-closing" : "")}
        onClick={requestClose}
        aria-hidden="true"
      />
      <aside
        key={task.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
        className={
          "drawer-panel absolute right-0 top-0 flex h-full w-[460px] max-w-[94vw] flex-col bg-white shadow-[-24px_0_60px_rgba(15,23,42,0.18)]" +
          (closing ? " is-closing" : "")
        }
      >
        <header className="border-b border-zinc-100 px-6 pb-5 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500">{task.stage === "" ? TEMP_TASK_STAGE : task.stage}</span>
              <span data-task-status-chip="true" className={"rounded-full px-2.5 py-0.5 text-[11px] font-medium " + statusChipClass}>{status}</span>
              {task.finalizedAt !== null ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-zinc-400">定档</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked="true"
                    aria-label="任务已定档"
                    data-task-finalize="on"
                    title="任务已定档，不支持任何修改（文件修改走变更）"
                    disabled
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-default items-center rounded-full bg-[#FECA04] transition-colors duration-200"
                  >
                    <span className="pointer-events-none absolute left-[3px] top-[3px] flex h-[18px] w-[18px] translate-x-5 items-center justify-center rounded-full bg-white text-[9px] font-semibold text-amber-700 shadow-[0_1px_2px_rgba(15,23,42,0.18)] transition-all duration-200">已</span>
                  </button>
                </span>
              ) : onFinalize === undefined ? null : (
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-zinc-400">定档</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked="false"
                    aria-label="任务定档"
                    data-task-finalize="off"
                    title="定档后该任务不支持任何修改（文件修改走变更）"
                    onClick={() => { setFinalizeConfirm(true); }}
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-zinc-200 transition-colors duration-200 hover:bg-zinc-300"
                  >
                    <span className="pointer-events-none absolute left-[3px] top-[3px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-[9px] font-semibold text-zinc-400 shadow-[0_1px_2px_rgba(15,23,42,0.18)] transition-all duration-200">未</span>
                  </button>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="关闭任务详情"
              className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {finalizeConfirm && task.finalizedAt === null ? (
            <div data-task-finalize-confirm="true" className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs leading-5 text-amber-800">定档后该任务不支持任何修改（文件修改走变更），确定定档？</p>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  data-task-finalize-confirm-btn="true"
                  onClick={() => { setFinalizeConfirm(false); onFinalize?.(task.id); }}
                  className="flex h-6 shrink-0 items-center justify-center rounded-full bg-[#FECA04] px-2.5 text-[11px] font-semibold leading-none text-zinc-900 shadow-[0_1px_2px_rgba(202,154,0,0.35)] transition-colors hover:bg-[#F2BE00]"
                >
                  确认定档
                </button>
                <button
                  type="button"
                  data-task-finalize-cancel="true"
                  onClick={() => { setFinalizeConfirm(false); }}
                  className="flex h-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 px-2.5 text-[11px] font-semibold leading-none text-zinc-600 transition-colors hover:bg-zinc-200"
                >
                  取消
                </button>
              </span>
            </div>
          ) : null}
          <h2 id="task-drawer-title" className="mt-3.5 text-lg font-semibold leading-7 text-zinc-900">
            {task.title}
          </h2>
          {task.titleEn === "" ? null : <p className="mt-1 text-xs leading-5 text-zinc-400">{task.titleEn}</p>}
        </header>

        {/* 页标签导航栏（Push 254 · 业务口径「抽屉上方增加 页面标签导航栏 任务详情 变更申请 变更记录三个页面」）：
            抽屉头部之下、页内容之上（与页面主标签栏同一套下划线交互）；任务详情 = 原抽屉内容（进度 + 字段清单），
            另两页收拢变更发起与追溯。 */}
        <div data-drawer-tabs="true" className="border-b border-zinc-100 px-6">
          <div role="tablist" aria-label="任务抽屉页面" className="flex gap-1">
            {DRAWER_TABS.map((item) => {
              const active = item.key === tab;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-drawer-tab={item.key}
                  onClick={() => { setTab(item.key); }}
                  className={
                    "border-b-2 px-4 py-2.5 text-sm font-medium transition " +
                    (active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                  }
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === "detail" ? (
          <>
            <div className="border-b border-zinc-100 px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">项目进度</span>
                <span className="text-sm font-semibold text-zinc-900">{progressText}</span>
              </div>
              {onProgress === undefined ? (
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className={"h-full rounded-full " + barClass} style={{ width: stepPct + "%" }} />
                </div>
              ) : (
                <div className="mt-2.5">
                  <TrackerBar
                    progress={task.progress}
                    hovered={hoveredStep}
                    onHoverChange={setHoveredStep}
                    barClassName={barClass}
                    dotOnClassName={dotOnClass}
                    onChange={(progress) => {
                      onProgress(task.id, progress);
                      setSavedTick(Date.now());
                      setHoveredStep(0);
                    }}
                  />
                </div>
              )}
              {overdue ? (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">
                  已超过预计完成日期（{cnDateFromIso(task.dueDate)}），当前仍未完成。
                </p>
              ) : null}
            </div>

            <ScrollArea viewportClassName="min-h-0 flex-1" className="px-6 py-1" ariaLabel="任务详情字段">
              <dl>
                {rows.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[96px_1fr] items-start gap-x-4 border-b border-zinc-50 py-3 last:border-b-0"
                  >
                    <dt className="pt-px text-xs leading-5 text-zinc-400">{row.label}</dt>
                    <dd className="min-w-0 text-sm leading-5 text-zinc-800">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </ScrollArea>
          </>
        ) : tab === "change" ? (
          <ScrollArea viewportClassName="min-h-0 flex-1" className="px-6" ariaLabel="变更申请">
            <div data-drawer-page="change" className="flex flex-col gap-5 py-4">
              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更时间 <span className="text-rose-500">*</span></h3>
                <p data-change-time="true" className="mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">{changeToday}</p>
                <span className={CAPTION_CLASS}>一期申请即通过：生效时间由系统记录（提交即记，不可改）</span>
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更阶段 <span className="text-rose-500">*</span></h3>
                <span className={CAPTION_CLASS}>填写变更所处的项目阶段（九阶段字典）</span>
                <div data-change-stage="true" className="mt-1.5">
                  <SelectMenu
                    value={changeStage}
                    options={CHANGE_STAGE_OPTIONS}
                    placeholder="请选择"
                    onChange={(next) => {
                      setChangeStage(next);
                      setChangeDone(false);
                      setChangeError(null);
                    }}
                    ariaLabel="选择变更阶段"
                  />
                </div>
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更文件 <span className="text-rose-500">*</span></h3>
                <span className={CAPTION_CLASS}>选择要变更的文件：只有已定档文件可以发起变更（任务已定档 → 其文件即视为已定档；完全未定档的文件点行尾「定档」）</span>
                {files === null ? (
                  <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500">文件清单加载中…</p>
                ) : files.length === 0 ? (
                  <p data-change-empty="true" className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500">该任务暂无文件：先上传文件（可按定档方式上传）后再发起变更。</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {files.map((file) => {
                      const selectable = CHANGEABLE_STATUS[file.status] === true || (taskFinalized && file.status === "draft");
                      const statusText = file.status === "draft" && taskFinalized ? "已定档" : (CHANGE_FILE_STATUS_TEXT[file.status] ?? file.status);
                      const pickedTarget = file.id === changeTargetId;
                      const finalizeOpen = changeFinalizeId === file.id;
                      return (
                        <li key={file.id}>
                          <div className="flex items-stretch gap-1.5">
                            <button
                              type="button"
                              data-change-target={file.id}
                              disabled={!selectable}
                              aria-pressed={pickedTarget}
                              onClick={() => {
                                setChangeTargetId(pickedTarget ? null : file.id);
                                setChangeDone(false);
                                setChangeError(null);
                              }}
                              className={
                                "flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition " +
                                (pickedTarget
                                  ? "border-zinc-900 bg-zinc-50"
                                  : selectable
                                    ? "border-zinc-200 bg-white hover:border-zinc-300"
                                    : "cursor-not-allowed border-zinc-100 bg-zinc-50/60")
                              }
                            >
                              <span className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border " + (pickedTarget ? "border-zinc-900" : "border-zinc-300")}>
                                {pickedTarget ? <span className="h-1.5 w-1.5 rounded-full bg-zinc-900" /> : null}
                              </span>
                              <span className={"min-w-0 flex-1 truncate text-xs " + (selectable ? "text-zinc-700" : "text-zinc-400")} title={file.name}>{file.name}</span>
                              <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " + (selectable ? "bg-amber-50 text-amber-700" : "bg-zinc-100 text-zinc-400")}>
                                {statusText + (selectable ? "" : " · 不可变更")}
                              </span>
                            </button>
                            {selectable || file.status !== "draft" ? null : (
                              <button
                                type="button"
                                data-change-finalize={file.id}
                                onClick={() => {
                                  setChangeFinalizeId(finalizeOpen ? null : file.id);
                                  setChangeError(null);
                                }}
                                title="定档后该文件即可发起变更（任务随定档一并锁定，修改走变更）"
                                className="shrink-0 self-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 transition hover:border-amber-300"
                              >
                                定档
                              </button>
                            )}
                          </div>
                          {finalizeOpen ? (
                            <div data-change-finalize-confirm={file.id} className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                              <p className="text-[11px] leading-4 text-amber-800">定档后该文件锁版、任务一并锁定（不支持任何修改），修改走变更；确定定档该文件？</p>
                              <div className="mt-1.5 flex items-center gap-2">
                                <button
                                  type="button"
                                  data-change-finalize-ok={file.id}
                                  disabled={changeFinalizeBusy}
                                  onClick={() => finalizeForChange(file.id)}
                                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {changeFinalizeBusy ? "定档中…" : "确认定档"}
                                </button>
                                <button
                                  type="button"
                                  data-change-finalize-cancel={file.id}
                                  onClick={() => setChangeFinalizeId(null)}
                                  className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-700"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {changeFinalizeDone !== null && changeableFiles.some((file) => file.id === changeFinalizeDone) ? (
                  <p data-change-finalize-done="true" className="mt-2 text-[11px] leading-4 text-emerald-600">已定档并自动选中该文件：填好变更内容 / 变更后文件后即可提交变更。</p>
                ) : null}
                {files !== null && files.length > 0 && changeableFiles.length === 0 ? (
                  <p data-change-none-hint="true" className="mt-2 text-[11px] leading-4 text-zinc-400">当前没有可变更的文件：先点行尾「定档」完成文件定档，定档后即可发起变更。</p>
                ) : null}
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更内容描述 <span className="text-rose-500">*</span></h3>
                <textarea
                  data-change-reason="true"
                  value={changeContent}
                  maxLength={1000}
                  rows={3}
                  onChange={(event) => {
                    setChangeContent(event.target.value);
                    setChangeDone(false);
                    setChangeError(null);
                  }}
                  placeholder="请描述本次变更内容（必填，1000 字以内）"
                  aria-label="变更内容描述"
                  className={FIELD_CLASS + " mt-1.5 resize-none leading-6"}
                />
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更前</h3>
                <textarea
                  data-change-before="true"
                  value={changeBefore}
                  maxLength={2000}
                  rows={2}
                  onChange={(event) => { setChangeBefore(event.target.value); }}
                  placeholder="变更前内容摘要（可留空）"
                  aria-label="变更前"
                  className={FIELD_CLASS + " mt-1.5 resize-none leading-6"}
                />
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更后</h3>
                <textarea
                  data-change-after="true"
                  value={changeAfter}
                  maxLength={2000}
                  rows={2}
                  onChange={(event) => { setChangeAfter(event.target.value); }}
                  placeholder="变更后内容摘要（可留空）"
                  aria-label="变更后"
                  className={FIELD_CLASS + " mt-1.5 resize-none leading-6"}
                />
                <span className={CAPTION_CLASS}>变更前 / 变更后为一期文本摘要口径（各 2000 字以内）</span>
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更原因</h3>
                <input
                  data-change-cause="true"
                  value={changeCause}
                  maxLength={1000}
                  onChange={(event) => { setChangeCause(event.target.value); }}
                  placeholder="变更原因（选填）"
                  aria-label="变更原因"
                  className={FIELD_CLASS + " mt-1.5"}
                />
                <span className={CAPTION_CLASS}>选填：填写后与变更内容描述一并记入变更记录（一期「变更原因」按该文本展示）</span>
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更申请人 <span className="text-rose-500">*</span></h3>
                <p data-change-applicant="true" className="mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">{changeApplicant}</p>
                <span className={CAPTION_CLASS}>提交时由系统记录（填写者同此）</span>
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更后文件版本 <span className="text-rose-500">*</span></h3>
                <p data-change-version="true" className="mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">提交后自动生成新版本（版本号递增）</p>
                <span className={CAPTION_CLASS}>一期由系统生成：版本名称沿用文件名、版本号在目标文件当前版本上递增</span>
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">变更后文件 <span className="text-rose-500">*</span></h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-change-pick="true"
                    onClick={() => { changeInputRef.current?.click(); }}
                    disabled={changeBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    ＋ 选择变更后文件
                  </button>
                  {changeFile === null ? (
                    <span className="text-[11px] text-zinc-400">未选择</span>
                  ) : (
                    <span data-change-file="true" className="min-w-0 max-w-full truncate text-xs text-zinc-600" title={changeFile.name}>{changeFile.name}</span>
                  )}
                  <input
                    ref={changeInputRef}
                    type="file"
                    data-change-upload-input="true"
                    className="hidden"
                    aria-label="选择变更后文件"
                    onChange={(event) => {
                      pickChangeFile(event.currentTarget.files);
                      // 清空 value：同一份文件再选一次仍会触发 change
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
                <span className={CAPTION_CLASS}>必传：无变更后文件不允许提交（A4-13 提交校验）</span>
              </section>

              <section>
                <h3 className="text-xs font-medium text-zinc-500">关联</h3>
                <p data-change-link="true" className="mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">提交后由系统自动关联</p>
                <span className={CAPTION_CLASS}>R01：按输出成果文件命中，回写任务「变更关联」（追加 + 去重）</span>
              </section>

              <section className="flex flex-col gap-2 border-t border-zinc-100 pt-4">
                {changeError === null ? null : (
                  <p data-change-error="true" className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">{changeError}</p>
                )}
                {changeDone ? (
                  <p data-change-done="true" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">变更已提交生效：文件状态转为「已变更」，新版本与变更记录已生成。</p>
                ) : null}
                <button
                  type="button"
                  data-change-submit="true"
                  onClick={submitChange}
                  disabled={changeBusy || projectId === undefined}
                  className="w-full rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {changeBusy ? "提交中…" : "提交变更"}
                </button>
                <p className="text-[11px] leading-4 text-zinc-400">提交即生效（申请即通过）；变更文件须为已定档文件，且必须附变更后文件。</p>
              </section>
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea viewportClassName="min-h-0 flex-1" className="px-6" ariaLabel="变更记录">
            <div data-drawer-page="history" className="flex flex-col gap-2 py-4">
              {task.changes.length === 0 ? (
                <p data-drawer-history-empty="true" className="rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500">暂无变更记录：变更生效后自动关联到本任务（按输出成果文件命中）。</p>
              ) : (
                <>
                  <p className="text-[11px] leading-4 text-zinc-400">本任务关联的变更（最新在前）；点「详情」取变更全文。</p>
                  {[...task.changes].reverse().map((change) => {
                    const open = changeDetailId === change.id;
                    const detail = open && changeDetail !== null && changeDetail.id === change.id ? changeDetail : null;
                    return (
                      <div key={change.id} data-change-item={change.id} className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">变更 {dateOnlyText(change.appliedAt)}</span>
                          <p className="min-w-0 flex-1 text-xs leading-5 text-zinc-600">{change.reason === "" ? "（未填原因）" : change.reason}</p>
                          <button
                            type="button"
                            data-change-item-open="true"
                            onClick={() => { toggleChangeDetail(change.id); }}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                          >
                            {open ? "收起" : "详情"}
                          </button>
                        </div>
                        {open ? (
                          <div data-change-item-detail="true" className="mt-2 flex flex-col gap-1 border-t border-zinc-100 pt-2 text-xs leading-5 text-zinc-600">
                            {detail !== null ? (
                              <>
                                <span>变更后文件：{detail.file.name}（版本 v{String(detail.versionSeq)}）</span>
                                <span>变更阶段：{stageLabelOf(detail.stageKey)}</span>
                                <span>变更原因：{detail.reason}</span>
                                <span>审批状态：{detail.status === "applied" ? "已通过（申请即通过）" : detail.status}</span>
                                {detail.beforeSummary === null || detail.beforeSummary === "" ? null : <span>变更前：{detail.beforeSummary}</span>}
                                {detail.afterSummary === null || detail.afterSummary === "" ? null : <span>变更后：{detail.afterSummary}</span>}
                                <span className="text-zinc-400">申请人：{memberNameOf(members, detail.appliedBy) ?? "成员"} · {dateOnlyText(detail.appliedAt)}</span>
                              </>
                            ) : changeDetailNote === null ? (
                              <span className="text-zinc-400">加载中…</span>
                            ) : (
                              <span data-change-item-note="true" className="text-zinc-400">{changeDetailNote}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </ScrollArea>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-100 px-6 py-3">
          <p className="text-[11px] text-zinc-400">点空白处或按 Esc 关闭</p>
          {savedTick !== 0 ? (
            <p className="text-[11px] font-medium text-emerald-600">已保存</p>
          ) : editable ? (
            <p className="text-[11px] text-zinc-400">改动即时保存</p>
          ) : null}
        </footer>
      </aside>
      {preview === null ? null : (
        <FilePreviewOverlay
          pane={preview.pane}
          name={preview.name}
          kind={preview.kind}
          nonce={preview.nonce}
          onRetry={() => { void retryPreview(preview.fileId, preview.name); }}
          onDownload={() => { void downloadFile(preview.fileId); }}
          onClose={() => { setPreview(null); }}
        />
      )}
    </div>
  );
}

/** 图片文件的 40×40 小缩略图（Push 226 续 · 业务口径 2026-09-29「图片预览和日报那样的形式一样 抽屉里面直接存小图片」）：
 *  与日报 / 问题附图同款口径 —— 挂载即懒取预览签名（usePhotoUrl），点图开大图。 */
function FileThumb({ fileId, name, onOpen }: { fileId: string; name: string; onOpen: () => void }) {
  const url = usePhotoUrl(fileId, null);
  return (
    <button
      type="button"
      data-file-thumb="true"
      onClick={onOpen}
      title="点击预览"
      className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-white transition hover:border-zinc-300"
    >
      {url === null ? (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-300">…</span>
      ) : (
        <img src={url} alt={name} className="h-full w-full object-cover" />
      )}
    </button>
  );
}
