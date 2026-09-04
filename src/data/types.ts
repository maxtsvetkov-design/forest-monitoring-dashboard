// Shared data shapes for the monthly timeline model.
// A MonthSnapshot is one month's independent measurement (a "flow", not a
// running total) — selecting a range on the timeline sums/averages these
// across the selected months to produce the values the dashboard renders.

// Species and condition vocabularies live in taxonomy.ts, which owns the
// botanical table they index into. Re-exported here so the many modules that
// already import their key types from this file keep working, and so there is
// still exactly one definition of each.
export type { SpeciesKey, ConditionKey } from "./taxonomy";
import type { SpeciesKey, ConditionKey } from "./taxonomy";

/** Historical alias. The five-band canopy scale is a *condition*, not a binary
 * health flag, but a lot of call sites still say "health" — they mean this. */
export type HealthKey = ConditionKey;

export type DiameterKey = "L" | "M" | "S";
export type HeightKey = "h1" | "h2" | "h3";
export type CrownKey = "b1" | "b2" | "b3" | "b4" | "b5";

export interface CategoryDatum {
  name: string;
  value: number;
  color: string;
}

export interface CrownBucketDatum {
  label: string;
  pct: number;
  color: string;
  /** Raw tree count behind `pct` — drives the dot-density texture in
   * CrownRadiusTreemap. */
  count: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  z: number;
  species: string;
  color: string;
  category: string;
}

export interface ScatterSeries {
  name: string;
  color: string;
  data: ScatterPoint[];
}

export interface MonthSnapshot {
  label: string; // e.g. "May '25"
  date: Date;
  newTreesLogged: number;
  canopyCoverPct: number;
  speciesCounts: Record<SpeciesKey, number>;
  healthCounts: Record<HealthKey, number>;
  diameterCounts: Record<DiameterKey, number>;
  heightCounts: Record<HeightKey, number>;
  crownCounts: Record<CrownKey, number>;
  // Per species -> per health category -> count, feeds the scatter chart's
  // bubble size (z). x/y jitter is generated once per species/category pair
  // (see monthlySnapshots.ts) so bubbles don't jump position when the range
  // changes, only grow/shrink.
  scatterCounts: Record<SpeciesKey, Record<HealthKey, number>>;
}

export interface KpiValue {
  value: number;
  change: number | null; // null when there's no prior period in the 12-month window to compare against
}

/** A blend of NDVI and average health score into one 0-100 read on the
 * site's overall condition — see aggregate.ts's ecosystemConditionFor. */
export interface EcosystemCondition {
  score: number;
  tierIndex: number;
  label: string;
  color: string;
  /** Change in `score` vs. the prior period — null with no prior period to
   * compare against, same convention as KpiValue. */
  change: number | null;
}

export interface AggregatedSnapshot {
  totalTrees: KpiValue;
  /** Trees in an unflagged condition (Normal or Vigorous) as of the range's
   * last month — see aggregate.ts's healthyTreesFor. */
  healthyTrees: KpiValue;
  canopyCoverPct: KpiValue;
  /** 0–1, derived from canopy cover and health mix — see aggregate.ts's
   * ndviFor for why this dataset has no independent spectral signal to draw
   * a "real" NDVI from. */
  ndvi: KpiValue;
  ecosystemCondition: EcosystemCondition;
  mostRecentSurvey: Date;
  lastActivity: Date;
  speciesData: CategoryDatum[];
  healthData: CategoryDatum[];
  diameterData: CategoryDatum[];
  heightData: CategoryDatum[];
  crownData: CrownBucketDatum[];
  /** Share of trees in the two largest crown-radius buckets (b4: 0.6–0.8 and
   * b5: 0.8–1.2) — the crown widget's own trend indicator, since a shift
   * toward bigger crowns is what "recovering" looks like at the radius level,
   * the same way canopyCoverPct is the plot-wide version of that story. */
  crownMaturePct: KpiValue;
  scatterSeries: ScatterSeries[];
}
