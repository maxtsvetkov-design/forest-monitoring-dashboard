/**
 * The Crab-plover census for Abu Al Abyad.
 *
 * Abu Al Abyad is a coastal island, not a planted forest, and nothing about
 * the tree population applies to it: `treePopulation.ts` places every tree in
 * the shared drone frame's image space, so on this site's own 14 km coastal
 * captures those positions describe open water (see `areaHasOwnImagery`). What
 * a site like this is actually surveyed for is shorebirds, and the Crab-plover
 * (*Dromas ardeola*, the only member of the family Dromadidae) is the one worth
 * counting here — a Gulf breeding specialist that nests colonially in burrows
 * dug into sandbanks and feeds almost exclusively on crabs.
 *
 * WHAT IS REAL AND WHAT IS NOT, because this is generated data and the rest of
 * this app is careful about the difference:
 *
 * - The species, its family, its burrow-nesting habit and its diet are facts.
 * - The survey rectangles below are placed by hand over the sandbank and
 *   shallow-water ground visible in this area's own captures, so a bird sits
 *   where a Crab-plover plausibly would rather than inland or out at sea.
 * - Every individual bird — its ring id, age class, what it was doing — is
 *   SYNTHETIC, seeded from the area id exactly as `treePopulation.ts` seeds
 *   its trees. It is reproducible, not observed. No real colony was counted.
 *
 * Rows are individuals rather than a per-rectangle total on purpose: a census
 * that reports "20 birds in block 3" cannot be checked, whereas a list of
 * twenty ringed individuals can be read down and argued with — which is the
 * same reason this app made the tree population, not the monthly aggregates,
 * its source of truth.
 */

import { seededRandom } from "./random";

/** Birds listed per survey rectangle. A round number, and stated here rather
 *  than varied per rectangle, because it is a survey design (twenty birds
 *  counted per block) and not a measurement. Since only one rectangle is
 *  surveyed (see `CRAB_PLOVER_RECTS`), this is the whole census. */
const BIRDS_PER_RECT = 100;

export interface SurveyRect {
  id: string;
  label: string;
  /** Bounds in the capture's own normalised space — 0→1 left→right and
   *  top→bottom, the same u/v every overlay-anchored thing in this app uses. */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** What the ground inside it is, in the captures. Carried so the table can
   *  say why a rectangle is where it is instead of leaving it unexplained. */
  habitat: string;
}

/**
 * The drawn rectangle, over ground the captures actually show as sand cay and
 * burrow ground — the one block this species actually colonises densely, so
 * the census is surveyed there rather than spread thin across the whole
 * island.
 */
export const CRAB_PLOVER_RECTS: SurveyRect[] = [
  { id: "cp-3", label: "North cay", uMin: 0.58, uMax: 0.72, vMin: 0.24, vMax: 0.36, habitat: "Sand cay, burrow ground" },
];

/**
 * The rocky outcrop west of the main cay, over open water on this area's own
 * captures. Kept out of `CRAB_PLOVER_RECTS` deliberately: it is not a
 * standing survey block with its own always-counted roster, it is a spot a
 * few birds from the North cay colony are drifting to over the timeline — so
 * it has no fixed count of its own and shouldn't render as an empty "0 birds"
 * block in the census table the way a real `SurveyRect` would.
 */
export const WEST_REEF_ZONE = {
  id: "west-reef",
  label: "West reef",
  habitat: "Rocky outcrop, offshore of the cay",
  uMin: 0.05,
  uMax: 0.16,
  vMin: 0.34,
  vMax: 0.48,
};

/** Age classes, worst-to-best is meaningless here — this is not a condition
 *  scale, it is what the observer could tell from the bird. */
export type PloverAge = "adult" | "immature" | "juvenile";

export const PLOVER_AGE_LABEL: Record<PloverAge, string> = {
  adult: "Adult",
  immature: "Immature",
  juvenile: "Juvenile",
};

