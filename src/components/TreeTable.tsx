import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CROWN_LABEL, type TreeRecord } from "../data/trees";
import FilterDropdown from "./FilterDropdown";
import { clamp, useDragResize } from "../hooks/useDragResize";
import type { TreeFilters } from "../hooks/useTreeFilters";
import { CONDITIONS } from "../data/taxonomy";
import { SortArrow, type SortDir } from "./SortArrow";

// Keyed by display label and derived from the taxonomy — see HEALTH_RANK below
// for why a hand-written map here is a silent failure rather than a loud one.
const HEALTH_COLOR: Record<string, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.label, c.color]),
);

/** Best first, for the filter chips. */
const HEALTH_ORDER: string[] = [...CONDITIONS].reverse().map((c) => c.label);

// Condition and diameter are ordinals, not words: sorting them alphabetically
// would order Defoliated < Moderate < Normal < Sparse < Vigorous, which means
// nothing to a ranger. These rank maps are what the comparator actually sorts
// on.
//
// Built from CONDITIONS rather than written out, because `TreeRecord["health"]`
// is a display string — a hand-written map here still typechecks perfectly
// after the labels change and simply returns `undefined` for every row, which
// is a sort that silently does nothing rather than an error anyone would see.
const HEALTH_RANK: Record<string, number> = Object.fromEntries(
  [...CONDITIONS].reverse().map((c, i) => [c.label, i]),
);

const DIAMETER_RANK: Record<TreeRecord["diameter"], number> = {
  "L (>5 m)": 0,
  "M (2–5 m)": 1,
  "S (<1 m)": 2,
};

interface Column {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  /** What the comparator sorts on — never the rendered string for ordinals. */
  sortValue: (t: TreeRecord) => number | string;
  /** First click on this header sorts this way. */
  defaultDir: SortDir;
}

// Default widths are sized so the *header label* fits beside its sort arrow
// inside the cell's px-4 padding, not just the data — a column whose own name
// renders as "Crown r. (m…" is unreadable however tidy the rows below it are.
// The table scrolls horizontally (fixed layout, explicit totalWidth), so a
// wider column costs its neighbours nothing.
const COLUMNS: Column[] = [
  { key: "id", label: "ID", defaultWidth: 98, minWidth: 72, sortValue: (t) => t.id, defaultDir: "asc" },
  { key: "species", label: "Species", defaultWidth: 122, minWidth: 90, sortValue: (t) => t.species, defaultDir: "asc" },
  { key: "genus", label: "Genus", defaultWidth: 118, minWidth: 86, sortValue: (t) => t.genus, defaultDir: "asc" },
  {
    key: "scientificName",
    label: "Scientific name",
    // Binomials are long ("Leptadenia pyrotechnica"), and this column holds
    // the one string in the row that cannot be guessed from its neighbours.
    defaultWidth: 178,
    minWidth: 120,
    sortValue: (t) => t.scientificName,
    defaultDir: "asc",
  },
  // Worst-first: "show me what's dying" is the reason anyone sorts this column.
  { key: "health", label: "Health", defaultWidth: 115, minWidth: 88, sortValue: (t) => HEALTH_RANK[t.health], defaultDir: "desc" },
  { key: "diameter", label: "Diameter", defaultWidth: 105, minWidth: 80, sortValue: (t) => DIAMETER_RANK[t.diameter], defaultDir: "asc" },
  { key: "height", label: "Height (m)", defaultWidth: 98, minWidth: 78, sortValue: (t) => t.height, defaultDir: "desc" },
  // Sorts on monthIndex, not the label — "Sep '26" vs "Oct '25" as strings is
  // alphabetical nonsense.
  { key: "crown", label: "Crown r. (m)", defaultWidth: 110, minWidth: 84, sortValue: (t) => t.crownRadius, defaultDir: "desc" },
  { key: "lastSurveyed", label: "Last surveyed", defaultWidth: 115, minWidth: 90, sortValue: (t) => t.monthIndex, defaultDir: "desc" },
];

const CROWN_ORDER = ["b1", "b2", "b3", "b4", "b5"] as const;

// The diameter values are the record's own `diameter` strings (see
// data/trees.ts's DIAMETER_LABEL) — the filter matches them directly, so the
// dropdown offers exactly those, not a parallel set of labels that could
// drift out of sync with them.
const DIAMETER_ORDER = ["L (>5 m)", "M (2–5 m)", "S (<1 m)"] as const;

// Height bands, worded from the thresholds in monthlySnapshots.ts's
// heightBucketFor — the donut labels these "1"/"2"/"3", which says nothing on
// its own once it's a filter chip sitting next to "Crown r." and "Diameter".
const HEIGHT_ORDER = [
  { key: "h1", label: "Tall (≥5.5 m)" },
  { key: "h2", label: "Mid (2–5.5 m)" },
  { key: "h3", label: "Short (<2 m)" },
] as const;

