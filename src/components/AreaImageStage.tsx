import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  birdPlacement,
  CRAB_PLOVER_RECTS,
  getCrabPlovers,
  WEST_REEF_ZONE,
  type CrabPlover,
} from "../data/crabPlovers";
import { smootherstep, underlayOpacity } from "../lib/crossfade";
import { frameMonthWindow } from "../data/overlays";

/**
 * The imagery, standing in for the map.
 *
 * Abu Al Abyad has its own captures and none of the map's machinery applies to
 * it: no georeferenced tree population (see `areaHasOwnImagery`), no canopy
 * mask, no generative crowns, no 3D forest. A MapLibre canvas would be an
 * empty basemap with one photograph on it and a layer panel full of controls
 * that change nothing — so this shows the captures directly and lets the
 * timeline move between them, which is the whole interaction that site has.
 *
 * The frames dissolve rather than cut, using the same compensated crossfade
 * the map's own raster swap uses — see `lib/crossfade.ts`. Two stacked images
 * compose exactly like two stacked rasters, so the same arithmetic keeps the
 * pair's combined coverage constant and stops the panel behind them showing
 * through at the halfway point.
 */

/** How long a frame takes to dissolve into the next. Matches the map's own
 *  raster crossfade, so moving the timeline feels the same on this site as on
 *  the others. */
const FRAME_FADE_MS = 620;

/** A small, stable number from a ring id, used only to offset each marker's
 *  glow animation so a hundred birds don't breathe in lockstep. Not a hash
 *  used for anything that needs to be collision-resistant — just cheap and
 *  deterministic. */
