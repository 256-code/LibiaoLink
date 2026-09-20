import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { STAGE_TEMPLATE_PRESETS, type TemplatePresetNode } from "../data/templatePresets";
import { ScrollArea } from "./ScrollArea";
import { usePopover } from "./usePopover";

/**
 * 插入位置（Push 111，业务口径「人员要指定位置放入」）：新加的任务放进该阶段里的哪一格 ——
 * `last` = 该阶段最后（默认）；`before` / `after` = 以某张同阶段任务为锚，插到它前面 / 后面。
 */
export type StagePlacement = { kind: "last" } | { kind: "before"; taskId: string } | { kind: "after"; taskId: string };

/** 当前选择的文案（触发器上显示）。 */
function placementLabel(placement: StagePlacement, tasks: readonly { id: string; title: string }[]): string {
  if (placement.kind === "last") {
    return "该阶段最后（默认）";
  }
  if (placement.kind === "before") {
    return "该阶段最前";
  }
  const anchor = tasks.find((task) => task.id === placement.taskId);
  return anchor === undefined ? "该阶段最后（默认）" : "在《" + anchor.title + "》之后";
}

/** 勾选图标（与普通下拉的勾选态同一枚）。 */
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 插入位置选择器（Push 112，业务口径「前两项可以 但是下面的太乱了 只要显示当前阶段的顺序即可 然后不要全部展示 要可以滑动 固定尺寸
 * 鼠标放上去 点击将插入此任务之后」）：触发器 + 浮层 —— 浮层里前两档固定（该阶段最后（默认）/ 该阶段最前），
 * 下面按**当前阶段的顺序**列出该阶段任务（固定高度、隐式滚动条、可滑动），悬停高亮并浮出「插到它后面」，点一条 = 插到这张任务之后。
 */
function PlacementPicker({ tasks, value, onChange, ariaLabel }: {
  tasks: readonly { id: string; title: string }[];
  value: StagePlacement;
  onChange: (next: StagePlacement) => void;
  ariaLabel: string;
}) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(300, 320);
  const pick = (next: StagePlacement) => {
    onChange(next);
    setOpen(false);
  };
  const fixed: readonly { kind: StagePlacement["kind"]; label: string }[] = [
    { kind: "last", label: "该阶段最后（默认）" },
    { kind: "before", label: "该阶段最前" },
  ];
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => { setOpen((previous) => !previous); }}
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        <span className="truncate font-medium text-zinc-800">{placementLabel(value, tasks)}</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-zinc-400">
          <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              data-select-popover="true"
              role="dialog"
              aria-label={ariaLabel}
              style={{ top: position.top, left: position.left, width: position.width }}
              className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
            >
              <div className="p-1">
                {fixed.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    aria-pressed={value.kind === item.kind}
                    onClick={() => { pick(item.kind === "before" ? { kind: "before", taskId: tasks[0].id } : { kind: "last" }); }}
                    className={
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 " +
                      (value.kind === item.kind ? "bg-zinc-50" : "")
                    }
                  >
                    {item.label}
                    {value.kind === item.kind ? <CheckIcon /> : null}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2.5 py-1.5">
                <span className="text-[10px] text-zinc-400">该阶段任务顺序</span>
                <span className="text-[10px] text-zinc-400">点一条 = 插到它后面</span>
              </div>

              <ScrollArea ariaLabel="该阶段任务顺序" viewportClassName="h-[176px]" className="px-1 pb-1">
                {tasks.map((task, index) => {
                  const selected = value.kind === "after" && value.taskId === task.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      aria-pressed={selected}
                      title="点击插到它后面"
                      onClick={() => { pick({ kind: "after", taskId: task.id }); }}
                      className={
                        "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition " +
                        (selected ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-100")
                      }
                    >
                      <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-zinc-400">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      {selected ? (
                        <CheckIcon />
                      ) : (
                        <span className="shrink-0 text-[10px] text-zinc-400 opacity-0 transition group-hover:opacity-100">插到它后面</span>
                      )}
                    </button>
                  );
                })}
              </ScrollArea>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

