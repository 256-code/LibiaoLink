import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AppHeader } from "./components/AppHeader";
import { RowDeleteButton } from "./components/RowDeleteButton";
import { TaskNodeCard } from "./components/TaskNodeCard";
import { PROJECT_STAGES } from "./data/projects";
import { STAGE_TEMPLATE_PRESETS, type TemplatePresetNode } from "./data/templatePresets";
import { ApiError } from "./api";
import { createStageNode, deleteTaskNode, fetchStageNodes, nodeWriteMessage, updateStageNode, type TaskNodeItem } from "./templateApi";
import { replaceTemplateSection, templateSectionFromParam, templateSectionHref, templateSectionSlug, type PlaceholderPage as PlaceholderPageKey } from "./useHashRoute";
import type { MeResponse } from "./types";

const PAGES: Record<PlaceholderPageKey, { title: string; note: string }> = {
  templates: { title: "任务模板", note: "左侧「任务节点」已接节点库接口（Push 181：`GET /api/v1/task-nodes`，可新增 / 编辑 / 删除，写 = 系统管理员；编辑 = 点卡片上的铅笔图标）；右侧模板面板仍是业务写死的预设（`data/templatePresets.ts`，模板接口随第二段落库）。把左侧节点拖进模板 = 定这份模板的节点顺序。" },
  files: { title: "文件库", note: "文件库还没开工：先把入口与路由占好，后续按需求填充。" },
};

/** 任务模板的阶段板块：与项目详情同口径（「项目总览」是汇总视图，不作为板块）。 */
const TEMPLATE_SECTIONS: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/** 左列节点池的兜底空数组（取不到该板块那份时用，避免每次渲染都新建一个）。 */
const EMPTY_NODE_LIST: readonly TaskNodeItem[] = [];

type TemplateNode = TemplatePresetNode;

/** 右侧一块模板面板 = 一份模板草稿（当前原型都在内存里：可新建、可改名，未接保存；正式版落库）。 */
type TemplateDraft = {
  id: string;
  /** 模板名（本地草稿字段，可直接改） */
  name: string;
  /** 这份模板里已选的节点，顺序即模板里的顺序 */
  nodes: TemplateNode[];
  /** 上次「保存」时的样子（当前原型存浏览器内存、未接后端；正式版由后端持久化；用来判断有没有未保存的改动） */
  saved: string;
};

/** 模板的「样子」快照：名字 + 节点顺序，序列化后直接比字符串。 */
const snapshotOf = (template: Pick<TemplateDraft, "name" | "nodes">): string =>
  JSON.stringify({ name: template.name, nodes: template.nodes.map((node) => node.id) });

/** 空阶段兜底用的空数组（避免每次渲染都新建一个）。 */
const EMPTY_TEMPLATE_LIST: TemplateDraft[] = [];

/**
 * 每个阶段的初始模板面板：**业务写死的模板预设**（名称 + 节点顺序）——
 * 硬件实施两套（机器人 / 导轨型 18 条、格口 / 滑槽型 11 条），软件部署一套，其余阶段各一套；
 * 面板初始就是「已保存」，之后改名 / 拖拽 / 增删才会变回「保存」。
 */
function initialTemplatesByStage(): Record<string, TemplateDraft[]> {
  const map: Record<string, TemplateDraft[]> = {};
  let seq = 1;
  for (const stage of TEMPLATE_SECTIONS) {
    map[stage] = (STAGE_TEMPLATE_PRESETS[stage] ?? []).map((preset) => {
      const id = "tpl-" + String(seq);
      seq += 1;
      const nodes = preset.nodes.slice();
      return { id, name: preset.name, nodes, saved: snapshotOf({ name: preset.name, nodes }) };
    });
  }
  return map;
}

/** 预设面板总数：「＋ 新建模板」的序号从这里往后排，避免 id 撞车。 */
const INITIAL_TEMPLATE_COUNT = TEMPLATE_SECTIONS.reduce(
  (total, stage) => total + (STAGE_TEMPLATE_PRESETS[stage]?.length ?? 0),
  0,
);

