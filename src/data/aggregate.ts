import type {
  AggregatedSnapshot,
  CrownBucketDatum,
  EcosystemCondition,
  HealthKey,
  MonthSnapshot,
  ScatterSeries,
} from "./types";
import { scatterCategories, scatterPosition, speciesColor, speciesLabel } from "./scatterLayout";

export interface DateRange {
  startIndex: number;
  endIndex: number; // inclusive
}

const SPECIES_META = [
  { key: "ghaf" as const, name: "Ghaf canopy", color: "#E07B39" },
  { key: "sidr" as const, name: "Sidr underneath", color: "#1A9E7A" },
  { key: "palm" as const, name: "Palm beneath", color: "#5BA4CF" },
];

// Dead is shown alongside the other three: with the recovery dataset it is a
// quarter of the plot in the earliest months and near-nothing in the latest, so
// leaving it out would hide the most striking part of the change. Colours match
// the map's degrading-tree pins (see treePins.ts) so the two views read as one.
const HEALTH_META = [
  { key: "healthy" as const, name: "Healthy", color: "#24A67A" },
  { key: "stressed" as const, name: "Stressed", color: "#F0B429" },
  { key: "declining" as const, name: "Declining", color: "#E55C2F" },
  { key: "dead" as const, name: "Dead", color: "#8C8C8C" },
];

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

function sumBy<K extends string>(
  months: MonthSnapshot[],
  field: "speciesCounts" | "healthCounts" | "diameterCounts" | "heightCounts" | "crownCounts",
  key: K,
): number {
  return months.reduce((total, m) => total + (m[field] as Record<K, number>)[key], 0);
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

function totalTreesFor(months: MonthSnapshot[]): number {
  return months.reduce((total, m) => total + m.newTreesLogged, 0);
}

function avgCanopyFor(months: MonthSnapshot[]): number {
  return months.reduce((total, m) => total + m.canopyCoverPct, 0) / months.length;
}

// No spectral-band imagery backs this dataset, so NDVI is derived rather than
// measured: canopy cover (how much of the ground is under crown) carries most
// of the signal real NDVI would, with the healthy-tree fraction nudging it —
// stressed canopy reads greener in a photo than it does in reflectance. This
// keeps the value honest to what the mock data actually models instead of
// inventing an independent, disconnected number.
function ndviFor(month: MonthSnapshot): number {
  const c = month.healthCounts;
  const total = c.healthy + c.stressed + c.declining + c.dead || 1;
  const healthyFrac = c.healthy / total;
  const raw = 0.15 + 0.55 * (month.canopyCoverPct / 100) + 0.3 * healthyFrac;
  return Math.max(0, Math.min(1, raw));
}

function avgNdviFor(months: MonthSnapshot[]): number {
  return months.reduce((total, m) => total + ndviFor(m), 0) / months.length;
}

// A single 0-100 "how is this tree doing" figure, letting Average health
// score plot one line instead of four separate category counts. Dead trees
// score 0, healthy trees 100 -- the two intermediate categories split the
// range roughly where "stressed but alive" and "actively declining" belong.
const HEALTH_SCORE_WEIGHT: Record<HealthKey, number> = { healthy: 100, stressed: 60, declining: 30, dead: 0 };

function healthScoreFor(month: MonthSnapshot): number {
  const c = month.healthCounts;
  const total = c.healthy + c.stressed + c.declining + c.dead || 1;
  return (
    (c.healthy * HEALTH_SCORE_WEIGHT.healthy +
      c.stressed * HEALTH_SCORE_WEIGHT.stressed +
      c.declining * HEALTH_SCORE_WEIGHT.declining +
      c.dead * HEALTH_SCORE_WEIGHT.dead) /
    total
  );
}

function avgHealthScoreFor(months: MonthSnapshot[]): number {
  return months.reduce((total, m) => total + healthScoreFor(m), 0) / months.length;
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
  // The chart's own z value is a SUM across every month in the selected range
  // (see scatterSeries below), not a single month's count — so the ceiling
  // has to be the largest such sum too, or a real full-range value legitimately
  // exceeds it and every over-ceiling point silently clamps to the same
  // maximum radius, which is what made two different ranges render identically
  // despite genuinely different totals.
  const totals: Record<string, number> = {};
  for (const m of all) {
    for (const [species, categories] of Object.entries(m.scatterCounts)) {
      for (const [category, count] of Object.entries(categories as Record<string, number>)) {
        const key = `${species}:${category}`;
        totals[key] = (totals[key] ?? 0) + count;
      }
    }
  }
  return Math.max(1, ...Object.values(totals));
}

export function aggregateRange(all: MonthSnapshot[], range: DateRange): AggregatedSnapshot {
  const months = rangeMonths(all, range);
  const prev = previousRange(range);
  const prevMonths = prev ? rangeMonths(all, prev) : null;

  const totalTrees = totalTreesFor(months);
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

  const crownCounts = CROWN_META.map((c) => ({ ...c, count: sumBy(months, "crownCounts", c.key) }));
  const crownTotal = crownCounts.reduce((s, c) => s + c.count, 0) || 1;
  const crownData: CrownBucketDatum[] = crownCounts.map((c) => ({
    label: c.label,
    color: c.color,
    pct: Math.round((c.count / crownTotal) * 100),
    count: c.count,
  }));

  const matureCrownPct = (m: MonthSnapshot[]): number => {
    const total = sumBy(m, "crownCounts", "b1") + sumBy(m, "crownCounts", "b2") + sumBy(m, "crownCounts", "b3") +
      sumBy(m, "crownCounts", "b4") + sumBy(m, "crownCounts", "b5") || 1;
    return ((sumBy(m, "crownCounts", "b4") + sumBy(m, "crownCounts", "b5")) / total) * 100;
  };
  const crownMaturePctValue = matureCrownPct(months);

  const scatterSeries: ScatterSeries[] = SPECIES_META.map(({ key, color }) => ({
    name: speciesLabel[key],
    color: speciesColor[key],
    data: scatterCategories.map((category) => {
      const pos = scatterPosition(key, category);
      const z = months.reduce((total, m) => total + m.scatterCounts[key][category], 0);
      return { ...pos, z, species: speciesLabel[key], color, category };
    }),
  }));

  return {
    totalTrees: {
      value: totalTrees,
      change: prevMonths ? totalTrees - totalTreesFor(prevMonths) : null,
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
    speciesData: SPECIES_META.map((s) => ({ name: s.name, color: s.color, value: sumBy(months, "speciesCounts", s.key) })),
    healthData: HEALTH_META.map((h) => ({ name: h.name, color: h.color, value: sumBy(months, "healthCounts", h.key) })),
    diameterData: DIAMETER_META.map((d) => ({ name: d.name, color: d.color, value: sumBy(months, "diameterCounts", d.key) })),
    heightData: HEIGHT_META.map((h) => ({ name: h.name, color: h.color, value: sumBy(months, "heightCounts", h.key) })),
    crownData,
    crownMaturePct: {
      value: crownMaturePctValue,
      change: prevMonths ? crownMaturePctValue - matureCrownPct(prevMonths) : null,
    },
    scatterSeries,
  };
}
