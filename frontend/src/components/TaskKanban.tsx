import { Fragment, useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from "react";
import { memberByName } from "../data/members";
import { PROJECT_STAGES } from "../data/projects";
import type { TemplatePresetNode } from "../data/templatePresets";
import { PROGRESS_STEPS, cnDateFromIso, isCompleteStatus, isoFromCnDate, lateDeliveryLabel, progressAfterStatus, taskStatus, type ProjectTask, type TaskStatus } from "../data/tasks";
import { InlineDateCell } from "./InlineEdit";
import { MemberAvatar } from "./MemberSelect";
import { ScrollArea } from "./ScrollArea";
import type { StagePlacement } from "./StageAddCard";
import { StageAddCard } from "./StageAddCard";
import { TaskDrawer } from "./TaskDrawer";
import type { TaskEditSubmit } from "./TaskDrawer";
import { STATUS_TAG_CLASS, type TaskPatch } from "./TaskBoard";
import { trackerLabel } from "./Tracker";

/**
 * 项目详情页的两块看板（Push 82）：
 * - `owner`「人员任务分配」：列 = 任务负责人（人头维度），看每个人手上接了哪些任务；
 * - `status`「任务进展」：列 = 任务状态（已延期 → 进行中 → 已完成 → 提前完成 → 待开始），看每个状态有哪些任务。
 * 卡片材质按业务样张代码还原（外层壳 + 噪点叠加 + 多层投影），用 Tailwind 任意值实现，不引入 styled-components。
 * Push 106（业务反馈「只保留外框 内框不要了」）：卡片**去掉内层板** —— 样张里的内层板（近白面板 + 发丝内边 + 圆角 30px）整块撤掉，内容直接落在外层壳上；
 * 外层壳的内边距（9px）/ 圆角（35px）/ 白色壳 + 发丝边 + 投影、以及壳上的细纹叠加都保持不变。
 * 卡片只出任务里真实存在的字段（标题 / 所属阶段 / 日期 / 状态 / 负责人 / 进度 / 是否按时交付）；任务字段里没有「里程碑」这一项，所以阶段一栏的口径是「所属阶段」，不写「阶段性里程碑」。
 * Push 98：进度一栏的文字由百分比改成中文档位（与任务表 Tracker 同一套标签），并新增「实际完成日期」一栏 —— 卡片上直接点选小日历就能改（口径同表格行内编辑：填 = 完成、清 = 退回进行中）。
 * 列底「添加」固定在列底、不随卡片滚动（Push 86），两种口径：**临时任务**（自己填标题，阶段留空 → 卡片「所属阶段」显示「未分组」、到「项目总览」落在「未分组」组）/ **阶段任务**（先选阶段，再从该阶段的节点池 / 模板里挑节点加进项目，任务自带阶段）。
 * Push 104：**卡片可拖动换列** —— 按住卡片拖到别的列放开即可（负责人看板 = 改任务负责人、拖到「待分配」列 = 清空负责人；进展看板 = 改任务状态），
 * 与任务表行内编辑走同一条 `onPatchTask`（同一张覆盖表），状态那一路同时写四格进度并在改成非完成态时清空实际完成日期 —— 卡片上的进度档位 / 实际完成日期 / 是否按时交付因此同步跟着变。
 * Push 105（业务反馈「然后要有合适的交互显示拖动后的位置」；「拖动要实体化 / 不要虚化」一条后由业务口径修正为**不做成实体化**）：① 被拖动的卡片**样式保持原样** —— 不加淡出、也不做抬起的实体态、不换自定义拖影，只在拖动中把光标换成抓手；
 * ② 落点从「整列高亮」升级为**列内插入位** —— 鼠标拖到哪两张卡片之间，那里就浮出一块绿色虚线槽位（换列 = 「放开：移到「X」」、同列 = 「放开：放到这里」），
 * 放开即插到该位置（**同一列内也能拖着换顺序**）；插入位按鼠标与卡片中线算（某张卡片中线以上 = 插到这张前面，都在上面 = 插到列尾），顺序存 `ProjectDetail` 的看板顺序表（原型内存态，与任务覆盖表同一层；任务表同阶段内顺序跟着走）。
 * 列内滚动条是**隐式**的：原生滚动条隐藏，滚动 / 悬停才浮出自绘滑块（`ScrollArea`，与分类筛选侧栏 / 任务抽屉同一套）。
 * 看板横向滚动条同样**隐式**（Push 87）：列排布交给 `ScrollArea axis="horizontal"`，原生滚动条（Windows 下带箭头那条横杠）隐藏，滑块只在滚动 / 悬停时浮在列底留白里；列高按「铺满视口」重算（`100vh - 12.75rem`），列底与页面底之间不再留下大块空白。
 * Push 108（业务反馈「我不想要自动滚动，想要鼠标控制」）：拖动改成**指针拖动** —— Push 104 的原生 HTML5 拖拽与 Push 107 的「拖到边缘自动滚动」都撤回，
 * 因为原生拖拽期间浏览器会把 `wheel` 吞掉（滚轮到不了页面，「自己用鼠标滚」就不成立）。现在的口径：按住卡片、位移超过 `DRAG_THRESHOLD` 才算拖动，拖起来之后**滚轮直接可用** ——
 * 指针在列上 = 滚这一列的卡片列表（上下翻卡片）、按住 Shift 滚（或触控板左右滑）= 滚看板（左右翻列）；鼠标不动、容器在滚时，插入槽位按帧重算，不会停在旧位置。
 * 落点仍是「列内插入位」：`data-kanban-column` 认列、卡片中线认格；没过阈值就是「点一下」，照旧打开任务详情抽屉。
 * Push 109（业务反馈「卡片阴影也没了 这个不符合原本的效果」）：指针拖动期间补一块**跟着鼠标走的拖动卡片**（`data-drag-ghost`）——
 * 内容就是这张卡本身（同一套外壳材质：白壳 + 发丝边 + 三层投影 + 细纹），按抓取点对齐鼠标、`pointer-events-none`（不挡 `elementFromPoint` 的落点判定），
 * 位置每帧更新（与落点同一个 rAF 循环）；原地那张卡片照旧不动、不淡出、不抬起。
 * Push 110（业务反馈「还是要透明的吧」）：拖动卡片改成**半透明**（壳从实心白换成半透明白 + 轻磨砂 `backdrop-blur`），
 * 压住落点槽位 / 列内卡片时能透出去（`pointer-events-none` 不变）；投影保持原样不淡，原地那张卡片仍不动、不淡出。
 * Push 118（业务反馈「这有bug吧 不能同时打开 点击别的应该关闭另一个吧」）：「添加」浮层的打开态原来是**每列一份**（列内局部 state），
 * 六列互不感知、能同时开着菜单；现在提到 `TaskKanban` 一层，整块看板共用**单值**状态（`AddOverlay`）——
 * 点别的列的「添加」= 那一列接管，上一列的菜单 / 临时任务表单 / 阶段选择 / 模板卡片应声关掉；`Esc` / 点外面仍是关。
 */
export type KanbanMode = "owner" | "status";

/** 「任务进展」看板的列顺序（业务定稿：已延期 → 进行中 → 已完成 → 提前完成 → 待开始）。 */
const STATUS_ORDER: readonly TaskStatus[] = ["已延期", "进行中", "已完成", "提前完成", "待开始"];

/** 阶段色签（卡片「所属阶段」一栏）：按阶段固定色（口径对齐业务样张里的色签）。 */
const STAGE_TAG_CLASS: Record<string, string> = {
  售前规划: "bg-violet-100 text-violet-700",
  设计开发: "bg-sky-100 text-sky-700",
  加工采购: "bg-zinc-200 text-zinc-600",
  组装发货: "bg-rose-100 text-rose-700",
  硬件实施: "bg-emerald-100 text-emerald-700",
  软件部署: "bg-amber-100 text-amber-800",
  试运行: "bg-teal-100 text-teal-700",
  生产阶段: "bg-indigo-100 text-indigo-700",
  验收: "bg-lime-100 text-lime-700",
};

/** 没有阶段的任务（直接在看板「添加」出来的）：卡片「所属阶段」显示「未分组」。 */
const UNGROUPED_STAGE = "未分组";

/** 卡片外壳（样张结构：内边距 9px + 圆角 35px + 壳 + 三层投影）。配色按业务反馈（2026-09-20）改回**白色**：白壳 + 发丝边 + 柔和投影 + 底部内阴影。 */
const CARD_SHELL =
  "relative block w-full rounded-[35px] border border-zinc-900/[0.07] bg-white p-[9px] text-left transition " +
  "[box-shadow:0_18px_40px_-20px_rgba(15,23,42,0.18),0_4px_14px_-8px_rgba(15,23,42,0.06),inset_0_-2px_6px_rgba(15,23,42,0.05)] " +
  "hover:-translate-y-0.5 focus-visible:[outline:2px_solid_rgba(24,24,27,0.3)] focus-visible:[outline-offset:2px]";

/**
 * 拖动中的卡片（Push 104 / 105）：**样式保持原样** —— 不淡出、也不做「拿起来」的实体态（业务口径「不做成实体化了」），
 * 只把光标换成抓手，提示「这一张正拿在手上」；拖影用浏览器默认。
 */
const CARD_DRAGGING = " cursor-grabbing";

/**
 * 拖动卡片外壳（Push 110）：业务口径「还是要透明的」—— 实心白壳换成**半透明白 + 轻磨砂**（`backdrop-blur` / `backdrop-saturate`，
 * 与本应用浮层的液态玻璃同一套手感），压住底下的落点槽位时能透出去；投影保持卡片本体同一条（不因透明而减淡）。
 * 不带 `transition` / 悬停位移 —— 拖动卡片由指针循环逐帧摆位，`pointer-events-none` 也拿不到悬停。
 */
const CARD_SHELL_GHOST =
  "relative block w-full rounded-[35px] border border-zinc-900/[0.07] bg-white/[0.6] p-[9px] text-left backdrop-blur-[5px] backdrop-saturate-150 " +
  "[box-shadow:0_18px_40px_-20px_rgba(15,23,42,0.18),0_4px_14px_-8px_rgba(15,23,42,0.06),inset_0_-2px_6px_rgba(15,23,42,0.05)]";

/** 细纹叠加（样张：`repeating-conic-gradient` 细纹 + 对比度 105%；白壳上透明度收到 6%，保持干净）。 */
const CARD_NOISE =
  "pointer-events-none absolute inset-0 rounded-[35px] opacity-[0.06] [filter:contrast(105%)] " +
  "bg-[repeating-conic-gradient(#e8e8e8_0.0000001%,#93a1a1_0.000104%)] [background-position:60%_60%] [background-size:600%_600%]";

/** 看板列：列高随视口封顶，列头固定不动，卡片多时在列内滚动 —— 列不再一直往下延伸（Push 85）。 */
const COLUMN_SHELL = "flex h-[calc(100vh-12.75rem)] max-h-[52rem] min-h-[22rem] w-[280px] shrink-0 flex-col";

/** 列底「添加」区：在滚动视口之外 —— 按钮固定在列底，不随卡片滚动消失 / 出现（Push 86）。 */
const COLUMN_FOOTER = "mt-3 shrink-0";

/** 列底浮层（添加菜单 / 临时任务表单 / 阶段选择）：贴列底向上展开，落在列宽内。 */
const ADD_POPOVER =
  "absolute bottom-[calc(100%+8px)] left-0 z-30 w-full rounded-2xl border border-white/80 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.98),rgba(255,255,255,0.94))] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur-2xl backdrop-saturate-150";

/** 列底「添加」按钮（原样：白底 + 发丝边 + 悬停加深）。 */
const ADD_BUTTON =
  "flex w-full items-center justify-center gap-1.5 rounded-2xl border border-zinc-200 bg-white py-2.5 text-xs text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700";

/** 浮层里的两个入口：临时任务 / 阶段任务。 */
const ADD_ENTRY =
  "flex w-full items-baseline justify-between gap-2 rounded-lg border border-white/70 bg-white/70 px-2.5 py-2 text-left text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-white";

/** 入口右侧的小字说明。 */
const ADD_ENTRY_HINT = "shrink-0 text-[10px] font-normal text-zinc-400";

/** 临时任务表单输入框（与任务表行内编辑同一套「白底 + 淡灰描边」小框口径）。 */
const ADD_INPUT =
  "w-full rounded-lg border border-zinc-200/90 bg-white/75 px-2 py-1.5 text-xs text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white";

/** 阶段选择里的一格。 */
const ADD_STAGE =
  "rounded-lg border border-white/70 bg-white/70 px-2 py-1.5 text-left text-[11px] text-zinc-700 transition hover:border-zinc-300 hover:bg-white";

/** 可选阶段 = 9 个施工阶段（顺序同「项目总览」）。 */
const STAGE_OPTIONS: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/**
 * 卡片内容区（Push 106：业务口径「只保留外框 内框不要了」—— 原来的内层板（近白面板 + 发丝内边 + 圆角 30px）整块去掉，
 * 内容直接落在外层壳上，只保留原来的内边距，卡片就是「一个框 + 内容」。
 */
const CARD_BODY = "relative px-4 py-3.5";

/** 拖动判定阈值（Push 108）：按下后位移不超过这么多像素 = 「点一下看详情」，不算拖动。 */
const DRAG_THRESHOLD = 4;

/** 当前落点（Push 108）：`key` = 哪一列（负责人 / 状态 / 待分配）、`index` = 插到列内第几格（0 = 最前、`items.length` = 列尾）。 */
type DropTarget = { key: string; index: number };

/** 按下卡片、还没到拖动阈值时的暂存（Push 108）。 */
type PendingDrag = {
  taskId: string;
  pointerId: number;
  /** 按下时的坐标：用来判「过没过阈值」。 */
  x: number;
  y: number;
  /** 卡片 DOM：真拖起来之后把指针捕获在它身上（鼠标滑出窗口再放开也收得到 pointerup）。 */
  node: HTMLElement;
  dragging: boolean;
};

/** 「添加」时的列上下文：负责人看板给负责人、进展看板给状态（与旧「+ 添加」口径一致）。 */
export type KanbanAddContext = { owner: string; ownerEn: string; status: TaskStatus };

type TaskKanbanProps = {
  mode: KanbanMode;
  tasks: ProjectTask[];
  /** 项目经理（项目级字段；任务详情抽屉展示用）。 */
  manager: string;
  /** 项目经理 id（任务详情抽屉里「项目经理」字段的当前选中项）。 */
  managerId: string;
  /** 列底「添加 → 临时任务」：标题由用户自己填（英文名可空）；负责人 / 状态按所在列给、阶段留空。 */
  onAddTask: (context: KanbanAddContext, values: { title: string; titleEn: string }) => void;
  /**
   * 列底「添加 → 阶段任务」：从该阶段节点池 / 模板挑的节点加进项目，并带上所在列的负责人 / 状态。
   * Push 111：`nodes` 支持一次多个（「整套添加」按列表顺序整段插入），`placement` = 该阶段内的插入位置（业务口径「人员要指定位置放入」）。
   */
  onAddStageTask: (context: KanbanAddContext, stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => void;
  /** 任务编辑保存（与表格共用同一张覆盖表）。 */
  onSubmitTaskEdit?: (values: TaskEditSubmit) => void;
  /** 卡片上直接改字段（Push 98：实际完成日期；与表格行内同一套口径）。 */
  onPatchTask?: (taskId: string, patch: TaskPatch) => void;
  /**
   * 看板列内顺序（Push 105）：卡片被放到某两格之间时回调 —— `beforeTaskId` = 插到这张任务前面；
   * 落在列尾时 `beforeTaskId` 为 null、改用 `afterTaskId`（这一列的最后一张）；两个都为 null = 目标列本来就没有别的卡片，
   * 这时不动顺序（只换列），免得卡片莫名跳到整个项目任务顺序的末尾。不传 = 只换列、不排顺序。
   */
  onReorderTask?: (taskId: string, beforeTaskId: string | null, afterTaskId: string | null) => void;
  /** 抽屉里点四格进度条（Push 98；与任务表 §6.4 同一套联动口径）。 */
  onSetProgress?: (taskId: string, progress: number) => void;
};

type KanbanGroup = {
  /** 列名（负责人姓名或「待分配」/ 状态名）。 */
  key: string;
  /** 该列新建任务时的默认负责人（状态列为空）。 */
  ownerEn: string;
  /** 该列新建任务时的默认状态（负责人列为「待开始」）。 */
  status: TaskStatus;
  items: ProjectTask[];
};

/** 分组：负责人按任务出现顺序排（「待分配」固定垫底）；状态按业务定稿顺序，空列也保留。 */
function groupTasks(tasks: ProjectTask[], mode: KanbanMode): KanbanGroup[] {
  if (mode === "status") {
    return STATUS_ORDER.map((status) => ({
      key: status,
      ownerEn: "",
      status,
      items: tasks.filter((task) => taskStatus(task) === status),
    }));
  }
  const byOwner = new Map<string, KanbanGroup>();
  for (const task of tasks) {
    const key = task.owner === "" ? "待分配" : task.owner;
    const found = byOwner.get(key);
    if (found === undefined) {
      byOwner.set(key, { key, ownerEn: task.ownerEn, status: "待开始", items: [task] });
    } else {
      found.items.push(task);
    }
  }
  const groups = Array.from(byOwner.values());
  return [...groups.filter((group) => group.key !== "待分配"), ...groups.filter((group) => group.key === "待分配")];
}

/** 姓名首字圆圈（负责人不在演示人员目录里时的兜底头像）。 */
function InitialAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[11px] font-semibold text-zinc-600"
    >
      {name === "" ? "?" : Array.from(name)[0]}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** 卡片进度条（Push 98）：条照旧，右侧文字由百分比改成中文档位（未开始 / 刚开工 / 完成一半 / 快完成了 / 已完成），与任务表 Tracker 同一套口径。 */
function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-400/40">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: pct + "%" }} />
      </div>
      <span className="shrink-0 text-xs font-semibold text-zinc-700">{trackerLabel(progress)}</span>
    </div>
  );
}

