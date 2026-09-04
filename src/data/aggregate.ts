import type {
  AggregatedSnapshot,
  CrownBucketDatum,
  EcosystemCondition,
  HealthKey,
  MonthSnapshot,
  ScatterSeries,
} from "./types";
import { scatterCategories, scatterPosition, speciesColor, speciesLabel } from "./scatterLayout";
import { CONDITIONS, SPECIES } from "./taxonomy";

export interface DateRange {
  startIndex: number;
  endIndex: number; // inclusive
}

// Both derived from the taxonomy table rather than restated here, so the
// donut, the map pins and the table legend cannot end up assigning the same
// species or condition two different colours.
const SPECIES_META = SPECIES.map((s) => ({ key: s.key, name: s.common, color: s.color }));

// Shown best-first, the reverse of CONDITIONS' worst-first severity order, so
// the donut reads top-down from Vigorous to Defoliated.
const HEALTH_META = [...CONDITIONS].reverse().map((c) => ({ key: c.key, name: c.label, color: c.color }));

const DIAMETER_META = [
  { key: "L" as const, name: "L (>5 m)", color: "#E07B39" },
  { key: "M" as const, name: "M (2–5 m)", color: "#7C3BBE" },
  { key: "S" as const, name: "S (<1 m)", color: "#3AAD8A" },
];

const HEIGHT_META = [
  { key: "h1" as const, name: "1", color: "#E473C1" },
  { key: "h2" as const, name: "2", color: "#7E5BEF" },
  { key: "h3" as const, name: "3", color: "#5BA4CF" },
];

const CROWN_META = [
  { key: "b1" as const, label: "0 – 0.2", color: "#4A8FC1" },
  { key: "b2" as const, label: "0.2 – 0.4", color: "#D4A61A" },
  { key: "b3" as const, label: "0.4 – 0.6", color: "#CF5A9E" },
  { key: "b4" as const, label: "0.6 – 0.8", color: "#2E9B6F" },
  { key: "b5" as const, label: "0.8 – 1.2", color: "#C8B420" },
];

/**
 * The count for one category as of the LAST month in the range, not summed
 * across it.
 *
 * This changed with the move to a persistent population (treePopulation.ts).
 * When each month invented its own fresh batch of trees, adding twelve months
 * together was the only way to get a plot-sized number. Now the same ~340
 * trees are present in every month, so summing would report twelve times the
 * trees that exist — which is exactly what the old "13,353 total" donut labels
 * were, for a plot with roughly a thousand trees in it.
 *
 * Reading the final month instead makes every total a real inventory: "this is
 * the plot as it stands at the end of the window you selected". Dragging the
 * range end backwards now walks the population back through its own history
 * rather than just adding up fewer copies of it.
 */
function countAtEnd<K extends string>(
  months: MonthSnapshot[],
  field: "speciesCounts" | "healthCounts" | "diameterCounts" | "heightCounts" | "crownCounts",
  key: K,
): number {
  const last = months[months.length - 1];
  return last ? (last[field] as Record<K, number>)[key] : 0;
}

function rangeMonths(all: MonthSnapshot[], range: DateRange): MonthSnapshot[] {
  return all.slice(range.startIndex, range.endIndex + 1);
}

function previousRange(range: DateRange): DateRange | null {
  const length = range.endIndex - range.startIndex + 1;
  const prevEnd = range.startIndex - 1;
  const prevStart = prevEnd - length + 1;
  return prevStart >= 0 ? { startIndex: prevStart, endIndex: prevEnd } : null;
}

/** Standing inventory at the end of the range — see countAtEnd for why this
 * is a read rather than a sum. */
function totalTreesFor(months: MonthSnapshot[]): number {
  return months[months.length - 1]?.newTreesLogged ?? 0;
}

/** Trees in an unflagged condition (Normal or Vigorous) as of the range's
 * last month — same end-of-range read as totalTreesFor, since the population
 * persists and summing months would multiply the count by how many months
 * are selected. */
function healthyTreesFor(months: MonthSnapshot[]): number {
  const last = months[months.length - 1];
  if (!last) return 0;
  return last.healthCounts.vigorous + last.healthCounts.normal;
}

/**
 * Canopy cover as of the range's LAST month, matching countAtEnd rather than
 * averaging across the window.
 *
 * Averaging actively hid the story. Over a range that runs from a degraded
 * October to a dieback in September, the mean sits somewhere in the middle and
 * reports a placid 34% for a plot that climbed to 50% and then fell back to
 * 41% — the two things anyone would want to see, cancelled against each other.
 * Reading the end month makes every KPI on the row describe the same instant
 * ("the plot as it stands at the end of your selection") and leaves the
 * period-over-period delta to carry the direction of travel.
 */
