import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { RefreshQueue, subscribeLiveRefresh, liveReadPaused, liveSyncPaused, type LiveRefresh, type LiveResource } from "./liveSync";

export function preserveViewport(apply: () => void): void {
  const scrollers = [...new Set([document.scrollingElement, ...document.querySelectorAll<HTMLElement>('[class*="overflow"], [data-live-scroll]')])]
    .filter((node): node is HTMLElement => node instanceof HTMLElement && (node.dataset.liveDateOrigin !== undefined || node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth));
  const positions = scrollers.map((node) => ({ node, left: node.scrollLeft, top: node.scrollTop, origin: Number(node.dataset.liveDateOrigin), dayWidth: Number(node.dataset.liveDateWidth) }));
  const scrollContainerOf = (node: HTMLElement): HTMLElement | null => {
    for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
      if (scrollers.includes(parent)) return parent;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  };
  const anchors = [...document.querySelectorAll<HTMLElement>("[data-live-card], [data-live-row], [data-file-row], [data-stakeholder-row], [data-report-row], [data-issue-row], [data-workspace-panel], [data-workspace-issue]")]
    .filter((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > 130 && rect.top < window.innerHeight; })
    .map((node) => ({ node, container: scrollContainerOf(node), top: node.getBoundingClientRect().top }));
  flushSync(apply);
  for (const position of positions) {
    const newOrigin = Number(position.node.dataset.liveDateOrigin);
    position.node.scrollLeft = position.left + (Number.isFinite(position.origin) && Number.isFinite(newOrigin) && position.dayWidth > 0 ? (position.origin - newOrigin) / 86400000 * position.dayWidth : 0);
    position.node.scrollTop = position.top;
  }
  for (const { node } of positions) {
    const anchor = anchors.find((item) => item.container === node && item.node.isConnected);
    if (anchor !== undefined) node.scrollTop += anchor.node.getBoundingClientRect().top - anchor.top;
  }
}

export function useLiveRefresh(resources: readonly LiveResource[], refresh: LiveRefresh, key: string, enabled = true, options: { readOnly?: boolean; paused?: () => boolean } = {}): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const pauseRef = useRef(options);
  pauseRef.current = options;
  const resourceKey = resources.join(",");
  useEffect(() => {
    if (!enabled) return;
    return subscribeLiveRefresh(resourceKey.split(",") as LiveResource[], () => refreshRef.current(), preserveViewport, () => (pauseRef.current.readOnly ? liveReadPaused() : liveSyncPaused()) || pauseRef.current.paused?.() === true);
  }, [resourceKey, key, enabled]);
}

/** Derived reads also coalesce: continuous parent updates must not cancel every slow response. */
export function useQueuedRefresh(refresh: LiveRefresh, dependency: unknown): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const queueRef = useRef<RefreshQueue | null>(null);
  useEffect(() => {
    const queue = new RefreshQueue(() => refreshRef.current(), undefined, undefined, preserveViewport);
    queueRef.current = queue;
    return () => { queue.dispose(); queueRef.current = null; };
  }, []);
  useEffect(() => { queueRef.current?.request(); }, [dependency]);
}
