import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ensurePreviewOutcome, fetchDownloadUrl, previewKindOf, triggerDownload, type FilePreviewKind, type PreviewViewerConfig, type TaskFileRef } from "../fileApi";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { FileTypeIcon } from "./FileTypeIcon";
import { RowDeleteButton } from "./RowDeleteButton";
import { usePopover } from "./usePopover";

/** 任务列表「文件」列下拉（Push 246 · 业务口径 2026-10-08「这里点击后出现右侧下拉框吧 最上方是添加文件
 *  下方是已有文件 点击即可预览 也有删除按钮」）：
 *  - 触发器 = 「文件」列胶囊（内容沿用「文件名 + +N」/「N 份」/「—」，液态玻璃样式与行内可编辑单元格同款）；
 *  - 下拉优先贴右侧展开（放不下自动回落上下 —— usePopover placement "right" 口径）：
 *    顶部「＋ 添加文件」（隐藏多选 input，上传中「上传中 N/M」）+ 已有文件清单（服务端默认序 = 最新在前）；
 *  - 点文件名 = 预览（与详情抽屉同一套两通道裁决 + FilePreviewOverlay：图片大图 / PDF iframe /
 *    Office·文本 ONLYOFFICE 查看器外壳；R5 降级在同一下拉内出一行灰字提示）；
 *  - 行尾「删除」= 与任务表行删除**同款胶囊**（业务口径 2026-10-08「和胶囊的一样」—— 复用 RowDeleteButton：
 *    随行悬停浮现 24px 幽灵态、悬停按钮展开 48px 红胶囊「删除」，动效一致）→ 行内二次确认「确认删除 / 取消」，
 *    第二下才移入回收站（M4-02）；
 *  - 上传 / 进度 / 删除确认都托管在本组件：关掉下拉后台上传继续、重开还在；预览打开时收起下拉。 */
