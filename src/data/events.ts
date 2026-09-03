import type { MapOverlay } from "./overlays";
import { pickWeighted, seededRandom } from "./random";
import { speciesLabel } from "./scatterLayout";
import { generateTreeRecords, type TreeRecord } from "./trees";
import type { DateRange } from "./aggregate";
import type { HealthKey, MonthSnapshot, SpeciesKey } from "./types";

export type EventKind = "survey" | "decline" | "milestone";

export interface TreeEvent {
  id: string;
  monthIndex: number;
  date: Date;
  kind: EventKind;
  title: string;
  description: string;
  species: SpeciesKey;
  severity: HealthKey;
  /** The real tree this event is about — see generateEvents for why this must
   * come from the same pool the map and table use, not a fabricated string. */
  tree: TreeRecord;
}

// A "recent events" feed reading a future date is jarring, and the last
// snapshot in the window is always the current, still-in-progress month — so
// that month's events must never land after today.
function randomDayInMonth(monthDate: Date, rand: () => number, today: Date): Date {
  const isCurrentMonth = monthDate.getFullYear() === today.getFullYear() && monthDate.getMonth() === today.getMonth();
  const daysInMonth = isCurrentMonth
    ? today.getDate()
    : new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  return new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 + Math.floor(rand() * daysInMonth));
}

const SPECIES_KEY_BY_LABEL: Record<string, SpeciesKey> = {
  [speciesLabel.ghaf]: "ghaf",
  [speciesLabel.sidr]: "sidr",
  [speciesLabel.palm]: "palm",
};

const HEALTH_KEY_BY_LABEL: Record<TreeRecord["health"], HealthKey> = {
  Healthy: "healthy",
  Stressed: "stressed",
  Declining: "declining",
  Dead: "dead",
};

/**
 * Picks the real tree an event is "about", from that month's slice of the
 * shared tree pool. Tries progressively looser matches against the narrative
 * so the pick reads as plausible (a "decline flagged" event lands on an
 * actually-declining tree of the species mentioned) without ever failing —
 * the loosest fallback is just "any tree surveyed that month".
 */
function pickTreeForEvent(
  monthRecords: TreeRecord[],
  rand: () => number,
  wantSpecies: SpeciesKey,
  wantHealth?: HealthKey,
): TreeRecord {
  const bySpeciesAndHealth = wantHealth
    ? monthRecords.filter((t) => SPECIES_KEY_BY_LABEL[t.species] === wantSpecies && HEALTH_KEY_BY_LABEL[t.health] === wantHealth)
    : [];
  const bySpecies = monthRecords.filter((t) => SPECIES_KEY_BY_LABEL[t.species] === wantSpecies);
  const byHealth = wantHealth ? monthRecords.filter((t) => HEALTH_KEY_BY_LABEL[t.health] === wantHealth) : [];
  const pool = bySpeciesAndHealth.length ? bySpeciesAndHealth : bySpecies.length ? bySpecies : byHealth.length ? byHealth : monthRecords;
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * Synthesizes a feed of discrete field events — surveys, flagged declines,
 * canopy-cover milestones — from the same monthly snapshots that back the
 * charts, so the dashboard has a human-readable narrative next to the
 * aggregates rather than a second, disconnected dataset. Seeded per area, so
 * it's stable across reloads but distinct per area (same discipline as
 * treePins.ts).
 *
 * Each event carries a real `tree` record from `generateTreeRecords` — the
 * exact pool the map's pins and the Areas table are built from — rather than
 * a fabricated ID string. That's what lets "open this event" jump the map to
 * an actual point on the imagery: earlier, `treeId()` here returned a random
 * string with no lng/lat behind it, so the same event could never be more
 * than text. Calling `generateTreeRecords` again with the same
 * (overlay, areaId, snapshots) is safe and free of drift: it's a pure
 * function of a seeded PRNG, so this reproduces byte-for-byte the same pool
 * AreasView built, without the two needing to share state.
 *
 * Decline events lean heavily on the early, degraded months and milestones
 * cluster later, mirroring the recovery curve in monthlySnapshots.ts — the
 * feed tells the same story the charts do, just at the level of one tree.
 */
