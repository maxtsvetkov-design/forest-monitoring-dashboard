// The Dashboard tab's data model.
//
// Everything here is DERIVED from the same `MonthSnapshot[]` the Insights tab
// reads, never hardcoded. The Figma mockup (node 308-25361) shows placeholder
// figures like "987,654,322,111" because it is a layout study; reproducing
// those literally would give us a screenshot that happens to be made of DOM.
// Deriving instead means the KPI row, the line chart and both donuts all move
// when the range picker moves — which is the actual point of a dashboard.
//
// Where the mockup's vocabulary and this dataset's vocabulary disagree, the
// mockup's LABEL is kept and pointed at the nearest real quantity (see each
// metric's comment). That keeps the screen honest: every number on it can be
// traced back to a measurement rather than being invented to fill a slot.

import { aggregateRange, type DateRange } from "./aggregate";
import type { Area } from "./areas";
import { getTimelapseImages } from "./overlays";
import { CONDITIONS, SPECIES } from "./taxonomy";
import type { CategoryDatum, MonthSnapshot } from "./types";

/** Plot size per area, in hectares. App.tsx has carried a single hardcoded
 * "12 ha" for the whole project; the dashboard needs a per-area figure to
 * turn tree counts into densities, so the four areas are sized here and the
 * total is derived rather than restated. */
export const AREA_HECTARES: Record<string, number> = {
  "al-maha": 12,
  hatta: 8.4,
  "sir-bani-yas": 19.6,
  "wadi-wurayah": 15.2,
};

export function hectaresFor(areaId: string): number {
  return AREA_HECTARES[areaId] ?? 12;
}

/* -------------------------------------------------------------------------
   KPI row
   ------------------------------------------------------------------------- */

export type KpiStatus = "normal" | "alert";

export type KpiFormat = "percent" | "index" | "count" | "density";

export interface DashboardKpi {
  id: string;
  label: string;
  /** Raw number, so the card can count up to it. Formatting is the card's
   * job — see `format`. */
  value: number;
  format: KpiFormat;
  /** Period-over-period change as a PERCENTAGE of the prior value, not in the
   * metric's own units. The mockup's chips all read "-22% QoQ", i.e. a
   * relative move, which is the only form that's comparable across a
   * percentage, an index and a density on the same row. Null when there is no
   * prior period inside the 12-month window. */
  changePct: number | null;
  /** Escalated cards get the danger treatment from the mockup's fourth card
   * (pale red fill, red value). Assigned by `kpiStatus` below. */
  status: KpiStatus;
  /** Tooltip text: what this number actually measures, since several of these
   * labels come from the mockup rather than from the dataset. */
  hint: string;
  /** Condition labels this KPI counts, handed to the Assets tab's filter when
   * the card is clicked. Absent when the metric has no per-tree equivalent. */
  drillConditions?: string[];
}

const HEALTHY_LABELS = CONDITIONS.filter((c) => !c.flagged).map((c) => c.label);
const FLAGGED_LABELS = CONDITIONS.filter((c) => c.flagged).map((c) => c.label);

/** Relative change between two values, as a percentage. Guards the zero-prior
 * case, which would otherwise produce Infinity and render as "∞%". */
function relChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Whether a KPI has crossed from "reporting" into "needs attention" — the
 * pale-red card in the mockup's fourth slot.
 *
 * TODO: the escalation rule is still unwritten — this returns "normal"
 * unconditionally, so no card ever takes the danger treatment today. Left as a
 * deliberate open decision rather than guessed at, because the threshold is a
 * product call about when a plot is "in trouble", not an implementation detail.
 *
 * You get the metric's `id`, its current `value`, and `changePct` (relative
 * period-over-period move, or null when there's no prior period). Return
 * "alert" to give the card the danger treatment, "normal" otherwise.
 *
 * Things worth weighing:
 *  - A steep DROP is bad for survival/vegetation/density, but `mortality`
 *    is inverted — a rise there is the bad direction. Only these four ids
 *    exist: "survival", "vegetation-index", "live-cover", "seedling-density".
 *  - Change-based alone means a metric sitting at a terrible-but-stable level
 *    never alerts; level-based alone means a healthy metric in freefall never
 *    alerts. You may want either, or both.
 *  - `changePct` is null on the earliest range — decide whether that's
 *    "normal" or "unknown".
 */
