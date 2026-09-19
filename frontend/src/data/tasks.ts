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
  /**
   * 手动指定的任务状态（Push 65 表格行内下拉 / 进度条联动的结果）。
   * 未指定 = 纯派生（进度 + 日期）；指定后以手动为准，直到再次改进度条。
   */
  statusOverride?: TaskStatus;
};

/** 兜底项目经理（虚构演示名；正常路径取项目卡片上的经理 `project.managerId` → 姓名，Push 61 起）。 */
export const PROJECT_MANAGER = "李伟";

const BASE_TASKS: Array<Omit<ProjectTask, "headcount" | "priority" | "files">> = [
  { id: "t01", stage: "售前规划", title: "布局定档", titleEn: "Layout scheduling", owner: "彭砚", ownerEn: "pengyan", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "CAD 图纸", change: "", onTime: "按时交付", note: "" },
  { id: "t02", stage: "售前规划", title: "技术协议定档", titleEn: "Technical agreement finalization", owner: "石昀", ownerEn: "shiyun", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "技术协议", change: "", onTime: "按时交付", note: "" },
  { id: "t03", stage: "售前规划", title: "合同签署", titleEn: "Contract signing", owner: "岑宁", ownerEn: "chenning", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "合同", change: "", onTime: "按时交付", note: "" },
  { id: "t04", stage: "售前规划", title: "项目启动", titleEn: "Project Startup", owner: "苏珩", ownerEn: "suheng", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月15日", doneDate: "5月15日", days: 1, deliverable: "评审单", change: "", onTime: "按时交付", note: "维护本计划" },
  { id: "t05", stage: "设计开发", title: "规划设计", titleEn: "planning design", owner: "石昀", ownerEn: "shiyun", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "设备清单", change: "", onTime: "按时交付", note: "" },
  { id: "t06", stage: "加工采购", title: "订单录入", titleEn: "Order entry", owner: "蒋恬", ownerEn: "jiangtian", status: "已完成", progress: 1, startDate: "5月21日", dueDate: "6月19日", doneDate: "6月19日", days: 30, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t07", stage: "组装发货", title: "生产", titleEn: "Production", owner: "谢遥", ownerEn: "xieyao", status: "已完成", progress: 1, startDate: "6月23日", dueDate: "7月4日", doneDate: "7月4日", days: 12, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t08", stage: "组装发货", title: "质检", titleEn: "Quality inspection", owner: "谢遥", ownerEn: "xieyao", status: "已完成", progress: 1, startDate: "6月23日", dueDate: "7月4日", doneDate: "7月4日", days: 12, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t09", stage: "组装发货", title: "包装", titleEn: "Packing", owner: "谢遥", ownerEn: "xieyao", status: "已完成", progress: 1, startDate: "6月23日", dueDate: "7月4日", doneDate: "7月4日", days: 12, deliverable: "发货装箱单", change: "2026/8/11", onTime: "按时交付", note: "" },
  { id: "t10", stage: "组装发货", title: "运输", titleEn: "Transportation", owner: "苏珩", ownerEn: "suheng", status: "进行中", progress: 0.49, startDate: "7月5日", dueDate: "8月31日", doneDate: "", days: 58, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t11", stage: "硬件实施", title: "人员进场、场地检查、施工对接", titleEn: "Personnel entry, site inspection, construction docking", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 1, startDate: "9月2日", dueDate: "9月2日", doneDate: "8月11日", days: 1, deliverable: "到货单", change: "", onTime: "按时交付", note: "" },
  { id: "t12", stage: "硬件实施", title: "施工安全培训", titleEn: "Construction Safety Training", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月3日", dueDate: "9月3日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t13", stage: "硬件实施", title: "物料转运、清点分类", titleEn: "Material transfer, inventory and classification", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月3日", dueDate: "9月4日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t14", stage: "硬件实施", title: "货架组装", titleEn: "Shelf Assembly", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月5日", dueDate: "9月22日", doneDate: "", days: 18, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t15", stage: "硬件实施", title: "货架检查", titleEn: "Shelf inspection", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月23日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t16", stage: "硬件实施", title: "挂件安装", titleEn: "Pendant Installation", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月24日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t17", stage: "硬件实施", title: "巷道导轨安装，铜丝镶嵌", titleEn: "Tunnel rail installation, copper wire inlay", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月24日", dueDate: "9月26日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t18", stage: "硬件实施", title: "飞箱机器安装", titleEn: "Air Robot installed", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月25日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t19", stage: "硬件实施", title: "强弱电布线、接线，服务器机柜安装及理线", titleEn: "Power and weak current wiring and connectionsServer cabinet installation and cable management", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月23日", dueDate: "9月30日", doneDate: "", days: 8, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t20", stage: "软件部署", title: "通电测试", titleEn: "Power-on Test", owner: "夏珂", ownerEn: "xiake", status: "待开始", progress: 0, startDate: "10月2日", dueDate: "10月2日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t21", stage: "硬件实施", title: "工作站安装及定位弹线", titleEn: "Workstation Installation and Positioning Chalk Line", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月25日", dueDate: "9月30日", doneDate: "", days: 6, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t22", stage: "硬件实施", title: "飞箱电控箱及AP安装", titleEn: "AirRobot electric control cabinet and AP installation", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月26日", dueDate: "9月27日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t23", stage: "硬件实施", title: "货架条码黏贴", titleEn: "Shelf barcode labeling", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月28日", dueDate: "9月28日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t24", stage: "硬件实施", title: "接驳位弹线及魔毯黏贴，充电桩组装", titleEn: "Docking position marking and magic carpet sticking, charging pile assembly", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "9月29日", dueDate: "10月1日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t25", stage: "硬件实施", title: "导航柱弹线及安装", titleEn: "Guide post marking and installation", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "10月1日", dueDate: "10月1日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t26", stage: "软件部署", title: "RCS部署及联动随机跑", titleEn: "RCS Deployment and Random-linked Operation", owner: "夏珂", ownerEn: "xiake", status: "待开始", progress: 0, startDate: "10月2日", dueDate: "10月6日", doneDate: "", days: 5, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t27", stage: "软件部署", title: "工作站软件部署", titleEn: "Workstation Software Deployment", owner: "夏珂", ownerEn: "xiake", status: "待开始", progress: 0, startDate: "10月2日", dueDate: "10月2日", doneDate: "", days: 1, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t28", stage: "硬件实施", title: "第一批空箱上架", titleEn: "The first batch of empty boxes is on the shelves", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "10月5日", dueDate: "10月7日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t29", stage: "硬件实施", title: "安全围栏安装及调试", titleEn: "Safety Fence Installation and Commissioning", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "10月8日", dueDate: "10月9日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t30", stage: "软件部署", title: "WES软件部署及与WMS联调;设备运行测试", titleEn: "WES Software Deployment and Integration with WMS; Equipment operation test", owner: "夏珂", ownerEn: "xiake", status: "待开始", progress: 0, startDate: "10月8日", dueDate: "10月23日", doneDate: "", days: 16, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t31", stage: "硬件实施", title: "第二批空箱上架", titleEn: "The second batch of empty boxes is on the shelves", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "10月10日", dueDate: "10月12日", doneDate: "", days: 3, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t32", stage: "硬件实施", title: "第三批空箱上架", titleEn: "The third batch of empty boxes is on the shelves", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "10月15日", dueDate: "10月19日", doneDate: "", days: 5, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t33", stage: "试运行", title: "小批量实物测试", titleEn: "Small batch of physical test", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "10月24日", dueDate: "10月28日", doneDate: "", days: 5, deliverable: "安装完成证明", change: "", onTime: "", note: "" },
  { id: "t34", stage: "试运行", title: "客户培训、上线", titleEn: "Customer training, go alive", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "10月29日", dueDate: "11月1日", doneDate: "", days: 4, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t35", stage: "生产阶段", title: "产能爬坡", titleEn: "Capacity climbing", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "11月2日", dueDate: "11月6日", doneDate: "", days: 5, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t36", stage: "验收", title: "验收交付", titleEn: "Acceptance", owner: "彭砚", ownerEn: "pengyan", status: "待开始", progress: 0, startDate: "11月7日", dueDate: "11月8日", doneDate: "", days: 2, deliverable: "验收单", change: "", onTime: "", note: "" },
  { id: "t37", stage: "设计开发", title: "机械设计", titleEn: "Mechanical design", owner: "卢青", ownerEn: "luqing", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t38", stage: "设计开发", title: "软件开发", titleEn: "Software", owner: "方沐", ownerEn: "fangmu", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t39", stage: "组装发货", title: "清关", titleEn: "Customs clearance", owner: "苏珩", ownerEn: "suheng", status: "待开始", progress: 0, startDate: "7月5日", dueDate: "9月2日", doneDate: "", days: 60, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t40", stage: "加工采购", title: "采购", titleEn: "Procurement", owner: "蒋恬", ownerEn: "jiangtian", status: "已完成", progress: 1, startDate: "5月21日", dueDate: "6月19日", doneDate: "6月19日", days: 30, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t41", stage: "加工采购", title: "到货入库", titleEn: "Goods arrival and warehousing", owner: "蒋恬", ownerEn: "jiangtian", status: "已完成", progress: 1, startDate: "5月21日", dueDate: "6月19日", doneDate: "6月19日", days: 30, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t42", stage: "设计开发", title: "硬件研发", titleEn: "Hardware R&D", owner: "程屿", ownerEn: "chengyu", status: "已完成", progress: 1, startDate: "5月15日", dueDate: "5月20日", doneDate: "5月20日", days: 6, deliverable: "", change: "", onTime: "按时交付", note: "" },
  { id: "t43", stage: "组装发货", title: "送仓", titleEn: "Deliver to warehouse", owner: "苏珩", ownerEn: "suheng", status: "待开始", progress: 0, startDate: "9月2日", dueDate: "9月3日", doneDate: "", days: 2, deliverable: "", change: "", onTime: "", note: "" },
  { id: "t44", stage: "设计开发", title: "物料清单完整版", titleEn: "", owner: "苏珩", ownerEn: "suheng", status: "已完成", progress: 1, startDate: "5月20日", dueDate: "5月20日", doneDate: "5月20日", days: 1, deliverable: "物料总清单", change: "2026/8/11", onTime: "按时交付", note: "物料清单" },
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

/**
 * 示例任务数据（源表 44 条）归属的项目：原型阶段只有印度项目有真实来源（源表那一个项目），
 * 其余项目暂为空列表 —— 打开后只出页面骨架（阶段标签导航 + 阶段分组头，没有任务行）。
 */
export const DEMO_TASKS_PROJECT_ID = "inmu-0010";

/** 取某个项目的任务：原型阶段只有示例项目（印度）带数据，其余项目返回空列表（正式版按项目取数）。 */
export function tasksForProject(projectId: string): ProjectTask[] {
  return projectId === DEMO_TASKS_PROJECT_ID ? PROJECT_TASKS : [];
}

export function parseCnDate(value: string): { month: number; day: number } | null {
  const match = /(\d+)月(\d+)日/.exec(value);
  if (match === null) {
    return null;
  }
  return { month: Number(match[1]), day: Number(match[2]) };
}

/** 演示数据里的任务日期不带年份（源表「M月D日」）；编辑表单统一按 2026 年换算成 ISO。 */
export const TASK_DATE_YEAR = 2026;

/** 「M月D日」→「YYYY-MM-DD」；解析失败返回空串。 */
export function isoFromCnDate(value: string): string {
  const parsed = parseCnDate(value);
  if (parsed === null) {
    return "";
  }
  return (
    String(TASK_DATE_YEAR) + "-" + String(parsed.month).padStart(2, "0") + "-" + String(parsed.day).padStart(2, "0")
  );
}

/** 「YYYY-MM-DD」→「M月D日」（表格 / 抽屉展示格式）。 */
export function cnDateFromIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return "";
  }
  return String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
}

/** 预计所需天数 = 两个日期的含首尾天数（与源表口径一致：9月5日→9月22日 = 18 天）。 */
export function daysBetweenInclusive(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + "T00:00:00Z");
  const to = Date.parse(toIso + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
    return 0;
  }
  return Math.round((to - from) / 86400000) + 1;
}

/** 四格进度条的格数（与 `Tracker` 同一口径；Push 65 起任务状态与它双向联动）。 */
export const PROGRESS_STEPS = 4;

/** 完成态（手动改成非完成态时，实际完成日期要一并清空 —— Push 67 业务定案）。 */
export function isCompleteStatus(status: TaskStatus): boolean {
  return status === "已完成" || status === "提前完成";
}

/** 进度（0~1 小数）→ 点亮的格数（0~4，四舍五入）。 */
export function progressStep(progress: number, steps: number = PROGRESS_STEPS): number {
  return Math.max(0, Math.min(steps, Math.round(progress * steps)));
}

/** 四格全亮 = 任务完成（未填预计完成时间也按完成算，完成态再按工期派生 已完成 / 提前完成）。 */
export function isTrackerComplete(task: ProjectTask): boolean {
  return task.doneDate !== "" || progressStep(task.progress) >= PROGRESS_STEPS;
}

export function isTaskDone(task: ProjectTask): boolean {
  return isTrackerComplete(task);
}

/**
 * 改进度条后任务状态跟着走（Push 65 联动口径）：
 * 4 格 = 取消手动指定（交给完成态按工期派生）；已过预计完成日期且未完成 = 保持「已延期」（Push 67 修正：
 * 点进度条不再把「已延期」改成「待开始 / 进行中」）；其余 0 格 = 待开始、1~3 格 = 进行中。
 */
export function statusOverrideAfterProgress(progress: number, pastDue = false): TaskStatus | undefined {
  const step = progressStep(progress);
  if (step >= PROGRESS_STEPS) {
    return undefined;
  }
  if (pastDue) {
    return "已延期";
  }
  if (step <= 0) {
    return "待开始";
  }
  return "进行中";
}

/**
 * 选任务状态后进度条跟着走（Push 65 联动口径）：
 * 待开始 = 0 格；进行中 = 至少 1 格（已全亮则退回 3 格）；已完成 / 提前完成 = 4 格全亮；已延期 = 保持当前格数。
 */
export function progressAfterStatus(status: TaskStatus, progress: number): number {
  const step = progressStep(progress);
  if (status === "待开始") {
    return 0;
  }
  if (status === "已延期") {
    return progress;
  }
  if (status === "进行中") {
    if (step <= 0) {
      return 1 / PROGRESS_STEPS;
    }
    return step >= PROGRESS_STEPS ? (PROGRESS_STEPS - 1) / PROGRESS_STEPS : progress;
  }
  return 1;
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

/** 预计完成日期早于今天（不看完成情况；「M月D日」按月 / 日比较）。 */
export function isPastDue(task: ProjectTask, now: Date = new Date()): boolean {
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

export function isTaskOverdue(task: ProjectTask, now: Date = new Date()): boolean {
  return !isTaskDone(task) && isPastDue(task, now);
}

/**
 * 「是否按时交付」列的逾期标注（Push 67 业务定案：逾期标注从「实际完成日期」列移到这里）：
 * 已过预计完成日期且未完成 → 「逾期未交付」；已完成但晚于预计完成日期（或没填完成日期、预计完成日期已过）→ 「逾期已交付」；
 * 其余返回 null（照源表的 onTime 值展示）。
 */
export function lateDeliveryLabel(task: ProjectTask, now: Date = new Date()): "逾期未交付" | "逾期已交付" | null {
  const due = parseCnDate(task.dueDate);
  if (due === null) {
    return null;
  }
  if (!isTaskDone(task)) {
    return isPastDue(task, now) ? "逾期未交付" : null;
  }
  if (task.doneDate === "") {
    return isPastDue(task, now) ? "逾期已交付" : null;
  }
  const done = parseCnDate(task.doneDate);
  if (done === null) {
    return null;
  }
  const late = done.month > due.month || (done.month === due.month && done.day > due.day);
  return late ? "逾期已交付" : null;
}

export function taskStatus(task: ProjectTask, now: Date = new Date()): TaskStatus {
  // ① 手动指定优先（行内下拉 / 点进度条联动的结果）：选了完成态就按完成态显示；
  //    选了 待开始 / 进行中 / 已延期 时，只要进度条没重新点满四格就以手动为准。
  if (task.statusOverride !== undefined) {
    if (task.statusOverride === "已完成" || task.statusOverride === "提前完成") {
      return task.statusOverride;
    }
    if (progressStep(task.progress) < PROGRESS_STEPS) {
      return task.statusOverride;
    }
  }
  // ② 完成态：四格全亮 / 已填实际完成日期 / 数据里就是完成态 → 按工期派生「已完成 / 提前完成」
  //    （未填预计完成时间 → 只显示「已完成」）。
  if (isTrackerComplete(task) || task.status === "已完成" || task.status === "提前完成") {
    return isTaskDoneEarly(task) ? "提前完成" : "已完成";
  }
  // ③ 未完成：先看延期，再看进度条格数
  if (task.status === "已延期") {
    return "已延期";
  }
  if (isTaskOverdue(task, now)) {
    return "已延期";
  }
  return progressStep(task.progress) >= 1 || task.status === "进行中" ? "进行中" : "待开始";
}
