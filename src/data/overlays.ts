// Georeferenced raster overlays: aerial/drone imagery pinned to real-world
// corner coordinates so the image stays locked to the ground as the user pans,
// zooms, rotates or tilts the map (MapLibre `image` source + `raster` layer).

import { areas } from "./areas";
import { publicUrl } from "../lib/publicUrl";

export interface MapOverlay {
  /** URL served by the app — put the file in `public/overlays/`. */
  url: string;
  /**
   * The four ground corners of the image, in [lng, lat], in MapLibre's required
   * order: top-left, top-right, bottom-right, bottom-left — matching the image's
   * own orientation (top-left corner of the picture = first entry).
   */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  opacity?: number;
}

/**
 * Builds the four corners of an axis-aligned box centred on `center`, sized to
 * `widthMeters` and keeping the image's aspect ratio so it isn't stretched.
 */
export function boxAround(
  center: [number, number],
  widthMeters: number,
  aspectRatio: number,
): MapOverlay["coordinates"] {
  const [lng, lat] = center;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);

  const halfW = widthMeters / 2 / metersPerDegLng;
  const halfH = widthMeters / aspectRatio / 2 / metersPerDegLat;

  const west = lng - halfW;
  const east = lng + halfW;
  const north = lat + halfH;
  const south = lat - halfH;

  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

/**
 * Maps a point in the image's own normalised space onto the ground, using the
 * overlay's four real corners.
 *
 * `u` runs 0→1 left→right across the picture, `v` runs 0→1 top→bottom — exactly
 * how the raster is sampled — so a point placed here lands on the same pixel of
 * the imagery no matter how the quad is oriented on the map. Bilinear across the
 * corners means the result is inside the quad for any u,v in [0,1], including
 * rotated or trapezoidal (true-georeference) footprints, not just the
 * axis-aligned box `boxAround` produces.
 */
export function pointInQuad(
  coordinates: MapOverlay["coordinates"],
  u: number,
  v: number,
): [number, number] {
  const [tl, tr, br, bl] = coordinates;
  const topLng = tl[0] + (tr[0] - tl[0]) * u;
  const topLat = tl[1] + (tr[1] - tl[1]) * u;
  const bottomLng = bl[0] + (br[0] - bl[0]) * u;
  const bottomLat = bl[1] + (br[1] - bl[1]) * u;
  return [topLng + (bottomLng - topLng) * v, topLat + (bottomLat - topLat) * v];
}

// Source image is 2752 × 1536 px.
const AERIAL_ASPECT = 2752 / 1536;

/**
 * Keyed by Area id (see areas.ts). Every area in `areas` needs an entry:
 * callers dereference this map directly (App.tsx's generateEvents,
 * Areas/Maps views' baseOverlay), so a missing one is a crash, not an area
 * that quietly renders without imagery — which is exactly what selecting
 * anything but Al Maha in the area switcher used to do.
 *
 * Only Al Maha has its own drone capture. The other pilot plots reuse that
 * same image, re-georeferenced to their own centre and scaled to their own
 * footprint: honest for a demo (the imagery is openly the same, and every
 * plot's *data* is its own — see areas.ts's per-area snapshot seeds) and it
 * keeps the map, pins, table and events consistent for all four.
 */
const PLOT_WIDTH_M: Record<string, number> = {
  "al-maha": 1500,
  hatta: 1200,
  "sir-bani-yas": 1800,
  "wadi-wurayah": 900,
};

export const areaOverlays: Record<string, MapOverlay> = Object.fromEntries(
  areas.map((area) => [
    area.id,
    {
      url: publicUrl("/overlays/al-maha-aerial.png"),
      coordinates: boxAround(area.center, PLOT_WIDTH_M[area.id] ?? 1200, AERIAL_ASPECT),
      opacity: 1,
    } satisfies MapOverlay,
  ]),
);

/**
 * The ground width of an area's overlay footprint, in metres — the scale that
 * turns anything measured in the *image's* normalised space into real metres.
 * The 3D canopy layer needs it to size a tree from a traced crown radius; see
 * `src/data/canopies.ts`.
 */
export function plotWidthMeters(areaId: string | undefined): number {
  return PLOT_WIDTH_M[areaId ?? ""] ?? 1200;
}

/**
 * An area's size in hectares, measured off the very box its overlay is
 * draped over rather than stored as a second, independently-maintained
 * number — so what the project overview lists always matches the footprint
 * actually drawn on the map.
 */
export function areaHectares(areaId: string): number {
  const widthM = PLOT_WIDTH_M[areaId] ?? 1200;
  const heightM = widthM / AERIAL_ASPECT;
  return Math.round((widthM * heightM) / 10_000);
}

/**
 * Alternate drone frames of the same plot — same pixel dimensions as the base
 * overlay above, so `areaOverlays`'s georeferenced corners apply to these
 * unchanged. Ordered by the only signal their filenames give (ascending
 * numeric suffix); there's no captured survey date behind them, so this is a
 * "different look per stretch of the timeline" set rather than a dated
 * before/after sequence — see `overlayForRange`.
 */
export const areaTimelapseImages: Record<string, string[]> = {
  "al-maha": [
    "/overlays/al-maha-aerial1.jpg",
    "/overlays/al-maha-aerial2.jpg",
    "/overlays/al-maha-aerial3.jpg",
    "/overlays/al-maha-aerial6.jpg",
    "/overlays/al-maha-aerial7.jpg",
  ].map(publicUrl),
};