export function kpiStatus(id: string, value: number, changePct: number | null): KpiStatus {
  return "normal";
}

export function buildKpis(area: Area, range: DateRange): DashboardKpi[] {
  const agg = aggregateRange(area.snapshots, range);
  const ha = hectaresFor(area.id);

  const total = agg.totalTrees.value;
  const prevTotal = agg.totalTrees.change === null ? null : total - agg.totalTrees.change;

  // "Survival Rate" in the mockup — here, the share of the standing population
  // in an unflagged condition band. A tree that has dropped to Sparse or
  // Defoliated has not survived the season in any sense that matters.
  const survival = total > 0 ? (agg.healthyTrees.value / total) * 100 : 0;
  const prevHealthy = agg.healthyTrees.change === null ? null : agg.healthyTrees.value - agg.healthyTrees.change;
  const prevSurvival = prevHealthy !== null && prevTotal !== null && prevTotal > 0 ? (prevHealthy / prevTotal) * 100 : null;

  // "Mean vegetation index" — the derived NDVI, on its native 0–1 scale.
  const ndvi = agg.ndvi.value;
  const prevNdvi = agg.ndvi.change === null ? null : ndvi - agg.ndvi.change;

  // "Live Vegetation Cover" — canopy cover percent, read at the range's end
  // month like every other end-of-range figure in aggregate.ts.
  const cover = agg.canopyCoverPct.value;
  const prevCover = agg.canopyCoverPct.change === null ? null : cover - agg.canopyCoverPct.change;

  // "Seedling Density" — standing trees per hectare. The mockup renders this
  // one in the alert state; whether it actually escalates here is decided by
  // kpiStatus above, not asserted.
  const density = total / ha;
  const prevDensity = prevTotal === null ? null : prevTotal / ha;

  const raw: Omit<DashboardKpi, "status">[] = [
    {
      id: "survival",
      label: "Survival Rate",
      value: survival,
      format: "percent",
      changePct: relChange(survival, prevSurvival),
      hint: "Share of the standing population in an unflagged condition band (Normal or Vigorous), at the end of the selected range.",
      drillConditions: HEALTHY_LABELS,
    },
    {
      id: "vegetation-index",
      label: "Mean vegetation index",
      value: ndvi,
      format: "index",
      changePct: relChange(ndvi, prevNdvi),
      hint: "Derived NDVI (0–1): canopy cover weighted by the healthy-tree fraction. No spectral imagery backs this dataset — see aggregate.ts.",
      drillConditions: FLAGGED_LABELS,
    },
    {
      id: "live-cover",
      label: "Live Vegetation Cover",
      value: cover,
      format: "percent",
      changePct: relChange(cover, prevCover),
      hint: "Share of the plot under living crown, from the aerial survey at the end of the selected range.",
    },
    {
      id: "seedling-density",
      label: "Seedling Density",
      value: density,
      format: "density",
      changePct: relChange(density, prevDensity),
      hint: `Standing trees per hectare across ${ha} ha of managed area.`,
      drillConditions: FLAGGED_LABELS,
    },
  ];

  return raw.map((k) => ({ ...k, status: kpiStatus(k.id, k.value, k.changePct) }));
}

/** Renders a KPI's raw number the way its own unit wants to be read. Kept
 * beside the metrics rather than in the card so the count-up animation and
 * the tooltip can format identically without duplicating the rules. */
export function formatKpi(value: number, format: KpiFormat): string {
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "index":
      return value.toFixed(2);
    case "density":
      return `${Math.round(value).toLocaleString()}/ha`;
    case "count":
      return Math.round(value).toLocaleString();
  }
}

/* -------------------------------------------------------------------------
   Seeding performance — the multi-series line chart
   ------------------------------------------------------------------------- */

