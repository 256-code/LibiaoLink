import { PROJECT_TASKS } from "./tasks";

/** 模板预设里的一个任务节点（当前原型写死：id / 中文名 / 英文名；正式版由后端下发）。 */
export type TemplatePresetNode = {
  id: string;
  title: string;
  titleEn: string;
};

/** 一个阶段的一套默认模板：名称 + 节点顺序（顺序就是模板里的顺序）。 */
export type TemplatePreset = {
  name: string;
  nodes: TemplatePresetNode[];
};

/** 取「项目总览」里某个阶段的节点（其余阶段的默认顺序沿用这份写死的数据）。 */
function stageNodes(stage: string): TemplatePresetNode[] {
  return PROJECT_TASKS.filter((task) => task.stage === stage).map((task) => ({
    id: task.id,
    title: task.title,
    titleEn: task.titleEn,
  }));
}

/**
 * 硬件实施模板二（业务给的「格口 / 滑槽型」清单，11 条）：
 * 前三条与硬件实施模板一相同（复用同一批 id），其余为本期新写死的节点（英文名按业务截图可见部分补全，待核对）。
 */
const HARDWARE_SLOT_VARIANT: TemplatePresetNode[] = [
  { id: "t11", title: "人员进场、场地检查、施工对接", titleEn: "Personnel entry, site inspection, construction docking" },
  { id: "t12", title: "施工安全培训", titleEn: "Construction Safety Training" },
  { id: "t13", title: "物料转运、清点分类", titleEn: "Material transfer, inventory and classification" },
  { id: "hx01", title: "桌面平台搭建、魔毯铺设", titleEn: "Installation of the platform and carpet" },
  { id: "hx02", title: "站人台、扫描架、称及附属硬件安装", titleEn: "Installation of the scanning frame, scale and auxiliary hardware" },
  { id: "hx03", title: "格口滑槽（或挂包架）安装", titleEn: "Installation of the compartment chute (or bag rack)" },
  { id: "hx04", title: "传感器、按钮盒安装理线", titleEn: "Installation of the sensors and control boxes, cabling" },
  { id: "hx05", title: "强弱电布线", titleEn: "Network and electric wiring" },
  { id: "hx06", title: "扫码台及机柜理线", titleEn: "Induction stations and cabinets cabling" },
  { id: "hx07", title: "防护围栏安装", titleEn: "Installation of Safety Barriers" },
  { id: "hx08", title: "验收交付", titleEn: "Acceptance" },
];

/** 软件部署（业务给的「记录数 4」清单；英文名按业务截图可见部分补全，待核对）。 */
const SOFTWARE_DEPLOY: TemplatePresetNode[] = [
  { id: "sw01", title: "通电测试、参数设定", titleEn: "Power-on test and parameter setting" },
  { id: "sw02", title: "RCS、WES软件部署调试，随机跑", titleEn: "RCS, WES software deployment and commissioning, random run" },
  { id: "sw03", title: "按钮盒注册、传感器调节", titleEn: "Control boxes registration, sensor adjustment" },
  { id: "sw04", title: "与WMS联调", titleEn: "Combined with WMS" },
];

/**
 * 当前原型写死：任务模板页每个阶段的默认模板（名称 + 节点顺序）；正式版由后端下发、落库。
 * - 硬件实施：两套（模板一 = 业务给的 18 条长清单；模板二 = 格口 / 滑槽型 11 条）。
 * - 软件部署：一套（通电测试、参数设定 … 与 WMS 联调）；第二套待业务给。
 * - 其余阶段：各一套，顺序沿用「项目总览」对应阶段的任务顺序。
 */
export const STAGE_TEMPLATE_PRESETS: Record<string, TemplatePreset[]> = {
  售前规划: [{ name: "售前规划模板", nodes: stageNodes("售前规划") }],
  设计开发: [{ name: "设计开发模板", nodes: stageNodes("设计开发") }],
  加工采购: [{ name: "加工采购模板", nodes: stageNodes("加工采购") }],
  组装发货: [{ name: "组装发货模板", nodes: stageNodes("组装发货") }],
  硬件实施: [
    { name: "硬件实施模板一", nodes: stageNodes("硬件实施") },
    { name: "硬件实施模板二", nodes: HARDWARE_SLOT_VARIANT },
  ],
  软件部署: [{ name: "软件部署模板", nodes: SOFTWARE_DEPLOY }],
  试运行: [{ name: "试运行模板", nodes: stageNodes("试运行") }],
  生产阶段: [{ name: "生产阶段模板", nodes: stageNodes("生产阶段") }],
  验收: [{ name: "验收模板", nodes: stageNodes("验收") }],
};
