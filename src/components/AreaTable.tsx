import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { imgIcTrendingUp } from "../assets";
import { areas } from "../data/areas";
import { aggregateRange } from "../data/aggregate";
import type { CategoryDatum } from "../data/types";
import { areaHectares } from "../data/overlays";
import { CURRENT_TIER_INDEX, TIERS } from "../data/tiers";
import { useDragResize } from "../hooks/useDragResize";
import { SortArrow, type SortDir } from "./SortArrow";

/**
 * The project/site table — one row per monitored area, grouped under its
 * project. Extracted from LandingScreen so the same table can serve both the
 * overview sidebar (cramped, 566px) and the Table tab's full-width view
 * without a second hand-copied implementation drifting away from the first.
 *
 * Modeled on the Figma "Projects / Dashboard" table (node 3279:72983): one
 * project group per row-group, its monitored sites listed underneath,
 * collapsible via the group's own chevron. Every site row opens that site's
 * own dashboard; the project group header stays non-navigational, since a
 * project isn't a site with a dashboard to open.
 *
 * Sortable, resizable columns — the same behaviour as the Assets tab's own
 * TreeTable (see COLUMNS/toggleSort/useDragResize there), adapted to this
 * table's shape. Sorting applies WITHIN each project group rather than
 * flattening across all of them: a group is "this project's sites," and
 * reordering site A above site B should never make it look like it moved to
 * a different project.
 *
 * `variant` controls how many columns render. The sidebar (566px, "compact")
 * gets the five columns it always has; the Table tab ("full") adds the
 * columns modelled on the Figma "Monitored areas" table (node 2993:47329) —
 * but only the ones this dataset actually backs. That mockup's own "Saplings"
 * and "Hive capacity" columns, and its per-site "Control"/"Seeding" type, have
 * no equivalent here (no age-class or apiary data, and every site sits on the
 * one contract-wide tier — see TierTag) and are not ported; a fabricated
 * number is worse than a missing column.
 */

type SortableKey = "hectares" | "activity" | "health" | "tier" | "trees" | "insights" | "ndvi" | "since";

export interface SiteRowData {
  id: string;
  name: string;
  projectName: string;
  hectares: number;
  lastActivityLabel: string;
  lastActivityTime: number;
  healthScore: number;
  trendPct: number;
  /** Total tree count as of the latest month, and its change since the prior
   * period — the table's analogue of the Figma reference's "Estimated trees"
   * column, minus that column's min–max bracket (this dataset has one count,
   * not a confidence range around it). */
  totalTrees: number;
  totalTreesChange: number | null;
  /** Trees NOT in an unflagged condition as of the latest month
   * (total − healthy) — what "Insights" stands for here: findings waiting on
   * a decision, not a separate metric this dataset doesn't track. */
  flaggedTrees: number;
  /** Real per-condition breakdown behind `totalTrees`, for the same small
   * segmented bar the reference table draws under its own tree count. */
  healthData: CategoryDatum[];
  /** Blended-signal NDVI (see aggregate.ts's ndviFor) over the full range. */
  avgNdvi: number;
  /** The first month this area has a snapshot for — as close as this dataset
   * gets to the reference's "Dates active" column. */
  monitoredSinceLabel: string;
  monitoredSinceTime: number;
}

/**
 * Every monitored area as a table row.
 *
 * Real numbers rather than the design's repeated "4,214 ha / +2%" placeholder:
 * the size is measured off the plot footprint actually drawn on the map
 * (areaHectares), and the trend is that area's own latest month-on-month
 * canopy-cover change — not the whole-series change, which over a full
 * recovery year reads as a meaningless "+264%".
 *
 * Computed once at module load rather than per-render: `areas` is a static
 * import, so this can never change while the app is running.
 */