function avgCanopyFor(months: MonthSnapshot[]): number {
  return months[months.length - 1]?.canopyCoverPct ?? 0;
}

// No spectral-band imagery backs this dataset, so NDVI is derived rather than
// measured: canopy cover (how much of the ground is under crown) carries most
// of the signal real NDVI would, with the healthy-tree fraction nudging it —
// stressed canopy reads greener in a photo than it does in reflectance. This
// keeps the value honest to what the mock data actually models instead of
// inventing an independent, disconnected number.
function ndviFor(month: MonthSnapshot): number {
  const c = month.healthCounts;
  const total = CONDITIONS.reduce((sum, cond) => sum + c[cond.key], 0) || 1;
  // The two unflagged bands are the "reads green from above" fraction.
  const greenFrac = (c.vigorous + c.normal) / total;
  const raw = 0.15 + 0.55 * (month.canopyCoverPct / 100) + 0.3 * greenFrac;
  return Math.max(0, Math.min(1, raw));
}

/** End of range — see avgCanopyFor. */
function avgNdviFor(months: MonthSnapshot[]): number {
  const last = months[months.length - 1];
  return last ? ndviFor(last) : 0;
}

// A single 0-100 "how is this plot doing" figure, letting Average health score
// plot one line instead of five separate category counts. A fully defoliated
// canopy scores 0 and a vigorous one 100, with the middle bands spaced evenly
// across the range the five-step scale describes.
const HEALTH_SCORE_WEIGHT: Record<HealthKey, number> = {
  defoliated: 0,
  sparse: 25,
  moderate: 50,
  normal: 78,
  vigorous: 100,
};

function healthScoreFor(month: MonthSnapshot): number {
  const c = month.healthCounts;
  const total = CONDITIONS.reduce((sum, cond) => sum + c[cond.key], 0) || 1;
  const weighted = CONDITIONS.reduce((sum, cond) => sum + c[cond.key] * HEALTH_SCORE_WEIGHT[cond.key], 0);
  return weighted / total;
}

/** End of range — see avgCanopyFor. */
function avgHealthScoreFor(months: MonthSnapshot[]): number {
  const last = months[months.length - 1];
  return last ? healthScoreFor(last) : 0;
}

/**
 * Per-month health score for the WHOLE dataset, independent of the selected
 * range -- "Average health score per month" is inherently a trend across the
 * timeline, the same way the timeline range slider itself shows all 12
 * months regardless of what's selected. Exported standalone rather than
 * folded into AggregatedSnapshot's range-scoped fields.
 */
export function healthScoreSeries(all: MonthSnapshot[]): { label: string; score: number }[] {
  return all.map((m) => ({ label: m.label, score: Math.round(healthScoreFor(m) * 10) / 10 }));
}

const CONDITION_TIERS: { label: string; color: string }[] = [
  { label: "Critical", color: "#E5484D" },
  { label: "Poor", color: "#E55C2F" },
  { label: "Fair", color: "#F0B429" },
  { label: "Good", color: "#8FBF3F" },
  { label: "Excellent", color: "#24A67A" },
];

/** Blends NDVI and health score into one 0-100 ecosystem-condition figure and
 * buckets it into the five tiers above -- NDVI speaks to canopy greenness,
 * health score to tree-by-tree condition, and a site can't be called healthy
 * on just one of the two. */
function ecosystemConditionFor(ndvi: number, healthScore: number, change: number | null = null): EcosystemCondition {
  const score = ndvi * 100 * 0.5 + healthScore * 0.5;
  const tierIndex = Math.min(CONDITION_TIERS.length - 1, Math.floor(score / 20));
  return { score, tierIndex, change, ...CONDITION_TIERS[tierIndex] };
}

/**
 * The highest single (species, category) count across the WHOLE dataset,
 * independent of the selected range — used as a fixed ceiling for the health-
 * per-species bubble chart's size scale (see HealthPerSpeciesChart's zMax
 * prop). Recharts' ZAxis auto-scales bubble size relative to whatever data is
 * currently passed in, so without a fixed reference, a one-month selection
 * and the full 12-month range end up drawing visually similar bubble
 * proportions even though the underlying counts differ by an order of
 * magnitude — the chart LOOKED range-independent even though the numbers
 * behind it weren't. Anchoring every render to this one fixed ceiling is what
 * makes narrowing the range visibly shrink the bubbles.
 */
