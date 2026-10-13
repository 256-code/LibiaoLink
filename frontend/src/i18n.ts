import { useCallback, useSyncExternalStore } from "react";
import { saveLocale } from "./preferencesApi";
import type { BackgroundTier } from "./backgroundTier";
import { cachedZhToEn, getTranslationRevision, subscribeTranslations } from "./translateApi";
import { projectStatusText } from "./types";

/**
 * 系统语言切换（业务口径 2026-10-13「现在我要做系统语言切换 暂时中英文」+「在这个左侧添加按钮」）：
 * 顶栏「背景」胶囊左侧新增「语言 · 中文 / Language · English」胶囊 + 弹层（中文 / English 两项、
 * 选中打点；位置与材质跟背景胶囊同排同款）。暂时只有 zh / en —— 加语言 = LOCALES 增一项 + 词典补一列。
 *
 * 选中态挂模块级 store（同 backgroundTier 的 useSyncExternalStore 口径：顶栏每页都渲染，切页不丢选择），
 * 并同步 <html lang>（zh-CN / en）。点选即单键 PATCH `user_preferences.prefs.locale` 按账号落库
 * （Push 296 追订 · 业务口径「按账号记住 刷新不会回中文」；与背景档位 Push 291 同一条偏好通道；登录后由偏好加载静默落位）。
 *
 * 翻译范围：本刀先落**壳层** —— 顶栏导航（TopNav）+ 顶栏两个胶囊 / 弹层 + 账号菜单；页面主体
 * （项目空间 / 项目总览 / 甘特图 / 工作台 / 日报及问题 …）按页分刀推进。词典 =「中文键表 + 英文全量覆盖」
 * 两列（EN_TEXTS 类型 = Record<TextKey, string>，漏翻会在类型层报错）。
 */
export type Locale = "zh" | "en";

/** 语言选项（label = 该语言的原生名称，不随界面语言翻译 —— 便于误切后找回中文）。 */
export const LOCALES: Array<{ key: Locale; label: string }> = [
  { key: "zh", label: "中文" },
  { key: "en", label: "English" },
];

let currentLocale: Locale = "zh";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 运行期兜底（坏值 / 未支持的语言）：白名单外一律落默认 zh。 */
export function asLocale(value: unknown): Locale {
  return value === "en" ? "en" : "zh";
}

export function getLocale(): Locale {
  return currentLocale;
}

function applyHtmlLang(locale: Locale): void {
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
}

function setLocaleInternal(next: Locale): void {
  applyHtmlLang(next);
  if (next === currentLocale) {
    return;
  }
  currentLocale = next;
  listeners.forEach((listener) => {
    listener();
  });
}

/** 登录后由偏好加载静默落位（App.tsx；与 backgroundTier 同套入口 —— 只改本地观感、不落库）。 */
export function applyLocale(next: unknown): void {
  setLocaleInternal(asLocale(next));
}

/**
 * 用户点选语言（顶栏「语言 · …」胶囊）：Push 296 追订（业务口径「按账号记住 刷新不会回中文」）起按账号落库 ——
 * 乐观落位 + 单键 PATCH `user_preferences.prefs.locale`（与背景档位 Push 291 同一条偏好通道，跨设备同账号可见）。
 * 成功 = 以服务端收敛值落位；失败 = 若期间没再切换则回滚到点选前的语言、返回文案给顶栏 Toast（界面不能停在假状态）。
 */
export async function selectLocale(next: Locale): Promise<string | null> {
  const previous = currentLocale;
  if (next === previous) {
    return null;
  }
  setLocaleInternal(next);
  try {
    const prefs = await saveLocale(next);
    // 服务端未回该键（服务端仍是旧构建的混布窗口）时保持乐观值，不被 undefined 冲回 zh
    if (currentLocale === next && typeof prefs.locale === "string") {
      setLocaleInternal(asLocale(prefs.locale));
    }
    return null;
  } catch {
    if (currentLocale === next) {
      setLocaleInternal(previous);
    }
    return "语言保存失败";
  }
}

