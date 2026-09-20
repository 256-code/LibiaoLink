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

/**
 * 插入位置浮层（Push 113，业务口径「我要点击这个添加后选择位置」）：点某一条「＋ 添加」时贴这条浮出 ——
 * 前两档固定（该阶段最后（默认）/ 该阶段最前），下面按**当前阶段的任务顺序**列出该阶段任务
 * （固定高度、隐式滚动条、可滑动；悬停高亮并浮出「插到它后面」），点一条 = 把这次要加的任务插到它后面。
 */
function PlacementPopover({ anchor, tasks, heading, onPick, onClose }: {
  /** 贴哪一行浮出（点的那一行 / 整套添加按钮）。 */
  anchor: HTMLElement;
  tasks: readonly { id: string; title: string }[];
  /** 浮层标题：这条节点的名字 /「整套添加 N 条」。 */
  heading: string;
  onPick: (next: StagePlacement) => void;
  onClose: () => void;
}) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(320, 340);
  useEffect(() => {
    triggerRef.current = anchor as HTMLButtonElement;
    setOpen(true);
  }, [anchor, setOpen, triggerRef]);
  /**
   * 挂载时 `open` 还是 false（下一行 effect 里才置 true）：**真的开过之后**再变 false 才算「关掉」——
   * 否则挂载那一下就会回调 `onClose`，浮层还没显示就被父级清掉了（Push 113 踩过）。
   */
  const openedRef = useRef(false);
  useEffect(() => {
    if (open) {
      openedRef.current = true;
      return;
    }
    if (openedRef.current) {
      onClose();
    }
  }, [open, onClose]);
  const pick = (next: StagePlacement) => {
    onPick(next);
    setOpen(false);
  };
  const fixed: readonly { kind: StagePlacement["kind"]; label: string }[] = [
    { kind: "last", label: "该阶段最后（默认）" },
    { kind: "before", label: "该阶段最前" },
  ];
  if (!open || position === null) {
    return null;
  }
  return createPortal(
    <div
      ref={popoverRef}
      data-select-popover="true"
      role="dialog"
      aria-label={heading + "：插入位置"}
      style={{ top: position.top, left: position.left, width: position.width }}
      className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
    >
      <div className="border-b border-zinc-100 px-2.5 py-2">
        <p className="truncate text-xs font-medium text-zinc-800" title={heading}>{heading}</p>
        <p className="mt-0.5 text-[10px] text-zinc-400">插到哪一格？</p>
      </div>

      <div className="p-1">
        {fixed.map((item) => (
          <button
            key={item.kind}
            type="button"
            disabled={item.kind === "before" && tasks.length === 0}
            onClick={() => { pick(item.kind === "before" ? { kind: "before", taskId: tasks[0].id } : { kind: "last" }); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
          >
            {item.label}
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <p className="border-t border-zinc-100 px-2.5 py-2 text-[11px] text-zinc-400">该阶段还没有别的任务 —— 只能排在该阶段最后</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2.5 py-1.5">
            <span className="text-[10px] text-zinc-400">该阶段任务顺序</span>
            <span className="text-[10px] text-zinc-400">点一条 = 插到它后面</span>
          </div>
          <ScrollArea ariaLabel="该阶段任务顺序" viewportClassName="h-[176px]" className="px-1 pb-1">
            {tasks.map((task, index) => (
              <button
                key={task.id}
                type="button"
                title="点击插到它后面"
                onClick={() => { pick({ kind: "after", taskId: task.id }); }}
                className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-700 transition hover:bg-zinc-100"
              >
                <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-zinc-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                <span className="shrink-0 text-[10px] text-zinc-400 opacity-0 transition group-hover:opacity-100">插到它后面</span>
              </button>
            ))}
          </ScrollArea>
        </>
      )}
    </div>,
    document.body,
  );
}

type StageAddCardProps = {
  stage: string;
  existingTaskIds: ReadonlySet<string>;
  /** 点一条节点直接加进项目（没有「插入位置」时走这条 —— 项目总览里点阶段标签加节点）。 */
  onAddNode?: (stage: string, node: TemplatePresetNode) => void;
  /** 加一批 + 指定插入位置（看板那条路径）。 */
  onAddNodes?: (stage: string, nodes: readonly TemplatePresetNode[], placement: StagePlacement) => void;
  /**
   * 插入位置（Push 113，业务口径「我要点击这个添加后选择位置」）：给了就「**点 ＋ 添加 → 先弹位置浮层 → 选完才加进项目**」。
   * 浮层里前两档固定（该阶段最后（默认）/ 该阶段最前），下面按当前阶段的任务顺序列一遍（点一条 = 插到它后面）；
   * 不传 = 点一条直接加（项目总览那条路径，默认排该阶段最后）。
   */
  placement?: {
    /** 该阶段现有任务（顺序 = 项目总览里这些任务的先后）；空 = 只有「该阶段最后」可点。 */
    tasks: readonly { id: string; title: string }[];
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
  /** 点了「＋ 添加」/「整套添加」之后、还没选位置的那一次（Push 113）：`nodes` = 这次要加的一条 / 一批，`anchor` = 贴哪一行浮出。 */
  const [armed, setArmed] = useState<{ nodes: readonly TemplatePresetNode[]; anchor: HTMLElement } | null>(null);
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

  /**
   * 点「＋ 添加」/「整套添加」（Push 113）：配了「插入位置」就先弹位置浮层（选完才加进项目），没配就直接加。
   */
  const startAdd = (picked: readonly TemplatePresetNode[], anchor: HTMLElement) => {
    if (picked.length === 0) {
      return;
    }
    if (placement === undefined) {
      for (const node of picked) {
        onAddNode?.(stage, node);
      }
      return;
    }
    setArmed({ nodes: picked, anchor });
  };

  /** 位置选好了（Push 113）：交给上层按这个位置插进项目。 */
  const commitAdd = (picked: readonly TemplatePresetNode[], next: StagePlacement) => {
    if (onAddNodes !== undefined) {
      onAddNodes(stage, picked, next);
      return;
    }
    for (const node of picked) {
      onAddNode?.(stage, node);
    }
  };

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
            onClick={(event) => { startAdd(items.filter((node) => !existingTaskIds.has(node.id)), event.currentTarget); }}
            title="把这块模板里还没加过的节点一次全加到项目"
            className="shrink-0 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/60 disabled:text-zinc-400"
          >
            整套添加（{pendingCount}）
          </button>
        )}
      </div>

      <ul className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {items.map((node, index) => {
          const added = existingTaskIds.has(node.id);
          return (
            <li key={node.id}>
              <button
                type="button"
                disabled={added}
                onClick={(event) => { startAdd([node], event.currentTarget); }}
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

      {armed === null ? null : (
        <PlacementPopover
          anchor={armed.anchor}
          tasks={placement?.tasks ?? []}
          heading={armed.nodes.length === 1 ? armed.nodes[0].title : "整套添加 " + String(armed.nodes.length) + " 条"}
          onPick={(next) => { commitAdd(armed.nodes, next); }}
          onClose={() => { setArmed(null); }}
        />
      )}
      <p className="mt-2 shrink-0 text-[10px] leading-4 text-zinc-400">节点与模板来自「任务模板」的预设；当前原型未接后端，数据存浏览器内存、刷新回到初始数据 —— 正式版（一期）由后端落库。</p>
    </aside>
  );
}