export function maxScatterCount(all: MonthSnapshot[]): number {
  // The chart's z is a single month's count (see scatterSeries below), so the
  // ceiling is the largest single (species, condition) count anywhere in the
  // window — the peak any bubble can legitimately reach. Anchoring every render
  // to this one fixed number is what makes moving the range visibly resize the
  // bubbles instead of Recharts re-normalising each frame to its own maximum.
  let peak = 1;
  for (const m of all) {
    for (const categories of Object.values(m.scatterCounts)) {
      for (const count of Object.values(categories as Record<string, number>)) {
        if (count > peak) peak = count;
      }
    }
  }
  return peak;
}

export function aggregateRange(all: MonthSnapshot[], range: DateRange): AggregatedSnapshot {
  const months = rangeMonths(all, range);
  const prev = previousRange(range);
  const prevMonths = prev ? rangeMonths(all, prev) : null;

  const totalTrees = totalTreesFor(months);
  const healthyTrees = healthyTreesFor(months);
  const canopyCoverPct = avgCanopyFor(months);
  const ndvi = avgNdviFor(months);
  const healthScore = avgHealthScoreFor(months);
  const prevConditionScore = prevMonths
    ? ecosystemConditionFor(avgNdviFor(prevMonths), avgHealthScoreFor(prevMonths)).score
    : null;
  const ecosystemConditionValue = ecosystemConditionFor(ndvi, healthScore);
  const ecosystemCondition = {
    ...ecosystemConditionValue,
    change: prevConditionScore !== null ? ecosystemConditionValue.score - prevConditionScore : null,
  };

  const crownCounts = CROWN_META.map((c) => ({ ...c, count: countAtEnd(months, "crownCounts", c.key) }));
  const crownTotal = crownCounts.reduce((s, c) => s + c.count, 0) || 1;
  const crownData: CrownBucketDatum[] = crownCounts.map((c) => ({
    label: c.label,
    color: c.color,
    pct: Math.round((c.count / crownTotal) * 100),
    count: c.count,
  }));

  const matureCrownPct = (m: MonthSnapshot[]): number => {
    const total = countAtEnd(m, "crownCounts", "b1") + countAtEnd(m, "crownCounts", "b2") + countAtEnd(m, "crownCounts", "b3") +
      countAtEnd(m, "crownCounts", "b4") + countAtEnd(m, "crownCounts", "b5") || 1;
    return ((countAtEnd(m, "crownCounts", "b4") + countAtEnd(m, "crownCounts", "b5")) / total) * 100;
  };
  const crownMaturePctValue = matureCrownPct(months);

  const scatterSeries: ScatterSeries[] = SPECIES_META.map(({ key, color }) => ({
    name: speciesLabel[key],
    color: speciesColor[key],
    data: scatterCategories.map((category) => {
      const pos = scatterPosition(key, category);
      // End-of-range, for the same reason countAtEnd exists: the population
      // persists, so summing months would multiply every bubble by the number
      // of months selected instead of sizing it by the trees actually there.
      const z = months[months.length - 1]?.scatterCounts[key][category] ?? 0;
      return { ...pos, z, species: speciesLabel[key], color, category };
    }),
  }));

  return {
    totalTrees: {
      value: totalTrees,
      change: prevMonths ? totalTrees - totalTreesFor(prevMonths) : null,
    },
    healthyTrees: {
      value: healthyTrees,
      change: prevMonths ? healthyTrees - healthyTreesFor(prevMonths) : null,
    },
    canopyCoverPct: {
      value: canopyCoverPct,
      change: prevMonths ? canopyCoverPct - avgCanopyFor(prevMonths) : null,
    },
    ndvi: {
      value: ndvi,
      change: prevMonths ? ndvi - avgNdviFor(prevMonths) : null,
    },
    ecosystemCondition,
    mostRecentSurvey: months[months.length - 1].date,
    lastActivity: months[months.length - 1].date,
    speciesData: SPECIES_META.map((s) => ({ name: s.name, color: s.color, value: countAtEnd(months, "speciesCounts", s.key) })),
    healthData: HEALTH_META.map((h) => ({ name: h.name, color: h.color, value: countAtEnd(months, "healthCounts", h.key) })),
    diameterData: DIAMETER_META.map((d) => ({ name: d.name, color: d.color, value: countAtEnd(months, "diameterCounts", d.key) })),
    heightData: HEIGHT_META.map((h) => ({ name: h.name, color: h.color, value: countAtEnd(months, "heightCounts", h.key) })),
    crownData,
    crownMaturePct: {
      value: crownMaturePctValue,
      change: prevMonths ? crownMaturePctValue - matureCrownPct(prevMonths) : null,
    },
    scatterSeries,
  };
}
