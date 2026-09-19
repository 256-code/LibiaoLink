import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { AppHeader } from "./components/AppHeader";
import { TaskNodeCard } from "./components/TaskNodeCard";
import { PROJECT_STAGES } from "./data/projects";
import { PROJECT_TASKS } from "./data/tasks";
import { replaceTemplateSection, type PlaceholderPage as PlaceholderPageKey } from "./useHashRoute";
import type { MeResponse } from "./types";

const PAGES: Record<PlaceholderPageKey, { title: string; note: string }> = {
  templates: { title: "任务模板", note: "任务模板库还没开工：左侧按上方标签栏列出该板块的任务节点（一期取「项目总览」数据，中英对照），板块内的模板编排与接口需求后续填充。" },
  files: { title: "文件库", note: "文件库还没开工：先把入口与路由占好，后续按需求填充。" },
};

/** 任务模板的阶段板块：与项目详情同口径（「项目总览」是汇总视图，不作为板块）。 */
const TEMPLATE_SECTIONS: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/**
 * 任务节点（一期）：直接取「项目总览」的任务数据，按板块分组，一个任务节点一张卡片。
 * 后续接入模板自己的节点数据时，只换这个常量的来源即可。
 */
const TEMPLATE_NODES = TEMPLATE_SECTIONS.map((stage) => ({
  stage,
  items: PROJECT_TASKS.filter((task) => task.stage === stage).map((task) => ({
    id: task.id,
    title: task.title,
    titleEn: task.titleEn,
  })),
}));

type TemplateNode = (typeof TEMPLATE_NODES)[number]["items"][number];

/** 右侧一块模板面板 = 一份模板草稿（一期都在内存里：可新建、可改名，未接保存）。 */
type TemplateDraft = {
  id: string;
  /** 模板名（本地草稿字段，可直接改） */
  name: string;
  /** 这份模板里已选的节点，顺序即模板里的顺序 */
  nodes: TemplateNode[];
  /** 上次「保存」时的样子（一期只存在浏览器内存里；用来判断有没有未保存的改动） */
  saved: string;
};

/** 模板的「样子」快照：名字 + 节点顺序，序列化后直接比字符串。 */
const snapshotOf = (template: Pick<TemplateDraft, "name" | "nodes">): string =>
  JSON.stringify({ name: template.name, nodes: template.nodes.map((node) => node.id) });

/** 空阶段兜底用的空数组（避免每次渲染都新建一个）。 */
const EMPTY_TEMPLATE_LIST: TemplateDraft[] = [];

/**
 * 每个阶段的初始模板面板：**模板按阶段分开存**，一期各阶段都从「一张空白草稿」开始，
 * 名字带阶段名（售前规划模板 / 设计开发模板 …）以区分不同阶段各自的模板。
 */
function initialTemplatesByStage(): Record<string, TemplateDraft[]> {
  const map: Record<string, TemplateDraft[]> = {};
  TEMPLATE_SECTIONS.forEach((stage, index) => {
    const name = stage + "模板";
    map[stage] = [{ id: "tpl-" + String(index + 1), name, nodes: [], saved: snapshotOf({ name, nodes: [] }) }];
  });
  return map;
}

/** 拖拽只传 id，落点时按 id 找回节点内容（相当于复制一份到右侧模板）。 */
const TEMPLATE_NODE_BY_ID = new Map<string, TemplateNode>(
  TEMPLATE_NODES.flatMap((section) => section.items.map((item) => [item.id, item] as const)),
);

type PlaceholderPageProps = {
  me: MeResponse;
  page: PlaceholderPageKey;
  /** 任务模板页当前板块（来自 URL 的 `?section=`；缺省 / 不认识的值回落到第一个板块） */
  section: string | null;
};

/** 占位卡：页面主体内容未定稿前统一用它撑住版面。 */
function PlaceholderCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-20 text-center">
      <p className="text-base font-semibold text-zinc-800">{title}</p>
      <p className="mt-2 text-sm text-zinc-500">{note}</p>
      <a href="#/" className="mt-6 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4">
        返回入口页
      </a>
    </div>
  );
}

