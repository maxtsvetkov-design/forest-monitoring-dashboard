import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { DateRange } from "../data/aggregate";
import { plotWidthMeters, pointInQuad, type MapOverlay } from "../data/overlays";
import { loadCanopies, MAX_CROWN_RADIUS_M, type Canopy } from "../data/canopies";
import TreeCanopyLayer from "../map/TreeCanopyLayer";
import { generateTreePins, pinSeverityAt, SEVERITY_COLOR, type PinSeverity, type TreePin } from "../data/treePins";
import { generateTreeRecords, type TreeRecord } from "../data/trees";
import type { MonthSnapshot } from "../data/types";
import { publicUrl } from "../lib/publicUrl";
import type { LayerTime } from "../hooks/useLayerTime";
import { useFlyControls } from "../hooks/useFlyControls";
import LayerPanel, {
  DEFAULT_LAYER_HEIGHT,
  DEFAULT_SHADOW_MODE,
  type CanopyShadowMode,
  DEFAULT_LAYER_OPACITY,
  DEFAULT_LAYER_VISIBILITY,
  LAYER_ORDER,
  type ContentLayerId,
} from "./LayerPanel";
import { buildMapFilter, DEFAULT_MAP_CONTRAST, type MapColorMode } from "./mapColorModes";
import type { StoryFrame, StoryMapView } from "../data/storyMap";
import MapToolbar from "./MapToolbar";
import TreeHistoryModal from "./TreeHistoryModal";
import TreeTwinCard from "./TreeTwinCard";
import { CONDITION_KEYS, CONDITION_LABEL, type ConditionKey } from "../data/taxonomy";

// OpenStreetMap data served as vector tiles by OpenFreeMap: free, unlimited,
// no API key, and intended for embedding in third-party apps (unlike raw
// tile.openstreetmap.org, whose usage policy reserves it for OSM's own site).
const OSM_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Basemap choices cycled from the layer panel's "Basemap" chip. Google's own
// raster tiles aren't licensed for use outside their JS API, so satellite
// imagery here comes from Esri's freely-embeddable World Imagery service —
// see the "raster basemap" guidance given earlier in this session.
const BASEMAPS: { label: string; style: string | maplibregl.StyleSpecification }[] = [
  { label: "OpenStreetMap", style: OSM_STYLE_URL },
  {
    label: "Esri World Imagery",
    style: {
      version: 8,
      sources: {
        "esri-satellite": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution: "Esri, Maxar, Earthstar Geographics",
        },
      },
      layers: [{ id: "esri-satellite", type: "raster", source: "esri-satellite" }],
    },
  },
];

// AWS's public "Terrarium" elevation tiles (Mapzen format) for 3D terrain.
const TERRAIN_SOURCE_ID = "terrain-dem";
// Close enough that an individual tree fills a recognisable part of the frame,
// while still showing the neighbours it should be compared against.
const FOCUS_ZOOM = 18;

/** Bounds for the derived inspect zoom. The ceiling is above MapLibre's own
 * default maxZoom of 22 — a 1 m sapling cannot fill a viewport from 22, and
 * the twin is modelled geometry rather than tiles, so there is no imagery to
 * run out of. Raised only while a twin is open, and put back after. */
const INSPECT_ZOOM_MIN = 18.5;
const INSPECT_ZOOM_MAX = 23.5;
/** Share of the free width one tree'''s crown should span. Well under half:
 * the camera is pitched, so a crown sized to fill the frame horizontally
 * overshoots it vertically and the top of the tree is cut off. */
const INSPECT_CROWN_FILL = 0.38;
const INSPECT_PITCH = 62;
/** The twin card is docked right over the map. Padding shifts the projected
 * centre left by that much, so the tree the card describes is not sitting
 * behind the card describing it. */
const INSPECT_CARD_GUTTER = 292;

const LOAD_TIMEOUT_MS = 10000;

/** The browser event AIAssistant listens for to time its one proactive nudge
 * — fired the first time the user actually moves ANY map instance (drag,
 * zoom or click), not on mount. A plain DOM event rather than a prop threaded
 * through MapsView/AssetsView/StoryView/App: three separate call sites mount
 * their own MapCanvas, and the assistant that should react is whichever one
 * happens to be on screen, not something each view needs to know about. */
export const MAP_INTERACT_EVENT = "nabat:map-interact";

/** Module-level, not component state: the guard has to survive across three
 * independent MapCanvas mounts (Maps/Assets/Story/landing), so "already fired"
 * must live outside any one of them. */
let hasFiredMapInteract = false;
function notifyFirstMapInteraction() {
  if (hasFiredMapInteract) return;
  hasFiredMapInteract = true;
  window.dispatchEvent(new Event(MAP_INTERACT_EVENT));
}

/**
 * How each of the Story panel's camera archetypes actually sits over the plot
 * — see `StoryFrame` in data/storyMap.ts for what each one is *for*.
 *
 * `zoomDelta` is relative to a plain fit of the plot's own footprint, which is
 * what makes these comparable: `plot` is that fit, `context` is two stops back
 * from it, `terrain` three and a half. Absolute zooms would drift apart the
 * moment a differently-sized area was added.
 *
 * The two tilted frames tilt for opposite reasons and so sit at different
 * distances. `terrain` pulls a long way *out* because 12 hectares of desert
 * plain is flat — vertical exaggeration only reads once enough landscape is in
 * shot for the relief to have somewhere to rise from. `canopy` pushes *in*,
 * because 2,300 modelled trees seen from altitude are green texture and only
 * resolve into individual crowns close up.
 *
 * `bearing` is off-north in both, and deliberately not the same amount: a tilt
 * with the north axis still square on reads as a photo that has been skewed
 * rather than as a place being looked at from somewhere.
 *
 * `pitch` stays at or under 60 because that is MapLibre's default `maxPitch`,
 * and it enforces it by silently clamping — asking for 64 gets 60 with no
 * error, so the table would claim a tilt the camera never takes.
 */
const STORY_FRAMES: Record<
  Exclude<StoryFrame, "twin">,
  { pitch: number; bearing: number; exaggeration: number | null; padding: number; zoomDelta: number }
> = {
  context: { pitch: 0, bearing: 0, exaggeration: null, padding: 40, zoomDelta: -2.1 },
  plot: { pitch: 0, bearing: 0, exaggeration: null, padding: 44, zoomDelta: 0 },
  // Exaggerated well past the app's usual 1.5. The DEM here is real and has
  // 600 m of range in shot — the foothills east of the site — but the basemap
  // draws it as flat colour fills with no hillshade, so a deformed surface with
  // no shading across it is very nearly invisible. Since this frame exists to
  // make the ground itself legible, the vertical scale has to carry the whole
  // reading on its own.
  terrain: { pitch: 60, bearing: -28, exaggeration: 3.4, padding: 40, zoomDelta: -2.9 },
  canopy: { pitch: 56, bearing: -18, exaggeration: null, padding: 48, zoomDelta: 0.55 },
};

/**
 * The map's own chrome overlaps the canvas rather than sitting beside it — the
 * layer panel is docked over the left edge and the toolbar over the right. A
 * frame computed against the full container therefore centres the plot behind
 * the panel, which on the Story tab means the left third of the site is
 * permanently hidden under the very controls describing it.
 *
 * Fed to `cameraForBounds` as asymmetric padding, which shifts the centre as
 * well as loosening the fit, so the plot ends up centred in the part of the
 * canvas that is actually visible. Same reasoning as INSPECT_CARD_GUTTER, for
 * the other side of the map.
 */
const CHROME_GUTTER_LEFT = 300;
const CHROME_GUTTER_RIGHT = 58;

/**
 * Relief shading, added only while a `terrain` story frame is up.
 *
 * Tilting the camera over a DEM deforms the ground, but OpenStreetMap's vector
 * style paints that ground as flat colour fills — and a deformed surface with
 * no shading variation across it is very nearly invisible, however far it is
 * exaggerated. Measured from the map itself: the visible extent here spans
 * 194 m to 801 m of real elevation and still read as a flat road map.
 *
 * The shading is what makes the relief legible, and it is free: it reads the
 * same DEM source the terrain is already using, so it costs no extra tiles.
 */
const HILLSHADE_LAYER_ID = "story-hillshade";

/** The `twin` story frame's share of the width for one crown — see the
 * `crownFill` argument on flyToNearestCrown. A quarter of what a real digital
 * twin uses, because this frame is about standing *among* the trees rather than
 * in front of one: at the twin's own 0.38 the camera ends up at the foot of a
 * single trunk, which shows a tree but not a habitat. */
const STORY_TWIN_CROWN_FILL = 0.09;

/** Past this much zoom change, the move arcs (`flyTo`) instead of sliding
 * (`easeTo`). A slide across five zoom levels is a smear — nothing in frame
 * survives long enough to track — whereas an arc pulls up, translates while
 * everything is small, and descends, which the eye reads as one journey. Below
 * the threshold the arc is the wrong instinct: it adds a pointless climb
 * between two views that were nearly the same size already. */
const STORY_ARC_ZOOM_DELTA = 1.5;
/** Long enough to be followed, short enough that clicking three blocks in a
 * row doesn't feel like waiting. Arcs get more, because they cover more. */
const STORY_EASE_MS = 1150;
const STORY_ARC_MS = 1900;
/** MapLibre's own default ceiling. Restored when a story frame moves away from
 * the twin, which raises it (see INSPECT_ZOOM_MAX). */
const DEFAULT_MAX_ZOOM = 22;

// Drives --pin-t (see index.css): pins are crisp teardrop icons at the
// framed/zoomed-in view (auto-frame lands around z16; "Fit to plot" similar)
// and crossfade into soft blurred glowing circles as the user zooms out past
// the plot filling the screen — reads as hotspots rather than a smeared
// version of a shape too small to read anyway. 0 at z15+, 1 at z10 and below.
function zoomedOutFactor(zoom: number): number {
  const t = (15 - zoom) / (15 - 10);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

interface Diagnostics {
  width: number;
  height: number;
  webgl: boolean;
}

function readDiagnostics(el: HTMLElement | null): Diagnostics {
  const rect = el?.getBoundingClientRect();
  let webgl = false;
  try {
    const probe = document.createElement("canvas");
    webgl = !!(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return { width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0), webgl };
}

function StatusOverlay({ title, message, diagnostics }: { title: string; message: string; diagnostics: Diagnostics }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#f6f6f8] px-6 z-20">
      <div className="max-w-[420px] text-center">
        <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-1">{title}</p>
        <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[18px] mb-2">{message}</p>
        <p className="text-[11px] text-[#71717a] font-['Outfit',sans-serif]">
          container {diagnostics.width}×{diagnostics.height}px · WebGL {diagnostics.webgl ? "available" : "unavailable"}
        </p>
      </div>
    </div>
  );
}

// Two alternating slots rather than one: swapping the aerial photo (the
// timelapse buckets in overlays.ts) crossfades between them instead of
// popping instantly, which a single source/layer pair can't do — removing a
// layer discards it outright, with no way to animate its own disappearance.
const OVERLAY_SOURCE_ID_A = "area-aerial-overlay-a";
const OVERLAY_LAYER_ID_A = "area-aerial-overlay-layer-a";
const OVERLAY_SOURCE_ID_B = "area-aerial-overlay-b";
const OVERLAY_LAYER_ID_B = "area-aerial-overlay-layer-b";
const OVERLAY_CROSSFADE_MS = 500;
const GENERATIVE_SOURCE_ID = "area-generative-overlay";
const GENERATIVE_LAYER_ID = "area-generative-overlay-layer";
// The dying-trees trace shares the generative layer's footprint but sits flat
// on the ground (no height offset, no hover-dim mask) — it's meant to read as
// an always-on flag, not artwork you tilt into 3D to discover.
const DYING_SOURCE_ID = "area-dying-tree-overlay";
const DYING_LAYER_ID = "area-dying-tree-overlay-layer";
const DYING_OPACITY = 0.9;
// A soft blurred-red halo rendered *underneath* the crisp trace, pulsing on
// its own slow clock — the visual vocabulary of "active danger zone" (radar
// blips, live-incident maps), not just a static highlight colour.
const DYING_GLOW_SOURCE_ID = "area-dying-tree-glow";
const DYING_GLOW_LAYER_ID = "area-dying-tree-glow-layer";

// The three.js forest. Not a raster layer at all — a MapLibre *custom* layer
// drawing into the map's own GL context, so it shares the camera and the depth
// buffer with everything above. See src/map/TreeCanopyLayer.ts.
const TREES_3D_LAYER_ID = "area-trees-3d";
const DYING_GLOW_MAX_WIDTH = 700;
const DYING_GLOW_MIN_OPACITY = 0.3;
const DYING_GLOW_MAX_OPACITY = 0.85;
const DYING_GLOW_PERIOD_MS = 2600;

// The tree-canopy silhouette mask (black shapes on a transparent ground,
// exported straight from the design file) sits flat on the aerial photo --
// no height offset like the generative artwork -- recoloured in code with a
// green -> yellow -> red gradient standing in for a canopy-health continuum.
const CANOPY_MASK_SVG_URL = publicUrl("/overlays/filled.svg");
const CANOPY_SOURCE_ID = "area-canopy-mask";
const CANOPY_LAYER_ID = "area-canopy-mask-layer";
const CANOPY_OPACITY = 0.82;
// How long one full red -> green -> red cycle takes while the timeline plays,
// how often a new frame is pushed, and how far frames are downscaled to keep
// each tick's canvas + toDataURL cost cheap enough for that cadence.
const CANOPY_PULSE_PERIOD_MS = 3200;
const CANOPY_PULSE_TICK_MS = 120;
const CANOPY_PULSE_MAX_WIDTH = 640;

// The reveal window: Oct '25 (index 0) through May '26 (index 7) — the
// recovery half of the 12-month timeline, before the final-quarter dieback
// window the dying-trees overlay owns instead. Opacity ramps linearly across
// it rather than snapping, so dragging the range's end handle reads as the
// artwork gradually emerging, not a threshold flipping.
const GENERATIVE_REVEAL_END_INDEX = 7;

/** 0 at Oct '25, 1 at May '26 or later — driven by the range's end month, not
 * pointer position (that used to be a dim/hover-to-light mask; see the
 * removed hover effect this replaced). */
function generativeRevealOpacity(range: DateRange | undefined): number {
  if (!range) return 0;
  return Math.max(0, Math.min(1, range.endIndex / GENERATIVE_REVEAL_END_INDEX));
}

/**
 * The generative layer must always render above the aerial photo, but each
 * loads via its own async `Image()` probe (see the two overlay effects) and
 * whichever happens to finish decoding first is the one whose `addLayer` call
 * runs first — the small SVG reliably beats the multi-megabyte photo, which
 * without this would leave the generative layer added first and therefore
 * stacked underneath, invisible. Called after *either* probe resolves so the
 * order comes out right regardless of which one wins the race.
 */
/**
 * Shifts a ground quad by the same apparent-lift derivation the generative
 * layer has always used (d = h·tan(pitch) along the camera's own bearing) —
 * shared so the dying-trees trace computes its own (independent) lift the
 * same way, rather than duplicating the derivation.
 */
function liftCoordinates(
  baseCoordinates: MapOverlay["coordinates"],
  map: maplibregl.Map,
  heightM: number,
): MapOverlay["coordinates"] {
  const centreLat = (baseCoordinates[0][1] + baseCoordinates[2][1]) / 2;
  const metresPerDegLat = 111_320;
  const metresPerDegLng = 111_320 * Math.cos((centreLat * Math.PI) / 180);
  const ground = heightM * Math.tan((map.getPitch() * Math.PI) / 180);
  const bearingRad = (map.getBearing() * Math.PI) / 180;
  const dLat = (ground * Math.cos(bearingRad)) / metresPerDegLat;
  const dLng = (ground * Math.sin(bearingRad)) / metresPerDegLng;
  return baseCoordinates.map(([lng, lat]) => [lng + dLng, lat + dLat]) as MapOverlay["coordinates"];
}

function ensureGenerativeOnTop(map: maplibregl.Map) {
  const hasAerial = map.getLayer(OVERLAY_LAYER_ID_A) || map.getLayer(OVERLAY_LAYER_ID_B);
  // Canopy mask goes up first (so it clears the aerial photo it was just
  // re-added on top of), then the green generative trace, then the red
  // dying-trees glow halo, then its crisp trace last -- moveLayer with no
  // second argument always lands at the very top, so call order fixes the
  // final stack: aerial < canopy mask < generative art < glow halo <
  // dying-trees trace.
  if (hasAerial && map.getLayer(CANOPY_LAYER_ID)) {
    map.moveLayer(CANOPY_LAYER_ID);
  }
  if (hasAerial && map.getLayer(GENERATIVE_LAYER_ID)) {
    map.moveLayer(GENERATIVE_LAYER_ID);
  }
  if (hasAerial && map.getLayer(DYING_GLOW_LAYER_ID)) {
    map.moveLayer(DYING_GLOW_LAYER_ID);
  }
  if (hasAerial && map.getLayer(DYING_LAYER_ID)) {
    map.moveLayer(DYING_LAYER_ID);
  }
  // The 3D trees go up last, above all of the above. This function is called
  // every time any raster layer is re-added (an area switch, a timelapse
  // bucket swap while the timeline is scrubbed, a basemap change) -- each of
  // those calls `moveLayer` on the rasters with no second argument, which
  // always lands at the very top of the *whole* style, custom layers
  // included. Without this, the 3D layer -- added once, whenever its crown
  // table happens to finish loading -- would end up silently buried under a
  // freshly re-topped canopy mask or generative-art raster the next time the
  // user so much as drags the timeline, and the forest would vanish with no
  // error anywhere.
  if (hasAerial && map.getLayer(TREES_3D_LAYER_ID)) {
    map.moveLayer(TREES_3D_LAYER_ID);
  }
}

/**
 * Loads the tree-canopy silhouette mask once and caches the decoded image at
 * module scope -- it's static art, not per-area data, so there's no reason to
 * refetch/redecode it on every area switch or animation frame.
 */
let canopyMaskImagePromise: Promise<HTMLImageElement> | null = null;
function loadCanopyMaskImage(): Promise<HTMLImageElement> {
  if (canopyMaskImagePromise) return canopyMaskImagePromise;
  canopyMaskImagePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load canopy mask SVG"));
    img.src = CANOPY_MASK_SVG_URL;
  });
  return canopyMaskImagePromise;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const lerp = (shift: number) => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `rgb(${lerp(16)}, ${lerp(8)}, ${lerp(0)})`;
}