export const AREA_ROWS: SiteRowData[] = areas.map((area) => {
  const last = area.snapshots[area.snapshots.length - 1];
  const first = area.snapshots[0] ?? last;
  const prev = area.snapshots[area.snapshots.length - 2] ?? last;
  const trendPct = prev.canopyCoverPct
    ? Math.round(((last.canopyCoverPct - prev.canopyCoverPct) / prev.canopyCoverPct) * 100)
    : 0;
  // One aggregate over the area's full range feeds every derived column below
  // — the table's health chip, tree count and NDVI can never disagree with
  // what the dashboard reports one click later, because it's the same call.
  const agg = aggregateRange(area.snapshots, { startIndex: 0, endIndex: area.snapshots.length - 1 });
  return {
    id: area.id,
    name: area.name,
    projectName: area.projectName,
    hectares: areaHectares(area.id),
    // The snapshot's own label ("Sep '26"), not a separately formatted Date —
    // one fewer place this could read differently from every other month label
    // this app already shows.
    lastActivityLabel: last.label,
    // The label's own Date, kept alongside it so the Activity column can sort
    // chronologically — "Sep '26" vs "Oct '25" as strings is alphabetical
    // nonsense, the same trap TreeTable's own columns avoid by sorting on a raw
    // value instead of the rendered text.
    lastActivityTime: last.date.getTime(),
    healthScore: agg.ecosystemCondition.score,
    trendPct,
    totalTrees: agg.totalTrees.value,
    totalTreesChange: agg.totalTrees.change,
    flaggedTrees: Math.max(0, agg.totalTrees.value - agg.healthyTrees.value),
    healthData: agg.healthData,
    avgNdvi: agg.ndvi.value,
    monitoredSinceLabel: first.label,
    monitoredSinceTime: first.date.getTime(),
  };
});

interface SiteColumn {
  key: "name" | SortableKey;
  label: string;
  /** Absent for "name" — it's the grid's one flexible `1fr` column rather than
   * a fixed pixel width, so the table never needs its own horizontal scroll
   * inside what's already a sidebar overlay. */
  defaultWidth?: number;
  minWidth?: number;
  sortValue: (row: SiteRowData) => number | string;
  defaultDir: SortDir;
  /** Hidden in the sidebar's "compact" variant — see the file header. */
  fullOnly?: boolean;
}

const SITE_COLUMNS: SiteColumn[] = [
  { key: "name", label: "Project & site", sortValue: (r) => r.name, defaultDir: "asc" },
  { key: "hectares", label: "Ha", defaultWidth: 32, minWidth: 30, sortValue: (r) => r.hectares, defaultDir: "desc" },
  {
    key: "trees",
    label: "Estimated trees",
    defaultWidth: 112,
    minWidth: 96,
    sortValue: (r) => r.totalTrees,
    defaultDir: "desc",
    fullOnly: true,
  },
  {
    key: "insights",
    label: "Insights",
    defaultWidth: 64,
    minWidth: 56,
    sortValue: (r) => r.flaggedTrees,
    defaultDir: "desc",
    fullOnly: true,
  },
  {
    key: "health",
    label: "Health indicators",
    // 196 is the floor for the two chips side by side; below it they wrap and
    // every row in the table doubles in height. Measured, not guessed — 182
    // looked like it should fit and did not.
    defaultWidth: 196,
    minWidth: 190,
    // The column shows two chips (health score, canopy trend); health score is
    // the more load-bearing of the two, so it's what a click on this header
    // sorts by.
    sortValue: (r) => r.healthScore,
    defaultDir: "desc",
  },
  {
    key: "ndvi",
    label: "Avg NDVI",
    defaultWidth: 68,
    minWidth: 56,
    sortValue: (r) => r.avgNdvi,
    defaultDir: "desc",
    fullOnly: true,
  },
  {
    key: "activity",
    label: "Activity",
    defaultWidth: 68,
    minWidth: 56,
    sortValue: (r) => r.lastActivityTime,
    defaultDir: "desc",
  },
  {
    key: "since",
    label: "Dates active",
    defaultWidth: 84,
    minWidth: 72,
    sortValue: (r) => r.monitoredSinceTime,
    defaultDir: "asc",
    fullOnly: true,
  },
  {
    key: "tier",
    label: "Tier",
    defaultWidth: 56,
    minWidth: 48,
    // Every row currently shares the same tier (see TierTag) — this sorts
    // without error, it just can't reorder anything yet.
    sortValue: () => 0,
    defaultDir: "asc",
  },
];

