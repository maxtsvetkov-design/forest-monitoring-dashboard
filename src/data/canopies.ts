/**
 * The plot's tree crowns as *geometry* rather than as artwork.
 *
 * `public/overlays/al-maha-generative.svg` traces every crown in the drone
 * capture as a closed loop. `scripts/extract-canopies.mjs` reduces each loop to
 * a centroid and an equivalent-circle radius and writes them to
 * `al-maha-canopies.json`; this module loads that file and turns each record
 * into something a 3D scene can stand a tree on.
 *
 * The important property is that the JSON is in the *same normalised image
 * space* the raster overlay is georeferenced in, so `pointInQuad` (overlays.ts)
 * converts a crown straight to lng/lat and the 3D trees land exactly on the
 * canopies painted underneath them — at any zoom, pitch or bearing, and for the
 * re-georeferenced copies of the plot the other three areas use.
 */

import { seededRandom } from "./random";
import { publicUrl } from "../lib/publicUrl";

/** One traced crown, in the overlay image's normalised space. */
export interface Canopy {
  /** 0→1 left to right across the image. */
  u: number;
  /** 0→1 top to bottom. */
  v: number;
  /** Crown radius as a fraction of image *width* (isotropic — the overlay quad
   * preserves the source aspect ratio, so the same fraction is the same number
   * of metres in both axes). */
  r: number;
}

interface CanopyFile {
  source: string;
  viewBox: [number, number];
  count: number;
  canopies: Canopy[];
}

/**
 * Only Al Maha was actually traced. The other three plots reuse that same
 * artwork re-georeferenced to their own footprint (see `areaOverlays`), so they
 * legitimately reuse its crowns too — the trees then land on the canopies those
 * areas are already showing, because it is the same picture underneath.
 */
const CANOPY_FILE_URL = publicUrl("/overlays/al-maha-canopies.json");

let canopyPromise: Promise<Canopy[]> | null = null;

/**
 * Fetches and caches the crown table. Module-scoped rather than per-component:
 * it is static art-derived geometry, roughly 100KB of JSON, and every map view
 * that shows the 3D layer wants the identical array.
 */
export function loadCanopies(): Promise<Canopy[]> {
  if (canopyPromise) return canopyPromise;
  canopyPromise = fetch(CANOPY_FILE_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`canopies ${res.status}`);
      return res.json() as Promise<CanopyFile>;
    })
    .then((file) => file.canopies)
    .catch((err) => {
      // A missing crown table costs the 3D layer and nothing else, so this
      // resolves empty instead of rejecting — the map still draws, the layer
      // just has nothing to place.
      console.warn("[canopies] could not load crown table:", err);
      canopyPromise = null;
      return [];
    });
  return canopyPromise;
}

/** Everything the 3D layer needs to build one tree, in metres and radians. */
export interface TreeVariation {
  /** Total height, ground to top of the crown. */
  heightM: number;
  /** Fraction of `heightM` that is bare trunk below the foliage (0..1). */
  trunkRatio: number;
  /** 0 = the palette's dry/pale green, 1 = its deep healthy green. */
  tint: number;
}

/**
 * How wide a crown can get before we stop believing it is one tree. A few loops
 * in the artwork enclose a whole thicket; past this they are treated as a
 * canopy-sized cluster rather than allowed to grow a single absurd trunk.
 */
export const MAX_CROWN_RADIUS_M = 14;

/**
 * Derives a tree's proportions from the crown it has to fill.
 *
 * `radiusM` is that crown's real ground radius — the traced artwork over Al
 * Maha's 1500m-wide footprint puts the median around 2.7m and the 95th
 * percentile near 12m. `rand()` is a deterministic draw from `treeRng` below,
 * so the same crown produces the same tree on every reload.
 *
 * TODO(human)
 */
export function treeVariation(radiusM: number, rand: () => number): TreeVariation {
  // TODO(human): decide the allometry — how height follows crown radius, how
  // much random spread to allow, how the trunk/foliage split and the green
  // tint vary. Return { heightM, trunkRatio, tint }.
  return { heightM: radiusM * 2, trunkRatio: 0.35, tint: 0.5 };
}

/**
 * A per-tree PRNG seeded by the crown's own index, so variation is stable
 * across reloads, area switches and layer toggles — a forest that reshuffles
 * itself every time you hide and show it reads as a glitch, not as life.
 */
export function treeRng(index: number): () => number {
  return seededRandom(`canopy-${index}`);
}
