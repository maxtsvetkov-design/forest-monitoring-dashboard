/**
 * The habitat-health assessment, restricted to what this dataset can actually
 * score.
 *
 * The delivered product (see `deliverables.ts`, `health-assessment`) names six
 * indicators. Two of them have real measurements behind them here and four do
 * not, and this module exists to keep that line sharp: it computes the two, and
 * it deliberately offers no function at all for fragmentation, marine water
 * quality, human disturbance or ecological function. A stub returning a
 * plausible number is how a spec turns into a fabrication.
 *
 * Which two, and why they are honest:
 *
 * - **Habitat health index.** `aggregate.ts` already scores the five condition
 *   bands onto 0–100 and takes the population mean. That is a composite
 *   condition index by any reasonable reading — what the delivered product adds
 *   is a spatial layer, not the index itself.
 * - **Vegetation density.** Canopy cover, the one vegetation measure with a
 *   genuine month-by-month series behind it (see `monthlySnapshots.ts`). Cover
 *   is not the same measure as density and the panel says so; it is the closest
 *   real thing, not a rename.
 *
 * The grid below is what makes the first of those *spatial*. It is aggregation,
 * not interpolation: every cell reports the mean of the trees standing inside
 * it and nothing is smeared into the cells between them.
 *
 * Fragmentation deserves a note, because it looks available and is not. The two
 * delivered extent traces (`maha_22.png` / `maha_55.png`) were measured for
 * this: each paints 1.15% of its frame in two connected components, which is a
 * boundary STROKE rather than a filled extent. A stroke gives a patch count and
 * no patch areas, and patch area is most of what a fragmentation metric is. So
 * it stays unscored.
 */

import { HEALTH_SCORE_WEIGHT, healthScoreSeries } from "./aggregate";
import { CONDITIONS, type ConditionKey } from "./taxonomy";
import { getPopulation } from "./treePopulation";
import type { MonthSnapshot } from "./types";

/** The indicators this module can put a number on. Layers in `deliverables.ts`
 *  tag themselves with one of these when they are scored, which is what lets
 *  the panel's "n of m indicators" count come off the catalogue rather than
 *  being written down twice. */
export type HealthIndicatorKey = "healthIndex" | "vegetationDensity";

export interface IndicatorPoint {
  label: string;
  /** Composite condition index, 0–100. */
  healthIndex: number;
  /** Canopy cover, percent of ground under crown. */
  vegetationDensity: number;
}

/**
 * Both scored indicators across the WHOLE window, not the selected interval —
 * an indicator trend is inherently a trend, the same reason
 * `healthScoreSeries` ignores the range. The selected interval is marked on the
 * chart instead, so narrowing it reframes the reading without hiding the
 * months either side of it.
 */
export function indicatorSeries(snapshots: MonthSnapshot[]): IndicatorPoint[] {
  const index = healthScoreSeries(snapshots);
  return snapshots.map((month, i) => ({
    label: month.label,
    healthIndex: index[i]?.score ?? 0,
    vegetationDensity: Math.round(month.canopyCoverPct * 10) / 10,
  }));
}

/**
 * Grid shape.
 *
 * The overlay frame is 2752×1536 (aspect 1.79), so 7×4 cells come out at
 * 393×384 image pixels — near enough square that a reader comparing two cells
 * is comparing two equal pieces of ground. An oblong grid quietly invites the
 * opposite.
 */
export const GRID_COLS = 7;
export const GRID_ROWS = 4;

export interface HealthGridCell {
  id: string;
  col: number;
  row: number;
  /** Trees standing in this cell. Same in both months — the population is
   *  persistent, so a cell cannot gain or lose trees. */
  trees: number;
  /** Mean per-tree health score in the compare month, 0–100, or null when the
   *  cell holds too few trees to report one — see `cellMean`. */
  score: number | null;
  /** Points of that score gained or lost since the baseline month, or null on
   *  the same condition. */
  delta: number | null;
}