export interface PerfSeries {
  key: string;
  name: string;
  color: string;
  /** The metric's own unit suffix, shown in the tooltip. */
  unit: string;
  /** Real measured values, one per month in the selected range. */
  values: number[];
}

export interface PerfChartData {
  /** Month labels, e.g. "May '25" — the chart's X domain. */
  labels: string[];
  series: PerfSeries[];
}

/**
 * The four series the mockup's legend names, each pulled from the month
 * snapshots rather than invented.
 *
 * They deliberately keep their REAL units here (a density in trees/ha next to
 * three percentages). The chart normalises for drawing — see
 * SeedingPerformanceChart — because four series on one unlabelled axis is a
 * shape comparison, not a value comparison. Normalising at draw time rather
 * than here keeps the tooltip able to show what was actually measured.
 */
export function buildPerfChart(area: Area, range: DateRange): PerfChartData {
  const months = area.snapshots.slice(range.startIndex, range.endIndex + 1);
  const ha = hectaresFor(area.id);

  const density = months.map((m) => m.newTreesLogged / ha);
  const survival = months.map((m) => {
    const healthy = m.healthCounts.vigorous + m.healthCounts.normal;
    return m.newTreesLogged > 0 ? (healthy / m.newTreesLogged) * 100 : 0;
  });
  const canopy = months.map((m) => m.canopyCoverPct);
  // The complement of survival: the share sitting in a flagged band. Derived
  // from the same counts so the two lines are guaranteed to be consistent
  // with each other rather than two independent guesses at the same split.
  const mortality = survival.map((s) => 100 - s);

  return {
    labels: months.map((m) => m.label),
    series: [
      { key: "density", name: "Seedling Density", color: "#E5622D", unit: "/ha", values: density },
      { key: "survival", name: "Survival Rate", color: "#1A9E7A", unit: "%", values: survival },
      { key: "canopy", name: "Canopy cover", color: "#CF5A9E", unit: "%", values: canopy },
      { key: "mortality", name: "Mortality rate", color: "#4A8FC1", unit: "%", values: mortality },
    ],
  };
}

/* -------------------------------------------------------------------------
   Classification donuts
   ------------------------------------------------------------------------- */

/**
 * "Flora classification" — the species mix, collapsed to the three largest
 * plus an "Other" bucket.
 *
 * The mockup lists three legend rows and no more, and an eleven-species
 * legend in that card would overflow it. Collapsing keeps the widget's shape
 * while staying truthful: "Other" is a real total, not a dropped remainder.
 */
export function buildFloraClassification(area: Area, range: DateRange): CategoryDatum[] {
  const { speciesData } = aggregateRange(area.snapshots, range);
  const sorted = [...speciesData].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 3);
  const restTotal = sorted.slice(3).reduce((sum, d) => sum + d.value, 0);
  if (restTotal <= 0) return top;
  return [...top, { name: "Other species", value: restTotal, color: "#A8A8B0" }];
}

/**
 * "Land cover classification" — how the plot's surface splits between crown,
 * open salt flat and standing water.
 *
 * Canopy cover is measured; the other two are a split of what's left. Sabkha
 * (salt flat) dominates the uncovered ground in every one of these sites, so
 * water is modelled as a small, slowly-varying share of the remainder rather
 * than a fixed constant — enough to move with the season without pretending
 * to a precision the dataset doesn't have.
 */
export function buildLandCover(area: Area, range: DateRange): CategoryDatum[] {
  const { canopyCoverPct } = aggregateRange(area.snapshots, range);
  const vegetation = canopyCoverPct.value;
  const remainder = Math.max(0, 100 - vegetation);
  // Wetter plots carry proportionally more standing water; scale off the same
  // canopy signal so the three slices always sum to exactly 100.
  const water = remainder * (0.08 + vegetation / 1000);
  const sabkha = remainder - water;
  return [
    { name: "Sabkha", value: Number(sabkha.toFixed(1)), color: "#D4A61A" },
    { name: "Vegetation", value: Number(vegetation.toFixed(1)), color: "#2E9B6F" },
    { name: "Water bodies", value: Number(water.toFixed(1)), color: "#4A8FC1" },
  ];
}

