import { pointInQuad, type MapOverlay } from "./overlays";
import { clamp01, pickWeighted, seededRandom } from "./random";
import type { CrownKey, MonthSnapshot } from "./types";

export interface TreeRecord {
  id: string;
  species: string;
  health: "Healthy" | "Stressed" | "Declining" | "Dead";
  diameter: "L (>5 m)" | "M (2–5 m)" | "S (<1 m)";
  height: number;
  lastSurveyed: string;
  lat: number;
  lng: number;
  /** Position in the overlay image's own space: 0→1 left→right. */
  u: number;
  /** Position in the overlay image's own space: 0→1 top→bottom. */
  v: number;
  canopyLossPct: number;
  /** Crown radius in metres, and the bucket it falls in — the same b1..b5
   * bands the crown-radius treemap aggregates, so clicking a band there can
   * filter this table to exactly the trees it counted. */
  crownRadius: number;
  crownBucket: CrownKey;
  /** Index into the snapshots array this tree was surveyed in. */
  monthIndex: number;
}

/** Metre bounds per crown bucket — must match CROWN_META's labels in aggregate.ts. */
export const CROWN_RANGE: Record<CrownKey, [number, number]> = {
  b1: [0, 0.2],
  b2: [0.2, 0.4],
  b3: [0.4, 0.6],
  b4: [0.6, 0.8],
  b5: [0.8, 1.2],
};

export const CROWN_LABEL: Record<CrownKey, string> = {
  b1: "0 – 0.2",
  b2: "0.2 – 0.4",
  b3: "0.4 – 0.6",
  b4: "0.6 – 0.8",
  b5: "0.8 – 1.2",
};

const SPECIES_LABEL = {
  ghaf: "Ghaf canopy",
  sidr: "Sidr underneath",
  palm: "Palm beneath",
} as const;

const DIAMETER_LABEL = {
  L: "L (>5 m)",
  M: "M (2–5 m)",
  S: "S (<1 m)",
} as const;

// Height follows from the diameter class rather than being drawn independently:
// a tree logged as "L (>5 m)" reading 1.2 m tall is the kind of incoherence that
// makes a table look generated. Ranges are metres, [min, max].
const HEIGHT_RANGE: Record<keyof typeof DIAMETER_LABEL, [number, number]> = {
  L: [5.5, 12],
  M: [2, 5.4],
  S: [0.5, 1.9],
};

/**
 * How many trees each monthly survey logs. Chosen so that the *flagged* subset
 * (everything not Healthy, which is what the map draws as pins — see
 * `generateTreePins` below) lands at roughly 2 pins in a recovered month and 7
 * in a badly degraded one, matching the pin density the map was tuned for.
 * The curve is emergent: the health mix is drawn from each month's own
 * healthCounts, so as the recovery narrative plays out the flagged count falls
 * on its own rather than being hardcoded.
 */
const TREES_PER_MONTH = 8;

/**
 * Builds the area's full per-tree record set: one survey batch per month, with
 * species / health / diameter drawn from that month's own aggregate counts, so
 * an individual row is always consistent with the charts above it.
 *
 * This is the single source of truth for individual trees. The Areas table
 * renders these rows filtered by the selected date range, and the map's flagged
 * pins are a *projection* of the very same records (`generateTreePins`) rather
 * than a second, independently-rolled dataset. That is deliberate: when the two
 * were generated separately they disagreed — the map could show five flagged
 * trees for a month the table listed three for. Deriving both from one pool
 * makes them consistent by construction, so they cannot drift.
 *
 * Placement happens in the *image's* normalised u/v space and is only then
 * projected onto the ground through the overlay's four corners, which is what
 * guarantees every tree sits on the imagery: u and v are clamped to an inset
 * sub-rectangle of [0,1], and `pointInQuad` maps that rectangle inside the quad.
 */