const RESIZABLE_COLUMNS = SITE_COLUMNS.filter((c): c is SiteColumn & { defaultWidth: number; minWidth: number } =>
  Boolean(c.defaultWidth),
);

const KEYBOARD_RESIZE_STEP = 16;

/** Floor for the name column. Fits the longest site name in the fixture data
 * ("Sir Bani Yas Island") on two lines beside its pin, which is the point:
 * the name is the row's identifier and the only cell that cannot be re-read
 * from anywhere else on the screen. */
const NAME_MIN_WIDTH = 114;

/** Small hand-drawn glyphs for the header row — this app's own convention for
 * tiny functional UI icons (see TreeTable's SortArrow, LayerPanel's settings
 * gear) rather than imported illustrative assets, since these aren't content
 * being ported from the design but generic table chrome. */
const headerIconStroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The same decorative per-column glyph the plain header used before this
 * became sortable — kept as a lookup so each column still gets its icon
 * without a chain of if/else in the render below. */
const COLUMN_ICON: Record<SiteColumn["key"], ReactElement> = {
  name: (
    <svg width="11" height="11" viewBox="0 0 12 12" {...headerIconStroke}>
      <path d="M1.5 3h9M1.5 6h6M1.5 9h3" />
    </svg>
  ),
  hectares: <></>,
  trees: (
    <svg width="11" height="11" viewBox="0 0 12 12" {...headerIconStroke}>
      <path d="M6 10.5V7.2M6 1.5 2.8 6.2h6.4Z" />
    </svg>
  ),
  insights: (
    <svg width="11" height="11" viewBox="0 0 12 12" {...headerIconStroke}>
      <path d="M6 1v1.6M6 9.4V11M2.6 6H1M11 6H9.4M3.4 3.4 2.2 2.2M9.8 9.8l-1.2-1.2M3.4 8.6 2.2 9.8M9.8 2.2 8.6 3.4" />
      <circle cx="6" cy="6" r="1.8" />
    </svg>
  ),
  activity: (
    <svg width="11" height="11" viewBox="0 0 12 12" {...headerIconStroke}>
      <rect x="1.5" y="2.5" width="9" height="8" rx="1.2" />
      <path d="M1.5 5h9M4 1.2v2M8 1.2v2" />
    </svg>
  ),
  health: (
    <svg width="11" height="11" viewBox="0 0 12 12" {...headerIconStroke}>
      <circle cx="6" cy="6" r="1.6" />
      <path d="M6 1v1.4M6 9.6V11M11 6H9.6M2.4 6H1M9.24 2.76l-1 1M3.76 8.24l-1 1M9.24 9.24l-1-1M3.76 3.76l-1-1" />
    </svg>
  ),
  ndvi: (
    <svg width="11" height="11" viewBox="0 0 12 12" {...headerIconStroke}>
      <path d="M6 10.5c2.8-1 4-3 4-6.5-3.5 0-5.5 1.2-6.5 4C2.2 6.6 3.6 8 6 10.5Z" />
    </svg>
  ),
  since: (
    <svg width="11" height="11" viewBox="0 0 12 12" {...headerIconStroke}>
      <rect x="1.5" y="2.5" width="9" height="8" rx="1.2" />
      <path d="M1.5 5h9M4 1.2v2M8 1.2v2M4 7.2h1.4" />
    </svg>
  ),
  tier: <></>,
};

/** Sortable, resizable header row — the same interaction as TreeTable's own
 * COLUMNS header (click to sort, drag the trailing grip to resize, double-
 * click a grip to reset, arrow keys to nudge it) rebuilt over this table's
 * CSS-grid layout instead of a `<table>`'s `<colgroup>`. */
