/**
 * 任务表行内的删除按钮（Push 141，业务口径「不要这个笔作为编辑了…改成删除按钮吧」）：
 * 形态取自业务给的参考代码（圆 → 悬停展开成红底胶囊、浮出「删除」字样），尺寸与色彩按任务表行收小 / 收淡：
 * 静止 24px 幽灵态（无底色、浅灰垃圾桶图标，行悬停才浮现 —— 业务反馈「鼠标触碰列表时候黑的太突兀了 还是要比较看不出来吧」），
 * 悬停 / 聚焦展开到 48px 小号红胶囊（业务反馈「这个状态下有点太大了 要再小一点」），
 * 展开只吃 TaskBoard 任务描述列右侧预留的 48px 动作槽位、不挤动四格进度条与描述文字；图标放大下滑离场、文字同步浮出（参考代码同款节奏）。
 */
export function RowDeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      aria-label="删除任务"
      title="删除任务"
      onClick={(event) => {
        event.stopPropagation();
        onDelete();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="group/del relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-transparent text-zinc-300 opacity-0 transition-[width,background-color,color,opacity] duration-300 ease-out hover:w-12 hover:bg-red-500 hover:text-white focus-visible:w-12 focus-visible:bg-red-500 focus-visible:text-white focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
    >
      <span className="pointer-events-none absolute -translate-y-3 text-[11px] font-semibold opacity-0 transition-all duration-300 group-hover/del:translate-y-0 group-hover/del:opacity-100 group-focus-visible/del:translate-y-0 group-focus-visible/del:opacity-100">
        删除
      </span>
      <svg
        viewBox="0 0 448 512"
        aria-hidden="true"
        className="h-3 w-3 shrink-0 transition-all duration-300 group-hover/del:translate-y-4 group-hover/del:scale-[1.6] group-hover/del:opacity-0 group-focus-visible/del:translate-y-4 group-focus-visible/del:scale-[1.6] group-focus-visible/del:opacity-0"
      >
        <path
          fill="currentColor"
          d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"
        />
      </svg>
    </button>
  );
}
