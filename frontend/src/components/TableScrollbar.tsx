import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

type TableScrollbarProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  onOverflowChange?: (overflowing: boolean) => void;
};

type Metrics = {
  visible: boolean;
  thumbWidth: number;
  offset: number;
  progress: number;
};

const HIDDEN: Metrics = { visible: false, thumbWidth: 0, offset: 0, progress: 0 };

const MIN_THUMB_WIDTH = 56;
const KEYBOARD_STEP = 160;

export function TableScrollbar({ scrollRef, onOverflowChange }: TableScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(HIDDEN);
  const overflowHandlerRef = useRef(onOverflowChange);
  const reportedRef = useRef(false);

  useEffect(() => {
    overflowHandlerRef.current = onOverflowChange;
  }, [onOverflowChange]);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    maxScroll: number;
    maxOffset: number;
  } | null>(null);

  const sync = useCallback(() => {
    const report = (overflowing: boolean) => {
      if (reportedRef.current === overflowing) {
        return;
      }
      reportedRef.current = overflowing;
      overflowHandlerRef.current?.(overflowing);
    };
    const element = scrollRef.current;
    const track = trackRef.current;
    if (element === null || track === null) {
      report(false);
      setMetrics((previous) => (previous.visible ? HIDDEN : previous));
      return;
    }
    const trackWidth = track.clientWidth;
    const maxScroll = element.scrollWidth - element.clientWidth;
    if (trackWidth === 0 || maxScroll <= 1) {
      report(false);
      setMetrics((previous) => (previous.visible ? HIDDEN : previous));
      return;
    }
    const thumbWidth = Math.min(
      trackWidth,
      Math.max(MIN_THUMB_WIDTH, Math.round((element.clientWidth / element.scrollWidth) * trackWidth)),
    );
    const maxOffset = Math.max(0, trackWidth - thumbWidth);
    const offset = Math.round((element.scrollLeft / maxScroll) * maxOffset);
    const progress = Math.round((element.scrollLeft / maxScroll) * 100);
    report(true);
    setMetrics((previous) =>
      previous.visible && previous.thumbWidth === thumbWidth && previous.offset === offset && previous.progress === progress
        ? previous
        : { visible: true, thumbWidth, offset, progress },
    );
  }, [scrollRef]);

  useEffect(() => {
    let attached: HTMLDivElement | null = null;
    let observer: ResizeObserver | null = null;
    const attach = () => {
      const element = scrollRef.current;
      if (element !== attached) {
        if (attached !== null) {
          attached.removeEventListener("scroll", sync);
        }
        observer?.disconnect();
        observer = null;
        attached = element;
        if (element !== null) {
          element.addEventListener("scroll", sync, { passive: true });
          observer = new ResizeObserver(sync);
          observer.observe(element);
        }
      }
      sync();
    };
    attach();
    const timer = window.setInterval(attach, 300);
    window.addEventListener("resize", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", sync);
      if (attached !== null) {
        attached.removeEventListener("scroll", sync);
      }
      observer?.disconnect();
    };
  }, [scrollRef, sync]);

  const scrollTo = (target: number) => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    element.scrollLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, target));
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || metrics.visible === false) {
      return;
    }
    const element = scrollRef.current;
    const track = trackRef.current;
    if (element === null || track === null) {
      return;
    }
    const maxScroll = element.scrollWidth - element.clientWidth;
    const maxOffset = Math.max(1, track.clientWidth - metrics.thumbWidth);
    const rect = track.getBoundingClientRect();
    const position = event.clientX - rect.left - metrics.thumbWidth / 2;
    event.preventDefault();
    scrollTo((Math.max(0, Math.min(maxOffset, position)) / maxOffset) * maxScroll);
  };

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    const track = trackRef.current;
    if (element === null || track === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
      maxScroll: element.scrollWidth - element.clientWidth,
      maxOffset: Math.max(1, track.clientWidth - metrics.thumbWidth),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = scrollRef.current;
    if (drag === null || element === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const delta = ((event.clientX - drag.startX) / drag.maxOffset) * drag.maxScroll;
    element.scrollLeft = drag.startScrollLeft + delta;
  };

  const handleThumbPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: { key: string; preventDefault: () => void }) => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollTo(element.scrollLeft - KEYBOARD_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollTo(element.scrollLeft + KEYBOARD_STEP);
    }
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={handleTrackPointerDown}
      title={metrics.visible ? "拖动查看右侧更多列" : undefined}
      className={"relative h-6 w-full select-none " + (metrics.visible ? "cursor-pointer" : "pointer-events-none")}
    >
      <div
        className={
          "absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-colors " +
          (metrics.visible ? "bg-zinc-200/80" : "bg-transparent")
        }
      />
      {metrics.visible ? (
        <div
          role="scrollbar"
          aria-orientation="horizontal"
          aria-controls="task-board-scroll"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={metrics.progress}
          tabIndex={0}
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
          onPointerCancel={handleThumbPointerUp}
          onKeyDown={handleKeyDown}
          style={{ width: metrics.thumbWidth, left: metrics.offset }}
          className="absolute top-1/2 h-3 -translate-y-1/2 cursor-grab rounded-full bg-zinc-400 transition-colors hover:bg-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 active:cursor-grabbing active:bg-zinc-600"
        />
      ) : null}
    </div>
  );
}
