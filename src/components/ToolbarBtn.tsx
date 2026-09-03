export default function ToolbarBtn({ src, label }: { src: string; label: string }) {
  return (
    <button className="u-press group flex items-center gap-[4px] px-[8px] py-[4px] bg-white border border-[#d9d9d9] rounded-[8px] hover:bg-[#f5f5f5] hover:border-[#b4b4b4] hover:shadow-[0px_2px_8px_-2px_rgba(0,0,0,0.10)]">
      <img src={src} alt={label} className="u-icon w-4 h-4" />
      <span className="text-[14px] font-medium text-[#141414] leading-[22px] font-['Inter',sans-serif] whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}
