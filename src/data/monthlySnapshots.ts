import { clamp01, lerp, seededRandom } from "./random";
import type { CrownKey, DiameterKey, HealthKey, HeightKey, MonthSnapshot, SpeciesKey } from "./types";

const MONTHS_BACK = 12;

/**
 * The dataset tells one story: a badly degraded plot brought back under active
 * restoration. The oldest month in the 12-month window is the worst the site
 * ever looked — a third of the trees dead or declining, a thin crown, bare
 * ground. The newest month is the best.
 *
 * Every distribution is interpolated between an explicit "before" mix and an
 * "after" mix rather than nudged by a per-category slope. Two reasons:
 *
 *  1. The swing is unmissable. Drag the timeline to the early months and the
 *     health donut is dominated by Declining and Dead; drag it to the recent
 *     ones and it is dominated by Healthy. A slope-based drift only ever moved
 *     the mix a few points.
 *  2. The numbers stay internally consistent. `scatterCounts` is the source of
 *     truth — a species × health matrix — and both `speciesCounts` and
 *     `healthCounts` are its margins, so the two donuts and the "Health per
 *     species" bubbles can never disagree.
 *
 * To retell the story differently, edit the mixes below; nothing else needs to
 * change.
 */

type Mix<K extends string> = Record<K, number>;

/** Fraction of the recovery completed, 0 at the oldest month and 1 at the newest. */
function progressAt(monthsElapsed: number): number {
  const t = monthsElapsed / (MONTHS_BACK - 1);
  // Smoothstep: the site is slow to turn around, improves fastest mid-window,
  // then plateaus — a more believable curve than a straight line.
  return t * t * (3 - 2 * t);
}

function mixAt<K extends string>(start: Mix<K>, end: Mix<K>, t: number): Mix<K> {
  const out = {} as Mix<K>;
  (Object.keys(start) as K[]).forEach((key) => {
    out[key] = lerp(start[key], end[key], t);
  });
  return out;
}

/** Splits a population across a mix, with a little noise so it doesn't look synthetic. */
function distribute<K extends string>(
  rand: () => number,
  total: number,
  mix: Mix<K>,
  noise = 0.12,
): Mix<K> {
  const out = {} as Mix<K>;
  (Object.keys(mix) as K[]).forEach((key) => {
    out[key] = Math.max(0, Math.round(total * mix[key] * (1 + (rand() - 0.5) * noise)));
  });
  return out;
}

// ── The story, as data ───────────────────────────────────────────────────────

// Trees surveyed per month. The headcount only drifts; it's the *mix* that swings.
const POPULATION_START = 980;
const POPULATION_END = 1240;

// Trees newly logged each month — the survey effort ramps up with the programme.
const LOGGED_START = 140;
const LOGGED_END = 380;

// Canopy cover is the headline recovery metric: bare ground to closed canopy.
const CANOPY_START_PCT = 12.5;
const CANOPY_END_PCT = 46;

/**
 * Per species: how much of the plot it makes up, and how its own health mix
 * moves. `lag` delays a species' recovery relative to the plot's — irrigation
 * reached the ghaf stands first and the palms were replanted last — so the
 * "Health per species" chart shows three different trajectories rather than one
 * curve drawn three times.
 */
const SPECIES_PLAN: Record<
  SpeciesKey,
  { shareStart: number; shareEnd: number; lag: number; start: Mix<HealthKey>; end: Mix<HealthKey> }
> = {
  ghaf: {
    shareStart: 0.34,
    shareEnd: 0.42,
    lag: 0,
    start: { healthy: 0.09, stressed: 0.27, declining: 0.37, dead: 0.27 },
    end: { healthy: 0.83, stressed: 0.12, declining: 0.04, dead: 0.01 },
  },
  sidr: {
    shareStart: 0.45,
    shareEnd: 0.37,
    lag: 0.15,
    start: { healthy: 0.13, stressed: 0.3, declining: 0.34, dead: 0.23 },
    end: { healthy: 0.76, stressed: 0.17, declining: 0.05, dead: 0.02 },
  },
  palm: {
    shareStart: 0.21,
    shareEnd: 0.21,
    lag: 0.35,
    start: { healthy: 0.07, stressed: 0.25, declining: 0.39, dead: 0.29 },
    end: { healthy: 0.61, stressed: 0.26, declining: 0.09, dead: 0.04 },
  },
};

