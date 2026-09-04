// Monthly aggregates, COUNTED off the tree population rather than invented.
//
// This file used to be the origin of the dataset: it interpolated a set of
// "before" and "after" distribution mixes to produce plausible-looking counts,
// and trees.ts then drew individual trees to match. That made the aggregates
// authoritative and the trees a sample of them, which is backwards — it is why
// a tree's identity could not survive from one month to the next, and why the
// plot's headline totals had no actual trees behind them.
//
// Now the population in treePopulation.ts is the dataset, and everything below
// is a tally of it. Each MonthSnapshot answers "what did this exact set of
// trees look like in month m", so a donut slice, a table row and a map pin are
// three views of the same individuals and cannot contradict each other.
//
// The shape of MonthSnapshot is unchanged, which is what keeps aggregate.ts and
// every chart working: only the provenance of the numbers changed.

import { CONDITION_KEYS, SPECIES_KEYS, type ConditionKey, type SpeciesKey } from "./taxonomy";
import { crownBucketFor, getPopulation, MONTHS_BACK } from "./treePopulation";
import type { CrownKey, DiameterKey, HeightKey, MonthSnapshot } from "./types";

export { MONTHS_BACK };

function monthLabel(date: Date): string {
  const month = date.toLocaleString("en-US", { month: "short" });
  const year = String(date.getFullYear()).slice(-2);
  return `${month} '${year}`;
}

/** Height class from a tree's metre height — the three bands the height donut
 * shows. Kept as a function of the real measurement so the chart and the table
 * can't disagree about which band a given tree falls in. */
export function heightBucketFor(height: number): HeightKey {
  if (height < 2) return "h3";
  if (height < 5.5) return "h2";
  return "h1";
}

function zeroed<K extends string>(keys: K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

/**
 * Canopy cover for a month: the mean vigour of the standing population, scaled
 * into a believable percentage range for a dryland plot. Derived rather than
 * stored so the headline recovery metric is genuinely the same signal the
 * individual trees carry — if the red zones collapse, this number falls with
 * them automatically.
 */
const CANOPY_AT_ZERO_VIGOUR = 6;
const CANOPY_AT_FULL_VIGOUR = 58;

/**
 * Builds the 12 monthly snapshots for an area by walking its population once
 * per month and tallying every category.
 */
export function generateMonthlySnapshots(scale = 1, seed = "area"): MonthSnapshot[] {
  const now = new Date();
  const population = getPopulation(scale, seed);

  return Array.from({ length: MONTHS_BACK }, (_, monthIndex) => {
    const monthsAgo = MONTHS_BACK - 1 - monthIndex;
    const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);

    const speciesCounts = zeroed<SpeciesKey>(SPECIES_KEYS);
    const healthCounts = zeroed<ConditionKey>(CONDITION_KEYS);
    const diameterCounts = zeroed<DiameterKey>(["L", "M", "S"]);
    const heightCounts = zeroed<HeightKey>(["h1", "h2", "h3"]);
    const crownCounts = zeroed<CrownKey>(["b1", "b2", "b3", "b4", "b5"]);
    const scatterCounts = Object.fromEntries(
      SPECIES_KEYS.map((s) => [s, zeroed<ConditionKey>(CONDITION_KEYS)]),
    ) as Record<SpeciesKey, Record<ConditionKey, number>>;

    let vigourTotal = 0;

    for (const tree of population) {
      const condition = tree.conditionByMonth[monthIndex];
      speciesCounts[tree.species] += 1;
      healthCounts[condition] += 1;
      diameterCounts[tree.diameter] += 1;
      heightCounts[heightBucketFor(tree.height)] += 1;
      crownCounts[crownBucketFor(tree.crownRadiusByMonth[monthIndex])] += 1;
      scatterCounts[tree.species][condition] += 1;
      vigourTotal += tree.vigourByMonth[monthIndex];
    }

    const meanVigour = population.length > 0 ? vigourTotal / population.length : 0;

    return {
      label: monthLabel(date),
      date,
      // Every tree in the population is surveyed every month — this is a
      // standing inventory, not a running intake, so the "logged" figure is
      // simply how many trees the survey covered.
      newTreesLogged: population.length,
      canopyCoverPct: CANOPY_AT_ZERO_VIGOUR + meanVigour * (CANOPY_AT_FULL_VIGOUR - CANOPY_AT_ZERO_VIGOUR),
      speciesCounts,
      healthCounts,
      diameterCounts,
      heightCounts,
      crownCounts,
      scatterCounts,
    } satisfies MonthSnapshot;
  });
}

export function buildMonthLabels(): string[] {
  const now = new Date();
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const monthsAgo = MONTHS_BACK - 1 - i;
    const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    return monthLabel(date);
  });
}

export const monthLabels = buildMonthLabels();

/**
 * Labels for the `count` calendar months right after the real window above —
 * no snapshot data behind them, just the date arithmetic, for callers (the
 * timeline slider) that want to show upcoming captures as visibly on the
 * calendar but not yet selectable.
 */
export function buildUpcomingMonthLabels(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1);
    return monthLabel(date);
  });
}
