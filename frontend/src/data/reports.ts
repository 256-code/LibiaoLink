/**
 * 日报与问题界面模型（Push 216 接真）：字段口径 = 契约 shared/src/modules/reports.ts / issues.ts（Push 215 修订批）。
 * - 状态：日报 draft 草稿 / submitted 已提交 / supplement 补填（补填由服务端按日期推导）；
 *   问题三态 open 未解决 / in_progress 处理中 / done 已完成（允许回退且留痕）。
 * - 关联阶段：stageNames（九阶段展示名数组；写面在 reportApi 映射回 stageKeys）。
 * - 附图：ReportPhoto = fileId（文件库 id，预览经预览接口换短时签名）+ name；
 *   刚粘贴 / 选择的图在会话内带本地 blob 预览地址（url），上传中 / 失败在 pending 上表达。
 * - Push 215 口径：草稿写库、同日多条（原「一人一天一条」唯一约束删除）；处理时限 dueAt 删除；
 *   演示数据与内存写回（原 reportsForProject / issuesForProject / DEMO_*）随本批整体下线。
 */

/** 日报状态（A3-02 · 契约值）。 */
export type ReportState = "draft" | "submitted" | "supplement";

/** 问题三态（A3-10 · 契约值；Push 207 业务口径「取消未分组」→ Push 215 契约落地）。问题看板的列顺序就按这个数组走。 */
export const ISSUE_STATES = ["open", "in_progress", "done"] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

/** 一份附图（file_links 引用；url = 本地预览（刚贴的图），pending = 上传中 / 失败）。 */
export type ReportPhoto = {
  fileId: string;
  name: string;
  url: string | null;
  pending?: "uploading" | "failed";
};

/** 一条日报（A3-01 表单字段 + 系统字段；字段口径见契约 DailyReport）。 */
export type DailyReport = {
  id: string;
  /** 填报日期（YYYY-MM-DD） */
  date: string;
  /** 提交人显示名 */
  author: string;
  /** 提交时间（ISO；草稿为空） */
  submittedAt: string | null;
  state: ReportState;
  /** 今日施工人数（未填为空） */
  headcount: number | null;
  /** 当日完成工作（A3-04 必填） */
  doneWork: string;
  /** 明日计划 */
  plan: string;
  /** 现场发现问题（非空 = 服务端已自动生成问题记录，A3-09） */
  foundIssue: string;
  /** 问题归类（C9 十项多值；「现场发现问题」非空时 ≥1 项） */
  issueCategories: string[];
  /** 解决方案或建议 */
  suggestion: string;
  /** 关联阶段（九阶段展示名数组；写面映射 stageKeys） */
  stageNames: string[];
  /** 现场工作附图（file_links(object_type=report, kind=onsite)） */
  photos: ReportPhoto[];
  /** 当前问题附图（提交生成问题时转挂到问题侧，转挂后此处为空） */
  issuePhotos: ReportPhoto[];
  /** 乐观锁版本（写回传）。 */
  version: number;
};

/** 一条问题（由日报「现场发现问题」自动生成；A3-09 ~ A3-13）。 */
export type Issue = {
  id: string;
  /** 问题描述（自动生成 = 日报「现场发现问题」原文） */
  title: string;
  state: IssueState;
  /** 问题归类（C9 十项多值） */
  categories: string[];
  /** 提出人（= 来源日报的提交人） */
  reporter: string;
  /** 提出日期（YYYY-MM-DD） */
  raisedAt: string;
  /** 解决方案 / 回复（处理中、已完成才有） */
  solution: string;
  /** 问题附图（file_links(object_type=issue)） */
  photos: ReportPhoto[];
  /** 来源日报 id（空 = 无来源日报） */
  reportId: string;
  /** 乐观锁版本（写回传）。 */
  version: number;
};
