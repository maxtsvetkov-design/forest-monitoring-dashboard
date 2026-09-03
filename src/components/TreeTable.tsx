import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CROWN_LABEL, type TreeRecord } from "../data/trees";
import FilterDropdown from "./FilterDropdown";
import { clamp, useDragResize } from "../hooks/useDragResize";
import type { TreeFilters } from "../hooks/useTreeFilters";

const HEALTH_COLOR: Record<TreeRecord["health"], string> = {
  Healthy: "#24A67A",
  Stressed: "#F0B429",
  Declining: "#E55C2F",
  Dead: "#9A9A9A",
};

const HEALTH_ORDER: TreeRecord["health"][] = ["Healthy", "Stressed", "Declining", "Dead"];

// Health and diameter are ordinals, not words: sorting them alphabetically
// would order Declining < Dead < Healthy < Stressed, which means nothing to a
// ranger. These rank maps are what the comparator actually sorts on.
const HEALTH_RANK: Record<TreeRecord["health"], number> = {
  Healthy: 0,
  Stressed: 1,
  Declining: 2,
  Dead: 3,
};

const DIAMETER_RANK: Record<TreeRecord["diameter"], number> = {
  "L (>5 m)": 0,
  "M (2–5 m)": 1,
  "S (<1 m)": 2,
};

type SortDir = "asc" | "desc";

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

const COLUMNS: Column[] = [
  { key: "id", label: "ID", defaultWidth: 90, minWidth: 64, sortValue: (t) => t.id, defaultDir: "asc" },
  { key: "species", label: "Species", defaultWidth: 140, minWidth: 90, sortValue: (t) => t.species, defaultDir: "asc" },
  // Worst-first: "show me what's dying" is the reason anyone sorts this column.
  { key: "health", label: "Health", defaultWidth: 115, minWidth: 88, sortValue: (t) => HEALTH_RANK[t.health], defaultDir: "desc" },
  { key: "diameter", label: "Diameter", defaultWidth: 105, minWidth: 80, sortValue: (t) => DIAMETER_RANK[t.diameter], defaultDir: "asc" },
  { key: "height", label: "Height (m)", defaultWidth: 85, minWidth: 70, sortValue: (t) => t.height, defaultDir: "desc" },
  // Sorts on monthIndex, not the label — "Sep '26" vs "Oct '25" as strings is
  // alphabetical nonsense.
  { key: "crown", label: "Crown r. (m)", defaultWidth: 100, minWidth: 78, sortValue: (t) => t.crownRadius, defaultDir: "desc" },
  { key: "lastSurveyed", label: "Last surveyed", defaultWidth: 115, minWidth: 90, sortValue: (t) => t.monthIndex, defaultDir: "desc" },
];

const CROWN_ORDER = ["b1", "b2", "b3", "b4", "b5"] as const;

const KEYBOARD_RESIZE_STEP = 16;

function HealthBadge({ health }: { health: TreeRecord["health"] }) {
  return (
    <span
      className="inline-flex items-center gap-[6px] px-[8px] py-[2px] rounded-full text-[12px] font-['Inter',sans-serif] whitespace-nowrap"
      style={{ background: `${HEALTH_COLOR[health]}1a`, color: HEALTH_COLOR[health] }}
    >
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: HEALTH_COLOR[health] }} />
      {health}
    </span>
  );
}