/** 按住卡片后位移超过这个数才算「拖动」（没过阈值就是点一下，什么都不改）。 */
const DRAG_THRESHOLD = 4;

/** 正在拖的节点（Push 116）：左侧节点池拖过来 = 复制一份；模板面板里的卡片 = 在同面板内调顺序。 */
type DragInfo = { nodeId: string; source: "left" | "right"; fromTemplateId: string | null; width: number };

/** 按下卡片、还没过拖动阈值时的暂存（Push 116）。 */
type PendingDrag = {
  info: Omit<DragInfo, "width">;
  pointerId: number;
  /** 按下时的坐标：用来判「过没过阈值」。 */
  x: number;
  y: number;
  /** 卡片 DOM：真拖起来之后把指针捕获在它身上（鼠标滑出窗口再放开也收得到 pointerup）。 */
  node: HTMLElement;
  dragging: boolean;
};

/** 落点（Push 116）：`templateId` = 哪块模板面板、`index` = 插到面板里第几张卡片前面（0 = 最前、卡片数 = 末尾）。 */
type DropSpot = { templateId: string; index: number };

type PlaceholderPageProps = {
  me: MeResponse;
  page: PlaceholderPageKey;
  /** 任务模板页当前板块（来自 URL 的 `?section=`；缺省 / 不认识的值回落到第一个板块） */
  section: string | null;
  /**
   * 是否持有 blueprint.manage（节点库维护 = 系统管理员，ADR-019 / ADR-020）：
   * 决定「＋ 添加节点」与节点卡片上的删除按钮渲不渲染；服务端逐请求仍是最终裁决（无权 = 403）。
   */
  canManageNodes: boolean;
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
 * 拖动（Push 116，业务口径「这里拖动卡片也要可以滑动鼠标」）：改成**指针拖动** —— 原生 HTML5 拖拽在拖动期间会把 `wheel` 吞掉,
 * 「拖着的同时用滚轮翻列表」就不成立。现在的口径：按住卡片、位移超过 `DRAG_THRESHOLD` 才算拖动，拖起来之后**滚轮直接可用**（指针在页面上 = 滚页面），
 * 拖动中另有一块跟着鼠标走的**半透明拖动卡片**（`data-drag-ghost`，`pointer-events-none`，不挡 `elementFromPoint` 的落点判定），
 * 插入线（`InsertLine`）按「落在哪块面板的第几格」实时跟着走；没过阈值 = 点一下，什么都不改；Esc / 指针取消 = 原地取消。
 * 左侧节点池拖过来 = 复制一份（同面板按节点 id 去重），模板面板里的卡片 = 在同面板内调顺序。
 */

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

export default function PlaceholderPage({ me, page, section, canManageNodes }: PlaceholderPageProps) {
  const { title, note } = PAGES[page];
  /** 当前板块：URL 是唯一来源（点标签栏 = 换地址；`?section=` 取 ASCII slug，兼容旧链接的中文板块名），缺省 / 不认识的值回落到第一个板块。 */
  const activeSection = templateSectionFromParam(section) ?? TEMPLATE_SECTIONS[0] ?? "";

  // 地址里的板块参数不是规范 slug（旧中文值 / 不认识的取值 / 手改）：落回对应板块，并把地址一并纠正成规范 slug，避免「地址与显示不一致」
  useEffect(() => {
    if (page === "templates" && section !== null && section.trim() !== templateSectionSlug(activeSection)) {
      replaceTemplateSection(activeSection);
    }
  }, [page, section, activeSection]);
  /** 右侧的模板面板：**按阶段分开存**，每个阶段一套、互不影响（当前原型都是内存草稿、未接后端）。 */
  const [templatesByStage, setTemplatesByStage] =
    useState<Record<string, TemplateDraft[]>>(initialTemplatesByStage);
  const nextTemplateSeq = useRef(INITIAL_TEMPLATE_COUNT + 1);
  /** 当前阶段的模板面板。 */
  const templates = templatesByStage[activeSection] ?? EMPTY_TEMPLATE_LIST;
  /**
   * 正在拖的节点（Push 116）：`source` 区分「左侧节点池 → 复制一份」与「模板面板里 → 同面板调顺序」，
   * `fromTemplateId` 是后者的来源面板、`width` 给跟着鼠标走的那块拖动卡片对齐宽度。
   */
  const [drag, setDrag] = useState<DragInfo | null>(null);
  /** 落点：哪块面板 + 插到第几张卡片前面（0..N）；null = 鼠标不在任何面板上。 */
  const [dropTarget, setDropTarget] = useState<DropSpot | null>(null);
  /** 按下卡片、还没过拖动阈值时的暂存（Push 116）。 */
  const pendingRef = useRef<PendingDrag | null>(null);
  /** 拖动中鼠标的最后位置：鼠标可以不动、只用滚轮，落点得按这个位置重算。 */
  const pointerRef = useRef({ x: 0, y: 0 });
  /** 抓取偏移（按下时鼠标在卡片内的位置 + 卡片宽度）：拖动卡片按这个对齐鼠标。 */
  const grabRef = useRef({ dx: 0, dy: 0, width: 0 });
  /** 跟着鼠标走的拖动卡片（Push 116）：直接用 DOM 改 `transform`，不走 state（每帧都要动）。 */
  const ghostRef = useRef<HTMLDivElement | null>(null);
  /** 最新的落点计算 / 落地实现（每帧回调里读，免得闭包吃到旧值）。 */
  const dropTargetAtRef = useRef<(x: number, y: number) => DropSpot | null>(() => null);
  const commitDropRef = useRef<(info: DragInfo, spot: DropSpot | null) => void>(() => undefined);
  /**
   * 左列「任务节点」= 节点库接口（Push 181：`GET /api/v1/task-nodes?stage=`）。
   * 按板块缓存：切走再切回来不必重取，只有写入（新增 / 删除）后才按版本号重取。
   */
  const [nodesByStage, setNodesByStage] = useState<Record<string, readonly TaskNodeItem[]>>({});
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  /** 取数版本号：新增 / 删除成功后 +1 重取，保证左列与节点库一致。 */
  const [nodesVersion, setNodesVersion] = useState(0);
  const activeNodes = nodesByStage[activeSection] ?? EMPTY_NODE_LIST;
  /** 左列「任务节点」的搜索词：按中 / 英文名过滤当前板块的节点卡片。 */
  const [nodeQuery, setNodeQuery] = useState("");

  // 切板块时清空搜索词：否则上一个板块的关键词会把新板块的节点全滤掉，看起来像没数据
  useEffect(() => {
    setNodeQuery("");
  }, [activeSection]);

  // 节点库取数（换板块 / 写入后重取）：失败在左列里提示 + 可重试，不静默吞
  useEffect(() => {
    if (page !== "templates") {
      return;
    }
    let alive = true;
    setNodesLoading(true);
    setNodesError(null);
    void (async () => {
      try {
        const items = await fetchStageNodes(activeSection);
        if (alive) {
          setNodesByStage((previous) => ({ ...previous, [activeSection]: items }));
        }
      } catch (error) {
        if (alive) {
          setNodesError(error instanceof Error ? error.message : "节点库加载失败");
        }
      } finally {
        if (alive) {
          setNodesLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, activeSection, nodesVersion]);

  const normalizedQuery = nodeQuery.trim().toLowerCase();
  const visibleNodes =
    normalizedQuery === ""
      ? activeNodes
      : activeNodes.filter((node) =>
          (node.title + "\n" + node.titleEn).toLowerCase().includes(normalizedQuery),
        );

  /**
   * 拖拽只传 id，落点时按 id 找回节点内容（相当于复制一份到右侧模板）：
   * 左侧卡片来自节点库（当前板块那一份），右侧卡片来自各模板面板 —— 两处都查一遍。
   */
  const nodeById = (id: string): TemplateNode | null => {
    const fromLibrary = activeNodes.find((node) => node.id === id);
    if (fromLibrary !== undefined) {
      return fromLibrary;
    }
    for (const list of Object.values(templatesByStage)) {
      for (const template of list) {
        const found = template.nodes.find((node) => node.id === id);
        if (found !== undefined) {
          return found;
        }
      }
    }
    return null;
  };

  /** 拖动中的那个节点（Push 116）：用来画跟着鼠标走的拖动卡片。 */
  const dragNode = drag === null ? null : nodeById(drag.nodeId);

  /** 这块面板里是不是已经有正在拖的那个节点（只有从左侧拖过来才可能重复）。 */
  const isDuplicateIn = (template: TemplateDraft): boolean =>
    drag !== null && drag.source === "left" && template.nodes.some((node) => node.id === drag.nodeId);

  /** 只改「当前阶段」的模板面板，其它阶段原样不动。 */
  const updateTemplates = (updater: (list: TemplateDraft[]) => TemplateDraft[]): void => {
    setTemplatesByStage((previous) => ({
      ...previous,
      [activeSection]: updater(previous[activeSection] ?? EMPTY_TEMPLATE_LIST),
    }));
  };

  /** 清掉拖动状态（删面板 / 拖动取消时用）。 */
  const resetDrag = (): void => {
    pendingRef.current = null;
    document.body.style.userSelect = "";
    setDrag(null);
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

  /** 保存这份模板：当前原型没有后端，就把当前样子记进内存（正式版落库；之后再改动会重新变回「保存」）。 */
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
   * 节点表单状态（面板内联，不弹窗）：新增与编辑**共用一套表单**（Push 181 后半 —— 业务口径「任务节点编辑也要」）。
   * `mode === "edit"` 时带着被编辑的那一行（含乐观锁 version），保存走 PATCH；`"create"` 走 POST。
   */
  const [nodeForm, setNodeForm] = useState<{ mode: "create" } | { mode: "edit"; node: TaskNodeItem } | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formTitleEn, setFormTitleEn] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  /** 待确认删除的节点（同款红胶囊的第一下：第二下在底部确认条上）+ 写入失败的提示文案。 */
  const [pendingDeleteNode, setPendingDeleteNode] = useState<TaskNodeItem | null>(null);
  const [nodeNotice, setNodeNotice] = useState<string | null>(null);

  /** 写节点库失败的统一文案（ApiError 带业务码；其它异常给兜底话术，不把原始堆栈抛给用户）。 */
  const nodeErrorMessage = (error: unknown, fallback: string): string =>
    error instanceof ApiError ? nodeWriteMessage(error) : fallback;

  /** 打开「新增节点」表单（清空旧输入；已开着就收起）。 */
  const openCreateForm = (): void => {
    setFormError(null);
    if (nodeForm?.mode === "create") {
      setNodeForm(null);
      return;
    }
    setFormTitle("");
    setFormTitleEn("");
    setNodeForm({ mode: "create" });
  };

  /** 打开「编辑节点」表单（预填当前中 / 英文名；再点一次同一个节点 = 收起）。 */
  const openEditForm = (node: TaskNodeItem): void => {
    resetDrag();
    setFormError(null);
    if (nodeForm?.mode === "edit" && nodeForm.node.id === node.id) {
      setNodeForm(null);
      return;
    }
    setFormTitle(node.title);
    setFormTitleEn(node.titleEn);
    setNodeForm({ mode: "edit", node });
  };

  /** 收起表单（取消按钮 / 保存成功后）。 */
  const closeNodeForm = (): void => {
    setNodeForm(null);
    setFormError(null);
  };

  /**
   * 提交节点表单：新增 = POST；编辑 = PATCH（乐观锁 version 原样回传，过期由服务端 409 裁决）。
   * 成功 = 收起表单 + 重取当前板块（卡片上的名字随即更新）；失败 = 表单内就地提示。
   */
  const submitNodeForm = (): void => {
    const form = nodeForm;
    const title = formTitle.trim();
    if (form === null || title === "" || formBusy) {
      return;
    }
    setFormBusy(true);
    setFormError(null);
    void (async () => {
      try {
        if (form.mode === "create") {
          await createStageNode(activeSection, title, formTitleEn.trim());
        } else {
          await updateStageNode(form.node.id, { title, titleEn: formTitleEn.trim(), version: form.node.version });
        }
        setNodeForm(null);
        setFormTitle("");
        setFormTitleEn("");
        setNodesVersion((version) => version + 1);
      } catch (error) {
        setFormError(nodeErrorMessage(error, form.mode === "create" ? "新增失败，请稍后重试" : "保存失败，请稍后重试"));
      } finally {
        setFormBusy(false);
      }
    })();
  };

  /** 删除节点（DELETE /api/v1/task-nodes/{id}）：成功 = 重取该板块（卡片消失就是反馈）；失败出提示条。 */
  const confirmDeleteNode = (): void => {
    const node = pendingDeleteNode;
    if (node === null) {
      return;
    }
    setPendingDeleteNode(null);
    void (async () => {
      try {
        await deleteTaskNode(node.id);
        setNodesVersion((version) => version + 1);
      } catch (error) {
        setNodeNotice("删除「" + node.title + "」失败：" + nodeErrorMessage(error, "请稍后重试"));
      }
    })();
  };

  /**
   * 鼠标底下是「哪块面板的第几格」（Push 116）：`data-template-panel` 认面板、卡片中线认格 ——
   * 落在某张卡片中线以上 = 插到它前面，都在上面 = 插到面板末尾；空面板 = 第 0 格。
   * 用 `elementFromPoint` 而不是看事件目标是谁：拖动卡片与插入线都不接收鼠标事件，结果不受它们影响。
   */
  const dropTargetAt = (x: number, y: number): DropSpot | null => {
    const under = document.elementFromPoint(x, y);
    const panel = under === null ? null : under.closest("[data-template-panel]");
    if (panel === null) {
      return null;
    }
    const templateId = panel.getAttribute("data-template-panel") ?? "";
    if (!templates.some((template) => template.id === templateId)) {
      return null;
    }
    const cards = Array.from(panel.querySelectorAll("article"));
    for (let index = 0; index < cards.length; index++) {
      const rect = cards[index].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return { templateId, index };
      }
    }
    return { templateId, index: cards.length };
  };

  /**
   * 放开落点（Push 116）：左侧拖过来 = **复制一份**进面板（同一块面板里按节点 id 去重，重复拖入不生效）；
   * 面板里的卡片 = **在同面板内调顺序**（原位置后面的下标要减 1）；拖到别的面板上不处理（与原生拖拽那版口径一致）。
   */
  const commitDrop = (info: DragInfo, spot: DropSpot | null): void => {
    if (spot === null) {
      return;
    }
    const insertAt = spot.index;
    if (info.source === "right") {
      if (info.fromTemplateId !== spot.templateId) {
        return;
      }
      updateTemplates((previous) =>
        previous.map((template) => {
          if (template.id !== spot.templateId) {
            return template;
          }
          const from = template.nodes.findIndex((node) => node.id === info.nodeId);
          const moved = from === -1 ? undefined : template.nodes[from];
          if (moved === undefined) {
            return template;
          }
          const next = template.nodes.slice();
          next.splice(from, 1);
          let target = insertAt;
          if (from < target) {
            target -= 1;
          }
          next.splice(Math.max(0, Math.min(target, next.length)), 0, moved);
          return { ...template, nodes: next };
        }),
      );
      return;
    }
    const node = nodeById(info.nodeId);
    if (node === null) {
      return;
    }
    updateTemplates((previous) =>
      previous.map((template) => {
        if (template.id !== spot.templateId || template.nodes.some((item) => item.id === node.id)) {
          return template;
        }
        const next = template.nodes.slice();
        next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, node);
        return { ...template, nodes: next };
      }),
    );
  };

  // 指针 / 每帧回调里读最新实现，免得闭包吃到上一轮的函数
  useEffect(() => {
    dropTargetAtRef.current = dropTargetAt;
    commitDropRef.current = commitDrop;
  });

  /**
   * 指针拖动（Push 116，业务口径「这里拖动卡片也要可以滑动鼠标」）：① 按下卡片、位移超过 `DRAG_THRESHOLD` 才算真拖动；
   * ② 拖动中**滚轮照常可用**（整段拖动没有原生拖拽参与，浏览器不会吞滚轮 —— 指针在页面上就是滚页面）；
   * ③ 放开时落在哪块面板的第几格就交给 `commitDrop`；④ Esc / 指针取消 = 原地取消；没过阈值 = 点一下，什么都不改。
   */
  useEffect(() => {
    /** 收尾（放开 / Esc / 指针取消）：清掉暂存与落点，恢复页面文字选择。 */
    const endDrag = () => {
      pendingRef.current = null;
      document.body.style.userSelect = "";
      setDrag(null);
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
      setDrag({ ...pending.info, width: rect.width });
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
      setDrag(null);
      setDropTarget(null);
      if (!wasDragging) {
        return;
      }
      commitDropRef.current({ ...pending.info, width: grabRef.current.width }, dropTargetAtRef.current(event.clientX, event.clientY));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingRef.current !== null) {
        endDrag();
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  /**
   * 拖动中按帧重算落点（Push 116）：鼠标可以不动、页面在滚（滚轮），拖动卡片与插入线得跟着走，
   * 不能停在按下时算出来的那一格。
   */
  useEffect(() => {
    if (drag === null) {
      return;
    }
    let raf = window.requestAnimationFrame(function tick() {
      const ghost = ghostRef.current;
      if (ghost !== null) {
        const grab = grabRef.current;
        ghost.style.transform = "translate(" + String(pointerRef.current.x - grab.dx) + "px," + String(pointerRef.current.y - grab.dy) + "px)";
      }
      const next = dropTargetAtRef.current(pointerRef.current.x, pointerRef.current.y);
      setDropTarget((previous) =>
        previous !== null && next !== null && previous.templateId === next.templateId && previous.index === next.index ? previous : next,
      );
      raf = window.requestAnimationFrame(tick);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [drag]);

  /** 按下卡片（Push 116）：先只记「可能拖动」，真拖动由上面的指针循环按位移阈值判定。 */
  const beginDrag = (
    info: { nodeId: string; source: "left" | "right"; fromTemplateId: string | null },
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as Element | null;
    // 卡片上的按钮（模板里的「移除」叉号）不参与拖动
    if (target !== null && target.closest("button") !== null) {
      return;
    }
    pendingRef.current = {
      info,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      node: event.currentTarget,
      dragging: false,
    };
    pointerRef.current = { x: event.clientX, y: event.clientY };
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
                    title={templateSectionHref(stage)}
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
                {/* 列头行（Push 181）：左边板块标题、右边计数 + 「＋ 添加节点」——业务口径「在图二任务节点的位置加一个添加节点的按钮」 */}
                <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                  <span className="shrink-0 font-semibold text-zinc-800">任务节点</span>
                  <span className="flex min-w-0 shrink-0 items-center gap-2">
                    <span className="truncate text-xs text-zinc-500">
                      {activeSection} ·{" "}
                      {visibleNodes.length === activeNodes.length
                        ? activeNodes.length + " 个节点"
                        : visibleNodes.length + " / " + activeNodes.length + " 个节点"}
                    </span>
                    {canManageNodes ? (
                      <button
                        type="button"
                        onClick={openCreateForm}
                        aria-expanded={nodeForm?.mode === "create"}
                        title={"在「" + activeSection + "」新增一个任务节点（写进节点库）"}
                        className="shrink-0 rounded-md border border-white/70 bg-white/60 px-2 py-0.5 text-xs font-medium text-zinc-700 transition hover:bg-white hover:text-zinc-900"
                      >
                        ＋ 添加节点
                      </button>
                    ) : null}
                  </span>
                </div>
                {nodeForm === null ? null : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitNodeForm();
                    }}
                    className="mb-3 rounded-xl border border-white/80 bg-white/70 p-3"
                  >
                    <p className="mb-2 text-xs font-medium text-zinc-700">
                      {nodeForm.mode === "create" ? "新增节点" : "编辑节点"} · {activeSection}
                    </p>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(event) => { setFormTitle(event.target.value); }}
                      placeholder="节点名称（中文，必填）"
                      aria-label="节点名称"
                      maxLength={200}
                      className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 outline-none transition placeholder:text-zinc-400 focus:border-zinc-300"
                    />
                    <input
                      type="text"
                      value={formTitleEn}
                      onChange={(event) => { setFormTitleEn(event.target.value); }}
                      placeholder="英文名（可空）"
                      aria-label="节点英文名"
                      maxLength={200}
                      className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 outline-none transition placeholder:text-zinc-400 focus:border-zinc-300"
                    />
                    {formError === null ? null : <p className="mb-2 text-xs text-rose-600">{formError}</p>}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeNodeForm}
                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-50"
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        disabled={formBusy || formTitle.trim() === ""}
                        className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/60 disabled:text-zinc-400"
                      >
                        {formBusy ? "保存中…" : "保存"}
                      </button>
                    </div>
                  </form>
                )}
                {/* 搜索框：按中 / 英文名过滤左列的节点卡片（切板块时自动清空） */}
                <div className="relative mb-3">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="text"
                    value={nodeQuery}
                    onChange={(event) => setNodeQuery(event.target.value)}
                    placeholder="搜索节点（中 / 英）"
                    aria-label="搜索任务节点"
                    className="w-full rounded-lg border border-white/70 bg-white/55 py-1.5 pl-8 pr-8 text-sm text-zinc-700 outline-none transition placeholder:text-zinc-400 hover:bg-white/70 focus:border-zinc-300 focus:bg-white/80"
                  />
                  {nodeQuery !== "" && (
                    <button
                      type="button"
                      onClick={() => setNodeQuery("")}
                      aria-label="清空搜索"
                      title="清空搜索"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 transition hover:bg-white/70 hover:text-zinc-700"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 15 15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M4 4l7 7M11 4l-7 7" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {nodesLoading && activeNodes.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/80 bg-white/35 px-4 py-8 text-center text-xs text-zinc-500">正在加载节点库…</p>
                  ) : null}
                  {nodesError === null ? null : (
                    <p className="rounded-xl border border-dashed border-rose-200 bg-rose-50/70 px-4 py-6 text-center text-xs text-rose-700">
                      节点库加载失败：{nodesError}
                      <button
                        type="button"
                        onClick={() => { setNodesVersion((version) => version + 1); }}
                        className="ml-2 rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] text-rose-700 transition hover:bg-rose-50"
                      >
                        重试
                      </button>
                    </p>
                  )}
                  {visibleNodes.map((item) => (
                    <TaskNodeCard
                      key={item.id}
                      title={item.title}
                      subtitle={item.titleEn}
                      grab
                      onPointerDown={(event) => {
                        beginDrag({ nodeId: item.id, source: "left", fromTemplateId: null }, event);
                      }}
                      onEdit={
                        canManageNodes
                          ? () => {
                              openEditForm(item);
                            }
                          : undefined
                      }
                      onDelete={
                        canManageNodes
                          ? () => {
                              resetDrag();
                              setPendingDeleteNode(item);
                            }
                          : undefined
                      }
                    />
                  ))}
                  {visibleNodes.length === 0 && !nodesLoading && nodesError === null && (
                    <p className="rounded-xl border border-dashed border-white/80 bg-white/35 px-4 py-8 text-center text-xs text-zinc-500">
                      没有匹配的节点，换个关键词试试
                    </p>
                  )}
                </div>
              </section>

              {/* 同一行的面板拉成等高，换行后各自成行 */}
              <div className="flex w-full min-w-0 flex-1 flex-wrap gap-8">
                {templates.map((template) => {
                  const hovered = dropTarget !== null && dropTarget.templateId === template.id;
                  const duplicate = hovered && isDuplicateIn(template);
                  const nodeCount = template.nodes.length;
                  const savedOk = template.saved === snapshotOf(template);
                  return (
                    <section
                      key={template.id}
                      data-template-panel={template.id}
                      aria-label={"模板 " + template.name}
                      className={
                        "group flex w-full flex-col rounded-2xl border bg-[linear-gradient(to_bottom,rgba(255,255,255,0.62),rgba(255,255,255,0.32))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_8px_32px_rgba(15,23,42,0.14)] backdrop-blur-2xl backdrop-saturate-150 transition lg:w-[370px] lg:shrink-0 " +
                        (hovered
                          ? duplicate
                            ? "border-amber-400/70 ring-2 ring-amber-300/40"
                            : "border-zinc-900/30 ring-2 ring-zinc-900/10"
                          : "border-white/80")
                      }
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
                            title="保存这份模板：当前原型未接后端、只写浏览器内存（正式版落库）；保存后再改动会重新变回「保存」"
                            className={
                              "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium transition " +
                              (savedOk
                                ? "border border-white/70 bg-white/50 text-zinc-400 hover:bg-white"
                                : "bg-zinc-900 text-white hover:bg-zinc-800")
                            }
                          >
                            {savedOk ? "已保存" : "保存"}
                          </button>
                          <RowDeleteButton
                            onDelete={() => removeTemplate(template.id)}
                            label={"删除模板 " + template.name}
                          />
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
                          <div className="space-y-3 p-3">
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
                                  grab
                                  highlighted={duplicate && item.id === drag?.nodeId}
                                  dimmed={drag?.source === "right" && item.id === drag.nodeId}
                                  onPointerDown={(event) => {
                                    beginDrag({ nodeId: item.id, source: "right", fromTemplateId: template.id }, event);
                                  }}
                                  deleteLabel={"从模板移除 " + item.title}
                                  onDelete={() =>
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
          {/* 节点库写入的第二下 / 失败提示（Fixed 底栏，与首页「删除项目」确认条同款 —— 非阻断） */}
          {pendingDeleteNode === null && nodeNotice === null ? null : (
            <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
              {pendingDeleteNode === null ? null : (
                <div
                  role="dialog"
                  aria-label="确认删除任务节点"
                  className="pointer-events-auto flex items-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 shadow-lg"
                >
                  <span>
                    删除节点「<span className="font-semibold">{pendingDeleteNode.title}</span>」（{activeSection}）？节点库里的这一条会被删掉，已经生成的项目任务不受影响。
                  </span>
                  <button
                    type="button"
                    onClick={() => { setPendingDeleteNode(null); }}
                    className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteNode}
                    className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-medium text-white transition hover:brightness-95"
                  >
                    删除
                  </button>
                </div>
              )}
              {nodeNotice === null ? null : (
                <div
                  role="alert"
                  className="pointer-events-auto flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow-lg"
                >
                  <span>{nodeNotice}</span>
                  <button
                    type="button"
                    onClick={() => { setNodeNotice(null); }}
                    className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
                  >
                    关闭
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
        {dragNode === null || drag === null ? null : (
          <div
            ref={ghostRef}
            data-drag-ghost="true"
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-50"
            style={{ width: drag.width }}
          >
            <TaskNodeCard title={dragNode.title} subtitle={dragNode.titleEn} ghost />
          </div>
        )}
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
