// Per-tree records as the UI consumes them: one row per (tree, month), with
// the tree's identity and taxonomy attached and its u/v position projected onto
// real ground coordinates through the area's overlay.
//
// This generates nothing. Every field either comes straight off the population
// in treePopulation.ts or is derived from it (genus and scientific name via the
// taxonomy table, lat/lng via the overlay's four corners). The population is
// the single source of truth; this is the view of it that has coordinates.

import { pointInQuad, type MapOverlay } from "./overlays";
import { CONDITION_LABEL, speciesInfo, type ConditionKey } from "./taxonomy";
import { crownBucketFor, CROWN_RANGE, getPopulation, type PopulationTree } from "./treePopulation";
import type { CrownKey, MonthSnapshot } from "./types";

export { CROWN_RANGE };

export interface TreeRecord {
  id: string;
  /** Local common name, e.g. "Ghaf". */
  species: string;
  /** Derived from `species` — never stored on the population. */
  genus: string;
  /** Derived from `species` — never stored on the population. */
  scientificName: string;
  /** Canopy condition in this record's month: Defoliated / Sparse / Moderate /
   * Normal / Vigorous. */
  health: string;
  /** The same value as a key, for callers that need to compare or colour it
   * without matching on display strings. */
  condition: ConditionKey;
  diameter: "L (>5 m)" | "M (2–5 m)" | "S (<1 m)";
  height: number;
  lastSurveyed: string;
  lat: number;
  lng: number;
  /** Position in the overlay image's own space: 0→1 left→right. */
  u: number;
  /** Position in the overlay image's own space: 0→1 top→bottom. */
  v: number;
  canopyLossPct: number;
  /** Crown radius in metres in this month, and the b1..b5 band it falls in —
   * the same bands the crown treemap aggregates, so clicking a band there can
   * filter this table to exactly the trees it counted. */
  crownRadius: number;
  crownBucket: CrownKey;
  /** Which month of the window this observation is from. */
  monthIndex: number;
  /** True when this tree stands inside the failing ground traced by
   * al-maha-generative_red.png — the reason a tree declines over the final
   * months rather than continuing to recover with the rest of the plot. */
  inDeclineZone: boolean;
  /** Which dieback block (index into treePopulation.ts's DECLINE_ZONES) this
   * tree stands in, or null outside every zone — lets the events feed report
   * per-block declines instead of one plot-wide event. */
  declineZoneId: number | null;
  /** This tree's actual condition in every month of the window, oldest first.
   * Shared by reference with the population, not copied, so carrying it on
   * every record costs a pointer rather than a twelve-element array. */
  conditionHistory: ConditionKey[];
}

export const CROWN_LABEL: Record<CrownKey, string> = {
  b1: "0 – 0.2",
  b2: "0.2 – 0.4",
  b3: "0.4 – 0.6",
  b4: "0.6 – 0.8",
  b5: "0.8 – 1.2",
};

const DIAMETER_LABEL = {
  L: "L (>5 m)",
  M: "M (2–5 m)",
  S: "S (<1 m)",
} as const;

function toRecord(
  tree: PopulationTree,
  monthIndex: number,
  label: string,
  overlay: MapOverlay,
): TreeRecord {
  const info = speciesInfo(tree.species);
  const condition = tree.conditionByMonth[monthIndex];
  const crownRadius = tree.crownRadiusByMonth[monthIndex];
  const [lng, lat] = pointInQuad(overlay.coordinates, tree.u, tree.v);

  return {
    id: tree.id,
    species: info.common,
    genus: info.genus,
    scientificName: info.scientific,
    health: CONDITION_LABEL[condition],
    condition,
    diameter: DIAMETER_LABEL[tree.diameter],
    height: tree.height,
    lastSurveyed: label,
    lat,
    lng,
    u: tree.u,
    v: tree.v,
    // Canopy loss is the complement of vigour, not an independent roll — a
    // Defoliated tree reading "18% canopy loss" is exactly the sort of
    // contradiction that made the old table look generated.
    canopyLossPct: Math.round((1 - tree.vigourByMonth[monthIndex]) * 100),
    crownRadius,
    crownBucket: crownBucketFor(crownRadius),
    monthIndex,
    inDeclineZone: tree.declineSeverity > 0,
    declineZoneId: tree.declineZoneId,
    conditionHistory: tree.conditionByMonth,
  };
}

/**
 * The whole population as observed in one month. This is what the Areas table
 * and the map want: a standing inventory at a point in time, one row per tree.
 */
export function generateTreeRecordsAt(
  overlay: MapOverlay,
  areaId: string,
  snapshots: MonthSnapshot[],
  monthIndex: number,
  scale = 1,
): TreeRecord[] {
  const population = getPopulation(scale, areaId);
  const clamped = Math.max(0, Math.min(monthIndex, snapshots.length - 1));
  const label = snapshots[clamped]?.label ?? "";
  return population.map((tree) => toRecord(tree, clamped, label, overlay));
}

/**
 * Every (tree, month) observation across the whole window.
 *
 * Callers that want "the plot right now" should prefer `generateTreeRecordsAt`
 * — this one is for consumers that genuinely need the history, such as the
 * events feed looking for the month a tree's condition changed.
 */
export function generateTreeRecords(
  overlay: MapOverlay,
  areaId: string,
  snapshots: MonthSnapshot[],
  scale = 1,
): TreeRecord[] {
  const population = getPopulation(scale, areaId);
  const records: TreeRecord[] = [];
  snapshots.forEach((month, monthIndex) => {
    for (const tree of population) {
      records.push(toRecord(tree, monthIndex, month.label, overlay));
    }
  });
  return records;
}
