/**
 * 日报与问题演示数据（原型内存态、只读）：
 * - 口径来源：`系统功能书.md` A3「日报与问题跟踪」—— 日报字段按 A3-01 在线日报表单；问题状态按 A3-10 ——
 *   **Push 207 起改三态**（业务口径 2026-09-28「取消未分组 未分组就是未解决」）：未解决 → 处理中 → 已完成
 *   （原四态的「未分组」并入「未解决」；`shared/src/modules/issues.ts` 的 `unassigned` 与库侧 CHECK、
 *   `shared/src/common/dicts.ts` 的字典描述修订挂 wmj 线 —— 本线只改前端原型 + 文档登记）；
 * - **Push 206 续**（业务口径 2026-09-28「写点静态数据到日报的一系列记录里面去」）：演示数据改为**所有项目共用一份** ——
 *   不管打开哪个项目，「日报记录 / 问题追踪 / 问题看板」都带这一串静态数据（最初的口径来源项目 = 示例项目印度 `inmu-0010`）；
 * - 姓名 / 归类 / 附图名全部是虚构演示值（提交人取自人员目录里的交付成员），演示附图 = 内联 SVG 占位图（离线可用、
 *   不依赖任何外部资源），接入 report-issue 模块后由接口数据替换。
 */

/** 日报状态（A3-02：可暂存草稿、可补填；补填保留原始提交记录）。 */
export type ReportState = "草稿" | "已提交" | "补填";

/** 问题三态（A3-10；Push 207 业务口径「取消未分组 未分组就是未解决」—— 原四态的「未分组」并入「未解决」；
 *  允许回退且留痕）；问题看板的列顺序就按这个数组走。 */
export const ISSUE_STATES = ["未解决", "处理中", "已完成"] as const;

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
  /** 明日计划（Push 205 起 A3-04 必填：时间 + 当日完成工作 + 明日计划） */
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

/** 演示附图占位图（Push 206 续）：内联 SVG data URL —— 离线可用、不依赖任何外部资源；
 *  色相按文件名长度 + 序号散列，几张图颜色各不相同，记录列表里的大图瓦片看着像一串现场照片。 */
function demoPhotoUrl(name: string, index: number): string {
  const hue = (name.length * 47 + index * 61) % 360;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192" viewBox="0 0 256 192">' +
    '<rect width="256" height="192" fill="hsl(' + hue + ',34%,88%)"/>' +
    '<circle cx="196" cy="52" r="24" fill="hsl(' + hue + ',30%,78%)"/>' +
    '<path d="M0 150 L58 112 L112 146 L166 100 L256 158 L256 192 L0 192 Z" fill="hsl(' + hue + ',32%,72%)"/>' +
    '</svg>';
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** 演示数据帮手：虚构附图 = 名字 + 内联占位图（记录列表里能出大图瓦片）。 */
const demoPhotos = (...names: string[]): ReportPhoto[] => names.map((name, index) => ({ name, url: demoPhotoUrl(name, index) }));

/** 一条问题记录（由日报「现场发现问题」自动生成；同一条日报只生成一次，A3-09）。 */
export type Issue = {
  id: string;
  /** 问题描述（取自来源日报） */
  title: string;
  state: IssueState;
  /** 问题归类（C9 字典十项；可多选 —— 多值按「、」连接，色签按分类分别着色） */
  category: string;
  /** 提出人（= 来源日报的提交人；Push 207 起并进「问题描述」列下的灰字小行展示） */
  reporter: string;
  /** 责任部门 · 责任人（按归类自动分派，空 = 待分派）；**Push 207 起列表 / 卡片不再展示**（字段随契约保留） */
  owner: string;
  /** 所属任务；**Push 207 起列表 / 卡片不再展示**（业务口径「所属任务也不需要」；字段随契约保留） */
  task: string;
  /** 提出日期（= 来源日报的填报日期） */
  raisedAt: string;
  /** 处理时限（问题处理时限 SLA，ADR-026）；**Push 207 起不再展示**（业务口径「处理时限不需要」） */
  dueAt: string;
  /** 解决方案 / 回复（处理中、已完成才有） */
  solution: string;
  /** 问题附图（Push 207 新增数据面）：来源日报「当前问题附图」提交时带入；空数组 = 「—」 */
  photos: readonly ReportPhoto[];
  /** 来源日报 id */
  reportId: string;
};

/** 演示数据最初的口径来源项目（示例项目：印度 `inmu-0010`；Push 206 续起演示数据不再按项目过滤）。 */
export const DEMO_REPORTS_PROJECT_ID = "inmu-0010";

/** 演示日报（新 → 旧）：2026年9月14日 ~ 2026年9月21日（8 天 9 篇），覆盖 已提交 / 补填 / 草稿 三种状态。 */
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
    photos: demoPhotos("滑槽磕碰-01.jpg", "滑槽磕碰-02.jpg"),
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
    photos: demoPhotos("联调记录-01.jpg"),
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
    photos: demoPhotos("机柜理线-01.jpg", "联调日志-01.jpg"),
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
    photos: demoPhotos("地面平整度-01.jpg"),
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
    photos: demoPhotos("工作站弹线-01.jpg"),
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
    photos: demoPhotos("1号巷道导轨-01.jpg", "安全培训-01.jpg"),
  },
  {
    id: "r-0916",
    date: "2026年9月16日",
    author: "石昀",
    submittedAt: "18:35",
    state: "已提交",
    headcount: 12,
    doneWork: "1 号巷道导轨进场验收完成 24 组；格口开口尺寸复核完成 6 处",
    plan: "开始 2 号巷道导轨安装，组织铜丝镶嵌工艺交底",
    foundIssue: "1 号巷道第 7 组导轨预埋件位置偏差约 12mm，安装基准需复核",
    issueCategory: "客观原因",
    suggestion: "建议联系土建复核预埋件，偏差处改用可调底座过渡",
    stages: ["硬件实施"],
    photos: demoPhotos("导轨进场验收-01.jpg", "格口开口复尺-01.jpg"),
  },
  {
    id: "r-0915",
    date: "2026年9月15日",
    author: "苏珩",
    submittedAt: "17:45",
    state: "已提交",
    headcount: 12,
    doneWork: "施工用电箱与照明布线完成；1 号巷道中心线放样完成并移交土建复核",
    plan: "1 号巷道导轨进场验收，配合铜丝镶嵌工艺交底",
    foundIssue: "现场无临时用电接驳点，配电箱需从 300 米外引入（电缆成本增加）",
    issueCategory: "客户原因",
    suggestion: "建议客户协调就近配电柜接驳，减少临时电缆敷设",
    stages: ["硬件实施"],
    photos: demoPhotos("临电布线-01.jpg"),
  },
  {
    id: "r-0914",
    date: "2026年9月14日",
    author: "程屿",
    submittedAt: "19:20",
    state: "已提交",
    headcount: 11,
    doneWork: "现场勘察与到货物料清点完成；施工围挡与安全标识布置完成",
    plan: "施工用电箱与照明布线，巷道中心线放样",
    foundIssue: "",
    issueCategory: "",
    suggestion: "",
    stages: ["硬件实施"],
    photos: demoPhotos("物料清点-01.jpg", "现场围挡-01.jpg"),
  },
];