export interface HealthGrid {
  cells: HealthGridCell[];
  /** How many cells carry a reportable score, for the readout. */
  scored: number;
  /** Trees the grid did not report on, because they stand in cells below the
   *  sample floor. Stated rather than swallowed: a reader is entitled to know
   *  how much of the plot the grid is declining to score. */
  unreportedTrees: number;
  /** Widest absolute delta anywhere on the grid, so the change ramp can be
   *  scaled to what actually happened instead of to a fixed span that flattens
   *  a quiet month and clips a bad one. */
  peakDelta: number;
}

/**
 * The mean of a cell's per-tree scores — or null, when the cell does not hold
 * enough trees for a mean to say anything.
 *
 * This is the grid's honesty valve, and it matters more than it looks. Tree
 * positions are real and therefore uneven, so a 7×4 grid over ~340 trees
 * leaves corner cells holding one or two. One Defoliated tree alone in a cell
 * would paint a full grey square that reads as "this ground is dead", when what
 * it actually says is "we measured one tree here" — the same failure mode as
 * the projection columns reporting "0 trees died back" on a patch with no trees
 * in it.
 */
function cellMean(sum: number, count: number): number | null {
  // TODO(human): decide the minimum sample this grid will report on.
  return null;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}

/**
 * Bins the population by its own image-space position and scores each cell.
 *
 * Reads `getPopulation(1, areaId)` — scale 1, matching `detectHabitatChange`'s
 * own default — so the trees this grid counts are exactly the trees the panel's
 * `surveyed` figure counts. A different scale here would produce a grid that
 * quietly described a different plot from the one the numbers beside it report.
 */
export function healthScoreGrid(areaId: string, baselineIndex: number, compareIndex: number): HealthGrid {
  const population = getPopulation(1, areaId);
  const months = population[0]?.conditionByMonth.length ?? 0;
  const from = clampIndex(baselineIndex, months);
  const to = clampIndex(compareIndex, months);

  const size = GRID_COLS * GRID_ROWS;
  const counts = new Array<number>(size).fill(0);
  const sumNow = new Array<number>(size).fill(0);
  const sumThen = new Array<number>(size).fill(0);

  for (const tree of population) {
    // Math.min guards u or v landing exactly on 1, which would index one cell
    // past the end of the row.
    const col = Math.min(GRID_COLS - 1, Math.floor(tree.u * GRID_COLS));
    const row = Math.min(GRID_ROWS - 1, Math.floor(tree.v * GRID_ROWS));
    const at = row * GRID_COLS + col;
    counts[at] += 1;
    sumNow[at] += HEALTH_SCORE_WEIGHT[tree.conditionByMonth[to]];
    sumThen[at] += HEALTH_SCORE_WEIGHT[tree.conditionByMonth[from]];
  }

  let scored = 0;
  let unreportedTrees = 0;
  let peakDelta = 0;

  const cells: HealthGridCell[] = Array.from({ length: size }, (_, at) => {
    const col = at % GRID_COLS;
    const row = (at - col) / GRID_COLS;
    const score = cellMean(sumNow[at], counts[at]);
    const then = cellMean(sumThen[at], counts[at]);
    const delta = score !== null && then !== null ? score - then : null;

    if (score === null) unreportedTrees += counts[at];
    else scored++;
    if (delta !== null) peakDelta = Math.max(peakDelta, Math.abs(delta));

    return { id: `c${col}-${row}`, col, row, trees: counts[at], score, delta };
  });

  return { cells, scored, unreportedTrees, peakDelta };
}

/**
 * The condition band a score sits closest to, by the same weights that
 * produced it.
 *
 * Colouring a cell this way rather than with a ramp of its own keeps the grid
 * inside the legend the rest of the screen already carries — a cell reading
 * "Sparse orange" means the same thing as a map pin or a stacked-bar segment
 * reading it, because it IS the same scale, run backwards.
 */
export function bandForScore(score: number): ConditionKey {
  let best = CONDITIONS[0].key;
  let bestGap = Infinity;
  for (const condition of CONDITIONS) {
    const gap = Math.abs(HEALTH_SCORE_WEIGHT[condition.key] - score);
    if (gap < bestGap) {
      bestGap = gap;
      best = condition.key;
    }
  }
  return best;
}
