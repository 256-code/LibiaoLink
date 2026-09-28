/**
 * 日报与问题演示数据（原型内存态、只读）：
 * - 口径来源：`系统功能书.md` A3「日报与问题跟踪」—— 日报字段按 A3-01 在线日报表单、问题四态按 A3-10（未分组 → 未解决 → 处理中 → 已完成）；
 * - 只有示例项目（印度 `inmu-0010`）带数据，其余项目返回空列表（任务域已随 M3-07 刀 1 后半接线，日报随 M4 切片）；
 * - 姓名 / 归类 / 附图名全部是虚构演示值（提交人取自人员目录里的交付成员），接入 report-issue 模块后由接口数据替换。
 */

/** 日报状态（A3-02：可暂存草稿、可补填；补填保留原始提交记录）。 */
export type ReportState = "草稿" | "已提交" | "补填";

/** 问题四态（A3-10，允许回退且留痕）；问题看板的列顺序就按这个数组走。 */
export const ISSUE_STATES = ["未分组", "未解决", "处理中", "已完成"] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

/** 一条日报（字段按 A3-01 在线日报表单）。 */
export type DailyReport = {
  id: string;
  /** 填报日期（Push 202 起口径「YYYY年M月D日」，业务口径「时间格式也要年月日」） */
  date: string;
  /** 提交人 */
  author: string;
  /** 提交时间 */
  submittedAt: string;
  state: ReportState;
  /** 今日施工人数 */
  headcount: number;
  /** 当日完成工作（A3-04 必填；Push 198：「关联任务」改「关联阶段」，原按任务回写「项目进展描述」的副作用随关联单位变更停用） */
  doneWork: string;
  /** 明日计划 */
  plan: string;
  /** 现场发现的问题（非空 = 已自动生成问题记录，A3-09） */
  foundIssue: string;
  /** 问题归类（C9 字典；「现场发现问题」非空时必填） */
  issueCategory: string;
  /** 解决方案或建议 */
  suggestion: string;
  /** 关联阶段（多选；标记当日完成工作对应的项目阶段，Push 198 由「关联任务」改口径） */
  stages: readonly string[];
  /** 现场工作附图（原型：粘贴 / 选文件时存名字 + 图片预览用的 blob 地址；正式版走文件库） */
  photos: readonly ReportPhoto[];
};

/** 一份附图（Push 202 同批续「图片要可以预览」）：`name` = 文件名；`url` = 图片预览地址（粘贴 / 选择的图片才有，演示数据一律 null）。 */
export type ReportPhoto = {
  name: string;
  url: string | null;
};

/** 演示数据帮手：只有名字、没有预览（虚构附图）。 */
const photoNames = (...names: string[]): ReportPhoto[] => names.map((name) => ({ name, url: null }));

/** 一条问题记录（由日报「现场发现问题」自动生成；同一条日报只生成一次，A3-09）。 */
export type Issue = {
  id: string;
  /** 问题描述（取自来源日报） */
  title: string;
  state: IssueState;
  /** 问题归类；未分组 = 还没分派责任部门 / 责任人（此时责任为空） */
  category: string;
  /** 提出人（= 来源日报的提交人） */
  reporter: string;
  /** 责任部门 · 责任人（按归类自动分派，空 = 待分派） */
  owner: string;
  /** 所属任务 */
  task: string;
  /** 提出日期（= 来源日报的填报日期） */
  raisedAt: string;
  /** 处理时限（问题处理时限 SLA，ADR-026） */
  dueAt: string;
  /** 解决方案 / 回复（处理中、已完成才有） */
  solution: string;
  /** 来源日报 id */
  reportId: string;
};

/** 演示数据挂靠的项目（示例项目：印度 `inmu-0010`）。 */
export const DEMO_REPORTS_PROJECT_ID = "inmu-0010";