/** 演示问题（新 → 旧）：三态覆盖（未解决 3 / 处理中 2 / 已完成 2）；部分带演示附图（问题追踪「问题附图」列出缩略图）。 */
const DEMO_ISSUES: Issue[] = [
  {
    id: "i-01",
    title: "格口滑槽入场运输磕碰，2 件滑槽面板需补件",
    state: "未解决",
    category: "供应商原因",
    reporter: "卢青",
    owner: "",
    task: "到货入库",
    raisedAt: "2026年9月21日",
    dueAt: "2026年9月23日",
    solution: "",
    photos: demoPhotos("滑槽磕碰-01.jpg", "滑槽磕碰-02.jpg"),
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
    photos: [],
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
    photos: demoPhotos("对射支架-01.jpg"),
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
    photos: [],
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
    photos: demoPhotos("稳压器-01.jpg"),
    reportId: "r-0917",
  },
  {
    id: "i-06",
    title: "1 号巷道第 7 组导轨预埋件位置偏差约 12mm，安装基准需复核",
    state: "未解决",
    category: "客观原因",
    reporter: "石昀",
    owner: "项目部 · 秦朗",
    task: "巷道导轨安装，铜丝镶嵌",
    raisedAt: "2026年9月16日",
    dueAt: "2026年9月19日",
    solution: "",
    photos: [],
    reportId: "r-0916",
  },
  {
    id: "i-07",
    title: "现场无临时用电接驳点，配电箱需从 300 米外引入（电缆成本增加）",
    state: "已完成",
    category: "客户原因",
    reporter: "苏珩",
    owner: "项目部 · 秦朗",
    task: "现场勘察与临电布置",
    raisedAt: "2026年9月15日",
    dueAt: "2026年9月17日",
    solution: "客户已协调就近配电柜接驳，9月17日复测电压稳定，提出人确认关闭",
    photos: demoPhotos("临电接驳-01.jpg"),
    reportId: "r-0915",
  },
];

/** 取某个项目的日报（数组本身已按新 → 旧排好）。Push 206 续（业务口径「写点静态数据到日报的一系列记录里面去」）：
 *  演示数据不再按项目过滤 —— 不管打开哪个项目，日报记录都带这一串静态数据；接入 report-issue 模块后按 projectId 走接口。 */
export function reportsForProject(_projectId: string): DailyReport[] {
  return DEMO_REPORTS;
}

/** 取某个项目的问题记录。Push 206 续：同日报 —— 演示数据不再按项目过滤（问题追踪 / 问题看板都带这一串静态数据）。 */
export function issuesForProject(_projectId: string): Issue[] {
  return DEMO_ISSUES;
}