export function generateEvents(overlay: MapOverlay, snapshots: MonthSnapshot[], areaId: string): TreeEvent[] {
  const rand = seededRandom(`events:${areaId}`);
  const today = new Date();
  const events: TreeEvent[] = [];
  const allRecords = generateTreeRecords(overlay, areaId, snapshots);

  snapshots.forEach((month, monthIndex) => {
    const prev = monthIndex > 0 ? snapshots[monthIndex - 1] : null;
    const monthRecords = allRecords.filter((t) => t.monthIndex === monthIndex);
    if (monthRecords.length === 0) return;

    const surveySpecies = pickWeighted(rand, month.speciesCounts);
    events.push({
      id: `${areaId}-survey-${monthIndex}`,
      monthIndex,
      date: randomDayInMonth(month.date, rand, today),
      kind: "survey",
      title: "Field survey completed",
      description: `${month.newTreesLogged.toLocaleString()} ${speciesLabel[surveySpecies].toLowerCase()} logged during the monthly walk-through.`,
      species: surveySpecies,
      severity: "healthy",
      tree: pickTreeForEvent(monthRecords, rand, surveySpecies, "healthy"),
    });

    const surveyed = month.speciesCounts.ghaf + month.speciesCounts.sidr + month.speciesCounts.palm;
    const atRisk = month.healthCounts.stressed + month.healthCounts.declining + month.healthCounts.dead;
    if (rand() < atRisk / surveyed) {
      const declineSpecies = pickWeighted(rand, {
        ghaf: month.scatterCounts.ghaf.declining + month.scatterCounts.ghaf.dead + 1,
        sidr: month.scatterCounts.sidr.declining + month.scatterCounts.sidr.dead + 1,
        palm: month.scatterCounts.palm.declining + month.scatterCounts.palm.dead + 1,
      });
      const severity: HealthKey = rand() < 0.35 ? "dead" : "declining";
      const tree = pickTreeForEvent(monthRecords, rand, declineSpecies, severity);
      events.push({
        id: `${areaId}-decline-${monthIndex}`,
        monthIndex,
        date: randomDayInMonth(month.date, rand, today),
        kind: "decline",
        title: severity === "dead" ? "Tree confirmed dead" : "Canopy decline flagged",
        description: `${speciesLabel[declineSpecies]} tree ${tree.id} showing ${
          severity === "dead" ? "no live canopy" : "significant crown thinning"
        } on inspection.`,
        species: declineSpecies,
        severity,
        tree,
      });
    }

    // A milestone fires each time plot-wide canopy cover crosses a 5-point band.
    if (prev && Math.floor(month.canopyCoverPct / 5) > Math.floor(prev.canopyCoverPct / 5)) {
      const recoverSpecies = pickWeighted(rand, month.speciesCounts);
      events.push({
        id: `${areaId}-milestone-${monthIndex}`,
        monthIndex,
        date: randomDayInMonth(month.date, rand, today),
        kind: "milestone",
        title: "Canopy cover milestone",
        description: `Plot-wide canopy cover crossed ${
          Math.floor(month.canopyCoverPct / 5) * 5
        }% — ${speciesLabel[recoverSpecies].toLowerCase()} leading the recovery this month.`,
        species: recoverSpecies,
        severity: "healthy",
        tree: pickTreeForEvent(monthRecords, rand, recoverSpecies, "healthy"),
      });
    }
  });

  return events.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function eventsInRange(events: TreeEvent[], range: DateRange): TreeEvent[] {
  return events.filter((e) => e.monthIndex >= range.startIndex && e.monthIndex <= range.endIndex);
}
