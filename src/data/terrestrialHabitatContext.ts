import { seededRandom } from "./random";
import { habitatClassByCode, type LegendEntry } from "./habitatLegend";
import type { TreeEvent } from "./events";

/**
 * Landscape-context read for a habitat-change event: how the surveyed
 * coastline is made up across ten neighbouring terrestrial classes, not just
 * the three this event's own change directly touches.
 *
 * `habitatClassChange.ts` answers "what changed, and by how much, in the
 * classes this event actually reports on" — three classes, deltas summing to
 * the event's own `impactedAreaHa`. This answers a different question: "how
 * does that change sit against the wider mosaic it happened in." So the
 * numbers here are NOT constrained to sum to anything on the card above —
 * they are a separate, wider survey read, the way a real change-detection
 * report pairs a tight before/after on the affected parcel with a standing
 * land-cover inventory for the block it sits in.
 *
 * Modelled, like the rest of this event's per-class data: nothing in this
 * app classifies imagery into these codes. Seeded per event id so it is
 * stable across reloads, and seeded on a namespace distinct from
 * `habitatClassChange.ts`'s so the two reads don't accidentally coincide.
 */

const CONTEXT_CODES = [
  "1010",
  "1020",
  "1030",
  "1040",
  "1041",
  "1050",
  "1060",
  "1070",
  "2011",
  "2012",
] as const;

/** Typical relative abundance of each class across a UAE coastal survey
 *  block — not a measurement, just the base each class's area is randomised
 *  around, so wide classes (sand plains) and narrow ones (mangrove
 *  plantation) don't all read as the same size. */
const BASE_HA: Record<(typeof CONTEXT_CODES)[number], number> = {
  "1010": 120,
  "1020": 95,
  "1030": 60,
  "1040": 40,
  "1041": 15,
  "1050": 30,
  "1060": 210,
  "1070": 55,
  "2011": 480,
  "2012": 340,
};

export interface TerrestrialContextClass extends LegendEntry {
  areaHa: number;
  deltaPct: number;
  /** Six-point trend, mirroring `HabitatClassChange.trend` so both charts
   *  read the same way. */
  trend: number[];
}

export interface TerrestrialHabitatContextReport {
  classes: TerrestrialContextClass[];
  totalHa: number;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function terrestrialHabitatContextFor(event: TreeEvent): TerrestrialHabitatContextReport | null {
  if (!event.habitatImpact) return null;

  const rand = seededRandom(`terrestrial-context:${event.id}`);
  const changeType = event.habitatImpact.changeType;
  // Ambient drift direction across the whole block follows the event's own
  // reading, the same convention `habitatClassChange.ts` uses for its three
  // tracked classes — an extension event's surrounding mosaic skews toward
  // gains, a reduction's skews toward losses, a degradation is mixed.
  const driftSign = changeType === "extension" ? 1 : changeType === "reduction" ? -1 : 0;

  const classes: TerrestrialContextClass[] = CONTEXT_CODES.map((code) => {
    const entry = habitatClassByCode(code);
    const areaHa = round1(BASE_HA[code] * (0.8 + rand() * 0.4));
    const magnitude = 1 + rand() * 5; // 1–6%
    const sign = driftSign !== 0 ? driftSign : rand() > 0.5 ? 1 : -1;
    const deltaPct = round1(sign * magnitude);
    const trend = Array.from({ length: 6 }, (_, t) => {
      const at = areaHa * (1 - (deltaPct / 100) * (1 - t / 5));
      const jitter = t === 0 || t === 5 ? 0 : (rand() - 0.5) * areaHa * 0.02;
      return round1(Math.max(0, at + jitter));
    });
    return { ...entry, areaHa, deltaPct, trend };
  });

  return {
    classes,
    totalHa: round1(classes.reduce((s, c) => s + c.areaHa, 0)),
  };
}
