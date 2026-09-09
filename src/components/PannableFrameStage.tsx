import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { smootherstep, underlayOpacity } from "../lib/crossfade";
import { seededRandom } from "../data/random";
import type { TreeEvent } from "../data/events";

/** Same stable-but-arbitrary offset an event's own id always lands on — see
 *  `focusKey`'s own comment on the component below. Shared by the zoom-target
 *  math and by every marker's resting position, so a pin and the crop the
 *  zoom lands on can never disagree about where "that event's area" is. */
function pinOffset(key: string): { ox: number; oy: number } {
  const rand = seededRandom(`habitat-focus:${key}`);
  const angle = rand() * 2 * Math.PI;
  // Radius drawn via sqrt(rand()), not rand() directly — a bare `rand()`
  // radius bunches points near the centre (area shrinks faster than radius
  // does approaching 0), and a FIXED radius (the old 0.18) puts every point
  // on the same ring regardless of angle, which is what read as "a circle"
  // rather than a scatter. sqrt gives a uniform spread across the disk's
  // whole area instead.
  const radius = 0.06 + Math.sqrt(rand()) * 0.36;
  return { ox: Math.cos(angle) * radius, oy: Math.sin(angle) * radius };
}

/** Same "approximate area, not a measured boundary" honesty as the ring it
 *  replaces, just shaped like an irregular field boundary instead of a
 *  perfect circle — an uneven vertex count with per-vertex radius jitter,
 *  stable per event key so it never reshapes itself between renders. */
function delineationPolygon(key: string): string {
  const rand = seededRandom(`habitat-shape:${key}`);
  const vertexCount = 6 + Math.floor(rand() * 4); // 6..9 vertices
  const cx = 36;
  const cy = 36;
  const points: string[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (i / vertexCount) * 2 * Math.PI;
    const r = 24 + rand() * 14; // uneven radius per vertex, never a circle
    points.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
  }
  return points.join(" ");
}

/** Same clustered-but-jittered idea as `pinOffset`, tuned tight around one
 *  shared anchor rather than spread across the whole photo — permit areas are
 *  meant to read as overlapping claims over the same disputed ground (see the
 *  boundary/permit-conflict narrative this stage's focused event already
 *  tells), not scattered independent locations. */
function permitAreaOffset(key: string): { ox: number; oy: number } {
  const rand = seededRandom(`permit-area:${key}`);
  const angle = rand() * 2 * Math.PI;
  const radius = 0.05 + rand() * 0.06;
  return { ox: 0.14 + Math.cos(angle) * radius, oy: -0.08 + Math.sin(angle) * radius };
}

/**
 * A plain photo stage: dissolve between a small set of frames, pan and zoom
 * over whichever one is showing. Extracted from `AreaImageStage` (Abu Al
 * Abyad's map substitute), stripped of everything specific to that site —
 * the survey rectangles, the bird markers, the split-census prompt — because
 * this is for a place that has none of that: a plain reference photo shown
 * somewhere that has no live map of its own to fall back on.
 */
const FADE_MS = 620;
const MIN_SCALE = 1;
const MAX_SCALE = 6;

