import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { memberNameOf, type Member } from "../data/members";
import {
  ensurePreviewOutcome,
  fetchChangeRequest,
  fetchDownloadUrl,
  previewKindOf,
  triggerDownload,
  type ChangeRequestDetail,
  type FilePreviewKind,
  type PreviewViewerConfig,
} from "../fileApi";
import { stageNameOf } from "../taskApi";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { FileTypeIcon } from "./FileTypeIcon";

/**
 * 「变更管理」详情弹窗（Push 256 · 业务口径「变更关联点击后要显示一个这样的内容在中间」）：
 * 抽屉「变更关联」行 / 任务表「变更关联」列点击后在**屏幕中央**弹出 —— 版式对齐源表「变更管理」明细
 * （「来自 ▦ 变更管理」标题条 + 大日期 + 逐行：变更时间 / 变更阶段 / 变更文件 / 变更内容描述 / 变更前 /
 * 变更后 / 变更原因 / 变更申请人 / 填写者 / 进度 / 变更后文件版本 / 变更后文件 / 关联）。
 * 数据 = 变更详情（GET /change-requests/{id}，按需取 + 失败可重试）+ 当前上下文任务标题（关联行）；
 * Esc / 点遮罩关闭；capture 阶段拦 keydown（「Esc 先关内层」—— 抽屉仍开时只关弹窗，不连带关抽屉）。
 * Push 256 续（业务反馈「这两个要可以点击 点击文件预览 点击布局定档抽屉显示」）：①「变更后文件」卡 = 可点击 →
 * 弹内版本态预览（A4-06；浮层 z 提到弹窗之上，「Esc 先关预览、弹窗仍在」）；②「关联」= 可点击 → 打开回写任务抽屉
 * （onOpenLinkedTask 由调用方给：任务表 = 选中该行开抽屉；抽屉内 = 关弹窗露出抽屉本身）。
 * 「变更文件」行口径（业务口径「变更文件就是输出文件成果这个类型」）：文件成果类型为空时回退所属任务的「输出成果文件」。
 */
