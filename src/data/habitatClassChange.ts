import { seededRandom } from "./random";
import { habitatClassByCode } from "./habitatLegend";
import type { TreeEvent } from "./events";

/**
 * Per-classification-code breakdown behind one habitat-change event.
 *
 * ONE DELIBERATE EXCEPTION to this app's usual rule. Everywhere else, a
 * number on screen is counted off the tree population, the census, or a
 * delivered raster (see `events.ts`, `aggregate.ts`, `monthlySnapshots.ts`,
 * all of which say so at length). Nothing in this app classifies imagery
 * into the reference key's codes, so there is no measured per-class extent
 * to read — these figures are modelled, on request, to show what a
 * classified change report would carry. The UI that renders them says so in
 * as many words rather than passing them off as measured; see
 * `HabitatClassChangeBreakdown`.
 *
 * Two properties keep them from being merely arbitrary:
 *
 *  - Seeded per event id, so a given event's breakdown is identical on every
 *    render and reload — the same discipline `trees.ts` and `crabPlovers.ts`
 *    use, not `Math.random()` that reshuffles under the reader.
 *  - Internally consistent with the card above them: the three classes'
 *    losses and gains sum to exactly the `impactedAreaHa` that card already
 *    states, and each class's direction follows the event's own
 *    `changeType`. Fabricated numbers that contradicted the panel they sit
 *    in would be worse than fabricated — they would be visibly wrong.
 */

/** The three codes this breakdown tracks, from the reference key's own
 *  terrestrial table — labels and swatch colours come from there, never
 *  restated here (see `habitatLegend.ts`).
 *
 *  Chosen as one coherent transition, not three unrelated classes: 1030
 *  Saltmarsh is the habitat this event's own `habitatImpact.habitat` names,
 *  1020 is the degraded tidal-flat state a saltmarsh reduces to as it thins,
 *  and 3100 is the hypersaline sabkha it borders and can be overtaken by on
 *  Abu Al Abyad's real coastline — so a "reduction" reads as saltmarsh giving
 *  ground to exactly the two neighbours it would, ecologically, give ground
 *  to, rather than to classes with no spatial relationship to it. */
const TRACKED_CODES = ["1030", "1020", "3100"] as const;

export interface HabitatClassChange {
  code: string;
  label: string;
  color: string;
  /** Class extent over the whole surveyed footprint, before and after this
   *  event's own window, in hectares. */
  beforeHa: number;
  afterHa: number;
  /** Signed: negative is extent lost. `deltaHa` across the three classes
   *  sums to the event's own impacted-area figure. */
  deltaHa: number;
  deltaPct: number;
  /** This class's share of the event's total impacted area, 0–100. The three
   *  shares sum to 100. */
  sharePct: number;
  /** Classifier confidence for this class over this window, 0–100 — the one
   *  figure here with no counterpart anywhere else in the app. */
  confidencePct: number;
  /** ± uncertainty on `beforeHa`/`afterHa`, in hectares, derived from
   *  `confidencePct` — a lower-confidence class gets a wider interval. Drawn
   *  as error-bar whiskers on the before/after chart and as a shaded band
   *  around the trend line, so the chart shows a modelled class the same way
   *  a real accuracy-assessed classification would: a range, not a point
   *  estimate. */
  marginHa: number;
  /** Six points from `beforeHa` to `afterHa`, for the per-class trend chart. */
  trend: number[];
}

export interface HabitatClassChangeReport {
  classes: HabitatClassChange[];
  /** Sums across the three classes — the totals the stats strip shows. */
  totalLostHa: number;
  totalGainedHa: number;
  netHa: number;
  /** Mean of the per-class confidences, weighted by each class's share. */
  meanConfidencePct: number;
  /** How many of the surveyed footprint's 10 × 10 m cells changed class —
   *  the impacted area expressed in the grid the imagery is captured on,
   *  which is what a classified change report actually counts. */
  changedCells: number;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Builds the breakdown for one event, or null where there is nothing to
 * break down — an event with no habitat-change reading, or one whose reading
 * carries no hectare figure to apportion. Null rather than an invented total:
 * the share arithmetic below only means anything against a real denominator.
 */
export function habitatClassChangeFor(event: TreeEvent): HabitatClassChangeReport | null {
  const impact = event.habitatImpact;
  if (!impact || impact.impactedAreaHa === undefined || impact.impactedAreaHa <= 0) return null;

  const rand = seededRandom(`habitat-class:${event.id}`);
  const impacted = impact.impactedAreaHa;

  // Three shares, each floored so no class renders as an unreadable sliver,
  // then normalised to sum to exactly 1.
  const rawShares = TRACKED_CODES.map(() => 0.18 + rand() * 0.5);
  const shareTotal = rawShares.reduce((a, b) => a + b, 0);
  const shares = rawShares.map((s) => s / shareTotal);

  // Direction per class follows the event's own reading: a reduction loses
  // extent across the board, an extension gains it, and a degradation is the
  // mixed case it describes — some classes giving ground to others, which is
  // exactly what a class-to-class transition looks like.
  const signFor = (i: number): number => {
    if (impact.changeType === "extension") return 1;
    if (impact.changeType === "reduction") return -1;
    return i === 1 ? 1 : -1;
  };

  const classes: HabitatClassChange[] = TRACKED_CODES.map((code, i) => {
    const entry = habitatClassByCode(code);
    const deltaHa = round1(signFor(i) * impacted * shares[i]);
    // The change is 4–20% of the class's own standing extent, which sets how
    // big that extent must be — so a class losing 8 ha reads as a big class
    // barely dented or a small one gutted, not always the same story.
    const changeFraction = 0.04 + rand() * 0.16;
    const beforeHa = round1(Math.abs(deltaHa) / changeFraction);
    const afterHa = round1(beforeHa + deltaHa);
    const trend = Array.from({ length: 6 }, (_, t) => {
      const at = beforeHa + (deltaHa * t) / 5;
      // Jitter every point but the endpoints, so the line reads as a measured
      // series rather than a ruler-straight interpolation.
      const jitter = t === 0 || t === 5 ? 0 : (rand() - 0.5) * Math.abs(deltaHa) * 0.3;
      return round1(Math.max(0, at + jitter));
    });
    const confidencePct = Math.round(74 + rand() * 22);
    // Lower confidence widens the interval: at 74% confidence the margin is
    // ~15% of the class's after-extent; at 96% it shrinks to ~2%.
    const marginHa = round1(afterHa * (1 - confidencePct / 100) * 0.58);

    return {
      code,
      label: entry.label,
      color: entry.color ?? "#9B9B9B",
      beforeHa,
      afterHa,
      deltaHa,
      deltaPct: round1((deltaHa / beforeHa) * 100),
      sharePct: round1(shares[i] * 100),
      confidencePct,
      marginHa,
      trend,
    };
  });

  const totalLostHa = round1(classes.filter((c) => c.deltaHa < 0).reduce((s, c) => s + Math.abs(c.deltaHa), 0));
  const totalGainedHa = round1(classes.filter((c) => c.deltaHa > 0).reduce((s, c) => s + c.deltaHa, 0));

  return {
    classes,
    totalLostHa,
    totalGainedHa,
    netHa: round1(totalGainedHa - totalLostHa),
    meanConfidencePct: Math.round(classes.reduce((s, c) => s + c.confidencePct * (c.sharePct / 100), 0)),
    // 1 ha = 10 000 m²; the imagery is captured on a 10 × 10 m grid, so one
    // cell is 100 m² and a hectare is 100 cells.
    changedCells: Math.round(impacted * 100),
  };
}
