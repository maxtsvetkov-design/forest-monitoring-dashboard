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
        className="u-press flex items-center gap-[8px] rounded-[10px] px-1 py-0.5 hover:bg-[#ebece7]"
      >
        <span className="text-[14px] font-medium text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
          {active.projectName}
        </span>
        <img src={imgChevronRight} alt=">" className={`w-4 h-4 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      <span className="text-[14px] font-normal text-[#464650] font-['Outfit',sans-serif] whitespace-nowrap">
        {active.name}
      </span>

      {open && (
        <div className="absolute top-full left-0 mt-[6px] w-[220px] bg-white rounded-[16px] shadow-[var(--elev-3)] p-1 z-20 animate-fade-in">
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => {
                onSelect(area.id);
                setOpen(false);
              }}
              className={`w-full text-left px-[10px] py-[8px] rounded-[10px] text-[13px] font-['Outfit',sans-serif] transition-colors duration-100 ${
                area.id === activeAreaId ? "bg-[#096151] text-[#ebece7] font-medium" : "text-[#464650] hover:bg-[#ebece7]"
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
