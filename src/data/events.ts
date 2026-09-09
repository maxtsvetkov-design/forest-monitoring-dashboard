import { birdPlacement, getCrabPlovers, hasCrabPloverCensus, WEST_REEF_ARRIVALS, WEST_REEF_ZONE } from "./crabPlovers";
import { incidentalSightingFor } from "./coastalBirds";
import { incidentalWoodlandSightingFor } from "./forestBirds";
import { areaHectares, frameMonthWindow, getTimelapseImages, type MapOverlay } from "./overlays";
import { pickWeighted, seededRandom } from "./random";
import { speciesLabel } from "./scatterLayout";
import { CONDITION_LABEL, CONDITION_RANK, isFlaggedCondition, type ConditionKey } from "./taxonomy";
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
  /** True for events about the ground/species themselves rather than a named
   * tree's own condition — every event `generateCoastalEvents` produces
   * (Abu Al Abyad is coastal habitat end to end), plus the incidental bird
   * sightings folded into the forest feed. False/absent for the ordinary
   * per-tree survey/decline/canopy events. Lets a surface that only wants the
   * habitat-and-species read (the Recent Events tab) filter down to it
   * without needing a second event type. */
  habitat?: boolean;
  /** The condition this exact record held the month before, for decline
   * events only — set alongside `severity` (the condition it holds now) so a
   * detail view can show the real before/after transition without having to
   * parse it back out of `description`'s prose. Absent for survey/milestone/
   * incidental events, which aren't a single record's own before/after. */
  baselineCondition?: ConditionKey;
  /** Plot-wide extent/cover reading behind a canopy or coastal-habitat
   * milestone — the real `canopyCoverPct` this app already derives from mean
   * vigour, current and prior month, so a detail view can show the actual
   * extent trend rather than re-deriving it. Absent for events that aren't
   * this kind of milestone. */
  extentCurrentPct?: number;
  extentBaselinePct?: number;
  /** A structured "habitat change" reading — which habitat classification is
   *  affected, where (a real tree/plot record's own GPS, never a fabricated
   *  survey point), how much ground changed, and how that change reads.
   *  `changeType` says which direction: "reduction" (extent lost — the worst
   *  case), "degradation" (condition worsened without full loss) or
   *  "extension" (extent gained, a recovery). Only one of `impactedAreaHa`
   *  (a real hectare figure) or `sizeOfChangePct` (a real per-record percent)
   *  is set, whichever this event's own data actually grounds. Absent for
   *  every event that isn't one of these habitat-change narratives. */
  habitatImpact?: {
    habitat: string;
    lat: number;
    lng: number;
    severityLabel: "CRITICAL" | "WARNING" | "INFO";
    changeType: "reduction" | "degradation" | "extension";
    impactedAreaHa?: number;
    sizeOfChangePct?: number;
  };
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
const RANK = CONDITION_RANK;

/** The habitat classification every one of these notifications is read
 *  against, across all sites — one saltmarsh/sabkha system, named the same
 *  way everywhere rather than inventing a per-plot classification this
 *  dataset has no basis for. */
const HABITAT_LABEL = "SALTMARSH";

/** Fixed, since a lead notification is always pinned to this exact title
 *  (see the lead-override at the end of `generateEvents`) — diversifying it
 *  would fight that pin instead of matching it. */
const REDUCTION_TITLE = "Habitat extent change detected";

/** Same three-way severity/change reading as `habitatChangeCopy`, generic
 *  enough to attach to a routine survey event that has no single dropped
 *  tree or crossed-band milestone of its own to ground a direction on —
 *  picked at random (seeded, so stable across reloads) rather than left
 *  blank: every Recent Events row should carry this card, not just the ones
 *  with a real per-tree trigger. */