const TWIN_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const KEYBOARD_RESIZE_STEP = 16;

function HealthBadge({ health }: { health: TreeRecord["health"] }) {
  return (
    <span
      className="inline-flex items-center gap-[6px] px-[8px] py-[2px] rounded-full text-[12px] font-['Outfit',sans-serif] whitespace-nowrap"
      style={{ background: `${HEALTH_COLOR[health]}1a`, color: HEALTH_COLOR[health] }}
    >
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: HEALTH_COLOR[health] }} />
      {health}
    </span>
  );
}

/** A toggle chip for one facet value. Selected state carries the value's colour. */
function FacetChip({
  label,
  color,
  selected,
  onToggle,
}: {
  label: string;
  color?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const tint = color ?? "#096151";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="inline-flex items-center gap-[5px] px-[8px] py-[3px] rounded-full text-[11px] font-['Outfit',sans-serif] border transition-all duration-150 cursor-pointer"
      style={{
        background: selected ? `${tint}1a` : "transparent",
        borderColor: selected ? `${tint}66` : "#dedee3",
        color: selected ? tint : "#5b5b66",
      }}
    >
      {color && <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: tint }} />}
      {label}
    </button>
  );
}

interface TreeTableProps {
  /** Everything in the selected date range, before filters. Drives the "of m" count. */
  records: TreeRecord[];
  /** Filter state, owned by AssetsView so the map can honour it too. */
  filters: TreeFilters;
  areaName: string;
  /** Selecting a row flies the map to that tree. */
  onSelect: (record: TreeRecord) => void;
  selectedId: string | null;
  /** The tree currently under the pointer on the map (not clicked) — a
   * lighter, non-scrolling highlight than `selectedId`'s, since roaming the
   * mouse across a cluster of pins shouldn't yank the table's scroll
   * position around on every pixel of movement. */
  hoveredId?: string | null;
  /** Opens this tree's digital twin — the modelled tree at eye level with its
   * full record beside it. Only passed while the twin layer is switched on:
   * there is nothing to fly into otherwise, and a button that lands you in an
   * empty sky is worse than no button. */
  onInspect?: (record: TreeRecord) => void;
  /** The tree whose twin is currently open, so its row can say so. */
  inspectingId?: string | null;
}

