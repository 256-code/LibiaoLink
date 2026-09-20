import { useEffect, useRef, useState, type ReactNode } from "react";
import { memberByName } from "../data/members";
import { PROJECT_STAGES } from "../data/projects";
import type { TemplatePresetNode } from "../data/templatePresets";
import { PROGRESS_STEPS, cnDateFromIso, isoFromCnDate, lateDeliveryLabel, taskStatus, type ProjectTask, type TaskStatus } from "../data/tasks";
import { InlineDateCell } from "./InlineEdit";
import { MemberAvatar } from "./MemberSelect";
import { ScrollArea } from "./ScrollArea";
import { StageAddCard } from "./StageAddCard";
import { TaskDrawer } from "./TaskDrawer";
import type { TaskEditSubmit } from "./TaskDrawer";
import { STATUS_TAG_CLASS, type TaskPatch } from "./TaskBoard";
import { trackerLabel } from "./Tracker";

/**
 * 项目详情页的两块看板（Push 82）：
 * - `owner`「人员任务分配」：列 = 任务负责人（人头维度），看每个人手上接了哪些任务；
 * - `status`「任务进展」：列 = 任务状态（已延期 → 进行中 → 已完成 → 提前完成 → 待开始），看每个状态有哪些任务。
 * 卡片材质按业务样张代码还原（外层壳 + 噪点叠加 + 内层板 + 多层投影），用 Tailwind 任意值实现，不引入 styled-components。
 * 卡片只出任务里真实存在的字段（标题 / 所属阶段 / 日期 / 状态 / 负责人 / 进度 / 是否按时交付）；任务字段里没有「里程碑」这一项，所以阶段一栏的口径是「所属阶段」，不写「阶段性里程碑」。
 * Push 98：进度一栏的文字由百分比改成中文档位（与任务表 Tracker 同一套标签），并新增「实际完成日期」一栏 —— 卡片上直接点选小日历就能改（口径同表格行内编辑：填 = 完成、清 = 退回进行中）。
 * 列底「添加」固定在列底、不随卡片滚动（Push 86），两种口径：**临时任务**（自己填标题，阶段留空 → 卡片「所属阶段」显示「未分组」、到「项目总览」落在「未分组」组）/ **阶段任务**（先选阶段，再从该阶段的节点池 / 模板里挑节点加进项目，任务自带阶段）。
 * 列内滚动条是**隐式**的：原生滚动条隐藏，滚动 / 悬停才浮出自绘滑块（`ScrollArea`，与分类筛选侧栏 / 任务抽屉同一套）。
 * 看板横向滚动条同样**隐式**（Push 87）：列排布交给 `ScrollArea axis="horizontal"`，原生滚动条（Windows 下带箭头那条横杠）隐藏，滑块只在滚动 / 悬停时浮在列底留白里；列高按「铺满视口」重算（`100vh - 12.75rem`），列底与页面底之间不再留下大块空白。
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

/** 卡片内层板（样张：圆角 30px；白卡口径 = 近白面板 + 发丝内边）。 */
const CARD_INNER = "relative block overflow-hidden rounded-[30px] bg-[#fcfcfd] px-4 py-3.5 ring-1 ring-zinc-900/[0.04]";

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
  /** 列底「添加 → 阶段任务」：从该阶段节点池 / 模板选的节点加进项目，并带上所在列的负责人 / 状态。 */
  onAddStageTask: (context: KanbanAddContext, stage: string, node: TemplatePresetNode) => void;
  /** 任务编辑保存（与表格共用同一张覆盖表）。 */
  onSubmitTaskEdit?: (values: TaskEditSubmit) => void;
  /** 卡片上直接改字段（Push 98：实际完成日期；与表格行内同一套口径）。 */
  onPatchTask?: (taskId: string, patch: TaskPatch) => void;
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
}: {
  task: ProjectTask;
  mode: KanbanMode;
  onOpen: () => void;
  /** 卡片上直接改的字段（Push 98：实际完成日期；口径同任务表行内编辑）。 */
  onPatch?: (patch: TaskPatch) => void;
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
      tabIndex={0}
      aria-label={"任务：" + task.title}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={CARD_SHELL + " cursor-pointer"}
    >
      <span aria-hidden="true" className={CARD_NOISE} />
      <div className={CARD_INNER}>
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

function KanbanColumn({
  group,
  mode,
  existingTaskIds,
  onOpenTask,
  onAddTask,
  onAddStageTask,
  onPatchTask,
}: {
  group: KanbanGroup;
  mode: KanbanMode;
  existingTaskIds: ReadonlySet<string>;
  onOpenTask: (task: ProjectTask) => void;
  /** 卡片上直接改字段（Push 98）。 */
  onPatchTask?: (taskId: string, patch: TaskPatch) => void;
  onAddTask: (context: KanbanAddContext, values: { title: string; titleEn: string }) => void;
  onAddStageTask: (context: KanbanAddContext, stage: string, node: TemplatePresetNode) => void;
}) {
  const owner = memberByName(group.key);
  const [panel, setPanel] = useState<AddPanel>("none");
  const [title, setTitle] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [templateStage, setTemplateStage] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 112, left: 16 });
  const columnRef = useRef<HTMLElement | null>(null);

  /** 新建任务带上所在列的上下文：负责人看板给负责人、进展看板给状态（与旧「+ 添加」口径一致）。 */
  const context: KanbanAddContext = {
    owner: mode === "owner" && group.key !== "待分配" ? group.key : "",
    ownerEn: mode === "owner" && group.key !== "待分配" ? group.ownerEn : "",
    status: mode === "status" ? group.status : "待开始",
  };

  const closePanels = () => {
    setPanel("none");
    setTitle("");
    setTitleEn("");
  };

  // `Esc` / 点浮层外的空白处关掉（阶段任务的模板卡片自带同一套关闭逻辑）
  useEffect(() => {
    if (panel === "none") {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanels();
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target !== null && target.closest("[data-add-root]") !== null) {
        return;
      }
      closePanels();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [panel]);

  /** 阶段任务：模板卡片开在这一列的右侧、与列顶齐平（位置按列实测算，并夹在视口内）。 */
  const openTemplateCard = (stage: string) => {
    const rect = columnRef.current === null ? null : columnRef.current.getBoundingClientRect();
    if (rect !== null) {
      setCardPos({
        top: Math.max(88, Math.min(rect.top, window.innerHeight - 420)),
        left: Math.max(16, Math.min(rect.right + 12, window.innerWidth - 416)),
      });
    }
    setPanel("none");
    setTemplateStage(stage);
  };

  return (
    <section ref={columnRef} className={COLUMN_SHELL}>
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
        {group.items.map((task) => (
          <KanbanCard
            key={task.id}
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
          />
        ))}
      </ScrollArea>

      <div data-add-root="true" className={COLUMN_FOOTER}>
        <div className="relative">
          {panel === "menu" ? (
            <div className={ADD_POPOVER} role="menu" aria-label={"添加任务：" + group.key}>
              <p className="px-1 pb-1 text-[11px] text-zinc-400">添加任务</p>
              <button type="button" role="menuitem" onClick={() => { setPanel("temp"); }} className={ADD_ENTRY}>
                临时任务
                <span className={ADD_ENTRY_HINT}>自己填内容</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setPanel("stage"); }} className={ADD_ENTRY + " mt-1"}>
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
            onClick={() => { setPanel(panel === "none" ? "menu" : "none"); }}
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
          onAddNode={(stage, node) => { onAddStageTask(context, stage, node); }}
          onClose={() => { setTemplateStage(null); }}
          style={{ position: "fixed", top: cardPos.top, left: cardPos.left }}
        />
      )}
    </section>
  );
}

export function TaskKanban({ mode, tasks, manager, managerId, onAddTask, onAddStageTask, onSubmitTaskEdit, onPatchTask, onSetProgress }: TaskKanbanProps) {
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  /** 抽屉里的任务按 id 取当前值（Push 98）：卡片 / 抽屉里改完，抽屉要立刻反映最新进度与日期。 */
  const drawerTask = selectedTask === null ? null : tasks.find((task) => task.id === selectedTask.id) ?? selectedTask;
  const groups = groupTasks(tasks, mode);
  /** 已经在项目里的任务 id：模板节点按 id 判重 —— 「阶段任务」里已加过的节点显示「已添加」、点不动。 */
  const existingTaskIds = new Set(tasks.map((task) => task.id));

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
            onOpenTask={(task) => {
              setSelectedTask(task);
            }}
            onAddTask={onAddTask}
            onAddStageTask={onAddStageTask}
            onPatchTask={onPatchTask}
          />
        ))}
      </ScrollArea>
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