/** 订阅当前语言（顶栏胶囊选中态与壳层文案的唯一来源）。 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

/** 词典：中文为准（键表），英文全量覆盖。 */
const ZH_TEXTS = {
  "nav.aria": "全局导航",
  "nav.hub": "蓝图",
  "nav.projects": "项目空间",
  "nav.templates": "任务模板",
  "nav.workspace": "我的任务",
  "header.brand.subtitle": "立镖全链路信息平台",
  "header.up": "返回上一层级",
  "header.seqNo": "序号",
  "header.createdAt": "创建于",
  "header.bg.title": "背景档位",
  "header.bg.label": "背景",
  "bg.tier.simple": "简约",
  "bg.tier.medium": "适中",
  "bg.tier.vivid": "炫彩",
  "header.bg.watermark": "水印",
  "header.lang.title": "语言",
  "header.lang.label": "语言",
  "header.account": "账号菜单",
  "header.unnamed": "未署名用户",
  "header.logout": "退出登录",
  "header.audit": "操作记录",
  "header.files": "文件库",
  "home.sort.groupAria": "按创建时间排序（降序 / 升序）",
  "home.sort.field": "创建时间",
  "home.sort.desc": "降序",
  "home.sort.asc": "升序",
  "home.sort.descAria": "按创建时间降序排列",
  "home.sort.descTitle": "按创建时间降序排列（新的在前）——项目创建的那一刻，此后不再变化",
  "home.sort.ascAria": "按创建时间升序排列",
  "home.sort.ascTitle": "按创建时间升序排列（旧的在前）——项目创建的那一刻，此后不再变化",
  "home.count.total": "共 {n} 个项目",
  "home.count.found": "找到 {n} 个项目",
  "home.create": "新建项目",
  "home.noCreatePermission": "当前账号没有建项目权限，请联系管理员分配角色。",
  "home.retry": "重试",
  "home.loading": "正在加载项目…",
  "home.empty.filtered": "没有符合筛选条件的项目",
  "home.empty.keyword": "没有匹配「{kw}」的项目",
  "home.clearSearch": "清空搜索",
  "home.clearFilters": "清空筛选",
  "home.shown": "已显示前 {shown} 条，共 {total} 条（一期列表一次最多 200 条）。",
  "home.token.title": "令牌声明（id_token，已通过 JWKS 验签）",
  "home.token.expires": "令牌到期时间：{time}",
  "home.openAria": "打开项目 {code}",
  "home.deleteFilter.pre": "删除常用筛选「",
  "home.deleteFilter.post": "」？只删这一组保存的条件，项目数据不受影响。",
  "home.cancel": "取消",
  "home.delete": "删除",
  "home.search.placeholder": "搜索名称、国家、时间或项目经理",
  "search.default.placeholder": "搜索项目名称或国家",
  "card.manager": "项目经理：",
  "card.seqNo": "项目序号",
  "card.edit": "编辑项目",
  "card.delete": "删除项目",
  "filter.switch": "分类筛选",
  "filter.aria": "分类筛选",
  "filter.scrollAria": "筛选条件",
  "filter.saved": "常用筛选",
  "filter.quickAdd": "一键添加",
  "filter.add": "+ 添加",
  "filter.limitTitle": "最多保存 {n} 组常用筛选",
  "filter.quickAddTitle": "一键把当前筛选条件存成一组（当前筛选不变），起个名字即可",
  "filter.addTitle": "把常看的分类勾成一组，命名保存",
  "filter.compose.new": "新建常用筛选",
  "filter.compose.edit": "编辑常用筛选",
  "filter.compose.prefilled": "已带入当前筛选条件（可在下方分类里继续增减），起个名字保存即可 —— 保存后即出现在「常用筛选」并立即生效。",
  "filter.compose.blank": "在下方分类里勾选多项（可跨组），名称可自定义；保存后即出现在「常用筛选」并立即生效。",
  "filter.name.placeholder": "筛选名称（自定义，如：我关注的项目）",
  "filter.name.aria": "常用筛选名称",
  "filter.draft.count": "已选 {n} 项",
  "filter.draft.needOne": "（至少选 1 项）",
  "filter.cancel": "取消",
  "filter.save": "保存",
  "filter.empty.quickAdd": "还没有常用筛选 —— 点「一键添加」，把当前筛选条件起个名字保存。",
  "filter.empty.add": "还没有常用筛选 —— 点「添加」，勾选常看的分类、起个名字保存。",
  "filter.applyTitle": "应用「{name}」（命中 {n} 个项目）",
  "filter.editTitle": "编辑 / 改名",
  "filter.deleteTitle": "删除",
  "filter.editAria": "编辑常用筛选 {name}",
  "filter.deleteAria": "删除常用筛选 {name}",
  "filter.region": "地区",
  "filter.collapseAll": "全部收起",
  "filter.expandAll": "全部展开",
  "filter.regionCount": "{n} 个地区",
  "filter.picked": "已选 {n}",
  "filter.continent.checkAll": "筛选整个{name}",
  "filter.continent.uncheckAll": "取消筛选整个{name}",
  "filter.continent.checkAllCount": "筛选整个{name}（{n} 个地区）",
  "filter.types": "项目类型",
  "filter.managers": "项目经理",
  "filter.statuses": "项目状态",
  "filter.status.note": "项目状态是当前列表的即时筛选，不保存进常用筛选。",
  "filter.time": "项目时间",
  "filter.time.aria": "项目时间口径：按项目创建时间筛选",
  "filter.time.title": "按项目创建时间筛选（与卡片上的创建时间同一口径）。",
  "filter.footer.none": "未选择筛选条件",
  "filter.footer.count": "已选 {n} 项",
  "filter.footer.compose": "常用筛选编辑中：已勾选 {n} 项",
  "filter.reset": "重置",
  "board.allExpand": "全部展开",
  "board.allCollapse": "一键收起",
  "board.allExpandStages": "展开全部阶段",
  "board.allCollapseStages": "收起全部阶段",
  "board.stage.expand": "展开这个阶段",
  "board.stage.collapse": "折叠这个阶段",
  "board.temp.addAria": "添加任务：临时任务",
  "board.temp.createTitle": "新建临时任务（没有模板，自己填名称）",
  "board.stage.done": "已完成 {done}/{total}",
  "board.stage.openCard": "打开右侧卡片：这个阶段的任务节点 + 模板（预览 / 添加到项目）",
  "board.stage.empty": "暂无任务",
  "kanban.drag.title": "按住拖到别的列 = 移到那个组（负责人 / 状态跟着改）；拖动中滚轮翻卡片、Shift + 滚轮翻列；点一下看任务详情",
  "drawer.overdue": "已超过预计完成日期（{date}），当前仍未完成。",
  "gantt.unscheduled": "未排期",
  "continent.asia": "亚洲",
  "continent.europe": "欧洲",
  "continent.africa": "非洲",
  "continent.northAmerica": "北美洲",
  "continent.southAmerica": "南美洲",
  "continent.oceania": "大洋洲",
  "continent.other": "其他",
  "common.cancel": "取消",
  "common.delete": "删除",
  "common.reload": "重新加载",
  "common.loading": "加载中…",
  "report.submit": "提交日报",
  "report.submitting": "提交中…",
  "report.saveDraft": "暂存草稿",
  "report.form.footer": "填写完成后提交；提交后可在「日报记录」里看到这一篇。",
  "report.form.missing": "还差：{list}",
  "report.missing.time": "时间",
  "report.missing.doneWork": "当日完成工作",
  "report.missing.plan": "明日计划",
  "report.missing.issueTitle": "问题 {n} 的问题描述",
  "report.missing.issueCategory": "问题 {n} 的问题归类",
  "report.hint.stages": "可多选；标记「当日完成工作」对应的项目阶段",
  "report.hint.issues": "填写的问题提交后按条生成独立问题记录（未解决）",
  "report.addIssue": "+ 添加问题",
  "report.issueNo": "问题 {n}",
  "report.required": "必填",
  "report.optional.clear": "可选 · 留空 = 清空",
  "report.records.title": "日报记录",
  "report.records.hint": "共 {n} 篇 · 按日期倒序（新 → 旧）；填写的问题提交后按条生成问题记录",
  "report.records.hintFound": "找到 {found} 篇 · 共 {total} 篇 · 按日期倒序（新 → 旧）",
  "report.records.search": "搜索日期、填写者、阶段或日报内容",
  "report.records.empty": "还没有日报。",
  "report.records.emptyHint": "到「日报填写」填一篇并提交，这里就会出现。",
  "report.records.emptyMatch": "没有匹配「{kw}」的日报。",
  "report.issues.title": "问题追踪",
  "report.issues.hint": "共 {n} 条 · 由日报填写的问题逐条生成，按提出日期倒序",
  "report.issues.hintFound": "找到 {found} 条 · 共 {total} 条 · 按提出日期倒序",
  "report.issues.search": "搜索日期、问题描述、归类或解决方案",
  "report.issues.empty": "还没有问题记录。",
  "report.issues.emptyHint": "日报里填了问题并提交，这里就会按条落问题记录。",
  "report.issues.emptyMatch": "没有匹配「{kw}」的问题。",
  "report.emptyHint": "换个关键词试试，或点搜索框右侧的 × 清空。",
  "report.board.title": "问题看板",
  "report.board.hint": "三态：未解决 → 处理中 → 已完成（空列保留；按住卡片拖到别的列 = 改状态）",
  "report.board.count": "{n} 项",
  "report.board.none": "暂无问题",
  "report.board.dropTo": "放开：移到「{state}」",
  "report.loading.hint": "正在从服务端取该项目的日报与问题记录。",
  "report.error.load": "日报 / 问题加载失败。",
  "report.error.reportSave": "日报修改失败。",
  "report.error.issueSave": "问题修改失败。",
  "report.error.reportDelete": "日报删除失败。",
  "report.error.issueDelete": "问题删除失败。",
  "report.error.submit": "日报提交失败。",
  "report.error.draft": "草稿暂存失败。",
  "report.modal.report.title": "编辑日报",
  "report.modal.report.hint": "{date} · {author} —— 只提交改动过的字段；清空「明日计划」= 删除该字段内容。",
  "report.modal.issue.title": "编辑问题",
  "report.modal.issue.hint": "{date} · {reporter} 提出 —— 只提交改动过的字段。",
  "report.modal.submit": "保存修改",
  "report.modal.saving": "保存中…",
  "report.members.footer": "共 {n} 人 · 按姓名 / 拼音搜索",
  "report.drawer.tag": "问题详情",
  "report.drawer.footer": "来源日报：{id}；点空白处或按 Esc 关闭",
  "report.drawer.reportMissing": "未找到（原型内存态可能已复位）",
  "report.drawer.raised": "{date} · {reporter} 提出",
  "report.placeholder.date": "选择日期",
  "report.placeholder.headcount": "如 12",
  "report.placeholder.doneWork": "填写当日完成的工作",
  "report.placeholder.doneWorkSave": "填写当日完成的工作，点「保存」生效",
  "report.placeholder.plan": "填写明日计划（可选）",
  "report.placeholder.planSave": "填写明日计划，点「保存」生效",
  "report.placeholder.issueTitle": "如：液压泵渗油",
  "report.placeholder.issueTitleEdit": "修改问题描述",
  "report.placeholder.issueTitleSave": "修改问题描述，点「保存」生效",
  "report.placeholder.issueCategory": "请选择问题归类（可多选）",
  "report.placeholder.issueSuggestion": "如：建议由采购联系供应商走补件流程",
  "report.placeholder.issueSuggestionEdit": "补充解决方案或建议（可选）",
  "report.placeholder.issueSuggestionSave": "补充解决方案或建议，点「保存」生效",
  "report.notice.doneRequired": "「当日完成工作」不能为空。",
  "report.notice.titleRequired": "「问题描述」不能为空。",
  "report.notice.categoryRequired": "「问题归类」至少保留一项。",
  "report.notice.reportDeleted": "已删除该日报；它派生的全部问题随日报一起删除。",
  "report.notice.issueDeleted": "已删除该问题。",
  "report.notice.issueDeletedWithReport": "已删除该问题；来源日报随问题一起删除。",
  "report.notice.draftNeedsDone": "暂存草稿也需要先填「当日完成工作」。",
  "report.notice.draftSaved": "已暂存：草稿已写入「日报记录」（可继续修改，点「提交日报」后生效）。",
  "report.notice.submitted": "已提交 {date} 的日报",
  "report.notice.submittedIssues": "；填写的 {n} 条问题已各自生成独立问题记录（未解决），见「问题追踪」/ 「问题看板」。",
  "report.delete.report": "删除日报（{date}）？它派生的全部问题会随这篇日报一起删除，删除后不可恢复。",
  "report.delete.issueAlone": "删除问题（{date}）？这条问题没有来源日报，只删它这一条，删除后不可恢复。",
  "report.delete.issueWithReport": "删除问题（{date}）？它来源的那篇日报会随这条问题一起删除，删除后不可恢复。",
  "report.delete.ariaReport": "确认删除日报",
  "report.delete.ariaIssue": "确认删除问题",
  "report.row.editReport": "编辑日报（{date}）",
  "report.row.deleteReport": "删除日报（{date}）—— 会连同这篇日报派生的问题一起删除",
  "report.row.editIssue": "编辑问题（{date}）",
  "report.row.deleteIssue": "删除问题（{date}）—— 会连同来源日报一起删除",
  "photo.uploading": "上传中…",
  "photo.failed": "上传失败",
  "report.issue.reporter": "提出人：{name}",
  "report.notice.submittedEnd": "。",
  "report.ownerHint": "不指定具体处理人",
  "common.retry": "重试",
  "project.notFound": "未找到该项目，可能已被删除。",
  "project.back": "返回项目列表",
  "project.dataErrorPre": "任务数据加载失败：",
  "project.loadingTasks": "正在加载任务数据…",
  "project.deleteTaskAria": "确认删除任务",
  "project.deleteTaskPre": "删除任务「",
  "project.deleteTaskPost": "」？删除后这一行从项目里移除；有变更记录引用的任务会被拦下。",
  "export.aria": "导出项目总览数据（PDF）",
  "export.pdf": "导出 PDF",
  "export.busy": "生成中…",
  "picker.filter": "筛选",
  "picker.fields": "表格显示字段",
  "picker.reset": "重置",
  "picker.locked": "常显",
  "photo.removeTitle": "移除这张图",
  "photo.renameTitle": "点名字可自定义",
  "photo.removeConfirm": "移除图片「{name}」？",
  "photo.remove": "移除",
  "report.uploadPending": "还有图片在上传中，请等上传完成后再提交。",
  "report.uploadFailed": "有图片上传失败，请先移除失败图片（或重新粘贴）再提交。",
} as const;