export function ChangeDetailModal({ changeId, linkedTaskTitle, members, deliverableTypes, onOpenLinkedTask, onClose }: {
  changeId: string;
  /** 「关联」行：本次变更回写的任务（当前上下文任务标题；未知 = null → 显示「—」）。 */
  linkedTaskTitle: string | null;
  members: readonly Member[];
  /** 所属任务「输出成果文件」类型（业务口径：变更文件就是这个类型；文件自身 docType 空时回退展示）。 */
  deliverableTypes: readonly string[];
  /** 「关联」点击：打开回写任务抽屉（不传 / null = 该行不可点，只展示）。 */
  onOpenLinkedTask?: (() => void) | null;
  onClose: () => void;
})
{
  const [detail, setDetail] = useState<ChangeRequestDetail | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  /** 弹内预览（Push 256 续）：非空 = 版本态预览浮层（浮层 z 高于本弹窗；Esc 先关它）。 */
  const [preview, setPreview] = useState<{ pane: { mode: "url"; url: string } | { mode: "viewer"; viewer: PreviewViewerConfig }; name: string; kind: FilePreviewKind; nonce: number } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setNote(null);
    fetchChangeRequest(changeId)
      .then((row) => {
        if (alive) {
          setDetail(row);
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setNote(error instanceof Error && error.message !== "" ? error.message : "变更详情取不到");
        }
      });
    return () => {
      alive = false;
    };
  }, [changeId, retryTick]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        // 「Esc 先关内层」：弹内预览开着先关预览（弹窗仍在），否则关弹窗。
        if (previewRef.current !== null) {
          setPreview(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const split = detail === null ? { content: "", cause: "" } : splitChangeReason(detail.reason);
  const applicantId = detail === null ? "" : detail.appliedBy;
  const applicantName = memberNameOf(members, applicantId) ?? (applicantId === "" ? "成员" : applicantId);
  const applicant = members.find((member) => member.id === applicantId);
  const applicantLabel = applicantHandleText(applicantName, applicant === undefined ? null : applicant.handle);
  /** 「变更文件」展示类型（业务口径「变更文件就是输出文件成果这个类型」）：文件自身 docType 空 → 回退任务输出成果文件。 */
  const fileTypeText = detail === null ? null : detail.file.docType === null ? deliverableTypes[0] ?? null : detail.file.docType;

  /** 打开「变更后文件」预览（版本态 A4-06；失败灰字 + 可重试）。 */
  const openFilePreview = async () => {
    if (detail === null || previewBusy) {
      return;
    }
    setPreviewBusy(true);
    setPreviewNote(null);
    const outcome = await ensurePreviewOutcome(detail.file.id, detail.versionId);
    setPreviewBusy(false);
    if (outcome.kind === "unavailable") {
      setPreviewNote(outcome.reason ?? "暂不支持在线预览，请下载查看");
      return;
    }
    setPreview((previous) => ({
      pane: outcome.kind === "viewer" ? { mode: "viewer", viewer: outcome.viewer } : { mode: "url", url: outcome.url },
      name: detail.file.name,
      kind: previewKindOf(detail.file.name) ?? "image",
      nonce: previous === null ? 0 : previous.nonce + 1,
    }));
  };

  /** 弹内预览「下载原文件」（版本态签名；落盘名随版本对象键扩展名 —— 与抽屉 / 变更记录同口径）。 */
  const downloadPreviewFile = async () => {
    if (detail === null) {
      return;
    }
    const signed = await fetchDownloadUrl(detail.file.id, detail.versionId);
    triggerDownload(signed.url, signed.fileName);
  };

  return createPortal(
    <div
      data-change-modal="true"
      role="dialog"
      aria-label="变更管理详情"
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/40 p-6"
    >
      <div
        onClick={(event) => { event.stopPropagation(); }}
        className="flex max-h-[86vh] w-[430px] max-w-[94vw] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2.5">
          <span className="text-[13px] text-zinc-500">来自</span>
          <RowIcon kind="grid" />
          <span className="flex-1 text-[13px] font-medium text-zinc-700">变更管理</span>
          <IconButton label="收起" dataAttr="data-change-modal-collapse" onClick={() => { setCollapsed(true); }}><RowIcon kind="up" /></IconButton>
          <IconButton label="展开" dataAttr="data-change-modal-expand" onClick={() => { setCollapsed(false); }}><RowIcon kind="down" /></IconButton>
          <IconButton label="关闭" dataAttr="data-change-modal-close" onClick={onClose}><RowIcon kind="close" /></IconButton>
        </header>
        {collapsed ? null : (
          <div data-change-modal-body="true" className="min-h-0 flex-1 overflow-y-auto">
            {detail === null ? (
              note === null ? (
                <p data-change-modal-busy="true" className="px-6 py-10 text-center text-xs text-zinc-400">加载中…</p>
              ) : (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <p data-change-modal-note="true" className="text-xs leading-5 text-zinc-400">{note}</p>
                  <button
                    type="button"
                    data-change-modal-retry="true"
                    onClick={() => { setRetryTick((tick) => tick + 1); }}
                    className="rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 transition hover:bg-zinc-50"
                  >
                    重试
                  </button>
                </div>
              )
            ) : (
              <>
                <p data-change-modal-date="true" className="px-6 pt-5 text-[26px] font-semibold tracking-tight text-zinc-900">{slashDate(detail.appliedAt)}</p>
                <dl className="flex flex-col gap-4 px-6 pb-6 pt-4">
                  <DetailRow kind="calendar" label="变更时间" testKey="time">{slashDate(detail.appliedAt)}</DetailRow>
                  <DetailRow kind="check" label="变更阶段" testKey="stage">
                    <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[12px] text-zinc-600">{stageLabelOf(detail.stageKey)}</span>
                  </DetailRow>
                  <DetailRow kind="doc" label="变更文件" testKey="file">
                    {fileTypeText === null ? <span className="text-zinc-400">—</span> : (
                      <span data-change-modal-doc-type="true" className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[12px] font-medium text-amber-700">{fileTypeText}</span>
                    )}
                  </DetailRow>
                  <DetailRow kind="doc" label="变更内容描述" testKey="content">{textOrDash(split.content)}</DetailRow>
                  <DetailRow kind="image" label="变更前" testKey="before">{textOrDash(detail.beforeSummary)}</DetailRow>
                  <DetailRow kind="image" label="变更后" testKey="after">{textOrDash(detail.afterSummary)}</DetailRow>
                  <DetailRow kind="doc" label="变更原因" testKey="cause">{textOrDash(split.cause)}</DetailRow>
                  <DetailRow kind="person" label="变更申请人" testKey="applicant">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[12px] text-zinc-700" title={applicantId}>
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-400 text-[9px] font-medium text-white">{applicantName.slice(0, 1)}</span>
                      {applicantLabel}
                    </span>
                  </DetailRow>
                  <DetailRow kind="person" label="填写者" testKey="writer">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[12px] text-zinc-700">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-400 text-[9px] font-medium text-white">{applicantName.slice(0, 1)}</span>
                      {applicantLabel}
                    </span>
                  </DetailRow>
                  <DetailRow kind="check" label="进度" testKey="progress"><span className="text-zinc-400">—</span></DetailRow>
                  <DetailRow kind="doc" label="变更后文件版本" testKey="version">{detail.file.name + "（v" + String(detail.versionSeq) + "）"}</DetailRow>
                  <DetailRow kind="file" label="变更后文件" testKey="after-file">
                    <button
                      type="button"
                      data-change-modal-file-card="true"
                      data-change-modal-file-open="true"
                      title="点击预览"
                      disabled={previewBusy}
                      onClick={() => { void openFilePreview(); }}
                      className="inline-flex w-[120px] flex-col items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-progress"
                    >
                      <FileTypeIcon name={detail.file.name} className="h-6 w-6" />
                      <span className="line-clamp-2 w-full break-all text-center text-[11px] leading-4 text-zinc-500" title={detail.file.name}>{detail.file.name}</span>
                    </button>
                    {previewBusy ? <span className="ml-1 align-middle text-[11px] text-zinc-400">打开预览…</span> : null}
                    {previewNote === null ? null : <span data-change-modal-file-note="true" className="mt-1 block text-[11px] leading-4 text-rose-500">{previewNote}</span>}
                  </DetailRow>
                  <DetailRow kind="link" label="关联" testKey="links">
                    {linkedTaskTitle === null ? <span className="text-zinc-400">—</span> : onOpenLinkedTask === undefined || onOpenLinkedTask === null ? (
                      <span data-change-modal-link="true" className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[12px] text-zinc-600">
                        <RowIcon kind="link" />
                        {linkedTaskTitle}
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-change-modal-link="true"
                        data-change-modal-link-open="true"
                        title="打开任务抽屉"
                        onClick={onOpenLinkedTask}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[12px] text-zinc-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                      >
                        <RowIcon kind="link" />
                        {linkedTaskTitle}
                      </button>
                    )}
                  </DetailRow>
                </dl>
              </>
            )}
          </div>
        )}
      </div>
      {preview === null ? null : (
        <FilePreviewOverlay
          pane={preview.pane}
          name={preview.name}
          kind={preview.kind}
          nonce={preview.nonce}
          zClass="z-[80]"
          onRetry={() => { void openFilePreview(); }}
          onDownload={() => { void downloadPreviewFile(); }}
          onClose={() => { setPreview(null); }}
        />
      )}
    </div>,
    document.body,
  );
}

/** 行（图标 + 标签 + 值）：版式对齐源表「变更管理」明细；data-change-modal-row 供回放断言。 */
function DetailRow({ kind, label, testKey, children }: { kind: IconKind; label: string; testKey: string; children: ReactNode }) {
  return (
    <div data-change-modal-row={testKey} className="flex items-start gap-3">
      <RowIcon kind={kind} />
      <dt className="w-[92px] shrink-0 pt-px text-[13px] text-zinc-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] leading-5 text-zinc-800">{children}</dd>
    </div>
  );
}

/** 标题条小图标按钮（收起 / 展开 / 关闭）。 */
function IconButton({ label, dataAttr, onClick, children }: { label: string; dataAttr: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...({ [dataAttr]: "true" } as Record<string, string>)}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
    >
      {children}
    </button>
  );
}

