import { useState } from "react";
import { frameMonthWindow } from "../data/overlays";

/** The three classification years the Layers dropdown already names ("EAD
 *  Habitat Map 2015/2020/2025") — this row picks among the same three,
 *  rather than the plain monitoring calendar every other tab uses, because
 *  a habitat-classification comparison is naturally read in classification
 *  years, not monitoring months. Deliberately its own local range, not
 *  wired to `range`/`onRangeChange`: those still drive real month-indexed
 *  event filtering elsewhere (Insights, the Areas view), and a 3-year
 *  range has no honest way to reduce to a month index in that scheme. */
const CLASSIFICATION_YEARS = [2015, 2020, 2025];

/**
 * Al Maha's Recent Events tab used to show two side-by-side controls: the
 * plain month-range picker every other tab uses, plus a separate "Habitat
 * capture 1 / 2 / 3" tick row with no month of its own. This is one control
 * instead: the habitat-capture ticks stay pinned to the actual stretch of
 * months each one covers (via `frameMonthWindow` — the same "a span of
 * months, never a claimed survey date" honesty `AreaImageStage` already
 * uses for Abu Al Abyad's captures), and beneath them, a year picker over
 * the classification map years instead of a 12-month calendar strip.
 */
export default function HabitatMonthTimeline({
  months,
  frameCount,
  frameIndex,
  onFrameIndexChange,
  hiResFrameIndex,
  compareIndex,
  onCompareToggle,
}: {
  months: string[];
  /** How many of the honest, month-window-backed reference captures there
   *  are — NOT counting the hi-res frame below, which isn't dated as a span
   *  of months (a commissioned pass has no window, it has a delivery date).
   *  Mixing it into this count would hand it a fabricated month-window via
   *  `frameMonthWindow`. */
  frameCount: number;
  frameIndex: number | null;
  /** Takes `number | null` — clicking an already-active capture (or hi-res)
   *  button passes `null` to un-overlay it, back to just the basemap. */
  onFrameIndexChange: (index: number | null) => void;
  /** The commissioned hi-res capture's own index in the underlying frames
   *  array (after the `frameCount` reference captures) — present only once
   *  one has actually been delivered. Pinned past the last reference
   *  capture's marker rather than dated on the month strip, since — unlike
   *  the 3 reference photos — it doesn't stand for a span of months at all. */
  hiResFrameIndex?: number;
  /** Which reference capture is the base of an active side-by-side compare
   *  (paired with the very next one — index+1) — `null`/omitted when no
   *  compare is active. Never offered on the last reference capture: there's
   *  no next one within `frameCount` to pair it with. */
  compareIndex?: number | null;
  onCompareToggle?: (index: number) => void;
}) {
  // Local to this row — see `CLASSIFICATION_YEARS`'s own comment for why this
  // doesn't reuse `range`/`onRangeChange`. Defaults to the full 2015–2025
  // span rather than a single year, matching how the month picker it
  // replaces always opened onto its full range too.
  const [pendingYearStart, setPendingYearStart] = useState<number | null>(null);
  const [yearRange, setYearRange] = useState<{ startIndex: number; endIndex: number }>({
    startIndex: 0,
    endIndex: CLASSIFICATION_YEARS.length - 1,
  });

  function pickYear(index: number) {
    if (pendingYearStart === null) {
      setPendingYearStart(index);
      return;
    }
    setYearRange({ startIndex: Math.min(pendingYearStart, index), endIndex: Math.max(pendingYearStart, index) });
    setPendingYearStart(null);
  }

  const frames = Array.from({ length: frameCount }, (_, i) => frameMonthWindow(i, frameCount, months.length));

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-[4px]">
      {/* Habitat captures, each pinned above the stretch of months it covers
          rather than a bare "1/2/3" with no timeline of its own. */}
      <div className="relative h-[20px]">
        {frames.map((w, i) => {
          const centerPct = ((w.startIndex + w.endIndex + 1) / 2 / months.length) * 100;
          const active = i === frameIndex;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onFrameIndexChange(i === frameIndex ? null : i)}
              aria-pressed={active}
              aria-label={`Habitat capture ${i + 1} of ${frameCount}, covering ${months[w.startIndex]}${
                w.endIndex !== w.startIndex ? ` – ${months[w.endIndex]}` : ""
              }`}
              className="u-press absolute -translate-x-1/2 px-[8px] h-[20px] rounded-[6px] text-[10.5px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-150"
              style={{
                left: `${centerPct}%`,
                background: active ? "#18181c" : "#f0f0f0",
                color: active ? "#FFFFFF" : "#5b5b66",
              }}
            >
              📷 {i + 1}
            </button>
          );
        })}
        {onCompareToggle &&
          frames.map((w, i) => {
            if (i >= frameCount - 1) return null; // no next reference capture to pair the last one with
            const centerPct = ((w.startIndex + w.endIndex + 1) / 2 / months.length) * 100;
            const active = compareIndex === i;
            return (
              <button
                key={`compare-${i}`}
                type="button"
                onClick={() => onCompareToggle(i)}
                aria-pressed={active}
                aria-label={`Compare habitat capture ${i + 1} with capture ${i + 2}`}
                title={`Compare with capture ${i + 2}`}
                className="u-press absolute top-0 w-[20px] h-[20px] rounded-full text-[10.5px] cursor-pointer transition-colors duration-150 flex items-center justify-center"
                style={{
                  left: `calc(${centerPct}% + 30px)`,
                  background: active ? "#096151" : "#f0f0f0",
                  color: active ? "#FFFFFF" : "#5b5b66",
                }}
              >
                ⇄
              </button>
            );
          })}
        {hiResFrameIndex !== undefined && (
          <button
            type="button"
            onClick={() => onFrameIndexChange(hiResFrameIndex === frameIndex ? null : hiResFrameIndex)}
            aria-pressed={hiResFrameIndex === frameIndex}
            aria-label="Hi-res capture, delivered"
            className="u-press absolute right-0 px-[8px] h-[20px] rounded-[6px] text-[10.5px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-150"
            style={{
              background: hiResFrameIndex === frameIndex ? "#18181c" : "#e6f2ec",
              color: hiResFrameIndex === frameIndex ? "#FFFFFF" : "#096151",
            }}
          >
            🛰️ Hi-res
          </button>
        )}
      </div>

      {/* The classification-year picker — same two-click pick-a-range
          interaction the month row used, just over the three years the
          Layers dropdown's own "EAD Habitat Map" entries name. */}
      <div className="flex items-center gap-[2px]">
        {CLASSIFICATION_YEARS.map((year, i) => {
          const inRange = pendingYearStart === null && i >= yearRange.startIndex && i <= yearRange.endIndex;
          const isPending = pendingYearStart === i;
          return (
            <button
              key={year}
              type="button"
              onClick={() => pickYear(i)}
              className={`flex-1 min-w-0 px-[4px] py-[5px] rounded-[6px] text-[10.5px] font-['Outfit',sans-serif] tabular-nums truncate cursor-pointer transition-colors duration-150 ${
                isPending
                  ? "bg-[#096151] text-[#ebece7]"
                  : inRange
                    ? "bg-[#096151]/12 text-[#18181c]"
                    : "text-[#464650] hover:bg-[#ebece7]"
              }`}
              title={String(year)}
            >
              {year}
            </button>
          );
        })}
      </div>
      <p className="px-[2px] text-[10.5px] text-[#8a8a94] font-['Outfit',sans-serif]">
        {pendingYearStart === null
          ? `${CLASSIFICATION_YEARS[yearRange.startIndex]}${
              yearRange.endIndex === yearRange.startIndex ? "" : `–${CLASSIFICATION_YEARS[yearRange.endIndex]}`
            } selected — click a year to start a new range`
          : "Pick an end year"}
      </p>
    </div>
  );
}