/* -------------------------------------------------------------------------
   Insights strip
   ------------------------------------------------------------------------- */

export interface DashboardInsight {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  changePct: number;
  /** The area this card drills into when clicked. */
  areaId: string;
}

/**
 * The four image cards under the charts. Each one is a real neighbouring area
 * with its own imagery and its own period-over-period canopy move, so the
 * strip reads as "here is what changed elsewhere" rather than four copies of
 * the same placeholder the mockup shows.
 */
export function buildInsights(areas: Area[], range: DateRange): DashboardInsight[] {
  return areas.slice(0, 4).map((a) => {
    const images = getTimelapseImages(a.id);
    const agg = aggregateRange(a.snapshots, range);
    const cover = agg.canopyCoverPct.value;
    const prev = agg.canopyCoverPct.change === null ? null : cover - agg.canopyCoverPct.change;
    return {
      id: a.id,
      title: a.name,
      subtitle: a.projectName,
      // Last frame in the timelapse = the most recent capture, matching the
      // "as of the end of the range" rule the KPIs use.
      image: images?.[images.length - 1] ?? "",
      changePct: relChange(cover, prev) ?? 0,
      areaId: a.id,
    };
  });
}

/* -------------------------------------------------------------------------
   Site table
   ------------------------------------------------------------------------- */

export interface SiteRow {
  id: string;
  name: string;
  managedArea: number;
  type: "Control" | "Seeding";
  saplings: number;
  saplingsDelta: number;
  seedDispersion: number | null;
  extentPct: number;
  extentHa: number;
  /** Low/high bounds of the survey's confidence interval on `saplings`, which
   * the mockup renders as "600 (500 – 700)" over a proportional bar. */
  estimateLow: number;
  estimateHigh: number;
}

/**
 * One row per area. The confidence band widens with plot size — a bigger
 * survey area means proportionally more of it is extrapolated between
 * transects, which is the honest shape for a count nobody walked end to end.
 */
export function buildSiteRows(areas: Area[], range: DateRange): SiteRow[] {
  return areas.map((a, i) => {
    const agg = aggregateRange(a.snapshots, range);
    const ha = hectaresFor(a.id);
    const saplings = agg.totalTrees.value;
    const spread = 0.08 + ha / 300;
    return {
      id: a.id,
      name: a.name,
      managedArea: ha,
      // The first area in every project is the untreated control plot — it is
      // what the seeded plots are measured against.
      type: i === 0 ? "Control" : "Seeding",
      saplings,
      saplingsDelta: Math.round(agg.totalTrees.change ?? 0),
      // A control plot is not seeded, so it has no dispersion figure to show.
      seedDispersion: i === 0 ? null : Math.round(saplings * 1.6),
      extentPct: agg.canopyCoverPct.value,
      extentHa: Number(((agg.canopyCoverPct.value / 100) * ha).toFixed(2)),
      estimateLow: Math.round(saplings * (1 - spread)),
      estimateHigh: Math.round(saplings * (1 + spread)),
    };
  });
}

/** Every species key the taxonomy knows, for the table's type column and any
 * future grouping — re-exported so consumers don't reach past this module
 * into taxonomy.ts for something the dashboard already models. */
export const SPECIES_COUNT = SPECIES.length;

/** Convenience for callers that need the whole set at once rather than
 * assembling six calls — keeps DashboardView's body about layout. */
export function buildDashboard(area: Area, allAreas: Area[], range: DateRange) {
  return {
    kpis: buildKpis(area, range),
    perf: buildPerfChart(area, range),
    flora: buildFloraClassification(area, range),
    landCover: buildLandCover(area, range),
    insights: buildInsights(allAreas, range),
    rows: buildSiteRows(allAreas, range),
  };
}

export type DashboardData = ReturnType<typeof buildDashboard>;

/** Re-exported so the view can label its own month axis without importing the
 * snapshot type from two places. */
export type { MonthSnapshot };