// Crown radius buckets, b1 (thinnest) to b5 (fullest): thin, patchy crowns give
// way to full ones as the trees recover.
const CROWN_START: Mix<CrownKey> = { b1: 0.44, b2: 0.27, b3: 0.16, b4: 0.09, b5: 0.04 };
const CROWN_END: Mix<CrownKey> = { b1: 0.05, b2: 0.11, b3: 0.21, b4: 0.32, b5: 0.31 };

// Trunk diameter and height shift far less — trees can recover their canopy in a
// year, but they can't gain a size class. A modest drift keeps these honest.
const DIAMETER_START: Mix<DiameterKey> = { L: 0.22, M: 0.43, S: 0.35 };
const DIAMETER_END: Mix<DiameterKey> = { L: 0.32, M: 0.47, S: 0.21 };

const HEIGHT_START: Mix<HeightKey> = { h1: 0.46, h2: 0.36, h3: 0.18 };
const HEIGHT_END: Mix<HeightKey> = { h1: 0.29, h2: 0.4, h3: 0.31 };

// ── Generation ───────────────────────────────────────────────────────────────

function monthLabel(date: Date): string {
  const month = date.toLocaleString("en-US", { month: "short" });
  const year = String(date.getFullYear()).slice(-2);
  return `${month} '${year}`;
}

function buildMonth(monthsAgo: number, now: Date, scale: number, rand: () => number): MonthSnapshot {
  const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const monthsElapsed = MONTHS_BACK - 1 - monthsAgo;
  const t = progressAt(monthsElapsed);
  const population = lerp(POPULATION_START, POPULATION_END, t) * scale;

  // scatterCounts is the species × health matrix everything else is derived from.
  const scatterCounts = {} as Record<SpeciesKey, Record<HealthKey, number>>;
  const speciesCounts = {} as Record<SpeciesKey, number>;
  const healthCounts: Record<HealthKey, number> = { healthy: 0, stressed: 0, declining: 0, dead: 0 };

  (Object.keys(SPECIES_PLAN) as SpeciesKey[]).forEach((species) => {
    const plan = SPECIES_PLAN[species];
    // Re-base the plot's progress onto this species' own, delayed timeline.
    const speciesT = clamp01((t - plan.lag) / (1 - plan.lag));
    const counts = distribute(
      rand,
      population * lerp(plan.shareStart, plan.shareEnd, t),
      mixAt(plan.start, plan.end, speciesT),
    );
    scatterCounts[species] = counts;
    speciesCounts[species] = counts.healthy + counts.stressed + counts.declining + counts.dead;
    (Object.keys(counts) as HealthKey[]).forEach((key) => {
      healthCounts[key] += counts[key];
    });
  });

  const surveyed = speciesCounts.ghaf + speciesCounts.sidr + speciesCounts.palm;

  return {
    label: monthLabel(date),
    date,
    newTreesLogged: Math.round(lerp(LOGGED_START, LOGGED_END, t) * scale * (1 + (rand() - 0.5) * 0.15)),
    canopyCoverPct: lerp(CANOPY_START_PCT, CANOPY_END_PCT, t) + (rand() - 0.5) * 1.2,
    speciesCounts,
    healthCounts,
    diameterCounts: distribute(rand, surveyed, mixAt(DIAMETER_START, DIAMETER_END, t)),
    heightCounts: distribute(rand, surveyed, mixAt(HEIGHT_START, HEIGHT_END, t)),
    crownCounts: distribute(rand, surveyed, mixAt(CROWN_START, CROWN_END, t)),
    scatterCounts,
  };
}

/**
 * Rolling 12-month window ending this month, oldest first. `scale` lets each
 * area (see areas.ts) get a proportionally different plot size, and `seed` keeps
 * every area's noise distinct but reproducible across reloads.
 */
export function generateMonthlySnapshots(scale = 1, seed = "area"): MonthSnapshot[] {
  const now = new Date();
  const rand = seededRandom(`${seed}:${scale}`);
  return Array.from({ length: MONTHS_BACK }, (_, i) => buildMonth(MONTHS_BACK - 1 - i, now, scale, rand));
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
