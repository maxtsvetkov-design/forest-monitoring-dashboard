import { useEffect, useRef, useState } from "react";
import type { DateRange } from "../data/aggregate";

/**
 * Month-level range selection for the dashboard's analytical window.
 *
 * Deliberately month-granular, not day-granular: the dataset is a series of
 * monthly snapshots, so offering days would present a precision that doesn't
 * exist behind the numbers.
 *
 * Two clicks pick a range. The first arms a pending start; the second closes
 * it, swapping the two if the user clicked backwards rather than rejecting the
 * click.
 */
export default function CalendarRangePicker({
  months,
  range,
  onChange,
}: {
  months: string[];
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-away close. Pointerdown rather than click so it fires before the
  // trigger's own onClick can re-open what this just closed.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPendingStart(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Escape closes without committing — the standard out for a popover that
  // has already swallowed the user's first click.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPendingStart(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(index: number) {
    if (pendingStart === null) {
      setPendingStart(index);
      return;
    }
    onChange({
      startIndex: Math.min(pendingStart, index),
      endIndex: Math.max(pendingStart, index),
    });
    setPendingStart(null);
    setOpen(false);
  }

  const span = range.endIndex - range.startIndex + 1;
  const label =
    span === 1 ? months[range.startIndex] ?? "" : `${months[range.startIndex] ?? ""} – ${months[range.endIndex] ?? ""}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Select date range"
        className="u-press flex items-center gap-[8px] h-[34px] px-[12px] rounded-[10px] border border-[#dedee3] bg-white text-[14px] text-[#18181c] font-['Outfit',sans-serif] hover:bg-[#ebece7] cursor-pointer"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          className="text-[#096151] shrink-0"
        >
          <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
          <path d="M2 6.5h12M5.5 2v3M10.5 2v3" />
        </svg>
        <span className="tabular-nums font-medium">{label}</span>
        <span className="text-[12px] text-[#5b5b66] tabular-nums">
          {span} {span === 1 ? "month" : "months"}
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-[6px] p-[10px] rounded-[14px] border border-[#dedee3] bg-white shadow-[var(--elev-3)] w-max">
          <div className="grid grid-cols-4 gap-[4px]">
            {months.map((month, i) => {
              // While a start is pending, the committed range stops being the
              // useful highlight — the user is mid-gesture, so show only what
              // they have picked so far.
              const inRange = pendingStart === null && i >= range.startIndex && i <= range.endIndex;
              const isPending = pendingStart === i;
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => pick(i)}
                  className={`px-[10px] py-[6px] rounded-[8px] text-[12px] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap cursor-pointer transition-colors duration-150 ${
                    isPending
                      ? "bg-[#096151] text-[#ebece7]"
                      : inRange
                        ? "bg-[#096151]/12 text-[#18181c]"
                        : "text-[#464650] hover:bg-[#ebece7]"
                  }`}
                >
                  {month}
                </button>
              );
            })}
          </div>
          <p className="mt-[8px] px-[2px] text-[11px] text-[#5b5b66] font-['Outfit',sans-serif]">
            {pendingStart === null ? "Pick a start month" : "Pick an end month"}
          </p>
        </div>
      )}
    </div>
  );
}
