import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ensurePreviewOutcome, fetchDownloadUrl, previewKindOf, triggerDownload, type FilePreviewKind, type PreviewViewerConfig, type TaskFileRef } from "../fileApi";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { FileTypeIcon } from "./FileTypeIcon";
import { RowDeleteButton } from "./RowDeleteButton";
import { usePopover } from "./usePopover";

/** 「替换」按钮（2026-10-08 · 业务口径「增加一个替换按钮 点击替换则选择新文件代替」）：与行删除同款的
 *  「幽灵态 → 悬停展开胶囊」动效（RowDeleteButton 的姐妹件，不改它），颜色取中性墨色（不抢删除的红）；
 *  图标 = 业务给的 iconfont 替换图标（folder + 双箭头，1024 viewBox，fill 跟字色）。 */
function RowReplaceButton({ onReplace, label }: { onReplace: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onReplace();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="group/rep relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-transparent text-zinc-300 opacity-0 transition-[width,background-color,color,opacity] duration-300 ease-out hover:w-12 hover:bg-blue-700 hover:text-white focus-visible:w-12 focus-visible:bg-blue-700 focus-visible:text-white focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
    >
      <span className="pointer-events-none absolute -translate-y-3 text-[11px] font-semibold opacity-0 transition-all duration-300 group-hover/rep:translate-y-0 group-hover/rep:opacity-100 group-focus-visible/rep:translate-y-0 group-focus-visible/rep:opacity-100">
        替换
      </span>
      <svg viewBox="0 0 1024 1024" aria-hidden="true" className="h-4 w-4 shrink-0 transition-all duration-300 group-hover/rep:translate-y-4 group-hover/rep:scale-[1.6] group-hover/rep:opacity-0 group-focus-visible/rep:translate-y-4 group-focus-visible/rep:scale-[1.6] group-focus-visible/rep:opacity-0">
        <path fill="currentColor" d="M400.541538 196.923077c20.873846 0 40.96 8.270769 55.926154 23.236923L512 275.692308h315.076923c43.323077 0 78.769231 35.446154 78.769231 78.76923v393.846154c0 43.323077-35.446154 78.769231-78.769231 78.769231H196.923077c-43.323077 0-78.769231-35.446154-78.769231-78.769231V275.692308c0-43.323077 35.446154-78.769231 78.769231-78.769231z m293.612308 320.315077h-55.611077l2.993231 10.121846 2.244923 8.625231a123.746462 123.746462 0 0 1-31.901538 112.600615l-2.756923 2.756923-5.907693 5.316923a122.958769 122.958769 0 0 1-79.950769 29.380923l-8.664615-0.275692-8.664616-0.905846a122.88 122.88 0 0 1-33.122461-9.570462l-0.393846-0.196923 27.254153-45.292307H359.305846l5.632 11.342769 4.056616 7.719384a176.64 176.64 0 0 0 154.269538 90.427077c36.588308 0.078769 87.355077-18.983385 110.473846-38.754461 12.996923-11.106462 22.252308-20.361846 27.766154-27.884308a177.152 177.152 0 0 0 34.028308-149.267692l-1.378462-6.144zM523.224615 385.969231l-8.270769 0.196923a176.600615 176.600615 0 0 0-163.997538 215.709538l1.378461 6.144h55.650462l-3.032616-10.121846-2.205538-8.585846a123.352615 123.352615 0 0 1 120.516923-150.055385l8.664615 0.275693 8.664616 0.905846c11.421538 1.575385 22.606769 4.844308 33.437538 9.688615l-27.175384 45.371077h140.366769l-5.671385-11.382154-4.056615-7.719384A176.64 176.64 0 0 0 523.264 385.969231z" />
      </svg>
    </button>
  );
}

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
 *  - 行尾「替换」（2026-10-08 · 业务口径「增加一个替换按钮 点击替换则选择新文件代替」）= 与删除同款动效的宝蓝色胶囊（2026-10-08 业务口径「替换改成宝蓝色的」；图标 16px、向删除侧收拢）：
 *    未定档（draft）直替（intent=version，版本链追加、名称不变）；已定档 / 已变更 = 先在行内填「变更原因」（必填）
 *    再选新文件（intent=change，A4-13 申请即通过），成功 / 失败都在下拉里留一行提示；
 *  - 上传 / 进度 / 删除确认 / 替换都托管在本组件：关掉下拉后台上传继续、重开还在；预览打开时收起下拉；
 *  - 点击冒泡（2026-10-08 修正 · 业务口径「点击这部分内容现在抽屉也会出来 是bug」）：portal 的 click 按 **React 树**冒泡 ——
 *    根节点拦一道 stopPropagation，点下拉里的空白 / 图标 / 提示条不再冒到任务行（行点击 = 开详情抽屉）。 */