type StageAddCardProps = {
  stage: string;
  existingTaskIds: ReadonlySet<string>;
  onAddNode: (stage: string, node: TemplatePresetNode) => void;
  /** 一次加多个（Push 111，「整套添加」按钮用）：不传时退回逐个 `onAddNode`。 */
  onAddNodes?: (stage: string, nodes: readonly TemplatePresetNode[]) => void;
  /**
   * 插入位置（Push 111）：给了就显示「插入位置」一行 —— 锚点 = 该阶段现有任务（按项目总览里的先后）。
   * 看板的「添加 → 阶段任务」会传；项目总览里点阶段标签加节点不传（默认排该阶段最后）。
   */
  placement?: {
    tasks: readonly { id: string; title: string }[];
    value: StagePlacement;
    onChange: (next: StagePlacement) => void;
  };
  onClose: () => void;
  /** 卡片落点（由 TaskBoard 量表格算出来：表头正下方、贴表格右边缘）；不传时回落到右上角悬浮。 */
  style?: CSSProperties;
};

/** 这个阶段的节点池（与任务模板页左列同口径）：该阶段全部预设节点按出现顺序去重。 */
function presetNodesOf(stage: string): TemplatePresetNode[] {
  const seen = new Set<string>();
  const items: TemplatePresetNode[] = [];
  for (const preset of STAGE_TEMPLATE_PRESETS[stage] ?? []) {
    for (const node of preset.nodes) {
      if (seen.has(node.id)) {
        continue;
      }
      seen.add(node.id);
      items.push(node);
    }
  }
  return items;
}

/**
 * 任务表里点阶段标签（「售前规划」…「验收」）打开的右侧中等卡片：
 * 顶部是标签导航 —— 第一个「任务节点」（这个阶段的节点池，点一条就加进项目），
 * 其余每个标签 = 这个阶段的一块模板（按预设顺序预览、可鼠标滚动，也能逐条 / 整套加）。
 * 关卡片 = 右上 × / `Esc` / **点卡片外的空白处** / **再点同一个阶段标签**；换阶段标签或换项目时也会自动关掉（由 TaskBoard 控制）。
 */
