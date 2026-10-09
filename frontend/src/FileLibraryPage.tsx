import { useEffect, useState } from "react";
import { ApiError } from "./api";
import { AppHeader } from "./components/AppHeader";
import { FilePreviewOverlay } from "./components/FilePreviewOverlay";
import { FileTypeIcon } from "./components/FileTypeIcon";
import { Loader } from "./components/Loader";
import { SearchInput } from "./components/SearchInput";
import { SearchSelect } from "./components/SearchSelect";
import { Toast } from "./components/Toast";
import type { DirectoryUser } from "./directory";
import {
  ensurePreviewOutcome,
  fetchDownloadUrl,
  fetchProjectFileLibrary,
  previewKindOf,
  purgeFile,
  restoreFile,
  triggerDownload,
  type FileLibraryItem,
  type FilePreviewKind,
  type PreviewViewerConfig,
} from "./fileApi";
import { loadMyPermissions, type MyPermissions } from "./permissions";
import { fetchProjectList, formatDateTime, type ApiProject } from "./projectApi";
import type { MeResponse } from "./types";
import { EMPTY_FILES_QUERY, EMPTY_LIST_QUERY, type FilesQueryState, type FilesTab } from "./useHashRoute";

/**
 * 文件库页（Push 261 · 业务口径 2026-10-09「新增文件库 文件库里面分为 系统现有文件 回收站」）。
 *
 * 入口 = 右上角头像菜单第三项「文件库」（AppHeader；全账号可见 —— 读面按项目可见性放开，无单独权限位）。
 * 两栏（地址 `?tab=recycled`，缺省「系统现有文件」不落参数，见 useHashRoute 的 FilesQueryState）：
 *   ① 系统现有文件 = 四档在库状态（草稿 / 已定档 / 已变更 / 已归档），显式 filter[status]=draft,final,changed,archived
 *      （服务端缺省虽排除回收站，显式给全更不随口径漂移）；
 *   ② 回收站 = filter[status]=recycled，行内可就地「恢复」（回退到进入回收站前的状态）与「彻底删除」
 *      （仅系统管理员渲染入口 —— 服务端按 roleCodes=admin 硬闸，A4-12；非管理员吃 403 兜底）。
 *
 * 数据面（一期口径 · 前端聚合）：文件列表接口只有项目维度（GET /projects/{id}/files），本页按项目列表逐项目
 * 分页取满再合并（fileApi.fetchProjectFileLibrary），关键字 / 状态筛选下沉到服务端同一套 filter（filter[status] 支持逗号多值）；
 *【2026-10-09 追订一】筛选多选（业务口径「要可以多项选择 再次点击取消选择」+「别的筛选也是同理 要支持多选」）：
 * 项目 / 状态 / 上传人 = 可搜索**多选**下拉（点选 / 再点取消，点选不关浮层；地址 project=<id>[,<id>…]、
 * status=<k>[,<k>…]、uploadedBy=<id>[,<id>…]，逗号分隔去重保序，见 useHashRoute.parseFilesQuery）；
 * 多选 = 逐选中项目取满后并集。上传人筛选在内存过滤（服务端 filter[uploadedBy] 仍是单值 UUID 口径，本页已逐项目
 * 取满全量、内存过滤等价且多选不翻倍请求）—— 多值口径列入《前端功能需求》§3.8 对齐清单，待服务端放开。
 * 单项目失败（非成员 404 等）跳过不阻断整页（读面 404 防 IDOR 是服务端口径，页面只兜底）。
 * 「共 N 条」= 前端合并后的条数；分页为前端切页（页大小 50，与操作记录页同宽）。跨项目全站列表端点列入
 * 《前端功能需求》§3.8 对齐清单（wmj / lan 复核后由服务端接手，前端聚合作一期过渡）。
 *
 * 列口径（六列）：文件名（类型图标 + 名字）/ 状态（与站内文件状态签 / 定档开关同一套颜色）/ 项目（**名字 + 编号两行**：
 * 上行项目名、下行项目编号 —— 追订「项目名称要编号和名字都写在表格里面注意排版」+「中文和编号的位置反一下」）/ 上传人（用户目录姓名，离线兜底 id）/
 * 时间（Asia/Shanghai，YYYY-MM-DD HH:mm）/ 操作；回收站栏第 5 列改「移入回收站」（时间 · 人）、操作列 = 恢复 / 彻底删除。
 *【2026-10-09 追订】「类型」列与筛选整条撤除（业务口径「文件类型不需要 因为没有明确的绑定机制」—— 库内文件
 * 没有类型绑定点（files.doc_type 全空）、列恒「—」；任务侧「输出成果文件」是任务字段，不受影响）。
 * 操作列按钮定宽（预览 / 下载换忙碌文案不重排 auto layout 表格 = 点预览不再抖表）；写口反馈走上方浮动 Toast
 * （components/Toast.tsx：屏幕上方居中、停留 2s 自动消失）。
 * 预览走 S4 两通道裁决（ensurePreviewOutcome：viewer = ONLYOFFICE 外壳 / url = 产物浮层）；下载 = 原文件
 * attachment 短时签名 + Blob 落盘（fetchDownloadUrl + triggerDownload，服务端写 download 审计）。
 * 失败口径：本页只读 + 两个回收站写口，写失败给一行提示（VERSION_CONFLICT = 数据已被他人更新）。
 */

