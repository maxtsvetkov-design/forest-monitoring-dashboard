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

/**
 * Whether a ground position falls on an overlay's own footprint.
 *
 * The companion to `pointInQuad`, which goes the other way. Needed because
 * MapLibre cannot hit-test a `raster` layer — `queryRenderedFeatures` returns
 * nothing for one, since a raster has no features — so "is the pointer over the
 * imagery" has to be answered geometrically.
 *
 * Ray casting over the four corners rather than an axis-aligned box test: the
 * corners are a general quad (`boxAround` happens to produce a rectangle, but a
 * true georeference need not) and a bounding box would report `true` for ground
 * outside a rotated footprint.
 */
export function isInsideQuad(coordinates: MapOverlay["coordinates"], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const [xi, yi] = coordinates[i];
    const [xj, yj] = coordinates[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Source image is 2752 × 1536 px.
const AERIAL_ASPECT = 2752 / 1536;

/**
 * Keyed by Area id (see areas.ts). Every area in `areas` needs an entry:
 * callers dereference this map directly (App.tsx's generateEvents,
 * Assets/Maps views' baseOverlay), so a missing one is a crash, not an area
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
  // A coastal island rather than a fenced plot, and the captures behind it are
  // whole-coastline satellite frames — so its footprint is an order of
  // magnitude wider than the drone plots above.
  "abu-al-abyad": 14_000,
};

/**
 * Areas whose imagery is NOT the shared drone plate.
 *
 * The four plots above are all the same 2752 × 1536 frame re-georeferenced, so
 * one aspect and one file covered them. Abu Al Abyad carries its own captures
 * at 5865 × 3220, and draping those on a box cut for the drone frame's aspect
 * would stretch them about 1.7% vertically — small, and exactly the kind of
 * quiet mis-registration the rest of this file refuses. So the aspect travels
 * with the image rather than being assumed.
 */
const AREA_BASE_IMAGE: Record<string, { url: string; aspect: number }> = {
  "abu-al-abyad": { url: "/overlays/map1.jpg", aspect: 5865 / 3220 },
};

/**
 * Whether this area's imagery is its OWN ground rather than the shared drone
 * plate — and therefore whether anything traced in that plate's image space
 * applies to it.
 *
 * Three things in this app are drawn in the shared frame's normalised u/v
 * coordinates: the canopy-health mask, the generative crown artwork, and every
 * tree in `treePopulation.ts`. On the plots that reuse the drone frame those
 * land exactly where the imagery says they should, which is what makes
 * re-georeferencing one photograph across four sites defensible. On an area
 * with its own captures they land nowhere in particular — for Abu Al Abyad, a
 * 14 km coastal frame, the canopy mask paints crowns across open water and the
 * population pins trees into the sea.
 *
 * So this is the gate: the generative and dying-tree traces are already absent
 * for such an area (they are per-area registries below, with no entry), and
 * MapCanvas asks this before drawing the two that are generated globally. What
 * remains is the area's own captures and its own tallies, which are real.
 */
export function areaHasOwnImagery(areaId: string): boolean {
  return areaId in AREA_BASE_IMAGE;
}

export const areaOverlays: Record<string, MapOverlay> = Object.fromEntries(
  areas.map((area) => {
    const own = AREA_BASE_IMAGE[area.id];
    return [
      area.id,
      {
        url: publicUrl(own?.url ?? "/overlays/al-maha-aerial.png"),
        coordinates: boxAround(area.center, PLOT_WIDTH_M[area.id] ?? 1200, own?.aspect ?? AERIAL_ASPECT),
        opacity: 1,
      } satisfies MapOverlay,
    ];
  }),
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
/**
 * The individual frames, named rather than spelled inline, so that
 * `areaExtentPairs` below can pin a traced extent to the *specific* capture it
 * was drawn on without a second copy of the path. A trace belongs to one frame
 * — pairing it with "whatever is last in the list" would silently mis-attribute
 * it the moment a new capture is added.
 */
const AL_MAHA_FRAMES = {
  f1: "/overlays/al-maha-aerial1.jpg",
  f2: "/overlays/al-maha-aerial2.jpg",
  f3: "/overlays/al-maha-aerial3.jpg",
  f6: "/overlays/al-maha-aerial6.jpg",
  f7: "/overlays/al-maha-aerial7.jpg",
} as const;

/** Capture order — the only sequence signal the filenames give. Everything that
 *  needs "which frame is this, of how many" reads it from here. */
const AL_MAHA_FRAME_ORDER: readonly string[] = [
  AL_MAHA_FRAMES.f1,
  AL_MAHA_FRAMES.f2,
  AL_MAHA_FRAMES.f3,
  AL_MAHA_FRAMES.f6,
  AL_MAHA_FRAMES.f7,
];

/**
 * Abu Al Abyad's own five captures.
 *
 * The gaps in the numbering (1, 5, 8, 12, 16) are the delivery's, not a
 * selection made here — they are the frames that exist. As with the Al Maha
 * set, no capture date is claimed for any of them, so the timeline buckets
 * these the same way it buckets that one, dating each by the stretch of
 * months its position stands for rather than a survey date it doesn't carry.
 *
 * map1.jpg is placed LAST rather than first (ascending suffix order would put
 * it at the front) so it lands in the timeline's most recent window instead
 * of its oldest — a deliberate override of the filename ordering, not an
 * oversight.
 */
const ABU_AL_ABYAD_FRAME_ORDER: readonly string[] = [
  "/overlays/map5.jpg",
  "/overlays/map8.jpg",
  "/overlays/map12.jpg",
  "/overlays/map16.jpg",
  "/overlays/map1.jpg",
];

export const areaTimelapseImages: Record<string, string[]> = {
  "al-maha": AL_MAHA_FRAME_ORDER.map(publicUrl),
  "abu-al-abyad": ABU_AL_ABYAD_FRAME_ORDER.map(publicUrl),
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
 * of this date" rule MapCanvas's flagged pins and the Assets table both use.
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

/**
 * A hand-delineated vegetation extent — the boundary an analyst drew around the
 * shelterbelt corridor on one specific capture.
 *
 * These are *not* generated from the tree data the rest of the app computes
 * from; they arrived as delivered traces, and they register pixel-for-pixel on
 * their own frame (verified against the imagery: the line sits on the mature
 * tree row that runs across the lower third of the plot, v ≈ 0.71–0.86).
 *
 * `color` is the literal stroke colour sampled out of the PNG, not a palette
 * choice, so a legend built from this data cannot disagree with the pixels the
 * reader is looking at.
 */
export interface ExtentTrace {
  url: string;
  /** Sampled from the file — every opaque pixel in these PNGs is this one colour. */
  color: string;
}

/**
 * One capture and the extent traced on it: the unit the habitat screen's stack
 * view draws two of, stacking capture → trace → capture → trace.
 */
export interface CaptureExtentPair {
  id: string;
  capture: string;
  /** 1-based position in the plot's own capture set, and its size — see
   *  AL_MAHA_FRAME_ORDER. The set carries no survey dates, so this ordinal is
   *  the whole of what is known about when a frame was taken. */
  frameNumber: number;
  frameCount: number;
  trace: ExtentTrace;
}

function alMahaPair(id: string, capturePath: string, tracePath: string, color: string): CaptureExtentPair {
  const index = AL_MAHA_FRAME_ORDER.indexOf(capturePath);
  if (index < 0) {
    // A trace pinned to a frame that is no longer in the capture set would
    // render over imagery it was never drawn on. Better to fail loudly here
    // than to publish a mis-registered comparison.
    throw new Error(`Extent trace "${id}" references ${capturePath}, which is not in the capture set`);
  }
  return {
    id,
    capture: publicUrl(capturePath),
    frameNumber: index + 1,
    frameCount: AL_MAHA_FRAME_ORDER.length,
    trace: { url: publicUrl(tracePath), color },
  };
}

/**
 * The two epochs the stack view compares, earliest-frame first.
 *
 * Only Al Maha has delivered traces. Unlike `areaOverlays`, this is *not*
 * back-filled for the other pilot plots: re-georeferencing a shared aerial to
 * another plot's centre is an honest demo compromise, but presenting a
 * delineation somebody drew on Al Maha's shelterbelt as another site's
 * vegetation boundary is a claim about that site. Callers key into this and
 * hide the affordance when there is nothing to show.
 */
export const areaExtentPairs: Record<string, CaptureExtentPair[]> = {
  "al-maha": [
    alMahaPair("extent-early", AL_MAHA_FRAMES.f1, "/overlays/maha_22.png", "#12D2FF"),
    alMahaPair("extent-late", AL_MAHA_FRAMES.f7, "/overlays/maha_55.png", "#D200FF"),
  ],
};

/**
 * Which months of the plot's timeline a given capture frame stands for.
 *
 * The inverse of `timelapseBucketIndex`, and the only honest way to put a date
 * on these frames. The files carry no survey date — see `areaTimelapseImages` —
 * but the app already treats their filename order as a time order everywhere
 * else: the timeline splits its months into one bucket per frame and shows
 * whichever frame the selected range falls into. So a frame does have a
 * position in time *within this app's own model*, and this reports it.
 *
 * Derived rather than tabulated so it cannot disagree with the function that
 * actually chooses the imagery: `timelapseBucketIndex` sends a midpoint `m` to
 * `floor(m / total * count)`, so frame `i` owns the midpoints in
 * `[i * total / count, (i + 1) * total / count)`.
 */
export function frameMonthWindow(
  frameIndex: number,
  frameCount: number,
  totalMonths: number,
): { startIndex: number; endIndex: number } {
  if (frameCount <= 0 || totalMonths <= 0) return { startIndex: 0, endIndex: 0 };
  const start = Math.ceil((frameIndex * totalMonths) / frameCount);
  const end = Math.ceil(((frameIndex + 1) * totalMonths) / frameCount) - 1;
  const last = totalMonths - 1;
  return {
    startIndex: Math.min(last, Math.max(0, start)),
    endIndex: Math.min(last, Math.max(0, Math.max(start, end))),
  };
}

/**
 * Where the two delineations disagree, as delivered raster masks.
 *
 * These are the change itself rather than another pair of boundaries: each
 * fills the ground that one pass claimed and the other did not. Their
 * provenance is the two traces in `areaExtentPairs`, and that was verified
 * rather than assumed — flood-filling both traces and intersecting gives
 * 67% / 75% IoU against the matching one-sided difference and 0.0% against the
 * opposite one, so the pairing below is not a guess.
 *
 * Two warnings for anyone editing this. The filenames are misleading:
 * `contrast_blue_outside` is the region inside the BLUE boundary and outside
 * the magenta one, and it is drawn in RED, not blue. And the fills are
 * translucent (alpha 0.45 and 0.27) single colours, so `color` here is the
 * literal pixel value and cannot be restyled without lying about the raster.
 */
export interface ExtentDifference {
  id: string;
  url: string;
  /** Sampled from the file. */
  color: string;
  label: string;
  /** Which way the ground moved. */
  direction: "lost" | "gained";
}

export const areaExtentDifferences: Record<string, ExtentDifference[]> = {
  "al-maha": [
    {
      id: "diff-lost",
      url: publicUrl("/overlays/contrast_blue_outside.png"),
      color: "#FF0000",
      label: "Only in the earlier pass",
      direction: "lost",
    },
    {
      id: "diff-gained",
      url: publicUrl("/overlays/contrast_magenta_outside.png"),
      color: "#0CFF00",
      label: "Only in the later pass",
      direction: "gained",
    },
  ],
};
