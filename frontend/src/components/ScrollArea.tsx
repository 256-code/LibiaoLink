import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

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
/** 拖动自动滚动（Push 107）：鼠标进到视口边缘这么多像素以内就开始滚。 */
const DRAG_EDGE = 56;
/** 最贴边时每帧滚多少像素（离边越远越慢，退到边缘区外就停）。 */
const DRAG_MAX_STEP = 18;

/** 离边越近滚得越快（线性）：贴着边 18px/帧，退到边缘区最外沿只挪 2px/帧（有个下限，免得贴着边不动）。
 *  `depth` = 鼠标进边缘区多深（0 = 刚进边缘区外沿、`DRAG_EDGE` = 贴边）。 */
function dragScrollStep(depth: number): number {
  const ratio = Math.max(0, Math.min(1, depth / DRAG_EDGE));
  return Math.max(2, Math.round(DRAG_MAX_STEP * ratio));
}

// 原生滚动条在 Chrome 下不会随样式变化重绘，也无法做到「滚动才浮现」，
// 因此隐藏原生滚动条，改由本组件自绘悬浮滑块（默认透明，滚动 / 悬停滑块时浮现）。
// Push 107：拖动卡片时鼠标贴到容器边缘会自动滚（横向看板滚左右、列内卡片列表滚上下），否则卡片拖不到视口外的列 / 卡片。
export function ScrollArea({ children, className = "", viewportClassName = "", ariaLabel, thumbAlwaysVisible = false, axis = "vertical" }: ScrollAreaProps) {
  const horizontal = axis === "horizontal";
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef(0);
  /** 拖动自动滚动（Push 107）的每帧滚动量与 rAF 句柄。 */
  const dragScrollRef = useRef({ raf: 0, dx: 0, dy: 0 });
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

  /**
   * 拖动自动滚动（Push 107，业务反馈「拖动时支持鼠标滑动」）：HTML5 拖动期间鼠标不动、容器不会自己滚
   * （原生拖拽自动滚动对自绘滚动容器不可靠），卡片就拖不到视口外的列 / 卡片。
   * 口径：鼠标进到视口边缘 `DRAG_EDGE` 内就按「离边多远」每帧滚一点（贴得越近越快），
   * 拖出容器 / 退出边缘区 / 放开 / Esc 取消都立刻停；横向看板滚 `scrollLeft`、列内卡片列表滚 `scrollTop`，任何 `ScrollArea` 通用。
   */
  const stopDragScroll = useCallback(() => {
    const state = dragScrollRef.current;
    state.dx = 0;
    state.dy = 0;
    if (state.raf !== 0) {
      window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
  }, []);

  /** 自动滚动的每帧循环：滚到两端就夹住（不再白跑），鼠标停着不动也会一直滚到离开边缘区为止。 */
  const runDragScroll = useCallback(() => {
    const state = dragScrollRef.current;
    if (state.raf !== 0) {
      return;
    }
    const step = () => {
      const node = scrollRef.current;
      if (node === null || (state.dx === 0 && state.dy === 0)) {
        state.raf = 0;
        return;
      }
      if (state.dx !== 0) {
        node.scrollLeft = Math.max(0, Math.min(node.scrollWidth - node.clientWidth, node.scrollLeft + state.dx));
      }
      if (state.dy !== 0) {
        node.scrollTop = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, node.scrollTop + state.dy));
      }
      state.raf = window.requestAnimationFrame(step);
    };
    step();
  }, []);

  /** 拖动经过本容器时按鼠标位置算每帧滚动量（Push 107）：该方向滚不动的容器不算，免得内层容器白滚。 */
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    const rect = node.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (node.scrollWidth - node.clientWidth > 1) {
      if (event.clientX < rect.left + DRAG_EDGE) {
        dx = -dragScrollStep(rect.left + DRAG_EDGE - event.clientX);
      } else if (event.clientX > rect.right - DRAG_EDGE) {
        dx = dragScrollStep(event.clientX - (rect.right - DRAG_EDGE));
      }
    }
    if (node.scrollHeight - node.clientHeight > 1) {
      if (event.clientY < rect.top + DRAG_EDGE) {
        dy = -dragScrollStep(rect.top + DRAG_EDGE - event.clientY);
      } else if (event.clientY > rect.bottom - DRAG_EDGE) {
        dy = dragScrollStep(event.clientY - (rect.bottom - DRAG_EDGE));
      }
    }
    const state = dragScrollRef.current;
    state.dx = dx;
    state.dy = dy;
    if (dx !== 0 || dy !== 0) {
      runDragScroll();
      return;
    }
    stopDragScroll();
  };

  // 拖到一半放开 / Esc 取消（Push 107）：dragend 只派给起始元素、别的列收不到，统一在 document 上收尾
  useEffect(() => {
    const handleDragEnd = () => {
      stopDragScroll();
    };
    document.addEventListener("dragend", handleDragEnd);
    document.addEventListener("drop", handleDragEnd);
    return () => {
      document.removeEventListener("dragend", handleDragEnd);
      document.removeEventListener("drop", handleDragEnd);
      stopDragScroll();
    };
  }, [stopDragScroll]);

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
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          // 只是在容器内换元素时也会触发 dragleave —— 真正拖出容器才停自动滚动
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            stopDragScroll();
          }
        }}
        onDrop={stopDragScroll}
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