export type TextKey = keyof typeof ZH_TEXTS;

const EN_TEXTS: Record<TextKey, string> = {
  "nav.aria": "Global navigation",
  "nav.hub": "Blueprint",
  "nav.projects": "Project Space",
  "nav.templates": "Task Templates",
  "nav.workspace": "My Tasks",
  "header.brand.subtitle": "Libiao Full-chain Information Platform",
  "header.up": "Back to the previous level",
  "header.seqNo": "No.",
  "header.createdAt": "Created",
  "header.bg.title": "Background tier",
  "header.bg.label": "Background",
  "bg.tier.simple": "Simple",
  "bg.tier.medium": "Medium",
  "bg.tier.vivid": "Vivid",
  "header.bg.watermark": "Watermark",
  "header.lang.title": "Language",
  "header.lang.label": "Language",
  "header.account": "Account menu",
  "header.unnamed": "Unnamed user",
  "header.logout": "Sign out",
  "header.audit": "Activity log",
  "header.files": "File library",
  "home.sort.groupAria": "Sort by created time (descending / ascending)",
  "home.sort.field": "Created",
  "home.sort.desc": "Descending",
  "home.sort.asc": "Ascending",
  "home.sort.descAria": "Sort by created time, descending",
  "home.sort.descTitle": "Sort by created time, descending (newest first) — set at creation, never changes",
  "home.sort.ascAria": "Sort by created time, ascending",
  "home.sort.ascTitle": "Sort by created time, ascending (oldest first) — set at creation, never changes",
  "home.count.total": "{n} projects",
  "home.count.found": "{n} projects found",
  "home.create": "New project",
  "home.noCreatePermission": "This account cannot create projects. Ask an administrator to assign a role.",
  "home.retry": "Retry",
  "home.loading": "Loading projects…",
  "home.empty.filtered": "No projects match the current filters",
  "home.empty.keyword": "No projects match “{kw}”",
  "home.clearSearch": "Clear search",
  "home.clearFilters": "Clear filters",
  "home.shown": "Showing first {shown} of {total} (up to 200 per load in phase 1).",
  "home.token.title": "Token claims (id_token, verified via JWKS)",
  "home.token.expires": "Token expires: {time}",
  "home.openAria": "Open project {code}",
  "home.deleteFilter.pre": "Delete saved filter “",
  "home.deleteFilter.post": "”? Only this saved set is removed; project data is unaffected.",
  "home.cancel": "Cancel",
  "home.delete": "Delete",
  "home.search.placeholder": "Search name, country, date or manager",
  "search.default.placeholder": "Search project name or country",
  "card.manager": "Manager: ",
  "card.seqNo": "Project No.",
  "card.edit": "Edit project",
  "card.delete": "Delete project",
  "filter.switch": "Filters",
  "filter.aria": "Category filters",
  "filter.scrollAria": "Filter conditions",
  "filter.saved": "Saved filters",
  "filter.quickAdd": "Quick add",
  "filter.add": "+ Add",
  "filter.limitTitle": "Up to {n} saved filters",
  "filter.quickAddTitle": "Save the current filters as a set (current view unchanged) — just name it",
  "filter.addTitle": "Tick the categories you watch and save them as a named set",
  "filter.compose.new": "New saved filter",
  "filter.compose.edit": "Edit saved filter",
  "filter.compose.prefilled": "Current filters are pre-filled (adjust below if needed); name it and save — it appears under Saved filters and takes effect immediately.",
  "filter.compose.blank": "Tick items below (across groups) and name the set; it appears under Saved filters and takes effect immediately.",
  "filter.name.placeholder": "Filter name (e.g. Projects I follow)",
  "filter.name.aria": "Saved filter name",
  "filter.draft.count": "{n} selected",
  "filter.draft.needOne": " (pick at least 1)",
  "filter.cancel": "Cancel",
  "filter.save": "Save",
  "filter.empty.quickAdd": "No saved filters yet — hit Quick add, name the current filters and save.",
  "filter.empty.add": "No saved filters yet — hit Add, tick the categories you watch and save with a name.",
  "filter.applyTitle": "Apply “{name}” ({n} projects)",
  "filter.editTitle": "Edit / rename",
  "filter.deleteTitle": "Delete",
  "filter.editAria": "Edit saved filter {name}",
  "filter.deleteAria": "Delete saved filter {name}",
  "filter.region": "Region",
  "filter.collapseAll": "Collapse all",
  "filter.expandAll": "Expand all",
  "filter.regionCount": "{n} regions",
  "filter.picked": "{n} selected",
  "filter.continent.checkAll": "Select all of {name}",
  "filter.continent.uncheckAll": "Clear all of {name}",
  "filter.continent.checkAllCount": "Select all of {name} ({n} regions)",
  "filter.types": "Project type",
  "filter.managers": "Project manager",
  "filter.statuses": "Status",
  "filter.status.note": "Status filters the current list only; it is not saved into saved filters.",
  "filter.time": "Project time",
  "filter.time.aria": "Project time: filter by project creation time",
  "filter.time.title": "Filter by project creation time (same basis as the time shown on cards).",
  "filter.footer.none": "No filters selected",
  "filter.footer.count": "{n} selected",
  "filter.footer.compose": "Editing saved filter: {n} ticked",
  "filter.reset": "Reset",
  "board.allExpand": "Expand all",
  "board.allCollapse": "Collapse all",
  "board.allExpandStages": "Expand all stages",
  "board.allCollapseStages": "Collapse all stages",
  "board.stage.expand": "Expand this stage",
  "board.stage.collapse": "Collapse this stage",
  "board.temp.addAria": "Add task: Temp Task",
  "board.temp.createTitle": "New temp task (no template — name it yourself)",
  "board.stage.done": "{done}/{total} done",
  "board.stage.openCard": "Open the side panel: stage nodes + templates (preview / add to project)",
  "board.stage.empty": "No tasks",
  "kanban.drag.title": "Hold and drag to another column to move the task (owner / status follows); wheel scrolls cards, Shift + wheel scrolls columns; click to open details",
  "drawer.overdue": "Past the due date ({date}); not completed yet.",
  "gantt.unscheduled": "Unscheduled",
  "continent.asia": "Asia",
  "continent.europe": "Europe",
  "continent.africa": "Africa",
  "continent.northAmerica": "North America",
  "continent.southAmerica": "South America",
  "continent.oceania": "Oceania",
  "continent.other": "Other",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.reload": "Reload",
  "common.loading": "Loading…",
  "report.submit": "Submit report",
  "report.submitting": "Submitting…",
  "report.saveDraft": "Save draft",
  "report.form.footer": "Submit when complete — the entry will appear under “Daily reports”.",
  "report.form.missing": "Missing: {list}",
  "report.missing.time": "Time",
  "report.missing.doneWork": "Work completed today",
  "report.missing.plan": "Tomorrow’s plan",
  "report.missing.issueTitle": "Issue {n} description",
  "report.missing.issueCategory": "Issue {n} category",
  "report.hint.stages": "Multi-select; tag the project stages covered by today’s work",
  "report.hint.issues": "Each issue becomes its own record (Open) after submit",
  "report.addIssue": "+ Add issue",
  "report.issueNo": "Issue {n}",
  "report.required": "Required",
  "report.optional.clear": "Optional · empty to clear",
  "report.records.title": "Daily reports",
  "report.records.hint": "{n} entries · newest first; submitted issues become issue records",
  "report.records.hintFound": "{found} of {total} · newest first",
  "report.records.search": "Search date, author, stage or content",
  "report.records.empty": "No daily reports yet.",
  "report.records.emptyHint": "Fill one in under “New report” and submit; it will appear here.",
  "report.records.emptyMatch": "No reports match “{kw}”.",
  "report.issues.title": "Issue tracking",
  "report.issues.hint": "{n} issues · generated from daily reports, newest first",
  "report.issues.hintFound": "{found} of {total} · newest first",
  "report.issues.search": "Search date, issue, category or solution",
  "report.issues.empty": "No issue records yet.",
  "report.issues.emptyHint": "Issues reported in a daily report will show up here.",
  "report.issues.emptyMatch": "No issues match “{kw}”.",
  "report.emptyHint": "Try another keyword, or click × to clear.",
  "report.board.title": "Issue board",
  "report.board.hint": "Three states: Open → In progress → Done (empty columns stay; drag a card to another column to change its state)",
  "report.board.count": "{n} items",
  "report.board.none": "No issues",
  "report.board.dropTo": "Release to move to “{state}”",
  "report.loading.hint": "Loading this project’s reports and issues.",
  "report.error.load": "Failed to load reports / issues.",
  "report.error.reportSave": "Failed to save the report.",
  "report.error.issueSave": "Failed to save the issue.",
  "report.error.reportDelete": "Failed to delete the report.",
  "report.error.issueDelete": "Failed to delete the issue.",
  "report.error.submit": "Failed to submit the report.",
  "report.error.draft": "Failed to save the draft.",
  "report.modal.report.title": "Edit report",
  "report.modal.report.hint": "{date} · {author} — only changed fields are submitted; clearing “Tomorrow’s plan” removes its content.",
  "report.modal.issue.title": "Edit issue",
  "report.modal.issue.hint": "Raised by {reporter} on {date} — only changed fields are submitted.",
  "report.modal.submit": "Save changes",
  "report.modal.saving": "Saving…",
  "report.members.footer": "{n} members · search by name / pinyin",
  "report.drawer.tag": "Issue details",
  "report.drawer.footer": "Source report: {id}; click outside or press Esc to close",
  "report.drawer.reportMissing": "Not found (in-memory state may have been reset)",
  "report.drawer.raised": "{date} · raised by {reporter}",
  "report.placeholder.date": "Pick a date",
  "report.placeholder.headcount": "e.g. 12",
  "report.placeholder.doneWork": "What was completed today",
  "report.placeholder.doneWorkSave": "Edit today’s work, then click “Save”",
  "report.placeholder.plan": "Tomorrow’s plan (optional)",
  "report.placeholder.planSave": "Edit tomorrow’s plan, then click “Save”",
  "report.placeholder.issueTitle": "e.g. hydraulic pump oil leak",
  "report.placeholder.issueTitleEdit": "Edit the issue description, then click “Save”",
  "report.placeholder.issueTitleSave": "Edit the issue description, then click “Save”",
  "report.placeholder.issueCategory": "Pick categories (multi-select)",
  "report.placeholder.issueSuggestion": "e.g. procurement to contact the supplier for replacement parts",
  "report.placeholder.issueSuggestionEdit": "Add a solution or suggestion (optional)",
  "report.placeholder.issueSuggestionSave": "Edit the solution, then click “Save”",
  "report.notice.doneRequired": "“Work completed today” is required.",
  "report.notice.titleRequired": "“Issue description” is required.",
  "report.notice.categoryRequired": "Keep at least one category.",
  "report.notice.reportDeleted": "Report deleted; its issues were deleted too.",
  "report.notice.issueDeleted": "Issue deleted.",
  "report.notice.issueDeletedWithReport": "Issue deleted; its source report was removed too.",
  "report.notice.draftNeedsDone": "Fill “Work completed today” before saving a draft.",
  "report.notice.draftSaved": "Draft saved to “Daily reports” — keep editing and click “Submit report” to apply.",
  "report.notice.submitted": "Submitted the report of {date}",
  "report.notice.submittedIssues": "; {n} reported issues were created (Open) — see “Issue tracking” / “Issue board”.",
  "report.delete.report": "Delete the report of {date}? Its issues will be deleted along with it; this cannot be undone.",
  "report.delete.issueAlone": "Delete the issue of {date}? It has no source report; only this issue is deleted, and this cannot be undone.",
  "report.delete.issueWithReport": "Delete the issue of {date}? Its source report will be deleted along with it; this cannot be undone.",
  "report.delete.ariaReport": "Confirm deleting the report",
  "report.delete.ariaIssue": "Confirm deleting the issue",
  "report.row.editReport": "Edit report ({date})",
  "report.row.deleteReport": "Delete report ({date}) — its issues will be deleted too",
  "report.row.editIssue": "Edit issue ({date})",
  "report.row.deleteIssue": "Delete issue ({date}) — its source report will be deleted too",
  "photo.uploading": "Uploading…",
  "photo.failed": "Upload failed",
  "report.issue.reporter": "Reported by {name}",
  "report.notice.submittedEnd": ".",
  "report.ownerHint": "No specific assignee",
  "common.retry": "Retry",
  "project.notFound": "Project not found — it may have been deleted.",
  "project.back": "Back to projects",
  "project.dataErrorPre": "Failed to load task data: ",
  "project.loadingTasks": "Loading task data…",
  "project.deleteTaskAria": "Confirm deleting the task",
  "project.deleteTaskPre": "Delete task “",
  "project.deleteTaskPost": "”? The row will be removed from the project; tasks referenced by change records will be blocked.",
  "export.aria": "Export the project overview (PDF)",
  "export.pdf": "Export PDF",
  "export.busy": "Generating…",
  "picker.filter": "Columns",
  "picker.fields": "Table columns",
  "picker.reset": "Reset",
  "picker.locked": "Always shown",
  "photo.removeTitle": "Remove this photo",
  "photo.renameTitle": "Click the name to rename",
  "photo.removeConfirm": "Remove “{name}”?",
  "photo.remove": "Remove",
  "report.uploadPending": "Images are still uploading — wait for them to finish before submitting.",
  "report.uploadFailed": "Some images failed to upload — remove or re-paste them before submitting.",
};

