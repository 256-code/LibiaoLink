export type TaskStatus = "已完成" | "提前完成" | "进行中" | "待开始" | "已延期";

export type TaskPriority = "高" | "中" | "低";

export type ProjectTask = {
  id: string;
  stage: string;
  title: string;
  titleEn: string;
  owner: string;
  ownerEn: string;
  status: TaskStatus;
  progress: number;
  startDate: string;
  dueDate: string;
  doneDate: string;
  days: number;
  deliverable: string;
  change: string;
  onTime: string;
  note: string;
  headcount: number;
  priority: TaskPriority;
  files: string[];
};

export const PROJECT_MANAGER = "贾海洋";

const BASE_TASKS: Array<Omit<ProjectTask, "headcount" | "priority" | "files">> = [
  { id: "t01", stage: "售前规划", title: "布局定档", titleEn: "Layout scheduling", owner: "贾海洋", ownerEn: "haiyang", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "CAD 图纸", change: "", onTime: "按时交付", note: "" },
  { id: "t02", stage: "售前规划", title: "技术协议定档", titleEn: "Technical agreement finalization", owner: "朱成荣", ownerEn: "Eli", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "技术协议", change: "", onTime: "按时交付", note: "" },
  { id: "t03", stage: "售前规划", title: "合同签署", titleEn: "Contract signing", owner: "何玉斓", ownerEn: "Jade", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "合同", change: "", onTime: "按时交付", note: "" },
  { id: "t04", stage: "售前规划", title: "项目启动", titleEn: "Project Startup", owner: "高云", ownerEn: "Helen", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月15日", doneDate: "5月15日", days: 1, deliverable: "评审单", change: "", onTime: "按时交付", note: "维护本计划" },
  { id: "t05", stage: "设计开发", title: "规划设计", titleEn: "planning design", owner: "朱成荣", ownerEn: "Eli", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "设备清单", change: "", onTime: "按时交付", note: "" },
  { id: "t06", stage: "加工采购", title: "订单录入", titleEn: "Order entry", owner: "史建明", ownerEn: "", status: "已完成", progress: 1, startDate: "5月21日", dueDate: "6月19日", doneDate: "6月19日", days: 30, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t07", stage: "组装发货", title: "生产", titleEn: "Production", owner: "余仕铭", ownerEn: "", status: "已完成", progress: 1, startDate: "6月23日", dueDate: "7月4日", doneDate: "7月4日", days: 12, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t08", stage: "组装发货", title: "质检", titleEn: "Quality inspection", owner: "余仕铭", ownerEn: "", status: "已完成", progress: 1, startDate: "6月23日", dueDate: "7月4日", doneDate: "7月4日", days: 12, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t09", stage: "组装发货", title: "包装", titleEn: "Packing", owner: "余仕铭", ownerEn: "", status: "已完成", progress: 1, startDate: "6月23日", dueDate: "7月4日", doneDate: "7月4日", days: 12, deliverable: "发货装箱单", change: "2026/8/11", onTime: "按时交付", note: "" },
  { id: "t10", stage: "组装发货", title: "运输", titleEn: "Transportation", owner: "高云", ownerEn: "Helen", status: "进行中", progress: 0.49, startDate: "7月5日", dueDate: "8月31日", doneDate: "", days: 58, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t11", stage: "硬件实施", title: "人员进场、场地检查、施工对接", titleEn: "Personnel entry, site inspection, construction docking", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 1, startDate: "9月2日", dueDate: "9月2日", doneDate: "8月11日", days: 1, deliverable: "到货单", change: "", onTime: "按时交付", note: "" },
  { id: "t12", stage: "硬件实施", title: "施工安全培训", titleEn: "Construction Safety Training", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月3日", dueDate: "9月3日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t13", stage: "硬件实施", title: "物料转运、清点分类", titleEn: "Material transfer, inventory and classification", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月3日", dueDate: "9月4日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t14", stage: "硬件实施", title: "货架组装", titleEn: "Shelf Assembly", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月5日", dueDate: "9月22日", doneDate: "", days: 18, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t15", stage: "硬件实施", title: "货架检查", titleEn: "Shelf inspection", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月23日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t16", stage: "硬件实施", title: "挂件安装", titleEn: "Pendant Installation", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月24日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t17", stage: "硬件实施", title: "巷道导轨安装，铜丝镶嵌", titleEn: "Tunnel rail installation, copper wire inlay", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月24日", dueDate: "9月26日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t18", stage: "硬件实施", title: "飞箱机器安装", titleEn: "Air Robot installed", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月25日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t19", stage: "硬件实施", title: "强弱电布线、接线，服务器机柜安装及理线", titleEn: "Power and weak current wiring and connectionsServer cabinet installation and cable management", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月30日", doneDate: "", days: 8, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t20", stage: "软件部署", title: "通电测试", titleEn: "Power-on Test", owner: "桂东旭", ownerEn: "", status: "待开始", progress: 0, startDate: "10月2日", dueDate: "10月2日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t21", stage: "硬件实施", title: "工作站安装及定位弹线", titleEn: "Workstation Installation and Positioning Chalk Line", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月25日", dueDate: "9月30日", doneDate: "", days: 6, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t22", stage: "硬件实施", title: "飞箱电控箱及AP安装", titleEn: "AirRobot electric control cabinet and AP installation", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月26日", dueDate: "9月27日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t23", stage: "硬件实施", title: "货架条码黏贴", titleEn: "Shelf barcode labeling", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月28日", dueDate: "9月28日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t24", stage: "硬件实施", title: "接驳位弹线及魔毯黏贴，充电桩组装", titleEn: "Docking position marking and magic carpet sticking, charging pile assembly", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "9月29日", dueDate: "10月1日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t25", stage: "硬件实施", title: "导航柱弹线及安装", titleEn: "Guide post marking and installation", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "10月1日", dueDate: "10月1日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t26", stage: "软件部署", title: "RCS部署及联动随机跑", titleEn: "RCS Deployment and Random-linked Operation", owner: "桂东旭", ownerEn: "", status: "待开始", progress: 0, startDate: "10月2日", dueDate: "10月6日", doneDate: "", days: 5, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t27", stage: "软件部署", title: "工作站软件部署", titleEn: "Workstation Software Deployment", owner: "桂东旭", ownerEn: "", status: "待开始", progress: 0, startDate: "10月2日", dueDate: "10月2日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t28", stage: "硬件实施", title: "第一批空箱上架", titleEn: "The first batch of empty boxes is on the shelves", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "10月5日", dueDate: "10月7日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t29", stage: "硬件实施", title: "安全围栏安装及调试", titleEn: "Safety Fence Installation and Commissioning", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "10月8日", dueDate: "10月9日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t30", stage: "软件部署", title: "WES软件部署及与WMS联调;设备运行测试", titleEn: "WES Software Deployment and Integration with WMS; Equipment operation test", owner: "桂东旭", ownerEn: "", status: "待开始", progress: 0, startDate: "10月8日", dueDate: "10月23日", doneDate: "", days: 16, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t31", stage: "硬件实施", title: "第二批空箱上架", titleEn: "The second batch of empty boxes is on the shelves", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "10月10日", dueDate: "10月12日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t32", stage: "硬件实施", title: "第三批空箱上架", titleEn: "The third batch of empty boxes is on the shelves", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "10月15日", dueDate: "10月19日", doneDate: "", days: 5, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t33", stage: "试运行", title: "小批量实物测试", titleEn: "Small batch of physical test", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "10月24日", dueDate: "10月28日", doneDate: "", days: 5, deliverable: "安装完成证明", change: "", onTime: "", note: "" },
  { id: "t34", stage: "试运行", title: "客户培训、上线", titleEn: "Customer training, go alive", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "10月29日", dueDate: "11月1日", doneDate: "", days: 4, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t35", stage: "生产阶段", title: "产能爬坡", titleEn: "Capacity climbing", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "11月2日", dueDate: "11月6日", doneDate: "", days: 5, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t36", stage: "验收", title: "验收交付", titleEn: "Acceptance", owner: "贾海洋", ownerEn: "haiyang", status: "待开始", progress: 0, startDate: "11月7日", dueDate: "11月8日", doneDate: "", days: 2, deliverable: "验收单", change: "", onTime: "", note: "" },
  { id: "t37", stage: "设计开发", title: "机械设计", titleEn: "Mechanical design", owner: "董伊涛", ownerEn: "", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t38", stage: "设计开发", title: "软件开发", titleEn: "Software", owner: "彭曙", ownerEn: "Lawrence", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t39", stage: "组装发货", title: "清关", titleEn: "Customs clearance", owner: "高云", ownerEn: "Helen", status: "待开始", progress: 0, startDate: "7月5日", dueDate: "9月2日", doneDate: "", days: 60, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t40", stage: "加工采购", title: "采购", titleEn: "Procurement", owner: "史建明", ownerEn: "", status: "已完成", progress: 1, startDate: "5月21日", dueDate: "6月19日", doneDate: "6月19日", days: 30, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t41", stage: "加工采购", title: "到货入库", titleEn: "Goods arrival and warehousing", owner: "史建明", ownerEn: "", status: "已完成", progress: 1, startDate: "5月21日", dueDate: "6月19日", doneDate: "6月19日", days: 30, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t42", stage: "设计开发", title: "硬件研发", titleEn: "Hardware R&D", owner: "陈建波", ownerEn: "", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t43", stage: "组装发货", title: "送仓", titleEn: "Deliver to warehouse", owner: "高云", ownerEn: "Helen", status: "待开始", progress: 0, startDate: "9月2日", dueDate: "9月3日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t44", stage: "设计开发", title: "物料清单完整版", titleEn: "", owner: "高云", ownerEn: "Helen", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "物料总清单", change: "2026/8/11", onTime: "按时交付", note: "物料清单" },
];

const HEADCOUNT_BY_STAGE: Record<string, number> = {
  售前规划: 2,
  设计开发: 3,
  加工采购: 2,
  组装发货: 8,
  硬件实施: 10,
  软件部署: 3,
  试运行: 4,
  生产阶段: 8,
  验收: 3,
};

const FILES_BY_STAGE: Record<string, string[]> = {
  售前规划: ["技术协议-终版.pdf", "合同扫描件.pdf"],
  设计开发: ["设计图纸包.zip", "物料清单.xlsx"],
  加工采购: ["采购订单汇总.xlsx", "到货记录.xlsx"],
  组装发货: ["发货装箱单.xlsx", "质检记录.pdf"],
  硬件实施: ["施工计划表.xlsx", "现场照片.zip"],
  软件部署: ["部署手册.pdf", "配置备份.zip"],
  试运行: ["试运行记录.xlsx"],
  生产阶段: ["产能测试报告.pdf"],
  验收: ["验收单.pdf", "培训材料.pptx"],
};

const PRIORITY_CYCLE: TaskPriority[] = ["高", "中", "中", "低", "中", "高"];

export const PROJECT_TASKS: ProjectTask[] = BASE_TASKS.map((task, index) => {
  const done = task.doneDate !== "" || task.progress >= 1;
  const pool = FILES_BY_STAGE[task.stage] ?? [];
  return {
    ...task,
    headcount: (HEADCOUNT_BY_STAGE[task.stage] ?? 4) + (index % 3),
    priority: task.status === "进行中" ? "高" : PRIORITY_CYCLE[index % PRIORITY_CYCLE.length],
    files: done ? pool.slice(0, 2) : task.progress > 0 ? pool.slice(0, 1) : [],
  };
});

export function parseCnDate(value: string): { month: number; day: number } | null {
  const match = /(\d+)月(\d+)日/.exec(value);
  if (match === null) {
    return null;
  }
  return { month: Number(match[1]), day: Number(match[2]) };
}

export function isTaskDone(task: ProjectTask): boolean {
  return task.doneDate !== "" || task.progress >= 1;
}

export function isTaskDoneEarly(task: ProjectTask): boolean {
  if (task.doneDate === "" || task.dueDate === "") {
    return false;
  }
  const done = parseCnDate(task.doneDate);
  const due = parseCnDate(task.dueDate);
  if (done === null || due === null) {
    return false;
  }
  return done.month < due.month || (done.month === due.month && done.day < due.day);
}

export function isTaskOverdue(task: ProjectTask, now: Date = new Date()): boolean {
  if (isTaskDone(task)) {
    return false;
  }
  const due = parseCnDate(task.dueDate);
  if (due === null) {
    return false;
  }
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  if (due.month !== todayMonth) {
    return due.month < todayMonth;
  }
  return due.day < todayDay;
}

export function taskStatus(task: ProjectTask, now: Date = new Date()): TaskStatus {
  if (isTaskDone(task) || task.status === "已完成" || task.status === "提前完成") {
    return isTaskDoneEarly(task) ? "提前完成" : "已完成";
  }
  if (isTaskOverdue(task, now)) {
    return "已延期";
  }
  return task.status === "进行中" ? "进行中" : "待开始";
}
