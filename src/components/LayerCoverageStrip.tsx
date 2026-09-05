import { useRef } from "react";
import type { DateRange } from "../data/aggregate";
import { coverageCaption, PLANNED_TAIL_MONTHS, type LayerCoverage } from "../data/layerTime";
import { useRangeScrub } from "../hooks/useRangeScrub";

/**
 * A layer's own timeline: one tick per month showing whether this layer
 * actually observed it, over a draggable selection band.
 *
 * The planned tail sits in its own flex column rather than inside the track,
 * mirroring how TimelineRangeSlider splits its `flex: lastCount` track from its
 * upcoming-months column. That's not cosmetic: `trackRef` is what
 * `useRangeScrub` measures pointer positions against, so letting it span the
 * planned months would map every drag onto a track two months wider than the
 * range it can actually select, and the handles would drift away from the
 * pointer. Keeping the track to the real months means no rescaling anywhere.
 */
export default function LayerCoverageStrip({
  coverage,
  months,
  range,
  onChange,
  detached,
  onResync,
  label,
}: {
  coverage: LayerCoverage;
  months: string[];
  range: DateRange;
  onChange: (range: DateRange) => void;
  detached: boolean;
  onResync: () => void;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { dragging, beginDrag, pctFor } = useRangeScrub({
    trackRef,
    count: months.length,
    range,
    onChange,
  });

  const startPct = pctFor(range.startIndex);
  const endPct = pctFor(range.endIndex);
  const lastCount = months.length - 1;
  const realKinds = coverage.kinds.slice(0, months.length);
  const plannedKinds = coverage.kinds.slice(months.length);

  function tickClass(kind: (typeof coverage.kinds)[number]) {
    if (kind === "captured") return "block w-[3px] h-[8px] rounded-[1px] bg-[#096151]";
    if (kind === "gap") return "block w-[3px] h-[4px] rounded-[1px] bg-[#dedee3]";
    return "block w-[3px] h-[4px] rounded-[1px] bg-[#dedee3] opacity-40";
  }

  return (
    <div className="mt-[8px] pl-[32px]">
      <div className="flex items-stretch gap-[6px]">
        <div
          ref={trackRef}
          className="relative h-[14px] select-none touch-none min-w-0"
          style={{ flex: `${lastCount} 1 0%` }}
          role="group"
          aria-label={`${label} coverage`}
        >
          {/* Selection band, behind the ticks so a captured month inside the
              selection still reads as a tick rather than a block of colour. */}
          <div
            className={`absolute top-[3px] h-[8px] rounded-[3px] bg-[#096151]/12 pointer-events-none ${
              dragging ? "" : "transition-all duration-200"
            }`}
            style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
          />
          {/* Ticks positioned off the same pctFor the handles use, so a capture
              mark and a handle standing on the same month line up exactly. */}
          {realKinds.map((kind, i) => (
            <span
              key={i}
              aria-hidden
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none ${tickClass(kind)}`}
              style={{ left: `${pctFor(i)}%` }}
            />
          ))}
          {/* Drag surfaces last so they sit above the ticks. */}
          <div
            onPointerDown={(e) => beginDrag("move", e.clientX)}
            className="absolute top-[3px] h-[8px] cursor-grab active:cursor-grabbing"
            style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
          />
          <button
            type="button"
            onPointerDown={(e) => beginDrag("start", e.clientX)}
            aria-label={`${label} range start`}
            className="absolute top-0 -ml-[4px] w-[8px] h-[14px] rounded-[3px] border border-[#096151] bg-white cursor-ew-resize"
            style={{ left: `${startPct}%` }}
          />
          <button
            type="button"
            onPointerDown={(e) => beginDrag("end", e.clientX)}
            aria-label={`${label} range end`}
            className="absolute top-0 -ml-[4px] w-[8px] h-[14px] rounded-[3px] border border-[#096151] bg-white cursor-ew-resize"
            style={{ left: `${endPct}%` }}
          />
        </div>

        {/* Locked preview of what's coming. Outside the track on purpose — see
            the component comment. */}
        {plannedKinds.length > 0 && (
          <div
            className="relative h-[14px] flex items-center justify-around"
            style={{ flex: `${PLANNED_TAIL_MONTHS} 1 0%` }}
            aria-hidden
          >
            {plannedKinds.map((kind, i) => (
              <span key={i} className={tickClass(kind)} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-[2px]">
        <span className="text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] tabular-nums">
          {coverageCaption(coverage)}
        </span>
        {detached && (
          <button
            type="button"
            onClick={onResync}
            title={`Re-sync ${label} to the timeline`}
            className="u-press flex items-center gap-[4px] px-[6px] rounded-[6px] border border-[#096151] text-[10px] text-[#096151] font-['Outfit',sans-serif] leading-[16px] hover:bg-[#ebece7] cursor-pointer whitespace-nowrap"
          >
            {months[range.startIndex]}–{months[range.endIndex]} ↺
          </button>
        )}
      </div>
    </div>
  );
}
