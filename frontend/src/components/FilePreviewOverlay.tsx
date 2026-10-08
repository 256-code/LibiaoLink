import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { FilePreviewKind, PreviewViewerConfig } from "../fileApi";
import { OnlyOfficeViewer } from "./OnlyOfficeViewer";

/** 预览浮层（Push 226 续 / 续三 · S4 · Push 246 起任务列表「文件」列下拉与详情抽屉共用）：
 *  图片 = 大图（img）、PDF = 浏览器内置查看器（iframe）、Office / 文本族 = ONLYOFFICE 查看器外壳
 *  （OnlyOfficeViewer；加载 → 就绪 / 超时 / 失败降级，重试自增 nonce 重建）。
 *  短时签名地址（D2-04 禁止匿名读取）。Esc / 点浮层关闭；capture 阶段拦 keydown，避免同一按 Esc
 *  连带把外层（详情抽屉 / 文件下拉）关掉（「Esc 先关内层」口径）。
 *  Push 226 续四：caption 挂「下载原文件」—— 查看器自带的下载拿的是**转换产物**，这里直取原文件。 */
export function FilePreviewOverlay({ pane, name, kind, nonce, zClass = "z-[60]", onRetry, onDownload, onClose }: {
  pane: { mode: "url"; url: string } | { mode: "viewer"; viewer: PreviewViewerConfig };
  name: string;
  kind: FilePreviewKind;
  nonce: number;
  /** 浮层层级（Push 256 续：变更详情弹窗内的预览要盖在弹窗 z-[70] 之上 → 传 z-[80]；默认同抽屉口径 z-[60]）。 */
  zClass?: string;
  onRetry: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  return createPortal(
    <div
      data-file-preview="true"
      data-file-preview-kind={kind}
      role="dialog"
      aria-label={"预览 " + name}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      className={"fixed inset-0 " + zClass + " flex items-center justify-center bg-zinc-900/60 p-6"}
    >
      <figure className="flex max-h-full max-w-full flex-col items-center">
        {pane.mode === "viewer" ? (
          <OnlyOfficeViewer key={nonce} viewer={pane.viewer} onRetry={onRetry} />
        ) : kind === "pdf" ? (
          <iframe
            src={pane.url}
            title={name}
            data-file-preview-frame="true"
            className="h-[80vh] w-[min(90vw,calc(100vw-3rem))] rounded-xl bg-white shadow-2xl"
          />
        ) : (
          <img src={pane.url} alt={name} className="max-h-[80vh] max-w-[min(90vw,calc(100vw-3rem))] rounded-xl bg-white p-1 shadow-2xl" />
        )}
        <figcaption className="mt-2 flex items-center gap-3 text-xs text-white/80">
          <span>{name}</span>
          <button
            type="button"
            data-file-preview-download="true"
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
            className="rounded-md border border-white/30 px-2 py-0.5 text-[11px] text-white/90 transition hover:bg-white/10"
          >
            下载原文件
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}
