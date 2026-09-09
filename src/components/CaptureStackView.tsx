import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  areaHectares,
  frameMonthWindow,
  type CaptureExtentPair,
  type ExtentDifference,
} from "../data/overlays";
import { detectHabitatChange } from "../data/habitatChange";
import type { MapOverlay } from "../data/overlays";
import { getPopulation } from "../data/treePopulation";
import type { MonthSnapshot } from "../data/types";
import HiResConfirmation from "./HiResConfirmation";
import { PROSE_RESOLUTION } from "../data/habitatAdvice";
import TreeFlowSankey from "./TreeFlowSankey";
import { clamp } from "../hooks/useDragResize";
import { useFlipReorder } from "../hooks/useFlipReorder";
import { analyseMask, MIN_REGION_HA, type MaskAnalysis } from "../lib/maskRegions";
import { publicUrl } from "../lib/publicUrl";

/**
 * The capture stack — georeferenced planes held apart in an isometric scene,
 * full screen.
 *
 * ONE deck, not two readings. It holds each drone pass with the vegetation
 * extent an analyst delineated on it — capture, its trace, the next capture,
 * its trace — and the two masks showing where those delineations disagree,
 * which a switch adds and removes. An earlier pass of this view made those a
 * pair of mutually exclusive modes; that was wrong, because the question a
 * reader actually has is "is the ground the masks claim moved the same ground
 * the two boundaries disagree over", and answering it means seeing them
 * together. Modes also meant two legends, two lots of framing state, and no
 * way to put a mask next to the trace it came from.
 *
 * The order of the layers is the reader's: every layer can be dragged up or
 * down the stack. Separation follows grouping rather than a flat step, and
 * grouping is read off whatever order the deck is currently in — so moving a
 * mask in among a pass closes the gap around it automatically.
 *
 * Why a stack rather than a blend. Every other comparison in this app puts one
 * thing on top of another and asks the reader to trust that they line up. Here
 * the question is specifically whether two *delineations* of the same
 * shelterbelt agree, and a flattened composite of four registered images cannot
 * answer it: you see one picture and have to take the registration on faith.
 * Separating the planes along their shared normal makes the construction of the
 * comparison visible — this line came off that photograph, that line came off
 * this other one — and closing the separation back to zero gives the
 * conventional stacked overlay for reading the divergence directly. Both
 * readings, one control.
 *
 * Built with CSS `preserve-3d` rather than three.js: textured quads with no
 * lighting, no depth sort and no picking is precisely what the browser's own 3D
 * transforms do, and the one WebGL context on this screen is already carrying
 * MapCanvas's ~2,300 instanced trees (see docs/3D-CANOPY.md).
 *
 * On dates: the frames carry no survey date — see `areaTimelapseImages` — so
 * the timestamps here are the months each frame stands for on the plot's own
 * timeline, derived through `frameMonthWindow` from the very function that
 * picks the imagery. That is a real position in time within this app's model,
 * and it is labelled as such rather than as a capture date.
 */

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * From the reference this screen is styled against: a white ground, hairline
 * rules rather than structural borders, content grouped into soft pale panels
 * with no shadow at all, black type with grey secondary labels, solid black
 * buttons, and a single lavender accent used sparingly on tiles.
 *
 * The rule that keeps this honest: these are CHROME colours only. Every colour
 * that stands for something in the data — the two trace strokes, the two
 * difference masks — is sampled from its own raster in `overlays.ts` and never
 * substituted with a palette entry, because the legend has to agree with the
 * pixels the reader is looking at. That is why the accent is on a date badge
 * and never on a layer swatch.
 */
const C = {
  ink: "#0A0A0A",
  paper: "#FFFFFF",
  /** Grouped-content panels, and the inactive track of the reading switch. */
  panel: "#F4F4F4",
  /** Hairlines. 1px — the reference has no heavy rules anywhere. */
  line: "#E6E6E6",
  muted: "#8A8A8A",
  accent: "#C7C4F5",
  /**
   * The stage.
   *
   * Graphite: deliberately between the two ends this went through. Near-black
   * made the whole view read as a light-table in a dark room and swamped the
   * pale desert imagery; near-white gave the plates nothing to separate
   * against and washed the neon strokes out. A dark neutral lets the
   * photographs be the brightest thing on screen, which is what they should
   * be, while staying in the same family as the reference's black card rather
   * than reading as a different product.
   */
  stage: "#2B2F35",
  /** Secondary text ON the stage. The rail's grey is unreadable there. */
  onStage: "rgba(255,255,255,0.52)",
};

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** Source imagery is 2752 × 1536; the plane keeps that ratio so the traces and
 *  masks stay registered to the ground under them. */
const ASPECT = 2752 / 1536;
/**
 * How many layout pixels the deck is built from per pixel it ends up occupying.
 *
 * The plates are not drawn straight to the screen. Each one carries an
 * `overflow: hidden` rounded clip, the traces carry a `filter` chain and the
 * masked captures carry `mask-image` — every one of which forces the browser to
 * render that element into an offscreen buffer sized from the element's OWN
 * layout box, which is then texture-mapped through the deck's 3D transform.
 * That buffer, not the 2752 px source, is the resolution ceiling: at 4.5× the
 * captures were visibly mush (measured — see below) despite the source having
 * detail to spare.
 *
 * So the deck is laid out this many times larger and the fit scale divides by
 * the same factor, which leaves every plate exactly where it was on screen and
 * gives each offscreen buffer this many times the texels.
 *
 * Measured on the flat deck at 4.5×, same 620×420 crop of the imagery. The
 * `1 / SUPERSAMPLE` cap on `fit` below means all three renders are the same
 * size on screen, so these compare like with like:
 *
 *              laplacian-variance   mean-gradient     3 s orbit, 6 plates
 *   ×1                 56.3              6.69          5.5 fps, ran in 3.09 s
 *   ×2                225.1              9.20          5.5 fps, ran in 3.08 s
 *   ×3                343.7             10.31          0.1 fps, ran in 14.0 s
 *
 * Two, because it is four times the detail for no cost this harness can
 * measure, and three is where the renderer stops keeping up: buffer area grows
 * as the square, and between ×2 and ×3 the orbit drag went from tracking the
 * pointer to taking four and a half times as long as the gesture. (Those frame
 * rates are software rasterisation — the collapse is the finding, not the
 * absolute numbers.) There is real detail left above ×2 — the source is 2752 px
 * and a ×2 plate lays out at 1520 — but it is not reachable at an interactive
 * frame rate.
 *
 * Everything measured in plate units — the separation offsets, the hairlines,
 * the filter radii — multiplies by this, so the factor is a rendering knob:
 * changing it moves nothing on screen except how much detail survives.
 */
const SUPERSAMPLE = 2;

/** The deck's size in PLATE UNITS — the space every geometry constant in this
 *  file is written in. `PLANE_W` below is the same thing in layout pixels. */
const PLANE_UNIT_W = 760;
const PLANE_W = PLANE_UNIT_W * SUPERSAMPLE;
const PLANE_H = Math.round(PLANE_W / ASPECT);

/** Air kept between the deck and the stage edges, per side, at fit zoom. */
const STAGE_PAD = 34;

/** Where the labels park: a fixed inset from the stage's right edge. They are
 *  pinned rather than floating over their plates so they form one readable
 *  column instead of drifting with the geometry. */
const LABEL_RIGHT_INSET = 16;
/** Kept clear of the top and bottom edges. */
const LABEL_MARGIN_Y = 20;
/** Least vertical distance between two parked labels — roughly the pill's own
 *  height plus air, so a run of close layers reads as a list rather than as
 *  overlapping text. */
const MIN_LABEL_GAP = 32;

/** A three-quarter view, not a true 30° isometric: the planes are 16:9, and at
 *  a textbook isometric angle a wide plate turns into a splinter. This pitch
 *  keeps enough of each image readable to recognise the ground. */
const HOME_YAW = -34;
const HOME_PITCH = 57;
const PITCH_MIN = 8;
const PITCH_MAX = 84;

/**
 * Where the Separation slider opens, and what "Fit" returns it to.
 *
 * Flat. The view opens as a straight overlay — the later capture laid on the
 * earlier one and thinned by `captureVeil`, so the two photographs read through
 * each other as a single blended picture of the same ground. That is the
 * comparison most readers come for, and it is the one reading a stack of
 * separated plates cannot give.
 *
 * Dragging the slider up is then how the deck comes apart, to answer the
 * second question — which layer a given boundary belongs to. The opening
 * gesture is a staggered fade rather than a fan (see the settle effect), since
 * there is no longer any distance for the plates to travel.
 */
const SPREAD_DEFAULT = 0;

const SPREAD_MAX = 340;

/**
 * The separation over which the upper capture's veil dissolves — see
 * `captureVeil`.
 *
 * This used to be SPREAD_DEFAULT itself, back when the two were the same
 * number, and they are genuinely different things: one is where the slider
 * opens, the other is how far the plates have to come apart before the top
 * photograph can be trusted to stand on its own. Tying the veil to the default
 * meant it vanished exactly at the opening view, which at a 20 px default is
 * where it is needed most — the plates are still overlapping ~90% in screen
 * space there, so an opaque upper capture would hide everything under it.
 */
const VEIL_SPAN = 132;

/**
 * A delivered close-up of the two passes over the same ground, side by side —
 * shown from a count badge as the detail behind the number.
 *
 * What it is NOT, and the panel says so: a crop of the patch being hovered.
 * Nothing in the file ties it to a location, so presenting it as the ground
 * under that particular badge would invent a provenance the delivery does not
 * carry. It is a sample detail of what a boundary move looks like at survey
 * resolution, which is worth seeing next to a count of trees — and mislabelling
 * it would be worth nothing.
 *
 * The halves are also left unlabelled on purpose. Which side is the earlier
 * pass is not stated anywhere, and a badge can be either direction: guessing
 * "left is earlier" would be right for the gained patches and backwards for
 * the lost ones.
 */
const COMPARE_DETAIL_URL = publicUrl("/overlays/cool_compare.png");
const DETAIL_W = 300;
/** 740 × 371, the file's own dimensions — held here so the panel reserves the
 *  right height before the image decodes and does not jump under the pointer. */
const DETAIL_H = Math.round((DETAIL_W * 371) / 740);
/** Clear of the badge disc (r 13) plus air, so the panel never sits on the
 *  number it is explaining. */
const DETAIL_GAP = 24;
const DETAIL_MARGIN = 12;

/**
 * How much further apart two passes sit than the two planes within one pass.
 *
 * A capture and the extent traced on it are one observation and belong
 * together; the gap that matters is the one between the two dates. With a
 * single uniform separation the deck reads as four unrelated sheets, so the
 * grouping is carried by the spacing itself rather than only by the legend.
 */
const INTER_GROUP_RATIO = 2.9;

const MIN_ZOOM = 0.4;
/** Past roughly this the 2752 px source is being magnified beyond 1:1 and there
 *  is no more detail to find — but inspecting a boundary at the pixel level is
 *  exactly what this view is for, so the ceiling is generous. */
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.35;

/** How far an upper capture thins out once the deck is fully flat. Not all the
 *  way to nothing: the later ground staying faintly present is what says the
 *  two traces were read off two different photographs. */
const FLAT_VEIL = 0.62;

/** Opening fan-out: stagger per plane, and the whole gesture's length (the last
 *  plane starts `(n-1) × stagger` in). Kept here so the phase flip cannot
 *  drift out of step with the CSS. */