export function TaskFilesPopover({ taskId, taskTitle, files, onUpload, onDelete, children }: {
  taskId: string;
  taskTitle: string;
  files: readonly TaskFileRef[];
  onUpload?: (taskId: string, files: File[], onProgress?: (done: number, total: number) => void) => Promise<void>;
  onDelete?: (fileId: string) => Promise<void>;
  children: ReactNode;
}) {
  const measuredHeight = Math.min(430, 84 + Math.max(files.length, 1) * 30);
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(276, measuredHeight, "right");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    pane: { mode: "url"; url: string } | { mode: "viewer"; viewer: PreviewViewerConfig };
    name: string;
    kind: FilePreviewKind;
    fileId: string;
    nonce: number;
  } | null>(null);

  /** 选完文件 → 交调用方分片直传（关联本任务）；关掉下拉后台上传继续（进度状态留在本组件）。 */
  const beginFileUpload = (picked: FileList | null) => {
    if (picked === null || onUpload === undefined) {
      return;
    }
    const list = Array.from(picked);
    if (list.length === 0) {
      return;
    }
    setUploading({ done: 0, total: list.length });
    void onUpload(taskId, list, (done, total) => {
      setUploading({ done, total });
    }).finally(() => {
      setUploading(null);
    });
  };

  /** 点文件名 = 预览（两通道裁决同详情抽屉；取不到 → 下拉内一行灰字降级，不弹浮层）。 */
  const openPreview = async (fileId: string, name: string) => {
    if (previewing !== null) {
      return;
    }
    setPreviewing(fileId);
    setPreviewNote(null);
    const outcome = await ensurePreviewOutcome(fileId);
    setPreviewing(null);
    if (outcome.kind === "unavailable") {
      setPreviewNote(outcome.reason ?? "暂不支持在线预览，请下载查看");
      return;
    }
    const kind = previewKindOf(name) ?? "image";
    setPreview(outcome.kind === "viewer"
      ? { pane: { mode: "viewer", viewer: outcome.viewer }, name, kind, fileId, nonce: 0 }
      : { pane: { mode: "url", url: outcome.url }, name, kind, fileId, nonce: 0 });
    setOpen(false);
  };

  /** 查看器外壳「重试」（R5）：重取配置 + nonce 自增强制重建；仍取不到 → 关浮层 + 下拉一行降级提示。 */
  const retryPreview = async (fileId: string, name: string) => {
    setPreviewing(fileId);
    const outcome = await ensurePreviewOutcome(fileId);
    setPreviewing(null);
    if (outcome.kind === "unavailable") {
      setPreview(null);
      setPreviewNote(outcome.reason ?? "暂不支持在线预览，请下载查看");
      return;
    }
    setPreview((previous) => {
      if (previous === null || previous.fileId !== fileId) {
        return previous;
      }
      const pane = outcome.kind === "viewer"
        ? { mode: "viewer" as const, viewer: outcome.viewer }
        : { mode: "url" as const, url: outcome.url };
      return { pane, name, kind: previous.kind, fileId, nonce: previous.nonce + 1 };
    });
  };

  /** 浮层 caption「下载原文件」（与抽屉同口径：attachment 签名直取原文件；失败在下拉里留一行提示）。 */
  const downloadFile = async (fileId: string) => {
    try {
      const signed = await fetchDownloadUrl(fileId);
      triggerDownload(signed.url, signed.fileName);
    } catch (error) {
      setPreviewNote(error instanceof Error && error.message !== "" ? error.message : "下载失败，请稍后再试");
    }
  };

  /** 删除（同一行内二次确认；调用方走回收站 + 整表重取，失败提示由调用方统一写入出口）。 */
  const confirmDelete = (fileId: string) => {
    setPendingDelete(null);
    if (onDelete !== undefined) {
      void onDelete(fileId);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-cell-action="task-files"
        title={files.length === 0 ? "点击添加文件（关联到本任务）" : "点击管理文件（添加 / 预览 / 删除）"}
        aria-label={"任务文件（" + taskTitle + "）"}
        onClick={(event) => {
          // 「文件」列整格是管理入口：点击不冒泡到行（行点击 = 打开详情抽屉）
          event.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
          }
        }}
        className="inline-flex max-w-full items-center gap-1 rounded-lg border border-zinc-200/90 bg-white/75 px-1.5 py-[3px] text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-[3px] transition hover:border-zinc-300 hover:bg-white hover:shadow-[0_2px_6px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15 disabled:cursor-not-allowed"
      >
        {uploading !== null ? (
          <span className="tabular-nums text-zinc-500">
            {uploading.done === 0 ? "上传中…" : "上传中 " + String(uploading.done) + "/" + String(uploading.total)}
          </span>
        ) : (
          children
        )}
      </button>
      {open && position !== null ? createPortal(
        <div
          ref={popoverRef}
          data-task-files-popover="true"
          style={{ top: position.top, left: position.left, width: position.width }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
        >
          <button
            type="button"
            data-task-files-add="true"
            onClick={() => { inputRef.current?.click(); }}
            disabled={uploading !== null}
            title="添加文件（关联到本任务）"
            className="flex items-center gap-1 px-3 py-2 text-left text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            {uploading === null
              ? "＋ 添加文件"
              : uploading.done === 0 ? "上传中…" : "上传中 " + String(uploading.done) + "/" + String(uploading.total)}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            data-file-upload-input="true"
            data-task-files-input="true"
            className="hidden"
            aria-label="选择要上传到本任务的文件"
            onClick={(event) => {
              // 选文件对话框关掉后浏览器会向 input 补发一次 click：拦一道，不让它冒泡出下拉（回归 Push 226 修正）
              event.stopPropagation();
            }}
            onChange={(event) => {
              beginFileUpload(event.currentTarget.files);
              // 清空 value：同一份文件再选一次仍会触发 change
              event.currentTarget.value = "";
            }}
          />
          <div className="border-t border-zinc-100">
            {files.length === 0 ? (
              <p className="px-3 py-2.5 text-[11px] text-zinc-400">暂无文件</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto py-1">
                {files.map((file) => {
                  const confirming = pendingDelete === file.id;
                  const previewingThis = previewing === file.id;
                  return (
                    <li key={file.id} data-task-files-item="true" className="group flex min-w-0 items-center gap-1.5 px-2 py-1">
                      <FileTypeIcon name={file.name} />
                      <button
                        type="button"
                        data-task-files-preview="true"
                        onClick={() => { void openPreview(file.id, file.name); }}
                        disabled={previewingThis}
                        title={"点击预览：" + file.name}
                        className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 hover:underline disabled:text-zinc-400"
                      >
                        {file.name}
                      </button>
                      {previewingThis ? <span className="shrink-0 text-[10px] text-zinc-400">预览中…</span> : null}
                      {onDelete === undefined ? null : confirming ? (
                        <span data-task-files-delete-confirm="true" className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => { confirmDelete(file.id); }}
                            className="flex h-6 shrink-0 items-center justify-center rounded-full bg-red-500 px-2.5 text-[11px] font-semibold leading-none text-white shadow-[0_1px_2px_rgba(220,38,38,0.25)] transition-colors hover:bg-red-600"
                          >
                            确认删除
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPendingDelete(null); }}
                            className="flex h-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 px-2.5 text-[11px] font-medium leading-none text-zinc-600 transition-colors hover:bg-zinc-200"
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <span data-task-files-delete="true" className="flex h-6 w-12 shrink-0 items-center">
                          <RowDeleteButton
                            onDelete={() => { setPendingDelete(file.id); }}
                            label={"删除（移入回收站，30 天内可恢复）：" + file.name}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {previewNote === null ? null : <p data-task-files-note="true" className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400">{previewNote}</p>}
        </div>,
        document.body,
      ) : null}
      {preview === null ? null : (
        <FilePreviewOverlay
          pane={preview.pane}
          name={preview.name}
          kind={preview.kind}
          nonce={preview.nonce}
          onRetry={() => { void retryPreview(preview.fileId, preview.name); }}
          onDownload={() => { void downloadFile(preview.fileId); }}
          onClose={() => { setPreview(null); }}
        />
      )}
    </>
  );
}
