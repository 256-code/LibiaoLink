import { useEffect, useRef, useState } from "react";

export type PopoverPosition = { top: number; left: number; width: number };

/**
 * 触发器 + 浮层的定位 / 关闭口径（与分类筛选的日期选择器同一套实现）：
 * 浮层 fixed 定位、跟随触发器（窗口缩放 / 滚动时重算）；点触发器与浮层之外、按 Esc 关闭。
 * 浮层内容由调用方用 `createPortal` 挂到 body —— 避免被弹窗的毛玻璃 / overflow 影响定位与裁剪。
 */
export function usePopover(width: number, height: number) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (trigger === null) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const popoverWidth = Math.max(width, rect.width);
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - popoverWidth - 8));
      const below = rect.bottom + 6;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
      setPosition({ top, left, width: popoverWidth });
    };
    updatePosition();
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = triggerRef.current !== null && triggerRef.current.contains(target);
      const insidePopover = popoverRef.current !== null && popoverRef.current.contains(target);
      if (!insideTrigger && !insidePopover) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, width, height]);

  return { open, setOpen, position, triggerRef, popoverRef };
}
