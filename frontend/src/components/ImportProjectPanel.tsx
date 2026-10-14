import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { accentOfItem, dictLabel, type Dicts } from "../dicts";
import { projectTypeText, useLocale, useT } from "../i18n";
import {
  commitProjectImport,
  IMPORT_MAX_FILE_BYTES,
  previewProjectImport,
  type ImportIssue,
  type ImportManualImage,
  type ProjectImportPreview,
  type ProjectImportResult,
} from "../importApi";
import { DictSelect } from "./DictSelect";
import { RegionSelect } from "./RegionSelect";
import { ScrollArea } from "./ScrollArea";
import { useFocusTrap } from "./useFocusTrap";

/**
 * 「导入项目」大屏面板（Push 316 待推 · 业务口径 2026-10-14「先在新建项目左侧加导入项目按钮 点击导入选择 Excel
 * 然后不切换页面 直接在项目空间里面有一块大屏里面操作」+ 同轮选型「直连 API 导入」）：
 * 选文件 → ① 解析（不写库）→ ② 校验预览（项目落位 / 条数统计 / 提醒清单 / 需手动导入图片 / 账号 / 未匹配节点）
 * → ③ 确认导入 → ④ 完成（提醒复述）。面板挂在项目空间内（fixed 全屏遮罩），不动路由、不刷新页面。
 * 口径（业务已回执）：解析不写库；完成日期未填不算完成；进度五档（进行中封顶 75%）；日期笔误照原值 + 提醒；
 * 任务节点按文件原名（可勾选补进节点库）；微盘图片出清单人工上传；账号初始密码 123456。
 */

type Phase =
  | { kind: "parsing" }
  | { kind: "preview"; preview: ProjectImportPreview }
  | { kind: "committing"; preview: ProjectImportPreview }
  | { kind: "done"; preview: ProjectImportPreview; result: ProjectImportResult }
  | { kind: "failed"; stage: "parse" | "commit"; error: ApiError | null; reason: "empty" | "size" | null };

export type ImportProjectPanelProps = {
  /** 待导入的 Excel（父层文件选择器给；引用变化 = 重新解析）。 */
  file: File;
  /** 字典（项目地区选择小窗用）。 */
  dicts: Dicts;
  /** 重新选择文件（父层点同一个隐藏 input；选中后本面板自动重新解析）。 */
  onReselect: () => void;
  /** 关闭面板（父层清空已选文件）。 */
  onClose: () => void;
  /** 导入成功（父层刷新项目列表）。 */
  onImported: () => void;
};

/** 文件大小展示（KB / MB / B）。 */
function formatBytes(size: number): string {
  if (size >= 1024 * 1024) {
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }
  if (size >= 1024) {
    return Math.round(size / 1024) + " KB";
  }
  return size + " B";
}

/** 提醒等级配色（预览与完成页复述共用）。 */
const ISSUE_STYLE: Record<ImportIssue["level"], string> = {
  error: "border-rose-200 bg-rose-50 text-rose-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

const ISSUE_LEVEL_KEY: Record<ImportIssue["level"], "import.issues.level.error" | "import.issues.level.warning" | "import.issues.level.info"> = {
  error: "import.issues.level.error",
  warning: "import.issues.level.warning",
  info: "import.issues.level.info",
};

/** 一条提醒：等级徽标 + 文案 + 源表行号 / 关联对象。 */
function IssueRow({ issue }: { issue: ImportIssue }) {
  const t = useT();
  const meta: string[] = [];
  if (issue.row !== null) {
    meta.push(t("import.issues.row", { row: issue.row }));
  }
  if (issue.subject !== null && issue.subject !== "") {
    meta.push(issue.subject);
  }
  return (
    <li className="flex items-start gap-2 border-b border-zinc-100 py-2 last:border-b-0">
      <span className={"mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium " + ISSUE_STYLE[issue.level]}>
        {t(ISSUE_LEVEL_KEY[issue.level])}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5 text-zinc-700">{issue.message}</span>
        {meta.length === 0 ? null : <span className="mt-0.5 block text-[11px] text-zinc-400">{meta.join(" · ")}</span>}
      </span>
    </li>
  );
}

/** 条数统计格。 */
function StatTile({ label, value, caption }: { label: string; value: number; caption?: string }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 px-3 py-2.5">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-zinc-900" data-import-stat="">{value}</dd>
      {caption === undefined ? null : <p className="mt-0.5 text-[11px] text-amber-700">{caption}</p>}
    </div>
  );
}