function SortArrow({ dir, active }: { dir: SortDir; active: boolean }) {
  return (
    <svg
      viewBox="0 0 8 10"
      aria-hidden="true"
      className={`w-[8px] h-[10px] shrink-0 transition-opacity duration-150 ${
        active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
      }`}
      style={{ transform: dir === "desc" ? "rotate(180deg)" : undefined }}
    >
      <path d="M4 0L8 5H0z" fill="currentColor" />
    </svg>
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
      className="inline-flex items-center gap-[5px] px-[8px] py-[3px] rounded-full text-[11px] font-['Inter',sans-serif] border transition-all duration-150 cursor-pointer"
      style={{
        background: selected ? `${tint}1a` : "transparent",
        borderColor: selected ? `${tint}66` : "#e5e5e5",
        color: selected ? tint : "#6b6b6b",
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
  /** Filter state, owned by AreasView so the map can honour it too. */
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
}

export default function TreeTable({ records, filters, areaName, onSelect, selectedId, hoveredId }: TreeTableProps) {
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
  // selection made from OUTSIDE the table (a map pin click in AreasView),
  // since the map has no idea where the table has scrolled to.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-tree-id="${selectedId}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const filtersActive = filters.active;
  const clearFilters = filters.clear;

  const totalWidth = COLUMNS.reduce((sum, c) => sum + widths[c.key], 0);

  return (
    <div className="h-full flex flex-col bg-white border border-[rgba(0,0,0,0.06)] rounded-[12px] overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-[#e5e5e5] shrink-0 flex flex-col gap-[8px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[14px] font-bold text-[#141414] font-['Inter',sans-serif]">
            Trees in {areaName}{" "}
            <span className="font-normal text-[#6b6b6b]">
              {visible.length === records.length
                ? `(${records.length})`
                : `(${visible.length} of ${records.length})`}
            </span>
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] text-[#096151] hover:underline font-['Inter',sans-serif] shrink-0 cursor-pointer"
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
          className="w-full px-[10px] py-[5px] text-[12px] font-['Inter',sans-serif] border border-[#e5e5e5] rounded-[6px] outline-none focus:border-[#096151] transition-colors duration-150"
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
        </div>
      </div>

      <div ref={scrollRef} className="scroll-slim flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-[10px] px-6 text-center">
            <span className="text-[13px] text-[#6b6b6b] font-['Inter',sans-serif]">
              {records.length === 0
                ? "No trees surveyed in the selected date range."
                : "No trees match the current filters."}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-[12px] py-[5px] text-[12px] font-['Inter',sans-serif] text-white bg-[#096151] rounded-[6px] hover:bg-[#0b7a64] transition-colors duration-150 cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          // Fixed layout so the <col> widths are authoritative. `minWidth: 100%`
          // lets the table stretch to fill a wide pane, while the px width means
          // a pane narrower than the columns scrolls horizontally instead of
          // crushing them — see the split-pane divider in AreasView.
          <table
            className="text-left border-collapse"
            style={{ tableLayout: "fixed", width: `${totalWidth}px`, minWidth: "100%" }}
          >
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: `${widths[c.key]}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 bg-[#fafafa] z-10">
              <tr className="text-[12px] text-[#6b6b6b] font-['Inter',sans-serif]">
                {COLUMNS.map((column) => {
                  const active = sort.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      className="relative px-0 py-0 font-medium border-b border-[#e5e5e5]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={`group w-full flex items-center gap-[4px] px-4 py-2 text-left hover:bg-[#f0f0f0] transition-colors duration-100 cursor-pointer ${
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
                  className={`border-t border-[#f0f0f0] cursor-pointer transition-colors duration-100 outline-none focus-visible:bg-[#0961511a] ${
                    selectedId === t.id
                      ? "bg-[#0961511a]"
                      : hoveredId === t.id
                        ? "bg-[#09615110]"
                        : "hover:bg-[#fafafa]"
                  }`}
                >
                  <td className="px-4 py-2 text-[13px] text-[#141414] font-['Inter',sans-serif] truncate">{t.id}</td>
                  <td className="px-4 py-2 text-[13px] text-[#363636] font-['Inter',sans-serif] truncate">{t.species}</td>
                  <td className="px-4 py-2 overflow-hidden">
                    <HealthBadge health={t.health} />
                  </td>
                  <td className="px-4 py-2 text-[13px] text-[#363636] font-['Inter',sans-serif] truncate">{t.diameter}</td>
                  <td className="px-4 py-2 text-[13px] text-[#363636] font-['Inter',sans-serif] truncate">{t.height}</td>
                  <td className="px-4 py-2 text-[13px] text-[#363636] font-['Inter',sans-serif] truncate">{t.crownRadius}</td>
                  <td className="px-4 py-2 text-[13px] text-[#363636] font-['Inter',sans-serif] truncate">{t.lastSurveyed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