/** 「系统现有文件」栏的四档在库状态（顺序 = 筛选下拉；与契约 FileStatus 同口径）。 */
const CURRENT_STATUSES: readonly string[] = ["draft", "final", "changed", "archived"];

/** 文件状态中文签（与站内文件行 / 抽屉「变更申请」页同一套文案；未知取值回落原文）。 */
const FILE_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  final: "已定档",
  changed: "已变更",
  archived: "已归档",
  recycled: "回收站",
};

/** 状态签颜色（统一口径）：草稿 / 已归档 / 回收站 = 中性灰（同任务抽屉文件行），已定档 = 定档开关的琥珀，
 *  已变更 = 「进行中」蓝系。 */
const FILE_STATUS_CLASS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  final: "bg-amber-100 text-amber-800",
  changed: "bg-blue-50 text-blue-700",
  archived: "bg-zinc-100 text-zinc-500",
  recycled: "bg-zinc-100 text-zinc-400",
};

/** 页大小（前端切页；与操作记录页同为 50 行/页）。 */
const PAGE_LIMIT = 50;

type LibraryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: FileLibraryItem[] };

type PreviewState = {
  pane: { mode: "url"; url: string } | { mode: "viewer"; viewer: PreviewViewerConfig };
  name: string;
  kind: FilePreviewKind;
  fileId: string;
  nonce: number;
};

type Notice = { kind: "ok" | "error"; text: string };

/** 两栏（顺序 = 标签栏顺序）。 */
const TABS: ReadonlyArray<{ key: FilesTab; label: string }> = [
  { key: "current", label: "系统现有文件" },
  { key: "recycled", label: "回收站" },
];

/** 写失败 → 面向业务的提示（错误码口径《前端功能需求》§3.7）。 */
function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "数据已被他人更新，请刷新后重试。";
    }
    if (error.status === 403) {
      return "没有权限执行该操作。";
    }
    if (error.code === "FILE_STATE_INVALID") {
      return error.message;
    }
    return error.message + "（" + error.code + "）";
  }
  return fallback + "：网络异常，请稍后重试。";
}

