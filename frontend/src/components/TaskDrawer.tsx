
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Member } from "../data/members";
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
import { ensurePreviewOutcome, fetchDownloadUrl, previewKindOf, triggerDownload, usePhotoUrl, type FilePreviewKind, type PreviewViewerConfig } from "../fileApi";
import { lockBodyScroll } from "../scrollLock";
import { fetchTaskDetail, type TaskFileBrief } from "../taskApi";
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
  onSetActualEnd?: (taskId: string, iso: string) => void;
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
export function TaskDrawer({ task, managers, managerIds = [], members, onSubmit, onRename, onProgress, onSetStatus, onSetActualEnd, onUploadFiles, onDeleteFile, onRenameFile, projectId, onClose }: TaskDrawerProps) {
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
  /** 正在改名的文件 id（Push 226 续二；null = 没有在改名）。 */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** 编辑中的**主名**（后缀不参与编辑 —— 同日报口径「自定义把图片png格式删了怎么办」：格式由系统保留）。 */
  const [renameText, setRenameText] = useState("");
  /** 编辑中保留的后缀（含点；没后缀 = 空串）。 */
  const [renameExt, setRenameExt] = useState("");

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
    setRenamingId(null);
    setRenameText("");
    setRenameExt("");
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
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [taskId, requestClose]);

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
              <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-medium " + statusChipClass}>{status}</span>
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
          <h2 id="task-drawer-title" className="mt-3.5 text-lg font-semibold leading-7 text-zinc-900">
            {task.title}
          </h2>
          {task.titleEn === "" ? null : <p className="mt-1 text-xs leading-5 text-zinc-400">{task.titleEn}</p>}
        </header>

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