// Two endpoint palettes at the same four stop positions -- a frame is just
// each stop's colour mixed between them by `t`. t=1 is the default, idle
// look (green -> yellow-green -> yellow -> red); t=0 swings the whole thing
// toward warm reds, used for the play-button pulse below.
const CANOPY_STOP_POSITIONS = [0, 0.55, 0.82, 1];
const CANOPY_RED_STOPS = ["#7a2a1c", "#c0432f", "#e0743c", "#8f2f1f"];
const CANOPY_GREEN_STOPS = ["#1f8f5f", "#a8c93a", "#e0b23c", "#c0432f"];

/**
 * Composites the tree-canopy silhouette mask with a code-driven gradient at
 * a given point `t` (0 = reddish, 1 = the default green-leaning look) between
 * the two palettes above, "source-in" clipping the gradient to the mask's own
 * alpha so it only ever paints the tree shapes, never the transparent ground
 * around them. `maxWidth` downscales the working canvas -- used for the
 * animated frames below, where cheap-and-frequent beats full-resolution.
 */
function renderCanopyGradientFrame(img: HTMLImageElement, t: number, maxWidth?: number): string {
  const naturalWidth = img.naturalWidth || 2754;
  const naturalHeight = img.naturalHeight || 1537;
  const scale = maxWidth && maxWidth < naturalWidth ? maxWidth / naturalWidth : 1;
  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, width, height);
  ctx.globalCompositeOperation = "source-in";
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  CANOPY_STOP_POSITIONS.forEach((pos, i) => {
    gradient.addColorStop(pos, mixHex(CANOPY_RED_STOPS[i], CANOPY_GREEN_STOPS[i], t));
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** The static, idle-state mask image (t=1, full resolution) -- cached at
 * module scope alongside the decoded image itself. */
let canopyImagePromise: Promise<string> | null = null;
function buildCanopyGradientImage(): Promise<string> {
  if (canopyImagePromise) return canopyImagePromise;
  canopyImagePromise = loadCanopyMaskImage().then((img) => renderCanopyGradientFrame(img, 1));
  return canopyImagePromise;
}

/**
 * Turns the dying-trees trace's thin outline strokes into a soft glowing
 * halo: several blurred, additively-blended copies build up solid coverage
 * inside each traced shape (a plain single blur just fogs the outline itself
 * rather than filling it), then `source-in` re-tints the accumulated alpha a
 * single hot red so the halo reads as one glow colour regardless of the
 * source art's own stroke colour. Downscaled first (`maxWidth`) since the
 * blur is by far the most expensive part of this and the result is only ever
 * shown heavily softened, so full 2754px resolution buys nothing.
 */
function renderGlowHalo(img: HTMLImageElement, maxWidth: number): string {
  const naturalWidth = img.naturalWidth || 2754;
  const naturalHeight = img.naturalHeight || 1537;
  const scale = maxWidth < naturalWidth ? maxWidth / naturalWidth : 1;
  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.filter = "blur(7px)";
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) ctx.drawImage(img, 0, 0, width, height);

  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#ff2b1f";
  ctx.fillRect(0, 0, width, height);

  return canvas.toDataURL("image/png");
}

/** Builds the floating pin element for one flagged tree. */
function buildPinElement(pin: TreePin, index: number): HTMLDivElement {
  const el = document.createElement("div");
  // Starts hidden: the range-visibility effect (which runs immediately after
  // this one builds the marker pool, in the same commit) is what decides
  // which pins should actually show, so starting visible would flash every
  // pin on screen for a frame before the out-of-range ones fade back out.
  el.className = "tree-pin tree-pin--hidden";
  // Left unset here on purpose: one marker now serves a tree for the whole
  // window, and the range-visibility effect paints it with the colour for
  // whichever month is on screen. Baking a colour in at build time would mean
  // rebuilding every marker to recolour it.
  // Stagger the float/pulse so the pins don't bob in lockstep. Derived from the
  // index rather than Math.random() so a remount reproduces the same phases.
  const floatDelay = ((index * 0.37) % 2.5).toFixed(2);
  const pulseDelay = ((index * 0.61) % 2).toFixed(2);
  // The ground ring, anchor dot and zoomed-out blob are all siblings of the
  // floating body, not children of it: they mark the pin's actual ground point
  // and must stay pinned there while the body bobs above. The blob in
  // particular represents the tree's position on the aerial when zoomed out,
  // so it has to sit still on the imagery — inside the float wrapper it
  // inherited the bob and drifted a few pixels off its tree. The float
  // animation lives on the inner wrapper only — MapLibre owns `transform` on
  // the root element.
  el.innerHTML = `
    <div class="tree-pin__pulse" style="animation-delay:${pulseDelay}s"></div>
    <div class="tree-pin__anchor"></div>
    <div class="tree-pin__blob"></div>
    <div class="tree-pin__float" style="animation-delay:${floatDelay}s">
      <div class="tree-pin__body">
        <svg width="26" height="34" viewBox="0 0 26 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 33.5C13 33.5 24.5 20.8 24.5 13A11.5 11.5 0 1 0 1.5 13C1.5 20.8 13 33.5 13 33.5Z"
                fill="var(--pin-color)" stroke="#ffffff" stroke-width="2"/>
        </svg>
        <span class="tree-pin__label">!</span>
      </div>
    </div>
  `;
  // Condition is added by the visibility effect along with the colour, since
  // both depend on the month being shown.
  el.setAttribute("aria-label", `Flagged tree ${pin.id}`);
  return el;
}

interface PinTooltipState {
  pin: TreePin;
  /** Which month the tooltip is describing. A pin now spans the whole window,
   * so its condition and canopy loss are only meaningful alongside a month. */
  monthIndex: number;
  /** Viewport pixels — this is portaled to `document.body`, not map-relative. */
  x: number;
  y: number;
}

/**
 * Tooltip for a clicked pin, portaled straight to `document.body` instead of
 * using MapLibre's built-in Popup.
 *
 * MapLibre appends a Popup as a child of the map's own container, which here
 * sits inside the card's `overflow-hidden` wrapper (needed to round off the
 * canvas's square corners) — so any popup reaching past the card's edge was
 * getting silently clipped, and even where it wasn't clipped it had no
 * z-index to beat the fixed top bar or the AI assistant panel. A portal
 * escapes both problems at once: it renders outside the clipping ancestor
 * entirely, positioned in viewport coordinates from `map.project()`.
 */
function PinTooltip({
  state,
  onClose,
  onExpand,
}: {
  state: PinTooltipState;
  onClose: () => void;
  /** Swaps this compact tooltip for the full history modal, same anchor —
   * omit where no full record is available to expand into (see the ref that
   * backs it in MapCanvas). */
  onExpand?: () => void;
}) {
  const { pin, monthIndex, x, y } = state;
  const severity = pinSeverityAt(pin, monthIndex);
  const color = severity ? SEVERITY_COLOR[severity] : "#86868f";
  return createPortal(
    <div
      className="pin-tooltip fixed z-[1000] -translate-x-1/2 -translate-y-full bg-white rounded-[12px] px-3 py-2 min-w-[160px] shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.12),0px_6px_20px_-4px_rgba(0,0,0,0.12)] font-['Outfit',sans-serif] animate-fade-in"
      style={{ left: x, top: y - 14 }}
      // Marker clicks don't reach the map canvas (see the click handler below),
      // but a click landing on the tooltip itself must not fall through to the
      // document-level listener that closes it on outside clicks.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute top-1 right-1 flex items-center gap-[2px]">
        {onExpand && (
          <button
            type="button"
            aria-label="Expand"
            title="Show full history"
            onClick={onExpand}
            className="w-5 h-5 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path
                d="M9.5 2h4.5v4.5M14 2 9 7M6.5 14H2V9.5M2 14l5-5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="text-[13px] font-bold text-[#18181c] mb-1 pr-10">{pin.id}</div>
      <div className="flex items-center gap-[6px] mb-[6px]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[12px] font-medium" style={{ color }}>
          {severity ? CONDITION_LABEL[severity] : "Not flagged"}
        </span>
      </div>
      <div className="text-[12px] text-[#464650]">
        Canopy loss: <strong>{pin.canopyLossByMonth[monthIndex] ?? 0}%</strong>
      </div>
      <div className="text-[11px] text-[#5b5b66] mt-[2px]">
        Last surveyed {pin.monthLabels[monthIndex] ?? ""}
      </div>
      {/* Pointer tail, mirrors the old popup's tip. */}
      <div className="absolute left-1/2 top-full -translate-x-1/2 -mt-px w-2 h-2 bg-white border-r border-b border-[#dedee3] rotate-45" />
    </div>,
    document.body,
  );
}

export default function MapCanvas({
  center,
  zoom = 12.5,
  className = "",
  style,
  show3DToggle = false,
  overlay,
  generativeOverlay,
  dyingTreeOverlay,
  areaId,
  layerTime,
  pinsRange,
  generativeRange,
  areaName,
  layerVisibility,
  onLayerVisibilityChange: setLayerVisibility,
  layerOpacity,
  onLayerOpacityChange: setLayerOpacity,
  basemapIndex,
  onBasemapIndexChange: setBasemapIndex,
  snapshots,
  range,
  isTimelinePlaying,
  visibleTreeIds,
  focusTree,
  inspectTree,
  onExitInspect,
  onFocusArrived,
  onFocusMove,
  onPinClick,
  onPinHover,
  onOverlayQuadChange,
  storyView,
  chrome = true,
}: {
  center: [number, number];
  zoom?: number;
  className?: string;
  /** Inline sizing — the Assets split pane drives width as a percentage. */
  style?: CSSProperties;
  show3DToggle?: boolean;
  overlay?: MapOverlay;
  /** Decorative layer rendered above `overlay`, same footprint — see areaGenerativeOverlays. */
  generativeOverlay?: MapOverlay;
  /** Flat, always-on trace of trees flagged as dying, same footprint — see areaDyingTreeOverlays. */
  dyingTreeOverlay?: MapOverlay;
  areaId?: string;
  /** Per-layer date ranges, so each chip can drive its own coverage strip.
   * Optional: a MapCanvas rendered without chrome has no layer panel. */
  layerTime?: LayerTime;
  /** The range the flagged pins read, which may differ from `range` once the
   * pins layer has been detached in the layer panel. Falls back to `range` so
   * callers that don't split layers behave exactly as before. */
  pinsRange?: DateRange;
  /** The range the generative canopy art reads for its reveal. Same fallback
   * rule as `pinsRange`. */
  generativeRange?: DateRange;
  /** Shown in the layer panel's header — see LayerPanel. */
  areaName?: string;
  /** Lifted to App.tsx so a layer hidden or a basemap picked on one tab's
   * map stays that way on every other map view, instead of resetting each
   * time MapCanvas remounts for a different tab. */
  layerVisibility: Record<ContentLayerId, boolean>;
  onLayerVisibilityChange: Dispatch<SetStateAction<Record<ContentLayerId, boolean>>>;
  /** 0..1 per layer, multiplied onto each layer's own base opacity — see
   * layerOpacityRef below. */
  layerOpacity: Record<ContentLayerId, number>;
  onLayerOpacityChange: Dispatch<SetStateAction<Record<ContentLayerId, number>>>;
  basemapIndex: number;
  onBasemapIndexChange: Dispatch<SetStateAction<number>>;
  /** Backs the flagged-tree pins — see generateTreePins. */
  snapshots: MonthSnapshot[];
  /** Which months' pins to show. Omit to show the full timeline. */
  range?: DateRange;
  /** Pulses the canopy-mask gradient (red <-> green) while the timeline's
   * play button is stepping through months — see the canopy layer effects. */
  isTimelinePlaying?: boolean;
  /**
   * Restricts pins to these tree ids, on top of `range` — this is how the Assets
   * table's health and species filters reach the map, so ticking "Dead" leaves
   * only dead trees on the imagery. Omit to show everything in range.
   */
  visibleTreeIds?: Set<string>;
  /**
   * A tree selected in the Assets table. The camera flies to it and a ring marks
   * the spot — the ring matters because healthy trees carry no pin, so without
   * it selecting one would just zoom into anonymous imagery.
   */
  focusTree?: { id: string; lng: number; lat: number } | null;
  /**
   * A tree whose digital twin is open. Isolates the twin layer, drops the
   * camera to eye level beside that tree and shows its full record — a
   * different act from `focusTree`, which only flies over the plot and rings
   * the spot. Kept as a separate prop for exactly that reason: one is "show me
   * where", the other is "put me there".
   */
  inspectTree?: TreeRecord | null;
  /** Closes the twin — the card's own button, or Escape. */
  onExitInspect?: () => void;
  /** Fires once the fly-to for `focusTree` settles, with that tree's current
   * viewport position — lets a caller (App.tsx) open something (a floating
   * popover) anchored to the pin exactly when the camera arrives, rather than
   * guessing at the flight duration with a timer. */
  onFocusArrived?: (pos: { x: number; y: number }) => void;
  /** Fires on every subsequent camera move while `focusTree` stays set, so a
   * popover anchored to it (see onFocusArrived) can follow pan/zoom/rotate
   * instead of drifting off the pin it's meant to point at. */
  onFocusMove?: (pos: { x: number; y: number }) => void;
  /** Fires with a pin's tree id when it's clicked, in addition to opening its
   * tooltip — lets a caller (AssetsView) select and scroll to the matching
   * table row without this component knowing the table exists. */
  onPinClick?: (treeId: string) => void;
  /** Fires with a pin's tree id on hover, and `null` on pointer-out — a
   * lighter-weight signal than `onPinClick`, meant for a caller (AssetsView)
   * to highlight the matching table row without selecting it or moving the
   * camera. */
  onPinHover?: (treeId: string | null) => void;
  /** Fires with `overlay`'s four corners reprojected to on-screen pixels
   * (viewport-relative, like `onFocusArrived`/`onFocusMove`) on load and on
   * every subsequent pan/zoom/rotate, or `null` once `overlay` is absent —
   * lets a caller (LandingScreen) draw its own outline over the plot's real
   * footprint and detect hovering near it, without owning a map instance. */
  onOverlayQuadChange?: (quad: { x: number; y: number }[] | null) => void;
  /**
   * The map state the Story panel's currently-read block asks for — camera
   * frame, which layers to light, colour treatment. See data/storyMap.ts.
   *
   * Applied once per *change of view object*, never continuously: the story
   * proposes a starting point for each block and then gets out of the way, so
   * panning, tilting or toggling a layer afterwards is never fought. The
   * layers it asks for are a view override on top of `layerVisibility` rather
   * than a write to it — same reasoning as `isolatedId` below.
   */
  storyView?: StoryMapView | null;
  /** Set false to render the map bare — no layer panel, toolbar or overlay-
   * height slider. The project-overview first screen (LandingScreen) brings
   * its own sidebar and tool strip from the Figma design and would otherwise
   * stack two competing sets of map chrome on top of each other. */
  chrome?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // The full-timeline pin pool, built once per overlay/area. A ref rather than
  // state: rebuilding it doesn't need a re-render, only the separate
  // range-visibility effect (below) reading it does.
  const pinsRef = useRef<{ pin: TreePin; marker: maplibregl.Marker }[]>([]);
  // The ring drawn over a tree selected in the Assets table.
  const focusMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Which of the two aerial-overlay slots (OVERLAY_*_ID_A/B) is currently
  // showing, and what the previous overlay prop was -- used to tell a hard
  // switch (new area/coordinates: reset outright) from a soft one (same area,
  // different timelapse bucket: crossfade) apart. A pending crossfade timeout
  // is tracked so a rapid second swap can cancel and clean up immediately
  // instead of letting two crossfades collide and leave a stray layer behind.
  const activeOverlaySlotRef = useRef<"A" | "B">("A");
  const prevOverlayRef = useRef<MapOverlay | undefined>(undefined);
  const overlayCrossfadeTimeoutRef = useRef<number | null>(null);
  const [is3D, setIs3D] = useState(false);
  // A whole-map CSS filter (see index.css's .map-color-mode / mapColorModes.ts),
  // not a basemap swap or a WebGL shader -- each mode's recipe remaps the
  // rendered canvas's colours (e.g. thermal grayscales to pure luminance
  // first, then re-tints into a black -> orange -> white heat ramp)
  // regardless of which basemap or overlays happen to be showing
  // underneath, rather than needing its own recoloured tile set per mode.
  // Contrast is a separate multiplier composed on top of whichever mode is
  // active (buildMapFilter), so it works the same way in every mode.
  const [colorMode, setColorMode] = useState<MapColorMode>("normal");
  const [mapContrast, setMapContrast] = useState(DEFAULT_MAP_CONTRAST);
  // "Isolate": one content layer on an empty canvas — every other layer off
  // AND the basemap blacked out, so the 3D canopy can be read as geometry
  // rather than as a thing sitting on a photo.
  //
  // Deliberately a view override rather than a mutation of `layerVisibility`:
  // the panel keeps showing what the user actually chose, and leaving
  // isolation restores every layer exactly as it was without having to
  // remember a pre-isolation snapshot.
  const [isolatedId, setIsolatedId] = useState<ContentLayerId | null>(null);
  /**
   * The layer set the current story block asked for, or null when the story
   * isn't driving (every tab but Story, or once the reader has overridden it
   * from the layer panel — see the panel's handlers below, which clear this).
   *
   * The same view-override reasoning as `isolatedId`: the panel keeps showing
   * the reader's own choices, and stepping out of the story restores them with
   * nothing to remember.
   */
  const [storyLayers, setStoryLayers] = useState<Set<ContentLayerId> | null>(null);

  /** Every layer off except the ones named — the shape both overrides need. */
  const onlyLayers = (on: (id: ContentLayerId) => boolean) =>
    Object.fromEntries(LAYER_ORDER.map((id) => [id, on(id)])) as Record<ContentLayerId, boolean>;

  // Three sources want a say in what is visible, and they are ranked by how
  // deliberate the act behind each one was:
  //
  //   isolate  — someone pressed a button meaning "only this". The most
  //              specific request available, so nothing outranks it.
  //   story    — nobody asked for this directly; it came attached to the block
  //              being read. A suggestion, and suggestions lose to instructions
  //              — which is also why touching the layer panel clears it (see
  //              the panel's handlers) rather than being overridden here.
  //   panel    — the reader's standing choices, and the answer whenever neither
  //              override is in play.
  //
  // Both overrides are exhaustive: they name what is on, and everything else is
  // off. An additive story view would inherit whatever the previous block left
  // showing, so the same block would mean different things depending on how you
  // arrived at it.
  const effectiveVisibility = useMemo(() => {
    if (isolatedId) return onlyLayers((id) => id === isolatedId);
    if (storyLayers) return onlyLayers((id) => storyLayers.has(id));
    return layerVisibility;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isolatedId, storyLayers, layerVisibility]);

  /**
   * The same value, readable from the async callbacks that add layers.
   *
   * The generative trace and the dying-trees trace are both added from an
   * `Image.onload`, which can land long after the effect that sets their
   * visibility has run — and that effect only re-fires when the boolean it
   * watches *changes*. A layer created into an already-settled "hidden" state
   * therefore appeared at the style default (visible) with nothing left to turn
   * it off. Latent for as long as visibility only ever changed by hand; the
   * story's exhaustive layer sets hit it on the first block.
   */
  const effectiveVisibilityRef = useRef(effectiveVisibility);
  effectiveVisibilityRef.current = effectiveVisibility;

  /** Applies the current visibility to a layer the moment it is added, for the
   * async creation paths that would otherwise miss it. */
  function applyCurrentVisibility(map: maplibregl.Map, layerId: string, id: ContentLayerId) {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, "visibility", effectiveVisibilityRef.current[id] ? "visible" : "none");
  }
  const is3DRef = useRef(is3D);
  is3DRef.current = is3D;
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({ width: 0, height: 0, webgl: true });
  const [overlayMissing, setOverlayMissing] = useState(false);
  // True only once the raster layer is actually on the map. Pins are scoped to
  // the imagery, so they must not appear over a bare basemap when it isn't.
  const [overlayReady, setOverlayReady] = useState(false);
  const [pinCounts, setPinCounts] = useState<Record<PinSeverity, number> | null>(null);
  const [bearing, setBearing] = useState(0);
  const [activePin, setActivePin] = useState<PinTooltipState | null>(null);
  // The month the pins are currently painted for. Held in a ref because the
  // marker click handlers are bound once when the pool is built and would
  // otherwise close over a stale month for the rest of the session.
  const displayMonthRef = useRef(0);
  // The panel's strips need month labels, and MapCanvas holds snapshots rather
  // than labels — memoized so the chips' own coverage memo isn't invalidated by
  // a fresh array on every render.
  const monthLabelsForPanel = useMemo(() => snapshots.map((s) => s.label), [snapshots]);
  // Whether the open pin popover is showing its full history form instead of
  // the compact tooltip — toggled by the expand/collapse affordances on each,
  // not a state of its own separate from `activePin`.
  const [pinExpanded, setPinExpanded] = useState(false);
  // Full tree records keyed by id, rebuilt alongside the pin pool below —
  // `generateTreePins` only carries the map-relevant subset of fields, so
  // expanding a pin into the full history modal (which wants species,
  // diameter, height too) needs this richer lookup.
  const treeRecordsRef = useRef<Map<string, TreeRecord>>(new Map());
  // The dying-trees glow halo's rendered data URL, cached here once built (see
  // the dedicated dyingTreeOverlay effect) so the basemap-swap rebuild below
  // can re-add it synchronously instead of re-running the blur render.
  const dyingGlowUrlRef = useRef<string | null>(null);
  // Mirrored into a ref (rather than read from the `layerOpacity` prop
  // directly) so the async image-probe callbacks below -- which bake the
  // current factor into a layer's very first paint call to avoid a
  // flash-then-correct -- always read the live value regardless of how long
  // decoding took, and so the glow's per-frame rAF tick (well outside React's
  // render cycle) can read it too.
  const layerOpacityRef = useRef(layerOpacity);
  layerOpacityRef.current = layerOpacity;
  // Read by generativeRevealOpacity below, and by anything else that needs
  // the live selection outside React's render cycle (paint-property updates
  // fire from map event handlers, not renders).
  const rangeRef = useRef(range);
  rangeRef.current = range;
  // The generative reveal reads its own layer's range when that layer has been
  // detached — kept in a ref for the same reason rangeRef is: the paint
  // callbacks below run outside React's render and would otherwise close over
  // a stale value.
  const generativeRangeRef = useRef(generativeRange ?? range);
  generativeRangeRef.current = generativeRange ?? range;
  // Separation from the aerial photo, in metres, per layer — see
  // DEFAULT_LAYER_HEIGHT. Mirrored into a ref because the custom layer's
  // render loop and the position-update callbacks below read it every frame,
  // outside React's render cycle.
  const [layerHeight, setLayerHeight] = useState(DEFAULT_LAYER_HEIGHT);
  const layerHeightRef = useRef(layerHeight);
  layerHeightRef.current = layerHeight;
  // Ground contact under the 3D canopy. Not part of the per-layer records
  // above: it is the only layer with geometry that can cast anything, so a
  // record would be five entries nothing ever reads. Held in a ref as well
  // because the layer is constructed inside an effect that must not re-run
  // (and refetch three.js) just because the mode changed.
  const [shadowMode, setShadowMode] = useState<CanopyShadowMode>(DEFAULT_SHADOW_MODE);
  const shadowModeRef = useRef(shadowMode);
  shadowModeRef.current = shadowMode;
  // Lets the height-change effect re-apply the offset immediately without
  // re-running the layer-creation effect (which would refetch the image).
  const generativeUpdatePositionRef = useRef<(() => void) | null>(null);
  // Same idea, for the dying-trees trace — it used to share the generative
  // layer's own height (both "lifted together"); each now reads its own entry
  // out of layerHeightRef instead.
  const dyingUpdatePositionRef = useRef<(() => void) | null>(null);

  // The gradient-recoloured canopy mask -- built once (module-cached) and
  // held in state so the layer-creation effect below can wait for it.
  const [canopyImageUrl, setCanopyImageUrl] = useState<string | null>(null);
  // Tracks the aerial photo's own footprint (not its url) so a timelapse
  // frame swap -- same coordinates, new photo -- doesn't tear down and
  // re-add the mask layer every step; only a genuine area change should.
  const prevCanopyCoordsRef = useRef<string | null>(null);

  const isFirstBasemapRef = useRef(true);
  // Bumped after a basemap swap re-adds the terrain source, so the
  // overlay/canopy/generative layer-creation effects below -- which each
  // bail out early when *their own* props haven't changed -- get a reason to
  // re-run and rebuild sources/layers that `setStyle` just wiped out.
  const [styleVersion, setStyleVersion] = useState(0);

  // `setStyle` throws away every source and layer not defined in the new
  // style, including the terrain DEM and this app's own raster overlays — so
  // swapping basemaps means re-adding all of it once the new style settles.
  // This rebuilds them directly rather than resetting prevOverlayRef/
  // prevCanopyCoordsRef to make the overlay/canopy effects redo it: that
  // path forces a "hard switch", which flips `overlayReady` false→true —
  // and the auto-fit-to-3D effect further down explicitly documents relying
  // on `overlayReady` flipping true only once per mount to know not to
  // re-run. Rebuilding here directly leaves that invariant alone.
  useEffect(() => {
    if (isFirstBasemapRef.current) {
      isFirstBasemapRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    // Guards against StrictMode's dev-only double-invoke of this effect,
    // which would otherwise fire two overlapping `setStyle` calls and let a
    // stale `style.load` handler race the real one into re-adding sources
    // before the surviving style has settled.
    let cancelled = false;

    map.setStyle(BASEMAPS[basemapIndex].style);
    // `style.load` is the documented event for "safe to re-add sources/layers
    // now", but it doesn't reliably fire after a `setStyle` call (only ever
    // observed after the Map's very first style load) — `idle` does fire
    // reliably once the new style has settled, so that's what's used here.
    map.once("idle", () => {
      if (cancelled) return;
      const m = mapRef.current;
      if (!m) return;

      m.addSource(TERRAIN_SOURCE_ID, {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: 15,
      });
      if (is3DRef.current) {
        // A bare `setTerrain` here, in the same tick as `setStyle` settling,
        // occasionally throws deep inside MapLibre's terrain depth pre-pass
        // (`shaderPreludeCode` undefined) — the new style's renderer/program
        // cache isn't fully wired up yet. A single requestAnimationFrame
        // wasn't a reliable enough delay (it can fire before the map's own
        // render loop has painted the new style even once); waiting for the
        // map's own "render" event guarantees at least one real paint of the
        // new style has already happened.
        map.once("render", () => {
          const m2 = mapRef.current;
          if (!cancelled && m2 && m2.getSource(TERRAIN_SOURCE_ID)) {
            m2.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
          }
        });
      }

      if (overlay) {
        m.addSource(OVERLAY_SOURCE_ID_A, { type: "image", url: overlay.url, coordinates: overlay.coordinates });
        m.addLayer({
          id: OVERLAY_LAYER_ID_A,
          type: "raster",
          source: OVERLAY_SOURCE_ID_A,
          paint: { "raster-opacity": (overlay.opacity ?? 1) * layerOpacityRef.current.aerial, "raster-fade-duration": 300 },
        });
        activeOverlaySlotRef.current = "A";
        prevOverlayRef.current = overlay;
      }

      if (overlay && canopyImageUrl) {
        m.addSource(CANOPY_SOURCE_ID, { type: "image", url: canopyImageUrl, coordinates: overlay.coordinates });
        m.addLayer({
          id: CANOPY_LAYER_ID,
          type: "raster",
          source: CANOPY_SOURCE_ID,
          paint: { "raster-opacity": CANOPY_OPACITY * layerOpacityRef.current.canopy, "raster-fade-duration": 300 },
        });
        prevCanopyCoordsRef.current = JSON.stringify(overlay.coordinates);
      }

      if (generativeOverlay) {
        m.addSource(GENERATIVE_SOURCE_ID, {
          type: "image",
          url: generativeOverlay.url,
          coordinates: generativeOverlay.coordinates,
        });
        m.addLayer({
          id: GENERATIVE_LAYER_ID,
          type: "raster",
          source: GENERATIVE_SOURCE_ID,
          paint: {
            "raster-opacity": generativeRevealOpacity(generativeRangeRef.current) * layerOpacityRef.current.generative,
            "raster-opacity-transition": { duration: 250 },
            "raster-fade-duration": 0,
          },
        });
        generativeUpdatePositionRef.current?.();
      }

      if (dyingTreeOverlay) {
        // Reuses the already-rendered glow data URL rather than re-running the
        // blur -- this rebuild happens synchronously inside the style-settle
        // callback, with no loaded <img> handy to derive a fresh one from.
        if (dyingGlowUrlRef.current) {
          m.addSource(DYING_GLOW_SOURCE_ID, {
            type: "image",
            url: dyingGlowUrlRef.current,
            coordinates: dyingTreeOverlay.coordinates,
          });
          m.addLayer({
            id: DYING_GLOW_LAYER_ID,
            type: "raster",
            source: DYING_GLOW_SOURCE_ID,
            paint: { "raster-opacity": DYING_GLOW_MIN_OPACITY * layerOpacityRef.current.dyingTrees, "raster-fade-duration": 0 },
          });
        }
        m.addSource(DYING_SOURCE_ID, {
          type: "image",
          url: dyingTreeOverlay.url,
          coordinates: dyingTreeOverlay.coordinates,
        });
        m.addLayer({
          id: DYING_LAYER_ID,
          type: "raster",
          source: DYING_SOURCE_ID,
          paint: { "raster-opacity": DYING_OPACITY * layerOpacityRef.current.dyingTrees, "raster-fade-duration": 0 },
        });
        dyingUpdatePositionRef.current?.();
      }

      ensureGenerativeOnTop(m);
      setStyleVersion((v) => v + 1);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapIndex]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let timeoutId = 0;

    // MapLibre sizes its canvas from the container at construction time. If the
    // container is still 0×0 then (common inside flex/iframe layouts that haven't
    // settled), the canvas is created 0×0 and stays blank forever. So: only build
    // the map once the container actually has a size, and re-measure on every
    // later size change.
    function init() {
      if (cancelled || mapRef.current || !el) return;
      const { width, height } = el.getBoundingClientRect();
      setDiagnostics(readDiagnostics(el));
      if (width < 1 || height < 1) return;

      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: el,
          // Seeds from the shared basemapIndex (see App.tsx) so a fresh
          // MapCanvas mount -- e.g. switching from the Maps tab to Assets --
          // starts on whichever basemap was already picked, rather than
          // always resetting to OpenStreetMap.
          style: BASEMAPS[basemapIndex].style,
          center,
          zoom,
          pitch: 0,
          bearing: 0,
          canvasContextAttributes: { preserveDrawingBuffer: true },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't create a WebGL context, which the map requires.");
        return;
      }
      mapRef.current = map;

      // Dev-only handle so the map can be driven and measured from the console
      // or a browser-automation check (pin placement, camera state, tile loads).
      // `import.meta.env.DEV` is statically false in a production build, so this
      // whole branch is dropped by the bundler.
      if (import.meta.env.DEV) {
        (window as unknown as { __nabatMap?: maplibregl.Map }).__nabatMap = map;
      }

      timeoutId = window.setTimeout(() => {
        setError((prev) => prev ?? "The map style or tiles didn't finish loading in time. Check the browser console for network or Content-Security-Policy errors blocking tiles.openfreemap.org.");
      }, LOAD_TIMEOUT_MS);

      map.on("error", (e) => {
        // A failed tile fetch on a supplementary raster source — the terrain
        // DEM (now requested automatically whenever 3D auto-enables on tab
        // switch, not just on a manual click) or the aerial overlay — isn't
        // fatal: the base map keeps working fine without that one tile.
        // MapLibre attaches `sourceId` to these dynamically; it isn't in the
        // event's static type, hence the cast. Only an error with no
        // recognized non-critical source (a style/vector-tile problem) should
        // take down the whole map.
        const sourceId = (e as unknown as { sourceId?: string }).sourceId;
        if (
          sourceId === TERRAIN_SOURCE_ID ||
          sourceId === OVERLAY_SOURCE_ID_A ||
          sourceId === OVERLAY_SOURCE_ID_B ||
          sourceId === GENERATIVE_SOURCE_ID ||
          sourceId === DYING_SOURCE_ID ||
          sourceId === DYING_GLOW_SOURCE_ID ||
          sourceId === CANOPY_SOURCE_ID
        ) {
          console.warn(`Non-fatal tile error on source "${sourceId}":`, e.error?.message);
          return;
        }
        window.clearTimeout(timeoutId);
        setError(e.error?.message ?? "Unknown map error.");
      });

      // No default NavigationControl — MapToolbar provides the navigation UI in
      // the dashboard's own visual language.
      map.on("rotate", () => setBearing(map.getBearing()));

      // The one signal AIAssistant's proactive tip waits on — see
      // notifyFirstMapInteraction. `.once` on each so a single map instance
      // that's dragged repeatedly doesn't keep re-attempting the (already
      // no-op'd) dispatch.
      map.once("dragstart", notifyFirstMapInteraction);
      map.once("zoomstart", notifyFirstMapInteraction);
      map.once("click", notifyFirstMapInteraction);

      // Zoomed-out pins crossfade from crisp teardrop icons into soft glowing
      // circles — set as a single CSS custom property on the container
      // (inherited by every pin, see index.css) rather than React state or a
      // per-marker loop, since "zoom" fires continuously during a zoom
      // gesture/animation and this needs to stay cheap at that frequency.
      function updatePinFilter() {
        if (!el) return;
        const t = zoomedOutFactor(map.getZoom());
        el.style.setProperty("--pin-t", t.toFixed(3));
        // A discrete flag for the parts that can't be expressed as a smooth
        // opacity ramp: the ground ripple animates its own opacity in
        // keyframes, so an opacity rule here would simply lose to it.
        el.classList.toggle("map--blob-mode", t > 0.55);
      }
      map.on("zoom", updatePinFilter);
      updatePinFilter();

      map.on("load", () => {
        window.clearTimeout(timeoutId);
        setLoaded(true);
        setError(null);
        map.addSource(TERRAIN_SOURCE_ID, {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 15,
        });
        map.resize();
      });
    }

    // Fires once on observe, then on every container resize — this both kicks off
    // the deferred init and keeps the canvas in sync with its box afterwards.
    const observer = new ResizeObserver(() => {
      if (cancelled) return;
      setDiagnostics(readDiagnostics(el));
      if (!mapRef.current) init();
      else mapRef.current.resize();
    });
    observer.observe(el);
    init();

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timeoutId);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The map is created once with the initial center/zoom; when the caller passes
  // a new center — e.g. switching areas in the Assets tab — fly the existing map
  // instance there instead of recreating it.
  const isFirstCenter = useRef(true);
  useEffect(() => {
    if (isFirstCenter.current) {
      isFirstCenter.current = false;
      return;
    }
    mapRef.current?.flyTo({ center, zoom, duration: 1200 });
  }, [center, zoom]);

  // Georeferenced aerial overlay: an `image` source pinned to four ground
  // corners, so it stays locked to the terrain while panning/zooming/tilting.
  //
  // A "hard switch" -- no previous overlay, or the ground footprint itself
  // changed (a genuinely different area) -- resets outright: both slots are
  // cleared and the new image loads fresh into slot A. A "soft swap" -- same
  // coordinates, only `url` differs, which is exactly what dragging the
  // timeline across a timelapse bucket produces (see overlays.ts) -- instead
  // crossfades: the new image loads into whichever slot isn't showing, fades
  // up while the old one fades down (MapLibre's built-in paint-property
  // transition, not a manual rAF loop), and only once that finishes does the
  // old slot's source/layer actually get removed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const prev = prevOverlayRef.current;
    const isHardSwitch = !prev || !overlay || JSON.stringify(prev.coordinates) !== JSON.stringify(overlay.coordinates);

    if (isHardSwitch) {
      if (overlayCrossfadeTimeoutRef.current !== null) {
        window.clearTimeout(overlayCrossfadeTimeoutRef.current);
        overlayCrossfadeTimeoutRef.current = null;
      }
      if (map.getLayer(OVERLAY_LAYER_ID_A)) map.removeLayer(OVERLAY_LAYER_ID_A);
      if (map.getSource(OVERLAY_SOURCE_ID_A)) map.removeSource(OVERLAY_SOURCE_ID_A);
      if (map.getLayer(OVERLAY_LAYER_ID_B)) map.removeLayer(OVERLAY_LAYER_ID_B);
      if (map.getSource(OVERLAY_SOURCE_ID_B)) map.removeSource(OVERLAY_SOURCE_ID_B);
      activeOverlaySlotRef.current = "A";
      setOverlayMissing(false);
      setOverlayReady(false);
      prevOverlayRef.current = overlay;

      if (!overlay) return;

      let cancelled = false;
      // Preload the file first: if it's missing, skip the overlay rather than
      // letting a 404 surface as a fatal map error and hide the whole basemap.
      const probe = new Image();
      probe.onload = () => {
        if (cancelled || !mapRef.current) return;
        const m = mapRef.current;
        if (m.getSource(OVERLAY_SOURCE_ID_A)) return;
        m.addSource(OVERLAY_SOURCE_ID_A, { type: "image", url: overlay.url, coordinates: overlay.coordinates });
        m.addLayer({
          id: OVERLAY_LAYER_ID_A,
          type: "raster",
          source: OVERLAY_SOURCE_ID_A,
          paint: { "raster-opacity": (overlay.opacity ?? 1) * layerOpacityRef.current.aerial, "raster-fade-duration": 300 },
        });
        ensureGenerativeOnTop(m);
        setOverlayReady(true);
      };
      probe.onerror = () => {
        if (!cancelled) setOverlayMissing(true);
      };
      probe.src = overlay.url;

      return () => {
        cancelled = true;
      };
    }

    // Soft swap. `overlay` is non-null here (isHardSwitch already covered the
    // null case), and its url actually differs from `prev`'s or this effect
    // wouldn't be worth re-running -- but the dependency array can't express
    // "only on url change" directly, so bail out cheaply if url is unchanged
    // (e.g. this ran again only because `loaded` or another dep ticked).
    if (overlay.url === prev.url) return;
    prevOverlayRef.current = overlay;

    const outgoingSlot = activeOverlaySlotRef.current;
    const incomingSlot = outgoingSlot === "A" ? "B" : "A";
    const outgoingSourceId = outgoingSlot === "A" ? OVERLAY_SOURCE_ID_A : OVERLAY_SOURCE_ID_B;
    const outgoingLayerId = outgoingSlot === "A" ? OVERLAY_LAYER_ID_A : OVERLAY_LAYER_ID_B;
    const incomingSourceId = incomingSlot === "A" ? OVERLAY_SOURCE_ID_A : OVERLAY_SOURCE_ID_B;
    const incomingLayerId = incomingSlot === "A" ? OVERLAY_LAYER_ID_A : OVERLAY_LAYER_ID_B;

    // A rapid second swap arriving before the previous crossfade's cleanup
    // fired: finish that cleanup immediately rather than letting a third
    // layer pile up on top of two already-fading ones.
    if (overlayCrossfadeTimeoutRef.current !== null) {
      window.clearTimeout(overlayCrossfadeTimeoutRef.current);
      overlayCrossfadeTimeoutRef.current = null;
      if (map.getLayer(incomingLayerId)) map.removeLayer(incomingLayerId);
      if (map.getSource(incomingSourceId)) map.removeSource(incomingSourceId);
    }

    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled || !mapRef.current) return;
      const m = mapRef.current;
      if (m.getSource(incomingSourceId)) return;
      m.addSource(incomingSourceId, { type: "image", url: overlay.url, coordinates: overlay.coordinates });
      m.addLayer({
        id: incomingLayerId,
        type: "raster",
        source: incomingSourceId,
        paint: {
          "raster-opacity": 0,
          "raster-opacity-transition": { duration: OVERLAY_CROSSFADE_MS },
          "raster-fade-duration": 0,
        },
      });
      ensureGenerativeOnTop(m);

      // MapLibre animates a *change* to raster-opacity, so the starting value
      // has to be committed and actually rendered before the target is set --
      // otherwise both values land inside the same style update and it paints
      // at the target immediately, with no transition. A requestAnimationFrame
      // here is too early (it runs before the map's own render), which showed
      // up as a mid-fade screenshot pixel-identical to the settled one; waiting
      // for the map to report a rendered frame is what actually works.
      const beginFade = () => {
        if (cancelled || !mapRef.current) return;
        const m2 = mapRef.current;
        if (m2.getLayer(incomingLayerId))
          m2.setPaintProperty(incomingLayerId, "raster-opacity", (overlay.opacity ?? 1) * layerOpacityRef.current.aerial);
        if (m2.getLayer(outgoingLayerId)) {
          m2.setPaintProperty(outgoingLayerId, "raster-opacity-transition", { duration: OVERLAY_CROSSFADE_MS });
          m2.setPaintProperty(outgoingLayerId, "raster-opacity", 0);
        }
      };
      m.once("render", () => window.setTimeout(beginFade, 0));

      activeOverlaySlotRef.current = incomingSlot;
      overlayCrossfadeTimeoutRef.current = window.setTimeout(() => {
        overlayCrossfadeTimeoutRef.current = null;
        const m3 = mapRef.current;
        if (!m3) return;
        if (m3.getLayer(outgoingLayerId)) m3.removeLayer(outgoingLayerId);
        if (m3.getSource(outgoingSourceId)) m3.removeSource(outgoingSourceId);
      }, OVERLAY_CROSSFADE_MS + 80);
    };
    probe.onerror = () => {
      // The bucket's file is missing: stay on the currently-showing image
      // rather than fading to nothing.
    };
    probe.src = overlay.url;

    return () => {
      cancelled = true;
    };
  }, [overlay, loaded]);

  // Generative-art vector trace, hovering above the aerial photo at the same
  // footprint (ensureGenerativeOnTop keeps it stacked correctly regardless of
  // which overlay's async image probe resolves first).
  //
  // The apparent height is faked by offsetting the overlay along the ground,
  // because a MapLibre raster layer has no elevation of any kind. The offset
  // has to be computed from the camera, not just latitude: a lifted point is
  // displaced up-screen by h·sin(pitch), and a ground point displaced away
  // from the camera by d is displaced up-screen by d·cos(pitch), so
  // d = h·tan(pitch), applied along the current bearing.
  //
  // The earlier version shifted latitude only, which is the bearing-0 special
  // case of this. Measured at pitch 60, that read as UP at bearing 0 but
  // sideways at 90/270 and DOWN (sunken) at 180 — fine while the camera was
  // pinned to the auto-frame's -20°, but not something to hang a user-facing
  // distance control off. This version measures identically at every bearing.
  //
  // Height comes from a ref so dragging the slider repositions the layer
  // without tearing it down and re-fetching the image on every input event.
  //
  // No self-driving animation loop any more — the artwork used to also pulse
  // its own opacity and bob a couple of metres on a sine wave regardless of
  // what the camera or the user were doing, which read as gimmicky rather
  // than "lifted off the photo". The height offset itself is legitimate
  // positioning, not decoration: it still has to be recomputed whenever the
  // camera's pitch or bearing changes (d = h·tan(pitch) along bearing, same
  // derivation as before), so this listens to the map's own `move` event
  // instead of driving its own clock.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    if (map.getLayer(GENERATIVE_LAYER_ID)) map.removeLayer(GENERATIVE_LAYER_ID);
    if (map.getSource(GENERATIVE_SOURCE_ID)) map.removeSource(GENERATIVE_SOURCE_ID);
    if (!generativeOverlay) return;

    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled || !mapRef.current) return;
      const m = mapRef.current;
      if (m.getSource(GENERATIVE_SOURCE_ID)) return;
      m.addSource(GENERATIVE_SOURCE_ID, {
        type: "image",
        url: generativeOverlay.url,
        coordinates: generativeOverlay.coordinates,
      });
      m.addLayer({
        id: GENERATIVE_LAYER_ID,
        type: "raster",
        source: GENERATIVE_SOURCE_ID,
        paint: {
          "raster-opacity": generativeRevealOpacity(generativeRangeRef.current) * layerOpacityRef.current.generative,
          "raster-opacity-transition": { duration: 250 },
          "raster-fade-duration": 0,
        },
      });
      applyCurrentVisibility(m, GENERATIVE_LAYER_ID, "generative");
      ensureGenerativeOnTop(m);

      const baseCoordinates = generativeOverlay.coordinates;
      const centreLat = (baseCoordinates[0][1] + baseCoordinates[2][1]) / 2;
      const metresPerDegLat = 111_320;
      const metresPerDegLng = 111_320 * Math.cos((centreLat * Math.PI) / 180);

      function updatePosition() {
        const m2 = mapRef.current;
        if (!m2 || !m2.getLayer(GENERATIVE_LAYER_ID)) return;
        const ground = layerHeightRef.current.generative * Math.tan((m2.getPitch() * Math.PI) / 180);
        const bearingRad = (m2.getBearing() * Math.PI) / 180;
        const dLat = (ground * Math.cos(bearingRad)) / metresPerDegLat;
        const dLng = (ground * Math.sin(bearingRad)) / metresPerDegLng;

        const source = m2.getSource(GENERATIVE_SOURCE_ID);
        if (source && "setCoordinates" in source) {
          (source as maplibregl.ImageSource).setCoordinates(
            baseCoordinates.map(([lng, lat]) => [lng + dLng, lat + dLat]) as MapOverlay["coordinates"],
          );
        }
      }
      updatePosition();
      m.on("move", updatePosition);
      generativeUpdatePositionRef.current = updatePosition;
      moveHandler = updatePosition;
    };
    probe.onerror = () => {
      // Decorative and non-critical — unlike the aerial overlay, a missing
      // generative asset gets no "not found" notice, it just quietly skips.
    };
    probe.src = generativeOverlay.url;

    let moveHandler: (() => void) | null = null;
    return () => {
      cancelled = true;
      generativeUpdatePositionRef.current = null;
      const m = mapRef.current;
      if (m && moveHandler) m.off("move", moveHandler);
    };
  }, [generativeOverlay, loaded]);

  // Dying-trees trace: same footprint as the generative overlay, but flat --
  // no height offset, no hover-dim mask -- so this is a plain load/add/remove
  // on prop change, mirroring the canopy mask's simplicity rather than the
  // generative layer's camera-driven positioning.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    if (map.getLayer(DYING_LAYER_ID)) map.removeLayer(DYING_LAYER_ID);
    if (map.getSource(DYING_SOURCE_ID)) map.removeSource(DYING_SOURCE_ID);
    if (map.getLayer(DYING_GLOW_LAYER_ID)) map.removeLayer(DYING_GLOW_LAYER_ID);
    if (map.getSource(DYING_GLOW_SOURCE_ID)) map.removeSource(DYING_GLOW_SOURCE_ID);
    if (!dyingTreeOverlay) return;

    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled || !mapRef.current) return;
      const m = mapRef.current;
      if (m.getSource(DYING_SOURCE_ID)) return;
      // The glow halo is derived from this same already-decoded image (see
      // renderGlowHalo) rather than a second fetch of the same URL.
      const glowUrl = renderGlowHalo(probe, DYING_GLOW_MAX_WIDTH);
      dyingGlowUrlRef.current = glowUrl;
      m.addSource(DYING_GLOW_SOURCE_ID, {
        type: "image",
        url: glowUrl,
        coordinates: dyingTreeOverlay.coordinates,
      });
      m.addLayer({
        id: DYING_GLOW_LAYER_ID,
        type: "raster",
        source: DYING_GLOW_SOURCE_ID,
        paint: { "raster-opacity": DYING_GLOW_MIN_OPACITY * layerOpacityRef.current.dyingTrees, "raster-fade-duration": 0 },
      });
      m.addSource(DYING_SOURCE_ID, {
        type: "image",
        url: dyingTreeOverlay.url,
        coordinates: dyingTreeOverlay.coordinates,
      });
      m.addLayer({
        id: DYING_LAYER_ID,
        type: "raster",
        source: DYING_SOURCE_ID,
        paint: { "raster-opacity": DYING_OPACITY * layerOpacityRef.current.dyingTrees, "raster-fade-duration": 0 },
      });
      applyCurrentVisibility(m, DYING_LAYER_ID, "dyingTrees");
      applyCurrentVisibility(m, DYING_GLOW_LAYER_ID, "dyingTrees");
      ensureGenerativeOnTop(m);

      // Its own height, independent of the generative trace's -- same
      // derivation (liftCoordinates) applied to its own entry in
      // layerHeightRef, moving both the crisp trace and its glow halo's
      // source together so the halo never separates from the shapes it's
      // supposed to be glowing around.
      const baseCoordinates = dyingTreeOverlay.coordinates;
      function updatePosition() {
        const m2 = mapRef.current;
        if (!m2) return;
        const lifted = liftCoordinates(baseCoordinates, m2, layerHeightRef.current.dyingTrees);
        const source = m2.getSource(DYING_SOURCE_ID);
        if (source && "setCoordinates" in source) (source as maplibregl.ImageSource).setCoordinates(lifted);
        const glowSource = m2.getSource(DYING_GLOW_SOURCE_ID);
        if (glowSource && "setCoordinates" in glowSource) (glowSource as maplibregl.ImageSource).setCoordinates(lifted);
      }
      updatePosition();
      m.on("move", updatePosition);
      dyingUpdatePositionRef.current = updatePosition;
      moveHandler = updatePosition;
    };
    probe.onerror = () => {
      // Decorative and non-critical, same as the generative overlay --
      // a missing dying-trees asset just quietly skips.
    };
    probe.src = dyingTreeOverlay.url;

    let moveHandler: (() => void) | null = null;
    return () => {
      cancelled = true;
      dyingUpdatePositionRef.current = null;
      const m = mapRef.current;
      if (m && moveHandler) m.off("move", moveHandler);
    };
  }, [dyingTreeOverlay, loaded]);

  // Pulses the glow halo's opacity on its own slow breathing cycle, entirely
  // independent of the timeline-playback canopy pulse above — this one runs
  // continuously whenever the layer is visible, since it's meant to read as
  // "this area needs attention right now," not a response to scrubbing dates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !dyingTreeOverlay || !effectiveVisibility.dyingTrees) return;

    let raf = 0;
    let stopped = false;
    const start = performance.now();
    function tick(now: number) {
      if (stopped) return;
      // The glow layer is added asynchronously (its image still has to
      // decode — see the effect above), so this keeps polling via its own
      // rAF loop rather than bailing out for good on the first frame it
      // doesn't find the layer yet; once it exists, the pulse just starts.
      const m = mapRef.current;
      if (m && m.getLayer(DYING_GLOW_LAYER_ID)) {
        const phase = ((now - start) % DYING_GLOW_PERIOD_MS) / DYING_GLOW_PERIOD_MS;
        // 0..1..0 triangle-smoothed into a sine, so it breathes rather than
        // ramping linearly up and snapping back down.
        const t = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
        const opacity = DYING_GLOW_MIN_OPACITY + t * (DYING_GLOW_MAX_OPACITY - DYING_GLOW_MIN_OPACITY);
        m.setPaintProperty(DYING_GLOW_LAYER_ID, "raster-opacity", opacity * layerOpacityRef.current.dyingTrees);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [dyingTreeOverlay, loaded, effectiveVisibility.dyingTrees, styleVersion]);

  // 3D canopy volume: a modelled tree standing in every crown the generative
  // artwork traces. The crown table loads wherever that artwork exists, not
  // only while the layer is switched on — the panel hides the chip until the
  // table has arrived, so gating the fetch on visibility would strand a user
  // who turned the layer off: no chip, and therefore no way back on.
  //
  // The genuinely expensive dependency, three.js, stays lazy regardless: it is
  // dynamically imported by TreeCanopyLayer itself, on `onAdd`.
  const [canopies, setCanopies] = useState<Canopy[]>([]);
  useEffect(() => {
    if (!generativeOverlay || canopies.length > 0) return;
    let cancelled = false;
    loadCanopies().then((table) => {
      if (!cancelled) setCanopies(table);
    });
    return () => {
      cancelled = true;
    };
  }, [generativeOverlay, canopies.length]);

  const treeLayerRef = useRef<TreeCanopyLayer | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!generativeOverlay || !effectiveVisibility.trees3d || canopies.length === 0) return;

    // Added last, so it draws over the rasters — a custom layer has no
    // `moveLayer` counterpart in ensureGenerativeOnTop, and depending on
    // `styleVersion` means it is re-added after those rasters on every
    // basemap swap (setStyle discards custom layers along with everything
    // else) rather than surviving underneath them.
    const layer = new TreeCanopyLayer({
      id: TREES_3D_LAYER_ID,
      coordinates: generativeOverlay.coordinates,
      canopies,
      widthMeters: plotWidthMeters(areaId),
      opacity: layerOpacityRef.current.trees3d,
      reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
      shadowMode: shadowModeRef.current,
    });
    map.addLayer(layer);
    treeLayerRef.current = layer;

    return () => {
      treeLayerRef.current = null;
      const m = mapRef.current;
      // Guarded: a style swap may already have discarded it, and removing a
      // layer that isn't there throws rather than no-opping.
      if (m && m.getLayer(TREES_3D_LAYER_ID)) m.removeLayer(TREES_3D_LAYER_ID);
    };
  }, [generativeOverlay, loaded, effectiveVisibility.trees3d, canopies, areaId, styleVersion]);

  useEffect(() => {
    treeLayerRef.current?.setOpacity(layerOpacity.trees3d);
  }, [layerOpacity.trees3d]);

  useEffect(() => {
    treeLayerRef.current?.setShadowMode(shadowMode);
  }, [shadowMode]);

  // Re-applies the height offset immediately when the slider moves, rather
  // than waiting for the next camera `move` event to pick up the new value —
  // dragging the slider at a fixed camera position would otherwise show no
  // visible effect until the user also panned or rotated.
  useEffect(() => {
    generativeUpdatePositionRef.current?.();
    dyingUpdatePositionRef.current?.();
  }, [layerHeight.generative, layerHeight.dyingTrees]);

  // Reveals the artwork as the timeline's end handle moves through the
  // recovery window (Oct '25 → May '26) — see generativeRevealOpacity. Was a
  // pointer-hover dim/light mask; replaced because the brief asked for the
  // reveal tied to the selected range instead of pointer position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer(GENERATIVE_LAYER_ID)) return;
    map.setPaintProperty(
      GENERATIVE_LAYER_ID,
      "raster-opacity",
      generativeRevealOpacity(range) * layerOpacityRef.current.generative,
    );
  }, [generativeOverlay, loaded, generativeRange?.endIndex ?? range?.endIndex]);

  // Rasterise the mask once per mount and wait for it -- the layer-creation
  // effect below depends on this being ready.
  useEffect(() => {
    let cancelled = false;
    buildCanopyGradientImage()
      .then((url) => {
        if (!cancelled) setCanopyImageUrl(url);
      })
      .catch(() => {
        // Decorative and non-critical, same as the generative overlay --
        // a failed rasterise just leaves the mask absent.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Canopy mask layer: same footprint as the aerial photo, flat on the
  // ground (no height offset, unlike the generative artwork above it).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const coordsKey = overlay ? JSON.stringify(overlay.coordinates) : null;
    if (coordsKey === prevCanopyCoordsRef.current) return;
    prevCanopyCoordsRef.current = coordsKey;

    if (map.getLayer(CANOPY_LAYER_ID)) map.removeLayer(CANOPY_LAYER_ID);
    if (map.getSource(CANOPY_SOURCE_ID)) map.removeSource(CANOPY_SOURCE_ID);
    if (!overlay || !canopyImageUrl) return;

    map.addSource(CANOPY_SOURCE_ID, { type: "image", url: canopyImageUrl, coordinates: overlay.coordinates });
    map.addLayer({
      id: CANOPY_LAYER_ID,
      type: "raster",
      source: CANOPY_SOURCE_ID,
      paint: { "raster-opacity": CANOPY_OPACITY * layerOpacityRef.current.canopy, "raster-fade-duration": 300 },
    });
    ensureGenerativeOnTop(map);
  }, [overlay, loaded, canopyImageUrl]);

  // LayerPanel visibility — a plain layout-visibility switch layered on top
  // of whichever raster layer(s) currently exist, so a hide/show toggle never
  // has to know about crossfade slots or the layers' own creation timing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const visibility = effectiveVisibility.aerial ? "visible" : "none";
    if (map.getLayer(OVERLAY_LAYER_ID_A)) map.setLayoutProperty(OVERLAY_LAYER_ID_A, "visibility", visibility);
    if (map.getLayer(OVERLAY_LAYER_ID_B)) map.setLayoutProperty(OVERLAY_LAYER_ID_B, "visibility", visibility);
  }, [effectiveVisibility.aerial, loaded, styleVersion, overlayReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer(CANOPY_LAYER_ID)) return;
    map.setLayoutProperty(CANOPY_LAYER_ID, "visibility", effectiveVisibility.canopy ? "visible" : "none");
  }, [effectiveVisibility.canopy, loaded, styleVersion, canopyImageUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer(GENERATIVE_LAYER_ID)) return;
    map.setLayoutProperty(GENERATIVE_LAYER_ID, "visibility", effectiveVisibility.generative ? "visible" : "none");
  }, [effectiveVisibility.generative, loaded, styleVersion, generativeOverlay]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const visibility = effectiveVisibility.dyingTrees ? "visible" : "none";
    if (map.getLayer(DYING_LAYER_ID)) map.setLayoutProperty(DYING_LAYER_ID, "visibility", visibility);
    if (map.getLayer(DYING_GLOW_LAYER_ID)) map.setLayoutProperty(DYING_GLOW_LAYER_ID, "visibility", visibility);
  }, [effectiveVisibility.dyingTrees, loaded, styleVersion, dyingTreeOverlay]);

  // Pins are DOM markers, not a style layer — hidden via a CSS class on the
  // map container (see index.css's .map--pins-off) rather than setLayoutProperty.
  useEffect(() => {
    containerRef.current?.classList.toggle("map--pins-off", !effectiveVisibility.pins);
  }, [effectiveVisibility.pins]);

  // Isolate mode's basemap blackout. There is no single "basemap" layer to
  // switch off — Liberty alone ships dozens — so every style layer that isn't
  // one of this app's own gets hidden individually, remembering what its
  // visibility was first. Restoring from that record rather than force-setting
  // "visible" matters: a style is free to ship layers already switched off,
  // and un-isolating must not turn those on.
  //
  // Keyed on styleVersion as well, so a basemap picked *while* isolated comes
  // back blacked out instead of reappearing under the isolated layer.
  const basemapVisibilityRef = useRef(new Map<string, "visible" | "none" | undefined>());
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    let cancelled = false;

    function apply() {
      const m = mapRef.current;
      if (!m || cancelled) return;
      const ours = new Set<string>([
        OVERLAY_LAYER_ID_A,
        OVERLAY_LAYER_ID_B,
        CANOPY_LAYER_ID,
        GENERATIVE_LAYER_ID,
        DYING_LAYER_ID,
        DYING_GLOW_LAYER_ID,
        TREES_3D_LAYER_ID,
      ]);

      if (isolatedId) {
        const previous = new Map<string, "visible" | "none" | undefined>();
        // `getLayersOrder()` rather than `getStyle().layers`: ids are all this
        // needs, and getStyle() serializes the entire style (Liberty's is
        // large) on every toggle — with the 3D canopy's custom layer sitting
        // in that list as a special case it has no reason to touch.
        for (const layerId of m.getLayersOrder()) {
          if (ours.has(layerId)) continue;
          // `visibility` can in principle be an expression; neither basemap
          // here uses one, and the setter's own typings only take the literal
          // forms — so anything that isn't an explicit "none" is restored as
          // the plain default rather than round-tripped.
          const was = m.getLayoutProperty(layerId, "visibility");
          previous.set(layerId, was === "none" ? "none" : "visible");
          m.setLayoutProperty(layerId, "visibility", "none");
        }
        basemapVisibilityRef.current = previous;
        return;
      }

      for (const [id, visibility] of basemapVisibilityRef.current) {
        // A style swap while isolated leaves ids here that the new style has
        // never heard of; setLayoutProperty on a missing layer throws.
        if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", visibility ?? "visible");
      }
      basemapVisibilityRef.current = new Map();
    }

    // Deferring on `styledata`, NOT on `idle`: the 3D canopy layer calls
    // `triggerRepaint` every frame it animates, so a map showing it may never
    // go idle at all — an `idle` deferral there is a blackout that never
    // happens. `styledata` fires as soon as the style itself is usable, which
    // is the only thing this actually waits for.
    const deferred = !map.isStyleLoaded();
    if (deferred) map.once("styledata", apply);
    else apply();

    return () => {
      cancelled = true;
      if (deferred) map.off("styledata", apply);
    };
  }, [isolatedId, loaded, styleVersion]);

  // The canvas is transparent wherever no style layer paints, so the void an
  // isolated layer floats in is this class's background (see .map--isolated).
  useEffect(() => {
    containerRef.current?.classList.toggle("map--isolated", isolatedId !== null);
  }, [isolatedId]);

  // Keyboard flight, but only with the 3D canopy isolated: that is the one
  // layer with volume to move through, and the one view where the basemap
  // being gone means there is nothing else for WASD to be mistaken for.
  const flying = isolatedId === "trees3d";
  useFlyControls(mapRef, flying);

  /**
   * Stands the camera beside the modelled crown nearest a point, framed so
   * that one tree fills the shot.
   *
   * Two callers want exactly this: opening a tree's twin from the table, and
   * focusing the twin layer from its own chip. They differ only in where they
   * aim, so they share the flight rather than each carrying its own zoom and
   * pitch to drift apart.
   *
   * The snap matters because the twin's geometry comes from the generative
   * artwork's traced canopies while a TreeRecord's position comes from the
   * population table — two independent derivations of the same plot. Flying to
   * the record's own coordinates lands *near* its tree rather than at it, and
   * a twin framing the gap between two trees is not a twin.
   */
  function flyToNearestCrown(
    near: [number, number],
    fallbackRadiusM: number,
    /** How much of the free width that one crown should span, overriding
     * INSPECT_CROWN_FILL. The default frames a single tree because that is what
     * a digital twin is; the Story panel's `twin` frame asks for a much smaller
     * share so several trees stay in shot — it is showing the habitat animals
     * are surveyed in, and one trunk filling the viewport shows no habitat. */
    crownFill: number = INSPECT_CROWN_FILL,
  ) {
    const map = mapRef.current;
    if (!map) return;

    let center = near;
    let crownRadiusM = fallbackRadiusM;
    if (generativeOverlay && canopies.length > 0) {
      let best = Infinity;
      for (const canopy of canopies) {
        const [lng, lat] = pointInQuad(generativeOverlay.coordinates, canopy.u, canopy.v);
        // Squared degrees, and only to rank: converting each candidate to
        // metres would be 2,300 trig calls to pick the same winner.
        const dLng = (lng - near[0]) * Math.cos((near[1] * Math.PI) / 180);
        const dLat = lat - near[1];
        const distance = dLng * dLng + dLat * dLat;
        if (distance < best) {
          best = distance;
          center = [lng, lat];
          crownRadiusM = Math.min(canopy.r * plotWidthMeters(areaId), MAX_CROWN_RADIUS_M);
        }
      }
    }

    // Zoom derived from that crown rather than fixed: crowns here run from
    // about a metre across to twenty-eight, and one zoom that frames a mature
    // ghaf leaves a sapling as a speck.
    const container = map.getContainer();
    const gutter =
      inspectTree && container.clientWidth > INSPECT_CARD_GUTTER * 2 ? INSPECT_CARD_GUTTER : 0;
    const freeWidth = Math.max(160, container.clientWidth - gutter);
    const crownWidthM = Math.max(1.5, crownRadiusM * 2);
    const metresPerPixel = crownWidthM / (freeWidth * crownFill);
    const latRad = (center[1] * Math.PI) / 180;
    const zoom = Math.min(
      INSPECT_ZOOM_MAX,
      Math.max(INSPECT_ZOOM_MIN, Math.log2((40075016.686 * Math.cos(latRad)) / metresPerPixel) - 8),
    );
    map.setMaxZoom(INSPECT_ZOOM_MAX);
    // Terrain off for the duration.
    //
    // MapLibre will not let a camera descend below the terrain surface, and it
    // enforces that by pulling the zoom back. Asking for zoom 21.6 at pitch 62
    // over a DEM that puts this plot a few hundred metres up therefore landed
    // at zoom 15.6 — the whole plot, from altitude, with no error and nothing
    // in the way of a `fitBounds` to blame. The trees carry their own
    // elevations relative to the scene origin, so a flat ground under them
    // looks the same from here.
    map.setTerrain(null);

    // Padding only when the twin card has room to dock; on a pane narrower
    // than roughly two card widths it covers the map whatever the camera does,
    // and padding would just push the tree off the other edge.
    //
    // Attached conditionally rather than passed as `padding: undefined`, which
    // is not the same thing: MapLibre reads `padding.top` unguarded and throws
    // `Cannot read properties of undefined`. Inside a click handler that
    // exception goes nowhere visible — the camera simply never moved, with no
    // error in the console and every other camera call innocent.
    const camera: maplibregl.FlyToOptions = {
      center,
      zoom,
      pitch: INSPECT_PITCH,
      duration: 1800,
      essential: true,
    };
    if (gutter) camera.padding = { top: 0, bottom: 0, left: 0, right: gutter };
    map.flyTo(camera);
  }

  // Opening a twin isolates the layer and stands the camera next to that one
  // tree. Isolation is *entered* here rather than asked of the caller because
  // it is not a separate choice — a twin with the aerial photo still draped
  // over it is not a twin, it is the plot with a card on top.
  useEffect(() => {
    if (!inspectTree) return;
    setIsolatedId("trees3d");
    const map = mapRef.current;
    if (!map || !loaded) return;
    flyToNearestCrown([inspectTree.lng, inspectTree.lat], inspectTree.crownRadius);
  }, [inspectTree, loaded, generativeOverlay, canopies, areaId]);

  // Leaving isolation by any route (Escape, the panel's "Show all") also
  // closes the twin: the card describes a tree the user can no longer see.
  //
  // Armed only once isolation has actually taken. Without the latch this fired
  // on the very render that opened a twin — `inspectTree` is already set while
  // `isolatedId` is still whatever it was — and closed the twin before it ever
  // drew. The state and the effect that sets it land on different renders, and
  // "not isolated yet" and "no longer isolated" look identical from here.
  const twinIsolatedRef = useRef(false);
  useEffect(() => {
    if (!inspectTree) {
      twinIsolatedRef.current = false;
      return;
    }
    if (isolatedId === "trees3d") {
      twinIsolatedRef.current = true;
      return;
    }
    if (twinIsolatedRef.current) onExitInspect?.();
  }, [isolatedId, inspectTree, onExitInspect]);

  // Escape is the way out of a screen that has just gone black — the panel's
  // own "Show all" button is the other.
  useEffect(() => {
    if (!isolatedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsolatedId(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isolatedId]);

  // Per-layer opacity from the LayerPanel's sliders. Each layer's *creation*
  // sites already bake the current factor into their first paint call (see
  // layerOpacityRef) so there's no flash-then-correct on mount or area/style
  // swap — these four only need to catch a slider drag on an already-live
  // layer, hence the plain `getLayer` guards and narrow, single-value deps.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const value = (overlay?.opacity ?? 1) * layerOpacity.aerial;
    if (map.getLayer(OVERLAY_LAYER_ID_A)) map.setPaintProperty(OVERLAY_LAYER_ID_A, "raster-opacity", value);
    if (map.getLayer(OVERLAY_LAYER_ID_B)) map.setPaintProperty(OVERLAY_LAYER_ID_B, "raster-opacity", value);
  }, [layerOpacity.aerial, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer(CANOPY_LAYER_ID)) return;
    map.setPaintProperty(CANOPY_LAYER_ID, "raster-opacity", CANOPY_OPACITY * layerOpacity.canopy);
  }, [layerOpacity.canopy, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer(GENERATIVE_LAYER_ID)) return;
    map.setPaintProperty(
      GENERATIVE_LAYER_ID,
      "raster-opacity",
      generativeRevealOpacity(generativeRangeRef.current) * layerOpacity.generative,
    );
  }, [layerOpacity.generative, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer(DYING_LAYER_ID)) return;
    map.setPaintProperty(DYING_LAYER_ID, "raster-opacity", DYING_OPACITY * layerOpacity.dyingTrees);
    // The glow halo's own rAF tick reads layerOpacityRef live every frame, so
    // it needs no equivalent call here — it picks the new factor up on its
    // very next frame regardless of when this effect happens to run.
  }, [layerOpacity.dyingTrees, loaded]);

  // Pin markers are plain DOM, not a raster layer — a CSS custom property on
  // the container multiplies into `.tree-pin__float`'s own opacity rule (see
  // index.css), stacking with the range-visibility and zoom-blob fades that
  // already animate opacity elsewhere in the pin's element tree.
  useEffect(() => {
    containerRef.current?.style.setProperty("--pin-user-opacity", String(layerOpacity.pins));
  }, [layerOpacity.pins]);

  // Canopy gradient pulse: while the timeline is playing, cycle the mask's
  // colouring red -> green -> red on a loop instead of sitting on the static
  // idle image. Frames are downscaled and pushed via the source's own
  // `updateImage` (no layer/source teardown) so the tick stays cheap. Doesn't
  // depend on `overlay` -- the source id is stable across area switches, and
  // restarting the interval on every timelapse-frame swap during playback
  // would reset the pulse's phase and read as a stutter rather than a loop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !isTimelinePlaying) return;
    if (!map.getLayer(CANOPY_LAYER_ID)) return;

    let cancelled = false;
    let intervalId: number | null = null;

    loadCanopyMaskImage().then((img) => {
      if (cancelled) return;
      const start = performance.now();
      intervalId = window.setInterval(() => {
        const m = mapRef.current;
        if (!m || !m.getLayer(CANOPY_LAYER_ID)) return;
        const elapsed = performance.now() - start;
        // Starts at t=1 -- matching the idle image already on screen, so
        // playback doesn't pop -- dips to fully red at the half period, and
        // back to green at the full period, looping for as long as it plays.
        const t = (Math.cos((elapsed / CANOPY_PULSE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
        const url = renderCanopyGradientFrame(img, t, CANOPY_PULSE_MAX_WIDTH);
        const source = m.getSource(CANOPY_SOURCE_ID);
        if (source && "updateImage" in source) {
          (source as maplibregl.ImageSource).updateImage({ url });
        }
      }, CANOPY_PULSE_TICK_MS);
    });

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
      // Snap back to the crisp, full-resolution idle image once playback
      // stops, rather than leaving whatever downscaled mid-pulse frame was
      // showing frozen on screen.
      const m = mapRef.current;
      if (m && m.getLayer(CANOPY_LAYER_ID) && canopyImageUrl) {
        const source = m.getSource(CANOPY_SOURCE_ID);
        if (source && "updateImage" in source) {
          (source as maplibregl.ImageSource).updateImage({ url: canopyImageUrl });
        }
      }
    };
  }, [isTimelinePlaying, loaded, canopyImageUrl]);

  // The first time this map instance gets a raster overlay in place, frame it
  // automatically: zoom to the plot, then tilt into 3D. Switching tabs
  // unmounts and remounts MapCanvas each time (App.tsx swaps it via a ternary
  // on activeTab), so "once per mount" lines up exactly with "every time the
  // user switches into this tab" — and `overlayReady` only flips false->true
  // once per mount, so the effect's own deps already prevent it firing again
  // afterward; a manual 2D/3D toggle later is never fought.
  //
  // No ref-guard here on purpose: React StrictMode double-invokes a fresh
  // mount's effects (setup, cleanup, setup), and an early-return ref guard
  // breaks that — the first setup's setTimeout gets cancelled by the
  // cleanup, and the second setup would see the ref already flipped and skip
  // rescheduling it, so the tilt would silently never happen. Letting both
  // setups run is harmless here: fitBounds targets the same bounds either
  // way, and only the surviving (second) setTimeout ends up live.
  // Skipped when a specific tree is being focused (see the focus effect below):
  // both this and that effect move the camera and both key off `overlayReady`
  // flipping true on mount, so without this guard they raced — whichever
  // finished last silently undid the other's zoom/position. A focus request is
  // an explicit navigation intent from outside the map (a Recent Events click)
  // and should win outright rather than contend with the passive default framing.
  // Also skipped while the Story panel is driving, for exactly the reason the
  // `focusTree` guard exists: both this and the story effect below fire off
  // `overlayReady` flipping true on mount, both move the camera, and whichever
  // landed second silently won. The story's first block is an explicit request
  // for a specific frame, so it takes precedence over the passive default.
  useEffect(() => {
    if (!show3DToggle || !overlay || !overlayReady || focusTree || storyView) return;

    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(
      [
        [Math.min(...overlay.coordinates.map((c) => c[0])), Math.min(...overlay.coordinates.map((c) => c[1]))],
        [Math.max(...overlay.coordinates.map((c) => c[0])), Math.max(...overlay.coordinates.map((c) => c[1]))],
      ],
      { padding: 40, duration: 1000 },
    );

    // Wait for the fit's own "moveend" rather than guessing its duration with a
    // timer: fitBounds's internal easing keeps re-asserting camera state on
    // every frame until it actually finishes, and under a slow/software GL
    // renderer that can run well past its nominal duration — a timer fired too
    // early loses the race and the tilt below gets silently overwritten back
    // to flat by the fit animation's own next frame.
    let cancelled = false;
    map.once("moveend", () => {
      if (cancelled) return;
      const m = mapRef.current;
      if (!m) return;
      setIs3D(true);
      // Guards against a basemap swap's `setStyle` momentarily removing the
      // terrain source right as this unrelated "settle after auto-fit" timer
      // fires — a pure timing coincidence, not a real dependency between the
      // two. A swap in progress re-applies terrain itself once it settles.
      if (m.getSource(TERRAIN_SOURCE_ID)) {
        m.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
      }
      m.easeTo({ pitch: 60, bearing: -20, duration: 800 });
    });

    return () => {
      cancelled = true;
    };
    // Deliberately `overlay?.coordinates`, not `overlay` itself: MapsView and
    // AssetsView swap `overlay.url` as the timeline crosses each timelapse
    // bucket (see their `{ ...baseOverlay, url: ... }`), which hands this
    // effect a new overlay object on every image change while `coordinates`
    // — spread from the same stable `baseOverlay` — keeps its original array
    // reference. Depending on the whole object meant every bucket swap during
    // a slider drag re-ran fitBounds and the 3D tilt reset, snapping the
    // camera back to the framed view and undoing whatever pan/zoom/tilt the
    // user had just set. `coordinates` only actually changes when the area
    // itself does, which is the one case this auto-fit is meant to cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show3DToggle, overlay?.coordinates, overlayReady, focusTree, storyView]);

  /**
   * Applies the Story panel's current block view — the one place the story and
   * the map actually meet.
   *
   * Keyed on `storyView`'s identity, and those objects are module-level
   * constants in storyMap.ts, so this fires exactly when the reader moves to a
   * block with a different view and never on an unrelated re-render. Between
   * firings the map is entirely the reader's: this sets a starting point, it
   * does not hold one.
   *
   * One camera call, not a fit followed by a tilt. `focusLayer` and the
   * auto-fit above both chain a tilt off `moveend` and both carry a comment
   * about the ways that races; here the fit is computed up front with
   * `cameraForBounds` and the pitch and bearing ride along in the same move, so
   * there is no second animation to collide with the first — and the whole
   * transition reads as one gesture rather than two.
   */
  useEffect(() => {
    if (!storyView) return;
    const map = mapRef.current;
    if (!map || !loaded) return;

    // Colour and layers land immediately; only the camera is animated. A
    // cross-faded colour mode on top of a moving camera reads as the render
    // breaking rather than as two things changing.
    setColorMode(storyView.colorMode ?? "normal");
    setStoryLayers(new Set(storyView.layers));

    const coords = overlay?.coordinates ?? generativeOverlay?.coordinates;
    if (!coords) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    if (storyView.frame === "twin") {
      // Reuses the twin flight wholesale rather than approximating it: it
      // already snaps to a real modelled crown, derives its zoom from that
      // crown's own radius, and drops terrain for the descent. See
      // flyToNearestCrown for why each of those matters.
      setIs3D(true);
      flyToNearestCrown(pointInQuad(coords, 0.5, 0.5), MAX_CROWN_RADIUS_M / 2, STORY_TWIN_CROWN_FILL);
      return;
    }

    const frame = STORY_FRAMES[storyView.frame];
    // Panel and toolbar sit *over* the canvas, so the plot is framed against
    // the part of it the reader can actually see — see CHROME_GUTTER_LEFT. The
    // gutters are dropped on a pane too narrow to spare them, where they would
    // squeeze the plot off the opposite edge rather than clear of the panel.
    const container = map.getContainer();
    const roomForChrome = chrome && layerTime && container.clientWidth > (CHROME_GUTTER_LEFT + CHROME_GUTTER_RIGHT) * 1.8;
    const fit = map.cameraForBounds(boundsOf(coords), {
      padding: {
        top: frame.padding,
        bottom: frame.padding,
        left: frame.padding + (roomForChrome ? CHROME_GUTTER_LEFT : 0),
        right: frame.padding + (roomForChrome ? CHROME_GUTTER_RIGHT : 0),
      },
    });
    if (!fit) return;

    // Raised only for the twin, so put it back before asking for anything
    // else — MapLibre clamps to maxZoom silently, and a stale 23.5 ceiling
    // would let a later frame overshoot rather than error.
    map.setMaxZoom(DEFAULT_MAX_ZOOM);

    const baseZoom = typeof fit.zoom === "number" ? fit.zoom : map.getZoom();
    const zoom = Math.max(1, baseZoom + frame.zoomDelta);

    // Terrain first: the DEM has to be attached before the tilt begins, or the
    // camera spends the whole move over flat ground and the relief pops in at
    // the end. Removing it early is harmless by comparison.
    if (frame.exaggeration !== null) {
      if (map.getSource(TERRAIN_SOURCE_ID)) {
        map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: frame.exaggeration });
        if (!map.getLayer(HILLSHADE_LAYER_ID)) {
          // Inserted beneath this app's own rasters rather than appended on
          // top, so the aerial capture and the traces still read normally over
          // shaded ground. Falls back to the top of the stack when no such
          // layer exists yet — on a bare-terrain block there is nothing above
          // it to get behind.
          const above = [OVERLAY_LAYER_ID_A, OVERLAY_LAYER_ID_B, GENERATIVE_LAYER_ID].find((id) => map.getLayer(id));
          map.addLayer(
            {
              id: HILLSHADE_LAYER_ID,
              type: "hillshade",
              source: TERRAIN_SOURCE_ID,
              paint: {
                "hillshade-exaggeration": 0.72,
                "hillshade-shadow-color": "#3c3a33",
                "hillshade-highlight-color": "#fffdf6",
                "hillshade-accent-color": "#8a7f66",
              },
            },
            above,
          );
        }
      }
    } else {
      map.setTerrain(null);
      if (map.getLayer(HILLSHADE_LAYER_ID)) map.removeLayer(HILLSHADE_LAYER_ID);
    }
    // Keeps the toolbar's own 2D/3D button honest about where the camera is.
    setIs3D(frame.pitch > 0);

    const camera = {
      center: fit.center,
      zoom,
      pitch: frame.pitch,
      bearing: frame.bearing,
      essential: true,
    } satisfies maplibregl.FlyToOptions;

    if (reduced) {
      map.jumpTo(camera);
      return;
    }

    if (Math.abs(zoom - map.getZoom()) > STORY_ARC_ZOOM_DELTA) {
      map.flyTo({ ...camera, duration: STORY_ARC_MS, curve: 1.3 });
    } else {
      // easeOutCubic: leaves at once, arrives slowly. The response has to be
      // immediate — the block was just clicked — while the settle is what
      // makes the move readable.
      map.easeTo({ ...camera, duration: STORY_EASE_MS, easing: (t) => 1 - Math.pow(1 - t, 3) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyView, loaded, overlayReady, overlay?.coordinates, generativeOverlay?.coordinates, canopies]);

  // Builds the full-timeline pool of flagged-tree pins once per overlay/area.
  // Positions come from the overlay's own image space (see generateTreePins),
  // so every pin sits on a real point of the aerial; MapLibre then keeps each
  // marker locked to that lng/lat through pan, zoom, rotate and tilt. Gated on
  // `overlayReady` so pins can never appear without the imagery they annotate.
  //
  // Every marker is added to the map here regardless of the selected date
  // range — the separate range-visibility effect below (which always runs
  // immediately after this one, in the same commit, since its own deps are a
  // superset of these) decides which ones actually show. Splitting it this
  // way means dragging the timeline only ever toggles a CSS class, never
  // rebuilds the marker pool.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !overlay || !overlayReady) {
      pinsRef.current = [];
      return;
    }

    const pins = generateTreePins(overlay, areaId ?? "area", snapshots);
    // Deterministic (seeded by areaId — see generateTreeRecords), so calling
    // it again here with the same arguments reproduces the exact same list
    // generateTreePins just filtered down, rather than diverging from it.
    treeRecordsRef.current = new Map(
      generateTreeRecords(overlay, areaId ?? "area", snapshots).map((record) => [record.id, record]),
    );
    const zipped = pins.map((pin, index) => {
      const el = buildPinElement(pin, index);
      // Click opens the tooltip (a portal — see PinTooltip) rather than
      // MapLibre's built-in Popup. MapLibre appends marker elements *inside*
      // `.maplibregl-canvas-container` — the same element its internal
      // HandlerManager listens on — so an unstopped click bubbles up and gets
      // re-fired as the map's own "click" event, which closeTooltip below
      // listens for; without stopPropagation every pin click would open the
      // tooltip and then immediately close it again.
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const point = mapRef.current?.project([pin.lng, pin.lat]);
        const rect = mapRef.current?.getContainer().getBoundingClientRect();
        if (!point || !rect) return;
        setActivePin({ pin, monthIndex: displayMonthRef.current, x: rect.left + point.x, y: rect.top + point.y });
        setPinExpanded(false);
        onPinClick?.(pin.id);
      });
      // Hover-only signal, separate from the click above — lets a caller
      // (AssetsView) highlight the matching table row as the pointer roams
      // the map, without that light touch also opening the click tooltip or
      // moving the camera the way a click does.
      el.addEventListener("mouseenter", () => onPinHover?.(pin.id));
      el.addEventListener("mouseleave", () => onPinHover?.(null));
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
        // Explicit rather than relying on the "auto" default: a map pin reads as
        // a billboard standing on the ground, so it must stay upright and
        // face-on to the camera at any bearing or pitch — only its anchor point
        // moves with the terrain.
        rotationAlignment: "viewport",
        pitchAlignment: "viewport",
      })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      return { pin, marker };
    });
    pinsRef.current = zipped;

    // Depth order for the tilted camera: MapLibre doesn't sort HTML markers, so
    // in 3D a pin at the back of the plot can paint over one at the front.
    // Screen-Y is the depth cue under any bearing/pitch — lower on screen means
    // nearer the camera, so it draws on top.
    function sortByDepth() {
      const m = mapRef.current;
      if (!m) return;
      zipped
        .map(({ marker }) => ({ marker, y: m.project(marker.getLngLat()).y }))
        .sort((a, b) => a.y - b.y)
        .forEach(({ marker }, i) => {
          marker.getElement().style.zIndex = String(i + 1);
        });
    }
    sortByDepth();
    map.on("move", sortByDepth);

    // Clicking blank map (not a pin) closes any open tooltip. A pin click calls
    // stopPropagation (above), so it never reaches this "click" listener — only
    // genuine background clicks do.
    function closeTooltip() {
      setActivePin(null);
      setPinExpanded(false);
    }
    map.on("click", closeTooltip);

    return () => {
      map.off("move", sortByDepth);
      map.off("click", closeTooltip);
      zipped.forEach(({ marker }) => marker.remove());
      pinsRef.current = [];
      setActivePin(null);
      setPinExpanded(false);
    };
  }, [overlay, overlayReady, loaded, areaId, snapshots]);

  // Shows/hides pins to match the selected date range and, in the Assets view,
  // the table's active filters — this is what makes dragging the timeline or
  // ticking a health chip visibly add and remove flagged trees rather than
  // showing a single fixed set. Runs right after the build effect above (same
  // deps plus `range`/`visibleTreeIds`), so it also applies the correct initial
  // visibility the first time the pool is built.
  useEffect(() => {
    if (!overlay || !overlayReady || !loaded) {
      setPinCounts(null);
      return;
    }

    const effectiveRange = pinsRange ?? range ?? { startIndex: 0, endIndex: snapshots.length - 1 };
    // The END month, not the whole range. The population persists now, so every
    // tree exists in every month; "the plot as of this date" is the reading
    // that makes dragging the timeline into the final three months light up the
    // dieback zones, with the same individuals staying lit rather than a fresh
    // random set each frame.
    const month = Math.max(0, Math.min(effectiveRange.endIndex, snapshots.length - 1));
    displayMonthRef.current = month;
    const visible = pinsRef.current.filter(
      ({ pin }) =>
        pinSeverityAt(pin, month) !== null && (visibleTreeIds === undefined || visibleTreeIds.has(pin.id)),
    );
    const visibleIds = new Set(visible.map(({ pin }) => pin.id));

    // One marker per tree, repainted for the month on screen: show it only if
    // this tree is flagged that month, and give it that month's colour. This is
    // why the pool doesn't need a marker per (tree, month) — swapping a CSS
    // variable is enough to move the whole map through time.
    pinsRef.current.forEach(({ pin, marker }) => {
      const severity = pinSeverityAt(pin, month);
      const el = marker.getElement();
      const show = severity !== null && (visibleTreeIds === undefined || visibleTreeIds.has(pin.id));
      el.classList.toggle("tree-pin--hidden", !show);
      if (severity) {
        el.style.setProperty("--pin-color", SEVERITY_COLOR[severity]);
        el.setAttribute("aria-label", `${CONDITION_LABEL[severity]} tree ${pin.id}`);
      }
    });

    // Counted per condition band straight off the taxonomy, so adding or
    // renaming a band never leaves a stale key behind here.
    setPinCounts(
      Object.fromEntries(
        CONDITION_KEYS.map((key) => [key, visible.filter(({ pin }) => pinSeverityAt(pin, month) === key).length]),
      ) as Record<ConditionKey, number>,
    );

    // A pin that just faded out of range shouldn't leave its tooltip dangling.
    setActivePin((prev) => (prev && !visibleIds.has(prev.pin.id) ? null : prev));
  }, [overlay, overlayReady, loaded, areaId, snapshots, range, pinsRange, visibleTreeIds]);

  // Flies to the tree selected in the Assets table and rings it. Runs after the
  // visibility effect above so that, for a flagged tree, the marker it wants to
  // open a tooltip for is already unhidden.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    focusMarkerRef.current?.remove();
    focusMarkerRef.current = null;
    if (!focusTree) return;

    const element = document.createElement("div");
    element.className = "tree-focus";
    focusMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
      .setLngLat([focusTree.lng, focusTree.lat])
      .addTo(map);

    map.flyTo({ center: [focusTree.lng, focusTree.lat], zoom: FOCUS_ZOOM, duration: 1100, essential: true });

    function focusScreenPos(): { x: number; y: number } {
      // Non-null: this closure only runs while the effect's own `!map` guard
      // above has already returned, and `map` is a `const` never reassigned —
      // TS just doesn't carry that narrowing into a nested function body.
      const rect = map!.getContainer().getBoundingClientRect();
      const point = map!.project([focusTree!.lng, focusTree!.lat]);
      return { x: rect.left + point.x, y: rect.top + point.y };
    }

    // Open the flagged tree's tooltip once the camera settles — projecting any
    // earlier would place it against the pre-flight screen position. A healthy
    // tree simply has no pin to find, and the ring carries the selection alone.
    //
    // Only when the caller has no `onFocusArrived` of its own (AssetsView):
    // a caller that passes it (MapsView/App.tsx) is about to open its own
    // bigger popover for this same tree, and showing this compact tooltip
    // underneath it too meant both were open at once — this tooltip is that
    // caller's fallback for when it doesn't have a bigger one of its own.
    function revealTooltip() {
      if (!onFocusArrived) {
        const found = pinsRef.current.find(({ pin }) => pin.id === focusTree?.id);
        if (found && map) {
          const rect = map.getContainer().getBoundingClientRect();
          const point = map.project([found.pin.lng, found.pin.lat]);
          setActivePin({ pin: found.pin, monthIndex: displayMonthRef.current, x: rect.left + point.x, y: rect.top + point.y });
          setPinExpanded(false);
        }
      }
      onFocusArrived?.(focusScreenPos());
    }
    map.once("moveend", revealTooltip);

    // Keeps a caller's popover glued to this tree's screen position through
    // subsequent pan/zoom/rotate — the same discipline as the pin tooltip's
    // own tracking effect below, needed here too since a focused tree may be
    // healthy and have no pin/tooltip of its own to piggyback on.
    function handleMove() {
      onFocusMove?.(focusScreenPos());
    }
    map.on("move", handleMove);

    return () => {
      map.off("moveend", revealTooltip);
      map.off("move", handleMove);
    };
  }, [focusTree, loaded]);

  // Reprojects `overlay`'s four ground corners to on-screen pixels for
  // `onOverlayQuadChange` — the same project()-plus-container-rect math every
  // other screen-position callback in this file uses, just against the
  // overlay's own coordinates instead of a pin or focused tree.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !overlay || !onOverlayQuadChange) return;

    function project() {
      const m = mapRef.current;
      if (!m || !overlay) return;
      const rect = m.getContainer().getBoundingClientRect();
      const quad = overlay.coordinates.map(([lng, lat]) => {
        const p = m.project([lng, lat]);
        return { x: rect.left + p.x, y: rect.top + p.y };
      });
      onOverlayQuadChange?.(quad);
    }

    project();
    map.on("move", project);
    window.addEventListener("resize", project);
    return () => {
      map.off("move", project);
      window.removeEventListener("resize", project);
      onOverlayQuadChange?.(null);
    };
  }, [overlay, loaded, onOverlayQuadChange]);

  // Keeps the open tooltip glued to its pin's screen position through pan,
  // zoom, rotate and tilt, and closes it once the pin scrolls outside the
  // visible map — a disembodied tooltip floating over unrelated UI would be
  // worse than no tooltip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activePin) return;

    function reposition() {
      const m = mapRef.current;
      if (!m || !activePin) return;
      const rect = m.getContainer().getBoundingClientRect();
      const point = m.project([activePin.pin.lng, activePin.pin.lat]);
      if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) {
        setActivePin(null);
        return;
      }
      setActivePin((prev) =>
        prev && prev.pin.id === activePin.pin.id ? { ...prev, x: rect.left + point.x, y: rect.top + point.y } : prev,
      );
    }

    map.on("move", reposition);
    window.addEventListener("resize", reposition);
    // Capture phase: the page's scroll container (`overflow-y-auto` in App.tsx)
    // fires "scroll" on itself, which does not bubble — a capturing listener on
    // window still sees it on the way down.
    window.addEventListener("scroll", reposition, true);
    return () => {
      map.off("move", reposition);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePin?.pin.id]);

  // Escape, or a click anywhere outside the map (e.g. the tabs bar, the
  // sidebar), also closes the tooltip. The tooltip itself calls
  // stopPropagation on its own clicks, so this only ever fires for genuine
  // outside clicks.
  useEffect(() => {
    if (!activePin) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActivePin(null);
    }
    function onDocClick(e: MouseEvent) {
      // Defensive: a pin click already stops propagation and never reaches
      // here, but keep this guard so switching pin -> pin can't regress into
      // opening one tooltip and immediately closing it again.
      if ((e.target as HTMLElement | null)?.closest(".tree-pin")) return;
      setActivePin(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
    };
  }, [activePin]);

  function toggle3D() {
    const map = mapRef.current;
    if (!map) return;
    const next = !is3D;
    setIs3D(next);

    if (next) {
      // Guards the same momentary window as the auto-fit effect above — a
      // basemap swap in progress re-applies terrain itself once it settles.
      if (map.getSource(TERRAIN_SOURCE_ID)) {
        map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
      }
      map.easeTo({ pitch: 60, bearing: -20, duration: 800 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }

  function fitToPlot() {
    const map = mapRef.current;
    if (!map || !overlay) return;
    const lngs = overlay.coordinates.map((c) => c[0]);
    const lats = overlay.coordinates.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 40, duration: 1000 },
    );
  }

  /** The smallest lng/lat box containing every point given — used both for an
   * overlay's four corners and for a scattered set of pins, so it takes any
   * number of points rather than `MapOverlay`'s fixed 4-tuple. */
  function boundsOf(points: readonly (readonly [number, number])[]): [[number, number], [number, number]] {
    const lngs = points.map((c) => c[0]);
    const lats = points.map((c) => c[1]);
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
  }

  /**
   * Frames a single layer's own footprint — fired by clicking a chip's title
   * in the layer panel. Every raster layer here (aerial, canopy, generative,
   * dying-trees, the 3D trees) is draped over the *same* georeferenced quad —
   * see `areaGenerativeOverlays`'s and `areaDyingTreeOverlays`' own comments —
   * so "zoom to this layer" for those is "fit to the plot", same as the
   * existing toolbar action. Pins are the one layer that's actually scattered
   * within that footprint, so theirs fits the *visible* pins instead: tighter,
   * and meaningfully different from clicking any other chip.
   *
   * The generative artwork and the 3D trees also tilt the camera in once the
   * fit settles — both are explicitly "visible while tilted into 3D" (see
   * their own subtitles), so a flat top-down frame would show nothing of what
   * was just zoomed to. `toggle3D`'s own guard against a basemap swap in
   * flight is repeated here for the same reason it exists there.
   */
  function focusLayer(id: ContentLayerId) {
    const map = mapRef.current;
    if (!map) return;

    function fitAndTilt(coordinates: MapOverlay["coordinates"], tilt: boolean) {
      const m = mapRef.current;
      if (!m) return;
      m.fitBounds(boundsOf(coordinates), { padding: 48, duration: 900 });
      if (!tilt) return;
      // No cancellation token: this is a one-shot click handler, not an effect
      // with a natural cleanup phase. `mapRef.current` is re-read fresh below
      // rather than closed over, the same guard `toggle3D` and the auto-fit
      // effect above both rely on.
      m.once("moveend", () => {
        const m2 = mapRef.current;
        if (!m2) return;
        setIs3D(true);
        if (m2.getSource(TERRAIN_SOURCE_ID)) {
          m2.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
        }
        m2.easeTo({ pitch: 60, bearing: -20, duration: 700 });
      });
    }

    switch (id) {
      case "aerial":
      case "canopy":
        if (overlay) fitAndTilt(overlay.coordinates, false);
        return;
      case "dyingTrees":
        if (dyingTreeOverlay) fitAndTilt(dyingTreeOverlay.coordinates, false);
        return;
      case "generative":
        if (generativeOverlay) fitAndTilt(generativeOverlay.coordinates, true);
        return;
      case "trees3d": {
        // Not the plot fit the other layers get: the twin is modelled geometry
        // at real scale, and framing the whole 12 hectares shows it as green
        // texture. It lands beside the tree nearest the plot's centre instead,
        // through the same flight the table's twin button uses.
        //
        // One flight, not a fit followed by a push-in: `fitAndTilt` installs
        // its own `once("moveend")` to tilt, a second handler registered here
        // fired on that same event, and the two easeTo calls fought over the
        // camera and left it staring at nothing.
        if (!generativeOverlay) return;
        setIs3D(true);
        if (map.getSource(TERRAIN_SOURCE_ID)) {
          map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
        }
        flyToNearestCrown(pointInQuad(generativeOverlay.coordinates, 0.5, 0.5), MAX_CROWN_RADIUS_M / 2);
        return;
      }
      case "pins": {
        const month = displayMonthRef.current;
        const visible = pinsRef.current.filter(
          ({ pin }) => pinSeverityAt(pin, month) !== null && (visibleTreeIds === undefined || visibleTreeIds.has(pin.id)),
        );
        if (visible.length === 0) {
          if (overlay) fitAndTilt(overlay.coordinates, false);
          return;
        }
        if (visible.length === 1) {
          const { pin } = visible[0];
          map.flyTo({ center: [pin.lng, pin.lat], zoom: FOCUS_ZOOM, duration: 900, essential: true });
          return;
        }
        map.fitBounds(
          boundsOf(visible.map(({ pin }): [number, number] => [pin.lng, pin.lat])),
          { padding: 80, maxZoom: FOCUS_ZOOM, duration: 900 },
        );
        return;
      }
    }
  }

  const collapsed = diagnostics.height < 1 || diagnostics.width < 1;
  // Per layer, not one shared label: a detached layer showing March must not
  // sit under a subtitle reading "As of September" because the master timeline
  // happens to be there. Falls back to the master range for layers with no
  // override, which is what rangeFor already hands back.
  function monthLabelFor(r: DateRange | undefined): string | undefined {
    const index = Math.min(r?.endIndex ?? snapshots.length - 1, snapshots.length - 1);
    return snapshots[index]?.label;
  }
  const aerialMonthLabel = monthLabelFor(layerTime?.rangeFor.aerial ?? range);
  const canopyMonthLabel = monthLabelFor(layerTime?.rangeFor.canopy ?? range);

  return (
    <div
      style={style}
      className={`relative rounded-[12px] overflow-hidden border border-[rgba(0,0,0,0.06)] ${className}`}
    >
      {/* Must be sized with h-full/w-full, NOT `absolute inset-0`: MapLibre's own
          stylesheet sets `.maplibregl-map { position: relative }` on this element,
          which overrides Tailwind's `absolute` and drops `inset-0`, collapsing the
          container to 0 height and leaving a blank 300px default canvas.
          `isolate` walls off a stacking context of its own: MapLibre depth-sorts
          tree pins with inline z-index up into the dozens (sortByDepth, below) so
          nearer pins draw over farther ones in a tilted view, and without this
          those values compete directly with the sibling UI panels' own z-10/z-20
          (LayerPanel, MapToolbar, the height card) in the *same* stacking
          context — a plot with enough flagged trees could out-rank them and
          paint pins over the panels meant to sit above the whole map. */}
      <div
        ref={containerRef}
        className="w-full h-full isolate map-color-mode"
        style={{ filter: buildMapFilter(colorMode, mapContrast) }}
      />

      {/* Flight is keyboard-only, so it needs saying — nothing on a black
          screen full of trees suggests pressing W. */}
      {flying && !error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-[10px] px-[12px] py-[6px] rounded-full bg-black/55 backdrop-blur-[2px] text-[11px] text-white/85 font-['Outfit',sans-serif] whitespace-nowrap pointer-events-none">
          <span>
            <b className="text-white">WASD</b> fly
          </span>
          <span>
            <b className="text-white">Q/E</b> turn
          </span>
          <span>
            <b className="text-white">R/F</b> height
          </span>
          <span>
            <b className="text-white">Shift</b> boost
          </span>
          <span className="text-white/50">Esc to exit</span>
        </div>
      )}

      {/* The twin's readout. Inside the map rather than beside it: the card
          describes the tree the camera is standing next to, and the two
          appearing and leaving together is what makes them one view. */}
      {inspectTree && !error && (
        <TreeTwinCard
          tree={inspectTree}
          months={monthLabelsForPanel}
          onExit={() => {
            setIsolatedId(null);
            onExitInspect?.();
          }}
        />
      )}

      {error && <StatusOverlay title="Map failed to load" message={error} diagnostics={diagnostics} />}
      {!error && collapsed && (
        <StatusOverlay
          title="Waiting for layout"
          message="The map container has no height yet, so the map can't be drawn. It will render as soon as the container gets a size."
          diagnostics={diagnostics}
        />
      )}

      {chrome && loaded && !error && layerTime && !inspectTree && (
        <LayerPanel
          areaName={areaName ?? areaId ?? "Area"}
          areaId={areaId ?? "area"}
          months={monthLabelsForPanel}
          layerTime={layerTime}
          visibility={layerVisibility}
          onHideLayer={(id) => {
            setLayerVisibility((v) => ({ ...v, [id]: false }));
            // Hiding the layer that's currently isolated would otherwise do
            // nothing visible — isolation overrides visibility — and read as
            // a dead button.
            setIsolatedId((current) => (current === id ? null : current));
            // Same dead-button problem, one level out: a story block's layer
            // set also outranks `layerVisibility`, so toggling a chip while
            // the story is driving would appear to do nothing. Touching the
            // panel is the reader taking the map back — the story stops
            // proposing until they move to another block.
            setStoryLayers(null);
          }}
          onShowLayer={(id) => {
            setLayerVisibility((v) => ({ ...v, [id]: true }));
            setStoryLayers(null);
          }}
          onFocusLayer={focusLayer}
          isolatedId={isolatedId}
          onIsolateChange={(id) => {
            setIsolatedId(id);
            setStoryLayers(null);
            // Isolating also frames what it isolated. With the basemap and
            // every other layer gone there is nothing left on screen to
            // orient by, so a plot that happened to be off-frame — or a
            // 12 ha one seen from the default zoom, which is a speck —
            // reads as "isolate turned the map off". For the canopy layers
            // focusLayer also tilts into 3D, which is the only view in which
            // 2,300 modelled crowns read as trees rather than as noise.
            if (id) focusLayer(id);
          }}
          onReset={() => {
            setLayerVisibility(DEFAULT_LAYER_VISIBILITY);
            setLayerOpacity(DEFAULT_LAYER_OPACITY);
            setLayerHeight(DEFAULT_LAYER_HEIGHT);
            setShadowMode(DEFAULT_SHADOW_MODE);
            setIsolatedId(null);
            setStoryLayers(null);
            setColorMode("normal");
            setBasemapIndex(0);
          }}
          showGenerative={!!generativeOverlay}
          showDyingTrees={!!dyingTreeOverlay}
          treeCount={canopies.length}
          opacity={layerOpacity}
          onOpacityChange={(id, value) => setLayerOpacity((o) => ({ ...o, [id]: value }))}
          height={layerHeight}
          onHeightChange={(id, value) => setLayerHeight((h) => ({ ...h, [id]: value }))}
          shadowMode={shadowMode}
          onShadowModeChange={setShadowMode}
          aerialSubtitle={aerialMonthLabel ? `As of ${aerialMonthLabel}` : "Drone capture"}
          canopySubtitle={canopyMonthLabel ? `As of ${canopyMonthLabel}` : "Health-weighted gradient"}
          pinCounts={pinCounts}
          basemapLabel={BASEMAPS[basemapIndex].label}
          onBasemapPrev={() => setBasemapIndex((i) => (i - 1 + BASEMAPS.length) % BASEMAPS.length)}
          onBasemapNext={() => setBasemapIndex((i) => (i + 1) % BASEMAPS.length)}
        />
      )}

      {chrome && loaded && !error && (
        <MapToolbar
          onZoomIn={() => mapRef.current?.zoomIn({ duration: 300 })}
          onZoomOut={() => mapRef.current?.zoomOut({ duration: 300 })}
          onResetNorth={() => mapRef.current?.easeTo({ bearing: 0, pitch: is3D ? 60 : 0, duration: 500 })}
          onFitPlot={overlay && !overlayMissing ? fitToPlot : undefined}
          onToggle3D={show3DToggle ? toggle3D : undefined}
          is3D={is3D}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          contrast={mapContrast}
          onContrastChange={setMapContrast}
          bearing={bearing}
        />
      )}

      {activePin &&
        (() => {
          const record = treeRecordsRef.current.get(activePin.pin.id);
          if (pinExpanded && record) {
            return (
              <TreeHistoryModal
                tree={record}
                anchor={{ x: activePin.x, y: activePin.y }}
                onClose={() => {
                  setActivePin(null);
                  setPinExpanded(false);
                }}
                onCollapse={() => setPinExpanded(false)}
                onFlyToPin={() => mapRef.current?.flyTo({ center: [record.lng, record.lat], zoom: 17, duration: 800 })}
              />
            );
          }
          return (
            <PinTooltip
              state={activePin}
              onClose={() => setActivePin(null)}
              onExpand={record ? () => setPinExpanded(true) : undefined}
            />
          );
        })()}

      {loaded && !error && overlay && overlayMissing && (
        <div className="absolute bottom-4 left-4 z-10 bg-white border border-[#E0B4A0] rounded-[10px] px-[12px] py-[6px] shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08)] max-w-[420px]">
          <span className="text-[12px] text-[#B4531F] font-['Outfit',sans-serif]">
            Overlay image not found — save it to{" "}
            <code className="text-[11px] bg-[#f6f6f8] px-1 rounded">public{overlay.url}</code>
          </span>
        </div>
      )}
    </div>
  );
}