export function FileLibraryPage({ me, query, onChangeQuery, directory }: {
  me: MeResponse;
  query: FilesQueryState;
  onChangeQuery: (next: FilesQueryState) => void;
  directory: readonly DirectoryUser[];
}) {
  const [state, setState] = useState<LibraryState>({ kind: "loading" });
  const [projects, setProjects] = useState<ApiProject[] | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [permissions, setPermissions] = useState<MyPermissions | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);

  // 关键字防抖（与首页列表 / 操作记录页同口径）：输入时不每敲一个字打一次接口，250ms 内的最后一次生效
  const [debouncedKeyword, setDebouncedKeyword] = useState(query.keyword ?? "");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(query.keyword ?? "");
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query.keyword]);

  // 项目列表（筛选下拉与项目编号列的一次性来源；limit=200 一次拉满）。失败 = 整页错误态，重试按钮重来。
  useEffect(() => {
    let alive = true;
    setProjects(null);
    fetchProjectList(EMPTY_LIST_QUERY)
      .then((payload) => {
        if (alive) {
          setProjects(payload.items);
        }
      })
      .catch(() => {
        if (alive) {
          setState({ kind: "error", message: "项目列表加载失败，请稍后重试。" });
        }
      });
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  // 多选筛选键（2026-10-09 追订）：数组引用每次解析都会变，用逗号串当依赖键，防误触发整页重取；
  // 上传人是内存过滤（见文件头）：不进 fetch 依赖 —— 勾选 / 取消只重算派生列表、不重发请求。
  const projectIdKey = query.projectIds.join(",");
  const statusKey = query.statuses.join(",");

  // 文件列表：按项目列表逐项目取满再合并（见文件头「数据面」；单项目失败跳过；多选 = 选中项目并集）。
  useEffect(() => {
    if (projects === null) {
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    const keyword = debouncedKeyword.trim();
    const statuses = query.tab === "recycled" ? ["recycled"] : statusKey === "" ? CURRENT_STATUSES : statusKey.split(",");
    const targetIds = projectIdKey === "" ? [] : projectIdKey.split(",");
    const targets = targetIds.length === 0 ? projects : projects.filter((project) => targetIds.includes(project.id));
    void Promise.all(
      targets.map((project) =>
        fetchProjectFileLibrary(project.id, {
          statuses,
          keyword: keyword === "" ? undefined : keyword,
        }).catch(() => [] as FileLibraryItem[]),
      ),
    ).then((results) => {
      if (!alive) {
        return;
      }
      const items = results.flat();
      items.sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt < right.createdAt ? 1 : -1;
        }
        return left.id < right.id ? -1 : 1;
      });
      setState({ kind: "ready", items });
    });
    return () => {
      alive = false;
    };
  }, [projects, debouncedKeyword, query.tab, projectIdKey, statusKey, reloadTick]);

  // 权限画像（与 AppHeader 共用同一份进程内单飞缓存）：只用来裁决「彻底删除」入口的渲染 —— 服务端逐请求仍是最终裁决
  useEffect(() => {
    let alive = true;
    loadMyPermissions()
      .then((profile) => {
        if (alive) {
          setPermissions(profile);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const isAdmin = permissions !== null && permissions.roleCodes.includes("admin");

  // 上传人多选 = 内存过滤（服务端 filter[uploadedBy] 单值口径，见文件头）：空选不筛、多选取并集。
  const visibleItems =
    state.kind !== "ready"
      ? []
      : query.uploaderIds.length === 0
        ? state.items
        : state.items.filter((item) => query.uploaderIds.includes(item.createdBy));
  const total = visibleItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const page = Math.min(query.page, totalPages);
  const pageItems = visibleItems.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT);
  const projectById = new Map((projects ?? []).map((project) => [project.id, project] as const));
  const userNameById = new Map(directory.map((user) => [user.id, user.displayName] as const));
  const userNameOf = (id: string | null): string => (id === null ? "—" : userNameById.get(id) ?? id);
  const projectCodeOf = (id: string): string => projectById.get(id)?.code ?? "—";
  const projectNameOf = (id: string): string => projectById.get(id)?.name ?? "—";

  const patchFilter = (patch: Partial<FilesQueryState>): void => {
    onChangeQuery({ ...query, ...patch, page: 1 });
  };
  const gotoPage = (next: number): void => {
    onChangeQuery({ ...query, page: next });
  };
  const switchTab = (tab: FilesTab): void => {
    if (tab === query.tab) {
      return;
    }
    // 换栏保留项目 / 关键字 / 上传人（两栏都成立的筛选），状态清掉（只在系统现有文件栏有语义）
    onChangeQuery({ ...query, tab, statuses: [], page: 1 });
  };
  const hasFilter =
    query.keyword !== null || query.projectIds.length > 0 || query.statuses.length > 0 || query.uploaderIds.length > 0;
  const clearFilters = (): void => {
    onChangeQuery({ ...EMPTY_FILES_QUERY, tab: query.tab });
  };

  // 项目筛选 = 多选（2026-10-09 追订）：不再有「全部项目」选项行，空选占位由 placeholder="全部项目" 承担。
  const projectOptions = (projects ?? []).map((project) => ({ value: project.id, label: project.code + " · " + project.name }));
  // 状态 / 上传人筛选同为多选（2026-10-09 追订二）：不再有「全部…」选项行，空选占位交给 placeholder。
  const statusOptions = CURRENT_STATUSES.map((status) => ({ value: status, label: FILE_STATUS_LABELS[status] ?? status }));
  const uploaderOptions = directory.map((user) => ({ value: user.id, label: user.displayName }));

  /** 预览（与任务抽屉同一套 S4 两通道裁决）：点开才懒取；unavailable = 一行提示（reason 或「请下载查看」口径）。 */
  const openPreview = async (file: FileLibraryItem): Promise<void> => {
    if (previewBusy !== null) {
      return;
    }
    setPreviewBusy(file.id);
    setNotice(null);
    const outcome = await ensurePreviewOutcome(file.id);
    setPreviewBusy(null);
    if (outcome.kind === "unavailable") {
      setNotice({ kind: "error", text: outcome.reason ?? "暂不支持在线预览，请下载查看。" });
      return;
    }
    const kind = previewKindOf(file.name) ?? "image";
    if (outcome.kind === "viewer") {
      setPreview({ pane: { mode: "viewer", viewer: outcome.viewer }, name: file.name, kind, fileId: file.id, nonce: 0 });
      return;
    }
    setPreview({ pane: { mode: "url", url: outcome.url }, name: file.name, kind, fileId: file.id, nonce: 0 });
  };

  /** 查看器外壳「重试」：重取查看器配置（token 随签发刷新）+ nonce 自增强制重建；仍取不到 → 关浮层 + 一行提示。 */
  const retryPreview = async (fileId: string, previous: PreviewState): Promise<void> => {
    if (previewBusy !== null) {
      return;
    }
    setPreviewBusy(fileId);
    const outcome = await ensurePreviewOutcome(fileId);
    setPreviewBusy(null);
    if (outcome.kind === "unavailable") {
      setPreview(null);
      setNotice({ kind: "error", text: outcome.reason ?? "暂不支持在线预览，请下载查看。" });
      return;
    }
    const pane = outcome.kind === "viewer"
      ? { mode: "viewer" as const, viewer: outcome.viewer }
      : { mode: "url" as const, url: outcome.url };
    setPreview({ pane, name: previous.name, kind: previous.kind, fileId: previous.fileId, nonce: previous.nonce + 1 });
  };

  /** 下载原文件（与任务抽屉同口径）：版本 attachment 短时签名 + Blob 落盘（服务端写 download 审计）。 */
  const downloadFile = async (file: FileLibraryItem): Promise<void> => {
    if (downloadBusy !== null) {
      return;
    }
    setDownloadBusy(file.id);
    setNotice(null);
    try {
      const signed = await fetchDownloadUrl(file.id);
      await triggerDownload(signed.url, signed.fileName);
      setNotice({ kind: "ok", text: "已开始下载：" + signed.fileName });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error && error.message !== "" ? error.message : "下载失败，请稍后重试。" });
    } finally {
      setDownloadBusy(null);
    }
  };

  /** 回收站恢复（A4-12）：回退到进入回收站前的状态；成功后重取当前栏。 */
  const restoreItem = async (file: FileLibraryItem): Promise<void> => {
    if (actionBusy !== null) {
      return;
    }
    setActionBusy(file.id);
    setNotice(null);
    try {
      await restoreFile(file.id);
      const back = FILE_STATUS_LABELS[file.recycledFromStatus ?? "draft"] ?? "草稿";
      setNotice({ kind: "ok", text: "已恢复：" + file.name + "（回退到「" + back + "」）" });
      setReloadTick((tick) => tick + 1);
    } catch (error) {
      setNotice({ kind: "error", text: friendlyError(error, "恢复失败。") });
    } finally {
      setActionBusy(null);
      setPurgeConfirmId(null);
    }
  };

  /** 彻底删除（仅系统管理员渲染入口；服务端按 roleCodes=admin 硬闸）：行内二次确认后 POST /files/{id}/purge。 */
  const purgeItem = async (file: FileLibraryItem): Promise<void> => {
    if (actionBusy !== null) {
      return;
    }
    setActionBusy(file.id);
    setNotice(null);
    try {
      await purgeFile(file.id);
      setPurgeConfirmId(null);
      setNotice({ kind: "ok", text: "已彻底删除：" + file.name });
      setReloadTick((tick) => tick + 1);
    } catch (error) {
      setNotice({ kind: "error", text: friendlyError(error, "彻底删除失败。") });
    } finally {
      setActionBusy(null);
    }
  };

  const emptyText = ((): string => {
    if (query.keyword !== null) {
      return "没有匹配「" + query.keyword + "」的文件，可调整关键词或清除筛选。";
    }
    if (hasFilter) {
      return query.tab === "recycled" ? "当前筛选下没有回收站文件，可清除筛选后重试。" : "当前筛选下没有文件，可清除筛选后重试。";
    }
    return query.tab === "recycled" ? "回收站是空的。" : "文件库中暂无文件。";
  })();

  return (
    <div className="min-h-screen">
      <AppHeader me={me} />
      <main className="w-full px-6 pb-10 pt-3">
        <div data-file-library="" className="w-full space-y-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-zinc-900">文件库</h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                全站文件的集中入口：系统现有文件（草稿 / 已定档 / 已变更 / 已归档）与回收站（默认保留 30 天，可恢复）；按上传时间倒序，跨项目汇总。
              </p>
            </div>
            {state.kind === "ready" ? (
              <p data-file-count="" className="text-xs text-zinc-500">
                共 {total} 条
              </p>
            ) : null}
          </header>

          <nav data-file-tabs="" aria-label="文件库标签" className="flex gap-1 border-b border-zinc-200">
            {TABS.map((item) => {
              const active = item.key === query.tab;
              return (
                <button
                  key={item.key}
                  type="button"
                  data-file-tab={item.key}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    switchTab(item.key);
                  }}
                  className={
                    "border-b-2 px-4 py-2.5 text-sm font-medium transition " +
                    (active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800")
                  }
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
            <span data-file-filter="keyword" className="w-72 shrink-0">
              <SearchInput
                value={query.keyword ?? ""}
                onChange={(value) => {
                  patchFilter({ keyword: value === "" ? null : value });
                }}
                placeholder="搜索文件名"
                className="w-full"
              />
            </span>
            <span data-file-filter="project" className="w-44 shrink-0">
              <SearchSelect
                mode="multi"
                ariaLabel="按项目筛选"
                values={query.projectIds}
                options={projectOptions}
                placeholder="全部项目"
                searchPlaceholder="搜索项目编号 / 名称"
                label="项目"
                onToggle={(value) => {
                  patchFilter({
                    projectIds: query.projectIds.includes(value)
                      ? query.projectIds.filter((id) => id !== value)
                      : query.projectIds.concat(value),
                  });
                }}
              />
            </span>
            {query.tab === "current" ? (
              <span data-file-filter="status" className="w-32 shrink-0">
                <SearchSelect
                  mode="multi"
                  ariaLabel="按状态筛选"
                  values={query.statuses}
                  options={statusOptions}
                  placeholder="全部状态"
                  searchPlaceholder="搜索状态"
                  label="状态"
                  onToggle={(value) => {
                    patchFilter({
                      statuses: query.statuses.includes(value)
                        ? query.statuses.filter((status) => status !== value)
                        : query.statuses.concat(value),
                    });
                  }}
                />
              </span>
            ) : null}
            <span data-file-filter="uploader" className="w-36 shrink-0">
              <SearchSelect
                mode="multi"
                ariaLabel="按上传人筛选"
                values={query.uploaderIds}
                options={uploaderOptions}
                placeholder="全部上传人"
                searchPlaceholder="搜索姓名"
                label="上传人"
                onToggle={(value) => {
                  patchFilter({
                    uploaderIds: query.uploaderIds.includes(value)
                      ? query.uploaderIds.filter((id) => id !== value)
                      : query.uploaderIds.concat(value),
                  });
                }}
              />
            </span>
            {hasFilter ? (
              <button
                type="button"
                data-file-clear="true"
                onClick={clearFilters}
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
              >
                清除筛选
              </button>
            ) : null}
          </section>

          {notice === null ? null : (
            <Toast
              kind={notice.kind}
              text={notice.text}
              onClose={() => {
                setNotice(null);
              }}
              anchor={{ name: "data-file-notice", value: notice.kind }}
            />
          )}

          {state.kind === "loading" ? (
            <div className="flex justify-center py-16">
              <Loader />
            </div>
          ) : null}

          {state.kind === "error" ? (
            <div role="alert" data-file-error="" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <span>{state.message}</span>
              <button
                type="button"
                onClick={() => {
                  setReloadTick((tick) => tick + 1);
                }}
                className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium transition hover:bg-rose-100"
              >
                重试
              </button>
            </div>
          ) : null}

          {state.kind === "ready" && total === 0 ? (
            <div data-file-empty="true" className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-500">
              {emptyText}
            </div>
          ) : null}

          {state.kind === "ready" && total > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
                <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="border-b border-zinc-200 px-4 py-3 font-medium">文件名</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">状态</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">项目</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">上传人</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">{query.tab === "recycled" ? "移入回收站" : "上传时间"}</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((file) => (
                      <tr key={file.id} data-file-row={file.id} className="align-top transition hover:bg-zinc-50/70">
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <span className="flex items-center gap-2">
                            <FileTypeIcon name={file.name} />
                            <span className="truncate text-zinc-800" title={file.name}>
                              {file.name}
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3">
                          <span
                            data-file-status={file.status}
                            title={
                              query.tab === "recycled" && file.recycledFromStatus !== null
                                ? "原状态：" + (FILE_STATUS_LABELS[file.recycledFromStatus] ?? file.recycledFromStatus)
                                : undefined
                            }
                            className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + (FILE_STATUS_CLASS[file.status] ?? "bg-zinc-100 text-zinc-600")}
                          >
                            {FILE_STATUS_LABELS[file.status] ?? file.status}
                          </span>
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <div
                            data-file-project={file.projectId}
                            data-file-project-code={projectCodeOf(file.projectId)}
                            data-file-project-name={projectNameOf(file.projectId)}
                            className="flex max-w-[240px] flex-col gap-0.5"
                          >
                            <span className="truncate font-medium text-zinc-700" title={projectNameOf(file.projectId)}>
                              {projectNameOf(file.projectId)}
                            </span>
                            <span className="whitespace-nowrap text-xs text-zinc-500">{projectCodeOf(file.projectId)}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3 text-zinc-700">{userNameOf(file.createdBy)}</td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3 text-zinc-600">
                          {query.tab === "recycled"
                            ? file.recycledAt === null
                              ? "—"
                              : formatDateTime(file.recycledAt) + " · " + userNameOf(file.recycledBy)
                            : formatDateTime(file.createdAt)}
                        </td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3">
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              data-file-preview={file.id}
                              disabled={previewBusy !== null}
                              onClick={() => {
                                void openPreview(file);
                              }}
                              className="inline-flex w-16 items-center justify-center rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                            >
                              {previewBusy === file.id ? "打开中" : "预览"}
                            </button>
                            {query.tab === "current" ? (
                              <button
                                type="button"
                                data-file-download={file.id}
                                disabled={downloadBusy !== null}
                                onClick={() => {
                                  void downloadFile(file);
                                }}
                                className="inline-flex w-16 items-center justify-center rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                              >
                                {downloadBusy === file.id ? "下载中" : "下载"}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  data-file-restore={file.id}
                                  disabled={actionBusy !== null}
                                  onClick={() => {
                                    void restoreItem(file);
                                  }}
                                  className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                                >
                                  恢复
                                </button>
                                {isAdmin ? (
                                  purgeConfirmId === file.id ? (
                                    <>
                                      <span className="text-[11px] text-rose-600">彻底删除后不可恢复</span>
                                      <button
                                        type="button"
                                        data-file-purge-confirm={file.id}
                                        disabled={actionBusy !== null}
                                        onClick={() => {
                                          void purgeItem(file);
                                        }}
                                        className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:text-rose-300"
                                      >
                                        {actionBusy === file.id ? "删除中…" : "确认彻底删除"}
                                      </button>
                                      <button
                                        type="button"
                                        data-file-purge-cancel={file.id}
                                        onClick={() => {
                                          setPurgeConfirmId(null);
                                        }}
                                        className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                                      >
                                        取消
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      data-file-purge={file.id}
                                      disabled={actionBusy !== null}
                                      onClick={() => {
                                        setPurgeConfirmId(file.id);
                                      }}
                                      className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-rose-300"
                                    >
                                      彻底删除
                                    </button>
                                  )
                                ) : null}
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-3">
                <p data-file-page-info="" className="text-xs text-zinc-500">
                  共 {total} 条 · 第 {page} / {totalPages} 页
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-file-prev="true"
                    disabled={page <= 1}
                    onClick={() => {
                      gotoPage(page - 1);
                    }}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    data-file-next="true"
                    disabled={page >= totalPages}
                    onClick={() => {
                      gotoPage(page + 1);
                    }}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                  >
                    下一页
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </div>
      </main>
      {preview === null ? null : (
        <FilePreviewOverlay
          pane={preview.pane}
          name={preview.name}
          kind={preview.kind}
          nonce={preview.nonce}
          onRetry={() => {
            void retryPreview(preview.fileId, preview);
          }}
          onDownload={() => {
            void (async () => {
              try {
                const signed = await fetchDownloadUrl(preview.fileId);
                await triggerDownload(signed.url, signed.fileName);
              } catch (error) {
                setNotice({ kind: "error", text: error instanceof Error && error.message !== "" ? error.message : "下载失败，请稍后重试。" });
              }
            })();
          }}
          onClose={() => {
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}
