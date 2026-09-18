type CategorySwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function CategorySwitch({ checked, onChange }: CategorySwitchProps) {
  const sliderClass =
    "absolute inset-0 cursor-pointer rounded-[30px] transition-all duration-[400ms] peer-focus-visible:shadow-[10px_10px_100px_#7f8996] " +
    (checked ? "bg-[#feca04]" : "bg-[#313033]");
  const titleClass =
    "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-semibold whitespace-nowrap transition-all duration-[400ms] select-none " +
    (checked ? "left-[36%] text-[#313033]" : "left-[64%] text-white");
  const ballClass =
    "absolute top-0 h-9 w-9 rounded-full bg-white transition-all duration-[400ms] " +
    (checked ? "left-[72%] rotate-[360deg] [outline:6px_solid_rgba(255,255,255,0.278)]" : "-left-px");

  return (
    <label className="relative inline-block h-[2.6em] w-[9em] cursor-pointer text-sm">
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        aria-controls="category-filter-panel"
      />
      <span className={sliderClass}>
        <span className={titleClass}>分类筛选</span>
        <span className={ballClass}>
          <span className="absolute left-[53%] top-[58%] -translate-x-1/2 -translate-y-1/2 text-[#313033]">
            <svg className="h-6 w-6" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 18V6l8 6-8 6Z" />
            </svg>
          </span>
        </span>
      </span>
    </label>
  );
}
