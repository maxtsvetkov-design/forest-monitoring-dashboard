import { useEffect, useRef, useState } from "react";

export interface FilterDropdownOption {
  value: string;
  label: string;
  /** Swatch colour shown before the label — matches the health/severity legend. */
  color?: string;
}

/**
 * A multi-select facet, collapsed behind a button until opened — same
 * outside-click-to-close mechanics as AreaSwitcher, reused here so every
 * dropdown in the app behaves identically. Replaces a permanently-visible row
 * of toggle chips per facet (Health / Species / Crown radius), which ate three
 * lines of vertical space above the table at all times regardless of whether
 * any filter was active.
 */
export default function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: FilterDropdownOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`u-press inline-flex items-center gap-[5px] px-[9px] py-[4px] rounded-full text-[11px] font-['Outfit',sans-serif] border cursor-pointer ${
          selected.size > 0 ? "border-[#09615166] bg-[#0961511a] text-[#096151]" : "border-[#dedee3] text-[#5b5b66] hover:bg-[#f6f6f8]"
        }`}
      >
        {label}
        {selected.size > 0 && (
          <span className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#096151] text-white text-[10px] leading-none">
            {selected.size}
          </span>
        )}
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          fill="none"
          className={`transition-transform duration-150 shrink-0 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-[6px] min-w-[180px] max-h-[260px] overflow-y-auto bg-white rounded-[16px] shadow-[var(--elev-3)] p-1 z-20 animate-fade-in">
          {options.map((opt) => {
            const isSelected = selected.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={isSelected}
                onClick={() => onToggle(opt.value)}
                className={`w-full flex items-center gap-[8px] text-left px-[8px] py-[6px] rounded-[7px] text-[12px] font-['Outfit',sans-serif] transition-colors duration-100 cursor-pointer ${
                  isSelected ? "bg-[#0961511a] text-[#096151]" : "text-[#464650] hover:bg-[#f6f6f8]"
                }`}
              >
                <span
                  className={`shrink-0 w-[14px] h-[14px] rounded-[4px] border flex items-center justify-center ${
                    isSelected ? "bg-[#096151] border-[#096151]" : "border-[#dedee3]"
                  }`}
                >
                  {isSelected && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.2 2.2L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {opt.color && <span className="shrink-0 w-[7px] h-[7px] rounded-full" style={{ background: opt.color }} />}
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
