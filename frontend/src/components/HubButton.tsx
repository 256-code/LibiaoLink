type HubButtonProps = {
  label: string;
  href: string;
};

/**
 * 入口页大按钮：渐变描边 + 悬停渐变填充。
 * 参考稿（styled-components 版）用 Tailwind 复刻，不引入新依赖。
 */
export function HubButton({ label, href }: HubButtonProps) {
  return (
    <a
      href={href}
      className="group inline-flex rounded-[3rem] bg-[linear-gradient(135deg,#30cfd0_0%,#330867_100%)] p-[2px] shadow-[0_10px_24px_-14px_rgba(51,8,103,0.6)] transition-all duration-300 hover:shadow-[0_14px_28px_-12px_rgba(51,8,103,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#330867]/40 focus-visible:ring-offset-2"
    >
      <span className="flex h-14 w-44 select-none items-center justify-center rounded-[3rem] bg-[linear-gradient(to_top,#cfd9df_0%,#e2ebf0_100%)] text-[1.2rem] font-[550] tracking-[1px] text-zinc-800 transition-all duration-300 group-hover:bg-[linear-gradient(135deg,#30cfd0_0%,#330867_100%)] group-hover:text-[1.3rem] group-hover:text-white">
        {label}
      </span>
    </a>
  );
}
