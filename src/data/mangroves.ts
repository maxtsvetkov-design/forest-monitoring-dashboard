/**
 * The Mangroves project's stand: 300 grey mangroves (Avicennia marina, the
 * UAE's one native mangrove) generated for the 3D layer that replaces every
 * other map layer on this area — see `MangroveLayer` and MapCanvas.
 *
 * Hand-authored demo data, like every other area's mock population, but
 * seeded (`seededRandom`), so the stand is identical on every reload: a forest
 * that reshuffles when you come back to it reads as a glitch.
 *
 * Placement is clumped along a gently curving band rather than scattered
 * uniformly, because that is how a mangrove fringe actually grows — in
 * thickets strung along the tidal edge. Health is a smooth field over the plot
 * (two die-back patches centred on real clumps) plus per-tree noise, so
 * stress shows up on the map as a pattern a reader can find, not as confetti.
 */

import type { MapOverlay } from "./overlays";
import { pointInQuad } from "./overlays";
import { clamp01, seededRandom } from "./random";
import { conditionForVigour, type ConditionKey } from "./taxonomy";

export const MANGROVE_AREA_ID = "mangroves";
export const MANGROVE_COUNT = 600;

/** The one gate every "Mangroves-only" map behaviour asks — MapCanvas and
 *  LayerPanel both key off this rather than comparing the id string inline. */
export function hasMangroveForest(areaId: string | undefined): boolean {
  return areaId === MANGROVE_AREA_ID;
}

export interface Mangrove {
  /** "MG-001" … "MG-600", numbered west → east. */
  id: string;
  lng: number;
  lat: number;
  /** Ground to crown top. */
  heightM: number;
  crownRadiusM: number;
  /** 0..1 — the value `condition` is bucketed from. */
  vigour: number;
  condition: ConditionKey;
  /** Y rotation, radians, so the prop roots don't all splay the same way. */
  spin: number;
}

const CLUMP_COUNT = 11;
/** Clumps whose centres carry a die-back patch, and how hard / wide each is. */
const STRESS_PATCHES = [
  { clump: 7, depth: 0.86, sigmaM: 20 },
  { clump: 2, depth: 0.45, sigmaM: 16 },
];
const EDGE_MARGIN_M = 4;

function metresBetween(a: [number, number], b: [number, number]): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(midLat);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Builds the stand inside `coordinates` (the area's overlay quad, which stays
 * populated even though its raster is hidden — see `MapOverlay.hidden`).
 * Works in plot-local metres (`x` east along u, `y` south along v) so spacing
 * and die-back radii are real distances, then maps back through `pointInQuad`.
 */
export function generateMangroves(coordinates: MapOverlay["coordinates"], seed = MANGROVE_AREA_ID): Mangrove[] {
  const rand = seededRandom(`mangroves:${seed}`);
  const [tl, tr, , bl] = coordinates;
  const widthM = metresBetween(tl, tr);
  const heightM = metresBetween(tl, bl);

  const bandV = (u: number) => 0.5 + 0.2 * Math.sin(u * Math.PI * 1.4 + 0.6);
  const clumps = Array.from({ length: CLUMP_COUNT }, (_, k) => {
    const u = (k + 0.5 + (rand() - 0.5) * 0.6) / CLUMP_COUNT;
    const v = bandV(u) + (rand() - 0.5) * 0.25;
    return { x: u * widthM, y: v * heightM, sigmaM: 5 + rand() * 5, weight: 0.6 + rand() * 0.8 };
  });
  const totalWeight = clumps.reduce((s, c) => s + c.weight, 0);
  const pickClump = () => {
    let r = rand() * totalWeight;
    for (const c of clumps) {
      r -= c.weight;
      if (r <= 0) return c;
    }
    return clumps[clumps.length - 1];
  };

  const vigourAt = (x: number, y: number) => {
    let v = 0.93;
    for (const p of STRESS_PATCHES) {
      const c = clumps[p.clump];
      const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
      v -= p.depth * Math.exp(-d2 / (2 * p.sigmaM ** 2));
    }
    return clamp01(v + (rand() - 0.5) * 0.22);
  };

  const placed: { x: number; y: number; r: number; tree: Omit<Mangrove, "id" | "lng" | "lat"> }[] = [];
  while (placed.length < MANGROVE_COUNT) {
    // Crowns may interlock a little, like a real thicket; if a clump fills
    // up, the allowed overlap relaxes rather than the loop spinning forever.
    let overlap = 0.35;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0 && attempt % 60 === 0) overlap *= 0.8;
      const clump = pickClump();
      const x = clump.x + gaussian(rand) * clump.sigmaM;
      const y = clump.y + gaussian(rand) * clump.sigmaM * 0.7;
      if (x < EDGE_MARGIN_M || x > widthM - EDGE_MARGIN_M || y < EDGE_MARGIN_M || y > heightM - EDGE_MARGIN_M) {
        continue;
      }

      const vigour = vigourAt(x, y);
      const condition = conditionForVigour(vigour);
      const height = (2 + 5 * rand() ** 1.4) * (0.85 + 0.2 * vigour);
      let crownRadius = height * (0.45 + rand() * 0.15);
      if (condition === "defoliated") crownRadius *= 0.75;

      const minGap = Math.max(1.2, overlap);
      const clear = placed.every((p) => Math.hypot(p.x - x, p.y - y) >= Math.max(minGap, (p.r + crownRadius) * overlap));
      if (!clear) continue;

      placed.push({
        x,
        y,
        r: crownRadius,
        tree: {
          heightM: Math.round(height * 10) / 10,
          crownRadiusM: Math.round(crownRadius * 100) / 100,
          vigour: Math.round(vigour * 1000) / 1000,
          condition,
          spin: rand() * Math.PI * 2,
        },
      });
      break;
    }
  }

  return placed
    .sort((a, b) => a.x - b.x)
    .map((p, i) => {
      const [lng, lat] = pointInQuad(coordinates, p.x / widthM, p.y / heightM);
      return { id: `MG-${String(i + 1).padStart(3, "0")}`, lng, lat, ...p.tree };
    });
}