const OPEN_STAGGER = 90;
const OPEN_SETTLE_MS = 620 + OPEN_STAGGER * 4 + 80;

type PlaneKind = "capture" | "trace" | "mask";

interface StackPlane {
  key: string;
  kind: PlaneKind;
  url: string;
  /** Traces and masks: the colour sampled out of the raster. */
  color?: string;
  title: string;
  note: string;
  /** Planes sharing a group are one observation, and sit close together. */
  groupId: string;
  groupLabel: string;
  /** The months this group's imagery stands for. */
  groupTime: string;
  /** The same fact, short enough to sit on the stage. The masks' full span
   *  names four months and runs to ~285 px, which does not fit beside the deck
   *  at any sensible zoom; the legend still carries the whole thing. */
  sceneTime: string;
  /** True for the disagreement masks — present only when the switch is on.
   *  Everything else is the deck's permanent content. */
  optional: boolean;
}

/* -------------------------------------------------------------------------- */
/* Model                                                                       */
/* -------------------------------------------------------------------------- */

/** The months a frame covers, as a label. Collapses to one month when the
 *  frame owns only one, rather than printing "Mar – Mar". */
function frameTimeLabel(pair: CaptureExtentPair, months: string[]): string {
  const { startIndex, endIndex } = frameMonthWindow(pair.frameNumber - 1, pair.frameCount, months.length);
  const from = months[startIndex];
  const to = months[endIndex];
  if (!from) return "";
  return from === to || !to ? from : `${from} – ${to}`;
}

/** The endpoints of a frame's window, for composing a span across two frames
 *  without printing all four month names. */
function frameEdges(pair: CaptureExtentPair, months: string[]) {
  const { startIndex, endIndex } = frameMonthWindow(pair.frameNumber - 1, pair.frameCount, months.length);
  return { first: months[startIndex] ?? "", last: months[endIndex] ?? "" };
}

/**
 * Everything the deck can hold, in its canonical bottom-to-top order: each
 * pass as capture-then-its-trace, and the disagreement masks above them.
 *
 * A delineation sits on the photograph it was drawn on, never under it, and the
 * masks start on top because they are a statement about both passes at once.
 * All three of those are only the DEFAULT order — the reader can rearrange
 * them, and this list is what "Reset order" returns to.
 */
function buildLayers(
  pairs: CaptureExtentPair[],
  differences: ExtentDifference[] | undefined,
  months: string[],
): StackPlane[] {
  const passes = pairs.flatMap((pair, i) => {
    const groupLabel = i === 0 ? "Earlier pass" : i === pairs.length - 1 ? "Later pass" : `Pass ${i + 1}`;
    const groupTime = frameTimeLabel(pair, months);
    const shared = { groupId: pair.id, groupLabel, groupTime, sceneTime: groupTime, optional: false };
    return [
      {
        ...shared,
        key: `${pair.id}-capture`,
        kind: "capture" as const,
        url: pair.capture,
        title: `Capture · frame ${pair.frameNumber}`,
        note: `Drone frame ${pair.frameNumber} of ${pair.frameCount}`,
      },
      {
        ...shared,
        key: `${pair.id}-trace`,
        kind: "trace" as const,
        url: pair.trace.url,
        color: pair.trace.color,
        title: "Extent trace",
        note: `Delineated on frame ${pair.frameNumber}`,
      },
    ];
  });

  if (!differences?.length) return passes;

  // The masks describe an interval, so their timestamp is the span between the
  // two frames rather than either one's own window.
  const last = pairs[pairs.length - 1];
  const span =
    pairs.length > 1
      ? `${frameTimeLabel(pairs[0], months)} → ${frameTimeLabel(last, months)}`
      : frameTimeLabel(pairs[0], months);
  // Outermost months only — the earliest the first frame covers to the latest
  // the last one does.
  const compactSpan =
    pairs.length > 1 ? `${frameEdges(pairs[0], months).first} → ${frameEdges(last, months).last}` : span;
  const shared = {
    groupId: "diff",
    groupLabel: "Disagreement",
    groupTime: span,
    sceneTime: compactSpan,
    optional: true,
  };

  return [
    ...passes,
    ...differences.map((diff) => ({
      ...shared,
      key: diff.id,
      kind: "mask" as const,
      url: diff.url,
      color: diff.color,
      title: diff.direction === "lost" ? "Lost extent" : "Gained extent",
      note: diff.label,
    })),
  ];
}

/** Moves `from` to sit where `to` currently is, shifting the rest along — the
 *  same move-to-position rule LayerPanel's chip reorder uses, so the two
 *  reorderable lists in this app behave identically under a drag. */
function reorder(order: string[], from: string, to: string): string[] {
  if (from === to) return order;
  const rest = order.filter((k) => k !== from);
  const insertAt = rest.indexOf(to);
  if (insertAt < 0) return order;
  rest.splice(insertAt, 0, from);
  return rest;
}

/**
 * Exchanges two whole groups in the stack.
 *
 * A pass is two layers — a capture and the extent traced on it — so putting the
 * later pass underneath by dragging means four separate moves, and getting one
 * of them wrong silently splits a pass across the other. This moves both layers
 * of each group together.
 *
 * Works on the slots the two groups currently occupy rather than on a pair of
 * indices, so it is still correct after the reader has rearranged individual
 * layers: whichever group sits lower ends up on top, and the layers inside each
 * group keep their own relative order. Groups of unequal size are handled by the
 * same rule, which matters because the disagreement masks are a group of two
 * against a pass of two only by coincidence.
 */
function swapGroups(order: string[], groupIdOf: (key: string) => string | undefined, a: string, b: string): string[] {
  const slots: number[] = [];
  order.forEach((key, i) => {
    const group = groupIdOf(key);
    if (group === a || group === b) slots.push(i);
  });
  const keysA = order.filter((key) => groupIdOf(key) === a);
  const keysB = order.filter((key) => groupIdOf(key) === b);
  if (keysA.length === 0 || keysB.length === 0) return order;

  const firstA = order.findIndex((key) => groupIdOf(key) === a);
  const firstB = order.findIndex((key) => groupIdOf(key) === b);
  // Whichever group is currently lower in the stack goes second.
  const merged = firstA < firstB ? [...keysB, ...keysA] : [...keysA, ...keysB];

  const next = order.slice();
  slots.forEach((slot, i) => {
    next[slot] = merged[i];
  });
  return next;
}

/**
 * Nudges a layer one place along the stack, counting only the layers currently
 * in the deck.
 *
 * The keyboard counterpart of the drag, and the reason it is not simply an
 * index swap: `order` also holds layers the switch has taken out, and stepping
 * onto one of those would look like the arrow key did nothing. So the step is
 * taken over the visible sequence, and the result written back into the
 * visible slots — which leaves the hidden entries where they were, so toggling
 * the switch back on restores them in place.
 */
function stepLayer(order: string[], present: (key: string) => boolean, key: string, delta: number): string[] {
  const visible = order.filter(present);
  const from = visible.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= visible.length) return order;
  [visible[from], visible[to]] = [visible[to], visible[from]];
  let next = 0;
  return order.map((k) => (present(k) ? visible[next++] : k));
}

/**
 * Where each plane sits along the stack's normal.
 *
 * Gaps are accumulated rather than multiplied out from the index, because they
 * are not all the same size — a group boundary is `INTER_GROUP_RATIO` times
 * wider than a step inside a group. The run is then centred on its own
 * midpoint: planes rise along +Z, which projects as "up the screen", so
 * numbering from the bottom would make the deck climb out of the top of the
 * stage as it fans, crowding the header while leaving the lower third empty.
 */
function planeOffsets(planes: StackPlane[], spread: number, isVisible: (key: string) => boolean): number[] {
  const raw: number[] = [];
  let acc = 0;
  // The last VISIBLE plane's group, not simply the previous plane's: with a
  // whole pass switched off, the gap between the two groups either side of it
  // should be one group step, not two plus the hole where the pass was.
  let previousGroup: string | null = null;

  planes.forEach((plane) => {
    if (!isVisible(plane.key)) {
      // Parked on the last visible plane below it, adding no gap of its own.
      // A switched-off layer still exists — it keeps its slot in the order and
      // its row in the legend, and its image stays decoded so bringing it back
      // is instant — but it must not hold the deck open. A gap with nothing in
      // it reads as a missing layer rather than a hidden one.
      raw.push(acc);
      return;
    }
    if (previousGroup !== null) {
      acc += spread * (previousGroup === plane.groupId ? 1 : INTER_GROUP_RATIO);
    }
    raw.push(acc);
    previousGroup = plane.groupId;
  });

  // Centred on what is actually showing, so hiding the top layer re-centres the
  // rest instead of leaving them hanging low.
  const shown = raw.filter((_, i) => isVisible(planes[i].key));
  if (shown.length === 0) return raw;
  const mid = (shown[0] + shown[shown.length - 1]) / 2;
  return raw.map((v) => v - mid);
}

/**
 * The size the deck occupies on screen, before any fit or zoom scaling.
 *
 * Computable in closed form because the stage's `perspective` is long enough
 * to be effectively orthographic (see index.css): the projection is then a
 * plain affine map, so the axis-aligned bounds of a rotated rectangle are just
 * its half-extents resolved onto each axis, `cos(pitch)` is the foreshortening
 * of the vertical one, and the stack's rise adds to the height directly.
 *
 * Worth deriving rather than assuming a nominal scene box: the footprint varies
 * several-fold across the separation slider and again as the orbit changes, so
 * a fixed box either wastes most of the stage at one end or lets the plates run
 * off it at the other.
 */
/**
 * Where a point on a plate lands on screen, relative to the deck's centre and
 * before the fit scale.
 *
 * `u`,`v` run 0→1 across and down the image — the same normalised space the
 * overlays use — and `z` is the plane's offset along the stack.
 *
 * This exists so the in-scene timestamps can be ordinary flat DOM positioned
 * over the stage instead of children of the plates. Labels inside the 3D scene
 * were legible — a counter-rotation cancels the deck's own transform — but they
 * were also *occluded*: anything at a higher Z paints over them, so the earlier
 * pass's label disappeared under the plate above it. There is no fix for that
 * from inside the scene, because being behind a higher plane is the correct
 * result. Projecting the anchor and drawing the label on top of everything is.
 *
 * Closed form for the same reason `projectedDeckSize` is: the stage's
 * perspective is long enough to be effectively orthographic, so this is a plain
 * affine map. It mirrors the deck's own `rotateX(pitch) rotateZ(yaw)` — Z first,
 * then X — and must be changed with it.
 */
function projectDeckPoint(u: number, v: number, z: number, yawDeg: number, pitchDeg: number) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const x = u * PLANE_W - PLANE_W / 2;
  const y = v * PLANE_H - PLANE_H / 2;
  const rotatedX = x * Math.cos(yaw) - y * Math.sin(yaw);
  const rotatedY = x * Math.sin(yaw) + y * Math.cos(yaw);
  // Local +Z leaves the screen upward, hence the negative term.
  return { x: rotatedX, y: rotatedY * Math.cos(pitch) - z * Math.sin(pitch) };
}

function projectedDeckSize(yawDeg: number, pitchDeg: number, rise: number) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const halfW = PLANE_W / 2;
  const halfH = PLANE_H / 2;
  const spanX = halfW * Math.abs(Math.cos(yaw)) + halfH * Math.abs(Math.sin(yaw));
  const spanY = halfW * Math.abs(Math.sin(yaw)) + halfH * Math.abs(Math.cos(yaw));
  return { w: 2 * spanX, h: 2 * spanY * Math.cos(pitch) + rise * Math.sin(pitch) };
}