/**
 * 加载动画（业务口径 2026-10-14「导入的时间加载时间动画用之前那个导出 pdf 的」）：与导出 PDF 等待浮层同款 ——
 * 品牌小车沿流动虚线路面循环前进（复用 app.css 的 export-progress__* 样式；该组样式不依赖浮层祖先，面板内可直接用）。
 */
function ImportCarStage() {
  return (
    <div className="export-progress__stage" aria-hidden="true">
      <span className="export-progress__road" />
      <span className="export-progress__cart">
        <span className="export-progress__cart-shadow" />
        <span className="export-progress__cart-bob">
          <img className="export-progress__cart-img" src="/libiaolink-car-icon.svg" alt="" />
          <span className="export-progress__trail export-progress__trail--long" />
          <span className="export-progress__trail export-progress__trail--short" />
        </span>
      </span>
    </div>
  );
}

/** 「需手动导入」图片清单（预览与完成页共用）：微盘 / 本地路径图片，导入后按清单人工上传。 */
function ManualImageList({ images }: { images: ImportManualImage[] }) {
  return (
    <ul className="mt-3 max-h-56 space-y-1.5 overflow-auto">
      {images.map((image, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs">
          <span className="font-medium text-amber-900">{image.name}</span>
          <span className="text-amber-700">{image.reason}</span>
          <span className="ml-auto text-[11px] text-amber-700">{image.task}</span>
        </li>
      ))}
    </ul>
  );
}