/**
 * Shares by age class. Weighted towards adults because the Gulf colonies are
 * adult-dominated outside the short fledging window — a plausible shape for a
 * census, and the reason it is stated here rather than left to a flat draw.
 */
const AGE_SHARE: { key: PloverAge; share: number }[] = [
  { key: "adult", share: 0.68 },
  { key: "immature", share: 0.2 },
  { key: "juvenile", share: 0.12 },
];

/** What the bird was doing when counted. Behaviours a Crab-plover survey
 *  actually distinguishes, which is what makes the column worth a look. */
export type PloverActivity = "foraging" | "roosting" | "at burrow" | "in flight";

const ACTIVITY_SHARE: { key: PloverActivity; share: number }[] = [
  { key: "foraging", share: 0.4 },
  { key: "roosting", share: 0.3 },
  { key: "at burrow", share: 0.18 },
  { key: "in flight", share: 0.12 },
];

export interface CrabPlover {
  /** Ring id. Synthetic, like every tree id in this app. */
  id: string;
  rectId: string;
  rectLabel: string;
  habitat: string;
  age: PloverAge;
  activity: PloverActivity;
  /** Position inside its rectangle, in the capture's u/v space — so a row can
   *  be pointed at on the imagery rather than only counted. */
  u: number;
  v: number;
  /** Index of the month this individual was last recorded in. */
  lastSeenMonth: number;
  /** The capture index (0-based, matching the imagery timeline) at or after
   *  which this bird shows up at `WEST_REEF_ZONE` instead of home. `null` for
   *  a bird that never leaves — most of the colony. */
  migrateAtCapture: number | null;
  /** Where in `WEST_REEF_ZONE` this bird sits, once migrated. Only meaningful
   *  when `migrateAtCapture` is set. */
  zoneU: number;
  zoneV: number;
}

/** How many additional birds join `WEST_REEF_ZONE` at each capture, indexed
 *  by capture number. Capture 0 is the baseline — nobody has moved yet — so
 *  it stays 0; each capture after it adds one or two more, cumulatively. */
export const WEST_REEF_ARRIVALS: readonly number[] = [0, 1, 2, 1, 2];

function pick<T extends { share: number }>(rand: () => number, table: T[]): T {
  let roll = rand();
  for (const entry of table) {
    roll -= entry.share;
    if (roll <= 0) return entry;
  }
  return table[table.length - 1];
}

/**
 * Builds the census. Deterministic in `(areaId, monthCount)`, so the table, a
 * marker on the imagery and any tally over them are three views of one list
 * and cannot disagree — the same contract `getPopulation` holds for trees.
 */
