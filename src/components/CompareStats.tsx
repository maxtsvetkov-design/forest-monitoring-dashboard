import type { CompareContext } from "./RecentEventsList";

/** One row's worth of "what actually differs" — every value already exists
 * on the two `AggregatedSnapshot`s the caller computed (`aggregateRange` over
 * each capture's real month window), so this only formats and diffs them. */
function Row({
  label,
  a,
  b,
  format,
}: {
  label: string;
  a: number;
  b: number;
  format: (n: number) => string;
}) {
  const delta = b - a;
  const flat = Math.abs(delta) < 1e-9;
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-[10px] py-[8px] border-b border-[#eeeef1] last:border-b-0">
      <span className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif]">{label}</span>
      <span className="text-[13px] font-semibold text-[#18181c] font-['Outfit',sans-serif] tabular-nums text-right">
        {format(a)}
      </span>
      <span className="text-[12px] text-[#8a8a94] font-['Outfit',sans-serif]">→</span>
      <span
        className="text-[13px] font-bold font-['Outfit',sans-serif] tabular-nums text-right"
        style={{ color: flat ? "#18181c" : delta > 0 ? "#096151" : "#c0392b" }}
      >
        {format(b)}
      </span>
    </div>
  );
}

/**
 * What actually changed between the two windows a habitat-timeline "Compare"
 * toggle pairs — every figure here is `aggregateRange` run over that
 * capture's own real month span (see App.tsx's `habitatCompareStats`), the
 * same function every other range-scoped number in this app uses. Nothing
 * is computed fresh for this card, and nothing claims the two photos
 * themselves were pixel-differenced — they're reference captures with no
 * change-detection pass run on them (see `PannableFrameStage`'s own honesty
 * comments); this is the real underlying data for the same two stretches of
 * time, read side by side.
 */
export default function CompareStats({ context }: { context: CompareContext }) {
  const { labelA, labelB, aggA, aggB, habitatEventsA, habitatEventsB } = context;
  return (
    <div className="flex flex-col gap-[14px] animate-fade-in-up">
      <div>
        <span className="block text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
          {labelA} vs {labelB}
        </span>
        <span className="block mt-[2px] text-[11.5px] text-[#8a8a94] font-['Outfit',sans-serif]">
          Real per-window figures for each stretch of months — not a pixel comparison of the two photos themselves.
        </span>
      </div>

      <div className="rounded-[12px] bg-[#f6f6f8] border border-[#eeeef1] px-[14px] py-[4px]">
        <Row label="Canopy cover" a={aggA.canopyCoverPct.value} b={aggB.canopyCoverPct.value} format={(n) => `${n.toFixed(1)}%`} />
        <Row
          label="Healthy trees"
          a={aggA.healthyTrees.value}
          b={aggB.healthyTrees.value}
          format={(n) => Math.round(n).toLocaleString()}
        />
        <Row
          label="Trees surveyed"
          a={aggA.totalTrees.value}
          b={aggB.totalTrees.value}
          format={(n) => Math.round(n).toLocaleString()}
        />
        <Row label="NDVI" a={aggA.ndvi.value} b={aggB.ndvi.value} format={(n) => n.toFixed(2)} />
        <Row
          label="Mature crown share"
          a={aggA.crownMaturePct.value}
          b={aggB.crownMaturePct.value}
          format={(n) => `${n.toFixed(1)}%`}
        />
        <Row label="Habitat sightings logged" a={habitatEventsA} b={habitatEventsB} format={(n) => `${n}`} />
      </div>
    </div>
  );
}
