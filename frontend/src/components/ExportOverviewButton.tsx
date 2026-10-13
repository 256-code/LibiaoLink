type ExportOverviewButtonProps = {
  /** 点「导出 PDF」时触发（导出实现见 ../exportOverviewPdf.ts）。 */
  onExport: () => void;
  /** 任务数据还在取 / 重取中：置灰不给点，避免导出半份数据。 */
  disabled?: boolean;
  /** 导出进行中（等「项目进展描述」列英译，见 §6.16 ⑯）：按钮转「生成中…」并防重复点击。 */
  busy?: boolean;
};

/**
 * 「导出 PDF」按钮（项目总览工具区 · 业务口径 2026-10-09：把样张按钮放在项目总览，导出项目总览的数据给客户看）。
 * 外形按业务给的 styled-components 样张收敛 —— 白底胶囊「导出 PDF」；按仓库既有口径改写成普通 CSS 类
 * （src/app.css 的 .export-docs-btn —— 与顶层导航 / 看板卡片的样张同一做法：**不引入 styled-components**），
 * 尺寸收紧到标签栏右侧工具区的 h-8（32px）。
 *
 * 追订（2026-10-09）：①「excel先取消吧 删除按钮」—— 撤掉第二枚「导出 Excel」，回到单枚「导出 PDF」；
 * ②「取消绿色弹出 和鼠标放置上去的提示」—— 撤掉悬停时从底部滑出的绿色下载层（含下载箭头浮动动效）与
 * 鼠标悬停 tooltip（title），只留静止面。
 *
 * 追订（2026-10-10「导出按钮 鼠标触碰效果 和筛选统一一下 统一成筛选的效果」）：悬停反馈换成工具区
 * 「筛选」按钮那一套（描边 zinc-200 → zinc-300、字色 → zinc-900、150ms 过渡；原多层大投影撤掉），
 * 静止面（白底胶囊 / 字号 / 字重）不变 —— 样式在 `src/app.css` 的 `.export-docs-btn` 系列。
 *
 * 追订（2026-10-10「现在导出没有接入翻译」· §6.16 ⑯）：导出前多算一步「项目进展描述」列英译（异步），
 * 等待期间按钮进 busy 态（文案「生成中…」+ 置灰防重复点）；翻译通道不可用时导出照常（静默降级）。
 */
export function ExportOverviewButton({ onExport, disabled = false, busy = false }: ExportOverviewButtonProps) {
  const blocked = disabled || busy;
  return (
    <button
      type="button"
      data-export-overview=""
      className="export-docs-btn"
      aria-label="导出项目总览数据（PDF）"
      aria-busy={busy}
      disabled={blocked}
      onClick={onExport}
    >
      <span className="export-docs-btn__face">
        <svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1={16} y1={13} x2={8} y2={13} />
          <line x1={16} y1={17} x2={8} y2={17} />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        {busy ? "生成中…" : "导出 PDF"}
      </span>
    </button>
  );
}
