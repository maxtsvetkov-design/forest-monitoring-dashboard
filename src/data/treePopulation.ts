// THE dataset. One fixed population of individually-identified trees per area,
// each carrying a month-by-month vigour timeline. Everything else in the app —
// the monthly aggregate snapshots, the donuts, the table rows, the map pins,
// the events feed — is a projection of this, never a second roll of the dice.
//
// This inverts what the app used to do. Previously monthlySnapshots.ts invented
// aggregate counts per month and trees.ts drew a fresh batch of eight trees
// *from* those counts, which meant no tree persisted from one month to the
// next: "AL-113" in January and "AL-113" in June were unrelated rows that
// happened to share an id, and the plot's own totals were a separate fiction on
// top. Here the trees are real and permanent, and the aggregates are simply
// counted off them, so the two cannot disagree — there is nothing to keep in
// sync because there is only one thing.
//
// The story the numbers tell:
//   • Month 0 is overwhelmingly fine, not badly degraded: at Al Maha's own
//     size, just 4 trees start Moderate and 3 start Sparse, out of 340 —
//     everyone else is already Normal or Vigorous. A restoration plot a year
//     in has a small standing handful of problem trees, not a plot-wide
//     collapse.
//   • Every tree improves for the first several months, at a pace set by its
//     species (see SpeciesInfo.lag) — the handful of standing problem trees
//     recover into the rest of the plot, and the already-healthy majority
//     holds or climbs a little further, plateauing as the decline window
//     opens.
//   • Trees standing inside the zones traced in al-maha-generative_red.png then
//     decline hard over the final three months, while the rest of the plot
//     holds. That is what the red overlay is *for*: it marks the part of the
//     site that is failing, so a tree's fate follows from where it stands
//     rather than being sprinkled at random.

import { clamp01, lerp, seededRandom } from "./random";
import {
  conditionForVigour,
  SPECIES,
  speciesInfo,
  type ConditionKey,
  type SpeciesKey,
} from "./taxonomy";
import type { CrownKey, DiameterKey } from "./types";

/** Length of the rolling window every area is modelled over. */
export const MONTHS_BACK = 12;

/**
 * How many of the final months the red-zone decline covers. The brief is "the
 * last 3 months start to degrade", so months 9, 10 and 11 of a 12-month window.
 */
export const DECLINE_MONTHS = 3;

/** Trees in an area at `scale` 1. Each area scales this by its own plot size. */
const POPULATION_AT_SCALE_1 = 340;

/**
 * Rectangles in the overlay image's own u/v space covering where
 * al-maha-generative_red.png actually paints dieback, weighted by how dense the
 * red trace is in each. A tree inside one of these is on the failing ground.
 *
 * These moved here from trees.ts, where they used to *place* already-sick trees
 * (the aggregate said "seven trees are dying this month", and the hotspots
 * decided where to draw them). Now they run the other way round: position is
 * assigned first and independently, and standing in a hotspot is what makes a
 * tree decline. Cause before effect, which is why the decline reads as a real
 * spatial pattern rather than a scatter that happens to match a picture.
 */
const DECLINE_ZONES: { uMin: number; uMax: number; vMin: number; vMax: number; severity: number }[] = [
  { uMin: 0.38, uMax: 0.8, vMin: 0.02, vMax: 0.24, severity: 1 },
  { uMin: 0.62, uMax: 1.0, vMin: 0.68, vMax: 0.97, severity: 1 },
  { uMin: 0.9, uMax: 1.0, vMin: 0.0, vMax: 0.2, severity: 0.75 },
  { uMin: 0.22, uMax: 0.43, vMin: 0.26, vMax: 0.37, severity: 0.7 },
  { uMin: 0.34, uMax: 0.43, vMin: 0.54, vMax: 0.68, severity: 0.7 },
];

/** How hard the failing ground bites, as a share of vigour removed by the final
 * month at severity 1. Tuned so a healthy-looking zone visibly collapses into
 * Sparse/Defoliated rather than merely dimming a shade. */
const DECLINE_DEPTH = 0.78;

/** Returns the decline severity at a point, 0 outside every zone. */
function declineSeverityAt(u: number, v: number): number {
  let worst = 0;
  for (const zone of DECLINE_ZONES) {
    if (u >= zone.uMin && u <= zone.uMax && v >= zone.vMin && v <= zone.vMax) {
      worst = Math.max(worst, zone.severity);
    }
  }
  return worst;
}

/** Which DECLINE_ZONES rectangle (by index into that array) a point falls in —
 * the worst-severity one, matching declineSeverityAt — or null outside every
 * zone. Lets the events feed report "block 2 lost 4 trees this month" instead
 * of one plot-wide decline event, since each zone is a distinct dieback block
 * on the ground. */