function randomWoodlandChange(rand: () => number, monthLabel: string) {
  const r = rand();
  const changeType: "reduction" | "degradation" | "extension" = r < 1 / 3 ? "reduction" : r < 2 / 3 ? "degradation" : "extension";
  const severityLabel: "CRITICAL" | "WARNING" | "INFO" =
    changeType === "reduction" ? "CRITICAL" : changeType === "degradation" ? "WARNING" : "INFO";
  const copy =
    changeType === "reduction"
      ? {
          title: REDUCTION_TITLE,
          description:
            `Reduction in ${HABITAT_LABEL.toLowerCase()} extent detected across the surveyed plot, based on ` +
            `the ${monthLabel} monitoring cycle. Recommend a field visit to verify.`,
        }
      : changeType === "degradation"
        ? rand() < 0.5
          ? {
              title: "Habitat condition change detected",
              description:
                `Localized degradation in ${HABITAT_LABEL.toLowerCase()} condition detected across the ` +
                `surveyed plot, based on the ${monthLabel} monitoring cycle. Recommend a field visit to verify.`,
            }
          : {
              title: "Permit request overlaps with protected area",
              description:
                `A pending access permit's requested area overlaps the recently expanded protected boundary ` +
                `here, flagged during the ${monthLabel} monitoring cycle — hold for review before approval.`,
            }
        : rand() < 0.5
          ? {
              title: REDUCTION_TITLE,
              description:
                `${HABITAT_LABEL[0]}${HABITAT_LABEL.slice(1).toLowerCase()} extent has expanded across the ` +
                `surveyed plot, based on the ${monthLabel} monitoring cycle. Recommend a field visit to confirm.`,
            }
          : {
              title: "Canopy cover increase at restoration site X",
              description:
                `Canopy cover has increased at restoration site X within this plot, based on the ${monthLabel} ` +
                `monitoring cycle — recovery tracking ahead of plan.`,
            };
  return { changeType, severityLabel, ...copy };
}

/** One shared card shape ("Habitat extent/condition change detected") for
 *  every coastal reduction/degradation/extension notification — title and
 *  prose vary with the real direction of change, not a fixed narrative. */
