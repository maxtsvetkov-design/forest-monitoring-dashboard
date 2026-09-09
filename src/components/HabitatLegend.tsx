import { useState } from "react";
import { MARINE_HABITAT, TERRESTRIAL_HABITAT, type LegendEntry } from "../data/habitatLegend";

/**
 * The marine/terrestrial habitat classification legend. Purely a reference
 * key — this app has no raster classified into these exact codes, so it is
 * presented as what it is (a habitat classification legend) rather than
 * implied to be a live, queryable map layer.
 *
 * The table itself now lives in `data/habitatLegend.ts`, shared with the
 * per-class change breakdown that charts three of these codes — see that
 * file for why one table rather than two.
 */

function Swatch({ entry }: { entry: LegendEntry }) {
  if (!entry.color) {
    return <span className="shrink-0 w-[18px] h-[18px] rounded-[3px] border border-[#c8c8ce]" aria-hidden="true" />;
  }
  return (
    <span
      className="shrink-0 w-[18px] h-[18px] rounded-[3px] border border-black/10"
      style={
        entry.hatched
          ? {
              backgroundColor: entry.color,
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(0,0,0,0.55) 0 2px, transparent 2px 5px)",
            }
          : { backgroundColor: entry.color }
      }
      aria-hidden="true"
    />
  );
}

function LegendSection({ title, entries }: { title: string; entries: LegendEntry[] }) {
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">{title}</span>
      <div className="flex flex-col gap-[6px]">
        {entries.map((entry) => (
          <div key={entry.code} className="flex items-start gap-[8px]">
            <Swatch entry={entry} />
            <span className="text-[11.5px] text-[#3d3d45] font-['Outfit',sans-serif] leading-[15px]">
              {entry.code}-{entry.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HabitatLegend({
  resolutionLabel = "10 × 10 m",
}: {
  /** Overridden once a hi-res pass has actually been delivered (see App.tsx's
   *  `hiResDelivered`) — this caption states the resolution the imagery
   *  beside it was actually captured at, so it has to track the same flag
   *  that swaps in the hi-res photo, not stay fixed at the tier default. */
  resolutionLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute right-[12px] bottom-[12px] z-10 flex flex-col items-end gap-[8px]">
      {open && (
        <div className="w-[300px] max-h-[calc(100%-56px)] overflow-y-auto scroll-slim rounded-[14px] bg-white border border-[#dedee3] shadow-[0px_16px_36px_-10px_rgba(0,0,0,0.28)] p-[14px] animate-fade-in-up">
          <div className="flex flex-col gap-[16px]">
            <LegendSection title="Marine Habitat" entries={MARINE_HABITAT} />
            <LegendSection title="Terrestrial Habitat" entries={TERRESTRIAL_HABITAT} />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={open}
        aria-label={open ? "Hide habitat legend" : "Show habitat legend"}
        className="u-press h-[34px] px-[14px] rounded-full bg-white border border-[#dedee3] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] text-[12.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] cursor-pointer flex items-center gap-[6px]"
      >
        <span className="w-[10px] h-[10px] rounded-[2px] bg-gradient-to-br from-[#2ECC71] to-[#1F4EA6]" aria-hidden="true" />
        Legend
      </button>
      <span className="px-[10px] py-[4px] rounded-full bg-[rgba(10,10,10,0.55)] backdrop-blur-[2px] text-[10.5px] text-white/85 font-['Outfit',sans-serif] whitespace-nowrap">
        Image resolution: {resolutionLabel}
      </span>
    </div>
  );
}