function hashDelay(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export default function AreaImageStage({
  frames,
  frameIndex,
  areaId,
  areaName,
  monthLabels,
  monthCount,
  className = "",
  style,
  onSelectBird,
  selectedBirdId,
  onCaptureIndexChange,
  onSplitGroups,
}: {
  frames: string[];
  /** Which frame the timeline is on. */
  frameIndex: number;
  areaId: string;
  areaName: string;
  /** Every month on this area's timeline, for dating the captures. */
  monthLabels: string[];
  monthCount: number;
  className?: string;
  /** Forwarded so a split pane can set this stage's width the same way it
   *  sets the map's. */
  style?: CSSProperties;
  onSelectBird?: (bird: CrabPlover) => void;
  selectedBirdId?: string | null;
  /** Reports the capture actually on screen — this stage owns its own
   *  timeline (see `picked` below), so a parent that wants to key anything off
   *  "which capture is showing" (the census table's grouping, below) can't
   *  read it off its own props and needs it reported back up. */
  onCaptureIndexChange?: (index: number) => void;
  /** Fired once the reader accepts Alma's prompt to split the census — see
   *  the prompt below. */
  onSplitGroups?: () => void;
}) {
  /**
   * Which capture is showing.
   *
   * Owned here rather than read straight off the prop, because this site has
   * no other timeline. The workspace's master scrubber renders only on
   * Insights and Areas — Maps and Assets delegate that job to each layer's own
   * coverage strip inside the layer panel, and there is no layer panel here.
   * So the stage carries its own strip (below) and this is what it moves.
   *
   * The prop still seeds it and still wins when it changes, so if the range is
   * moved from somewhere that does show a picker, the imagery follows.
   */
  const seed = Math.max(0, Math.min(frameIndex, frames.length - 1));
  const [picked, setPicked] = useState(seed);
  const lastSeedRef = useRef(seed);
  useEffect(() => {
    if (lastSeedRef.current === seed) return;
    lastSeedRef.current = seed;
    setPicked(seed);
  }, [seed]);
  const safeIndex = Math.max(0, Math.min(picked, frames.length - 1));
  useEffect(() => {
    onCaptureIndexChange?.(safeIndex);
  }, [safeIndex, onCaptureIndexChange]);

  /**
   * The frame showing, and the one dissolving out from under it.
   *
   * Held as state rather than derived, because a dissolve has a duration: the
   * outgoing frame has to stay mounted after the prop has already moved on.
   */
  const [shown, setShown] = useState(safeIndex);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [topOpacity, setTopOpacity] = useState(1);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (safeIndex === shown) return;
    const from = shown;
    setOutgoing(from);
    setShown(safeIndex);
    setTopOpacity(0);

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const step = (now: number) => {
      // Clamped low as well as high: rAF hands back the timestamp of the frame
      // it belongs to, which can predate this `start`. The map's own fade hit
      // exactly this and produced a negative opacity.
      const t = Math.min(1, Math.max(0, (now - start) / FRAME_FADE_MS));
      setTopOpacity(smootherstep(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      rafRef.current = null;
      setOutgoing(null);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [safeIndex, shown]);

  const birds = useMemo(() => getCrabPlovers(areaId, monthCount), [areaId, monthCount]);
  const [hoverRect, setHoverRect] = useState<string | null>(null);

  /** Each bird's actual spot for the capture on screen right now — home, or
   *  `WEST_REEF_ZONE` once that bird's migration capture has arrived. Recomputed
   *  per `safeIndex` so the drift plays out as the timeline moves. */
  const placements = useMemo(
    () => birds.map((bird) => ({ bird, ...birdPlacement(bird, safeIndex) })),
    [birds, safeIndex],
  );
  const westReefCount = placements.filter((p) => p.zoneId === WEST_REEF_ZONE.id).length;

  /**
   * Alma's prompt to split the census, once the West reef colony is fully
   * established (the last capture, where `WEST_REEF_ARRIVALS` peaks).
   *
   * Asked once per visit to that capture, not once per session: dismissing it
   * ("Not now") should be undoable by just scrubbing away and back, since
   * there's no other affordance for reopening it. Accepting it is one-way —
   * `onSplitGroups` has no matching "un-split" — because un-merging a census
   * a reader already asked to split reads as the app second-guessing them.
   */
  const isLastCapture = safeIndex === frames.length - 1;
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [splitAccepted, setSplitAccepted] = useState(false);
  useEffect(() => {
    if (!isLastCapture) setPromptDismissed(false);
  }, [isLastCapture]);
  const showSplitPrompt = isLastCapture && westReefCount > 0 && !promptDismissed && !splitAccepted;

  /**
   * Pan/zoom over the imagery, the same interaction a map gives for free.
   *
   * Applied to a wrapper around the two photographs only — the survey
   * rectangles, bird markers and the fixed UI chrome stay in the DOM's normal
   * flow and are not part of this transform, so a zoomed-in view still reads
   * "20 birds in a rectangle" correctly rather than distorting the overlay.
   */
  const MIN_SCALE = 1;
  const MAX_SCALE = 6;
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  function clampView(scale: number, tx: number, ty: number) {
    const el = stageRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    // How far the scaled image can be dragged before its edge would show the
    // panel behind it — half the extra size the zoom added.
    const maxX = (w * (scale - 1)) / 2;
    const maxY = (h * (scale - 1)) / 2;
    return {
      scale,
      tx: Math.min(maxX, Math.max(-maxX, tx)),
      ty: Math.min(maxY, Math.max(-maxY, ty)),
    };
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setView((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale - e.deltaY * 0.0035 * prev.scale));
      return clampView(next, prev.tx, prev.ty);
    });
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (view.scale <= MIN_SCALE) return;
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

  /**
   * What stretch of the timeline a capture stands for.
   *
   * `frameMonthWindow` is the inverse of the bucket maths the other sites'
   * imagery uses, so a capture is dated here exactly as it is dated in the
   * capture stack — a span of months it represents, never a survey date it
   * does not have.
   */
  function frameWindowLabel(index: number): string {
    const w = frameMonthWindow(index, frames.length, monthCount);
    const from = monthLabels[w.startIndex] ?? "";
    const to = monthLabels[w.endIndex] ?? "";
    return from === to ? from : `${from} – ${to}`;
  }

  return (
    <div
      ref={stageRef}
      className={`relative overflow-hidden rounded-[16px] bg-[#0e1a24] ${className}`}
      style={{ ...style, cursor: view.scale > MIN_SCALE ? "grab" : "default" }}
      role="img"
      aria-label={`Satellite capture of ${areaName}, frame ${safeIndex + 1} of ${frames.length}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={resetView}
    >
      {/* Alma's prompt to split the census, once the west reef colony has
          enough birds on it to be worth tracking on its own. Sits above the
          pan/zoom layer (outside it in the DOM) so zooming the imagery
          doesn't drag the card around with it. */}
      {showSplitPrompt && (
        <div className="absolute left-1/2 top-[14px] -translate-x-1/2 z-10 w-[300px] max-w-[calc(100%-24px)] animate-fade-in-down">
          <div className="rounded-[14px] border border-white/10 bg-[rgba(14,20,26,0.92)] backdrop-blur-[6px] shadow-[0px_16px_36px_-10px_rgba(0,0,0,0.55)] px-[14px] pt-[12px] pb-[10px]">
            <span className="inline-flex items-center gap-[6px] px-[8px] h-[19px] rounded-full bg-white/10 text-[9.5px] font-bold text-[#8fe6c9] font-['Outfit',sans-serif] tracking-wide uppercase">
              <span className="relative flex w-[5px] h-[5px] shrink-0">
                <span className="absolute inset-0 rounded-full bg-[#8fe6c9] opacity-70 animate-ping" />
                <span className="relative w-[5px] h-[5px] rounded-full bg-[#8fe6c9]" />
              </span>
              Alma
            </span>
            <p className="mt-[8px] text-[12.5px] text-white font-['Outfit',sans-serif] leading-[17px]">
              {westReefCount} Crab-plover have settled on the West reef this quarter — enough to call it a second
              colony. Split the census into North cay and West reef?
            </p>
            <div className="mt-[10px] flex items-center gap-[8px]">
              <button
                type="button"
                onClick={() => {
                  setSplitAccepted(true);
                  onSplitGroups?.();
                }}
                className="u-press h-[28px] px-[12px] rounded-full bg-white text-[11.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] cursor-pointer hover:bg-[#f0f0f0]"
              >
                Split them
              </button>
              <button
                type="button"
                onClick={() => setPromptDismissed(true)}
                className="u-press h-[28px] px-[12px] rounded-full bg-transparent text-[11.5px] font-medium text-white/70 font-['Outfit',sans-serif] cursor-pointer hover:text-white"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Everything that is "the ground" — the photographs, the survey
          rectangles, the birds and their labels — pans and zooms together as
          one layer. The caption and timeline strip below are deliberately
          outside this div, the same way a map's UI chrome stays put while the
          basemap moves under it. */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: "center center",
        }}
      >
        {/* The outgoing frame, dimmed on the curve that holds the pair's total
            coverage at 1 — so the dark ground behind never shows through. */}
        {outgoing !== null && (
          <img
            src={frames[outgoing]}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: underlayOpacity(1, topOpacity) }}
          />
        )}
        <img
          src={frames[shown]}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: topOpacity }}
        />

        {/* The survey rectangle, in the capture's own u/v space — the same
            coordinates the birds carry, which is what lets it and the rows
            listed under it be the same fact. */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        {CRAB_PLOVER_RECTS.map((rect) => {
          const active = hoverRect === rect.id;
          return (
            <g key={rect.id}>
              <rect
                x={rect.uMin * 100}
                y={rect.vMin * 100}
                width={(rect.uMax - rect.uMin) * 100}
                height={(rect.vMax - rect.vMin) * 100}
                fill={active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
                stroke="#FFFFFF"
                strokeWidth={active ? 0.35 : 0.2}
                // preserveAspectRatio="none" stretches the viewBox to the box,
                // so a dash pattern in user units would come out stretched too.
                // Left solid rather than shipping a visibly wrong dash.
                vectorEffect="non-scaling-stroke"
                onPointerEnter={() => setHoverRect(rect.id)}
                onPointerLeave={() => setHoverRect((p) => (p === rect.id ? null : p))}
                style={{ cursor: "pointer" }}
              />
            </g>
          );
        })}
        {/* The west reef, drawn only once a bird has actually drifted there —
            an empty box would read as a survey block nobody visited, and this
            isn't one: see `WEST_REEF_ZONE`'s own comment. */}
        {westReefCount > 0 && (
          <rect
            x={WEST_REEF_ZONE.uMin * 100}
            y={WEST_REEF_ZONE.vMin * 100}
            width={(WEST_REEF_ZONE.uMax - WEST_REEF_ZONE.uMin) * 100}
            height={(WEST_REEF_ZONE.vMax - WEST_REEF_ZONE.vMin) * 100}
            fill={hoverRect === WEST_REEF_ZONE.id ? "rgba(229,72,77,0.16)" : "rgba(229,72,77,0.06)"}
            stroke="#E5484D"
            strokeWidth={hoverRect === WEST_REEF_ZONE.id ? 0.35 : 0.2}
            vectorEffect="non-scaling-stroke"
            onPointerEnter={() => setHoverRect(WEST_REEF_ZONE.id)}
            onPointerLeave={() => setHoverRect((p) => (p === WEST_REEF_ZONE.id ? null : p))}
            style={{ cursor: "pointer" }}
          />
        )}
      </svg>

      {/* Birds as flat DOM markers over the image rather than inside the SVG:
          the SVG's viewBox is stretched, which would squash a circle into an
          ellipse wherever the container is not square. Positioned from
          `placements`, not the bird's own home `u`/`v`, so a migrated bird
          actually draws at the reef rather than at North cay. */}
      {placements.map(({ bird, u, v, zoneId, zoneLabel }) => {
        const on = hoverRect === zoneId;
        const selected = selectedBirdId === bird.id;
        return (
          <button
            key={bird.id}
            type="button"
            onClick={() => onSelectBird?.(bird)}
            title={`${bird.id} · ${zoneLabel} · ${bird.activity}`}
            className="absolute cursor-pointer transition-[width,height,left,top] duration-500"
            style={{
              left: `${u * 100}%`,
              top: `${v * 100}%`,
              width: selected ? 12 : on ? 9 : 6,
              height: selected ? 12 : on ? 9 : 6,
              // Centering lives here, on the button, as a plain static
              // transform. The glow's breathing animation is on the inner
              // span below rather than here — an animated `transform` wins
              // over a static one on the same element for as long as the
              // animation runs, which would fight this centering forever.
              transform: "translate(-50%, -50%)",
            }}
            aria-label={`Crab-plover ${bird.id}, ${zoneLabel}`}
          >
            <span
              className={`plover-marker block w-full h-full rounded-full ${selected ? "is-selected" : ""} ${
                on ? "is-hovered" : ""
              }`}
              style={
                {
                  // Spreads the breathing glow's phase across the flock: a
                  // hash of the ring id rather than array index, so it stays
                  // put across a re-sort instead of every marker starting in
                  // lockstep.
                  "--sway-delay": `${(hashDelay(bird.id) % 32) / 10}s`,
                } as CSSProperties
              }
            />
          </button>
        );
      })}

      {/* Rectangle labels, above the markers. Placed at the top-left corner of
          each box in percentages, for the same reason the birds are: no
          stretched text. */}
      {CRAB_PLOVER_RECTS.map((rect) => {
        const count = placements.filter((p) => p.zoneId === rect.id).length;
        return (
          <span
            key={rect.id}
            className="absolute pointer-events-none px-[6px] py-[2px] rounded-[6px] text-[10px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap"
            style={{
              left: `${rect.uMin * 100}%`,
              top: `${rect.vMin * 100}%`,
              transform: "translate(0, -120%)",
              background: hoverRect === rect.id ? "#FFFFFF" : "rgba(10,10,10,0.62)",
              color: hoverRect === rect.id ? "#18181c" : "#FFFFFF",
            }}
          >
            {rect.label} · {count}
          </span>
        );
        })}
        {westReefCount > 0 && (
          <span
            className="absolute pointer-events-none px-[6px] py-[2px] rounded-[6px] text-[10px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap"
            style={{
              left: `${WEST_REEF_ZONE.uMin * 100}%`,
              top: `${WEST_REEF_ZONE.vMin * 100}%`,
              transform: "translate(0, -120%)",
              background: hoverRect === WEST_REEF_ZONE.id ? "#E5484D" : "rgba(229,72,77,0.82)",
              color: "#FFFFFF",
            }}
          >
            {WEST_REEF_ZONE.label} · {westReefCount}
          </span>
        )}
      </div>

      {/* What this is and which frame is showing. The captures carry no survey
          date — the month is the stretch of the timeline the frame stands for,
          the same claim the other sites' imagery makes. */}
      <div className="absolute left-[12px] bottom-[12px] flex items-center gap-[8px] px-[10px] py-[6px] rounded-[9px] bg-[rgba(10,10,10,0.62)] backdrop-blur-[2px]">
        <span className="text-[11px] font-semibold text-white font-['Outfit',sans-serif] whitespace-nowrap">
          Capture {safeIndex + 1} of {frames.length}
        </span>
        <span className="w-px h-[12px] bg-white/30" />
        <span className="text-[11px] text-white/80 font-['Outfit',sans-serif] whitespace-nowrap">
          {frameWindowLabel(safeIndex)}
        </span>
        <span className="w-px h-[12px] bg-white/30" />
        <span className="text-[11px] text-white/80 font-['Outfit',sans-serif] whitespace-nowrap">
          {birds.length} Crab-plover across {CRAB_PLOVER_RECTS.length + (westReefCount > 0 ? 1 : 0)} survey{" "}
          {CRAB_PLOVER_RECTS.length + (westReefCount > 0 ? 1 : 0) === 1 ? "block" : "blocks"}
        </span>
      </div>

      {/* The capture timeline. One tick per delivered frame, each labelled
          with the months it stands for — so moving between captures is moving
          through time, which is the only interaction this site has. The plane
          button steps to the next capture in order without having to read
          every tick's label first — the same "fly to the next pass" gesture
          the tick strip already supports, just one press away. */}
      <div className="absolute right-[12px] top-[12px] flex items-center gap-[3px] p-[3px] rounded-[10px] bg-[rgba(10,10,10,0.55)] backdrop-blur-[2px]">
        <button
          type="button"
          onClick={() => setPicked((i) => (i + 1) % frames.length)}
          aria-label="Advance to the next capture"
          title="Next capture"
          className="u-press shrink-0 flex items-center justify-center w-[24px] h-[24px] rounded-[7px] cursor-pointer transition-colors duration-150 hover:bg-white/15"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"
              fill="rgba(255,255,255,0.9)"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="w-px h-[16px] bg-white/25 shrink-0" />
        {frames.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setPicked(i)}
            aria-pressed={i === safeIndex}
            aria-label={`Capture ${i + 1} of ${frames.length}, ${frameWindowLabel(i)}`}
            title={frameWindowLabel(i)}
            className="u-press px-[9px] h-[24px] rounded-[7px] text-[10.5px] font-semibold font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150 whitespace-nowrap"
            style={
              i === safeIndex
                ? { background: "#FFFFFF", color: "#18181c" }
                : { background: "transparent", color: "rgba(255,255,255,0.72)" }
            }
          >
            {frameWindowLabel(i)}
          </button>
        ))}
      </div>
    </div>
  );
}
