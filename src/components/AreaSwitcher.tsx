import { useEffect, useRef, useState } from "react";
import { imgChevronRight } from "../assets";
import type { Area } from "../data/areas";

export default function AreaSwitcher({
  areas,
  activeAreaId,
  onSelect,
}: {
  areas: Area[];
  activeAreaId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = areas.find((a) => a.id === activeAreaId) ?? areas[0];

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-[8px] px-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="u-press flex items-center gap-[8px] rounded-[8px] px-1 py-0.5 hover:bg-[#f0f0f0]"
      >
        <span className="text-[14px] font-medium text-[#141414] font-['Inter',sans-serif] whitespace-nowrap">
          {active.projectName}
        </span>
        <img src={imgChevronRight} alt=">" className={`w-4 h-4 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      <span className="text-[14px] font-normal text-[#363636] font-['Inter',sans-serif] whitespace-nowrap">
        {active.name}
      </span>

      {open && (
        <div className="absolute top-full left-0 mt-[6px] w-[220px] bg-white border border-[#d9d9d9] rounded-[12px] shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] p-1 z-20 animate-fade-in">
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => {
                onSelect(area.id);
                setOpen(false);
              }}
              className={`w-full text-left px-[10px] py-[8px] rounded-[8px] text-[13px] font-['Inter',sans-serif] transition-colors duration-100 ${
                area.id === activeAreaId ? "bg-[#096151] text-[#f2f2f2] font-medium" : "text-[#363636] hover:bg-[#f0f0f0]"
              }`}
            >
              {area.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