/** 演示日报（新 → 旧）：2026年9月17日 ~ 2026年9月21日，覆盖 已提交 / 补填 / 草稿 三种状态。 */
const DEMO_REPORTS: DailyReport[] = [
  {
    id: "r-0921a",
    date: "2026年9月21日",
    author: "卢青",
    submittedAt: "18:26",
    state: "已提交",
    headcount: 10,
    doneWork: "3 号供包台对射支架更换完成；格口滑槽第 2 段重新定位，试跑 30 分钟无异常",
    plan: "继续格口滑槽段调试，配合 RCS 联动随机跑",
    foundIssue: "格口滑槽入场运输磕碰，2 件滑槽面板需补件（现场无备件）",
    issueCategory: "供应商原因",
    suggestion: "建议由采购联系供应商走补件流程，同步确认运输加固方案",
    stages: ["硬件实施", "试运行"],
    photos: photoNames("滑槽磕碰-01.jpg", "滑槽磕碰-02.jpg"),
  },
  {
    id: "r-0921b",
    date: "2026年9月21日",
    author: "方沐",
    submittedAt: "17:50",
    state: "草稿",
    headcount: 10,
    doneWork: "WES 与 WMS 联调恢复，随机跑 30 分钟未复现接口超时",
    plan: "继续 4 小时稳定性验证，再做一轮全流程随机跑",
    foundIssue: "",
    issueCategory: "",
    suggestion: "",
    stages: ["软件部署"],
    photos: photoNames("联调记录-01.jpg"),
  },
  {
    id: "r-0920",
    date: "2026年9月20日",
    author: "夏珂",
    submittedAt: "20:15",
    state: "已提交",
    headcount: 10,
    doneWork: "服务器机柜安装及理线完成；WES / WMS 联调环境就绪",
    plan: "开始 WES 与 WMS 联调，配合 RCS 联动随机跑",
    foundIssue: "WES 与 WMS 接口偶发超时（约 3 分钟一次），联调中断",
    issueCategory: "规划部",
    suggestion: "建议后端增加重试队列，并复核接口超时阈值",
    stages: ["硬件实施", "软件部署"],
    photos: photoNames("机柜理线-01.jpg", "联调日志-01.jpg"),
  },
  {
    id: "r-0919",
    date: "2026年9月19日",
    author: "程屿",
    submittedAt: "18:20",
    state: "补填",
    headcount: 11,
    doneWork: "2 号巷道导轨张紧度复测合格；安全围栏门禁联调完成",
    plan: "补录 9月19日现场记录，继续格口段机械定位",
    foundIssue: "现场地面平整度不足，导轨底座需加垫片（局部高低差约 8mm）",
    issueCategory: "客观原因",
    suggestion: "建议项目部协调客户做局部找平，或改用可调底座",
    stages: ["硬件实施"],
    photos: photoNames("地面平整度-01.jpg"),
  },
  {
    id: "r-0918",
    date: "2026年9月18日",
    author: "苏珩",
    submittedAt: "19:05",
    state: "已提交",
    headcount: 12,
    doneWork: "2 号巷道导轨安装完成 18 组；工作站定位弹线完成 4 个工位",
    plan: "完成工作站剩余弹线，弱电桥架进场验收",
    foundIssue: "3 号供包台光电对射误触发，偶尔丢包",
    issueCategory: "机械部",
    suggestion: "建议更换对射支架并加装遮光罩",
    stages: ["硬件实施"],
    photos: photoNames("工作站弹线-01.jpg"),
  },
  {
    id: "r-0917",
    date: "2026年9月17日",
    author: "石昀",
    submittedAt: "18:42",
    state: "已提交",
    headcount: 12,
    doneWork: "1 号巷道导轨安装完成 18 组、铜丝镶嵌抽检 6 处合格；人员进场与施工安全培训完成",
    plan: "继续 2 号巷道导轨安装，复核格口开口尺寸",
    foundIssue: "客户现场电压波动导致 UPS 频繁切换（约每小时 2 次）",
    issueCategory: "客户原因",
    suggestion: "建议客户加装稳压器，UPS 切换前先做空载测试",
    stages: ["硬件实施"],
    photos: photoNames("1号巷道导轨-01.jpg", "安全培训-01.jpg"),
  },
];

/** 演示问题（新 → 旧）：四态都有覆盖（未分组 1 / 未解决 1 / 处理中 2 / 已完成 1）。 */
const DEMO_ISSUES: Issue[] = [
  {
    id: "i-01",
    title: "格口滑槽入场运输磕碰，2 件滑槽面板需补件",
    state: "未分组",
    category: "供应商原因",
    reporter: "卢青",
    owner: "",
    task: "到货入库",
    raisedAt: "2026年9月21日",
    dueAt: "2026年9月23日",
    solution: "",
    reportId: "r-0921a",
  },
  {
    id: "i-02",
    title: "现场地面平整度不足，导轨底座需加垫片（局部高低差约 8mm）",
    state: "未解决",
    category: "客观原因",
    reporter: "程屿",
    owner: "项目部 · 秦朗",
    task: "巷道导轨安装，铜丝镶嵌",
    raisedAt: "2026年9月19日",
    dueAt: "2026年9月22日",
    solution: "",
    reportId: "r-0919",
  },
  {
    id: "i-03",
    title: "3 号供包台光电对射误触发，偶尔丢包",
    state: "处理中",
    category: "机械部",
    reporter: "苏珩",
    owner: "机械部 · 程屿",
    task: "小批量实物测试",
    raisedAt: "2026年9月18日",
    dueAt: "2026年9月22日",
    solution: "已更换对射支架并加装遮光罩，现场观察 24 小时未再复现",
    reportId: "r-0918",
  },
  {
    id: "i-04",
    title: "WES 与 WMS 接口偶发超时（约 3 分钟一次），联调中断",
    state: "处理中",
    category: "规划部",
    reporter: "夏珂",
    owner: "规划部 · 方沐",
    task: "WES软件部署及与WMS联调;设备运行测试",
    raisedAt: "2026年9月20日",
    dueAt: "2026年9月22日",
    solution: "后端已加重试队列、超时阈值调整到 30 秒；9月21日随机跑 30 分钟未复现",
    reportId: "r-0920",
  },
  {
    id: "i-05",
    title: "客户现场电压波动导致 UPS 频繁切换（约每小时 2 次）",
    state: "已完成",
    category: "客户原因",
    reporter: "石昀",
    owner: "项目部 · 秦朗",
    task: "通电测试",
    raisedAt: "2026年9月17日",
    dueAt: "2026年9月19日",
    solution: "客户已加装稳压器，9月19日复测通过，提出人确认关闭",
    reportId: "r-0917",
  },
];

/** 取某个项目的日报（数组本身已按新 → 旧排好）：原型阶段只有示例项目带数据，其余项目返回空列表。 */
export function reportsForProject(projectId: string): DailyReport[] {
  return projectId === DEMO_REPORTS_PROJECT_ID ? DEMO_REPORTS : [];
}

/** 取某个项目的问题记录：原型阶段只有示例项目带数据，其余项目返回空列表。 */
export function issuesForProject(projectId: string): Issue[] {
  return projectId === DEMO_REPORTS_PROJECT_ID ? DEMO_ISSUES : [];
}
