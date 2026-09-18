import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

type ScrollAreaProps = {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  ariaLabel?: string;
};

type ThumbMetrics = {
  height: number;
  progress: number;
  top: number;
};

const HIDE_DELAY = 900;
const TRACK_INSET = 4;
const MIN_THUMB_HEIGHT = 28;

// 原生滚动条在 Chrome 下不会随样式变化重绘，无法做到「滚动才浮现」，
// 因此隐藏原生滚动条，改由本组件自绘悬浮滑块（默认透明，滚动 / 悬停滑块时浮现）。
export function ScrollArea({ children, className = "", viewportClassName = "", ariaLabel }: ScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef(0);
  const [thumb, setThumb] = useState<ThumbMetrics | null>(null);
  const [active, setActive] = useState(false);

  const sync = useCallback(() => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    const track = node.clientHeight - TRACK_INSET * 2;
    if (track <= 0 || node.scrollHeight <= node.clientHeight + 1) {
      setThumb(null);
      return;
    }
    const height = Math.max(MIN_THUMB_HEIGHT, Math.round((node.clientHeight / node.scrollHeight) * track));
    const maxOffset = track - height;
    const maxScroll = node.scrollHeight - node.clientHeight;
    const progress = maxScroll <= 0 ? 0 : node.scrollTop / maxScroll;
    const ratio = Math.min(1, Math.max(0, progress));
    setThumb({ height, progress: Math.round(ratio * 100), top: Math.round(ratio * maxOffset) });
  }, []);

  const reveal = useCallback(() => {
    setActive(true);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setActive(false);
    }, HIDE_DELAY);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    sync();
    const handleScroll = () => {
      sync();
      reveal();
    };
    node.addEventListener("scroll", handleScroll, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    for (const child of Array.from(node.children)) {
      observer.observe(child);
    }
    return () => {
      node.removeEventListener("scroll", handleScroll);
      observer.disconnect();
      window.clearTimeout(hideTimerRef.current);
    };
  }, [reveal, sync]);

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = scrollRef.current;
    if (node === null || thumb === null) {
      return;
    }
    event.preventDefault();
    const thumbNode = event.currentTarget;
    thumbNode.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startScrollTop = node.scrollTop;
    const track = node.clientHeight - TRACK_INSET * 2;
    const maxOffset = Math.max(1, track - thumb.height);
    const distance = (node.scrollHeight - node.clientHeight) / maxOffset;
    window.clearTimeout(hideTimerRef.current);
    setActive(true);
    const handleMove = (moveEvent: PointerEvent) => {
      node.scrollTop = startScrollTop + (moveEvent.clientY - startY) * distance;
    };
    const handleUp = () => {
      thumbNode.removeEventListener("pointermove", handleMove);
      thumbNode.removeEventListener("pointerup", handleUp);
      thumbNode.removeEventListener("pointercancel", handleUp);
      reveal();
    };
    thumbNode.addEventListener("pointermove", handleMove);
    thumbNode.addEventListener("pointerup", handleUp);
    thumbNode.addEventListener("pointercancel", handleUp);
  };

  return (
    <div className={"relative " + viewportClassName}>
      <div ref={scrollRef} aria-label={ariaLabel} className={"scrollbar-hidden h-full overflow-y-auto " + className}>
        {children}
      </div>
      {thumb === null ? null : (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-3">
          <div
            role="scrollbar"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={thumb.progress}
            onPointerDown={handleThumbPointerDown}
            style={{ height: thumb.height, top: TRACK_INSET + thumb.top }}
            className={
              "pointer-events-auto absolute left-1/2 w-1.5 -translate-x-1/2 cursor-grab rounded-full bg-zinc-400/70 transition-opacity duration-200 hover:bg-zinc-500 active:cursor-grabbing active:bg-zinc-500 " +
              (active ? "opacity-100" : "opacity-0 hover:opacity-100")
            }
          />
        </div>
      )}
    </div>
  );
}