/**
 * How visible a plane is, given which one the reader is focusing and which they
 * have switched off.
 *
 * The two mechanical cases are settled: an explicitly hidden plane is gone
 * regardless of focus, and with nothing focused every remaining plane is fully
 * lit. What focus does to the *rest* of the deck is a judgment call — see
 * TODO(human) below.
 */
function planeOpacity(
  plane: StackPlane,
  focusKey: string | null,
  focusGroupId: string | null,
  hidden: Record<string, boolean>,
): number {
  // An explicit switch-off wins over any emphasis rule.
  if (hidden[plane.key]) return 0;
  if (focusKey === null) return 1;
  if (plane.key === focusKey) return 1;

  // TODO(human): decide how the rest of the deck recedes behind the focused
  // plane.
  //
  // Two groups remain, and they are not obviously the same:
  //
  //   • the other plane(s) in the SAME group — `plane.groupId === focusGroupId`
  //   • the planes of the other group(s)
  //
  // A trace and the capture it was delineated on are one observation. Dimming
  // a focused trace's own capture to near-nothing leaves a line floating in
  // space with no ground to be an extent OF, which is the one thing this view
  // exists to make legible. Holding the same-group partner high (say ~0.8) and
  // dropping the other group low (say ~0.12) makes focus read as "this pass",
  // with the hovered layer merely emphasised inside it. Dropping both to the
  // same low value makes it read as "this layer alone" — cleaner isolation,
  // but a hovered trace then loses its context.
  //
  // Return a number in 0..1. Until this is decided, focus is a no-op and the
  // whole deck stays lit, which is harmless but wastes the interaction.
  return 1;
}

/**
 * Thins the upper capture as the separation closes.
 *
 * Without this, flattening is a dead end. Registered planes stacked exactly on
 * top of each other show only the topmost ones — the earlier ground and the
 * earlier boundary end up behind an opaque photograph, which is physically
 * right and analytically useless, since reading the two delineations against
 * each other is the entire reason to collapse the deck.
 *
 * Only captures, and only above the bottom plane: traces and masks are thin or
 * translucent and overlaying them is the wanted picture, while the bottom
 * capture stays whole as the ground everything else is measured against.
 * Scales with separation rather than switching at zero, so dragging the slider
 * dissolves the upper pass instead of popping it.
 */
function captureVeil(plane: StackPlane, index: number, bottomIndex: number, flatness: number): number {
  if (plane.kind !== "capture" || index === bottomIndex) return 1;
  return 1 - FLAT_VEIL * flatness;
}

/**
 * Where the close-up panel sits relative to the badge that opened it.
 *
 * Horizontally clamped, vertically FLIPPED. The difference matters: sliding a
 * panel sideways to stay on stage still leaves it beside its badge, but sliding
 * it down would park it on top of the badge and hide the number the reader is
 * reading. So above by preference, below when there is no room above, and only
 * clamped as a last resort on a stage too short for either.
 */
function detailPlacement(
  x: number,
  y: number,
  stage: { w: number; h: number },
  height: number,
): { left: number; top: number } {
  const left = clamp(x - DETAIL_W / 2, DETAIL_MARGIN, Math.max(DETAIL_MARGIN, stage.w - DETAIL_W - DETAIL_MARGIN));
  const above = y - DETAIL_GAP - height;
  const top = above >= DETAIL_MARGIN ? above : Math.min(y + DETAIL_GAP, stage.h - height - DETAIL_MARGIN);
  return { left, top: Math.max(DETAIL_MARGIN, top) };
}

/* -------------------------------------------------------------------------- */
/* Chrome                                                                      */
/* -------------------------------------------------------------------------- */

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.6 8S3.9 3.9 8 3.9 14.4 8 14.4 8 12.1 12.1 8 12.1 1.6 8 1.6 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.4" />
      {off && <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  );
}

