import { useEffect, useRef, useState } from "react";

/** Reference layers named in the design brief for this workspace — shown as
 *  a plain list, not wired to any real overlay data (no layer in this app
 *  actually renders any of these). A static reference of what a connected
 *  GIS layer catalogue would offer here, same honesty as PermitsList's own
 *  mockup content. */
const LAYERS = [
  "EAD Habitat Map 2015",
  "EAD Habitat Map 2020",
  "EAD Habitat Map 2025",
  "EAD Protected & Conserved Areas Latest",
  "ALDAR Planned Development 2026-28",
  "ADNOC Concession Areas",
  "ADMI Restoration Projects",
  "EAD Approved Permits Latest",
];

/**
 * Sits to the left of the habitat-capture tick row (the "📷 1/2/3" buttons)
 * — a reference list of the layers a connected GIS catalogue would offer
 * here. Deliberately inert: no checkbox, no click handler on a row, nothing
 * to toggle — just the names, since nothing in this app renders any of them
 * as a real overlay yet.
 */
export default function LayersDropdown() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="u-press flex items-center gap-[6px] h-[28px] px-[10px] rounded-[8px] border border-[#dedee3] bg-white text-[11.5px] font-semibold text-[#464650] font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-150 hover:bg-[#f6f6f8]"
      >
        Layers
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0 transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        >
          <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-20 top-[calc(100%+6px)] left-0 w-[250px] rounded-[12px] bg-white border border-[#dedee3] shadow-[0px_16px_36px_-10px_rgba(0,0,0,0.28)] py-[6px] animate-fade-in-up"
          role="list"
        >
          {LAYERS.map((layer) => (
            <div
              key={layer}
              role="listitem"
              className="px-[12px] py-[7px] text-[12px] text-[#3d3d45] font-['Outfit',sans-serif] leading-[16px]"
            >
              {layer}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