function declineZoneAt(u: number, v: number): number | null {
  let bestIndex: number | null = null;
  let bestSeverity = 0;
  DECLINE_ZONES.forEach((zone, index) => {
    if (u >= zone.uMin && u <= zone.uMax && v >= zone.vMin && v <= zone.vMax && zone.severity >= bestSeverity) {
      bestSeverity = zone.severity;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export interface PopulationTree {
  id: string;
  species: SpeciesKey;
  /** Position in the overlay image's own space: 0→1 left→right, 0→1 top→bottom.
   * Geography-free on purpose — trees.ts projects these onto real coordinates
   * through whichever overlay an area happens to use, so the population itself
   * never depends on a map. */
  u: number;
  v: number;
  diameter: DiameterKey;
  /** Metres. Fixed for the tree's life: a year of irrigation grows a canopy
   * back, it does not change how tall the trunk already is. */
  height: number;
  /** How much this tree's ground is failing, 0 (fine) to 1 (worst of the red
   * zones). Derived once from u/v — see declineSeverityAt. */
  declineSeverity: number;
  /** Index into DECLINE_ZONES this tree stands in, or null outside every zone —
   * see declineZoneAt. Identifies which dieback block a decline belongs to. */
  declineZoneId: number | null;
  /** Vigour 0–1 for each month in the window, oldest first. Length MONTHS_BACK. */
  vigourByMonth: number[];
  /** `vigourByMonth` banded into the five-step scale, same length/order. */
  conditionByMonth: ConditionKey[];
  /** Crown radius in metres per month — grows with vigour, so a recovering tree
   * visibly fills out and a declining one thins. */
  crownRadiusByMonth: number[];
}

/** Smoothstep: slow to turn around, fastest in the middle, then plateauing. */
function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Metre bounds per crown bucket — must match CROWN_META's labels in aggregate.ts. */
export const CROWN_RANGE: Record<CrownKey, [number, number]> = {
  b1: [0, 0.2],
  b2: [0.2, 0.4],
  b3: [0.4, 0.6],
  b4: [0.6, 0.8],
  b5: [0.8, 1.2],
};

export function crownBucketFor(radius: number): CrownKey {
  if (radius < 0.2) return "b1";
  if (radius < 0.4) return "b2";
  if (radius < 0.6) return "b3";
  if (radius < 0.8) return "b4";
  return "b5";
}

const DIAMETER_KEYS: DiameterKey[] = ["L", "M", "S"];
/** Trunk-diameter class shares. Static across the window — see `height`. */
const DIAMETER_SHARE: Record<DiameterKey, number> = { L: 0.28, M: 0.45, S: 0.27 };

/** Height ranges in metres per diameter class, so a "L (>5 m)" tree can't read
 * 1.2 m tall — the kind of incoherence that makes a table look generated. */
const HEIGHT_RANGE: Record<DiameterKey, [number, number]> = {
  L: [5.5, 12],
  M: [2, 5.4],
  S: [0.5, 1.9],
};

/** Picks a key from a share map using one roll of `rand`. */
function pickShare<K extends string>(rand: () => number, shares: Record<K, number>, keys: K[]): K {
  let roll = rand();
  for (const key of keys) {
    roll -= shares[key];
    if (roll <= 0) return key;
  }
  return keys[keys.length - 1];
}

/**
 * Builds one area's population. Deterministic in `areaId` — every caller that
 * asks for the same area gets byte-identical trees, which is what lets the
 * table, the map and the events feed each call this independently and still
 * agree on every last tree.
 */
export function generatePopulation(scale: number, areaId: string): PopulationTree[] {
  const rand = seededRandom(`population:${areaId}`);
  const count = Math.max(40, Math.round(POPULATION_AT_SCALE_1 * scale));
  const prefix = areaId.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3);

  // Keep trees off the very edge so a 26×34px marker never overhangs the image.
  const inset = 0.05;
  const span = 1 - inset * 2;
  const rows = 14;

  const speciesKeys = SPECIES.map((s) => s.key);
  const speciesShare = Object.fromEntries(SPECIES.map((s) => [s.key, s.share])) as Record<SpeciesKey, number>;

  // A restoration plot a year in rarely starts either uniformly bad or
  // uniformly fine — it's overwhelmingly fine, with just a handful of standing
  // problem trees. At Al Maha's own size (POPULATION_AT_SCALE_1) that's 4
  // Moderate and 3 Sparse; scaled the same way `count` itself is, so a smaller
  // plot gets proportionally fewer rather than the same fixed 7.
  const moderateStartCount = Math.round((4 / POPULATION_AT_SCALE_1) * count);
  const sparseStartCount = Math.round((3 / POPULATION_AT_SCALE_1) * count);

  // Fisher–Yates over the tree indices, off the same seeded `rand` everything
  // else here draws from. Which trees start rough is otherwise unrelated to
  // their position (that's what the decline zones below are for) or species.
  const shuffledIndices = Array.from({ length: count }, (_, i) => i);
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }
  const sparseStartIds = new Set(shuffledIndices.slice(0, sparseStartCount));
  const moderateStartIds = new Set(shuffledIndices.slice(sparseStartCount, sparseStartCount + moderateStartCount));

  const trees: PopulationTree[] = [];

  for (let i = 0; i < count; i++) {
    // Planting rows with jitter — a restoration plot is planted on a grid, not
    // scattered. Position is drawn with no reference to health whatsoever;
    // whether this spot turns out to be failing ground is read back off it
    // afterwards.
    const row = i % rows;
    const rowJitter = (rand() - 0.5) * (span / rows) * 0.75;
    const v = clamp01(inset + (span * (row + 0.5)) / rows + rowJitter);
    const u = clamp01(inset + rand() * span);

    const species = pickShare(rand, speciesShare, speciesKeys);
    const diameter = pickShare(rand, DIAMETER_SHARE, DIAMETER_KEYS);
    const [minH, maxH] = HEIGHT_RANGE[diameter];
    const height = Math.round((minH + rand() * (maxH - minH)) * 10) / 10;

    const declineSeverity = declineSeverityAt(u, v);
    const declineZoneId = declineZoneAt(u, v);
    const { lag } = speciesInfo(species);

    // A stable per-tree constitution: some individuals simply do better than
    // their neighbours all window long. Without this every tree of a species
    // traces the identical curve and the donut snaps between bands in one step
    // instead of shading across them.
    const vigourOffset = (rand() - 0.5) * 0.26;
    // How badly this individual takes the failing ground. Varying it means a
    // red zone degrades into a believable mix — some trees defoliated, some
    // merely sparse — rather than every tree in the rectangle flipping at once.
    const declineSensitivity = 0.55 + rand() * 0.75;

    // Starting point (month 0). Effective month-0 vigour is `startVigour +
    // vigourOffset` (see the per-month loop below), so `vigourOffset` is
    // subtracted back out here before a small band-local jitter is added —
    // that's what lands a tree in its assigned starting band regardless of
    // which constitution offset it happened to draw, rather than the offset
    // blowing a tree past the count the brief asked for.
    let startVigour: number;
    if (sparseStartIds.has(i)) {
      startVigour = clamp01(0.3 - vigourOffset + (rand() - 0.5) * 0.06); // Sparse: [0.2, 0.42)
    } else if (moderateStartIds.has(i)) {
      startVigour = clamp01(0.52 - vigourOffset + (rand() - 0.5) * 0.06); // Moderate: [0.42, 0.62)
    } else {
      startVigour = clamp01(0.75 - vigourOffset + (rand() - 0.5) * 0.26); // Normal/Vigorous
    }
    const endVigour = 0.74 + rand() * 0.24;

    const vigourByMonth: number[] = [];
    const conditionByMonth: ConditionKey[] = [];
    const crownRadiusByMonth: number[] = [];

    for (let m = 0; m < MONTHS_BACK; m++) {
      // Recovery, delayed by the species' own lag, and reaching its plateau as
      // the decline window opens rather than at the very last month.
      //
      // That plateau is load-bearing for the story, not a cosmetic choice. If
      // the healthy majority is still climbing steeply through the final three
      // months, its gains cancel the dieback out in every plot-wide average —
      // canopy cover and the health score keep rising and the dashboard reads
      // "still recovering" even as a quarter of the site collapses. Letting the
      // programme's gains level off first (which is also what a real
      // restoration curve does) leaves the red zones as the only thing still
      // moving, so the headline metrics turn over exactly when they should.
      const recoveryEnd = MONTHS_BACK - 1 - DECLINE_MONTHS;
      const raw = clamp01(m / recoveryEnd);
      const lagged = lag >= 1 ? 0 : clamp01((raw - lag) / (1 - lag));
      let vigour = lerp(startVigour, endVigour, smoothstep(lagged)) + vigourOffset;

      // …then the last three months, on failing ground only.
      const monthsIntoDecline = m - (MONTHS_BACK - DECLINE_MONTHS);
      if (declineSeverity > 0 && monthsIntoDecline >= 0) {
        // Ramp across the decline window (1/3, 2/3, 3/3) rather than a step, so
        // the collapse plays out as the timeline is dragged instead of
        // appearing all at once in the final frame.
        const progress = (monthsIntoDecline + 1) / DECLINE_MONTHS;
        vigour -= DECLINE_DEPTH * declineSeverity * declineSensitivity * progress;
      }

      vigour = clamp01(vigour);
      vigourByMonth.push(vigour);
      conditionByMonth.push(conditionForVigour(vigour));
      // Crown follows vigour, with a floor: even a defoliated tree still has a
      // measurable crown radius.
      crownRadiusByMonth.push(Math.round((0.06 + vigour * 1.06) * 100) / 100);
    }

    trees.push({
      id: `${prefix}-${String(1001 + i)}`,
      species,
      u,
      v,
      diameter,
      height,
      declineSeverity,
      declineZoneId,
      vigourByMonth,
      conditionByMonth,
      crownRadiusByMonth,
    });
  }

  return trees;
}

// Populations are pure functions of (scale, areaId) and are read by several
// independent modules on every render pass, so they're memoised here rather
// than each caller having to remember to wrap its own useMemo.
const cache = new Map<string, PopulationTree[]>();

export function getPopulation(scale: number, areaId: string): PopulationTree[] {
  const key = `${areaId}:${scale}`;
  let found = cache.get(key);
  if (!found) {
    found = generatePopulation(scale, areaId);
    cache.set(key, found);
  }
  return found;
}
