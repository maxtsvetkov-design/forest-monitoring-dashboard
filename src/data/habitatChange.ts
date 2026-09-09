import type { MapOverlay } from "./overlays";
import {
  CONDITION_COLOR,
  CONDITION_LABEL,
  CONDITION_RANK,
  isFlaggedCondition,
  type ConditionKey,
} from "./taxonomy";
import { generateTreeRecordsAt, type TreeRecord } from "./trees";
import { getPopulation } from "./treePopulation";
import type { CategoryDatum, MonthSnapshot } from "./types";

/**
 * Habitat change detection between two months of the same plot.
 *
 * The detections here are real, not simulated: `treePopulation.ts` keeps a
 * *persistent* population, so the same tree id exists in both months with its
 * own condition in each. Comparing a tree against itself is therefore a
 * genuine observed transition — the same thing that lets the events feed name
 * the tree that dropped a band (see `generateEvents`), read across an
 * arbitrary interval rather than one month to the next.
 *
 * What this deliberately does NOT claim:
 *
 * - **No before/after imagery pair.** The alternate aerial frames in
 *   `overlays.ts` carry no capture date ("a different look per stretch of the
 *   timeline", in that file's own words). Presenting two of them as dated
 *   captures either side of an interval would invent provenance the dataset
 *   doesn't have, so the map imagery here is context, not evidence.
 * - **No habitat-class transition matrix.** The land-cover split the Story tab
 *   shows (shrubland / bare soil / sabkha / rock) is one static classification,
 *   with no per-month series behind it — so "44% bare soil became 38%
 *   shrubland" is not a sentence this dataset can support. Canopy cover is the
 *   one vegetation measure that genuinely moves month to month, and it is the
 *   one this reports.
 */

export type ChangeClass = "declined" | "recovered" | "stable";

/**
 * The two directions of travel, as colours.
 *
 * Held with the detector rather than in whichever component drew them first,
 * because more than one surface now renders this report — the triage list, the
 * headline counts and the spatial health grid all have to agree that red means
 * a tree got worse. Recovery is deliberately the taxonomy's own Normal green
 * (`CONDITION_COLOR.normal`): recovering means landing in an unflagged band, so
 * the colour of the outcome and the colour of the destination are the same
 * fact.
 */
export const CHANGE_COLOR = {
  declined: "#E5484D",
  recovered: CONDITION_COLOR.normal,
} as const;

export interface HabitatChangeDetection {
  treeId: string;
  species: string;
  lat: number;
  lng: number;
  from: ConditionKey;
  to: ConditionKey;
  /** Signed bands moved: negative is a decline, positive a recovery. */
  bands: number;
  changeClass: ChangeClass;
  /** Which dieback block this tree stands in, or null outside every one. */
  declineZoneId: number | null;
}

/**
 * Detections grouped by the ground they stand on. The blocks are real spatial
 * clusters (`treePopulation.ts`'s DECLINE_ZONES), not a grid this module
 * invents — which is what makes "block 3 is failing" a statement about a place
 * rather than about an arbitrary tile boundary.
 */
export interface HabitatChangeBlock {
  id: string;
  label: string;
  declined: number;
  recovered: number;
  /** Worst condition any of this block's declining trees ended in. */
  worst: ConditionKey;
  /** A real tree in this block, for flying the map to it — same reasoning as
   * TreeEvent.tree: a fabricated coordinate can't be navigated to. */
  anchor: HabitatChangeDetection;
}

export interface HabitatChangeReport {
  baselineIndex: number;
  compareIndex: number;
  baselineLabel: string;
  compareLabel: string;
  declined: number;
  recovered: number;
  stable: number;
  /** Every tree compared — the denominator behind the three counts above. */
  surveyed: number;
  /** Percentage points of plot-wide canopy cover gained or lost between the
   * two months. Real, straight off the snapshots. */
  canopyCoverDelta: number;
  conditionMixBefore: CategoryDatum[];
  conditionMixAfter: CategoryDatum[];
  blocks: HabitatChangeBlock[];
  /** Just the changed trees, for restricting the map's pins to them — see
   * MapCanvas's `visibleTreeIds`. */
  changedTreeIds: Set<string>;
  detections: HabitatChangeDetection[];
}

