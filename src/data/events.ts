import type { MapOverlay } from "./overlays";
import { pickWeighted, seededRandom } from "./random";
import { speciesLabel } from "./scatterLayout";
import { CONDITIONS, CONDITION_LABEL, isFlaggedCondition, type ConditionKey } from "./taxonomy";
import { generateTreeRecordsAt, type TreeRecord } from "./trees";
import type { DateRange } from "./aggregate";
import type { MonthSnapshot, SpeciesKey } from "./types";

export type EventKind = "survey" | "decline" | "milestone";

export interface TreeEvent {
  id: string;
  monthIndex: number;
  date: Date;
  kind: EventKind;
  title: string;
  description: string;
  species: SpeciesKey;
  severity: ConditionKey;
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

/** Severity rank, worst = 0. Used to tell an improvement from a decline. */
const RANK: Record<ConditionKey, number> = Object.fromEntries(
  CONDITIONS.map((c, i) => [c.key, i]),
) as Record<ConditionKey, number>;

const SPECIES_KEY_BY_LABEL: Record<string, SpeciesKey> = Object.fromEntries(
  (Object.keys(speciesLabel) as SpeciesKey[]).map((key) => [speciesLabel[key], key]),
);

/**
 * Picks the real tree an event is "about", from that month's inventory. Tries
 * progressively looser matches against the narrative so the pick reads as
 * plausible (a "decline flagged" event lands on an actually-declining tree of
 * the species mentioned) without ever failing — the loosest fallback is just
 * "any tree standing that month".
 */
function pickTreeForEvent(
  monthRecords: TreeRecord[],
  rand: () => number,
  wantSpecies: SpeciesKey,
  wantCondition?: ConditionKey,
): TreeRecord {
  const bySpeciesAndCondition = wantCondition
    ? monthRecords.filter((t) => SPECIES_KEY_BY_LABEL[t.species] === wantSpecies && t.condition === wantCondition)
    : [];
  const bySpecies = monthRecords.filter((t) => SPECIES_KEY_BY_LABEL[t.species] === wantSpecies);
  const byCondition = wantCondition ? monthRecords.filter((t) => t.condition === wantCondition) : [];
  const pool = bySpeciesAndCondition.length
    ? bySpeciesAndCondition
    : bySpecies.length
      ? bySpecies
      : byCondition.length
        ? byCondition
        : monthRecords;
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * Synthesizes a feed of discrete field events — surveys, flagged declines,
 * canopy-cover milestones — off the same population that backs the charts, so
 * the dashboard has a human-readable narrative next to the aggregates rather
 * than a second, disconnected dataset. Seeded per area, so it's stable across
 * reloads but distinct per area.
 *
 * Every event carries a real `tree` record from the shared population — the
 * exact trees the map's pins and the Areas table are built from — rather than a
 * fabricated ID, which is what lets "open this event" jump the map to an actual
 * point on the imagery.
 *
 * Decline events are no longer a dice roll against an aggregate ratio. Because
 * the population persists month to month, this can compare each tree against
 * its own previous month and report a genuine transition: a specific, named
 * tree that really did drop a condition band. That is only expressible with a
 * stable population — with the old month-by-month resampling there was no
 * "same tree last month" to compare against, so the feed could only ever assert
 * a decline had happened somewhere and then go looking for a tree to blame.
 */
export function generateEvents(overlay: MapOverlay, snapshots: MonthSnapshot[], areaId: string, scale = 1): TreeEvent[] {
  const rand = seededRandom(`events:${areaId}`);
  const today = new Date();
  const events: TreeEvent[] = [];

  // One inventory per month, built once and reused — the pure, seeded
  // population means this reproduces exactly what AreasView and MapCanvas see.
  const byMonth = snapshots.map((_, monthIndex) =>
    generateTreeRecordsAt(overlay, areaId, snapshots, monthIndex, scale),
  );

  snapshots.forEach((month, monthIndex) => {
    const prev = monthIndex > 0 ? snapshots[monthIndex - 1] : null;
    const monthRecords = byMonth[monthIndex];
    if (monthRecords.length === 0) return;

    const surveySpecies = pickWeighted(rand, month.speciesCounts);
    events.push({
      id: `${areaId}-survey-${monthIndex}`,
      monthIndex,
      date: randomDayInMonth(month.date, rand, today),
      kind: "survey",
      title: "Field survey completed",
      description: `${month.newTreesLogged.toLocaleString()} trees re-surveyed during the monthly walk-through.`,
      species: surveySpecies,
      severity: "vigorous",
      tree: pickTreeForEvent(monthRecords, rand, surveySpecies, "vigorous"),
    });

    // Real transitions: trees that dropped at least one condition band since
    // last month. Compared per tree id, which the persistent population makes
    // possible.
    if (monthIndex > 0) {
      const prevById = new Map(byMonth[monthIndex - 1].map((r) => [r.id, r]));
      const dropped = monthRecords.filter((r) => {
        const before = prevById.get(r.id);
        return before !== undefined && RANK[r.condition] < RANK[before.condition] && isFlaggedCondition(r.condition);
      });

      if (dropped.length > 0) {
        // One event per dieback block, not one plot-wide event picking a
        // single tree at random — with five distinct DECLINE_ZONES on the
        // ground, "important events" means each actively-failing block gets
        // its own reported drop, not a coin flip over which block gets heard
        // from this month. Drops outside every zone (background noise from
        // per-tree vigour variance) still get one event of their own so
        // nothing real goes unreported.
        const byZone = new Map<number | null, TreeRecord[]>();
        for (const t of dropped) {
          const list = byZone.get(t.declineZoneId) ?? [];
          list.push(t);
          byZone.set(t.declineZoneId, list);
        }

        for (const [zoneId, zoneDropped] of byZone) {
          const tree = zoneDropped[Math.floor(rand() * zoneDropped.length)];
          const before = prevById.get(tree.id)!;
          const worst = tree.condition === "defoliated";
          events.push({
            id: `${areaId}-decline-${monthIndex}-${zoneId ?? "general"}`,
            monthIndex,
            date: randomDayInMonth(month.date, rand, today),
            kind: "decline",
            title: worst ? "Tree fully defoliated" : "Canopy decline flagged",
            description:
              `${tree.species} ${tree.id} dropped from ${CONDITION_LABEL[before.condition]} to ` +
              `${CONDITION_LABEL[tree.condition]}` +
              `${zoneId !== null ? ` — inside dieback block ${zoneId + 1}` : ""}. ` +
              `${zoneDropped.length} tree${zoneDropped.length === 1 ? "" : "s"} declined in ${
                zoneId !== null ? "this block" : "the wider plot"
              } this month.`,
            species: SPECIES_KEY_BY_LABEL[tree.species] ?? surveySpecies,
            severity: tree.condition,
            tree,
          });
        }
      }
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
        }% — ${speciesLabel[recoverSpecies]} leading the recovery this month.`,
        species: recoverSpecies,
        severity: "vigorous",
        tree: pickTreeForEvent(monthRecords, rand, recoverSpecies, "vigorous"),
      });
    }
  });

  return events.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function eventsInRange(events: TreeEvent[], range: DateRange): TreeEvent[] {
  return events.filter((e) => e.monthIndex >= range.startIndex && e.monthIndex <= range.endIndex);
}
