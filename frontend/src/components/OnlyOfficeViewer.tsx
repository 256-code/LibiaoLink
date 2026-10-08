import { useEffect, useId, useRef, useState } from "react";
import type { PreviewViewerConfig } from "../fileApi";

/** 查看器就绪超时（计划 S4 · R5）：api.js 加载 + DocEditor 建会话后超过此时长仍未 onDocumentReady → 降级（重试 / 下载）。 */
const READY_TIMEOUT_MS = 20_000;

type DocEditorInstance = { destroyEditor: () => void };
type DocsApiConstructor = new (placeholderId: string, config: Record<string, unknown>) => DocEditorInstance;

declare global {
  interface Window {
    /** ONLYOFFICE 官方 api.js 的挂载点（DocEditor 构造器）。 */
    DocsAPI?: { DocEditor: DocsApiConstructor };
  }
}

/** api.js 单例加载（按 URL 缓存 Promise；失败删脚本 + 清缓存 —— 重试可重新加载）。 */
const apiScripts = new Map<string, Promise<void>>();
function loadDocsApi(scriptUrl: string): Promise<void> {
  const cached = apiScripts.get(scriptUrl);
  if (cached !== undefined) {
    return cached;
  }
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.ooApi = "true";
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      apiScripts.delete(scriptUrl);
      script.remove();
      reject(new Error("查看器脚本加载失败（DocServer 不可达）"));
    };
    document.head.appendChild(script);
  });
  apiScripts.set(scriptUrl, promise);
  return promise;
}

/**
 * ONLYOFFICE 查看器外壳（计划 S4 · R5）：加载 api.js → 以服务端下发的四段 + token 逐字初始化 DocEditor。
 * 状态机（data-oo-status，供回放探测）：loading → ready / error / timeout。
 * - 只读：documentType / document / editorConfig / permissions / token 逐字传（JWT 绑定字段不改写；events 是本地回调、不参与签名）；
 * - 降级（R5）：加载失败 / onError / 超时 → 「暂无在线预览」+「重试」（父级重取配置 + nonce 自增重建）；「下载原文件」由浮层 caption 提供；
 * - 卸载（含重试重建）：destroyEditor —— 不留 DocServer 侧会话。
 */
export function OnlyOfficeViewer({ viewer, onRetry }: { viewer: PreviewViewerConfig; onRetry: () => void }) {
  const rawId = useId();
  const placeholderId = "oo-viewer-" + rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "timeout">("loading");
  const [detail, setDetail] = useState<string | null>(null);
  const editorRef = useRef<DocEditorInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeoutTimer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "timeout" : current));
    }, READY_TIMEOUT_MS);
    loadDocsApi(viewer.docServerUrl + "/web-apps/apps/api/documents/api.js")
      .then(() => {
        if (cancelled) {
          return;
        }
        const docsApi = window.DocsAPI;
        if (docsApi === undefined) {
          throw new Error("查看器脚本已加载但未挂载 DocsAPI");
        }
        editorRef.current = new docsApi.DocEditor(placeholderId, {
          width: "100%",
          height: "100%",
          documentType: viewer.documentType,
          document: viewer.document,
          editorConfig: viewer.editorConfig,
          permissions: viewer.permissions,
          token: viewer.token,
          events: {
            onDocumentReady: () => {
              if (!cancelled) {
                setStatus("ready");
              }
            },
            onError: (event: { data?: unknown }) => {
              if (cancelled) {
                return;
              }
              setDetail("查看器错误：" + (event.data === undefined ? "未知原因" : JSON.stringify(event.data)));
              setStatus("error");
            },
          },
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetail(error instanceof Error ? error.message : String(error));
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutTimer);
      const editor = editorRef.current;
      editorRef.current = null;
      if (editor !== null) {
        try {
          editor.destroyEditor();
        } catch {
          // 卸载路径允许「编辑器已销毁 / 未完成初始化」：不抛。
        }
      }
    };
  }, [placeholderId, viewer]);

  return (
    <div
      data-onlyoffice-viewer="true"
      data-oo-status={status}
      onClick={(event) => {
        event.stopPropagation();
      }}
      className="relative h-[80vh] w-[min(90vw,calc(100vw-3rem))] overflow-hidden rounded-xl bg-white shadow-2xl"
    >
      <div id={placeholderId} className="h-full w-full" />
      {status === "loading" ? (
        <span data-oo-loading="true" className="absolute inset-0 flex items-center justify-center bg-white text-xs text-zinc-400">
          查看器加载中…
        </span>
      ) : status === "ready" ? null : (
        <div data-oo-fallback="true" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-10 text-center">
          <p className="text-sm font-medium text-zinc-700">{status === "timeout" ? "在线预览超时" : "暂无在线预览"}</p>
          <p className="max-w-md text-xs leading-5 text-zinc-400">{detail ?? "查看器暂时打不开，可以重试或下载原文件查看。"}</p>
          <button
            type="button"
            data-oo-retry="true"
            onClick={(event) => {
              event.stopPropagation();
              onRetry();
            }}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