/** 占位页：入口页的按钮先各自落地，页面内容后续迭代；任务模板先出阶段板块标签栏 + 左侧任务节点卡片区。 */
/**
 * 右侧调顺序时的插入位置指示线：绝对定位、且不接收鼠标事件。
 * 一旦让它占位，线一出现就把后面的卡片顶开，鼠标底下的元素跟着换、落点又变，拖动时就会来回频闪。
 */
function InsertLine({ className }: { className: string }) {
  return (
    <div
      className={
        "pointer-events-none absolute left-0 right-0 h-[3px] rounded-full bg-[#feca04] shadow-[0_0_0_3px_rgba(254,202,4,0.18)] " +
        className
      }
    />
  );
}

export default function PlaceholderPage({ me, page, section }: PlaceholderPageProps) {
  const { title, note } = PAGES[page];
  /** 当前板块：URL 是唯一来源（点标签栏 = 换地址），缺省 / 不认识的值回落到第一个板块。 */
  const activeSection =
    section !== null && TEMPLATE_SECTIONS.includes(section) ? section : (TEMPLATE_SECTIONS[0] ?? "");

  // 地址里带的是不认识的板块（手改 / 旧链接）：落回第一个板块，并把地址一并纠正，避免「地址与显示不一致」
  useEffect(() => {
    if (page === "templates" && section !== null && !TEMPLATE_SECTIONS.includes(section)) {
      replaceTemplateSection(activeSection);
    }
  }, [page, section, activeSection]);
  /** 右侧的模板面板：**按阶段分开存**，每个阶段一套、互不影响（一期都是内存草稿）。 */
  const [templatesByStage, setTemplatesByStage] =
    useState<Record<string, TemplateDraft[]>>(initialTemplatesByStage);
  const nextTemplateSeq = useRef(TEMPLATE_SECTIONS.length + 1);
  /** 当前阶段的模板面板。 */
  const templates = templatesByStage[activeSection] ?? EMPTY_TEMPLATE_LIST;
  /** 当前悬停的模板面板 id（高亮 / 重复提示都按面板算）。 */
  const [dragOverTemplateId, setDragOverTemplateId] = useState<string | null>(null);
  /** 正在拖的节点 id（拖拽中读不到 dataTransfer，用它判断「这块面板里是不是已经有了」）。 */
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  /** 拖拽来源：左侧任务节点 = 复制一份；右侧已选卡片 = 调顺序。 */
  const [dragSource, setDragSource] = useState<"left" | "right" | null>(null);
  /** 右侧拖拽来自哪块模板面板（调顺序只在同一块面板内生效）。 */
  const [dragFromTemplateId, setDragFromTemplateId] = useState<string | null>(null);
  /** 落点：哪块面板 + 插到第几张卡片前面（0..N）。 */
  const [dropTarget, setDropTarget] = useState<{ templateId: string; index: number } | null>(null);
  const activeNodes = TEMPLATE_NODES.find((section) => section.stage === activeSection)?.items ?? [];

  /** 这块面板里是不是已经有正在拖的那个节点（只有从左侧拖过来才可能重复）。 */
  const isDuplicateIn = (template: TemplateDraft): boolean =>
    dragSource === "left" && draggingNodeId !== null && template.nodes.some((node) => node.id === draggingNodeId);

  /** 只改「当前阶段」的模板面板，其它阶段原样不动。 */
  const updateTemplates = (updater: (list: TemplateDraft[]) => TemplateDraft[]): void => {
    setTemplatesByStage((previous) => ({
      ...previous,
      [activeSection]: updater(previous[activeSection] ?? EMPTY_TEMPLATE_LIST),
    }));
  };

  const resetDrag = (): void => {
    setDraggingNodeId(null);
    setDragSource(null);
    setDragFromTemplateId(null);
    setDragOverTemplateId(null);
    setDropTarget(null);
  };

  /** 新建模板：在「任务节点」右侧插一块空白面板、原来的模板往右挪，并把焦点落到新面板的名字上。 */
  const startNewTemplate = (): void => {
    const id = "tpl-" + String(nextTemplateSeq.current);
    nextTemplateSeq.current += 1;
    updateTemplates((previous) => [{ id, name: "未命名模板", nodes: [], saved: "" }, ...previous]);
    // 等这次 state 更新渲染完，再把焦点 / 全选落到新面板的名称输入框上
    setTimeout(() => {
      const input = document.getElementById("template-name-" + id);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    }, 0);
  };

  const renameTemplate = (templateId: string, name: string): void => {
    updateTemplates((previous) => previous.map((item) => (item.id === templateId ? { ...item, name } : item)));
  };

  /** 保存这份模板：一期没有后端，就把当前样子记进内存（之后再改动会重新变回「保存」）。 */
  const saveTemplate = (templateId: string): void => {
    updateTemplates((previous) =>
      previous.map((item) => (item.id === templateId ? { ...item, saved: snapshotOf(item) } : item)),
    );
  };

  /** 删除这份模板面板（本地草稿）。 */
  const removeTemplate = (templateId: string): void => {
    resetDrag();
    updateTemplates((previous) => previous.filter((item) => item.id !== templateId));
  };

  /**
   * 模板面板里的落点：按卡片的实际位置算 —— 落在某张卡片上半就打在它前面，
   * 落在下半（以及卡片之间、所有卡片之下）就落到它后面。
   * 用几何位置判定而不是看事件目标是谁：指示线 / 间隙出现在鼠标底下时结果不变，
   * 配合不占位的指示线，拖动过程中布局不会来回抖。
   */
  const handleListDragOver = (templateId: string, event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const cards = Array.from(event.currentTarget.querySelectorAll("article"));
    let insertAt = cards.length;
    for (const [index, card] of cards.entries()) {
      const rect = card.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        insertAt = index;
        break;
      }
    }
    setDropTarget({ templateId, index: insertAt });
  };

  const handleDrop = (templateId: string, event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    const insertAt = dropTarget !== null && dropTarget.templateId === templateId ? dropTarget.index : null;
    const fromRight = dragSource === "right";
    const fromTemplateId = dragFromTemplateId;
    resetDrag();

    if (fromRight) {
      // 面板内调顺序：把这张卡片挪到落点位置（原位置后面的下标要减 1）；拖到别的模板面板上不处理。
      if (fromTemplateId !== templateId) {
        return;
      }
      updateTemplates((previous) =>
        previous.map((template) => {
          if (template.id !== templateId) {
            return template;
          }
          const from = template.nodes.findIndex((node) => node.id === id);
          const moved = from === -1 ? undefined : template.nodes[from];
          if (moved === undefined) {
            return template;
          }
          const next = template.nodes.slice();
          next.splice(from, 1);
          let target = insertAt ?? next.length;
          if (from < target) {
            target -= 1;
          }
          next.splice(Math.max(0, Math.min(target, next.length)), 0, moved);
          return { ...template, nodes: next };
        }),
      );
      return;
    }

    const node = TEMPLATE_NODE_BY_ID.get(id);
    if (node === undefined) {
      return;
    }
    // 左侧拖过来 = 复制一份；去重：同一个任务节点在同一块面板里只保留一份，重复拖入不生效。
    updateTemplates((previous) =>
      previous.map((template) => {
        if (template.id !== templateId || template.nodes.some((item) => item.id === node.id)) {
          return template;
        }
        const next = template.nodes.slice();
        next.splice(Math.max(0, Math.min(insertAt ?? next.length, next.length)), 0, node);
        return { ...template, nodes: next };
      }),
    );
  };

  if (page === "templates") {
    return (
      <div className="min-h-screen">
        <AppHeader me={me} title={title} />
        <main className="w-full px-6 pb-10 pt-3">
          <div className="flex items-center gap-3 border-b border-zinc-200">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {TEMPLATE_SECTIONS.map((stage) => {
                const active = stage === activeSection;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => replaceTemplateSection(stage)}
                    title={"#/templates?section=" + stage}
                    aria-current={active ? "page" : undefined}
                    className={
                      "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition " +
                      (active
                        ? "border-zinc-900 text-zinc-900"
                        : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                    }
                  >
                    {stage}
                  </button>
                );
              })}
            </div>
            {/* 新建模板的入口在板块标签栏这一行：点一下在「任务节点」右侧生成一块空白模板面板，原来的模板往右挪 */}
            <button
              type="button"
              onClick={startNewTemplate}
              title="新建模板：在「任务节点」右侧加一块空白模板面板"
              className="shrink-0 rounded-lg border border-white/80 bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-[0_2px_10px_rgba(15,23,42,0.08)] transition hover:bg-white hover:text-zinc-900"
            >
              ＋ 新建模板
            </button>
          </div>

          <div className="relative mt-6">
            {/* 毛玻璃底衬：玻璃要有可透的背景才看得出效果，这里垫一层很淡的色雾（纯装饰、不接收鼠标事件）。 */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-x-clip">
              <div className="sticky top-0 h-[70vh]">
                <div className="absolute left-[2%] top-[4%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(254,202,4,0.75),rgba(254,202,4,0)_70%)] blur-3xl" />
                <div className="absolute left-[16%] top-[46%] h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(244,114,182,0.45),rgba(244,114,182,0)_70%)] blur-3xl" />
                <div className="absolute left-[30%] top-[20%] h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(48,207,208,0.60),rgba(48,207,208,0)_70%)] blur-3xl" />
                <div className="absolute right-[2%] top-[38%] h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.50),rgba(99,102,241,0)_70%)] blur-3xl" />
              </div>
            </div>

            {/* 左列「任务节点」固定不动（宽屏滚动时钉住），右侧模板面板一行放不下就换到下一行 */}
            <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-start">
              <section className="flex w-full flex-col rounded-2xl border border-white/80 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.62),rgba(255,255,255,0.32))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_8px_32px_rgba(15,23,42,0.14)] backdrop-blur-2xl backdrop-saturate-150 lg:sticky lg:top-[81px] lg:w-[370px] lg:shrink-0 lg:self-start">
                <p className="mb-3 flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-zinc-800">任务节点</span>
                  <span className="text-xs text-zinc-500">
                    {activeSection} · {activeNodes.length} 个节点
                  </span>
                </p>
                <div className="space-y-3">
                  {activeNodes.map((item) => (
                    <TaskNodeCard
                      key={item.id}
                      title={item.title}
                      subtitle={item.titleEn}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", item.id);
                        event.dataTransfer.effectAllowed = "copy";
                        setDragSource("left");
                        setDraggingNodeId(item.id);
                        setDropTarget(null);
                      }}
                      onDragEnd={resetDrag}
                    />
                  ))}
                </div>
              </section>

              {/* 同一行的面板拉成等高，换行后各自成行 */}
              <div className="flex w-full min-w-0 flex-1 flex-wrap gap-8">
                {templates.map((template) => {
                  const hovered = dragOverTemplateId === template.id;
                  const duplicate = hovered && isDuplicateIn(template);
                  const nodeCount = template.nodes.length;
                  const savedOk = template.saved === snapshotOf(template);
                  return (
                    <section
                      key={template.id}
                      aria-label={"模板 " + template.name}
                      className={
                        "flex w-full flex-col rounded-2xl border bg-[linear-gradient(to_bottom,rgba(255,255,255,0.62),rgba(255,255,255,0.32))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_8px_32px_rgba(15,23,42,0.14)] backdrop-blur-2xl backdrop-saturate-150 transition lg:w-[370px] lg:shrink-0 " +
                        (hovered
                          ? duplicate
                            ? "border-amber-400/70 ring-2 ring-amber-300/40"
                            : "border-zinc-900/30 ring-2 ring-zinc-900/10"
                          : "border-white/80")
                      }
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = duplicate ? "none" : dragSource === "right" ? "move" : "copy";
                        setDragOverTemplateId(template.id);
                      }}
                      onDragLeave={(event) => {
                        // 在面板内部子元素之间移动也会触发 dragleave，这里只在真正离开面板时复位。
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          return;
                        }
                        setDragOverTemplateId((previous) => (previous === template.id ? null : previous));
                        setDropTarget((previous) => (previous?.templateId === template.id ? null : previous));
                      }}
                      onDrop={(event) => handleDrop(template.id, event)}
                    >
                      <div className="mb-3">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <input
                            id={"template-name-" + template.id}
                            type="text"
                            value={template.name}
                            onChange={(event) => renameTemplate(template.id, event.target.value)}
                            aria-label="模板名称"
                            placeholder="模板名称"
                            className="-mx-1 min-w-0 flex-1 truncate rounded px-1 font-semibold text-zinc-800 outline-none transition hover:bg-white/40 focus:bg-white/70"
                          />
                          <span aria-label="已选节点数" className="shrink-0 text-xs text-zinc-500">
                            {nodeCount} 个
                          </span>
                          <button
                            type="button"
                            onClick={() => saveTemplate(template.id)}
                            title="保存这份模板：一期只存在浏览器内存里（未接后端），保存后再改动会重新变回「保存」"
                            className={
                              "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium transition " +
                              (savedOk
                                ? "border border-white/70 bg-white/50 text-zinc-400 hover:bg-white"
                                : "bg-zinc-900 text-white hover:bg-zinc-800")
                            }
                          >
                            {savedOk ? "已保存" : "保存"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTemplate(template.id)}
                            title="删除这份模板面板（本地草稿，删掉不回来）"
                            className="shrink-0 rounded-md border border-white/70 bg-white/50 px-2 py-0.5 text-xs font-medium text-zinc-600 transition hover:bg-white hover:text-red-600"
                          >
                            删除
                          </button>
                        </div>
                        {/* 提示行固定高度：出现 / 消失都不顶动下方列表（否则拖拽时会跟着抖） */}
                        <p className={"h-4 text-xs font-medium text-amber-600 " + (duplicate ? "visible" : "invisible")}>
                          该节点已在右侧，不会重复添加
                        </p>
                      </div>
                      <div
                        className={
                          "flex flex-1 flex-col rounded-xl border transition " +
                          (hovered
                            ? duplicate
                              ? "border-amber-300/70 bg-white/45"
                              : "border-zinc-400 bg-white/70"
                            : "border-white/60 bg-white/25")
                        }
                      >
                        {nodeCount === 0 ? (
                          <p className="flex min-h-[160px] flex-1 items-center justify-center px-4 text-center text-xs text-zinc-400">
                            把左侧「任务节点」拖到这里
                          </p>
                        ) : (
                          <div className="space-y-3 p-3" onDragOver={(event) => handleListDragOver(template.id, event)}>
                            {template.nodes.map((item, index) => (
                              <div key={item.id} className="relative">
                                {dropTarget?.templateId === template.id && dropTarget.index === index ? (
                                  <InsertLine className="-top-[7px]" />
                                ) : null}
                                {index === nodeCount - 1 &&
                                dropTarget?.templateId === template.id &&
                                dropTarget.index === nodeCount ? (
                                  <InsertLine className="-bottom-[7px]" />
                                ) : null}
                                <TaskNodeCard
                                  title={item.title}
                                  subtitle={item.titleEn}
                                  draggable
                                  highlighted={duplicate && item.id === draggingNodeId}
                                  dimmed={dragSource === "right" && item.id === draggingNodeId}
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData("text/plain", item.id);
                                    event.dataTransfer.effectAllowed = "move";
                                    setDragSource("right");
                                    setDragFromTemplateId(template.id);
                                    setDraggingNodeId(item.id);
                                  }}
                                  onDragEnd={resetDrag}
                                  onRemove={() =>
                                    updateTemplates((previous) =>
                                      previous.map((entry) =>
                                        entry.id === template.id
                                          ? { ...entry, nodes: entry.nodes.filter((node) => node.id !== item.id) }
                                          : entry,
                                      ),
                                    )
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              {templates.length === 0 ? (
                <p className="flex min-h-[160px] w-full items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white/40 px-6 text-center text-xs text-zinc-500">
                  还没有模板面板：点右上角「＋ 新建模板」建一份
                </p>
              ) : null}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }  return (
    <div className="min-h-screen">
      <AppHeader me={me} title={title} />
      <main className="w-full px-6 py-10">
        <div className="mx-auto max-w-2xl">
          <PlaceholderCard title={title} note={note} />
        </div>
      </main>
    </div>
  );
}
