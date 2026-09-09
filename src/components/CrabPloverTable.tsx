import { useMemo, useState } from "react";
import {
  birdPlacement,
  CRAB_PLOVER_RECTS,
  PLOVER_AGE_LABEL,
  WEST_REEF_ZONE,
  type CrabPlover,
  type PloverAge,
} from "../data/crabPlovers";

/**
 * The Crab-plover census, in place of the tree table.
 *
 * A coastal island is not surveyed for trees, and the tree list on this site
 * would be `treePopulation.ts`'s individuals reported at positions that fall in
 * open water — see `crabPlovers.ts` for the whole argument. This lists what is
 * actually counted here: twenty ringed birds per survey block, five blocks.
 *
 * Grouped by block rather than presented as one flat 100-row list, because the
 * block is the unit of the survey — it is the rectangle drawn on the imagery,
 * and a reader comparing "West bank" with "North cay" is comparing the two
 * things the census was designed to let them compare.
 */

/** Age-class colours. Deliberately NOT the condition palette: those five
 *  colours mean canopy health everywhere else in this app, and an age class is
 *  not a health judgement — an immature bird is not a degraded one. A neutral
 *  ramp keeps the two vocabularies apart. */
const AGE_COLOR: Record<PloverAge, string> = {
  adult: "#3F5C6B",
  immature: "#7C93A1",
  juvenile: "#B8C7CF",
};

export default function CrabPloverTable({
  birds,
  areaName,
  monthLabels,
  selectedId,
  onSelect,
  splitGroups = false,
  captureIndex,
}: {
  birds: CrabPlover[];
  areaName: string;
  monthLabels: string[];
  selectedId?: string | null;
  onSelect?: (bird: CrabPlover) => void;
  /** Whether to show the West reef colony as its own block, rather than
   *  folding those birds into North cay under their home rectangle. Off by
   *  default — see Alma's split prompt in `AreaImageStage`, which is what
   *  actually flips this on. */
  splitGroups?: boolean;
  /** Which capture to resolve each bird's current spot against, when
   *  `splitGroups` is on. Required for a real split — without it there is no
   *  way to say which birds have migrated yet. */
  captureIndex?: number;
}) {
  const [query, setQuery] = useState("");
  const [openRect, setOpenRect] = useState<string | null>(CRAB_PLOVER_RECTS[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return birds;
    return birds.filter(
      (b) =>
        b.id.toLowerCase().includes(q) ||
        b.rectLabel.toLowerCase().includes(q) ||
        b.activity.toLowerCase().includes(q) ||
        PLOVER_AGE_LABEL[b.age].toLowerCase().includes(q),
    );
  }, [birds, query]);

  // A search that matches nothing in the open block is a search that looks
  // broken, so searching opens every block that has a hit.
  const searching = query.trim().length > 0;

  const canSplit = splitGroups && captureIndex !== undefined;

  /** Which block a bird sits under right now — its home rectangle normally,
   *  or wherever `birdPlacement` puts it once the reader has asked for the
   *  split. The single place this decision is made, so a row can't land in a
   *  different block than the one its own marker is drawn in on the map. */
  function groupIdFor(bird: CrabPlover): string {
    return canSplit ? birdPlacement(bird, captureIndex!).zoneId : bird.rectId;
  }

  const blocks = canSplit
    ? [CRAB_PLOVER_RECTS[0], WEST_REEF_ZONE].filter((b): b is NonNullable<typeof b> => !!b)
    : CRAB_PLOVER_RECTS;

  return (
    <div className="h-full flex flex-col surface-card overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-[#dedee3] shrink-0 flex flex-col gap-[8px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
            Crab-plover in {areaName}{" "}
            <span className="font-normal text-[#5b5b66]">
              {filtered.length === birds.length ? `(${birds.length})` : `(${filtered.length} of ${birds.length})`}
            </span>
          </span>
          {searching && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-[11px] text-[#096151] hover:underline font-['Outfit',sans-serif] shrink-0 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px]">
          <span className="italic">Dromas ardeola</span> — burrow-nesting shorebird, counted per survey block; the
          blocks are the rectangles drawn on the captures.
          {canSplit && " Split into North cay and West reef, per Alma's suggestion."}
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ring id, block, age or behaviour"
          className="w-full h-[30px] px-[10px] rounded-[8px] border border-[#dedee3] bg-white text-[12px] font-['Outfit',sans-serif] outline-none focus:border-[#096151]"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-slim">
        {blocks.map((rect) => {
          const rows = filtered.filter((b) => groupIdFor(b) === rect.id);
          if (searching && rows.length === 0) return null;
          const open = searching || openRect === rect.id;
          return (
            <div key={rect.id} className="border-b border-[#eeeef1] last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenRect((prev) => (prev === rect.id ? null : rect.id))}
                aria-expanded={open}
                className="u-press w-full flex items-center gap-[8px] px-4 py-[9px] text-left cursor-pointer hover:bg-[#fbfbfa]"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="shrink-0 text-[#8a8a94] transition-transform duration-(--dur-2)"
                  style={{ transform: open ? "rotate(90deg)" : "none" }}
                  aria-hidden="true"
                >
                  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] leading-[17px]">
                    {rect.label}
                  </span>
                  <span className="block text-[10.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px]">
                    {rect.habitat}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-[#5b5b66] font-['Outfit',sans-serif] tabular-nums">
                  {rows.length}
                </span>
              </button>

              {open && (
                <div className="pb-[6px]">
                  {/* A header row per block rather than one sticky header for
                      the whole list: the list is a stack of small tables, and
                      a single header would sit far from most of the rows it
                      names. */}
                  <div className="grid grid-cols-[76px_1fr_84px_64px] gap-[8px] px-4 py-[4px] text-[9.5px] font-semibold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.05em]">
                    <span>Ring</span>
                    <span>Behaviour</span>
                    <span>Age</span>
                    <span className="text-right">Last seen</span>
                  </div>
                  {rows.map((bird) => (
                    <button
                      key={bird.id}
                      type="button"
                      onClick={() => onSelect?.(bird)}
                      className={`w-full grid grid-cols-[76px_1fr_84px_64px] gap-[8px] px-4 py-[5px] text-left cursor-pointer transition-colors duration-150 ${
                        selectedId === bird.id ? "bg-[#e7f4f2]" : "hover:bg-[#fbfbfa]"
                      }`}
                    >
                      <span className="text-[11.5px] font-medium text-[#18181c] font-['Outfit',sans-serif] tabular-nums">
                        {bird.id}
                      </span>
                      <span className="text-[11.5px] text-[#464650] font-['Outfit',sans-serif] truncate">
                        {bird.activity}
                      </span>
                      <span className="flex items-center gap-[5px] min-w-0">
                        <span
                          className="shrink-0 w-[7px] h-[7px] rounded-full"
                          style={{ background: AGE_COLOR[bird.age] }}
                          aria-hidden="true"
                        />
                        <span className="text-[11.5px] text-[#464650] font-['Outfit',sans-serif] truncate">
                          {PLOVER_AGE_LABEL[bird.age]}
                        </span>
                      </span>
                      <span className="text-[11px] text-[#8a8a94] font-['Outfit',sans-serif] tabular-nums text-right">
                        {monthLabels[bird.lastSeenMonth] ?? "—"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {searching && filtered.length === 0 && (
          <p className="px-4 py-6 text-[12px] text-[#71717a] font-['Outfit',sans-serif] text-center">
            No bird matches that.
          </p>
        )}
      </div>
    </div>
  );
}