export default function PannableFrameStage({
  frames,
  className = "",
  style,
  label,
  frameIndex,
  onFrameIndexChange,
  focusSignal,
  focusKey,
  focusEvent,
  hiResFrameIndex,
  compareSrc,
  compareLabel,
  differenceSrc,
  baseSrc,
  permitAreas,
  notificationEvents,
  onSelectNotification,
}: {
  frames: string[];
  className?: string;
  style?: CSSProperties;
  /** Read by screen readers and shown as the frame caption — e.g. "Habitat
   *  reference capture". */
  label: string;
  /** A permanent bottom layer, always visible unless a `frames` entry is
   *  overlaid on top of it — the real satellite basemap this reference set
   *  sits over. `null`/no `frameIndex` selected means this is all that
   *  shows, which is the honest starting state: nothing has been overlaid
   *  yet. */
  baseSrc?: string;
  /** Seeds which frame is showing, for a caller that wants an external
   *  control (App.tsx's own tick row, replacing the calendar picker on this
   *  tab) to move the same stage its in-image dots already control. Optional:
   *  with nothing passed, this behaves exactly as before, timeline owned
   *  entirely inside the stage. `null` means no frame is overlaid — only
   *  `baseSrc` shows. */
  frameIndex?: number | null;
  /** Reports every frame change — both the in-image dots and an external
   *  `frameIndex` prop change — so an outside tick row can mirror which frame
   *  is active without owning the crossfade itself. */
  onFrameIndexChange?: (index: number | null) => void;
  /** Bumping this (any new number) eases the view in toward a closer, offset
   *  crop — a visual "zooming in to look closer" reaction to selecting an
   *  event elsewhere on the page. This is deliberately NOT a claim that the
   *  crop it lands on is where that event happened: this stage shows a plain
   *  reference photo with no per-event coordinates, so the honest thing is a
   *  generic "look closer" reaction, not a fake pinpoint. */
  focusSignal?: number;
  /** Identifies *which* event `focusSignal` is reacting to (e.g. the event's
   *  own id) — seeds the offset the zoom lands on, so the same event always
   *  reads as "its own" area of the photo instead of a different spot every
   *  time depending on click order. Still not a real geotag (see
   *  `focusSignal`'s own comment): a stable-but-arbitrary area, not a
   *  measured one. Falls back to the old click-order-based spread when
   *  omitted. */
  focusKey?: string;
  /** The event `focusKey` identifies — read only for its own already-real
   *  fields (title, description, tree id/health) to show on hover over the
   *  marker. Nothing here is computed fresh for this stage; it's the same
   *  species count and description the Recent Events row already shows. */
  focusEvent?: TreeEvent;
  /** Which `frames` index is the commissioned hi-res capture, if any is in
   *  the array — gates the zoom-pulse transition (see `goTo`'s own comment)
   *  to only the hand-off between it and the reference set, not among the
   *  reference frames themselves. */
  hiResFrameIndex?: number;
  /** A second capture to overlay on the one currently shown, blended by a
   *  reader-controlled slider — the "Compare" toggle beside a timeline
   *  marker. Absent means no compare is active, the plain single-frame
   *  crossfade this stage has always done. */
  compareSrc?: string;
  /** Read by screen readers and shown as the overlay's own caption — e.g.
   *  "Compared with capture 2". */
  compareLabel?: string;
  /** The real delivered difference mask for this reference set — a
   *  soft-edged raster with its own alpha (0 where nothing changed, up to
   *  255 where it did), the same "delivered raster mask" provenance
   *  `overlays.ts`'s own extent-change masks document, not a fresh render.
   *  Shown only while `compareSrc` is active, and only once the reader
   *  actively toggles it on. */
  differenceSrc?: string;
  /** Every permit's own claimed area, drawn as a small dashed polygon
   *  clustered around one shared spot (`permitAreaOffset`) so they read as
   *  overlapping claims over the same ground — the same conflict the
   *  boundary-expansion narrative already describes in prose. Not a real
   *  survey boundary for any of these (see `data/permits.ts`'s own mockup
   *  disclaimer); `selected` just brightens that one entry's outline when its
   *  row is picked in the Permits list. */
  permitAreas?: { id: string; label: string; selected: boolean }[];
  /** Every habitat notification, each pinned at its own stable offset (the
   *  same `pinOffset` the focused marker already uses, keyed by event id) —
   *  a small red-bordered pin per event rather than just the one currently
   *  focused, so the map reads as "here's where the notifications are"
   *  rather than only ever showing one at a time. Not real geotags, same
   *  honesty as the single marker this extends (see `focusKey`'s own
   *  comment) — a stable-but-arbitrary area per event, not a measured one. */
  notificationEvents?: TreeEvent[];
  /** Focuses this event the same way clicking its Recent Events row does —
   *  absent means the pins are hoverable but not clickable. */
  onSelectNotification?: (event: TreeEvent) => void;
}) {
  const seed =
    frameIndex === undefined ? 0 : frameIndex === null ? null : Math.max(0, Math.min(frameIndex, frames.length - 1));
  const [shown, setShown] = useState<number | null>(seed);
  const lastSeedRef = useRef<number | null>(seed);
  useEffect(() => {
    if (frameIndex === undefined || lastSeedRef.current === seed) return;
    lastSeedRef.current = seed;
    goTo(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  // Warms every frame into the browser's own image cache up front, decoded
  // and ready, rather than each one loading for the first time exactly when
  // a click asks for it. These are multi-megabyte photos: fetching one cold
  // mid-crossfade means the incoming <img> paints a beat late, popping in
  // partway through the fade instead of dissolving smoothly — the "flicking"
  // switching between frames read as. A plain `new Image()` per src is
  // enough; nothing here holds a reference past the decode.
  useEffect(() => {
    for (const src of baseSrc ? [baseSrc, ...frames] : frames) {
      const img = new Image();
      img.src = src;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, baseSrc]);

  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [topOpacity, setTopOpacity] = useState(1);
  const rafRef = useRef<number | null>(null);

  function goTo(index: number | null) {
    if (index === shown) return;
    // Only the hi-res frame gets a zoom pulse — entering it zooms in
    // (reads as moving to a closer capture), leaving it zooms back out
    // (reads as backing out to the reference set). Switching among the
    // plain 1/2/3 reference captures — or to/from no overlay at all — stays a
    // flat crossfade, same as before.
    const zoomDirection = index === hiResFrameIndex ? 1 : shown === hiResFrameIndex ? -1 : 0;
    setOutgoing(shown);
    setShown(index);
    onFrameIndexChange?.(index);
    setTopOpacity(0);

    const baseView = view;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const step = (now: number) => {
      // Clamped low as well as high — an unclamped rAF timestamp can predate
      // `start` and produce a negative opacity; see MapCanvas's own fade,
      // which hit exactly this once.
      const t = Math.min(1, Math.max(0, (now - start) / FADE_MS));
      setTopOpacity(smootherstep(t));
      if (zoomDirection !== 0) {
        // Relative to whatever pan/zoom the reader is already at (not reset
        // to 1×), and lands back exactly there once the pulse ends, so it
        // never actually changes the resting view — a look-closer-and-back
        // (or look-away-and-back), not a navigation.
        const pulse = 1 + zoomDirection * 0.12 * Math.sin(Math.PI * t);
        setView({ ...baseView, scale: baseView.scale * pulse });
      }
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      rafRef.current = null;
      setOutgoing(null);
      if (zoomDirection !== 0) setView(baseView);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /** Pan/zoom over the imagery — the same interaction a map gives for free.
   *  See `AreaImageStage`'s identical block for the fuller comment on why the
   *  clamp is derived from the zoom level rather than a fixed bound. */
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  function clampView(scale: number, tx: number, ty: number) {
    const el = stageRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    const maxX = (w * (scale - 1)) / 2;
    const maxY = (h * (scale - 1)) / 2;
    return {
      scale,
      tx: Math.min(maxX, Math.max(-maxX, tx)),
      ty: Math.min(maxY, Math.max(-maxY, ty)),
    };
  }

  // True only for the brief eased jump `focusSignal` triggers — direct
  // manipulation (wheel/drag) needs the transform to track the pointer
  // instantly, so those interactions turn this back off rather than sharing
  // the same eased transition.
  const [easing, setEasing] = useState(false);

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setEasing(false);
    setView((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale - e.deltaY * 0.0035 * prev.scale));
      return clampView(next, prev.tx, prev.ty);
    });
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (view.scale <= MIN_SCALE) return;
    setEasing(false);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setView((prev) => clampView(prev.scale, drag.tx + (e.clientX - drag.x), drag.ty + (e.clientY - drag.y)));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function resetView() {
    setView({ scale: 1, tx: 0, ty: 0 });
  }

  // Whether the pointer is over the focused marker — gates the species-stats
  // hover card below it.
  const [markerHovered, setMarkerHovered] = useState(false);

  // Which of the small per-notification pins the pointer is over — gates
  // that one pin's own hover card, same idea as `markerHovered` above but
  // per-pin since there can be many at once.
  const [hoveredNotificationId, setHoveredNotificationId] = useState<string | null>(null);

  // How opaque the compare overlay sits over the base frame — a reader-moved
  // blend, not an animated one, so ghosting between the two reads as "look
  // for what moved," not a transition to sit through.
  const [compareBlend, setCompareBlend] = useState(0.5);

  // Off by default even while comparing — the difference mask is a strong
  // red wash, and showing it unasked would read as this stage's own opinion
  // rather than something the reader chose to look at.
  const [showDifference, setShowDifference] = useState(false);

  // How the two captures are compared: ghosted over each other ("blend", the
  // original) or split by a draggable divider ("split") — left of the line is
  // the frame shown, right of it the compared capture.
  //
  // Deliberately a curtain wipe over ONE stage rather than two half-width
  // panes each holding a whole image. Both captures stay under this stage's
  // single pan/zoom transform, so a point on the divider is the same ground
  // on both sides of it and dragging the line across a feature shows that
  // feature change; two panes would each carry their own transform, and any
  // drift between them would quietly produce a false comparison — while also
  // halving the on-screen size of both images at once, which is the opposite
  // of what looking for fine extent change needs.
  const [compareMode, setCompareMode] = useState<"blend" | "split">("blend");

  // Where the divider sits, as a fraction of the STAGE's own width (screen
  // space, not image space — see `splitClip` below for why those differ).
  const [split, setSplit] = useState(0.5);

  // The divider is drawn in the stage's own untransformed space, but the clip
  // that reveals each capture is applied to an <img> INSIDE the pan/zoom
  // container — so `split` (a fraction of the stage) has to be converted into
  // a fraction of that image's own box, or the line and the seam separate the
  // moment a reader zooms or pans.
  //
  // For `translate(tx,ty) scale(s)` about the centre, local fraction `u` of an
  // image `w` wide lands on screen at `tx + w*(0.5 + s*(u - 0.5))`. Setting
  // that equal to `split*w` and solving:
  //
  //     u = 0.5 + (split - 0.5 - tx/w) / s
  //
  // Clamped to [0,1]: once zoomed in far enough, the divider can sit off the
  // image's visible span entirely, and clamping correctly resolves that to
  // "all of the overlay" or "none of it" rather than an inverted clip.
  const splitClip = useMemo(() => {
    const w = stageRef.current?.clientWidth ?? 0;
    if (w === 0) return split;
    const u = 0.5 + (split - 0.5 - view.tx / w) / view.scale;
    return Math.min(1, Math.max(0, u));
  }, [split, view.tx, view.scale]);

  // `inset(top right bottom left)` — hides the overlay's left `splitClip`
  // share, revealing the frame beneath it there. NOT a width change: resizing
  // the element would rescale the photo inside it and break the registration
  // the whole comparison depends on.
  const overlayClip = compareMode === "split" ? `inset(0 0 0 ${splitClip * 100}%)` : undefined;

  const draggingSplitRef = useRef(false);

  function splitFromClientX(clientX: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return split;
    // Held just inside the edges so the handle can always be grabbed back.
    return Math.min(0.98, Math.max(0.02, (clientX - rect.left) / rect.width));
  }

  function handleSplitPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Both stopped: this handle sits inside the region that pans on drag, so
    // without it, moving the divider also drags the photo underneath.
    e.stopPropagation();
    e.preventDefault();
    draggingSplitRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSplit(splitFromClientX(e.clientX));
  }

  function handleSplitPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (!draggingSplitRef.current) return;
    setSplit(splitFromClientX(e.clientX));
  }

  function handleSplitPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    draggingSplitRef.current = false;
  }

  function handleSplitKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSplit((v) => Math.max(0.02, v - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSplit((v) => Math.min(0.98, v + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSplit(0.02);
    } else if (e.key === "End") {
      e.preventDefault();
      setSplit(0.98);
    }
  }

  // Where the currently-focused marker sits, in fractional stage coordinates
  // (0.5, 0.5 is centre) — a pure function of `focusKey` (or, lacking one, of
  // `focusSignal`'s own click-order spread), so it can never drift out of
  // sync with the pan math below: both derive the exact same offset.
  const markerPos = useMemo(() => {
    if (focusKey !== undefined) {
      const { ox, oy } = pinOffset(focusKey);
      return { fx: 0.5 + ox, fy: 0.5 + oy };
    }
    if (focusSignal !== undefined) {
      const angle = (focusSignal * 137.5 * Math.PI) / 180; // golden-angle spread, never repeats a direction
      return { fx: 0.5 + Math.cos(angle) * 0.18, fy: 0.5 + Math.sin(angle) * 0.18 };
    }
    return null;
  }, [focusKey, focusSignal]);

  // Reacts to `focusSignal` — see that prop's own comment for why the landing
  // spot is a generic offset crop, not a claimed location. Pans so the exact
  // point `markerPos` names above ends up centred on-screen: for
  // `translate(tx,ty) scale(scale)`, the point at offset `d` from centre
  // lands at `tx + scale*d`, so centring it means `tx = -scale*d`.
  const lastFocusSignalRef = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal === undefined || lastFocusSignalRef.current === focusSignal || !markerPos) return;
    lastFocusSignalRef.current = focusSignal;
    const el = stageRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    const scale = 5.5;
    const ox = markerPos.fx - 0.5;
    const oy = markerPos.fy - 0.5;
    setEasing(true);
    setView(clampView(scale, -scale * ox * w, -scale * oy * h));
  }, [focusSignal, markerPos]);

  return (
    <div
      ref={stageRef}
      className={`relative overflow-hidden rounded-[16px] bg-[#0e1a24] ${className}`}
      style={{ ...style, cursor: view.scale > MIN_SCALE ? "grab" : "default" }}
      role="img"
      aria-label={shown !== null ? `${label}, frame ${shown + 1} of ${frames.length}` : `${label}, base map only`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={resetView}
    >
      <div
        className={`absolute inset-0 ${easing ? "transition-transform duration-700 ease-out" : ""}`}
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: "center center",
        }}
      >
        {baseSrc && (
          // The permanent bottom layer — the real basemap this reference set
          // sits over. Only ever covered by an opaque `frames` image, never
          // itself faded or panned differently from the rest of the stack.
          <img src={baseSrc} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        {outgoing !== null && (
          <img
            src={frames[outgoing]}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            // Fading out to reveal the basemap (nothing incoming) is a plain
            // dissolve; fading between two real frames uses the compensated
            // opacity so the pair's combined coverage never dips mid-fade.
            style={{ opacity: shown === null ? 1 - topOpacity : underlayOpacity(1, topOpacity) }}
          />
        )}
        {shown !== null && (
          <img
            src={frames[shown]}
            alt={label}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: topOpacity }}
          />
        )}

        {compareSrc && (
          // The compare overlay — same pan/zoom transform as the base frame
          // (it's a sibling inside it, not a second stage), so panning or
          // zooming moves both together rather than the overlay drifting
          // out of registration.
          <img
            src={compareSrc}
            alt={compareLabel ?? ""}
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              // Split mode wants this capture shown outright on its own side
              // of the line, not ghosted — a half-transparent "after" beside
              // a crisp "before" would make the wipe useless.
              opacity: compareMode === "split" ? 1 : compareBlend,
              clipPath: overlayClip,
            }}
          />
        )}

        {compareSrc && differenceSrc && (
          // The mask's own alpha already encodes where things changed — this
          // just fades the whole image in and out, it doesn't recolour or
          // threshold anything. Clipped with the overlay in split mode (the
          // same way a swiped layer carries its own overlays with it), so the
          // "before" side stays a clean read rather than sitting under a red
          // wash the divider was supposed to have hidden.
          <img
            src={differenceSrc}
            alt="Difference mask between the two compared captures"
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200 pointer-events-none"
            style={{ opacity: showDifference ? 1 : 0, clipPath: overlayClip }}
          />
        )}

        {permitAreas?.map((permit) => {
          const { ox, oy } = permitAreaOffset(permit.id);
          return (
            <div
              key={permit.id}
              className="absolute"
              style={{
                left: `${(0.5 + ox) * 100}%`,
                top: `${(0.5 + oy) * 100}%`,
                transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
              }}
            >
              <svg
                className="pointer-events-none"
                style={{ width: 150, height: 150, transform: "translate(-50%, -50%)", position: "absolute" }}
                viewBox="0 0 72 72"
                aria-hidden="true"
              >
                <polygon
                  points={delineationPolygon(`permit:${permit.id}`)}
                  fill={permit.selected ? "#2f6fed22" : "#2f6fed14"}
                  stroke="#2f6fed"
                  strokeOpacity={permit.selected ? 0.95 : 0.45}
                  strokeWidth={permit.selected ? 2.4 : 1.4}
                  strokeDasharray="5 4"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="absolute whitespace-nowrap px-[6px] h-[16px] rounded-full text-[9.5px] font-semibold font-['Outfit',sans-serif] pointer-events-none"
                style={{
                  left: "50%",
                  top: 68,
                  transform: "translate(-50%, 0)",
                  background: permit.selected ? "#2f6fed" : "#ffffffcc",
                  color: permit.selected ? "#ffffff" : "#2f6fed",
                  display: "flex",
                  alignItems: "center",
                }}
                title={permit.label}
              >
                {permit.id}
              </span>
            </div>
          );
        })}

        {notificationEvents?.map((ev) => {
          // The currently-focused event already gets its own larger marker
          // and delineation below — skip it here rather than drawing two
          // pins on top of each other for the same event.
          if (ev.id === focusKey) return null;
          const { ox, oy } = pinOffset(ev.id);
          const fx = 0.5 + ox;
          const fy = 0.5 + oy;
          const hovered = hoveredNotificationId === ev.id;
          return (
            <div
              key={ev.id}
              className="absolute"
              style={{
                left: `${fx * 100}%`,
                top: `${fy * 100}%`,
                transform: `translate(-50%, -100%) scale(${1 / view.scale})`,
                transformOrigin: "bottom center",
                zIndex: hovered ? 5 : 1,
              }}
            >
              <span
                className={`relative flex flex-col items-center ${onSelectNotification ? "cursor-pointer" : "cursor-default"}`}
                onMouseEnter={() => setHoveredNotificationId(ev.id)}
                onMouseLeave={() => setHoveredNotificationId((id) => (id === ev.id ? null : id))}
                onClick={() => onSelectNotification?.(ev)}
                title={ev.title}
              >
                {/* Small on purpose, and red-bordered rather than solid —
                    one of many on screen at once, so it has to read as "a
                    notification lives here" at a glance rather than compete
                    with the single larger marker for the event someone's
                    actually looking at. */}
                <svg width="18" height="24" viewBox="0 0 18 24" className="relative drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                  <path
                    d="M9 0C4.03 0 0 4.03 0 9c0 6.6 9 15 9 15s9-8.4 9-15C18 4.03 13.97 0 9 0Z"
                    fill={hovered ? "#e5342b" : "#ffffff"}
                    stroke="#e5342b"
                    strokeWidth="2"
                  />
                  <circle cx="9" cy="9" r="3" fill={hovered ? "#ffffff" : "#e5342b"} />
                </svg>

                {hovered && (
                  <div className="absolute bottom-full mb-[8px] w-[210px] rounded-[10px] bg-white border border-[#dedee3] shadow-[0px_16px_36px_-10px_rgba(0,0,0,0.28)] p-[10px] text-left animate-fade-in-up pointer-events-none">
                    <span className="block text-[11.5px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[15px]">
                      {ev.title}
                    </span>
                    <p className="mt-[3px] text-[10.5px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[14px] line-clamp-3">
                      {ev.description}
                    </p>
                  </div>
                )}
              </span>
            </div>
          );
        })}

        {markerPos && (
          // Marks the area the zoom above just reacted to — not a measured
          // location (see `focusKey`'s own comment), so it's styled and
          // labelled as a highlight, not a geotagged pin. Counter-scaled so
          // it reads as a constant-size marker rather than growing with the
          // photo underneath it. The dashed ring is the same "approximate
          // area" honesty as a visible delineation rather than a bare pin —
          // still not a measured boundary, just a readable one.
          <div
            className="absolute"
            style={{
              left: `${markerPos.fx * 100}%`,
              top: `${markerPos.fy * 100}%`,
              transform: `translate(-50%, -100%) scale(${1 / view.scale})`,
              transformOrigin: "bottom center",
            }}
          >
            <svg
              // 4x the old 72×72 footprint — same viewBox and polygon math
              // (`delineationPolygon`'s own vertices are centred at 36,36 in
              // its 0–72 coordinate space), so this just scales the shape up
              // rather than recomputing it at a different size.
              className="absolute pointer-events-none"
              style={{ left: "50%", bottom: 0, width: 288, height: 288, transform: "translate(-50%, 50%)" }}
              viewBox="0 0 72 72"
              aria-hidden="true"
            >
              <polygon
                points={focusKey ? delineationPolygon(focusKey) : ""}
                fill="none"
                stroke="#e5342b"
                strokeOpacity={0.7}
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="relative flex flex-col items-center cursor-default"
              onMouseEnter={() => setMarkerHovered(true)}
              onMouseLeave={() => setMarkerHovered(false)}
              title="Highlighted area — approximate, not a measured location"
            >
              <span className="absolute -inset-4 rounded-full bg-black/25 animate-ping pointer-events-none" />
              <svg width="52" height="68" viewBox="0 0 26 34" className="relative drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
                <path
                  d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 21 13 21s13-11.5 13-21C26 5.8 20.2 0 13 0Z"
                  fill="#000000"
                />
                <circle cx="13" cy="13" r="5" fill="#ffffff" />
              </svg>

              {markerHovered && focusEvent && (
                // Nothing computed fresh here — the same title/description
                // (species, count, scientific name) and tree id/health the
                // Recent Events row and Detail panel already show for this
                // exact event.
                <div className="absolute bottom-full mb-[10px] w-[230px] rounded-[12px] bg-white border border-[#dedee3] shadow-[0px_16px_36px_-10px_rgba(0,0,0,0.28)] p-[12px] text-left animate-fade-in-up pointer-events-none">
                  <span className="block text-[12.5px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[16px]">
                    {focusEvent.title}
                  </span>
                  <p className="mt-[4px] text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[15px]">
                    {focusEvent.description}
                  </p>
                  <div className="mt-[8px] pt-[8px] border-t border-[#eeeef1] flex items-center justify-between text-[10.5px] font-['Outfit',sans-serif]">
                    <span className="text-[#8a8a94]">{focusEvent.tree.id}</span>
                    <span className="font-semibold text-[#464650]">{focusEvent.tree.health}</span>
                  </div>
                </div>
              )}
            </span>
          </div>
        )}
      </div>

      {compareSrc && compareMode === "split" && (
        // Outside the transform container on purpose: the divider is a
        // screen-space tool, so it must stay put while the photo pans and
        // zooms under it (the clip inside the container is what follows the
        // image — see `splitClip`). A brief exception: during the eased
        // focus-zoom the transform glides over 700ms while the clip jumps to
        // its final position, so the seam sits off the line until it lands.
        <>
          {/* Which capture is on which side, so the wipe can't be misread.
              Both sit below the frame-dot row (`top-[12px]`, ~26px tall) at
              the same height as each other — the right one would collide
              with those dots at the top, and dropping only that one would
              read as a mistake rather than a pair. */}
          <span className="absolute top-[46px] left-[12px] px-[8px] py-[4px] rounded-[8px] bg-[rgba(10,10,10,0.62)] backdrop-blur-[2px] text-[10.5px] font-semibold text-white font-['Outfit',sans-serif] whitespace-nowrap pointer-events-none">
            {label}
          </span>
          <span className="absolute top-[46px] right-[12px] px-[8px] py-[4px] rounded-[8px] bg-[rgba(10,10,10,0.62)] backdrop-blur-[2px] text-[10.5px] font-semibold text-white font-['Outfit',sans-serif] whitespace-nowrap pointer-events-none">
            {compareLabel}
          </span>

          {/* The seam itself — a hairline the eye can follow, plus a wide
              invisible grab strip around it, since a 2px target is not a
              draggable control on any real pointer. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Split between ${label} and ${compareLabel ?? "the compared capture"}`}
            aria-valuenow={Math.round(split * 100)}
            aria-valuemin={2}
            aria-valuemax={98}
            tabIndex={0}
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={handleSplitPointerUp}
            onPointerCancel={handleSplitPointerUp}
            onKeyDown={handleSplitKeyDown}
            className="absolute top-0 bottom-0 w-[28px] -translate-x-1/2 flex items-center justify-center cursor-ew-resize touch-none focus:outline-none"
            style={{ left: `${split * 100}%` }}
          >
            <span className="absolute top-0 bottom-0 w-[2px] bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.55)]" />
            <span className="relative w-[26px] h-[26px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6.2 4.5 3.4 8l2.8 3.5M9.8 4.5 12.6 8l-2.8 3.5"
                  stroke="#18181c"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </>
      )}

      {!compareSrc && (
        <div className="absolute left-[12px] bottom-[12px] flex items-center gap-[8px] px-[10px] py-[6px] rounded-[9px] bg-[rgba(10,10,10,0.62)] backdrop-blur-[2px] pointer-events-none">
          <span className="text-[11px] font-semibold text-white font-['Outfit',sans-serif] whitespace-nowrap">
            {label}
          </span>
          <span className="w-px h-[12px] bg-white/30" />
          <span className="text-[11px] text-white/80 font-['Outfit',sans-serif] whitespace-nowrap">
            {shown !== null ? `Frame ${shown + 1} of ${frames.length}` : "Base map"}
          </span>
        </div>
      )}

      {compareSrc && (
        // Draggable, not display-only: the reader decides how much of each
        // capture shows rather than watching a fixed 50/50 blend.
        <div
          // Wraps onto a second line rather than overflowing sideways once
          // the difference toggle joins the label/slider/label trio — a
          // rounded pill can't wrap without looking broken, so this is a
          // softer rounded rect instead, capped to the stage's own width.
          className="absolute left-1/2 bottom-[12px] -translate-x-1/2 max-w-[92%] flex flex-wrap items-center justify-center gap-x-[8px] gap-y-[6px] px-[12px] py-[7px] rounded-[14px] bg-[rgba(10,10,10,0.62)] backdrop-blur-[2px]"
          // Dragging the slider knob is a pointer drag over the same stage
          // that pans on drag — without stopping it here, adjusting the
          // blend also panned the photo underneath it.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
        >
          {/* Blend or split. Two genuinely different reads of the same pair,
              not a preference: the blend ghosts both at once (good for "did
              anything move at all"), the split shows each crisp on its own
              side of a line the reader drags across a feature (good for
              "what exactly changed here"). */}
          <div className="flex items-center gap-[2px] p-[2px] rounded-full bg-white/15">
            {(["blend", "split"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCompareMode(m)}
                aria-pressed={compareMode === m}
                className="u-press px-[9px] h-[20px] rounded-full text-[10.5px] font-semibold font-['Outfit',sans-serif] capitalize cursor-pointer transition-colors duration-150"
                style={{
                  background: compareMode === m ? "#FFFFFF" : "transparent",
                  color: compareMode === m ? "#18181c" : "rgba(255,255,255,0.85)",
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="w-px h-[12px] bg-white/30" />
          <span className="text-[11px] font-semibold text-white font-['Outfit',sans-serif] whitespace-nowrap">
            {label}
          </span>
          {compareMode === "blend" ? (
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={compareBlend}
              onChange={(e) => setCompareBlend(Number(e.target.value))}
              aria-label={`Blend toward ${compareLabel ?? "the compared capture"}`}
              className="w-[100px] accent-[#e0654a]"
            />
          ) : (
            // No second control in split mode: the divider on the image IS
            // the control, and a slider mirroring it would be a second thing
            // to keep in sync for nothing.
            <span className="text-[10.5px] text-white/70 font-['Outfit',sans-serif] whitespace-nowrap">
              drag the line ⇢
            </span>
          )}
          <span className="text-[11px] font-semibold text-white font-['Outfit',sans-serif] whitespace-nowrap">
            {compareLabel}
          </span>
          {differenceSrc && (
            <>
              <span className="w-px h-[12px] bg-white/30" />
              <button
                type="button"
                onClick={() => setShowDifference((v) => !v)}
                aria-pressed={showDifference}
                className="u-press px-[10px] h-[22px] rounded-full text-[10.5px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-150"
                style={{
                  background: showDifference ? "#e5342b" : "rgba(255,255,255,0.15)",
                  color: "#FFFFFF",
                }}
              >
                {showDifference ? "Hide difference" : "Show difference"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Tiny timeline — dots, not a full scrubber, matching the size of what
          this photo is: a reference image, not a dated capture series with
          its own months to label. */}
      <div
        className="absolute right-[12px] top-[12px] flex items-center gap-[6px] px-[9px] py-[7px] rounded-full bg-[rgba(10,10,10,0.55)] backdrop-blur-[2px]"
        // Same reasoning as the compare slider below: without this, a click
        // here still bubbles into the stage's own pan handling, and a click
        // that lands with even a pixel of travel reads as a drag.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {frames.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Frame ${i + 1} of ${frames.length}`}
            aria-pressed={i === shown}
            className="u-press w-[7px] h-[7px] rounded-full cursor-pointer transition-colors duration-150"
            style={{ background: i === shown ? "#FFFFFF" : "rgba(255,255,255,0.4)" }}
          />
        ))}
      </div>
    </div>
  );
}