export function StageAddCard({ stage, existingTaskIds, onAddNode, onAddNodes, placement, onClose, style }: StageAddCardProps) {
  const presets = useMemo(() => STAGE_TEMPLATE_PRESETS[stage] ?? [], [stage]);
  const nodes = useMemo(() => presetNodesOf(stage), [stage]);
  const [activeTab, setActiveTab] = useState("nodes");
  const cardRef = useRef<HTMLElement | null>(null);

  // 换阶段（点了别的阶段标签）时回到第一个标签
  useEffect(() => {
    setActiveTab("nodes");
  }, [stage]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // 「插入位置」浮层开着时（Push 112）：Esc 先关浮层，再按一次才关卡片
      if (document.querySelector("[data-select-popover]") !== null) {
        return;
      }
      onClose();
    };
    // 点卡片外的空白处也关掉（任务行 / 表头 / 汇总卡 / 页面其它地方都算）；
    // 阶段标签（data-stage-pill）除外 —— 点同一个标签由标签自己的点击逻辑开关（再点即关）
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target !== null && target.closest("[data-stage-pill]") !== null) {
        return;
      }
      // 「插入位置」下拉是挂到 body 的浮层（Push 111）：点它不算点卡片外面，卡片不关
      if (target !== null && target.closest("[data-select-popover]") !== null) {
        return;
      }
      if (cardRef.current !== null && !cardRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  const templateIndex = presets.findIndex((_, index) => "tpl-" + String(index) === activeTab);
  const currentPreset = templateIndex === -1 ? undefined : presets[templateIndex];
  const isNodesTab = currentPreset === undefined;
  const items = currentPreset?.nodes ?? nodes;
  const pendingCount = items.filter((node) => !existingTaskIds.has(node.id)).length;
  const addedCount = items.length - pendingCount;

  return (
    <aside
      ref={cardRef}
      role="dialog"
      aria-label={stage + "：任务节点与模板"}
      style={style ?? { top: 112, right: 24 }}
      className="absolute z-40 flex max-h-[72vh] w-[400px] max-w-[calc(100vw-3rem)] flex-col rounded-2xl border border-white/80 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.98),rgba(255,255,255,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_12px_40px_rgba(15,23,42,0.22)] backdrop-blur-2xl backdrop-saturate-150"
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-800">{stage}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            节点 {nodes.length} 个 · 模板 {presets.length} 块
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          title="关闭"
          className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-white/70 hover:text-zinc-700"
        >
          <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="h-3.5 w-3.5">
            <path d="M4 4l7 7M11 4l-7 7" />
          </svg>
        </button>
      </div>

      {/* 标签导航：任务节点 + 这个阶段的模板（模板多时横向滚动） */}
      <div className="mt-3 flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200/80">
        <button
          type="button"
          onClick={() => setActiveTab("nodes")}
          aria-current={isNodesTab ? "true" : undefined}
          className={
            "whitespace-nowrap border-b-2 px-2.5 py-1.5 text-xs font-medium transition " +
            (isNodesTab ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800")
          }
        >
          任务节点
          <span className="ml-1 text-[10px] text-zinc-400">{nodes.length}</span>
        </button>
        {presets.map((preset, index) => {
          const key = "tpl-" + String(index);
          const active = key === activeTab;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              aria-current={active ? "true" : undefined}
              className={
                "whitespace-nowrap border-b-2 px-2.5 py-1.5 text-xs font-medium transition " +
                (active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800")
              }
            >
              {preset.name}
              <span className="ml-1 text-[10px] text-zinc-400">{preset.nodes.length}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-500">
          {isNodesTab ? "点一条节点就加进项目" : "模板预览（鼠标滚动看全）"} · 已添加 {addedCount}
        </span>
        {isNodesTab ? null : (
          <button
            type="button"
            disabled={pendingCount === 0}
            onClick={() => {
              const pending = items.filter((node) => !existingTaskIds.has(node.id));
              if (onAddNodes === undefined) {
                for (const node of pending) {
                  onAddNode(stage, node);
                }
                return;
              }
              onAddNodes(stage, pending);
            }}
            title="把这块模板里还没加过的节点一次全加到项目"
            className="shrink-0 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/60 disabled:text-zinc-400"
          >
            整套添加（{pendingCount}）
          </button>
        )}
      </div>

      {placement === undefined ? null : (
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <span className="shrink-0 text-[11px] text-zinc-500">插入位置</span>
          <div className="min-w-0 flex-1">
            {placement.tasks.length === 0 ? (
              <span className="text-[11px] text-zinc-400">该阶段还没有别的任务 —— 只能排在该阶段最后</span>
            ) : (
              <PlacementPicker
                tasks={placement.tasks}
                value={placement.value}
                onChange={placement.onChange}
                ariaLabel="插入位置：这个阶段里的位置"
              />
            )}
          </div>
        </div>
      )}

      <ul className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {items.map((node, index) => {
          const added = existingTaskIds.has(node.id);
          return (
            <li key={node.id}>
              <button
                type="button"
                disabled={added}
                onClick={() => onAddNode(stage, node)}
                title={added ? "已经在项目里" : "添加到项目 · " + stage}
                className={
                  "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition " +
                  (added
                    ? "cursor-default border-white/60 bg-white/40"
                    : "border-white/70 bg-white/70 hover:border-zinc-300 hover:bg-white")
                }
              >
                {isNodesTab ? null : (
                  <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-zinc-400">{index + 1}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={"block truncate text-xs " + (added ? "text-zinc-400" : "font-medium text-zinc-700")}>{node.title}</span>
                  <span className="block truncate text-[10px] text-zinc-400">{node.titleEn}</span>
                </span>
                <span className={"shrink-0 text-[11px] " + (added ? "text-zinc-400" : "font-medium text-emerald-700")}>
                  {added ? "已添加" : "＋ 添加"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 shrink-0 text-[10px] leading-4 text-zinc-400">节点与模板来自「任务模板」的预设；当前原型未接后端，数据存浏览器内存、刷新回到初始数据 —— 正式版（一期）由后端落库。</p>
    </aside>
  );
}