/**
 * What one tree's move between the two months counts as.
 *
 * This is the whole detector's threshold: it decides how much of the plot's
 * ordinary month-to-month wobble reaches an operator as a "detection". Per-tree
 * vigour carries real variance (see `treePopulation.ts`), so trees drift across
 * a band boundary and back without anything having happened on the ground.
 *
 * The rule is therefore "did this tree's *need for attention* change", not
 * "did its band change": a decline has to land in a flagged band, and a
 * recovery has to land out of one. Two consequences worth knowing, because the
 * counts on screen inherit them:
 *
 * - Vigorous → Normal is NOT a decline. Normal is a healthy tree; reporting it
 *   would bury the trees that actually need a visit under the plot breathing.
 * - Defoliated → Sparse is NOT a recovery. It moved up, but it is still a
 *   flagged tree in trouble, and calling it "recovered" would tell an operator
 *   to stop looking at it.
 *
 * The decline half is deliberately the same test `events.ts` applies to its own
 * decline events, so the two features can never report a different number of
 * failing trees for the same interval.
 */
function classifyChange(from: ConditionKey, to: ConditionKey): ChangeClass {
  const moved = CONDITION_RANK[to] - CONDITION_RANK[from];
  if (moved < 0 && isFlaggedCondition(to)) return "declined";
  if (moved > 0 && !isFlaggedCondition(to)) return "recovered";
  return "stable";
}