/** 「所属阶段」：任务所属的施工阶段（看板里直接建的任务没有阶段，显示「未分组」）。 */
function StageChip({ stage }: { stage: string }) {
  return (
    <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + (STAGE_TAG_CLASS[stage] ?? "bg-zinc-200 text-zinc-600")}>
      {stage === "" ? UNGROUPED_STAGE : stage}
    </span>
  );
}

/** 「是否按时交付」：逾期标注优先（与任务表同一口径），其次是数据里的按时交付值。 */
function OnTimeChip({ task }: { task: ProjectTask }) {
  const late = lateDeliveryLabel(task);
  if (late === "逾期未交付") {
    return <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">逾期未交付</span>;
  }
  if (late === "逾期已交付") {
    return <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">逾期已交付</span>;
  }
  if (task.onTime === "") {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  return <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">{task.onTime}</span>;
}

/** 看板卡片：点开任务详情抽屉（要改的字段在抽屉里直接改；Push 98 起卡片上的「实际完成日期」也能直接点选）。 */
function KanbanCard({
  task,
  mode,
  onOpen,
  onPatch,
  dragging,
  ghost,
  onPointerDownDrag,
}: {
  task: ProjectTask;
  mode: KanbanMode;
  onOpen: () => void;
  /** 卡片上直接改的字段（Push 98：实际完成日期；口径同任务表行内编辑）。 */
  onPatch?: (patch: TaskPatch) => void;
  /** 正在被拖动（Push 104；Push 105 口径：**拖动中卡片样式保持原样** —— 不淡出、也不做抬起的实体态，只换抓手光标）。 */
  dragging?: boolean;
  /** 拖动卡片（Push 110）：只给跟着鼠标走的那一块用 —— 半透明壳（`CARD_SHELL_GHOST`），本体卡片永远是实心白。 */
  ghost?: boolean;
  /** 卡片按下（Push 108）：交给 TaskKanban 统一判「点一下看详情 / 按住拖动」；不传 = 这张卡片不可拖。 */
  onPointerDownDrag?: (taskId: string, node: HTMLElement, event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const status = taskStatus(task);
  const owner = memberByName(task.owner);
  const ownerLabel = task.owner === "" ? "待分配" : task.ownerEn === "" ? task.owner : task.owner + "(" + task.ownerEn + ")";
  /** 实际完成日期（Push 98）：空值「—」也带框，点开就是单日期小日历（上 / 下月、清除、今天）。 */
  const doneField =
    onPatch === undefined ? (
      <span className="text-sm text-zinc-800">{task.doneDate === "" ? "—" : task.doneDate}</span>
    ) : (
      <InlineDateCell
        valueIso={isoFromCnDate(task.doneDate)}
        ariaLabel="修改实际完成日期"
        triggerClassName="tabular-nums"
        display={task.doneDate === "" ? <span className="text-zinc-400">—</span> : task.doneDate}
        onChange={(iso) => {
          // 填实际完成日期 = 完成（四格全亮、按工期派生 已完成 / 提前完成）；清除 = 退回进行中（进度 3 格）—— 口径同 §6.9
          onPatch({
            doneDate: iso === "" ? "" : cnDateFromIso(iso),
            progress: iso === "" ? (PROGRESS_STEPS - 1) / PROGRESS_STEPS : 1,
            statusOverride: iso === "" ? "进行中" : undefined,
          });
        }}
      />
    );
  return (
    <div
      role="button"
      tabIndex={ghost === true ? -1 : 0}
      aria-label={"任务：" + task.title}
      title={onPointerDownDrag === undefined ? undefined : "按住拖到别的列 = 移到那个组（负责人 / 状态跟着改）；拖动中滚轮翻卡片、Shift + 滚轮翻列；点一下看任务详情"}
      data-kanban-card="true"
      onPointerDown={(event) => {
        if (onPointerDownDrag === undefined) {
          return;
        }
        // 只认左键；卡片里的小日历等可点元素按下时不当拖动（Push 108）
        if (event.button !== 0) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target !== null && target.closest("button, input, textarea, select, [role=menu]") !== null) {
          return;
        }
        onPointerDownDrag(task.id, event.currentTarget, event);
      }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={(ghost === true ? CARD_SHELL_GHOST : CARD_SHELL) + (dragging === true ? CARD_DRAGGING : " cursor-pointer")}
    >
      <span aria-hidden="true" className={CARD_NOISE} />
      <div className={CARD_BODY}>
        <p className="text-sm font-bold leading-5 text-zinc-900">{task.title}</p>
        {task.titleEn === "" ? null : <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{task.titleEn}</p>}

        {mode === "owner" ? (
          <>
            <Field label="预计完成日期">
              <span className="text-sm text-zinc-800">{task.dueDate === "" ? "—" : task.dueDate}</span>
            </Field>
            <Field label="任务状态">
              <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_TAG_CLASS[status]}>{status}</span>
            </Field>
            <Field label="实际完成日期">{doneField}</Field>
          </>
        ) : (
          <>
            <Field label="任务负责人">
              <span className="flex min-w-0 items-center gap-1.5">
                {owner === undefined ? <InitialAvatar name={task.owner} /> : <MemberAvatar member={owner} />}
                <span className="truncate text-sm text-zinc-800" title={ownerLabel}>{ownerLabel}</span>
              </span>
            </Field>
            <Field label="开始日期">
              <span className="text-sm text-zinc-800">{task.startDate === "" ? "—" : task.startDate}</span>
            </Field>
            <Field label="实际完成日期">{doneField}</Field>
          </>
        )}

        <Field label="项目进度">
          <ProgressBar progress={task.progress} />
        </Field>
        <Field label="是否按时交付">
          <OnTimeChip task={task} />
        </Field>
        <Field label="所属阶段">
          <StageChip stage={task.stage} />
        </Field>
      </div>
    </div>
  );
}

/** 「添加」的浮层：菜单 → 临时任务表单 / 阶段选择（选完阶段再开该阶段的模板卡片）。 */
type AddPanel = "none" | "menu" | "temp" | "stage";

/**
 * 「添加」浮层的打开态（Push 118）：整块看板只有这一份状态，`key` = 开在哪一列 —— 每列拿自己的 `key` 比对，
 * 所以**同一时刻只会有一个浮层**（点别的列的「添加」= 那一列直接接管，上一列的浮层应声关掉）。
 * `template` = 「阶段任务」选完阶段后开出来的那张模板卡片（同一条链路、同一份状态）。
 */
type AddOverlay = {
  /** 开在哪一列（`group.key`）。 */
  key: string;
  /** 开的是哪一种浮层（`template` = 阶段任务的模板卡片）。 */
  kind: "menu" | "temp" | "stage" | "template";
  /** `kind === "template"` 时 = 模板卡片开的是哪个阶段（其余时候是 null）。 */
  stage: string | null;
};

function KanbanColumn({
  group,
  mode,
  existingTaskIds,
  overlay,
  setOverlay,
  onOpenTask,
  onAddTask,
  onAddStageTask,
  stageTasksOf,
  onPatchTask,
  draggingId,
  dropIndex,
  onPointerDownDrag,
}: {
  group: KanbanGroup;
  mode: KanbanMode;
  existingTaskIds: ReadonlySet<string>;
  /** 整块看板共用的浮层状态（Push 118）：只有 `key` 是本列时，浮层才归本列渲染。 */
  overlay: AddOverlay | null;
  /** 改浮层状态（Push 118）：点本列的「添加」= 本列接管，上一列的浮层自然被顶掉。 */
  setOverlay: Dispatch<SetStateAction<AddOverlay | null>>;
  onOpenTask: (task: ProjectTask) => void;
  /** 卡片上直接改字段（Push 98）。 */
  onPatchTask?: (taskId: string, patch: TaskPatch) => void;
  /** 正在被拖动的卡片 id（Push 108；null = 没有在拖）。 */
  draggingId: string | null;
  /** 本列是不是当前落点、插到第几格（Push 108；null = 不是落点 —— 高亮与槽位都不出）。 */
  dropIndex: number | null;
  /** 卡片按下（Push 108）：交给 TaskKanban 统一判「点一下 / 拖动」；不传 = 这张卡片不可拖。 */
  onPointerDownDrag?: (taskId: string, node: HTMLElement, event: ReactPointerEvent<HTMLDivElement>) => void;
  onAddTask: (context: KanbanAddContext, values: { title: string; titleEn: string }) => void;
  onAddStageTask: (context: KanbanAddContext, stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => void;
  /** 该阶段现有任务（Push 111）：给「插入位置」当锚点 —— 顺序 = 项目总览里这些任务的先后。 */
  stageTasksOf: (stage: string) => readonly { id: string; title: string }[];
}) {
  const owner = memberByName(group.key);
  const [title, setTitle] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 112, left: 16 });
  /** 本列的浮层（Push 118）：浮层状态是整块看板共用的，只有 `key` 是本列时才归本列。 */
  const mine = overlay !== null && overlay.key === group.key ? overlay : null;
  /** 本列开的是三种「列内浮层」里的哪一种（模板卡片不算 —— 它自带一套关闭逻辑）。 */
  const panel: AddPanel = mine === null || mine.kind === "template" ? "none" : mine.kind;
  /** 本列的「阶段任务」模板卡片开的是哪个阶段（没开 = null）。 */
  const templateStage = mine !== null && mine.kind === "template" ? mine.stage : null;
  const columnRef = useRef<HTMLElement | null>(null);
  /** 落点就在本列（Push 108）：整列描边高亮 + 列内浮出插入槽位（槽位插到第 `dropIndex` 格）。 */
  const isDropTarget = dropIndex !== null;
  /** 拖动的就是本列的卡片（同列放开 = 只换顺序，不写负责人 / 状态）。 */
  const isOwnColumn = draggingId !== null && group.items.some((task) => task.id === draggingId);

  /** 新建任务带上所在列的上下文：负责人看板给负责人、进展看板给状态（与旧「+ 添加」口径一致）。 */
  const context: KanbanAddContext = {
    owner: mode === "owner" && group.key !== "待分配" ? group.key : "",
    ownerEn: mode === "owner" && group.key !== "待分配" ? group.ownerEn : "",
    status: mode === "status" ? group.status : "待开始",
  };

  /**
   * 开 / 关本列的浮层（Push 118）：写的是**整块看板共用的那一份**状态 —— 点别的列的「添加」= 那一列直接接管，
   * 上一列的浮层应声关掉（业务口径「不能同时打开 点击别的应该关闭另一个吧」）。
   */
  const openPanel = (next: AddPanel) => {
    setOverlay(next === "none" ? null : { key: group.key, kind: next, stage: null });
  };

  /** 关本列的浮层（「取消」按钮）。 */
  const closePanels = () => {
    openPanel("none");
  };

  /** 本列开着的是不是「列内浮层」（菜单 / 临时任务表单 / 阶段选择）：模板卡片自带一套关闭逻辑，不算在内。 */
  const panelActive = mine !== null && mine.kind !== "template";

  // 浮层关掉之后清掉临时任务表单里没提交的内容（下次打开是空表单）
  useEffect(() => {
    if (!panelActive) {
      setTitle("");
      setTitleEn("");
    }
  }, [panelActive]);

  // `Esc` / 点浮层外的空白处关掉（阶段任务的模板卡片自带同一套关闭逻辑）
  useEffect(() => {
    if (!panelActive) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverlay(null);
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // 点「添加」区（按钮 / 浮层本身）不算点外面；点别的列的「添加」由那一列接管、本列照旧关掉（Push 118）
      if (target !== null && target.closest("[data-add-root]") !== null) {
        return;
      }
      setOverlay(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [panelActive, setOverlay]);

  /** 阶段任务：模板卡片开在这一列的右侧、与列顶齐平（位置按列实测算，并夹在视口内）。 */
  const openTemplateCard = (stage: string) => {
    const rect = columnRef.current === null ? null : columnRef.current.getBoundingClientRect();
    if (rect !== null) {
      setCardPos({
        top: Math.max(88, Math.min(rect.top, window.innerHeight - 420)),
        left: Math.max(16, Math.min(rect.right + 12, window.innerWidth - 416)),
      });
    }
    setOverlay({ key: group.key, kind: "template", stage });
  };

  /** 插入槽位（Push 105 / 108）：浮在鼠标算出来的那两格之间 —— 放开就插到这里（同列 = 放到这里、换列 = 移到那一列）。 */
  const dropSlot =
    !isDropTarget || draggingId === null ? null : (
      <div
        data-drop-slot="true"
        className="flex items-center justify-center rounded-[35px] border-2 border-dashed border-emerald-400/70 bg-emerald-50/60 px-3 py-6 text-center text-[11px] font-medium text-emerald-700"
      >
        {isOwnColumn ? "放开：放到这里" : "放开：移到「" + group.key + "」"}
      </div>
    );

  return (
    <section
      ref={columnRef}
      data-kanban-column={group.key}
      className={COLUMN_SHELL + (isDropTarget ? " rounded-[28px] ring-2 ring-emerald-400/70 ring-offset-4 ring-offset-white" : "")}
    >
      <header className="mb-3 flex items-center gap-2 px-1">
        {mode === "owner" ? (
          <>
            {owner === undefined ? <InitialAvatar name={group.key} /> : <MemberAvatar member={owner} />}
            <span className="truncate text-sm font-medium text-zinc-700" title={group.key}>{group.key}</span>
          </>
        ) : (
          <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + STATUS_TAG_CLASS[group.status]}>{group.key}</span>
        )}
        <span className="shrink-0 text-xs text-zinc-400">{group.items.length}项</span>
      </header>

      {/* 卡片列表：滚动条隐式（原生滚动条隐藏，滚动 / 悬停才浮出自绘滑块） */}
      <ScrollArea viewportClassName="min-h-0 flex-1" className="flex flex-col gap-3 pr-1" ariaLabel={"任务卡片：" + group.key}>
        {group.items.map((task, index) => (
          <Fragment key={task.id}>
            {dropSlot !== null && dropIndex === index ? dropSlot : null}
            <KanbanCard
              task={task}
              mode={mode}
              onOpen={() => {
                onOpenTask(task);
              }}
              onPatch={
                onPatchTask === undefined
                  ? undefined
                  : (patch) => {
                      onPatchTask(task.id, patch);
                    }
              }
              dragging={draggingId === task.id}
              onPointerDownDrag={onPointerDownDrag}
            />
          </Fragment>
        ))}
        {dropSlot !== null && dropIndex === group.items.length ? dropSlot : null}
      </ScrollArea>

      <div data-add-root="true" className={COLUMN_FOOTER}>
        <div className="relative">
          {panel === "menu" ? (
            <div className={ADD_POPOVER} role="menu" aria-label={"添加任务：" + group.key}>
              <p className="px-1 pb-1 text-[11px] text-zinc-400">添加任务</p>
              <button type="button" role="menuitem" onClick={() => { openPanel("temp"); }} className={ADD_ENTRY}>
                临时任务
                <span className={ADD_ENTRY_HINT}>自己填内容</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { openPanel("stage"); }} className={ADD_ENTRY + " mt-1"}>
                阶段任务
                <span className={ADD_ENTRY_HINT}>从模板里选</span>
              </button>
            </div>
          ) : null}

          {panel === "temp" ? (
            <form
              className={ADD_POPOVER}
              onSubmit={(event) => {
                event.preventDefault();
                if (title.trim() === "") {
                  return;
                }
                onAddTask(context, { title: title.trim(), titleEn: titleEn.trim() });
                closePanels();
              }}
            >
              <p className="px-1 pb-1 text-[11px] text-zinc-400">临时任务</p>
              <input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); }} placeholder="任务名称（必填）" className={ADD_INPUT} />
              <input value={titleEn} onChange={(event) => { setTitleEn(event.target.value); }} placeholder="英文名（可留空）" className={ADD_INPUT + " mt-1.5"} />
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <button type="button" onClick={closePanels} className="rounded-lg border border-white/70 bg-white/60 px-2 py-1 text-[11px] text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700">取消</button>
                <button type="submit" disabled={title.trim() === ""} className="rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/60 disabled:text-zinc-400">创建</button>
              </div>
            </form>
          ) : null}

          {panel === "stage" ? (
            <div className={ADD_POPOVER} role="menu" aria-label={"选择阶段：" + group.key}>
              <p className="px-1 pb-1 text-[11px] text-zinc-400">阶段任务 · 先选阶段</p>
              <div className="scrollbar-hidden grid max-h-56 gap-1 overflow-y-auto">
                {STAGE_OPTIONS.map((stage) => (
                  <button key={stage} type="button" role="menuitem" onClick={() => { openTemplateCard(stage); }} className={ADD_STAGE}>
                    {stage}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => { openPanel(panel === "none" ? "menu" : "none"); }}
            aria-label={"添加任务：" + group.key}
            aria-expanded={panel !== "none"}
            className={ADD_BUTTON}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className="h-3.5 w-3.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8.5v7M8.5 12h7" strokeLinecap="round" />
            </svg>
            添加
          </button>
        </div>
      </div>

      {templateStage === null ? null : (
        <StageAddCard
          stage={templateStage}
          existingTaskIds={existingTaskIds}
          placement={{ tasks: stageTasksOf(templateStage) }}
          onAddNodes={(stage, nodes, placement) => { onAddStageTask(context, stage, nodes, placement); }}
          onClose={() => {
            // 只关「本列这张模板卡片」（Push 118）：卡片自己关得比点别处晚时，不误伤刚打开的那个浮层
            setOverlay((prev) => (prev !== null && prev.kind === "template" && prev.key === group.key ? null : prev));
          }}
          style={{ position: "fixed", top: cardPos.top, left: cardPos.left }}
        />
      )}
    </section>
  );
}

export function TaskKanban({ mode, tasks, manager, managerId, onAddTask, onAddStageTask, onSubmitTaskEdit, onPatchTask, onReorderTask, onSetProgress }: TaskKanbanProps) {
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  /**
   * 「添加」浮层（Push 118）：整块看板共用的**单值**状态 —— 业务反馈「这有bug吧 不能同时打开 点击别的应该关闭另一个吧」。
   * 原来这份状态是每列一份（列内局部 state），六列互不感知、能同时开着菜单；提到这一层之后同一时刻只会有一个。
   */
  const [addOverlay, setAddOverlay] = useState<AddOverlay | null>(null);
  /** 正在拖动的卡片 id（Push 108；null = 没在拖）。 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 当前落点（Push 108）：`key` = 哪一列、`index` = 插到第几格；null = 鼠标不在任何列上。 */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  /** 按下卡片、还没过拖动阈值时的暂存（Push 108）：没过阈值就还是「点一下看详情」。 */
  const pendingRef = useRef<PendingDrag | null>(null);
  /** 拖动中鼠标的最后位置（Push 108）：滚轮翻列 / 翻卡片时鼠标可以不动，落点按这个位置重算。 */
  const pointerRef = useRef({ x: 0, y: 0 });
  /** 拖动收尾那一下的 `click` 不当成「打开抽屉」（Push 108）。 */
  const suppressClickRef = useRef(false);
  /** 跟着鼠标走的拖动卡片（Push 109）：直接用 DOM 改 `transform`，不走 state（每帧都要动）。 */
  const ghostRef = useRef<HTMLDivElement | null>(null);
  /** 抓取偏移（Push 109）：按下时鼠标在卡片内的位置 + 卡片宽度，拖动卡片按这个对齐。 */
  const grabRef = useRef({ dx: 0, dy: 0, width: 0 });
  /** 任务表最新值 + 两个「最新实现」的 ref（Push 108）：指针 / 每帧回调里读，免得闭包吃到旧值。 */
  const tasksRef = useRef(tasks);
  const dropTargetAtRef = useRef<(x: number, y: number) => DropTarget | null>(() => null);
  const moveTaskRef = useRef<(taskId: string, group: KanbanGroup, index: number) => void>(() => undefined);
  /** 抽屉里的任务按 id 取当前值（Push 98）：卡片 / 抽屉里改完，抽屉要立刻反映最新进度与日期。 */
  const drawerTask = selectedTask === null ? null : tasks.find((task) => task.id === selectedTask.id) ?? selectedTask;
  const groups = groupTasks(tasks, mode);
  /** 已经在项目里的任务 id：模板节点按 id 判重 —— 「阶段任务」里已加过的节点显示「已添加」、点不动。 */
  const existingTaskIds = new Set(tasks.map((task) => task.id));
  /**
   * 该阶段现有任务（Push 111）：给「添加 → 阶段任务」的插入位置当锚点。
   * `tasks` 已经是展示顺序（阶段为主键、组内按看板顺序表），所以这里的先后 = 项目总览里这些任务的先后。
   */
  const stageTasksOf = (stage: string) =>
    tasks.filter((task) => task.stage === stage).map((task) => ({ id: task.id, title: task.title }));

  /**
   * 鼠标底下是「哪一列的第几格」（Push 108）：`data-kanban-column` 认列、卡片中线认格 —— 口径同 Push 105
   * （某张卡片中线以上 = 插到这张前面，都在上面 = 插到列尾）；浮动的那块虚线槽位不参与计算（它没有 `data-kanban-card`）。
   */
  const dropTargetAt = (x: number, y: number): DropTarget | null => {
    const under = document.elementFromPoint(x, y);
    const column = under === null ? null : under.closest("[data-kanban-column]");
    if (column === null) {
      return null;
    }
    const key = column.getAttribute("data-kanban-column") ?? "";
    if (!groups.some((group) => group.key === key)) {
      return null;
    }
    const cards = Array.from(column.querySelectorAll("[data-kanban-card='true']"));
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return { key, index: i };
      }
    }
    return { key, index: cards.length };
  };

  /**
   * 卡片被拖到某一列的第 `index` 格（Push 104；业务口径「卡片要支持拖动 移动别的组 也相当于编辑 移动后相关的信息要对应」）：
   * ① **换列 = 编辑** —— 负责人看板 = 改任务负责人（拖到「待分配」列 = 清空负责人）；进展看板 = 改任务状态，
   * 两条路都走任务表行内编辑用的同一个 `onPatchTask`（同一张覆盖表），状态那一路同时写四格进度（`progressAfterStatus`）
   * 并在改成非完成态时清空实际完成日期（Push 67 业务定案）；卡片上的进度档位、实际完成日期、是否按时交付随之同步。
   * ② **落点 = 列内顺序**（Push 105）—— 交给 `onReorderTask` 存进看板顺序表；同列拖动只排顺序（负责人 / 状态不动）。
   */
  const moveTaskToGroup = (taskId: string, group: KanbanGroup, index: number) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task === undefined) {
      return;
    }
    // 落点换算（Push 105）：同列拖动时鼠标算出来的插入位带着被拖的这张卡，先把它摘掉再数位置
    const ids = group.items.map((item) => item.id);
    const ownIndex = ids.indexOf(taskId);
    const withoutIndex = ownIndex >= 0 && index > ownIndex ? index - 1 : index;
    const idsWithout = ids.filter((id) => id !== taskId);
    const beforeTaskId = withoutIndex < idsWithout.length ? idsWithout[withoutIndex] : null;
    // 落在列尾：锚在这一列的最后一张之后（不甩到整个项目顺序的末尾）；目标列没别的卡片时两个锚都是 null = 只换列
    const afterTaskId = beforeTaskId === null && withoutIndex > 0 ? idsWithout[withoutIndex - 1] : null;
    /** 同一列里这张卡的下一张（换列时 = undefined）；落点没变就不写顺序。 */
    const currentNext = ownIndex < 0 ? undefined : ids[ownIndex + 1] ?? null;
    const sameSpot = ownIndex >= 0 && (beforeTaskId === null ? ownIndex === ids.length - 1 : beforeTaskId === currentNext);
    if (!sameSpot && (beforeTaskId !== null || afterTaskId !== null) && onReorderTask !== undefined) {
      onReorderTask(taskId, beforeTaskId, afterTaskId);
    }
    if (onPatchTask === undefined) {
      return;
    }
    if (mode === "owner") {
      const nextOwner = group.key === "待分配" ? "" : group.key;
      const nextOwnerEn = nextOwner === "" ? "" : memberByName(nextOwner)?.handle ?? group.ownerEn;
      if (task.owner === nextOwner && task.ownerEn === nextOwnerEn) {
        return;
      }
      onPatchTask(task.id, { owner: nextOwner, ownerEn: nextOwnerEn });
      return;
    }
    const nextStatus = group.status;
    if (taskStatus(task) === nextStatus) {
      return;
    }
    onPatchTask(task.id, {
      statusOverride: nextStatus,
      progress: progressAfterStatus(nextStatus, task.progress),
      doneDate: isCompleteStatus(nextStatus) ? task.doneDate : "",
    });
  };

  // 三个「最新实现」的 ref（Push 108）：指针 / 每帧回调里读最新实现，免得闭包吃到上一轮的函数
  useEffect(() => {
    tasksRef.current = tasks;
    dropTargetAtRef.current = dropTargetAt;
    moveTaskRef.current = moveTaskToGroup;
  });

  /**
   * 指针拖动（Push 108）：① 按下卡片后位移超过 `DRAG_THRESHOLD` 才算真拖动（没过阈值 = 点一下看详情）；
   * ② 拖动中鼠标动一下就更新落点；③ 放开时落在哪一列的第几格就交给 `moveTaskToGroup`（与表格行内编辑同一张覆盖表）；
   * ④ Esc / 指针取消 = 原地取消。整段拖动**没有**原生拖拽参与，所以滚轮照常可用（这就是「鼠标自己控制」的实现方式）。
   */
  useEffect(() => {
    /** 收尾（放开 / Esc / 指针取消）：清掉暂存与落点，恢复页面文字选择。 */
    const endDrag = () => {
      pendingRef.current = null;
      document.body.style.userSelect = "";
      setDraggingId(null);
      setDropTarget(null);
    };
    const handleMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const pending = pendingRef.current;
      if (pending === null || pending.dragging) {
        return;
      }
      if (Math.abs(event.clientX - pending.x) + Math.abs(event.clientY - pending.y) < DRAG_THRESHOLD) {
        return;
      }
      pending.dragging = true;
      try {
        // 指针捕获在卡片上：鼠标滑出窗口再放开也收得到 pointerup
        pending.node.setPointerCapture(pending.pointerId);
      } catch {
        // 指针已经不在了（例如刚抬起）：忽略，落点照样按下面的逻辑算
      }
      const rect = pending.node.getBoundingClientRect();
      grabRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width };
      document.body.style.userSelect = "none";
      suppressClickRef.current = true;
      setDraggingId(pending.taskId);
      setDropTarget(dropTargetAtRef.current(event.clientX, event.clientY));
    };
    const handleUp = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending === null) {
        return;
      }
      const wasDragging = pending.dragging;
      pendingRef.current = null;
      document.body.style.userSelect = "";
      setDraggingId(null);
      setDropTarget(null);
      if (!wasDragging) {
        return;
      }
      const target = dropTargetAtRef.current(event.clientX, event.clientY);
      if (target === null) {
        return;
      }
      const group = groupTasks(tasksRef.current, mode).find((item) => item.key === target.key);
      if (group === undefined) {
        return;
      }
      moveTaskRef.current(pending.taskId, group, target.index);
    };
    const handleCancel = () => {
      endDrag();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingRef.current !== null) {
        endDrag();
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mode]);

  /**
   * 拖动中按帧重算落点（Push 108）：鼠标可以不动、容器在滚（滚轮翻列 / 翻卡片），槽位得跟着卡片位置走，
   * 不能停在按下时算出来的那一格。
   */
  useEffect(() => {
    if (draggingId === null) {
      return;
    }
    let raf = window.requestAnimationFrame(function tick() {
      // 拖动卡片跟着鼠标（Push 109）：按抓取偏移对齐，跟落点同一个循环、同一帧
      const ghost = ghostRef.current;
      if (ghost !== null) {
        const grab = grabRef.current;
        ghost.style.transform = "translate(" + (pointerRef.current.x - grab.dx) + "px," + (pointerRef.current.y - grab.dy) + "px)";
      }
      const next = dropTargetAtRef.current(pointerRef.current.x, pointerRef.current.y);
      setDropTarget((prev) => (prev !== null && next !== null && prev.key === next.key && prev.index === next.index ? prev : next));
      raf = window.requestAnimationFrame(tick);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [draggingId]);

  /** 按下卡片（Push 108）：先只记「可能拖动」，真拖动由上面的指针循环判定。 */
  const beginCardDrag = (taskId: string, node: HTMLElement, event: ReactPointerEvent<HTMLDivElement>) => {
    pendingRef.current = { taskId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, node, dragging: false };
    pointerRef.current = { x: event.clientX, y: event.clientY };
    suppressClickRef.current = false;
  };

  /** 拖动中的那张任务（Push 109）：用来画跟着鼠标走的拖动卡片。 */
  const draggingTask = draggingId === null ? null : tasks.find((task) => task.id === draggingId) ?? null;

  /** 点一下卡片 = 打开任务详情抽屉；拖动收尾那一下的 `click` 不算（Push 108）。 */
  const openTask = (task: ProjectTask) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelectedTask(task);
  };

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-sm text-zinc-500">
        这个项目还没有任务：到「项目总览」点阶段标签，从任务节点 / 模板里挑节点加进来。
      </div>
    );
  }

  return (
    <>
      <ScrollArea axis="horizontal" ariaLabel="任务看板：横向滚动查看全部列" viewportClassName="pb-3" className="flex items-start gap-4">
        {groups.map((group) => (
          <KanbanColumn
            key={group.key}
            group={group}
            mode={mode}
            existingTaskIds={existingTaskIds}
            overlay={addOverlay}
            setOverlay={setAddOverlay}
            onOpenTask={openTask}
            onAddTask={onAddTask}
            onAddStageTask={onAddStageTask}
            stageTasksOf={stageTasksOf}
            onPatchTask={onPatchTask}
            draggingId={onPatchTask === undefined ? null : draggingId}
            dropIndex={dropTarget !== null && dropTarget.key === group.key ? dropTarget.index : null}
            onPointerDownDrag={onPatchTask === undefined ? undefined : beginCardDrag}
          />
        ))}
      </ScrollArea>
      {draggingTask === null ? null : (
        <div
          ref={ghostRef}
          data-drag-ghost="true"
          aria-hidden="true"
          style={{ width: grabRef.current.width === 0 ? undefined : grabRef.current.width }}
          className="pointer-events-none fixed left-0 top-0 z-50 will-change-transform"
        >
          <KanbanCard task={draggingTask} mode={mode} ghost onOpen={() => undefined} />
        </div>
      )}
      <TaskDrawer
        task={drawerTask}
        manager={manager}
        managerId={managerId}
        onSubmit={onSubmitTaskEdit}
        onProgress={onSetProgress}
        onPatch={onPatchTask}
        onClose={() => {
          setSelectedTask(null);
        }}
      />
    </>
  );
}