/** A small tile-ish label, after the reference's upcoming-bills chips. */
function Badge({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "accent" | "ink" }) {
  const tones = {
    plain: { background: C.paper, color: C.ink, border: `1px solid ${C.line}` },
    accent: { background: C.accent, color: C.ink, border: "1px solid transparent" },
    ink: { background: C.ink, color: C.paper, border: "1px solid transparent" },
  } as const;
  return (
    <span
      className="inline-flex items-center px-[9px] py-[3px] rounded-[7px] text-[10.5px] font-semibold font-['Outfit',sans-serif] tabular-nums whitespace-nowrap"
      style={tones[tone]}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export default function CaptureStackView({
  pairs,
  differences,
  months,
  overlay,
  snapshots,
  areaId,
  projectName,
  onClose,
}: {
  pairs: CaptureExtentPair[];
  /** The one-sided disagreement masks. Absent means the differences reading is
   *  not offered rather than shown empty. */
  differences?: ExtentDifference[];
  /** Month labels for the plot's timeline, for the frame timestamps. */
  months: string[];
  /** The plot's georeferenced footprint and its monthly record — what the tree
   *  flow needs to compare the two frames' own months. Passed rather than the
   *  caller's finished report on purpose: the caller's is keyed to the timeline
   *  slider, and a flow chart labelled with THIS view's dates has to be
   *  computed for them, or the two would quietly disagree. */
  overlay: MapOverlay;
  snapshots: MonthSnapshot[];
  areaId: string;
  projectName: string;
  onClose: () => void;
}) {
  const hasDifferences = (differences?.length ?? 0) > 0;
  const layers = useMemo(() => buildLayers(pairs, differences, months), [pairs, differences, months]);
  const layerByKey = useMemo(() => new Map(layers.map((l) => [l.key, l])), [layers]);
  const defaultOrder = useMemo(() => layers.map((l) => l.key), [layers]);

  /**
   * The header switches.
   *
   * Differences and Project open on, where a plot has masks to switch on — the
   * view's subject is what moved between the two passes, and both of those are
   * that subject rather than an elaboration of it. `hasDifferences` gates them
   * because a plot with traces but no delivered masks has nothing behind either
   * one, and a switch that opens on and lights nothing is worse than one the
   * reader never reaches for.
   *
   * Worth knowing at the flat separation the deck now opens at: the projection
   * columns have no length to draw, since every plane sits on the ground they
   * point at. What survives is their heads — a counted badge standing on each
   * patch — which is the useful half on a flat deck anyway. Raise Separation
   * and the lines grow out of them.
   *
   * Tree flow stays off. It is a second, differently-shaped account of the same
   * interval, and two of those competing on open is one too many.
   */
  const [showDifferences, setShowDifferences] = useState(hasDifferences);
  const [showProjection, setShowProjection] = useState(hasDifferences);
  const [showFlow, setShowFlow] = useState(false);
  /**
   * Which disagreement mask, if any, is clipping the captures.
   *
   * One at a time rather than a set: the two masks are disjoint by
   * construction — ground cannot be both only-in-the-earlier and
   * only-in-the-later pass — so clipping to both at once would just be
   * clipping to their union, which is a different and much less useful
   * question than either one alone.
   */
  const [maskWith, setMaskWith] = useState<string | null>(null);
  const [hoverRegion, setHoverRegion] = useState<string | null>(null);
  /**
   * Which count badge the pointer is on — a second, narrower hover than
   * `hoverRegion`.
   *
   * Kept separate because the two hit targets now mean different things: the
   * column's hairline gives the count, and the numbered circle at its head
   * gives the count plus the close-up. Reusing one piece of state would open
   * the panel from anywhere on the line, which puts a 300 px window over the
   * deck every time the pointer crosses a column on its way somewhere else.
   */
  const [detailKey, setDetailKey] = useState<string | null>(null);

  /**
   * The tree flow between the two frames' own months.
   *
   * Anchored to the frames rather than to whatever the timeline slider is set
   * to, because it sits beside plates labelled with those exact windows. The
   * "as of" month for each is the END of its window — the same rule the pins
   * and the assets table use for "the plot as of this date".
   */
  const flowReport = useMemo(() => {
    if (pairs.length < 2) return null;
    const first = pairs[0];
    const last = pairs[pairs.length - 1];
    const from = frameMonthWindow(first.frameNumber - 1, first.frameCount, snapshots.length).endIndex;
    const to = frameMonthWindow(last.frameNumber - 1, last.frameCount, snapshots.length).endIndex;
    if (from === to) return null;
    return detectHabitatChange(overlay, areaId, snapshots, from, to);
  }, [pairs, overlay, areaId, snapshots]);
  /**
   * Failing blocks a commissioned pass would cover, for the hi-res request in
   * the Disagreement header.
   *
   * Counted the same way the advisor counts them — mapped blocks only, since
   * the report's "outside" bucket collects declines that fall in no dieback
   * zone: real trees, but not a place a flight is commissioned over. Zero means
   * the button does not appear at all rather than the receipt offering a
   * capture over nothing.
   */
  const hiResBlockCount = flowReport
    ? flowReport.blocks.filter((b) => b.declined > 0 && b.id !== "outside").length
    : 0;
  const [hiResOpen, setHiResOpen] = useState(false);

  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // A different plot means a different set of layers, and an order built from
  // the old one would silently drop the new layers and keep ghosts of the old.
  // Keyed on the key list rather than the array identity, which is a fresh
  // `.map()` on every render.
  const orderKey = defaultOrder.join(" ");
  useEffect(() => {
    setOrder(defaultOrder.slice());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  /** Whether a layer is currently in the deck at all. */
  const isPresent = useCallback(
    (key: string) => {
      const layer = layerByKey.get(key);
      return !!layer && (!layer.optional || showDifferences);
    },
    [layerByKey, showDifferences],
  );

  const planes = useMemo(
    () => order.map((k) => layerByKey.get(k)).filter((l): l is StackPlane => !!l && isPresent(l.key)),
    [order, layerByKey, isPresent],
  );

  const [yaw, setYaw] = useState(HOME_YAW);
  const [pitch, setPitch] = useState(HOME_PITCH);
  const [spread, setSpread] = useState(0);
  const [settled, setSettled] = useState(false);
  /**
   * Which layers are switched off. Traces start hidden.
   *
   * The deck opens flat (see SPREAD_DEFAULT), and flat means the two
   * photographs are read through one another — a delineation drawn over that
   * blend is a neon line across the very ground the reader is trying to
   * compare. So the captures get the first look on their own, and the traces
   * come in from the legend when the reader wants the boundary rather than the
   * imagery. The masks are unaffected: they are gated by the Differences
   * switch, not by this.
   *
   * A lazy initialiser, not an effect: this is the state's starting value, and
   * writing it after the first paint would show every trace for one frame and
   * then take them away.
   */
  const [hidden, setHidden] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layers.filter((l) => l.kind === "trace").map((l) => [l.key, true])),
  );
  // Per-layer opacity, absent meaning fully opaque. Sparse rather than
  // pre-filled so "never touched" and "deliberately set to 1" are the same
  // thing and no reset bookkeeping is needed.
  const [opacityByKey, setOpacityByKey] = useState<Record<string, number>>({});
  const layerOpacity = useCallback((key: string) => opacityByKey[key] ?? 1, [opacityByKey]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    panX: number;
    panY: number;
    panning: boolean;
  } | null>(null);
  // Whether the reader has taken the separation into their own hands. A ref and
  // not state because the fan-out's own queued frame has to read the live value.
  const interactedRef = useRef(false);

  // Keyed by URL rather than counted, so the same capture appearing in both
  // readings (the earlier frame is the differences ground) cannot double-count
  // and leave the gate permanently open or permanently shut.
  const allLoaded = planes.every((p) => loaded[p.url]);
  const markLoaded = useCallback((url: string) => setLoaded((prev) => (prev[url] ? prev : { ...prev, [url]: true })), []);

  /**
   * Ends the opening phase, so the plates stop honouring the fan-out's stagger
   * and start tracking the handle. Also cancels the automatic fan-out outright,
   * which is not a nicety: the fan-out waits for two 4 MB captures to decode,
   * and a reader who hits Flatten during that wait would otherwise watch the
   * deck fan itself back open a moment later, undoing what they just asked for.
   */
  const takeOver = useCallback(() => {
    interactedRef.current = true;
    setSettled(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The opening.
  //
  // Held until every plate has its pixels: the deck is invisible behind the
  // `allLoaded` gate, and these are two 4 MB captures — running this on mount
  // means the staggered arrival plays out inside a transparent stage and the
  // deck simply appears, already there.
  //
  // It no longer fans: SPREAD_DEFAULT is flat, so `setSpread` below settles on
  // the value it already holds and the entrance is carried entirely by
  // `cstackPlaneIn`'s staggered fade. The effect stays because that stagger,
  // and the slower pre-settle transition it runs against, are gated on
  // `settled` — which is what this schedules. Restore a non-zero
  // SPREAD_DEFAULT and the fan comes back with no other change.
  //
  // The settle clock is started BY the second frame rather than beside it. The
  // two are not interchangeable: rAF is throttled behind a busy paint — on this
  // screen it has been measured arriving ~2 s late, since a WebGL map and two
  // large JPEG decodes are already in front of it — while setTimeout keeps to
  // the wall clock and would otherwise fire first, marking the deck settled
  // before it had begun to open and dropping the stagger entirely.
  //
  // Under `prefers-reduced-motion` the blanket duration rule in index.css
  // collapses the same transition into an instant arrival, so there is nothing
  // to branch on here.
  useEffect(() => {
    if (!allLoaded || interactedRef.current) return;
    let inner = 0;
    let settle = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (interactedRef.current) return;
        setSpread(SPREAD_DEFAULT);
        settle = window.setTimeout(() => setSettled(true), OPEN_SETTLE_MS);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      window.clearTimeout(settle);
    };
  }, [allLoaded]);

  // Only the room available is measured here; the fit itself is derived below,
  // because it also depends on the orbit and the separation.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setStageSize({ w: width, h: height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* --- Measured mask areas ------------------------------------------------ */

  const [analysis, setAnalysis] = useState<Record<string, MaskAnalysis | null>>({});
  useEffect(() => {
    if (!differences) return;
    let live = true;
    Promise.all(differences.map(async (d) => [d.id, await analyseMask(d.url)] as const)).then((entries) => {
      if (live) setAnalysis(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [differences]);

  const plotHectares = areaHectares(areaId);
  /** A mask's painted fraction turned into ground area. Legitimate because the
   *  mask is draped on exactly the box `areaHectares` measures. `null` when the
   *  read failed — the figure is then omitted, never estimated. */
  const maskHectares = useCallback(
    (id: string): number | null => {
      const fraction = analysis[id]?.fraction;
      return fraction == null ? null : fraction * plotHectares;
    },
    [analysis, plotHectares],
  );

  /**
   * How many of the plot's trees stand inside each patch of each mask.
   *
   * A real count, not a rate applied to an area: the population carries every
   * tree's own position in the same normalised image space the masks are drawn
   * in (see `PopulationTree.u`), so this asks the mask, pixel by pixel, which
   * patch each tree falls in. That is why `MaskAnalysis` hands back `regionAt`
   * rather than bounding boxes — these patches are ragged, and a box around
   * one would collect trees that are nowhere near it.
   *
   * `getPopulation` is memoised on (scale, areaId) upstream, and the whole
   * sweep is a few thousand array lookups, so this costs nothing to recompute.
   */
  const treesPerRegion = useMemo(() => {
    const trees = getPopulation(1, areaId);
    const counts: Record<string, number> = {};
    Object.entries(analysis).forEach(([maskId, mask]) => {
      if (!mask) return;
      for (const tree of trees) {
        const region = mask.regionAt(tree.u, tree.v);
        if (region) {
          const key = `${maskId}:${region}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    });
    return counts;
  }, [analysis, areaId]);

  /* --- Pointer ------------------------------------------------------------ */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        yaw,
        pitch,
        panX: pan.x,
        panY: pan.y,
        // Middle button or Shift pans; a plain drag orbits. Zoomed in past the
        // stage there is more image than screen, so panning has to be reachable
        // without giving up the orbit that makes this an isometric view.
        panning: e.button === 1 || e.shiftKey,
      };
    },
    [yaw, pitch, pan.x, pan.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (start.panning) {
      setPan({ x: start.panX + dx, y: start.panY + dy });
      return;
    }
    // Horizontal drag turns the deck on its own axis, vertical drag raises and
    // lowers the eye. Pitch is clamped short of flat-on and dead-overhead:
    // either end collapses the separation the whole view exists to show.
    setYaw(start.yaw + dx * 0.35);
    setPitch(clamp(start.pitch - dy * 0.3, PITCH_MIN, PITCH_MAX));
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // Wheel-to-zoom has to be a native listener registered `{ passive: false }`.
  // React routes `onWheel` through a passive root listener, where
  // `preventDefault` is a no-op that only logs — so the page behind would keep
  // scrolling while the deck zoomed.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      // Exponential, so one notch is the same proportional step at every zoom —
      // a linear delta crawls when zoomed out and lurches when zoomed in.
      setZoom((prev) => clamp(prev * Math.exp(-e.deltaY * 0.0016), MIN_ZOOM, MAX_ZOOM));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const resetView = useCallback(() => {
    takeOver();
    setYaw(HOME_YAW);
    setPitch(HOME_PITCH);
    setSpread(SPREAD_DEFAULT);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [takeOver]);

  /* --- Reorder ------------------------------------------------------------ */

  const moveTo = useCallback((from: string, to: string) => setOrder((prev) => reorder(prev, from, to)), []);

  const groupIdOf = useCallback((key: string) => layerByKey.get(key)?.groupId, [layerByKey]);

  /** The two passes, as group ids. Only offered as a swap when there are
   *  exactly two — with one there is nothing to exchange, and with three
   *  "swap" would not say which pair. */
  const passGroupIds = useMemo(() => pairs.map((p) => p.id), [pairs]);
  const swapPasses = useCallback(() => {
    if (passGroupIds.length !== 2) return;
    setOrder((prev) => swapGroups(prev, groupIdOf, passGroupIds[0], passGroupIds[1]));
  }, [passGroupIds, groupIdOf]);
  const step = useCallback(
    (key: string, delta: number) => setOrder((prev) => stepLayer(prev, isPresent, key, delta)),
    [isPresent],
  );

  const orderChanged = order.join(" ") !== defaultOrder.join(" ");

  // The legend rows glide to their new places rather than snapping. Called
  // unconditionally and before any early return, as the hook requires.
  const setRowRef = useFlipReorder(planes.map((p) => p.key));

  /* --- Derived ------------------------------------------------------------ */

  /** The raster currently clipping the captures. Resolved from the layer list
   *  rather than held in state beside the id, so it cannot outlive a mask that
   *  is no longer in the deck. */
  const clipUrl = maskWith ? layerByKey.get(maskWith)?.url : undefined;

  const isShown = useCallback((key: string) => !hidden[key], [hidden]);
  // `spread` is a plate-unit figure — it is what the Separation slider reads
  // out — so it comes into the layout multiplied like every other one.
  const offsets = planeOffsets(planes, spread * SUPERSAMPLE, isShown);

  /** Only the showing planes' offsets — everything that frames the deck (its
   *  height, the fit, where a column's foot lands) has to ignore the parked
   *  ones or a hidden top layer would still reserve its space. */
  const shownOffsets = offsets.filter((_, i) => isShown(planes[i].key));
  const rise = shownOffsets.length > 0 ? shownOffsets[shownOffsets.length - 1] - shownOffsets[0] : 0;
  /** Index of the lowest showing plane — `captureVeil` treats it as the ground
   *  everything else is read against, and that is the bottom of what is
   *  VISIBLE, not of the full list. */
  const firstShownIndex = planes.findIndex((p) => isShown(p.key));
  const deck = projectedDeckSize(yaw, pitch, rise);
  // Never magnified past one plate unit per screen pixel at fit: these are
  // 760-unit plates cut from a 2752 px capture, so there is real detail to lose
  // but none to gain until the reader deliberately zooms. The cap is
  // 1 / SUPERSAMPLE rather than 1 because the deck is laid out that many times
  // larger — it is the same ceiling, counted in the same plate units.
  const fit =
    stageSize.w === 0
      ? 1
      : Math.min(1 / SUPERSAMPLE, (stageSize.w - STAGE_PAD * 2) / deck.w, (stageSize.h - STAGE_PAD * 2) / deck.h);
  const scale = fit * zoom;

  const flatness = 1 - clamp(spread / VEIL_SPAN, 0, 1);
  const focusGroupId = focusKey ? (planes.find((p) => p.key === focusKey)?.groupId ?? null) : null;

  // Listed top plane first, so reading down the legend is reading down through
  // the stack.
  const legendOrder = [...planes].reverse();

  /**
   * The disagreement patches, drawn as columns standing through the whole deck.
   *
   * Each mask patch has a position on the ground, and that ground is the same
   * ground every plate in the stack shows — so a vertical line at that position
   * says "this spot, on all of these dates at once", which is the one thing the
   * separated plates otherwise make hard to see.
   *
   * Flat SVG over the stage rather than geometry in the scene, for the same
   * reason the timestamps are (see `projectDeckPoint`): a line perpendicular to
   * the plates would be occluded by every plate it passes through, which is
   * exactly the wrong result for something whose purpose is to connect them.
   * Projecting the two endpoints and drawing between them is both simpler and
   * always visible.
   */
  const columns = useMemo(() => {
    if (!showProjection || !showDifferences || !differences || offsets.length === 0) return [];
    const bottom = Math.min(...shownOffsets);
    return differences.flatMap((diff) => {
      const mask = analysis[diff.id];
      // A mask the reader switched off, dialled to nothing, or that failed to
      // read has no columns — the line would point at something not shown.
      if (!mask || hidden[diff.id] || layerOpacity(diff.id) <= 0.02) return [];

      // Each column drops from ITS OWN mask's plane, not from the top of the
      // deck. The line's job is to carry one mask's patch down onto the ground
      // beneath it, so starting it anywhere else is a lie about which layer the
      // patch came from — with two masks at different heights, a column drawn
      // from the top of the stack would appear to belong to whichever mask
      // happens to be uppermost. Following the layer also means the columns
      // move when the reader restacks, which is the point.
      const planeIndex = planes.findIndex((p) => p.key === diff.id);
      if (planeIndex < 0) return [];
      const top = offsets[planeIndex];

      return mask.regions
        // Slivers dropped by GROUND area, not pixel count. A patch of 0.01 ha
        // is 100 m² — smaller than a single mature crown — and there are a
        // dozen of them where the two hand-drawn boundaries run nearly
        // parallel. They are the width of a pen, not places where anything
        // happened, and a column standing on each one buries the patches that
        // matter.
        .filter((region) => region.fraction * plotHectares >= MIN_REGION_HA)
        .map((region) => {
        const foot = projectDeckPoint(region.u, region.v, bottom, yaw, pitch);
        const head = projectDeckPoint(region.u, region.v, top, yaw, pitch);
        const key = `${diff.id}:${region.id}`;
        return {
          key,
          color: diff.color,
          direction: diff.direction,
          trees: treesPerRegion[key] ?? 0,
          hectares: region.fraction * plotHectares,
          x1: stageSize.w / 2 + foot.x * scale + pan.x,
          y1: stageSize.h / 2 + foot.y * scale + pan.y,
          x2: stageSize.w / 2 + head.x * scale + pan.x,
          y2: stageSize.h / 2 + head.y * scale + pan.y,
        };
      });
    });
  }, [
    showProjection,
    showDifferences,
    differences,
    analysis,
    hidden,
    layerOpacity,
    treesPerRegion,
    plotHectares,
    planes,
    offsets,
    yaw,
    pitch,
    scale,
    pan.x,
    pan.y,
    stageSize.w,
    stageSize.h,
  ]);

  /**
   * Fetches the close-up as soon as the projection is switched on, rather than
   * on the first badge hover.
   *
   * It is a 515 KB PNG, and a tooltip that opens onto an empty box and then
   * fills in half a second later reads as broken. Decoding it while the reader
   * is still looking at the columns costs nothing they can see. Gated on the
   * projection so a reader who never turns it on never pays for it.
   */
  useEffect(() => {
    if (!showProjection || !showDifferences) return;
    const preload = new Image();
    preload.src = COMPARE_DETAIL_URL;
  }, [showProjection, showDifferences]);

  const hovered = columns.find((c) => c.key === hoverRegion) ?? null;
  // Resolved through `columns` for the same reason `hovered` is: when the
  // projection is switched off the array empties, so a key left over from the
  // last hover resolves to nothing rather than needing to be cleared by hand.
  // Guarded on trees > 0 because a patch with no tree in it draws a plain dot,
  // not a numbered circle — there is no badge there to have hovered.
  const detail = columns.find((c) => c.key === detailKey && c.trees > 0) ?? null;

  /**
   * One timestamp per consecutive group run, placed at the projected top-right
   * corner of that run's topmost plate.
   *
   * The topmost of the run rather than the bottom because the label sits above
   * its anchor, and a run's own lower plates would be in the way. A run whose
   * every plane is switched off gets no label — there is nothing there to date.
   */
  const sceneLabels = useMemo(
    () =>
      planes
        .map((plane, i) => ({ plane, i }))
        .filter(
          ({ plane, i }) =>
            !!plane.groupTime &&
            !hidden[plane.key] &&
            // A layer dialled to nothing is as absent as a switched-off one,
            // and a date floating over a plate nobody can see is a puzzle.
            layerOpacity(plane.key) > 0.02 &&
            (i === planes.length - 1 || planes[i + 1].groupId !== plane.groupId),
        )
        .map(({ plane, i }) => {
          // Anchored to the middle of the plate's right edge, not a corner: it
          // is the point nearest the parked label at any orbit, so the leader
          // stays short, and unlike a corner it never swings to the far side of
          // the deck when the reader turns it past 90°.
          const anchor = projectDeckPoint(1, 0.5, offsets[i], yaw, pitch);
          return {
            key: plane.key,
            groupLabel: plane.groupLabel,
            time: plane.sceneTime,
            anchorX: anchor.x * scale + pan.x,
            anchorY: anchor.y * scale + pan.y,
          };
        })
        // Parked at the right edge, at their layer's own height — then pushed
        // apart where two layers are too close to label separately. Resolved
        // top-down in a single pass, which is enough for a handful of labels
        // and, unlike measuring the rendered pills, costs no layout read per
        // orbit frame.
        .sort((a, b) => a.anchorY - b.anchorY)
        .reduce<{ key: string; groupLabel: string; time: string; anchorX: number; anchorY: number; labelX: number; labelY: number }[]>(
          (placed, label) => {
            const top = -stageSize.h / 2 + LABEL_MARGIN_Y;
            const bottom = stageSize.h / 2 - LABEL_MARGIN_Y;
            const previous = placed[placed.length - 1];
            let y = clamp(label.anchorY, top, bottom);
            if (previous) y = Math.max(y, previous.labelY + MIN_LABEL_GAP);
            placed.push({
              ...label,
              labelX: stageSize.w / 2 - LABEL_RIGHT_INSET,
              labelY: Math.min(y, bottom),
            });
            return placed;
          },
          [],
        ),
    [planes, hidden, layerOpacity, offsets, yaw, pitch, scale, pan.x, pan.y, stageSize.w, stageSize.h],
  );

  const zoomed = Math.abs(zoom - 1) > 0.01;
  const atHome = yaw === HOME_YAW && pitch === HOME_PITCH && spread === SPREAD_DEFAULT && !zoomed && pan.x === 0 && pan.y === 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Capture stack"
      className="fixed inset-0 z-[1350] flex flex-col animate-fade-in"
      style={{ background: C.paper }}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="shrink-0 flex items-center gap-[18px] px-[24px] h-[64px] border-b"
        style={{ borderColor: C.line }}
      >
        {/* Wordmark: a solid mark and plain black type, after the reference's
            own logo. No boxed-out second word — that belonged to the previous
            reference's heavier idiom. */}
        <span className="flex items-center gap-[9px] shrink-0">
          <span
            className="flex items-center justify-center w-[26px] h-[26px] rounded-[8px]"
            style={{ background: C.ink }}
            aria-hidden="true"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 6 8 3l5.5 3L8 9 2.5 6Z" stroke={C.paper} strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M2.5 10 8 13l5.5-3" stroke={C.paper} strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </span>
          <span
            className="text-[17px] font-bold font-['Outfit',sans-serif] tracking-[-0.025em]"
            style={{ color: C.ink }}
          >
            capture stack
          </span>
        </span>

        {/* The differences switch. Was a pair of tabs; a switch is the honest
            control, because turning the masks on ADDS to what is already in
            the deck rather than replacing it. */}
        <button
          type="button"
          role="switch"
          aria-checked={showDifferences}
          disabled={!hasDifferences}
          onClick={() =>
            setShowDifferences((on) => {
              // The projection and the clipping are both drawn FROM these
              // masks, so neither can outlive them — leaving either switched on
              // would be a control claiming to use a shape that is no longer in
              // the deck, and a clip in particular would silently keep hiding
              // most of both captures with nothing on screen to explain why.
              if (on) {
                setShowProjection(false);
                setMaskWith(null);
              }
              return !on;
            })
          }
          title={hasDifferences ? undefined : "No disagreement masks were delivered for this plot"}
          className="u-press shrink-0 flex items-center gap-[9px] pl-[4px] pr-[13px] h-[34px] rounded-[10px] cursor-pointer transition-colors duration-150 disabled:opacity-35 disabled:cursor-default"
          style={{ background: C.panel }}
        >
          <span
            className="relative w-[34px] h-[20px] rounded-full transition-colors duration-(--dur-2)"
            style={{ background: showDifferences ? C.ink : "#CFCFCF" }}
            aria-hidden="true"
          >
            <span
              className="absolute top-[3px] w-[14px] h-[14px] rounded-full transition-[left] duration-(--dur-2) ease-(--ease-out)"
              style={{ left: showDifferences ? "17px" : "3px", background: C.paper }}
            />
          </span>
          <span
            className="text-[12.5px] font-semibold font-['Outfit',sans-serif]"
            style={{ color: showDifferences ? C.ink : C.muted }}
          >
            Differences
          </span>
        </button>

        {/* Projection. Only meaningful once the masks are in the deck, since
            they are what defines the patches — so it follows the switch above
            rather than standing on its own. */}
        <button
          type="button"
          role="switch"
          aria-checked={showProjection}
          disabled={!showDifferences}
          onClick={() => setShowProjection((on) => !on)}
          title={
            showDifferences
              ? "Stand a column through the deck at each patch of disagreement"
              : "Turn on Differences first — the patches come from those masks"
          }
          className="u-press shrink-0 flex items-center gap-[9px] pl-[4px] pr-[13px] h-[34px] rounded-[10px] cursor-pointer transition-colors duration-150 disabled:opacity-35 disabled:cursor-default"
          style={{ background: C.panel }}
        >
          <span
            className="relative w-[34px] h-[20px] rounded-full transition-colors duration-(--dur-2)"
            style={{ background: showProjection ? C.ink : "#CFCFCF" }}
            aria-hidden="true"
          >
            <span
              className="absolute top-[3px] w-[14px] h-[14px] rounded-full transition-[left] duration-(--dur-2) ease-(--ease-out)"
              style={{ left: showProjection ? "17px" : "3px", background: C.paper }}
            />
          </span>
          <span
            className="text-[12.5px] font-semibold font-['Outfit',sans-serif]"
            style={{ color: showProjection ? C.ink : C.muted }}
          >
            Project
          </span>
        </button>

        {/* Tree flow. Independent of the two switches beside it: it is about
            the trees between the two dates, which is true whether or not the
            disagreement masks are in the deck. */}
        <button
          type="button"
          role="switch"
          aria-checked={showFlow}
          disabled={!flowReport}
          onClick={() => setShowFlow((on) => !on)}
          title={
            flowReport
              ? "How many trees ended each date in each condition band"
              : "Needs two frames on different months to compare"
          }
          className="u-press shrink-0 flex items-center gap-[9px] pl-[4px] pr-[13px] h-[34px] rounded-[10px] cursor-pointer transition-colors duration-150 disabled:opacity-35 disabled:cursor-default"
          style={{ background: C.panel }}
        >
          <span
            className="relative w-[34px] h-[20px] rounded-full transition-colors duration-(--dur-2)"
            style={{ background: showFlow ? C.ink : "#CFCFCF" }}
            aria-hidden="true"
          >
            <span
              className="absolute top-[3px] w-[14px] h-[14px] rounded-full transition-[left] duration-(--dur-2) ease-(--ease-out)"
              style={{ left: showFlow ? "17px" : "3px", background: C.paper }}
            />
          </span>
          <span
            className="text-[12.5px] font-semibold font-['Outfit',sans-serif]"
            style={{ color: showFlow ? C.ink : C.muted }}
          >
            Tree flow
          </span>
        </button>

        <span className="min-w-0 flex-1 truncate text-[12.5px] font-['Outfit',sans-serif]" style={{ color: C.muted }}>
          {projectName} · {plotHectares.toLocaleString()} ha
        </span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close capture stack"
          className="u-press shrink-0 w-[32px] h-[32px] rounded-[9px] flex items-center justify-center cursor-pointer transition-colors duration-150"
          style={{ background: C.panel, color: C.ink }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* -------------------------------------------------------------- */}
        {/* Stage                                                          */}
        {/* -------------------------------------------------------------- */}
        <div
          ref={stageRef}
          className="cstack-stage relative flex-1 min-w-0 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{ background: C.stage }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            style={{
              // Pan is a screen-space nudge and so must be applied OUTSIDE the
              // scale, or dragging would move the deck by a distance that
              // changes with zoom.
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
              transformStyle: "preserve-3d",
              // Held back until every plate has its pixels: empty outlines
              // fanning open and then filling in reads as a bug.
              opacity: allLoaded ? 1 : 0,
              // The fit re-solves as the deck fans and as the orbit changes, so
              // the scale has to travel with the plates rather than stepping.
              // Same duration as .cstack-plane's transform so the two read as
              // one movement. One declaration because a later `transition`
              // shorthand would drop `transform` from the list.
              transition: "opacity var(--dur-4) var(--ease-soft), transform var(--dur-3) var(--ease-out)",
            }}
          >
            <div
              className="cstack-deck relative"
              style={
                {
                  width: `${PLANE_W}px`,
                  height: `${PLANE_H}px`,
                  transform: `rotateX(${pitch}deg) rotateZ(${yaw}deg)`,
                  // Every plate-unit length in the stylesheet multiplies by
                  // this — hairlines, corner radii, shadows and the trace
                  // dilation. Without it, supersampling would render all of
                  // them at a fraction of their intended screen size, and the
                  // 1 px boundary strokes the whole view exists to show would
                  // be the first thing to disappear.
                  "--ss": SUPERSAMPLE,
                } as React.CSSProperties
              }
            >
              {planes.map((plane, i) => (
                <div
                  key={plane.key}
                  className="cstack-plane"
                  style={{
                    width: `${PLANE_W}px`,
                    height: `${PLANE_H}px`,
                    // The +0.2 keeps the plates from being exactly coplanar at
                    // separation zero, where a depth tie between stacked quads
                    // can flicker between paints.
                    transform: `translateZ(${offsets[i] + (i - (planes.length - 1) / 2) * 0.2 * SUPERSAMPLE}px)`,
                    // Three independent reasons a plane can be less than
                    // solid, multiplied rather than merged: what the reader is
                    // pointing at, how flat the deck is, and what they set this
                    // layer's own opacity to. Keeping them separate means the
                    // hover emphasis still works on a layer already dialled
                    // back, instead of one overwriting the other.
                    opacity:
                      planeOpacity(plane, focusKey, focusGroupId, hidden) *
                      captureVeil(plane, i, firstShownIndex, flatness) *
                      layerOpacity(plane.key),
                    transitionDuration: settled ? "var(--dur-3)" : "var(--dur-5)",
                    transitionDelay: settled ? "0ms" : `${i * OPEN_STAGGER}ms`,
                    animationDelay: `${i * OPEN_STAGGER}ms`,
                    pointerEvents: hidden[plane.key] ? "none" : undefined,
                  }}
                  onPointerEnter={() => setFocusKey(plane.key)}
                  onPointerLeave={() => setFocusKey((prev) => (prev === plane.key ? null : prev))}
                >
                  <div
                    // Masks share the trace plate treatment: both are overlays
                    // with no ground of their own, and both want the tinted
                    // glass sheet that says "this layer is that colour". Only
                    // the stroke dilation below is trace-specific.
                    className={`cstack-plate w-full h-full ${
                      plane.kind === "capture" ? "cstack-plate--capture" : "cstack-plate--trace"
                    } ${plane.kind === "capture" && clipUrl ? "cstack-plate--masked" : ""}`}
                    style={
                      {
                        ...(plane.color ? { "--trace": plane.color } : {}),
                        // Only the captures are clipped. The traces are the
                        // boundaries the masks were derived FROM, and clipping
                        // a line to the region it encloses leaves a fragment
                        // of line that says nothing.
                        ...(plane.kind === "capture" && clipUrl ? { "--clip": `url("${clipUrl}")` } : {}),
                      } as React.CSSProperties
                    }
                  >
                    <img
                      src={plane.url}
                      alt=""
                      draggable={false}
                      decoding="async"
                      onLoad={() => markLoaded(plane.url)}
                      // A missing file must not wedge the reveal above.
                      onError={() => markLoaded(plane.url)}
                      className={`w-full h-full object-cover ${plane.kind === "trace" ? "cstack-trace-img" : ""}`}
                    />
                  </div>

                </div>
              ))}
            </div>
          </div>

          {/* One overlay for everything drawn in stage coordinates: the
              projection columns and the labels' leader lines. Kept as a single
              SVG so the two cannot disagree about where the deck is. */}
          {allLoaded && stageSize.w > 0 && (
            <svg
              className="absolute inset-0"
              width={stageSize.w}
              height={stageSize.h}
              style={{ zIndex: 1, pointerEvents: "none" }}
            >
              {/* Leaders: each parked label back to the layer it names. Drawn
                  all the way to the pill's own right edge rather than stopping
                  short of its left — the label's width is not known without a
                  layout read, and the pill is opaque and painted above this, so
                  the line simply disappears under it. */}
              {sceneLabels.map((label) => (
                <g key={`leader-${label.key}`}>
                  <line
                    x1={stageSize.w / 2 + label.anchorX}
                    y1={stageSize.h / 2 + label.anchorY}
                    x2={stageSize.w / 2 + label.labelX}
                    y2={stageSize.h / 2 + label.labelY}
                    stroke="rgba(255,255,255,0.5)"
                    strokeWidth={1}
                    strokeDasharray="2 3"
                  />
                  <circle
                    cx={stageSize.w / 2 + label.anchorX}
                    cy={stageSize.h / 2 + label.anchorY}
                    r={2.4}
                    fill="rgba(255,255,255,0.9)"
                  />
                </g>
              ))}

              {columns.map((column) => {
                const active = hoverRegion === column.key;
                return (
                  <g key={column.key}>
                    <line
                      x1={column.x1}
                      y1={column.y1}
                      x2={column.x2}
                      y2={column.y2}
                      stroke={column.color}
                      strokeWidth={active ? 2.4 : 1.3}
                      strokeDasharray={active ? undefined : "4 4"}
                      opacity={active ? 1 : 0.75}
                    />
                    {/* Foot: where the column lands on the ground below. */}
                    <circle cx={column.x1} cy={column.y1} r={active ? 3.4 : 2.2} fill={column.color} />

                    {/* Head: the count, signed, on the mask's own layer.
                        A signed badge rather than a plain dot because the
                        number is the whole point of the column and a reader
                        should not have to hover eighteen of them to find the
                        one that matters. The sign carries the direction —
                        negative where the later boundary gave ground up,
                        positive where it took ground — so the badge reads
                        without reference to the legend.

                        A patch with no tree in it keeps the plain dot: "+0" is
                        not a finding, and eighteen zeroes would bury the
                        handful of real ones. */}
                    {column.trees > 0 ? (
                      <g>
                        <circle
                          cx={column.x2}
                          cy={column.y2}
                          r={active ? 12 : 10.5}
                          fill={C.paper}
                          stroke={column.color}
                          strokeWidth={active ? 2.2 : 1.6}
                        />
                        <text
                          x={column.x2}
                          y={column.y2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={active ? 10.5 : 9.5}
                          fontWeight={700}
                          fontFamily="Outfit, sans-serif"
                          fill={C.ink}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {/* A true minus sign, not a hyphen — at this size a
                              hyphen reads as a dash between digits. */}
                          {column.direction === "gained" ? "+" : "−"}
                          {column.trees}
                        </text>
                      </g>
                    ) : (
                      <circle cx={column.x2} cy={column.y2} r={active ? 3.4 : 2.2} fill={column.color} />
                    )}
                    {/* A fat transparent stroke is the hit target: a 1.3 px
                        dashed line is unhittable with a mouse, and widening the
                        visible line to catch the pointer would bury the deck
                        under it. */}
                    <line
                      x1={column.x1}
                      y1={column.y1}
                      x2={column.x2}
                      y2={column.y2}
                      stroke="transparent"
                      strokeWidth={16}
                      style={{ pointerEvents: "stroke", cursor: "help" }}
                      onPointerEnter={() => setHoverRegion(column.key)}
                      onPointerLeave={() => setHoverRegion((prev) => (prev === column.key ? null : prev))}
                    />
                    {/* And a disc at the head, because the line can be short or
                        have no length at all — a mask restacked to the bottom
                        of the deck sits ON the ground it projects onto, and a
                        zero-length stroke cannot be hovered. */}
                    <circle
                      cx={column.x2}
                      cy={column.y2}
                      // Covers the count badge, so the number itself is
                      // hoverable rather than only the hairline under it.
                      r={13}
                      fill="transparent"
                      style={{ pointerEvents: "fill", cursor: "help" }}
                      onPointerEnter={() => {
                        setHoverRegion(column.key);
                        // Only the numbered circle opens the close-up. A patch
                        // with no mapped tree has nothing to compare, and its
                        // head is a 2 px dot rather than a badge.
                        if (column.trees > 0) setDetailKey(column.key);
                      }}
                      onPointerLeave={() => {
                        setHoverRegion((prev) => (prev === column.key ? null : prev));
                        setDetailKey((prev) => (prev === column.key ? null : prev));
                      }}
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {/* What stands at the hovered spot. Deliberately a plain count of
              real trees rather than a modelled rate: every tree in the
              population carries its own position, so this is how many are
              actually inside that patch. */}
          {/* Suppressed while the close-up is open: that panel carries the
              same count in its own header, and two boxes stacked over one badge
              is one too many. */}
          {hovered && !detail && (
            <div
              className="absolute pointer-events-none animate-fade-in"
              style={{
                left: hovered.x2,
                top: hovered.y2,
                transform: "translate(-50%, -132%)",
                zIndex: 3,
              }}
            >
              <span
                className="flex flex-col gap-[1px] px-[10px] py-[7px] rounded-[9px] whitespace-nowrap"
                style={{
                  background: C.paper,
                  border: `1px solid ${C.line}`,
                  boxShadow: "0 6px 16px -5px rgba(10,10,10,0.3)",
                }}
              >
                <span className="flex items-center gap-[6px]">
                  <span
                    className="w-[9px] h-[9px] rounded-[2px] shrink-0"
                    style={{ background: hovered.color }}
                    aria-hidden="true"
                  />
                  {/* A patch can hold no tree at all — the smallest are a
                      fraction of a hectare, and a tree has to have its
                      recorded position inside one to count. Saying so plainly
                      beats "0 trees died back", which reads as a broken
                      statistic rather than as the true statement it is. */}
                  {hovered.trees === 0 ? (
                    <span
                      className="text-[12px] font-semibold font-['Outfit',sans-serif] leading-[16px]"
                      style={{ color: C.ink }}
                    >
                      No mapped trees inside
                    </span>
                  ) : (
                    <>
                      <span
                        className="text-[12px] font-bold font-['Outfit',sans-serif] tabular-nums leading-[16px]"
                        style={{ color: C.ink }}
                      >
                        {hovered.trees} {hovered.trees === 1 ? "tree" : "trees"}
                      </span>
                      <span
                        className="text-[11px] font-semibold font-['Outfit',sans-serif] leading-[16px]"
                        style={{ color: C.ink }}
                      >
                        {hovered.direction === "gained" ? "extended" : "died back"}
                      </span>
                    </>
                  )}
                </span>
                <span
                  className="text-[10px] font-['Outfit',sans-serif] leading-[14px] tabular-nums"
                  style={{ color: C.muted }}
                >
                  {hovered.hectares.toFixed(2)} ha ·{" "}
                  {hovered.direction === "gained" ? "only in the later pass" : "only in the earlier pass"}
                </span>
              </span>
            </div>
          )}

          {/* The close-up, opened from a count badge.
              A window rather than a line of text because the number on the
              badge answers "how many" and the reader's next question is "what
              does that look like" — which no amount of copy answers as well as
              two crops side by side. */}
          {detail &&
            (() => {
              // An estimate, rounded UP: the image is a fixed size but the
              // caption can take two lines or three, and the flip below has to
              // choose up or down before any of it is in the DOM to measure.
              // Erring high flips a badge near the top of the stage a little
              // sooner than strictly needed; erring low would let the panel
              // hang off the edge, which is the failure that shows.
              const panelH = DETAIL_H + 92;
              const place = detailPlacement(detail.x2, detail.y2, stageSize, panelH);
              return (
                <div
                  className="absolute pointer-events-none animate-fade-in"
                  style={{ left: place.left, top: place.top, width: DETAIL_W + 20, zIndex: 4 }}
                >
                  <span
                    className="flex flex-col gap-[7px] p-[10px] rounded-[11px]"
                    style={{
                      background: C.paper,
                      border: `1px solid ${C.line}`,
                      boxShadow: "0 14px 34px -10px rgba(10,10,10,0.45)",
                    }}
                  >
                    <span className="flex items-center gap-[7px]">
                      <span
                        className="w-[9px] h-[9px] rounded-[2px] shrink-0"
                        style={{ background: detail.color }}
                        aria-hidden="true"
                      />
                      <span
                        className="text-[12px] font-bold font-['Outfit',sans-serif] tabular-nums leading-[16px]"
                        style={{ color: C.ink }}
                      >
                        {detail.trees} {detail.trees === 1 ? "tree" : "trees"}
                      </span>
                      <span
                        className="text-[11px] font-semibold font-['Outfit',sans-serif] leading-[16px]"
                        style={{ color: C.ink }}
                      >
                        {detail.direction === "gained" ? "extended" : "died back"}
                      </span>
                      <span
                        className="text-[10px] font-['Outfit',sans-serif] leading-[16px] tabular-nums ml-auto"
                        style={{ color: C.muted }}
                      >
                        {detail.hectares.toFixed(2)} ha
                      </span>
                    </span>

                    <img
                      src={COMPARE_DETAIL_URL}
                      alt="The two drone passes over the same ground, side by side at survey resolution"
                      width={DETAIL_W}
                      height={DETAIL_H}
                      className="block rounded-[6px]"
                      style={{ width: DETAIL_W, height: DETAIL_H, objectFit: "cover", background: C.panel }}
                    />

                    {/* The provenance line. Without it a reader reasonably
                        takes this for a crop of the patch they are pointing at,
                        which is the one thing the file cannot support. */}
                    <span
                      className="text-[9.5px] font-['Outfit',sans-serif] leading-[13px]"
                      style={{ color: C.muted }}
                    >
                      Both passes over the same ground, at survey resolution. A delivered sample detail — not a crop of
                      this patch.
                    </span>
                  </span>
                </div>
              );
            })()}

          {/* Timestamps, one per group run.
              Both planes of a pass carry the same date, so labelling every
              plate would print it twice on two plates a hundred pixels apart.

              Parked against the right edge rather than floating over their
              plates. Free-floating labels moved with the geometry, so a turn of
              the deck scattered them and two could end up on top of each other;
              a fixed column reads as a key, stays put while the reader orbits,
              and never covers the imagery. The dotted leader is what keeps each
              one attached to the layer it names.

              Flat DOM over the scene rather than inside it — see
              `projectDeckPoint` for why — which also means they keep a constant
              size, so zooming in to inspect a boundary does not blow the labels
              up with it. */}
          {allLoaded && (
            <div className="absolute left-1/2 top-1/2 w-0 h-0 pointer-events-none" style={{ zIndex: 2 }}>
              {sceneLabels.map((label) => (
                <div
                  key={label.key}
                  className="absolute animate-fade-in"
                  style={{
                    // Right edge of the pill lands on labelX, middle on labelY.
                    transform: `translate3d(${label.labelX}px, ${label.labelY}px, 0) translate(-100%, -50%)`,
                    transition: "transform var(--dur-3) var(--ease-out)",
                  }}
                >
                  <span
                    className="inline-flex items-center gap-[7px] px-[9px] py-[4px] rounded-[8px] whitespace-nowrap"
                    style={{
                      background: C.paper,
                      border: `1px solid ${C.line}`,
                      boxShadow: "0 4px 12px -4px rgba(10,10,10,0.25)",
                    }}
                  >
                    <span
                      className="text-[11px] font-semibold font-['Outfit',sans-serif] leading-[15px]"
                      style={{ color: C.ink }}
                    >
                      {label.groupLabel}
                    </span>
                    <span className="w-px h-[11px]" style={{ background: C.line }} />
                    <span
                      className="text-[11px] font-['Outfit',sans-serif] leading-[15px] tabular-nums"
                      style={{ color: C.muted }}
                    >
                      {label.time}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {!allLoaded && (
            <span
              className="absolute text-[12px] font-['Outfit',sans-serif] tracking-[0.04em]"
              style={{ color: C.onStage }}
            >
              Loading captures…
            </span>
          )}

          {/* Tree flow.
              Top-left of the stage: clear of the timestamps (which sit above
              the plates, centre-right) and of the zoom cluster and the hint
              (both along the bottom), so nothing has to move when it opens. */}
          {showFlow && flowReport && (
            <div
              className="absolute left-[18px] top-[18px] w-[412px] rounded-[14px] px-[14px] pt-[12px] pb-[10px] animate-fade-in-left"
              style={{
                background: C.paper,
                border: `1px solid ${C.line}`,
                boxShadow: "0 14px 40px -12px rgba(0,0,0,0.5)",
                zIndex: 4,
              }}
            >
              <div className="flex items-baseline justify-between gap-[8px]">
                <span
                  className="text-[13.5px] font-bold font-['Outfit',sans-serif] tracking-[-0.02em]"
                  style={{ color: C.ink }}
                >
                  Tree flow
                </span>
                <span className="text-[10.5px] font-['Outfit',sans-serif]" style={{ color: C.muted }}>
                  condition band, date to date
                </span>
              </div>
              <TreeFlowSankey
                report={flowReport}
                width={384}
                height={168}
                ink={C.ink}
                muted={C.muted}
                line={C.line}
                paper={C.panel}
              />
            </div>
          )}

          {/* Zoom cluster. A floating white bar with a soft lift — the
              reference's own control treatment, no offset block. */}
          <div
            className="absolute left-[18px] bottom-[18px] flex items-center gap-[3px] p-[4px] rounded-[12px]"
            style={{
              background: C.paper,
              border: `1px solid ${C.line}`,
              boxShadow: "0 6px 18px -6px rgba(10,10,10,0.18)",
            }}
          >
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(z / ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
              disabled={zoom <= MIN_ZOOM + 0.001}
              aria-label="Zoom out"
              className="u-press w-[28px] h-[28px] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#EFEFEF] disabled:opacity-30 disabled:cursor-default"
              style={{ color: C.ink }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 8h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <span
              className="min-w-[52px] text-center text-[12px] font-bold font-['Outfit',sans-serif] tabular-nums"
              style={{ color: C.ink }}
              aria-live="polite"
            >
              {zoom.toFixed(zoom < 10 ? 1 : 0)}×
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(z * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
              disabled={zoom >= MAX_ZOOM - 0.001}
              aria-label="Zoom in"
              className="u-press w-[28px] h-[28px] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#EFEFEF] disabled:opacity-30 disabled:cursor-default"
              style={{ color: C.ink }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={resetView}
              disabled={atHome}
              className="u-press ml-[2px] px-[14px] h-[28px] rounded-[9px] text-[11.5px] font-semibold font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150 disabled:cursor-default"
              style={atHome ? { background: C.panel, color: C.muted } : { background: C.ink, color: C.paper }}
            >
              Fit
            </button>
          </div>

          <span
            className="absolute right-[18px] bottom-[22px] text-[11px] font-['Outfit',sans-serif] text-right leading-[16px] pointer-events-none"
            style={{ color: C.onStage }}
          >
            drag to turn · scroll to zoom
            <br />
            shift-drag to pan
          </span>
        </div>

        {/* -------------------------------------------------------------- */}
        {/* Legend rail                                                     */}
        {/* -------------------------------------------------------------- */}
        <div
          className="shrink-0 w-[352px] flex flex-col border-l"
          style={{ borderColor: C.line, background: C.paper }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto scroll-slim px-[20px] py-[18px]">
            {/* One panel, heading included.
                The heading used to sit above the layer cards, which read as two
                separate statements about the same thing — and in the
                differences reading, where there is only ONE group, "What moved"
                followed by a card called "Disagreement" said it twice. Merging
                them means the title, the interval and the layers it resolves
                into are a single block, which is also how the reference groups
                content: a soft panel per subject, no borders, no shadow. */}
            <div className="rounded-[14px] px-[14px] py-[14px]" style={{ background: C.panel }}>
              <div className="flex items-start justify-between gap-[10px]">
                <h2
                  className="text-[22px] font-bold font-['Outfit',sans-serif] tracking-[-0.03em] leading-[26px]"
                  style={{ color: C.ink }}
                >
                  Layers
                </h2>
                <Badge>{planes.length}</Badge>
              </div>
              <p className="text-[11.5px] font-['Outfit',sans-serif] leading-[17px] mt-[6px]" style={{ color: C.muted }}>
                Each drone pass with the vegetation extent delineated on it
                {showDifferences ? ", plus where the two boundaries disagree" : ""}. Drag a layer to restack it; close
                the separation to read the boundaries directly against each other.
              </p>

              {orderChanged && (
                <button
                  type="button"
                  onClick={() => setOrder(defaultOrder.slice())}
                  className="u-press mt-[8px] text-[11px] font-semibold font-['Outfit',sans-serif] underline decoration-1 underline-offset-2 cursor-pointer"
                  style={{ color: C.ink }}
                >
                  Reset order
                </button>
              )}

              {groupRuns(legendOrder).map((run) => (
                // The rule above every group, the first included: it also
                // separates the layers from the description they belong to.
                <div key={run[0].groupId} className="mt-[14px] pt-[13px] border-t" style={{ borderColor: C.line }}>
                  <div className="flex items-center justify-between gap-[8px] flex-wrap">
                    <span className="flex items-center gap-[5px] min-w-0">
                      <span
                        className="text-[13px] font-bold font-['Outfit',sans-serif] tracking-[-0.015em] truncate"
                        style={{ color: C.ink }}
                      >
                        {run[0].groupLabel}
                      </span>
                      {/* Swap the two passes as units.
                          On both pass headers rather than one control between
                          them, because after a restack the two groups are not
                          necessarily adjacent — a button that lived "between"
                          them would have nowhere to sit. Either one performs
                          the same exchange.

                          Note what this does NOT change: "Earlier" and "Later"
                          name which frame a pass came from, not where it sits
                          in the deck. Swapping puts the later capture
                          underneath; it does not make it the earlier one, and
                          the date badge beside this label is what keeps that
                          honest. */}
                      {passGroupIds.length === 2 && passGroupIds.includes(run[0].groupId) && (
                        <button
                          type="button"
                          onClick={swapPasses}
                          aria-label="Swap the earlier and later passes in the stack"
                          title="Swap the two passes — puts this one on the other side of the deck"
                          className="u-press shrink-0 w-[22px] h-[22px] rounded-[6px] flex items-center justify-center cursor-pointer transition-colors duration-150 hover:bg-white"
                          style={{ color: C.muted }}
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path
                              d="M5.5 2.5 3 5l2.5 2.5M3 5h7.5M10.5 13.5 13 11l-2.5-2.5M13 11H5.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </span>
                    {/* The masks' interval gets the accent, because it is a
                        span between two dates rather than one frame's own
                        window — a different kind of fact from the ones above
                        it. */}
                    {run[0].groupTime && (
                      <Badge tone={run[0].groupId === "diff" ? "accent" : "plain"}>{run[0].groupTime}</Badge>
                    )}
                  </div>

                  {/* The way out of the limitation this group is showing.
                      The disagreement between two boundaries is exactly where
                      the reader runs out of resolution — the masks say ground
                      changed, and at this tier the imagery cannot say whether a
                      crown died or dropped its leaves for a season. So the
                      offer belongs here, under the interval it applies to,
                      rather than in the chrome.

                      Its own line rather than a third item in the header row
                      above: that row is `flex-wrap`, and a button long enough
                      to say what it does would push the interval badge onto a
                      line of its own and break the pairing of label and date.

                      Answered with HiResConfirmation, the same card the
                      advisor's own version of this request raises — one
                      request, one receipt, rather than two surfaces answering
                      the same ask differently. */}
                  {run[0].groupId === "diff" && hiResBlockCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setHiResOpen(true)}
                      title={`Commission a ${PROSE_RESOLUTION} pass over the failing ground`}
                      className="u-press mt-[9px] inline-flex items-center gap-[5px] pl-[9px] pr-[10px] h-[26px] rounded-[8px] text-[11px] font-semibold font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150"
                      style={{ background: C.ink, color: C.paper }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                          d="M2.5 12.5V6.2l3.1-2.7 2.6 2.2 2.4-2 2.9 2.5v6.3z"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinejoin="round"
                        />
                        <circle cx="6" cy="8.6" r="1.2" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                      Request a new high-res image
                    </button>
                  )}

                  <div className="flex flex-col gap-[2px] mt-[8px]">
                    {run.map((plane) => {
                      const off = !!hidden[plane.key];
                      const area = plane.kind === "mask" ? maskHectares(plane.key) : null;
                      return (
                        <div
                          key={plane.key}
                          ref={setRowRef(plane.key)}
                          // The row is the drop TARGET; only the grip starts a
                          // drag, so the eye toggle and the label stay plain
                          // content rather than accidental drag sources — the
                          // same split LayerPanel uses.
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggedKey && draggedKey !== plane.key) setDragOverKey(plane.key);
                          }}
                          onDragLeave={() => setDragOverKey((prev) => (prev === plane.key ? null : prev))}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedKey) moveTo(draggedKey, plane.key);
                            setDraggedKey(null);
                            setDragOverKey(null);
                          }}
                          className={`px-[6px] py-[7px] rounded-[9px] transition-colors duration-150 ${
                            off ? "opacity-45" : ""
                          } ${draggedKey === plane.key ? "opacity-50" : ""} ${
                            dragOverKey === plane.key && draggedKey !== plane.key
                              ? "outline-2 outline-offset-1 outline-[#0A0A0A]"
                              : ""
                          }`}
                          style={{ background: focusKey === plane.key ? C.paper : "transparent" }}
                          onPointerEnter={() => setFocusKey(plane.key)}
                          onPointerLeave={() => setFocusKey((prev) => (prev === plane.key ? null : prev))}
                        >
                          <div className="flex items-center gap-[8px]">
                          {/* Grip. Draggable for a mouse, and arrow-key
                              steppable for a keyboard — a drag-only reorder
                              would leave this list unusable without a
                              pointer. */}
                          <span
                            draggable
                            tabIndex={0}
                            role="button"
                            aria-label={`Reorder ${plane.title}. Use arrow up and down to move it through the stack.`}
                            onDragStart={(e) => {
                              setDraggedKey(plane.key);
                              // Firefox will not start a drag unless data is set.
                              e.dataTransfer.setData("text/plain", plane.key);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              setDraggedKey(null);
                              setDragOverKey(null);
                            }}
                            onKeyDown={(e) => {
                              // The legend runs top-of-stack first, so the up
                              // arrow has to move the layer UP the stack, which
                              // is +1 in the bottom-to-top order.
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                step(plane.key, 1);
                              } else if (e.key === "ArrowDown") {
                                e.preventDefault();
                                step(plane.key, -1);
                              }
                            }}
                            className="shrink-0 flex items-center justify-center w-[14px] h-[22px] cursor-grab active:cursor-grabbing rounded-[4px]"
                            style={{ color: "#C4C4CC" }}
                            title="Drag to restack"
                          >
                            <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
                              <circle cx="2" cy="2" r="1.3" />
                              <circle cx="6" cy="2" r="1.3" />
                              <circle cx="2" cy="7" r="1.3" />
                              <circle cx="6" cy="7" r="1.3" />
                              <circle cx="2" cy="12" r="1.3" />
                              <circle cx="6" cy="12" r="1.3" />
                            </svg>
                          </span>

                          <span
                            className="shrink-0 w-[18px] h-[11px] rounded-[3px]"
                            style={
                              plane.color
                                ? { border: `2px solid ${plane.color}`, background: `${plane.color}2E` }
                                : { border: `1px solid ${C.muted}`, background: "#C9BDB2" }
                            }
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className="block text-[12px] font-semibold font-['Outfit',sans-serif] leading-[16px] truncate"
                              style={{ color: C.ink }}
                            >
                              {plane.title}
                            </span>
                            <span
                              className="block text-[10.5px] font-['Outfit',sans-serif] leading-[14px]"
                              style={{ color: C.muted }}
                            >
                              {plane.note}
                              {area != null && (
                                <>
                                  {" · "}
                                  <span className="font-bold tabular-nums" style={{ color: C.ink }}>
                                    {area.toFixed(2)} ha
                                  </span>
                                </>
                              )}
                            </span>
                          </span>
                          {/* Use this mask to clip the captures.
                              Only on the disagreement layers, because only
                              they describe a region — clipping the imagery to
                              a capture or to a boundary line is meaningless.
                              Sits beside the eye rather than replacing it: a
                              reader will often want the mask itself switched
                              off while its shape is still doing the clipping,
                              so the two controls have to be independent. */}
                          {plane.kind === "mask" && (
                            <button
                              type="button"
                              onClick={() => setMaskWith((prev) => (prev === plane.key ? null : plane.key))}
                              aria-pressed={maskWith === plane.key}
                              aria-label={`${maskWith === plane.key ? "Stop clipping" : "Clip"} the captures to ${plane.title}`}
                              title={
                                maskWith === plane.key
                                  ? "Show the whole captures again"
                                  : "Show only the part of each capture inside this patch"
                              }
                              className="u-press shrink-0 w-[26px] h-[26px] rounded-[8px] flex items-center justify-center cursor-pointer transition-colors duration-150"
                              style={
                                maskWith === plane.key
                                  ? { background: C.ink, color: C.paper }
                                  : { background: "transparent", color: C.muted }
                              }
                            >
                              {/* A frame with a hole punched through it — the
                                  shape of the operation. */}
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
                                <path
                                  d="M5.2 9.6c1-2.2 2-2.6 3-1.4s2 .6 2.6-1.2"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setHidden((prev) => ({ ...prev, [plane.key]: !prev[plane.key] }))}
                            aria-pressed={off}
                            aria-label={`${off ? "Show" : "Hide"} ${plane.title}, ${plane.note}`}
                            className="u-press shrink-0 w-[26px] h-[26px] rounded-[8px] flex items-center justify-center cursor-pointer transition-colors duration-150 hover:bg-white"
                            style={{ color: C.muted }}
                          >
                            <EyeIcon off={off} />
                          </button>
                          </div>

                          {/* Opacity. Indented under the row it belongs to,
                              matching LayerPanel's own per-layer slider so the
                              two layer lists in this app read the same way.

                              Independent of the eye toggle rather than folded
                              into it: dialling a capture back to 30% to read a
                              boundary through it is a different intent from
                              taking it out of the comparison, and a reader who
                              does the first still wants the second available
                              without losing the value they set. */}
                          <div className="flex items-center gap-[8px] mt-[5px] pl-[22px]">
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 16 16"
                              className="shrink-0"
                              style={{ color: C.muted }}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              aria-hidden="true"
                            >
                              <circle cx="8" cy="8" r="6" />
                              <path d="M8 2a6 6 0 0 1 0 12" fill="currentColor" stroke="none" />
                            </svg>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={layerOpacity(plane.key)}
                              onChange={(e) =>
                                setOpacityByKey((prev) => ({ ...prev, [plane.key]: Number(e.target.value) }))
                              }
                              aria-label={`${plane.title} opacity`}
                              className="flex-1 h-[4px] cursor-pointer"
                              style={{ accentColor: C.ink }}
                            />
                            <span
                              className="w-[30px] shrink-0 text-right text-[10px] font-['Outfit',sans-serif] tabular-nums"
                              style={{ color: C.muted }}
                            >
                              {Math.round(layerOpacity(plane.key) * 100)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[10.5px] font-['Outfit',sans-serif] leading-[15px] mt-[14px]" style={{ color: C.muted }}>
              The frames carry no survey date. The months above are the stretch of the plot's timeline each frame stands
              for — the same ordering the timeline itself uses to pick imagery — not a capture date. Extents and
              disagreement masks are delivered traces; the areas shown are measured off those masks, nothing more is
              inferred from them.
            </p>
          </div>

          {/* Separation. */}
          <div className="shrink-0 border-t px-[20px] py-[16px]" style={{ borderColor: C.line }}>
            <label className="flex items-center justify-between gap-[8px]">
              <span className="text-[12.5px] font-semibold font-['Outfit',sans-serif]" style={{ color: C.ink }}>
                Separation
              </span>
              <span className="text-[11px] font-['Outfit',sans-serif] tabular-nums" style={{ color: C.muted }}>
                {spread === 0 ? "flat" : Math.round(spread)}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={SPREAD_MAX}
              step={1}
              value={spread}
              onChange={(e) => {
                takeOver();
                setSpread(Number(e.target.value));
              }}
              className="w-full mt-[10px] cursor-pointer"
              style={{ accentColor: C.ink }}
            />
            <button
              type="button"
              onClick={() => {
                takeOver();
                setSpread(0);
              }}
              disabled={spread === 0}
              className="u-press w-full mt-[12px] h-[40px] rounded-[10px] text-[13px] font-semibold font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150 disabled:cursor-default"
              style={
                spread === 0
                  ? { background: C.panel, color: C.muted }
                  : { background: C.ink, color: C.paper }
              }
            >
              {spread === 0 ? "Flattened" : "Flatten to overlay"}
            </button>
          </div>
        </div>
      </div>

      {/* Its own z-[1400] clears this stack's z-[1350], so the receipt lands
          over the deck rather than behind it. */}
      {hiResOpen && (
        <HiResConfirmation
          projectName={projectName}
          resolution={PROSE_RESOLUTION}
          blockCount={hiResBlockCount}
          areaHa={plotHectares}
          onDismiss={() => setHiResOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}

/** Consecutive planes sharing a group, in the order given. */
function groupRuns(planes: StackPlane[]): StackPlane[][] {
  const runs: StackPlane[][] = [];
  planes.forEach((plane) => {
    const last = runs[runs.length - 1];
    if (last && last[0].groupId === plane.groupId) last.push(plane);
    else runs.push([plane]);
  });
  return runs;
}
