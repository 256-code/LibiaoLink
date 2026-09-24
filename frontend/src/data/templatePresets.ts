/**
 * 任务模板预设（前端原型数据）—— **Push 181 起只管「模板」这一半**：任务模板页右列的默认模板面板、
 * 「项目总览 → 添加任务」卡片的「模板」标签仍由本文件写死（模板接口 = M3-05 余第二段，`GET/POST /api/v1/task-templates`）；
 * 「任务节点」那一半已改吃节点库接口（`frontend/src/templateApi.ts`，`GET /api/v1/task-nodes`）—— 节点不再来自本文件。
 * 节点 id 沿用原型 id（不是节点库 UUID）：从预设建任务时**不带** `taskNodeId`（该字段现解析为项目流程节点，节点关联的落点待定）。
 */
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

/** 各阶段的节点池（顺序 = 项目总览里该阶段的任务顺序）；「软件部署」的节点池见下方 SOFTWARE_DEPLOY。 */
const STAGE_NODES: Record<string, TemplatePresetNode[]> = {
  售前规划: [
    { id: "t01", title: "布局定档", titleEn: "Layout scheduling" },
    { id: "t02", title: "技术协议定档", titleEn: "Technical agreement finalization" },
    { id: "t03", title: "合同签署", titleEn: "Contract signing" },
    { id: "t04", title: "项目启动", titleEn: "Project Startup" },
  ],
  设计开发: [
    { id: "t05", title: "规划设计", titleEn: "planning design" },
    { id: "t37", title: "机械设计", titleEn: "Mechanical design" },
    { id: "t38", title: "软件开发", titleEn: "Software" },
    { id: "t42", title: "硬件研发", titleEn: "Hardware R&D" },
    { id: "t44", title: "物料清单完整版", titleEn: "" },
  ],
  加工采购: [
    { id: "t06", title: "订单录入", titleEn: "Order entry" },
    { id: "t40", title: "采购", titleEn: "Procurement" },
    { id: "t41", title: "到货入库", titleEn: "Goods arrival and warehousing" },
  ],
  组装发货: [
    { id: "t07", title: "生产", titleEn: "Production" },
    { id: "t08", title: "质检", titleEn: "Quality inspection" },
    { id: "t09", title: "包装", titleEn: "Packing" },
    { id: "t10", title: "运输", titleEn: "Transportation" },
    { id: "t39", title: "清关", titleEn: "Customs clearance" },
    { id: "t43", title: "送仓", titleEn: "Deliver to warehouse" },
  ],
  硬件实施: [
    { id: "t11", title: "人员进场、场地检查、施工对接", titleEn: "Personnel entry, site inspection, construction docking" },
    { id: "t12", title: "施工安全培训", titleEn: "Construction Safety Training" },
    { id: "t13", title: "物料转运、清点分类", titleEn: "Material transfer, inventory and classification" },
    { id: "t14", title: "货架组装", titleEn: "Shelf Assembly" },
    { id: "t15", title: "货架检查", titleEn: "Shelf inspection" },
    { id: "t16", title: "挂件安装", titleEn: "Pendant Installation" },
    { id: "t17", title: "巷道导轨安装，铜丝镶嵌", titleEn: "Tunnel rail installation, copper wire inlay" },
    { id: "t18", title: "飞箱机器安装", titleEn: "Air Robot installed" },
    { id: "t19", title: "强弱电布线、接线，服务器机柜安装及理线", titleEn: "Power and weak current wiring and connectionsServer cabinet installation and cable management" },
    { id: "t21", title: "工作站安装及定位弹线", titleEn: "Workstation Installation and Positioning Chalk Line" },
    { id: "t22", title: "飞箱电控箱及AP安装", titleEn: "AirRobot electric control cabinet and AP installation" },
    { id: "t23", title: "货架条码黏贴", titleEn: "Shelf barcode labeling" },
    { id: "t24", title: "接驳位弹线及魔毯黏贴，充电桩组装", titleEn: "Docking position marking and magic carpet sticking, charging pile assembly" },
    { id: "t25", title: "导航柱弹线及安装", titleEn: "Guide post marking and installation" },
    { id: "t28", title: "第一批空箱上架", titleEn: "The first batch of empty boxes is on the shelves" },
    { id: "t29", title: "安全围栏安装及调试", titleEn: "Safety Fence Installation and Commissioning" },
    { id: "t31", title: "第二批空箱上架", titleEn: "The second batch of empty boxes is on the shelves" },
    { id: "t32", title: "第三批空箱上架", titleEn: "The third batch of empty boxes is on the shelves" },
  ],
  软件部署: [
    { id: "t20", title: "通电测试", titleEn: "Power-on Test" },
    { id: "t26", title: "RCS部署及联动随机跑", titleEn: "RCS Deployment and Random-linked Operation" },
    { id: "t27", title: "工作站软件部署", titleEn: "Workstation Software Deployment" },
    { id: "t30", title: "WES软件部署及与WMS联调;设备运行测试", titleEn: "WES Software Deployment and Integration with WMS; Equipment operation test" },
  ],
  试运行: [
    { id: "t33", title: "小批量实物测试", titleEn: "Small batch of physical test" },
    { id: "t34", title: "客户培训、上线", titleEn: "Customer training, go alive" },
  ],
  生产阶段: [
    { id: "t35", title: "产能爬坡", titleEn: "Capacity climbing" },
  ],
  验收: [
    { id: "t36", title: "验收交付", titleEn: "Acceptance" },
  ],
};

/** 取某个阶段的节点池；不在预设里的阶段（「未分组」等）返回空数组。 */
function stageNodes(stage: string): TemplatePresetNode[] {
  return STAGE_NODES[stage] ?? [];
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