export function TaskFilesPopover({ taskId, taskTitle, files, onUpload, onDelete, onReplace, children }: {
  taskId: string;
  taskTitle: string;
  files: readonly TaskFileRef[];
  onUpload?: (taskId: string, files: File[], onProgress?: (done: number, total: number) => void) => Promise<void>;
  onDelete?: (fileId: string) => Promise<void>;
  /** 替换文件内容（2026-10-08）：未定档直替（reason=null）；已定档 / 已变更携变更原因（reason 必填非空）；不传 = 不显示替换入口。 */
  onReplace?: (file: TaskFileRef, picked: File, reason: string | null) => Promise<void>;
  children: ReactNode;
}) {
  const measuredHeight = Math.min(430, 84 + Math.max(files.length, 1) * 30);
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(276, measuredHeight, "right");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<TaskFileRef | null>(null);
  const [replaceReasonFor, setReplaceReasonFor] = useState<string | null>(null);
  const [replaceReason, setReplaceReason] = useState("");
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replaceNote, setReplaceNote] = useState<string | null>(null);
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

  /** 点「替换」：未定档 = 直接开选文件框；已定档 / 已变更 = 先在行内填「变更原因」（A4-13 申请即通过）。 */
  const beginReplace = (file: TaskFileRef) => {
    if (onReplace === undefined) {
      return;
    }
    setReplaceNote(null);
    setPreviewNote(null);
    setPendingDelete(null);
    if (file.status === "final" || file.status === "changed") {
      setReplaceReason("");
      setReplaceReasonFor(file.id);
      return;
    }
    setReplaceReasonFor(null);
    setReplaceTarget(file);
    replaceInputRef.current?.click();
  };

  /** 变更原因确认（必填）→ 存目标并开选文件框（同一个用户手势里点 input）。 */
  const confirmReplaceReason = (file: TaskFileRef) => {
    if (replaceReason.trim() === "") {
      return;
    }
    setReplaceReasonFor(null);
    setReplaceTarget(file);
    replaceInputRef.current?.click();
  };

  /** 选完文件 → 直替 / 变更替换；成功 / 失败都在下拉里留一行提示（替换中该行显示「替换中…」）。 */
  const beginReplaceUpload = (picked: FileList | null) => {
    const target = replaceTarget;
    setReplaceTarget(null);
    if (picked === null || picked.length === 0 || target === null || onReplace === undefined) {
      return;
    }
    const pickedFile = picked[0];
    const needsChange = target.status === "final" || target.status === "changed";
    setReplacingId(target.id);
    void onReplace(target, pickedFile, needsChange ? replaceReason.trim() : null)
      .then(() => {
        setReplaceNote("已替换「" + target.name + "」" + (needsChange ? "（变更已生效）" : "（已生成新版本）"));
      })
      .catch((error) => {
        setReplaceNote(error instanceof Error && error.message !== "" ? error.message : "替换失败，请稍后再试");
      })
      .finally(() => {
        setReplacingId(null);
        setReplaceReason("");
      });
  };

  const replacePromptFile = replaceReasonFor === null ? null : files.find((item) => item.id === replaceReasonFor) ?? null;

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
          onClick={(event) => {
            // portal 的点击按 React 树冒泡：不拦的话，点下拉里的空白 / 图标 / 提示条会冒到任务行、连带开详情抽屉（同 InlineEdit / FilePreviewOverlay 口径）
            event.stopPropagation();
          }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
        >
          <button
            type="button"
            data-task-files-add="true"
            onClick={() => { inputRef.current?.click(); }}
            disabled={uploading !== null}
            title="添加文件（关联到本任务）"
            className="flex items-center gap-1 px-3 py-2 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
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
          <input
            ref={replaceInputRef}
            type="file"
            data-task-files-replace-input="true"
            className="hidden"
            aria-label="选择用于替换的文件"
            onClick={(event) => {
              // 同「添加文件」：拦住选文件对话框关掉后补发的 click，不让它冒泡出下拉
              event.stopPropagation();
            }}
            onChange={(event) => {
              beginReplaceUpload(event.currentTarget.files);
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
                    <li key={file.id} data-task-files-item="true" className="group flex min-w-0 items-center gap-1.5 px-2 py-1 transition-colors hover:bg-zinc-100">
                      <FileTypeIcon name={file.name} />
                      <button
                        type="button"
                        data-task-files-preview="true"
                        onClick={() => { void openPreview(file.id, file.name); }}
                        disabled={previewingThis}
                        title={"点击预览：" + file.name}
                        className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs text-zinc-700 transition-colors hover:text-zinc-900 disabled:text-zinc-400"
                      >
                        {file.name}
                      </button>
                      {previewingThis ? <span className="shrink-0 text-[10px] text-zinc-400">预览中…</span> : null}
                      {onReplace === undefined || confirming || file.status === "archived" || file.status === "recycled" ? null : replacingId === file.id ? (
                        <span data-task-files-replacing="true" className="shrink-0 text-[10px] text-zinc-400">替换中…</span>
                      ) : (
                        <span data-task-files-replace="true" className="flex h-6 w-12 shrink-0 items-center justify-end">
                          <RowReplaceButton
                            onReplace={() => { beginReplace(file); }}
                            label={"替换文件内容（选择新文件代替）：" + file.name}
                          />
                        </span>
                      )}
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
          {replacePromptFile === null ? null : (
            <div data-task-files-replace-prompt="true" className="border-t border-zinc-100 px-3 py-2">
              <p className="text-[11px] leading-4 text-zinc-500">已定档文件改动走变更（申请即通过）—— 请填写变更原因</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  data-task-files-replace-reason="true"
                  value={replaceReason}
                  onChange={(event) => { setReplaceReason(event.target.value); }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setReplaceReasonFor(null);
                      setReplaceReason("");
                    }
                  }}
                  placeholder="变更原因（必填）"
                  className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-zinc-300"
                />
                <button
                  type="button"
                  data-task-files-replace-confirm="true"
                  disabled={replaceReason.trim() === ""}
                  onClick={() => { confirmReplaceReason(replacePromptFile); }}
                  className="flex h-6 shrink-0 items-center justify-center rounded-full bg-zinc-600 px-2.5 text-[11px] font-semibold leading-none text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                >
                  确认替换
                </button>
                <button
                  type="button"
                  onClick={() => { setReplaceReasonFor(null); setReplaceReason(""); }}
                  className="flex h-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 px-2.5 text-[11px] font-medium leading-none text-zinc-600 transition-colors hover:bg-zinc-200"
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {replaceNote === null ? null : <p data-task-files-note-replace="true" className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400">{replaceNote}</p>}
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