function mixOf(records: TreeRecord[]): CategoryDatum[] {
  const counts = new Map<ConditionKey, number>();
  for (const r of records) counts.set(r.condition, (counts.get(r.condition) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => CONDITION_RANK[a[0]] - CONDITION_RANK[b[0]])
    .map(([condition, value]) => ({ name: CONDITION_LABEL[condition], value, color: CONDITION_COLOR[condition] }));
}

/**
 * The change-detection readings this screen can chart, as keys layers in
 * `deliverables.ts` tag themselves with — the same join `HealthIndicatorKey`
 * provides for the health assessment. See `DeliverableLayer.indicator`.
 */
export type ChangeMetricKey = "extentChange" | "temporalStats";

export interface ChangeStep {
  /** The month arrived in. The step measures the move INTO it from the month
   *  before, so a 12-month window yields 11 steps. */
  label: string;
  declined: number;
  recovered: number;
}

/**
 * Declines and recoveries for every consecutive month pair in the window —
 * the "temporal change statistics" the change-detection dataset promises, at
 * the only resolution this plot's data supports.
 *
 * Reads the population's own condition timeline rather than going back through
 * `detectHabitatChange` twelve times: the classifier is the same
 * `classifyChange` the interval report uses, so a month's bar and the headline
 * counts are one definition, but there is no need to project 340 trees onto map
 * coordinates eleven times over to count them.
 *
 * WORTH KNOWING, and the panel says so: these steps do not sum to the interval
 * totals. A tree that drops a band in March and climbs back in June is two
 * steps here and no net change across an interval spanning both. Month-to-month
 * churn and interval change are different questions, and a reader who adds the
 * bars expecting the headline should be told that before they try.
 */
export function changeStatsSeries(areaId: string, snapshots: MonthSnapshot[]): ChangeStep[] {
  const population = getPopulation(1, areaId);
  const steps: ChangeStep[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    let declined = 0;
    let recovered = 0;
    for (const tree of population) {
      const moved = classifyChange(tree.conditionByMonth[i - 1], tree.conditionByMonth[i]);
      if (moved === "declined") declined++;
      else if (moved === "recovered") recovered++;
    }
    steps.push({ label: snapshots[i]?.label ?? "", declined, recovered });
  }

  return steps;
}

export interface BandsMovedRow {
  /** Signed bands moved: negative is a decline. */
  bands: number;
  trees: number;
}

/**
 * How far the detections moved, as a distribution — the dataset's "summary
 * table", built from the detections already on screen rather than a second
 * pass over the population.
 *
 * Sorted worst move first, and it necessarily sums to `declined + recovered`:
 * every detection moved by some non-zero number of bands, and stable trees
 * never enter `detections` at all. That makes the table checkable against the
 * two headline counts, which is most of what a summary table is for.
 */
export function summariseBandsMoved(detections: HabitatChangeDetection[]): BandsMovedRow[] {
  const byBands = new Map<number, number>();
  for (const detection of detections) {
    byBands.set(detection.bands, (byBands.get(detection.bands) ?? 0) + 1);
  }
  return [...byBands]
    .map(([bands, trees]) => ({ bands, trees }))
    .sort((a, b) => a.bands - b.bands);
}

/**
 * Compares every tree in the plot between two months and reports what moved.
 *
 * Both months are read at a single point in time (`generateTreeRecordsAt`),
 * not aggregated across a window: "what did this tree look like in March, and
 * what does it look like now" is the question, and averaging either end would
 * blur the transition being detected.
 */
export function detectHabitatChange(
  overlay: MapOverlay,
  areaId: string,
  snapshots: MonthSnapshot[],
  baselineIndex: number,
  compareIndex: number,
): HabitatChangeReport {
  const last = Math.max(0, snapshots.length - 1);
  const from = Math.max(0, Math.min(baselineIndex, last));
  const to = Math.max(0, Math.min(compareIndex, last));

  const before = generateTreeRecordsAt(overlay, areaId, snapshots, from);
  const after = generateTreeRecordsAt(overlay, areaId, snapshots, to);
  const beforeById = new Map(before.map((r) => [r.id, r]));

  const detections: HabitatChangeDetection[] = [];
  let declined = 0;
  let recovered = 0;
  let stable = 0;

  for (const now of after) {
    const then = beforeById.get(now.id);
    // A tree present in one month but not the other isn't a habitat change,
    // it's a population edit — nothing to compare, so nothing to report.
    if (!then) continue;
    const changeClass = classifyChange(then.condition, now.condition);
    if (changeClass === "stable") {
      stable++;
      continue;
    }
    if (changeClass === "declined") declined++;
    else recovered++;
    detections.push({
      treeId: now.id,
      species: now.species,
      lat: now.lat,
      lng: now.lng,
      from: then.condition,
      to: now.condition,
      bands: CONDITION_RANK[now.condition] - CONDITION_RANK[then.condition],
      changeClass,
      declineZoneId: now.declineZoneId,
    });
  }

  const byZone = new Map<number | null, HabitatChangeDetection[]>();
  for (const d of detections) {
    const list = byZone.get(d.declineZoneId) ?? [];
    list.push(d);
    byZone.set(d.declineZoneId, list);
  }

  const blocks: HabitatChangeBlock[] = [...byZone]
    .map(([zoneId, list]) => {
      const declinedHere = list.filter((d) => d.changeClass === "declined");
      // Anchor on a declining tree where there is one: flying to a block
      // called "12 trees declined" should land on one of those twelve, not on
      // whichever recovering tree happened to sort first.
      const anchor = declinedHere[0] ?? list[0];
      const worst = declinedHere.reduce<ConditionKey>(
        (acc, d) => (CONDITION_RANK[d.to] < CONDITION_RANK[acc] ? d.to : acc),
        anchor.to,
      );
      return {
        id: zoneId === null ? "outside" : `block-${zoneId + 1}`,
        label: zoneId === null ? "Outside mapped blocks" : `Dieback block ${zoneId + 1}`,
        declined: declinedHere.length,
        recovered: list.length - declinedHere.length,
        worst,
        anchor,
      };
    })
    // Worst first: an operator triaging this list wants the block with the
    // most losses at the top, not the lowest-numbered one.
    .sort((a, b) => b.declined - a.declined || b.recovered - a.recovered);

  return {
    baselineIndex: from,
    compareIndex: to,
    baselineLabel: snapshots[from]?.label ?? "",
    compareLabel: snapshots[to]?.label ?? "",
    declined,
    recovered,
    stable,
    surveyed: declined + recovered + stable,
    canopyCoverDelta:
      Math.round(((snapshots[to]?.canopyCoverPct ?? 0) - (snapshots[from]?.canopyCoverPct ?? 0)) * 10) / 10,
    conditionMixBefore: mixOf(before),
    conditionMixAfter: mixOf(after),
    blocks,
    changedTreeIds: new Set(detections.map((d) => d.treeId)),
    detections,
  };
}