function AreaTableHeader({
  columns,
  sort,
  onToggleSort,
  widths,
  resizingKey,
  onResizeBegin,
  onResizeReset,
  onResizeKey,
  columnsTemplate,
}: {
  /** The variant-filtered column list — see AreaTable's `visibleColumns`. */
  columns: SiteColumn[];
  sort: { key: string; dir: SortDir };
  onToggleSort: (column: SiteColumn) => void;
  widths: Record<string, number>;
  resizingKey: string | null;
  onResizeBegin: (column: SiteColumn & { defaultWidth: number; minWidth: number }, e: React.PointerEvent) => void;
  onResizeReset: (column: SiteColumn & { defaultWidth: number; minWidth: number }) => void;
  onResizeKey: (column: SiteColumn & { defaultWidth: number; minWidth: number }, e: React.KeyboardEvent) => void;
  columnsTemplate: string;
}) {
  return (
    <div
      className="grid items-center gap-[12px] px-[14px] py-[12px] border-b border-[#dedee3]"
      style={{ gridTemplateColumns: columnsTemplate }}
    >
      {columns.map((column) => {
        const active = sort.key === column.key;
        const resizable = Boolean(column.defaultWidth);
        return (
          <div key={column.key} className={`relative ${column.key === "name" ? "" : "justify-self-end"}`}>
            <button
              type="button"
              onClick={() => onToggleSort(column)}
              className={`group flex items-center gap-[5px] text-[11px] font-semibold font-['Outfit',sans-serif] uppercase tracking-wide cursor-pointer transition-colors duration-100 hover:text-[#18181c] ${
                active ? "text-[#096151]" : "text-[#464650]"
              } ${column.key === "name" ? "" : "flex-row-reverse"}`}
            >
              {column.key === "name" && COLUMN_ICON[column.key]}
              <span className="truncate">{column.label}</span>
              {column.key !== "name" && COLUMN_ICON[column.key]}
              <SortArrow dir={active ? sort.dir : column.defaultDir} active={active} />
            </button>
            {resizable && (
              <button
                type="button"
                aria-label={`Resize ${column.label} column`}
                onPointerDown={(e) => onResizeBegin(column as (typeof RESIZABLE_COLUMNS)[number], e)}
                onDoubleClick={() => onResizeReset(column as (typeof RESIZABLE_COLUMNS)[number])}
                onKeyDown={(e) => onResizeKey(column as (typeof RESIZABLE_COLUMNS)[number], e)}
                className={`col-grip ${resizingKey === column.key ? "col-grip--active" : ""}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Which service tier serves this site's data — see data/tiers.ts. There is
 * no per-site tier in this dataset (a site inherits whatever tier the whole
 * contract is on), so every row shows the same TIERS[CURRENT_TIER_INDEX]
 * badge rather than a fabricated per-site value; the day a site can sit on
 * its own tier, this becomes a per-row prop instead of a shared constant. */
function TierTag() {
  return (
    <span
      className="shrink-0 px-[7px] py-[2px] rounded-full border border-[#dedee3] bg-white text-[#5b5b66] text-[10px] font-medium font-['Outfit',sans-serif] whitespace-nowrap"
      title={`Served on ${TIERS[CURRENT_TIER_INDEX].label} — ${TIERS[CURRENT_TIER_INDEX].name}`}
    >
      {TIERS[CURRENT_TIER_INDEX].label}
    </span>
  );
}

/** One "97% ↗ Health score"-style stat card — the Figma reference's health
 * indicator chip, backed here only by numbers this app actually computes
 * (no invented "Survival rate"/"Seedling density" — this dataset doesn't
 * track those). Colour follows the same sign convention as the dashboard's
 * own trend chips: green climbing, amber falling.
 *
 * Deliberately NOT `u-press` or `cursor-pointer`: those signal something
 * clickable, and this chip has no action of its own — the row it sits in owns
 * the click. */
function HealthIndicatorChip({ label, value, deltaPct }: { label: string; value: string; deltaPct: number }) {
  const rising = deltaPct >= 0;
  return (
    <div className="shrink-0 flex flex-col gap-[2px] px-[10px] py-[8px] rounded-[16px] border border-[#e2e4d9] bg-[#f2f4ec]">
      <span className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[16px] tabular-nums">
        {value}
      </span>
      <span
        className="flex items-center gap-[3px] text-[10px] font-['Outfit',sans-serif] leading-[14px] whitespace-nowrap"
        style={{ color: rising ? "#0f7a44" : "#c05a17" }}
      >
        <img src={imgIcTrendingUp} alt="" className={`w-[9px] h-[9px] ${rising ? "" : "-scale-y-100"}`} />
        {label}
      </span>
    </div>
  );
}

/** The project row: a collapsible group heading, not a data row of its own —
 * matches the reference table's bold "chevron + project name" rows, which
 * carry no per-column values because a project is the group, not a site. */
function ProjectGroupHeader({
  name,
  collapsed,
  onToggle,
  delay,
}: {
  name: string;
  collapsed: boolean;
  onToggle: () => void;
  delay: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="u-press w-full flex items-center gap-[10px] px-[14px] py-[12px] text-left cursor-pointer hover:bg-[#fbfbfa] animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className={`shrink-0 text-[#5b5b66] transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
        {...headerIconStroke}
      >
        <path d="M2 3.5 5 6.5 8 3.5" />
      </svg>
      <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[22px] truncate">
        {name}
      </span>
    </button>
  );
}

/** Thin proportional bar of the real per-condition breakdown behind the tree
 * count — this table's echo of the reference's segmented "estimated trees"
 * bar, built from actual counts (`SiteRowData.healthData`) rather than a
 * decorative gradient. A zero-value condition contributes no segment at all,
 * same reasoning as the estate donut in the Story tab's own metrics blocks. */
function HealthDistributionBar({ data }: { data: CategoryDatum[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  return (
    <span className="flex h-[4px] w-full rounded-full overflow-hidden bg-[#ebece7]">
      {data.map((d) =>
        d.value > 0 ? <span key={d.name} style={{ width: `${(d.value / total) * 100}%`, background: d.color }} /> : null,
      )}
    </span>
  );
}

/** "Estimated trees" cell: the latest count, its change since the prior
 * period, and the real health-condition split beneath it — no min–max
 * bracket, since this dataset has one count per month, not a confidence
 * range around it (see the file header). */
function TreeCountCell({
  total,
  change,
  healthData,
}: {
  total: number;
  change: number | null;
  healthData: CategoryDatum[];
}) {
  return (
    <span className="flex flex-col items-end gap-[4px] w-full">
      <span className="flex items-baseline gap-[5px]">
        <span className="text-[13px] font-semibold text-[#18181c] font-['Outfit',sans-serif] leading-[18px] tabular-nums">
          {total.toLocaleString()}
        </span>
        {change !== null && change !== 0 && (
          <span
            className="text-[10px] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap"
            style={{ color: change > 0 ? "#0f7a44" : "#c05a17" }}
          >
            {change > 0 ? "+" : ""}
            {change.toLocaleString()}
          </span>
        )}
      </span>
      <HealthDistributionBar data={healthData} />
    </span>
  );
}

/** One monitored site under its project group — the actual data row, indented
 * slightly under the group heading above it. Renders one cell per column in
 * `columns`, the same variant-filtered list the header uses, so the two can
 * never drift out of alignment. */
function SiteRow({
  site,
  columns,
  delay,
  onClick,
  columnsTemplate,
}: {
  site: SiteRowData;
  columns: SiteColumn[];
  delay: number;
  /** Opens this site's own dashboard. */
  onClick: () => void;
  /** The header's live column widths, so a resized column and its rows never
   * fall out of alignment mid-drag. */
  columnsTemplate: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="u-press w-full grid items-center gap-[12px] px-[14px] py-[14px] text-left cursor-pointer hover:bg-[#fbfbfa] animate-fade-in-up"
      style={{ gridTemplateColumns: columnsTemplate, animationDelay: `${delay}ms` }}
    >
      {columns.map((column) => {
        switch (column.key) {
          case "name":
            return (
              // Indent aligns the row under its project header's name rather
              // than its chevron -- 8px of nesting instead of the 20px that
              // used to eat a fifth of this column. The decorative pin that
              // used to sit here is gone: it carried no information (alt=""),
              // repeated identically down every row, and cost 28px of the one
              // column that had none to spare.
              <span key={column.key} className="flex items-center min-w-0 pl-[6px]">
                {/* Two lines rather than an ellipsis: a truncated site name is
                    not a shorter label, it is a different one. */}
                <span className="text-[14px] text-[#464650] font-['Outfit',sans-serif] leading-[19px] line-clamp-2">
                  {site.name}
                </span>
              </span>
            );
          case "hectares":
            return (
              <span
                key={column.key}
                className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px] text-right tabular-nums"
              >
                {site.hectares.toLocaleString()}
              </span>
            );
          case "trees":
            return (
              <span key={column.key} className="flex justify-end">
                <TreeCountCell total={site.totalTrees} change={site.totalTreesChange} healthData={site.healthData} />
              </span>
            );
          case "insights":
            return (
              <span
                key={column.key}
                className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px] text-right tabular-nums"
              >
                {site.flaggedTrees > 0 ? site.flaggedTrees.toLocaleString() : "—"}
              </span>
            );
          case "health":
            return (
              <span key={column.key} className="flex items-center justify-end gap-[6px] flex-wrap">
                <HealthIndicatorChip
                  label="Health score"
                  value={`${Math.round(site.healthScore)}%`}
                  deltaPct={site.healthScore - 75}
                />
                <HealthIndicatorChip
                  label="Canopy cover"
                  value={`${site.trendPct > 0 ? "+" : ""}${site.trendPct}%`}
                  deltaPct={site.trendPct}
                />
              </span>
            );
          case "ndvi":
            return (
              <span
                key={column.key}
                className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px] text-right tabular-nums"
              >
                {site.avgNdvi.toFixed(2)}
              </span>
            );
          case "activity":
            return (
              <span
                key={column.key}
                className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px] text-right whitespace-nowrap"
              >
                {site.lastActivityLabel}
              </span>
            );
          case "since":
            return (
              <span
                key={column.key}
                className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px] text-right whitespace-nowrap"
              >
                {site.monitoredSinceLabel}
              </span>
            );
          case "tier":
            return (
              <span key={column.key} className="flex justify-end">
                <TierTag />
              </span>
            );
          default:
            return null;
        }
      })}
    </button>
  );
}

export default function AreaTable({
  rows,
  onSelectSite,
  variant = "compact",
}: {
  rows: SiteRowData[];
  /** Opens that site's own dashboard. */
  onSelectSite: (areaId: string) => void;
  /** "compact" (default) is the sidebar's five columns; "full" adds the
   * dataset-backed columns modelled on the Figma reference — see the file
   * header. */
  variant?: "compact" | "full";
}) {
  // Same shape as TreeTable's own `sort`/`widths`/`resizingKey`, so the two
  // tables behave identically. Held per mount rather than lifted: the sidebar
  // and the Table tab are different contexts, and a column resized in one has
  // no business resizing the other.
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "name", dir: "asc" });
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(RESIZABLE_COLUMNS.map((c) => [c.key, c.defaultWidth])),
  );
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());

  const visibleColumns = useMemo(
    () => SITE_COLUMNS.filter((c) => variant === "full" || !c.fullOnly),
    [variant],
  );
  const visibleResizable = useMemo(
    () => visibleColumns.filter((c): c is SiteColumn & { defaultWidth: number; minWidth: number } => Boolean(c.defaultWidth)),
    [visibleColumns],
  );

  const toggleSort = useCallback((column: SiteColumn) => {
    setSort((prev) =>
      prev.key === column.key
        ? { key: column.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: column.key, dir: column.defaultDir },
    );
  }, []);

  const applyWidth = useCallback((key: string, next: number) => {
    setWidths((prev) => ({ ...prev, [key]: next }));
  }, []);

  const toggleProject = useCallback((projectName: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) next.delete(projectName);
      else next.add(projectName);
      return next;
    });
  }, []);

  // Which column the active grip belongs to — a ref, since the drag handler
  // needs to read it synchronously on every pointer move, same reasoning as
  // TreeTable's own resizeColRef.
  const resizeColRef = useRef<(SiteColumn & { defaultWidth: number; minWidth: number }) | null>(null);
  const resize = useDragResize({
    min: 0,
    max: 320,
    onChange: (next) => {
      const column = resizeColRef.current;
      if (column) applyWidth(column.key, Math.max(column.minWidth, next));
    },
    onEnd: () => {
      resizeColRef.current = null;
      setResizingKey(null);
    },
  });

  const columnsTemplate = useMemo(
    // `minmax(0,1fr)` here let the name track collapse to whatever the fixed
    // columns left over -- 94px on a 1280px window, which rendered every site
    // as "Al ...", "Hat...", "Sir ...". A grid track with a zero minimum is
    // not a flexible column, it is a column with no floor.
    () => [`minmax(${NAME_MIN_WIDTH}px,1fr)`, ...visibleResizable.map((c) => `${widths[c.key]}px`)].join(" "),
    [widths, visibleResizable],
  );

  // Grouped by project — each area already names the project it belongs to
  // (area.projectName), so a group here can never list a site under the wrong
  // project. Today that's a 1:1 project:site mapping; the grouping exists so a
  // project spanning several monitored sites drops straight in without a
  // structural change. Sorting applies within each group: it reorders a
  // project's own sites, never moves a site to a different one.
  const projectGroups = useMemo(() => {
    const byProject = new Map<string, SiteRowData[]>();
    for (const row of rows) {
      const group = byProject.get(row.projectName);
      if (group) group.push(row);
      else byProject.set(row.projectName, [row]);
    }
    const column = SITE_COLUMNS.find((c) => c.key === sort.key);
    const dir = sort.dir === "asc" ? 1 : -1;
    return Array.from(byProject, ([projectName, sites]) => ({
      projectName,
      sites: column
        ? [...sites].sort((a, b) => {
            const av = column.sortValue(a);
            const bv = column.sortValue(b);
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
            return String(av).localeCompare(String(bv)) * dir;
          })
        : sites,
    }));
  }, [rows, sort]);

  return (
    <div className="bg-white rounded-[12px] overflow-hidden divide-y divide-[#dedee3]">
      <AreaTableHeader
        columns={visibleColumns}
        sort={sort}
        onToggleSort={toggleSort}
        widths={widths}
        resizingKey={resizingKey}
        onResizeBegin={(column, e) => {
          resizeColRef.current = column;
          setResizingKey(column.key);
          resize.begin(e, widths[column.key]);
        }}
        onResizeReset={(column) => applyWidth(column.key, column.defaultWidth)}
        onResizeKey={(column, e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const delta = e.key === "ArrowRight" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
          applyWidth(column.key, Math.max(column.minWidth, widths[column.key] + delta));
        }}
        columnsTemplate={columnsTemplate}
      />
      {projectGroups.length === 0 ? (
        <p className="px-[14px] py-[24px] text-[12px] text-[#71717a] font-['Outfit',sans-serif] text-center">
          No sites match this search.
        </p>
      ) : (
        projectGroups.map((group, groupIndex) => {
          const collapsed = collapsedProjects.has(group.projectName);
          return (
            <div key={group.projectName} className="divide-y divide-[#dedee3]">
              <ProjectGroupHeader
                name={group.projectName}
                collapsed={collapsed}
                onToggle={() => toggleProject(group.projectName)}
                delay={160 + groupIndex * 60}
              />
              {!collapsed &&
                group.sites.map((site, siteIndex) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    columns={visibleColumns}
                    delay={160 + groupIndex * 60 + (siteIndex + 1) * 40}
                    onClick={() => onSelectSite(site.id)}
                    columnsTemplate={columnsTemplate}
                  />
                ))}
            </div>
          );
        })
      )}
    </div>
  );
}