export function ImportProjectPanel({ file, dicts, onReselect, onClose, onImported }: ImportProjectPanelProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "parsing" });
  const locale = useLocale();
  /** 项目地区：解析给默认（标准国家 / 地区名）；识别不出 = 空串，必须由用户在面板里选。 */
  const [region, setRegion] = useState("");
  /** 项目类型：解析按源表关键字给默认（如 AIRROB → 飞箱）；空串 = 未指定（可留空，导入后也能改）。 */
  const [projectType, setProjectType] = useState("");
  /** 节点补库开关（业务口径：无对应任务节点按文件原名导入，同时问用户是否补进「任务节点」）。 */
  const [addMissingNodes, setAddMissingNodes] = useState(true);
  /** 地区小窗开着时按 Esc 只关小窗（再按一次才关面板，与项目弹窗同口径）。 */
  const [regionPopoverOpen, setRegionPopoverOpen] = useState(false);
  /** 加载态已用秒数（解析 / 写入两段各自计时；展示在动画下方，与导出浮层「预计需要 XX 秒」同一处位置）。 */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const committing = phase.kind === "committing";

  // 选文件（或换文件）即解析：解析不写库；换文件 = 整体重来（地区 / 勾选复位）。
  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "parsing" });
    setRegion("");
    setProjectType("");
    setAddMissingNodes(true);
    setRegionPopoverOpen(false);
    if (file.size === 0 || file.size > IMPORT_MAX_FILE_BYTES) {
      setPhase({ kind: "failed", stage: "parse", error: null, reason: file.size === 0 ? "empty" : "size" });
      return;
    }
    previewProjectImport(file)
      .then((preview) => {
        if (cancelled) {
          return;
        }
        setRegion(preview.project.region === null ? "" : preview.project.region);
        setProjectType(preview.project.projectType === null ? "" : preview.project.projectType);
        setPhase({ kind: "preview", preview });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setPhase({ kind: "failed", stage: "parse", error: error instanceof ApiError ? error : null, reason: null });
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // 加载计时（解析 / 写入两段各自从 0 起算；离开加载态即停）。
  useEffect(() => {
    if (phase.kind !== "parsing" && phase.kind !== "committing") {
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [phase.kind, file]);

  // Esc 关闭（写入中 / 地区小窗打开时不关）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || regionPopoverOpen || committing) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [committing, onClose, regionPopoverOpen]);

  // 面板打开期间锁背景滚动（与项目弹窗同款：经典滚动条占位补回，锁滚动不横向跳动）。
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = { html: html.style.overflow, body: body.style.overflow, pad: body.style.paddingRight };
    const gap = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (gap > 0) {
      body.style.paddingRight = String(gap) + "px";
    }
    return () => {
      html.style.overflow = previous.html;
      body.style.overflow = previous.body;
      body.style.paddingRight = previous.pad;
    };
  }, []);

  const startCommit = (preview: ProjectImportPreview): void => {
    setPhase({ kind: "committing", preview });
    commitProjectImport({ previewId: preview.previewId, region: region, projectType: projectType, addMissingNodes: addMissingNodes })
      .then((result) => {
        setPhase({ kind: "done", preview: preview, result: result });
        onImported();
      })
      .catch((error: unknown) => {
        setPhase({ kind: "failed", stage: "commit", error: error instanceof ApiError ? error : null, reason: null });
      });
  };

  // 预览态派生：可导入 = 无阻断项 + 地区已选（用户补选地区后，服务端的「地区未识别」阻断项随之消解）。
  const preview = phase.kind === "preview" || phase.kind === "committing" || phase.kind === "done" ? phase.preview : null;
  const visibleIssues = preview === null ? [] : preview.issues.filter((issue) => !(issue.code === "REGION_UNRESOLVED" && region !== ""));
  const blockingCount = visibleIssues.filter((issue) => issue.level === "error").length;
  const unmatchedNodes = preview === null ? [] : preview.nodes.filter((node) => !node.matched);
  const canCommit = phase.kind === "preview" && blockingCount === 0 && region !== "";

  const failedText =
    phase.kind !== "failed"
      ? ""
      : phase.reason === "empty"
        ? t("import.err.empty")
        : phase.reason === "size"
          ? t("import.err.tooLarge", { size: formatBytes(file.size) })
          : phase.error !== null
            ? phase.error.message
            : t("import.err.network");
  const failedCode = phase.kind === "failed" && phase.error !== null ? phase.error.code : null;
  const failedStatus = phase.kind === "failed" && phase.error !== null ? phase.error.status : null;
  /** 服务端导入接口还没上线（404 / 501）：多给一行说明，免得当成数据问题查。 */
  const failedNotReady = failedStatus === 404 || failedStatus === 501;

  const secondaryButtonClass = "rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100";
  const primaryButtonClass =
    "rounded-lg bg-[#feca04] px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none";

  return (
    <div data-import-panel="" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[2px]"
        onClick={() => {
          if (!committing) {
            onClose();
          }
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("import.aria")}
        className="relative flex h-[calc(100dvh-2rem)] max-h-[860px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-zinc-900">{t("import.title")}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">{t("import.subtitle")}</p>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span
              className="max-w-[300px] truncate rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600"
              title={file.name}
              data-import-file-name=""
            >
              {file.name} · {formatBytes(file.size)}
            </span>
            <button
              type="button"
              aria-label={t("import.closeAria")}
              disabled={committing}
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <ScrollArea
          viewportClassName="min-h-0 flex-1"
          className="px-6 py-5"
          ariaLabel={t("import.aria")}
          thumbAlwaysVisible={phase.kind === "preview" || phase.kind === "done"}
        >
          {phase.kind === "parsing" ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center">
              <div className="w-[364px] max-w-full" data-import-loading-anim="parse">
                <ImportCarStage />
                <p className="export-progress__title">{t("import.parsing")}</p>
                <p className="export-progress__hint">{t("import.parsing.hint")}</p>
                <p className="export-progress__hint">
                  {t("import.elapsedLead")}
                  <span className="export-progress__num">{elapsedSeconds}</span>
                  {t("import.elapsedTail")}
                </p>
                <div className="export-progress__bar is-waiting">
                  <span className="export-progress__bar-fill" />
                </div>
              </div>
            </div>
          ) : null}

          {phase.kind === "committing" ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center">
              <div className="w-[364px] max-w-full" data-import-loading-anim="commit">
                <ImportCarStage />
                <p className="export-progress__title">{t("import.committing")}</p>
                <p className="export-progress__hint">{t("import.committing.hint")}</p>
                <p className="export-progress__hint">
                  {t("import.elapsedLead")}
                  <span className="export-progress__num">{elapsedSeconds}</span>
                  {t("import.elapsedTail")}
                </p>
                <div className="export-progress__bar is-waiting">
                  <span className="export-progress__bar-fill" />
                </div>
              </div>
              <dl className="mt-5 w-[364px] max-w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left text-xs text-zinc-600">
                <div className="flex gap-2">
                  <dt className="text-zinc-400">{t("import.field.code")}</dt>
                  <dd className="font-medium text-zinc-800">{phase.preview.project.code}</dd>
                </div>
                <div className="mt-1 flex gap-2">
                  <dt className="text-zinc-400">{t("import.field.name")}</dt>
                  <dd className="text-zinc-800">{phase.preview.project.name}</dd>
                </div>
                <div className="mt-1 flex gap-2">
                  <dt className="text-zinc-400">{t("import.field.region")}</dt>
                  <dd className="text-zinc-800">{dictLabel(dicts, "region", region)}</dd>
                </div>
                <div className="mt-1 flex gap-2">
                  <dt className="text-zinc-400">{t("import.field.type")}</dt>
                  <dd className="text-zinc-800">{projectType === "" ? t("import.value.none") : dictLabel(dicts, "projectType", projectType)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {phase.kind === "failed" ? (
            <div className="mx-auto flex h-full min-h-[420px] max-w-xl flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-xl font-bold text-rose-500" aria-hidden="true">
                !
              </div>
              <p className="mt-4 text-base font-semibold text-zinc-900">{t("import.failed.title")}</p>
              <p className="mt-2 text-sm text-zinc-600" data-import-failed-text="">{failedText}</p>
              {failedCode === null ? null : <p className="mt-1 text-xs text-zinc-400">{t("import.err.code", { code: failedCode })}</p>}
              {failedNotReady ? (
                <p className="mt-2 max-w-md rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t("import.notReady", { status: failedStatus === null ? 404 : failedStatus })}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-zinc-400">{t("import.failed.hint")}</p>
            </div>
          ) : null}

          {phase.kind === "preview" ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 space-y-5">
                <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-zinc-900">{t("import.section.project")}</h3>
                    <p className="text-xs text-zinc-400">{t("import.section.project.hint")}</p>
                  </div>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-zinc-400">{t("import.field.code")}</dt>
                      <dd className="mt-1 text-sm font-medium text-zinc-900" data-import-project-code="">
                        {phase.preview.project.code}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-400">{t("import.field.name")}</dt>
                      <dd className="mt-1 text-sm text-zinc-900">{phase.preview.project.name}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-zinc-400">
                        {t("import.field.region")}
                        {region === "" ? <span className="ml-1 text-rose-500">*</span> : null}
                      </dt>
                      <dd className="mt-1">
                        <RegionSelect
                          value={region}
                          valueLabel={region === "" ? "" : dictLabel(dicts, "region", region)}
                          items={dicts.region}
                          onChange={setRegion}
                          onOpenChange={setRegionPopoverOpen}
                        />
                        {region === "" ? <p className="mt-1 text-xs text-rose-600">{t("import.region.required")}</p> : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-400">{t("import.field.type")}</dt>
                      <dd className="mt-1">
                        <DictSelect
                          value={projectType}
                          items={dicts.projectType}
                          ariaLabel={t("import.field.type")}
                          placeholder={t("import.type.placeholder")}
                          renderContent={(name, item) => (
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-zinc-900/10"
                                style={{ backgroundColor: accentOfItem(item ?? undefined).color }}
                                aria-hidden="true"
                              />
                              <span className="truncate">{projectTypeText(locale, name)}</span>
                            </span>
                          )}
                          onChange={setProjectType}
                        />
                        <span className="mt-1 block text-[11px] text-zinc-400">{t("import.type.hint")}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-400">{t("import.field.managers")}</dt>
                      <dd className="mt-1 text-sm text-zinc-900">
                        {phase.preview.project.managerNames.length === 0 ? t("import.value.none") : phase.preview.project.managerNames.join("、")}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                  <h3 className="text-sm font-semibold text-zinc-900">{t("import.stats.title")}</h3>
                  <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <StatTile label={t("import.stats.tasks")} value={phase.preview.counts.tasks} />
                    <StatTile label={t("import.stats.reports")} value={phase.preview.counts.reports} />
                    <StatTile label={t("import.stats.changes")} value={phase.preview.counts.changes} />
                    <StatTile
                      label={t("import.stats.images")}
                      value={phase.preview.counts.images}
                      caption={phase.preview.counts.imagesManual === 0 ? undefined : t("import.stats.images.manual", { n: phase.preview.counts.imagesManual })}
                    />
                    <StatTile label={t("import.stats.accountsNew")} value={phase.preview.counts.accountsNew} />
                    <StatTile label={t("import.stats.nodesNew")} value={phase.preview.counts.nodesNew} />
                  </dl>
                </section>

                {phase.preview.imagesManual.length === 0 ? null : (
                  <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5" data-import-manual-images="">
                    <h3 className="text-sm font-semibold text-amber-900">{t("import.images.title", { n: phase.preview.imagesManual.length })}</h3>
                    <p className="mt-1 text-xs text-amber-800">{t("import.images.hint")}</p>
                    <ManualImageList images={phase.preview.imagesManual} />
                  </section>
                )}

                {unmatchedNodes.length === 0 ? null : (
                  <section className="rounded-2xl border border-zinc-200 bg-white p-5" data-import-unmatched-nodes="">
                    <h3 className="text-sm font-semibold text-zinc-900">{t("import.nodes.title", { n: unmatchedNodes.length })}</h3>
                    <p className="mt-1 text-xs text-zinc-500">{t("import.nodes.hint")}</p>
                    <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={addMissingNodes}
                        onChange={(event) => setAddMissingNodes(event.target.checked)}
                        className="mt-0.5 h-4 w-4"
                        data-import-add-nodes=""
                      />
                      <span>{t("import.nodes.toggle")}</span>
                    </label>
                    <ul className="mt-3 space-y-1.5">
                      {unmatchedNodes.map((node, index) => (
                        <li key={index} className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2.5 py-1.5 text-xs">
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-zinc-800">{node.name}</span>
                            {node.nameEn === null || node.nameEn === "" ? (
                              <span className="mt-0.5 block text-[11px] text-amber-600">{t("import.nodes.nameEnMissing")}</span>
                            ) : (
                              <span className="mt-0.5 block text-[11px] text-zinc-400">{node.nameEn}</span>
                            )}
                          </span>
                          <span className="shrink-0 text-[11px] text-zinc-400">{t("import.nodes.count", { n: node.taskCount })}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              <aside className="min-w-0 space-y-5">
                <section className="rounded-2xl border border-zinc-200 bg-white p-5" data-import-issues="">
                  <h3 className="text-sm font-semibold text-zinc-900">{t("import.issues.title", { n: visibleIssues.length })}</h3>
                  {visibleIssues.length === 0 ? (
                    <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{t("import.issues.clean")}</p>
                  ) : (
                    <ul className="mt-2">
                      {visibleIssues.map((issue, index) => (
                        <IssueRow key={index} issue={issue} />
                      ))}
                    </ul>
                  )}
                  {blockingCount === 0 ? null : (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" data-import-blocking="">
                      {t("import.issues.blocking", { n: blockingCount })}
                    </p>
                  )}
                </section>

                {phase.preview.accounts.length === 0 ? null : (
                  <section className="rounded-2xl border border-zinc-200 bg-white p-5" data-import-accounts="">
                    <h3 className="text-sm font-semibold text-zinc-900">{t("import.accounts.title", { n: phase.preview.accounts.length })}</h3>
                    <p className="mt-1 text-xs text-zinc-400">{t("import.accounts.hint")}</p>
                    <ul className="mt-3 space-y-1.5">
                      {phase.preview.accounts.map((account, index) => (
                        <li key={index} className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2.5 py-1.5 text-xs">
                          <span className="font-medium text-zinc-800">{account.displayName}</span>
                          <span className="text-zinc-400">{account.username}</span>
                          <span
                            className={
                              "ml-auto rounded-md px-1.5 py-0.5 text-[11px] " +
                              (account.isNew ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500")
                            }
                          >
                            {account.isNew ? t("import.accounts.new") : t("import.accounts.existing")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </aside>
            </div>
          ) : null}

          {phase.kind === "done" ? (
            <div className="mx-auto max-w-2xl">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-emerald-500">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="mt-3 text-base font-semibold text-zinc-900" data-import-done="">{t("import.done.title")}</p>
                <p className="mt-1 text-sm text-zinc-600">{t("import.done.desc", { code: phase.result.code, name: phase.result.name })}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  {t("import.done.counts", {
                    tasks: phase.result.counts.tasks,
                    reports: phase.result.counts.reports,
                    changes: phase.result.counts.changes,
                    images: phase.result.counts.images,
                    accounts: phase.result.counts.accountsCreated,
                    nodes: phase.result.counts.nodesAdded,
                  })}
                </p>
              </div>

              {phase.result.issues.length === 0 ? null : (
                <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5" data-import-done-issues="">
                  <h3 className="text-sm font-semibold text-zinc-900">{t("import.done.issues")}</h3>
                  <ul className="mt-2">
                    {phase.result.issues.map((issue, index) => (
                      <IssueRow key={index} issue={issue} />
                    ))}
                  </ul>
                </section>
              )}

              {phase.preview.imagesManual.length === 0 ? null : (
                <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
                  <h3 className="text-sm font-semibold text-amber-900">{t("import.images.title", { n: phase.preview.imagesManual.length })}</h3>
                  <p className="mt-1 text-xs text-amber-800">{t("import.images.hint")}</p>
                  <ManualImageList images={phase.preview.imagesManual} />
                </section>
              )}
            </div>
          ) : null}
        </ScrollArea>

        <footer className="flex flex-wrap items-center gap-3 border-t border-zinc-200 bg-zinc-50/70 px-6 py-4">
          {phase.kind === "preview" ? (
            <>
              <p className="text-xs text-zinc-500">
                {blockingCount > 0
                  ? t("import.commit.blocked", { n: blockingCount })
                  : t("import.commit.summary", {
                      code: phase.preview.project.code,
                      tasks: phase.preview.counts.tasks,
                      reports: phase.preview.counts.reports,
                      changes: phase.preview.counts.changes,
                    })}
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button type="button" className={secondaryButtonClass} onClick={onReselect} data-import-reselect="">
                  {t("import.reselect")}
                </button>
                <button type="button" className={secondaryButtonClass} onClick={onClose}>
                  {t("import.cancel")}
                </button>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={!canCommit}
                  onClick={() => {
                    startCommit(phase.preview);
                  }}
                  data-import-commit=""
                >
                  {t("import.commit")}
                </button>
              </div>
            </>
          ) : null}

          {phase.kind === "failed" ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" className={secondaryButtonClass} onClick={onReselect} data-import-retry="">
                {t("import.retry")}
              </button>
              <button type="button" className={secondaryButtonClass} onClick={onClose}>
                {t("import.close")}
              </button>
            </div>
          ) : null}

          {phase.kind === "done" ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" className={primaryButtonClass} onClick={onClose} data-import-finish="">
                {t("import.close")}
              </button>
            </div>
          ) : null}

        </footer>
      </div>
    </div>
  );
}