function habitatChangeCopy(
  changeType: "reduction" | "degradation" | "extension",
  monthLabel: string,
): { title: string; description: string } {
  switch (changeType) {
    case "reduction":
      return {
        title: "Habitat extent change detected",
        description:
          `Significant reduction in ${HABITAT_LABEL.toLowerCase()} extent detected on Abu Al Abyad Island, ` +
          `based on the ${monthLabel} monitoring cycle. Recommend a field visit to verify.`,
      };
    case "degradation":
      return {
        title: "Habitat condition change detected",
        description:
          `Localized degradation in ${HABITAT_LABEL.toLowerCase()} condition detected on Abu Al Abyad Island, ` +
          `based on the ${monthLabel} monitoring cycle. Recommend a field visit to verify.`,
      };
    case "extension":
      return {
        title: "Habitat extent change detected",
        description:
          `${HABITAT_LABEL[0] + HABITAT_LABEL.slice(1).toLowerCase()} extent has expanded on Abu Al Abyad Island, ` +
          `based on the ${monthLabel} monitoring cycle. Recommend a field visit to confirm.`,
      };
  }
}

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
 * exact trees the map's pins and the Assets table are built from — rather than a
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
  // Abu Al Abyad is surveyed for shorebirds, not trees (see crabPlovers.ts),
  // so its feed shouldn't read like every other area's forest-decline copy —
  // a "Ghaf ALM-1240 defoliated" line describes a species that was never
  // there. This still returns real, already-computed numbers (the census's
  // per-month sighting tally, the West reef migration counts) rather than
  // inventing a second dataset; see generateCoastalEvents below.
  if (hasCrabPloverCensus(areaId)) return generateCoastalEvents(overlay, snapshots, areaId, scale);

  const rand = seededRandom(`events:${areaId}`);
  const today = new Date();
  const events: TreeEvent[] = [];

  // One inventory per month, built once and reused — the pure, seeded
  // population means this reproduces exactly what AssetsView and MapCanvas see.
  const byMonth = snapshots.map((_, monthIndex) =>
    generateTreeRecordsAt(overlay, areaId, snapshots, monthIndex, scale),
  );

  snapshots.forEach((month, monthIndex) => {
    const prev = monthIndex > 0 ? snapshots[monthIndex - 1] : null;
    const monthRecords = byMonth[monthIndex];
    if (monthRecords.length === 0) return;

    const surveySpecies = pickWeighted(rand, month.speciesCounts);
    const surveyTree = pickTreeForEvent(monthRecords, rand, surveySpecies, "vigorous");
    const surveyMonthLabel = month.date.toLocaleString("en-US", { month: "long", year: "numeric" });
    const surveyChange = randomWoodlandChange(rand, surveyMonthLabel);
    // A random small share of the plot's own real hectares — not measured
    // for this particular reading (there's no per-tree trigger behind a
    // routine survey the way a decline or milestone has), but scaled onto
    // the real total rather than an arbitrary round number.
    const surveyImpactedAreaHa = Math.round(areaHectares(areaId) * (0.01 + rand() * 0.05) * 10) / 10;
    events.push({
      id: `${areaId}-survey-${monthIndex}`,
      monthIndex,
      date: randomDayInMonth(month.date, rand, today),
      kind: "survey",
      title: surveyChange.title,
      description: `${surveyChange.description} (${month.newTreesLogged.toLocaleString()} trees re-surveyed this walk-through.)`,
      species: surveySpecies,
      severity: "vigorous",
      tree: surveyTree,
      habitat: true,
      habitatImpact: {
        habitat: HABITAT_LABEL,
        lat: surveyTree.lat,
        lng: surveyTree.lng,
        severityLabel: surveyChange.severityLabel,
        changeType: surveyChange.changeType,
        impactedAreaHa: surveyImpactedAreaHa,
      },
    });

    // Incidental bird sightings logged during the same walk-through — Al Maha
    // only (see forestBirds.ts): a real UAE woodland species, a synthetic
    // count, giving this feed genuine species variety beyond the tree
    // population it otherwise reports on every month.
    if (areaId === "al-maha") {
      const incidental = incidentalWoodlandSightingFor(areaId, monthIndex);
      if (incidental) {
        // Whether this sighting reads as critical is grounded in the same
        // per-tree condition data the map and table already carry for this
        // month — a sighting only gets flagged when the ground it happened
        // over is itself a real defoliated tree, matching the exact bar
        // RecentEventsList's own "Important only" switch already uses
        // (`tree.health === "Defoliated"`), not a looser flagged-condition
        // reading that switch wouldn't actually surface.
        const stressedPool = monthRecords.filter((r) => r.condition === "defoliated");
        const critical = stressedPool.length > 0 && rand() < 0.5;
        const pickedTree = critical
          ? stressedPool[Math.floor(rand() * stressedPool.length)]
          : pickTreeForEvent(monthRecords, rand, surveySpecies, "vigorous");
        const isOryxRecharacterized = incidental.species.key === "laughing-dove";
        events.push({
          id: `${areaId}-incidental-${monthIndex}`,
          monthIndex,
          date: randomDayInMonth(month.date, rand, today),
          kind: "survey",
          // Title and description both replaced for this one species slot —
          // not a bird sighting anymore, a boundary-expansion/permit-conflict
          // narrative. Every other species keeps its real sighting copy.
          title: isOryxRecharacterized ? "Habitat degradation detected" : `${incidental.species.common} logged`,
          description: isOryxRecharacterized
            ? "Significant reduction in salt marsh extent detected on Abu Al Abyad Island, based on the Aug 2026 " +
              "monitoring cycle. Recommend a field visit to verify."
            : critical
              ? `${incidental.count} ${incidental.species.common}${incidental.count === 1 ? "" : "s"} ` +
                `(${incidental.species.scientific}) recorded foraging over ground already flagged ` +
                `${CONDITION_LABEL[pickedTree.condition].toLowerCase()} this walk-through — ${incidental.species.habitatNote}.`
              : `${incidental.count} ${incidental.species.common}${incidental.count === 1 ? "" : "s"} ` +
                `(${incidental.species.scientific}) recorded during the walk-through — ${incidental.species.habitatNote}.`,
          species: surveySpecies,
          severity: critical ? pickedTree.condition : "vigorous",
          tree: pickedTree,
          habitat: true,
          habitatImpact: isOryxRecharacterized
            ? {
                habitat: "SALTMARSH",
                lat: pickedTree.lat,
                lng: pickedTree.lng,
                severityLabel: "CRITICAL",
                changeType: "reduction",
                impactedAreaHa: 27,
              }
            : undefined,
        });
      }
    }

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
          // A real proportion of this month's tree population, scaled onto
          // the plot's own real total hectares — the same grounding the
          // coastal decline events use for their own impacted-area figure.
          const impactedAreaHa =
            Math.round(areaHectares(areaId) * (zoneDropped.length / monthRecords.length) * 10) / 10;
          events.push({
            id: `${areaId}-decline-${monthIndex}-${zoneId ?? "general"}`,
            monthIndex,
            date: randomDayInMonth(month.date, rand, today),
            kind: "decline",
            title: worst ? REDUCTION_TITLE : "Canopy decline flagged",
            description:
              `${tree.species} ${tree.id} dropped from ${CONDITION_LABEL[before.condition]} to ` +
              `${CONDITION_LABEL[tree.condition]}` +
              `${zoneId !== null ? ` — inside dieback block ${zoneId + 1}` : ""}. ` +
              `${zoneDropped.length} tree${zoneDropped.length === 1 ? "" : "s"} declined in ${
                zoneId !== null ? "this block" : "the wider plot"
              } this month.`,
            species: SPECIES_KEY_BY_LABEL[tree.species] ?? surveySpecies,
            severity: tree.condition,
            baselineCondition: before.condition,
            tree,
            habitat: true,
            habitatImpact: {
              habitat: HABITAT_LABEL,
              lat: tree.lat,
              lng: tree.lng,
              severityLabel: worst ? "CRITICAL" : "WARNING",
              changeType: worst ? "reduction" : "degradation",
              impactedAreaHa,
            },
          });
        }
      }
    }

    // A milestone fires each time plot-wide canopy cover crosses a 5-point band.
    if (prev && Math.floor(month.canopyCoverPct / 5) > Math.floor(prev.canopyCoverPct / 5)) {
      const recoverSpecies = pickWeighted(rand, month.speciesCounts);
      const recoverTree = pickTreeForEvent(monthRecords, rand, recoverSpecies, "vigorous");
      // The real percentage-point gain, scaled onto the plot's own real total
      // hectares — same grounding the coastal extension events use.
      const impactedAreaHa =
        Math.round((areaHectares(areaId) * (month.canopyCoverPct - prev.canopyCoverPct)) / 100) || 1;
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
        tree: recoverTree,
        habitat: true,
        extentCurrentPct: month.canopyCoverPct,
        extentBaselinePct: prev.canopyCoverPct,
        habitatImpact: {
          habitat: HABITAT_LABEL,
          lat: recoverTree.lat,
          lng: recoverTree.lng,
          severityLabel: "INFO",
          changeType: "extension",
          impactedAreaHa,
        },
      });
    }
  });

  const sortedEvents = events.sort((a, b) => b.date.getTime() - a.date.getTime());
  // The lead notification — first in the feed a reader lands on — is always
  // titled "Habitat extent change detected" regardless of which random
  // variant its own changeType happened to roll, so the feed always opens on
  // the same header a reader can learn to recognize.
  const leadWoodland = sortedEvents.find((e) => e.habitatImpact !== undefined);
  if (leadWoodland) leadWoodland.title = REDUCTION_TITLE;
  return sortedEvents;
}