/**
 * A marketing figure, not a measurement: how many captures the pitch says are
 * coming for a plot. Nothing in the data model produces this number and
 * nothing downstream should treat it as real coverage -- it exists to make the
 * timeline's "N of M captures" line and its upsell banner read convincingly in
 * a demo. Kept next to the real image list so the two can't drift apart
 * unnoticed.
 */
export const PROMO_PLANNED_CAPTURES = 24;

export function getTimelapseImages(areaId: string): string[] | undefined {
  return areaTimelapseImages[areaId];
}

/**
 * Splits the area's full timeline into as many equal buckets as it has
 * alternate images and returns which bucket the range's midpoint falls into —
 * so dragging either timeline handle can visibly swap the aerial photo, the
 * same way it already swaps which pins are visible.
 *
 * Deliberately returns a plain number rather than the swapped MapOverlay
 * itself: callers build the final overlay object inside their own `useMemo`
 * keyed on this integer, not on the `range` object. `range` gets a fresh
 * reference on every pixel of a slider drag, but the bucket it resolves to
 * only changes a handful of times across the whole timeline — memoizing on
 * `range` would rebuild MapCanvas's overlay layer (a full source/layer
 * teardown, see its effect) on every drag tick instead of only when the
 * visible image actually needs to change.
 */
export function timelapseBucketIndex(
  range: { startIndex: number; endIndex: number },
  totalMonths: number,
  imageCount: number,
): number {
  if (imageCount <= 0 || totalMonths <= 0) return -1;
  const midpoint = (range.startIndex + range.endIndex) / 2;
  return Math.min(imageCount - 1, Math.floor((midpoint / totalMonths) * imageCount));
}

/** Convenience wrapper for a one-off (non-memoized) lookup. Components that
 * re-render often should use `getTimelapseImages` + `timelapseBucketIndex`
 * directly inside their own `useMemo` instead — see the comment above. */
export function overlayForRange(
  base: MapOverlay,
  areaId: string,
  range: { startIndex: number; endIndex: number },
  totalMonths: number,
): MapOverlay {
  const images = areaTimelapseImages[areaId];
  if (!images) return base;
  const bucket = timelapseBucketIndex(range, totalMonths, images.length);
  return bucket < 0 ? base : { ...base, url: images[bucket] };
}

/**
 * A generative-art trace of the same plot's tree canopies, meant to render as
 * a stylized layer on top of the aerial rather than a second independent
 * photo. Reuses that overlay's exact footprint — same corners — so the two
 * line up perfectly regardless of area/scale; update `areaOverlays` and this
 * stays aligned automatically.
 *
 * Sourced from `al-maha-generative.svg` (the design file), rasterized once to
 * this PNG at its native 2754×1537 with a transparent background — MapLibre's
 * `image` source hardcodes the fetched bytes as `image/png` for
 * `createImageBitmap`, so an actual SVG file silently decodes to nothing; its
 * own source comment says as much ("Note that SVGs are not supported").
 */
export const areaGenerativeOverlays: Record<string, MapOverlay> = {
  "al-maha": {
    url: publicUrl("/overlays/al-maha-generative.png"),
    coordinates: areaOverlays["al-maha"].coordinates,
    opacity: 0.7,
  },
};

/**
 * A second generative-art pass over the same footprint, tracing only the
 * trees flagged as dying/declining — same rasterization story as the mask
 * above (transparent-background PNGs, since MapLibre `image` sources can't
 * decode SVG bytes directly), kept as its own layer/toggle rather than merged
 * into the green trace so it can be shown or hidden independently in the
 * layer panel.
 *
 * `areaDyingTreeOverlays` is the mildest frame — the right default for a
 * caller with no timeline of its own (the project-overview screen) or as the
 * starting point before `dyingTreeOverlayForRange` picks a sharper one.
 */
export const areaDyingTreeOverlays: Record<string, MapOverlay> = {
  "al-maha": {
    url: publicUrl("/overlays/al-maha-generative_red1.png"),
    coordinates: areaOverlays["al-maha"].coordinates,
    opacity: 1,
  },
};

/**
 * Three successive frames of the same trace, each showing more of the plot
 * dying than the last — al-maha-generative_red1/2/7.png, ordered mild to
 * severe by their own filenames. Matches the tree population's own
 * DECLINE_MONTHS=3 (see treePopulation.ts): the dataset's dieback plays out
 * over exactly the final three months of the window, so this sequence is
 * meant to land one frame per one of those months, not spread evenly across
 * the whole timeline the way `areaTimelapseImages` is.
 */
export const areaDyingTreeSequence: Record<string, string[]> = {
  "al-maha": [
    "/overlays/al-maha-generative_red1.png",
    "/overlays/al-maha-generative_red2.png",
    "/overlays/al-maha-generative_red7.png",
  ].map(publicUrl),
};

/**
 * Picks the dieback frame for the selected range's END month — the same "as
 * of this date" rule MapCanvas's flagged pins and the Areas table both use.
 * Months before the sequence's own window (`totalMonths - sequence.length`)
 * get the mildest frame, since nothing has visibly failed yet; the sequence's
 * own last frame covers the final month and everything past it (there is
 * nothing worse to show).
 */
export function dyingTreeOverlayForRange(
  base: MapOverlay,
  areaId: string,
  range: { endIndex: number },
  totalMonths: number,
): MapOverlay {
  const sequence = areaDyingTreeSequence[areaId];
  if (!sequence || sequence.length === 0) return base;
  const monthsIntoWindow = range.endIndex - (totalMonths - sequence.length);
  const index = Math.max(0, Math.min(sequence.length - 1, monthsIntoWindow));
  return { ...base, url: sequence[index] };
}