type IconKind = "grid" | "calendar" | "check" | "doc" | "image" | "person" | "file" | "link" | "up" | "down" | "close";

/** 行图标（内联 SVG · stroke 风格对齐源表；颜色随文字——标题条按钮内为按钮色）。 */
function RowIcon({ kind }: { kind: IconKind }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-500">
      {kind === "grid" ? (<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M10 4v16" /></>) : null}
      {kind === "calendar" ? (<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>) : null}
      {kind === "check" ? (<><circle cx="12" cy="12" r="9" /><path d="M8.4 12.3l2.5 2.5 4.7-5.2" /></>) : null}
      {kind === "doc" ? (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>) : null}
      {kind === "image" ? (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4.5 18.5l4.5-4 3.5 3 3-2.5 4 3.5" /></>) : null}
      {kind === "person" ? (<><circle cx="12" cy="8.5" r="3.2" /><path d="M5.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /></>) : null}
      {kind === "file" ? (<><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" /><path d="M13 3v6h6" /></>) : null}
      {kind === "link" ? (<><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1-1" /></>) : null}
      {kind === "up" ? (<path d="M6 14.5l6-6 6 6" />) : null}
      {kind === "down" ? (<path d="M6 9.5l6 6 6-6" />) : null}
      {kind === "close" ? (<path d="M6 6l12 12M18 6L6 18" />) : null}
    </svg>
  );
}

/** 变更阶段展示（空 / 未知 → 「—」）。 */
function stageLabelOf(stageKey: string | null): string {
  const label = stageNameOf(stageKey);
  return label === "" ? "—" : label;
}

/** 变更原因拆分（前端提交口径：内容描述 + 「；变更原因：」+ 原因；无标记 = 全文即内容描述，原因「—」）。 */
function splitChangeReason(reason: string): { content: string; cause: string } {
  const marker = "；变更原因：";
  const at = reason.indexOf(marker);
  if (at < 0) {
    return { content: reason, cause: "" };
  }
  return { content: reason.slice(0, at), cause: reason.slice(at + marker.length) };
}

/** 空文本 → 「—」。 */
function textOrDash(text: string | null): ReactNode {
  return text === null || text.trim() === "" ? <span className="text-zinc-400">—</span> : text;
}

/** 申请人展示（名字 + (工号)；无工号 = 只有名字）。 */
function applicantHandleText(name: string, handle: string | null): string {
  return handle === null || handle === "" ? name : name + "(" + handle + ")";
}

/** ISO 时间戳 → 「YYYY/M/D」（对齐源表大日期口径）。 */
function slashDate(iso: string): string {
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) {
    return iso;
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(day).split("-");
  return String(Number(parts[0])) + "/" + String(Number(parts[1])) + "/" + String(Number(parts[2]));
}