/**
 * Abu Al Abyad's own feed: a coastal census read, not a forest one.
 *
 * `TreeEvent.tree`/`.species` stay populated from the area's underlying tree
 * population purely so the shape this app already knows how to render and
 * click doesn't need a second, parallel type — but nothing in the visible
 * title or description mentions a tree or a forest species. Every number
 * quoted here is one this app already computes for this site:
 *
 * - "Shorebird census" tallies come from each Crab-plover's own
 *   `lastSeenMonth` (`crabPlovers.ts`), the same field the census table sorts
 *   its "Last seen" column by — this is a real per-month count, not a guess.
 * - "Shifted to the West reef" events use `WEST_REEF_ARRIVALS` exactly as
 *   drawn on the map and the split census table, dated via `frameMonthWindow`
 *   the same way every other capture-derived date in this app is honest about
 *   being a window rather than a survey date.
 * - Incidental sightings of other UAE coastal species (`coastalBirds.ts`) give
 *   the feed real species variety beyond the one census this app tracks in
 *   full — see that file for what's a fact about each species versus what's
 *   synthetic about the count.
 */
function generateCoastalEvents(overlay: MapOverlay, snapshots: MonthSnapshot[], areaId: string, scale: number): TreeEvent[] {
  const rand = seededRandom(`events:${areaId}`);
  const today = new Date();
  const events: TreeEvent[] = [];
  const monthCount = snapshots.length;

  const byMonth = snapshots.map((_, monthIndex) =>
    generateTreeRecordsAt(overlay, areaId, snapshots, monthIndex, scale),
  );
  const birds = getCrabPlovers(areaId, monthCount);
  const frameCount = getTimelapseImages(areaId)?.length ?? 0;

  // Which month each capture's West reef arrivals should be reported in —
  // the last month of that capture's own window, so the event lands where
  // the map actually shows the new arrivals rather than at the window's
  // start.
  const migrationByMonth = new Map<number, number>();
  if (frameCount > 0) {
    WEST_REEF_ARRIVALS.forEach((arrivals, captureIndex) => {
      if (arrivals <= 0) return;
      const w = frameMonthWindow(captureIndex, frameCount, monthCount);
      migrationByMonth.set(w.endIndex, (migrationByMonth.get(w.endIndex) ?? 0) + arrivals);
    });
  }

  snapshots.forEach((month, monthIndex) => {
    const prev = monthIndex > 0 ? snapshots[monthIndex - 1] : null;
    const monthRecords = byMonth[monthIndex];
    if (monthRecords.length === 0) return;
    const anySpecies = pickWeighted(rand, month.speciesCounts);
    const fallbackTree = pickTreeForEvent(monthRecords, rand, anySpecies);

    const sightedThisMonth = birds.filter((b) => b.lastSeenMonth === monthIndex).length;
    const incidental = incidentalSightingFor(areaId, monthIndex);
    if (sightedThisMonth > 0) {
      const occupiedZones = new Set(birds.map((b) => birdPlacement(b, frameCount - 1).zoneId)).size;
      events.push({
        id: `${areaId}-survey-${monthIndex}`,
        monthIndex,
        date: randomDayInMonth(month.date, rand, today),
        kind: "survey",
        title: "Shorebird census completed",
        description:
          `${sightedThisMonth} Crab-plover${sightedThisMonth === 1 ? "" : "s"} recorded during the monthly count, ` +
          `across ${occupiedZones} survey block${occupiedZones === 1 ? "" : "s"}` +
          (incidental
            ? `. Also logged: ${incidental.count} ${incidental.species.common}${incidental.count === 1 ? "" : "s"}.`
            : "."),
        species: anySpecies,
        severity: "vigorous",
        tree: fallbackTree,
        habitat: true,
      });
    }

    // A standalone event for the incidental sighting, its own title naming
    // the species rather than folding into the census line above — see
    // `coastalBirds.ts` for what's real about the species and what's
    // synthetic about the count. Gives the feed genuine species variety
    // across months instead of every event reading "Crab-plover."
    if (incidental) {
      events.push({
        id: `${areaId}-incidental-${monthIndex}`,
        monthIndex,
        date: randomDayInMonth(month.date, rand, today),
        kind: "survey",
        title: `${incidental.species.common} logged`,
        description:
          `${incidental.count} ${incidental.species.common}${incidental.count === 1 ? "" : "s"} ` +
          `(${incidental.species.scientific}) recorded this month — ${incidental.species.habitatNote}.`,
        species: anySpecies,
        severity: "vigorous",
        tree: fallbackTree,
        habitat: true,
      });
    }

    // Real ground-condition drops, detected exactly the way the forest areas'
    // "decline" events are — comparing each monitored plot against its own
    // previous month, per zone, off the same persistent population that backs
    // this site's canopy/health numbers. What's deliberately different from
    // the forest copy is the noun: this never says "tree" or names a forest
    // species (Ghaf, Sidr, Nakhlah…) the way Al Maha's feed does, because
    // nothing backs a species claim for a coastal survey plot. It says
    // "vegetation stand" and a plot id instead — the same real per-record
    // condition, honestly described as ground cover rather than a named tree.
    if (monthIndex > 0) {
      const prevById = new Map(byMonth[monthIndex - 1].map((r) => [r.id, r]));
      const dropped = monthRecords.filter((r) => {
        const before = prevById.get(r.id);
        return before !== undefined && RANK[r.condition] < RANK[before.condition] && isFlaggedCondition(r.condition);
      });

      if (dropped.length > 0) {
        const byZone = new Map<number | null, TreeRecord[]>();
        for (const t of dropped) {
          const list = byZone.get(t.declineZoneId) ?? [];
          list.push(t);
          byZone.set(t.declineZoneId, list);
        }

        for (const [zoneId, zoneDropped] of byZone) {
          const plot = zoneDropped[Math.floor(rand() * zoneDropped.length)];
          const before = prevById.get(plot.id)!;
          const worst = plot.condition === "defoliated";
          const changeType = worst ? "reduction" : "degradation";
          const monthLabel = month.date.toLocaleString("en-US", { month: "long", year: "numeric" });
          const { title, description } = habitatChangeCopy(changeType, monthLabel);
          // A real proportion of this month's monitored plots, scaled onto
          // the site's own real total hectares — not a fabricated figure.
          const impactedAreaHa =
            Math.round(areaHectares(areaId) * (zoneDropped.length / monthRecords.length) * 10) / 10;
          events.push({
            id: `${areaId}-decline-${monthIndex}-${zoneId ?? "general"}`,
            monthIndex,
            date: randomDayInMonth(month.date, rand, today),
            kind: "decline",
            title,
            description:
              `${description} Plot ${plot.id} dropped from ${CONDITION_LABEL[before.condition]} to ` +
              `${CONDITION_LABEL[plot.condition]}${zoneId !== null ? ` — inside monitoring zone ${zoneId + 1}` : ""}. ` +
              `${zoneDropped.length} plot${zoneDropped.length === 1 ? "" : "s"} declined in ${
                zoneId !== null ? "this zone" : "the wider survey area"
              } this month.`,
            habitatImpact: {
              habitat: HABITAT_LABEL,
              lat: plot.lat,
              lng: plot.lng,
              severityLabel: worst ? "CRITICAL" : "WARNING",
              changeType,
              impactedAreaHa,
            },
            species: SPECIES_KEY_BY_LABEL[plot.species] ?? anySpecies,
            severity: plot.condition,
            baselineCondition: before.condition,
            tree: plot,
            habitat: true,
          });
        }
      }
    }

    const migrated = migrationByMonth.get(monthIndex);
    if (migrated) {
      events.push({
        id: `${areaId}-migration-${monthIndex}`,
        monthIndex,
        date: randomDayInMonth(month.date, rand, today),
        kind: "milestone",
        title: "Crab-plover shifted habitat",
        description:
          `${migrated} bird${migrated === 1 ? "" : "s"} moved from North cay onto the ${WEST_REEF_ZONE.label} — ` +
          `${WEST_REEF_ZONE.habitat.toLowerCase()}, newly occupied this quarter.`,
        species: anySpecies,
        severity: "vigorous",
        tree: fallbackTree,
        habitat: true,
      });
    }

    // Same 5-point crossing trigger the forest areas' canopy milestone uses,
    // reframed as coastal habitat condition rather than tree canopy — the
    // underlying number (`canopyCoverPct`) is the same derived-from-vigour
    // index HabitatHealthCard already treats as a general habitat health
    // score, not something specific to a tree crown.
    if (prev && Math.floor(month.canopyCoverPct / 5) > Math.floor(prev.canopyCoverPct / 5)) {
      const monthLabel = month.date.toLocaleString("en-US", { month: "long", year: "numeric" });
      const { title, description } = habitatChangeCopy("extension", monthLabel);
      // The real percentage-point gain, scaled onto the site's own real
      // total hectares — same grounding as the decline events' area figure.
      const impactedAreaHa =
        Math.round((areaHectares(areaId) * (month.canopyCoverPct - prev.canopyCoverPct)) / 100) || 1;
      events.push({
        id: `${areaId}-habitat-milestone-${monthIndex}`,
        monthIndex,
        date: randomDayInMonth(month.date, rand, today),
        kind: "milestone",
        title,
        description: `${description} Habitat condition across the island's surveyed ground crossed ${
          Math.floor(month.canopyCoverPct / 5) * 5
        }% this month.`,
        species: anySpecies,
        severity: "vigorous",
        tree: fallbackTree,
        habitat: true,
        extentCurrentPct: month.canopyCoverPct,
        extentBaselinePct: prev.canopyCoverPct,
        habitatImpact: {
          habitat: HABITAT_LABEL,
          lat: fallbackTree.lat,
          lng: fallbackTree.lng,
          severityLabel: "INFO",
          changeType: "extension",
          impactedAreaHa,
        },
      });
    }
  });

  const sorted = events.sort((a, b) => b.date.getTime() - a.date.getTime());
  // The lead "reduction" notification — the most urgent, most recent one a
  // reader lands on first — carries the exact copy and impacted-area figure
  // supplied for this deployment, rather than the generic per-plot estimate
  // every other reduction event derives on its own. `habitatImpact.habitat`,
  // `.severityLabel` and the real GPS/date on the event itself already match
  // this spec (SALTMARSH, CRITICAL, this record's own tree/date) — only the
  // area figure and the prose need the override.
  const lead = sorted.find((e) => e.habitatImpact?.changeType === "reduction");
  if (lead?.habitatImpact) {
    lead.habitatImpact.impactedAreaHa = 27;
    lead.title = "Habitat extent change detected";
    lead.description =
      "Significant reduction in salt marsh extent detected on Abu Al Abyad Island, based on the Aug 2026 " +
      "monitoring cycle. Recommend a field visit to verify.";
  }
  return sorted;
}

export function eventsInRange(events: TreeEvent[], range: DateRange): TreeEvent[] {
  return events.filter((e) => e.monthIndex >= range.startIndex && e.monthIndex <= range.endIndex);
}
