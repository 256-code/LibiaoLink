import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

type ScrollAreaProps = {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  ariaLabel?: string;
  /** 有溢出时滑块常显（默认只在滚动 / 悬停时浮现）——弹窗这类「一眼要看出还有内容」的场景用。 */
  thumbAlwaysVisible?: boolean;
  /** 滚动方向：默认纵向（分类筛选侧栏 / 任务抽屉 / 看板列内卡片）；看板横向列排布用 horizontal。 */
  axis?: "vertical" | "horizontal";
};

type ThumbMetrics = {
  size: number;
  progress: number;
  offset: number;
};

const HIDE_DELAY = 900;
const TRACK_INSET = 4;
const MIN_THUMB_SIZE = 28;
// 原生滚动条在 Chrome 下不会随样式变化重绘，也无法做到「滚动才浮现」，
// 因此隐藏原生滚动条，改由本组件自绘悬浮滑块（默认透明，滚动 / 悬停滑块时浮现）。
// Push 108（业务反馈「我不想要自动滚动，想要鼠标控制」）：Push 107 的「拖到边缘自动滚动」已撤回 —— 看板卡片改成指针拖动（见 TaskKanban），
// 拖动中直接用滚轮翻列 / 翻卡片；`data-scroll-area` 标记保留（自动化走查按它定位横向 / 纵向滚动容器）。
export function ScrollArea({ children, className = "", viewportClassName = "", ariaLabel, thumbAlwaysVisible = false, axis = "vertical" }: ScrollAreaProps) {
  const horizontal = axis === "horizontal";
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef(0);
  const [thumb, setThumb] = useState<ThumbMetrics | null>(null);
  const [active, setActive] = useState(false);

  const sync = useCallback(() => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    const viewport = horizontal ? node.clientWidth : node.clientHeight;
    const content = horizontal ? node.scrollWidth : node.scrollHeight;
    const track = viewport - TRACK_INSET * 2;
    if (track <= 0 || content <= viewport + 1) {
      setThumb(null);
      return;
    }
    const size = Math.max(MIN_THUMB_SIZE, Math.round((viewport / content) * track));
    const maxOffset = track - size;
    const maxScroll = content - viewport;
    const scrolled = horizontal ? node.scrollLeft : node.scrollTop;
    const ratio = maxScroll <= 0 ? 0 : Math.min(1, Math.max(0, scrolled / maxScroll));
    setThumb({ size, progress: Math.round(ratio * 100), offset: Math.round(ratio * maxOffset) });
  }, [horizontal]);

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
    const startPointer = horizontal ? event.clientX : event.clientY;
    const startScroll = horizontal ? node.scrollLeft : node.scrollTop;
    const track = (horizontal ? node.clientWidth : node.clientHeight) - TRACK_INSET * 2;
    const maxOffset = Math.max(1, track - thumb.size);
    const maxScroll = horizontal ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    const distance = maxScroll / maxOffset;
    window.clearTimeout(hideTimerRef.current);
    setActive(true);
    const handleMove = (moveEvent: PointerEvent) => {
      const delta = (horizontal ? moveEvent.clientX : moveEvent.clientY) - startPointer;
      const target = startScroll + delta * distance;
      if (horizontal) {
        node.scrollLeft = target;
      } else {
        node.scrollTop = target;
      }
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
    <div className={"relative " + (horizontal ? "" : "flex flex-col ") + viewportClassName}>
      <div
        ref={scrollRef}
        aria-label={ariaLabel}
        data-scroll-area={horizontal ? "horizontal" : "vertical"}
        className={"scrollbar-hidden min-h-0 flex-1 " + (horizontal ? "overflow-x-auto " : "overflow-y-auto ") + className}
      >
        {children}
      </div>
      {thumb === null ? null : (
        <div
          className={
            "pointer-events-none absolute " + (horizontal ? "inset-x-0 bottom-0 h-3" : "inset-y-0 right-0 w-3")
          }
        >
          <div
            role="scrollbar"
            aria-orientation={horizontal ? "horizontal" : "vertical"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={thumb.progress}
            onPointerDown={handleThumbPointerDown}
            style={horizontal ? { width: thumb.size, left: TRACK_INSET + thumb.offset } : { height: thumb.size, top: TRACK_INSET + thumb.offset }}
            className={
              "pointer-events-auto absolute cursor-grab rounded-full bg-zinc-400/70 transition-opacity duration-200 hover:bg-zinc-500 active:cursor-grabbing active:bg-zinc-500 " +
              (horizontal ? "top-1/2 h-1.5 -translate-y-1/2 " : "left-1/2 w-1.5 -translate-x-1/2 ") +
              (thumbAlwaysVisible ? "opacity-60 hover:opacity-100" : active ? "opacity-100" : "opacity-0 hover:opacity-100")
            }
          />
        </div>
      )}
    </div>
  );
}