// Clusters (u/v rectangles, weighted by how dense the red trace actually is
// there) that the al-maha-generative_red.png artwork covers. Stressed/dying
// trees are drawn from these instead of the uniform spread so the flagged
// pins concentrate where the red overlay's markings actually are, rather
// than scattering independently of it.
const DYING_HOTSPOTS: { uMin: number; uMax: number; vMin: number; vMax: number; weight: number }[] = [
  { uMin: 0.38, uMax: 0.8, vMin: 0.02, vMax: 0.24, weight: 3 },
  { uMin: 0.62, uMax: 1.0, vMin: 0.68, vMax: 0.97, weight: 3 },
  { uMin: 0.9, uMax: 1.0, vMin: 0.0, vMax: 0.2, weight: 1 },
  { uMin: 0.22, uMax: 0.43, vMin: 0.26, vMax: 0.37, weight: 1 },
  { uMin: 0.34, uMax: 0.43, vMin: 0.54, vMax: 0.68, weight: 1 },
];
const DYING_HOTSPOT_TOTAL_WEIGHT = DYING_HOTSPOTS.reduce((sum, h) => sum + h.weight, 0);

function pickDyingHotspot(rand: () => number) {
  let roll = rand() * DYING_HOTSPOT_TOTAL_WEIGHT;
  for (const hotspot of DYING_HOTSPOTS) {
    roll -= hotspot.weight;
    if (roll <= 0) return hotspot;
  }
  return DYING_HOTSPOTS[DYING_HOTSPOTS.length - 1];
}

export function generateTreeRecords(
  overlay: MapOverlay,
  areaId: string,
  snapshots: MonthSnapshot[],
): TreeRecord[] {
  const rand = seededRandom(`trees:${areaId}`);

  // Keep trees off the very edge so a 26×34px marker never overhangs the image.
  const inset = 0.06;
  const span = 1 - inset * 2;
  const rows = 7;
  const prefix = areaId.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3);

  const records: TreeRecord[] = [];
  let seq = 0;

  snapshots.forEach((month, monthIndex) => {
    for (let i = 0; i < TREES_PER_MONTH; i++) {
      const speciesKey = pickWeighted(rand, month.speciesCounts);
      const health = pickWeighted(rand, {
        Healthy: month.healthCounts.healthy,
        Stressed: month.healthCounts.stressed,
        Declining: month.healthCounts.declining,
        Dead: month.healthCounts.dead,
      });
      const diameterKey = pickWeighted(rand, month.diameterCounts);
      // Drawn from the month's own crown distribution, so the per-tree values
      // add back up to the treemap's bands rather than telling a second story.
      const crownBucket = pickWeighted(rand, month.crownCounts);
      const [crownMin, crownMax] = CROWN_RANGE[crownBucket];
      const [minH, maxH] = HEIGHT_RANGE[diameterKey];

      // Healthy trees keep the even planting-row spread; stressed/declining/dead
      // ones are drawn from the red overlay's hotspots so most flagged pins land
      // where al-maha-generative_red.png actually shows dieback, not scattered
      // uniformly across the whole plot.
      let u: number;
      let v: number;
      if (health === "Healthy") {
        const row = seq % rows;
        const rowJitter = (rand() - 0.5) * (span / rows) * 0.4;
        v = clamp01(inset + (span * (row + 0.5)) / rows + rowJitter);
        u = clamp01(inset + rand() * span);
      } else {
        const hotspot = pickDyingHotspot(rand);
        u = clamp01(hotspot.uMin + rand() * (hotspot.uMax - hotspot.uMin));
        v = clamp01(hotspot.vMin + rand() * (hotspot.vMax - hotspot.vMin));
      }
      const [lng, lat] = pointInQuad(overlay.coordinates, u, v);

      records.push({
        id: `${prefix}-${String(101 + seq)}`,
        species: SPECIES_LABEL[speciesKey],
        health,
        diameter: DIAMETER_LABEL[diameterKey],
        height: Math.round((minH + rand() * (maxH - minH)) * 10) / 10,
        lastSurveyed: month.label,
        lat,
        lng,
        u,
        v,
        canopyLossPct: Math.round(15 + rand() * 70),
        crownRadius: Math.round((crownMin + rand() * (crownMax - crownMin)) * 100) / 100,
        crownBucket,
        monthIndex,
      });
      seq++;
    }
  });

  return records;
}