function build(areaId: string, monthCount: number): CrabPlover[] {
  const rand = seededRandom(`crab-plover:${areaId}`);
  const birds: CrabPlover[] = [];

  CRAB_PLOVER_RECTS.forEach((rect, rectIndex) => {
    for (let i = 0; i < BIRDS_PER_RECT; i++) {
      const age = pick(rand, AGE_SHARE).key;
      const activity = pick(rand, ACTIVITY_SHARE).key;
      birds.push({
        // Zero-padded to 3 digits (the block now holds up to 100 birds, which
        // a 2-digit pad would wrap at) so the column still sorts as text.
        id: `CP-${rectIndex + 1}${String(i + 1).padStart(3, "0")}`,
        rectId: rect.id,
        rectLabel: rect.label,
        habitat: rect.habitat,
        age,
        activity,
        u: rect.uMin + rand() * (rect.uMax - rect.uMin),
        v: rect.vMin + rand() * (rect.vMax - rect.vMin),
        // Weighted towards the recent end: a census is a record of what is
        // still being seen, and a list where a third of the birds were last
        // recorded a year ago would be a history, not a count.
        lastSeenMonth: Math.min(monthCount - 1, Math.floor(monthCount - 1 - rand() * rand() * (monthCount - 1))),
        migrateAtCapture: null,
        zoneU: 0,
        zoneV: 0,
      });
    }
  });

  // Pick a handful of birds to drift out to `WEST_REEF_ZONE` over the
  // timeline, one or two more with every capture after the first. Selected
  // without replacement so the same bird can't be assigned twice, and after
  // the main loop so it doesn't disturb the per-bird draws above.
  const totalMigrants = WEST_REEF_ARRIVALS.reduce((sum, n) => sum + n, 0);
  const pool = birds.map((_, i) => i);
  const chosen: number[] = [];
  for (let n = 0; n < totalMigrants && pool.length > 0; n++) {
    const idx = Math.floor(rand() * pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  let cursor = 0;
  WEST_REEF_ARRIVALS.forEach((arrivals, captureIndex) => {
    for (let n = 0; n < arrivals; n++) {
      const bird = birds[chosen[cursor]];
      cursor++;
      if (!bird) return;
      bird.migrateAtCapture = captureIndex;
      bird.zoneU = WEST_REEF_ZONE.uMin + rand() * (WEST_REEF_ZONE.uMax - WEST_REEF_ZONE.uMin);
      bird.zoneV = WEST_REEF_ZONE.vMin + rand() * (WEST_REEF_ZONE.vMax - WEST_REEF_ZONE.vMin);
    }
  });

  return birds;
}

/** How far a bird still at home is allowed to sway between captures, in u/v
 *  units. Small relative to a survey rectangle (~0.14 wide, ~0.12 tall) — this
 *  is a bird shifting position within the block it was counted in, not
 *  wandering to a new one. Clamped to the rectangle below, so it can never
 *  read as having left. */
const HOME_JITTER = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Where a bird actually is for a given capture — home (with a small sway so
 * the colony doesn't look frozen between captures), or `WEST_REEF_ZONE` once
 * its migration capture has arrived. The single place this decision is made,
 * so the map markers, the block labels and any future summary agree.
 */
export function birdPlacement(
  bird: CrabPlover,
  captureIndex: number,
): { u: number; v: number; zoneId: string; zoneLabel: string } {
  if (bird.migrateAtCapture !== null && captureIndex >= bird.migrateAtCapture) {
    return { u: bird.zoneU, v: bird.zoneV, zoneId: WEST_REEF_ZONE.id, zoneLabel: WEST_REEF_ZONE.label };
  }
  // Seeded on (bird id, capture): the same bird lands on the same spot if you
  // revisit the same capture, but a different spot each time the timeline
  // moves — a still colony would be more suspicious than a swaying one.
  const jitter = seededRandom(`plover-sway:${bird.id}:${captureIndex}`);
  const dx = (jitter() - 0.5) * 2 * HOME_JITTER;
  const dy = (jitter() - 0.5) * 2 * HOME_JITTER;
  const rect = CRAB_PLOVER_RECTS.find((r) => r.id === bird.rectId);
  const u = rect ? clamp(bird.u + dx, rect.uMin, rect.uMax) : bird.u + dx;
  const v = rect ? clamp(bird.v + dy, rect.vMin, rect.vMax) : bird.v + dy;
  return { u, v, zoneId: bird.rectId, zoneLabel: bird.rectLabel };
}

const cache = new Map<string, CrabPlover[]>();

export function getCrabPlovers(areaId: string, monthCount: number): CrabPlover[] {
  const key = `${areaId}:${monthCount}`;
  let found = cache.get(key);
  if (!found) {
    found = build(areaId, monthCount);
    cache.set(key, found);
  }
  return found;
}

/** Which areas are surveyed for Crab-plover rather than trees. A registry
 *  rather than a hardcoded id test, so a second coastal site is a one-line
 *  addition. */
const CENSUS_AREAS = new Set(["abu-al-abyad"]);

export function hasCrabPloverCensus(areaId: string | undefined): boolean {
  return !!areaId && CENSUS_AREAS.has(areaId);
}
