import type { PointerEvent } from "react";

type TaskNodeCardProps = {
  /** 任务中文名（参考稿的 message-text） */
  title: string;
  /** 任务英文名（参考稿的 sub-text）；没有英文名时只显示中文 */
  subtitle?: string;
  /**
   * 可拖动（Push 116：**指针拖动**，只负责抓手光标）—— 左侧节点拖到右侧模板、模板内调顺序都用它。
   * 原生 HTML5 拖拽已撤回：拖动期间浏览器会把 `wheel` 吞掉，「拖着的同时滚轮翻列表」就不成立。
   */
  grab?: boolean;
  /** 按下卡片（指针拖动）：真拖动由调用方按位移阈值判定，没过阈值就是点一下。 */
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  /** 拖动中跟着鼠标走的那一块（半透明 + 轻磨砂，能透出底下的插入线）。 */
  ghost?: boolean;
  /** 传了就把叉号渲染成「移除」按钮；不传则保持参考稿里的装饰语义（当前原型无点击行为） */
  onRemove?: () => void;
  /** 高亮描边（拖拽时提示「这个节点已经在右侧了」） */
  highlighted?: boolean;
  /** 半透明（右侧卡片正在被拖动排序时，原位置留个虚影） */
  dimmed?: boolean;
};

/**
 * 任务节点卡片：按业务给的参考稿用 Tailwind 复刻（左侧波浪 + 圆形图标 + 中英文标题 + 右侧叉形图标），
 * 未引入 styled-components 或新依赖。Push 116 起拖动改指针拖动（见 `grab` / `ghost`）。叉形图标在参考稿里是装饰，这里不做点击行为：
 * 默认隐藏（占位但不可见，避免卡片右侧抖动），只有鼠标移到叉号自己的小区域（28×28 命中区）才显示。
 */
export function TaskNodeCard({
  title,
  subtitle,
  grab,
  onPointerDown,
  ghost,
  onRemove,
  highlighted,
  dimmed,
}: TaskNodeCardProps) {
  return (
    <article
      className={
        "relative flex h-20 w-full items-center gap-[15px] overflow-hidden rounded-lg px-[15px] py-[10px] " +
        (ghost === true
          ? "bg-white/[0.6] shadow-[0_18px_40px_-18px_rgba(15,23,42,0.35)] backdrop-blur-[5px] backdrop-saturate-150"
          : "bg-white shadow-[0_8px_24px_rgba(149,157,165,0.2)]") +
        (grab === true ? " cursor-grab active:cursor-grabbing" : "") +
        (highlighted === true ? " ring-2 ring-amber-400/80" : "") +
        (dimmed === true ? " opacity-40" : "")
      }
      title={subtitle === undefined || subtitle === "" ? title : title + " / " + subtitle}
      onPointerDown={onPointerDown}
    >
      <svg
        className="absolute -left-[31px] top-[32px] w-20 rotate-90 fill-[#04e4003a]"
        viewBox="0 0 1440 320"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M0,256L11.4,240C22.9,224,46,192,69,192C91.4,192,114,224,137,234.7C160,245,183,235,206,213.3C228.6,192,251,160,274,149.3C297.1,139,320,149,343,181.3C365.7,213,389,267,411,282.7C434.3,299,457,277,480,250.7C502.9,224,526,192,549,181.3C571.4,171,594,181,617,208C640,235,663,277,686,256C708.6,235,731,149,754,122.7C777.1,96,800,128,823,165.3C845.7,203,869,245,891,224C914.3,203,937,117,960,112C982.9,107,1006,181,1029,197.3C1051.4,213,1074,171,1097,144C1120,117,1143,107,1166,133.3C1188.6,160,1211,224,1234,218.7C1257.1,213,1280,139,1303,133.3C1325.7,128,1349,192,1371,192C1394.3,192,1417,128,1429,96L1440,64L1440,320L1428.6,320C1417.1,320,1394,320,1371,320C1348.6,320,1326,320,1303,320C1280,320,1257,320,1234,320C1211.4,320,1189,320,1166,320C1142.9,320,1120,320,1097,320C1074.3,320,1051,320,1029,320C1005.7,320,983,320,960,320C937.1,320,914,320,891,320C868.6,320,846,320,823,320C800,320,777,320,754,320C731.4,320,709,320,686,320C662.9,320,640,320,617,320C594.3,320,571,320,549,320C525.7,320,503,320,480,320C457.1,320,434,320,411,320C388.6,320,366,320,343,320C320,320,297,320,274,320C251.4,320,229,320,206,320C182.9,320,160,320,137,320C114.3,320,91,320,69,320C45.7,320,23,320,11,320L0,320Z"
          fillOpacity={1}
        />
      </svg>
      <span className="ml-2 flex h-[35px] w-[35px] shrink-0 items-center justify-center rounded-full bg-[#04e40048]">
        <svg
          className="h-[17px] w-[17px] text-[#269b24]"
          viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg"
          strokeWidth={0}
          fill="currentColor"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-111 111-47-47c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l64 64c9.4 9.4 24.6 9.4 33.9 0L369 209z" />
        </svg>
      </span>
      <span className="flex min-w-0 grow flex-col items-start justify-center">
        <p className="w-full truncate text-[17px] font-bold text-[#269b24]">{title}</p>
        {subtitle === undefined || subtitle === "" ? null : <p className="w-full truncate text-sm text-[#555]">{subtitle}</p>}
      </span>
      {onRemove === undefined ? (
        <span className="group/cross flex h-7 w-7 shrink-0 items-center justify-center">
          <CrossIcon />
        </span>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={"移除 " + title}
          className="group/cross flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:bg-zinc-100"
        >
          <CrossIcon />
        </button>
      )}
    </article>
  );
}

/** 参考稿右侧的叉形图标：默认隐藏，鼠标进入叉号自己的命中区（28×28）才显示。 */
function CrossIcon() {
  return (
    <svg
      className="h-[18px] w-[18px] text-[#555] opacity-0 transition-opacity duration-150 group-hover/cross:opacity-100"
      viewBox="0 0 15 15"
      xmlns="http://www.w3.org/2000/svg"
      strokeWidth={0}
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
        clipRule="evenodd"
        fillRule="evenodd"
      />
    </svg>
  );
}