export default function TreeTable({
  records,
  filters,
  areaName,
  onSelect,
  selectedId,
  hoveredId,
  onInspect,
  inspectingId,
}: TreeTableProps) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "id", dir: "asc" });
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth])),
  );
  const [resizingKey, setResizingKey] = useState<string | null>(null);

  // Filtering happens in the hook (shared with the map); only ordering, which
  // is presentation the map has no use for, is applied here.
  const visible = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key);
    if (!column) return filters.visible;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filters.visible].sort((a, b) => {
      const av = column.sortValue(a);
      const bv = column.sortValue(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filters.visible, sort]);

  const toggleSort = useCallback((column: Column) => {
    setSort((prev) =>
      prev.key === column.key
        ? { key: column.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: column.key, dir: column.defaultDir },
    );
  }, []);

  const applyWidth = useCallback((key: string, next: number) => {
    setWidths((prev) => ({ ...prev, [key]: next }));
  }, []);

  // Which column the active grip belongs to. A ref, not state: the pointer
  // handler needs to read it synchronously on every move.
  const resizeColRef = useRef<Column | null>(null);
  const resize = useDragResize({
    // The hook's clamp is shared by every grip, so it only enforces the outer
    // bound; the per-column minimum is applied below.
    min: 0,
    max: 900,
    onChange: (next) => {
      const column = resizeColRef.current;
      if (column) applyWidth(column.key, Math.max(column.minWidth, next));
    },
    onEnd: () => {
      resizeColRef.current = null;
      setResizingKey(null);
    },
  });

  // Scrolls the selected row into view whenever it changes -- including a
  // selection made from OUTSIDE the table (a map pin click in AssetsView),
  // since the map has no idea where the table has scrolled to.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-tree-id="${selectedId}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const filtersActive = filters.active;
  const clearFilters = filters.clear;

  const TWIN_COLUMN_WIDTH = 44;
  const totalWidth = COLUMNS.reduce((sum, c) => sum + widths[c.key], 0) + (onInspect ? TWIN_COLUMN_WIDTH : 0);

  return (
    <div className="h-full flex flex-col surface-card overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-[#dedee3] shrink-0 flex flex-col gap-[8px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
            Trees in {areaName}{" "}
            <span className="font-normal text-[#5b5b66]">
              {visible.length === records.length
                ? `(${records.length})`
                : `(${visible.length} of ${records.length})`}
            </span>
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] text-[#096151] hover:underline font-['Outfit',sans-serif] shrink-0 cursor-pointer"
            >
              Clear all
            </button>
          )}
        </div>

        <input
          type="search"
          value={filters.query}
          onChange={(e) => filters.setQuery(e.target.value)}
          placeholder="Search ID or species…"
          aria-label="Search trees by ID or species"
          className="w-full px-[10px] py-[5px] text-[12px] font-['Outfit',sans-serif] border border-[#dedee3] rounded-[6px] outline-none focus:border-[#096151] transition-colors duration-150"
        />

        <div className="flex flex-wrap gap-[6px]">
          <FilterDropdown
            label="Health"
            options={HEALTH_ORDER.map((h) => ({ value: h, label: h, color: HEALTH_COLOR[h] }))}
            selected={filters.healthFilter}
            onToggle={filters.toggleHealth}
          />
          <FilterDropdown
            label="Species"
            options={filters.speciesOptions.map((sp) => ({ value: sp, label: sp }))}
            selected={filters.speciesFilter}
            onToggle={filters.toggleSpecies}
          />
          <FilterDropdown
            label="Crown r."
            options={CROWN_ORDER.map((key) => ({ value: key, label: `${CROWN_LABEL[key]} m` }))}
            selected={filters.crownFilter}
            onToggle={filters.toggleCrown}
          />
          {/* Diameter and height have no dropdown of their own elsewhere, but
              the KPI donuts can hand a filter over on either — without these
              the user would land on a filtered table with no visible reason
              for it and nothing to toggle off.

              Diameter only ever has 3 buckets, so a dropdown was one extra
              click to see options that would already fit on one row — a
              small horizontal segmented selector reads the whole facet (and
              the active selection) at a glance instead. */}
          <div className="flex items-center gap-[4px] px-[6px] py-[3px] rounded-[8px] border border-[#dedee3]">
            <span className="text-[11px] text-[#71717a] font-['Outfit',sans-serif] pr-[2px] whitespace-nowrap">
              Diameter
            </span>
            {DIAMETER_ORDER.map((value) => {
              const active = filters.diameterFilter.has(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => filters.toggleDiameter(value)}
                  aria-pressed={active}
                  className={`u-press px-[8px] py-[3px] rounded-[6px] text-[11px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-150 ${
                    active ? "bg-[#096151] text-white" : "text-[#464650] hover:bg-[#ebece7]"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
          <FilterDropdown
            label="Height"
            options={HEIGHT_ORDER.map(({ key, label }) => ({ value: key, label }))}
            selected={filters.heightFilter}
            onToggle={filters.toggleHeight}
          />
          {/* A toggle rather than a dropdown: it's one derived condition
              ("worse than this selection's own average"), not a list. */}
          <button
            type="button"
            onClick={filters.toggleCanopyLoss}
            aria-pressed={filters.canopyLossOnly}
            title={`Trees losing more than the ${filters.canopyLossMean.toFixed(0)}% average canopy across this selection`}
            className={`u-press flex items-center gap-[5px] px-[10px] py-[6px] rounded-[6px] border text-[12px] font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150 ${
              filters.canopyLossOnly
                ? "bg-[#096151] border-[#096151] text-white"
                : "border-[#dedee3] text-[#464650] hover:border-[#b9b9b9]"
            }`}
          >
            Above-avg. canopy loss
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="scroll-slim flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-[10px] px-6 text-center">
            <span className="text-[13px] text-[#5b5b66] font-['Outfit',sans-serif]">
              {records.length === 0
                ? "No trees surveyed in the selected date range."
                : "No trees match the current filters."}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-[12px] py-[6px] text-[12px] font-['Outfit',sans-serif] text-white bg-[#096151] rounded-[6px] hover:bg-[#0b7a64] transition-colors duration-150 cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          // Fixed layout so the <col> widths are authoritative. `minWidth: 100%`
          // lets the table stretch to fill a wide pane, while the px width means
          // a pane narrower than the columns scrolls horizontally instead of
          // crushing them — see the split-pane divider in AssetsView.
          <table
            className="text-left border-collapse"
            style={{ tableLayout: "fixed", width: `${totalWidth}px`, minWidth: "100%" }}
          >
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: `${widths[c.key]}px` }} />
              ))}
              {onInspect && <col style={{ width: `${TWIN_COLUMN_WIDTH}px` }} />}
            </colgroup>
            <thead className="sticky top-0 bg-[#f6f6f8] z-10">
              <tr className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif]">
                {COLUMNS.map((column) => {
                  const active = sort.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      className="relative px-0 py-0 font-medium border-b border-[#dedee3]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={`group w-full flex items-center gap-[4px] px-4 py-2 text-left hover:bg-[#ebece7] transition-colors duration-100 cursor-pointer ${
                          active ? "text-[#096151]" : ""
                        }`}
                      >
                        <span className="truncate">{column.label}</span>
                        <SortArrow dir={active ? sort.dir : column.defaultDir} active={active} />
                      </button>

                      <button
                        type="button"
                        aria-label={`Resize ${column.label} column`}
                        onPointerDown={(e) => {
                          resizeColRef.current = column;
                          setResizingKey(column.key);
                          resize.begin(e, widths[column.key]);
                        }}
                        onDoubleClick={() => applyWidth(column.key, column.defaultWidth)}
                        onKeyDown={(e) => {
                          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                          e.preventDefault();
                          const delta = e.key === "ArrowRight" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
                          applyWidth(column.key, Math.max(column.minWidth, widths[column.key] + delta));
                        }}
                        className={`col-grip ${resizingKey === column.key ? "col-grip--active" : ""}`}
                      />
                    </th>
                  );
                })}
                {onInspect && (
                  <th scope="col" className="px-0 py-0 border-b border-[#dedee3]">
                    <span className="sr-only">Digital twin</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr
                  key={t.id}
                  data-tree-id={t.id}
                  tabIndex={0}
                  aria-selected={selectedId === t.id}
                  onClick={() => onSelect(t)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelect(t);
                  }}
                  className={`border-t border-[#ebece7] cursor-pointer transition-colors duration-100 outline-none focus-visible:bg-[#0961511a] ${
                    selectedId === t.id
                      ? "bg-[#0961511a]"
                      : hoveredId === t.id
                        ? "bg-[#09615110]"
                        : "hover:bg-[#f6f6f8]"
                  }`}
                >
                  <td className="px-4 py-2 text-[13px] text-[#18181c] font-['Outfit',sans-serif] truncate">{t.id}</td>
                  <td className="px-4 py-2 text-[13px] text-[#464650] font-['Outfit',sans-serif] truncate">{t.species}</td>
                  <td className="px-4 py-2 text-[13px] text-[#5b5b66] font-['Outfit',sans-serif] truncate">{t.genus}</td>
                  {/* Italic because it is a binomial, which is how a botanical
                      name is set — and it doubles as a visual cue that this
                      column is the formal name, not another local one. */}
                  <td className="px-4 py-2 text-[13px] text-[#5b5b66] font-['Outfit',sans-serif] italic truncate">
                    {t.scientificName}
                  </td>
                  <td className="px-4 py-2 overflow-hidden">
                    <HealthBadge health={t.health} />
                  </td>
                  <td className="px-4 py-2 text-[13px] text-[#464650] font-['Outfit',sans-serif] truncate">{t.diameter}</td>
                  <td className="px-4 py-2 text-[13px] text-[#464650] font-['Outfit',sans-serif] truncate">{t.height}</td>
                  <td className="px-4 py-2 text-[13px] text-[#464650] font-['Outfit',sans-serif] truncate">{t.crownRadius}</td>
                  <td className="px-4 py-2 text-[13px] text-[#464650] font-['Outfit',sans-serif] truncate">{t.lastSurveyed}</td>
                  {onInspect && (
                    <td className="px-0 py-2 text-center overflow-hidden">
                      <button
                        type="button"
                        // The row itself already means "highlight this tree";
                        // this means "go stand next to it", which is a
                        // different action, so it must not also fire the row.
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspect(t);
                        }}
                        title={`Open ${t.id}'s digital twin`}
                        aria-label={`Open ${t.id}'s digital twin`}
                        aria-pressed={inspectingId === t.id}
                        className={`u-press w-[28px] h-[24px] inline-flex items-center justify-center rounded-[7px] border transition-colors duration-100 cursor-pointer ${
                          inspectingId === t.id
                            ? "bg-[#096151] border-[#096151] text-white"
                            : "border-[#dedee3] text-[#5b5b66] hover:bg-[#ebece7] hover:text-[#18181c]"
                        }`}
                      >
                        {/* The layer chip's own tree glyph, so the button and
                            the layer it opens are visibly the same thing. */}
                        <svg width="13" height="13" viewBox="0 0 16 16" {...TWIN_STROKE}>
                          <path d="M8 13.5v-2.6" />
                          <path d="M8 1.8 4.4 6.4h7.2Z" />
                          <path d="M8 5.6 3.4 10.9h9.2Z" />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