/** 背景档位名 → 词典键（顶栏胶囊 / 弹层共用；档位枚举仍在 backgroundTier）。 */
export const BG_TIER_TEXT_KEYS: Record<BackgroundTier, TextKey> = {
  simple: "bg.tier.simple",
  medium: "bg.tier.medium",
  vivid: "bg.tier.vivid",
};

/** 取词（可带 {name} 占位参数：t("home.count.total", { n: 3 })）。 */
export function textOf(locale: Locale, key: TextKey, params?: Record<string, string | number>): string {
  const template = locale === "en" ? EN_TEXTS[key] : ZH_TEXTS[key];
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 取当前语言的取词函数（`const t = useT()` 后 `t("nav.hub")`）。 */
export function useT(): (key: TextKey, params?: Record<string, string | number>) => string {
  const locale = useLocale();
  return (key, params) => textOf(locale, key, params);
}

/**
 * 「手打内容」机翻显示（业务口径 2026-10-13「因为页面有些内容是手打的 我建议是提前后台机翻」）：
 * 英文界面下把手打内容（项目名 / 任务名 / 备注 / 进展描述等自由文本）渲染为机翻译文 —— 译文由各页
 * 数据到达时的 prefetchZhToEn 提前后台翻好（会话缓存，见 translateApi.ts）；未就绪先显示原文、
 * 译文到位自动切换。返回取词函数（列表 / 循环里同样可用）：中文界面原样返回；英文界面 = 命中译文 ?? 原文。
 */
export function useLocalizedTranslator(): (text: string) => string {
  const locale = useLocale();
  useSyncExternalStore(subscribeTranslations, getTranslationRevision, () => 0);
  return useCallback(
    (text: string): string => (locale === "en" && text !== "" ? cachedZhToEn(text) ?? text : text),
    [locale],
  );
}

/** 单条手打文本的机翻译文：英文界面 + 缓存命中返回译文，否则 null（调用方自行回退原文 / 悬停对照）。 */
export function useMachineText(text: string | null | undefined): string | null {
  const locale = useLocale();
  const source = text ?? "";
  const translated = useSyncExternalStore(
    subscribeTranslations,
    () => (source === "" ? null : cachedZhToEn(source)),
    () => null,
  );
  return locale === "en" ? translated : null;
}

/** 单条手打文本的「本地化显示值」：中文界面 = 原文；英文界面 = 译文（未就绪先原文，到位自动切换）。 */
export function useLocalizedText(text: string): string {
  return useMachineText(text) ?? text;
}

/** 阶段英文名（数据层阶段名是中文：九阶段 + 项目总览 + 临时任务；显示层换英文）。 */
const STAGE_EN: Record<string, string> = {
  "售前规划": "Pre-sales Planning",
  "设计开发": "Design & Development",
  "加工采购": "Processing & Procurement",
  "组装发货": "Assembly & Shipping",
  "硬件实施": "Hardware Implementation",
  "软件部署": "Software Deployment",
  "试运行": "Trial Run",
  "生产阶段": "Production",
  "验收": "Acceptance",
  "项目总览": "Project Overview",
  "临时任务": "Temp Task",
};

/** 阶段显示名（英文界面换英文名；未知值原样返回，不吞信息）。 */
export function stageText(locale: Locale, stage: string): string {
  return locale === "en" ? STAGE_EN[stage] ?? stage : stage;
}

/** 洲显示名（地区筛选分组用；未知值原样返回）。 */
const CONTINENT_TEXT_KEYS: Record<string, TextKey> = {
  "亚洲": "continent.asia",
  "欧洲": "continent.europe",
  "非洲": "continent.africa",
  "北美洲": "continent.northAmerica",
  "南美洲": "continent.southAmerica",
  "大洋洲": "continent.oceania",
  "其他": "continent.other",
};

export function continentText(locale: Locale, continent: string): string {
  const key = CONTINENT_TEXT_KEYS[continent];
  return key === undefined ? continent : textOf(locale, key);
}

/** 字段名英文（任务表 / 工作台 / 看板 / 甘特 / 抽屉的列名与字段标签共用；数据层字段名是中文，显示层换英文）。 */
const FIELD_EN: Record<string, string> = {
  "任务描述": "Task",
  "项目经理": "Project manager",
  "任务负责人": "Owners",
  "负责人": "Owners",
  "任务状态": "Status",
  "状态": "Status",
  "紧急重要度": "Priority",
  "是否按时交付": "On-time",
  "输出成果文件": "Deliverables",
  "文件": "Files",
  "项目进展描述": "Progress note",
  "开始日期": "Start date",
  "预计所需天数": "Days",
  "天数": "Days",
  "预计完成日期": "Due date",
  "预计完成": "Due",
  "预计所需施工人数": "Headcount",
  "人数": "Headcount",
  "实际完成日期": "Completed",
  "变更关联": "Changes",
  "所属阶段": "Stage",
  "进度": "Progress",
  "进展": "Progress",
  "行号": "No.",
  "项目进度": "Progress",
  "待分配": "Unassigned",
  "任务详情": "Details",
  "变更申请": "Change request",
  "变更记录": "Change history",
  "开始 / 预计完成": "Start / due",
  "天": "days",
  "任务": "Task",
  "开始": "Start",
  "日期": "Date",
  "填写者": "Author",
  "时间time": "Time",
  "关联阶段": "Related stages",
  "关联阶段Related stages": "Related stages",
  "当日完成工作": "Work completed today",
  "当日完成工作Work completed today": "Work completed today",
  "明日计划": "Tomorrow's plan",
  "明日计划Tomorrow's plan": "Tomorrow's plan",
  "现场工作附图": "On-site photos",
  "现场工作附图On-site photos": "On-site photos",
  "问题描述": "Issue",
  "问题归类": "Category",
  "问题处理人 / 责任人": "Owner / assignee",
  "解决方案或建议": "Solution",
  "问题附图": "Issue photos",
  "问题是否处理": "Handled",
  "未归类": "Uncategorized",
  "待分派": "Unassigned",
  "提交人": "Submitter",
  "今日施工人数": "Headcount today",
  "施工人数": "Headcount",
  "现场发现问题Problem": "Issue found",
  "当前问题附图": "Issue photos",
  "来源日报": "Source report",
  "问题详情": "Issue details",
  "项目名称": "Project",
  "时间": "Time",
};

/** 字段显示名（英文界面换英文；未知值原样返回，不吞信息）。 */
export function fieldText(locale: Locale, zh: string): string {
  return locale === "en" ? FIELD_EN[zh] ?? zh : zh;
}

/** 项目详情主标签英文名（数据层标签名是中文，显示层换英文）。 */
const VIEW_TAB_EN: Record<string, string> = {
  "项目总览": "Project Overview",
  "甘特图": "Gantt Chart",
  "人员任务分配": "Task Assignment",
  "任务进展": "Task Progress",
  "日报及问题": "Daily Reports & Issues",
  "干系人": "Stakeholders",
};

/** 主标签显示名（英文界面换英文；未知值原样返回，不吞信息）。 */
export function viewTabText(locale: Locale, tab: string): string {
  return locale === "en" ? VIEW_TAB_EN[tab] ?? tab : tab;
}

/** 「日报及问题」子菜单子项英文名（数据层标签是中文，显示层换英文）。 */
const SUB_TAB_EN: Record<string, string> = {
  "日报填写": "New report",
  "日报记录": "Daily reports",
  "问题追踪": "Issue tracking",
  "问题看板": "Issue board",
};

export function subTabText(locale: Locale, tab: string): string {
  return locale === "en" ? SUB_TAB_EN[tab] ?? tab : tab;
}

/** 「日报及问题」子菜单分组标题英文名。 */
const SUB_TAB_GROUP_EN: Record<string, string> = {
  "日报": "Reports",
  "问题": "Issues",
};

export function subTabGroupText(locale: Locale, label: string): string {
  return locale === "en" ? SUB_TAB_GROUP_EN[label] ?? label : label;
}

/** 工作台主标签 / 问题子视图标签英文名（数据层标签是中文，显示层换英文）。 */
const WORKSPACE_LABEL_EN: Record<string, string> = {
  "我的任务": "My tasks",
  "提出/负责的问题": "Raised / assigned",
  "我的计划": "My plan",
  "我提出的问题": "Raised by me",
  "待我处理的问题": "Assigned to me",
};

export function workspaceLabelText(locale: Locale, label: string): string {
  return locale === "en" ? WORKSPACE_LABEL_EN[label] ?? label : label;
}

/** 任务状态英文名（数据层五态是中文，与 data/tasks.ts 的 TaskStatus 对齐）。 */
const STATUS_EN: Record<string, string> = {
  "待开始": "Not started",
  "进行中": "In progress",
  "已完成": "Done",
  "提前完成": "Completed early",
  "已延期": "Overdue",
  "草稿": "Draft",
  "已提交": "Submitted",
  "补填": "Supplement",
  "未解决": "Open",
  "处理中": "In progress",
};

/** 任务状态显示名（英文界面换英文名；未知值原样返回）。 */
export function statusText(locale: Locale, status: string): string {
  return locale === "en" ? STATUS_EN[status] ?? status : status;
}

/** 项目状态英文名（契约取值 active / paused / done / archived）。 */
const PROJECT_STATUS_EN: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  done: "Done",
  archived: "Archived",
};

/** 项目状态显示名（英文界面换英文名；中文界面沿用 types.ts 的中文口径；未知值原样返回）。 */
export function projectStatusTextOf(locale: Locale, status: string): string {
  return locale === "en" ? PROJECT_STATUS_EN[status] ?? status : projectStatusText(status);
}

/** 进度档位中文名 / 英文名（中文与 data/tasks.ts 的 PROGRESS_LABELS 同源；英文同下标）。 */
const PROGRESS_ZH: readonly string[] = ["未开始", "刚开工", "完成一半", "快完成了", "已完成"];
const PROGRESS_EN: readonly string[] = ["Not started", "Just started", "Halfway", "Almost done", "Done"];

/** 进度档位显示名（index 对齐 data/tasks.ts 的 PROGRESS_LABELS；英文界面换英文名，越界回退空串）。 */
export function progressLabelOf(locale: Locale, index: number): string {
  return locale === "en" ? PROGRESS_EN[index] ?? "" : PROGRESS_ZH[index] ?? "";
}
