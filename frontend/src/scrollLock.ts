/**
 * 锁页面滚动（抽屉 / 浮层打开时用）。
 *
 * 为什么要按滚动条宽度补内边距（Push 186 修「展开抽屉后一关，整张表格抖一下」）：
 * 只把 `overflow: hidden` 写进 body，纵向滚动条会立刻消失 → 视口宽度瞬间多出一个滚动条宽度（Windows 经典滚动条实测 15px）
 * → 整页按宽度重排：任务表这类列宽按比例分配的弹性网格会被横向撑开 15px，关掉抽屉再缩回来 —— 看起来就是「一开一关，表抖两下」。
 * 所以锁之前先量出滚动条实测宽度，再补一份等宽的 `padding-right`：视口多出来的那 15px 由内边距吃掉，
 * 内容宽度（表格宽 / 列宽 / 行位置）在开关抽屉前后逐像素一致。
 *
 * - 没有滚动条时（macOS 悬浮滚动条 / 页面本来就装得下）量出来是 0，不补内边距，行为与原来一致。
 * - 固定定位（`position: fixed`）的浮层按视口定位，不受 body 内边距影响；带 sticky 的底栏会跟着内容一起内缩，正合适。
 * - 返回值是还原函数：把两个内联样式恢复成进来之前的样子，多层浮层叠加也不会互相踩。
 */
export function lockBodyScroll(): () => void {
  const bodyElement = document.body;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  const previousOverflow = bodyElement.style.overflow;
  const previousPaddingRight = bodyElement.style.paddingRight;
  bodyElement.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    bodyElement.style.paddingRight = scrollbarWidth + "px";
  }
  return () => {
    bodyElement.style.overflow = previousOverflow;
    bodyElement.style.paddingRight = previousPaddingRight;
  };
}
