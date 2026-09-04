import { useCallback, useEffect, useRef, useState } from "react";
import type { DateRange } from "../data/aggregate";
import { buildUpcomingMonthLabels } from "../data/monthlySnapshots";
import type { HealthKey } from "../data/types";
import { CONDITIONS } from "../data/taxonomy";
import DenseCoverageModal from "./DenseCoverageModal";

// Two more calendar months, shown past the real data as a locked preview of
// what's coming rather than letting the axis just stop at "now" — computed
// once at module load (same pattern as monthLabels itself), not per render.
const UPCOMING_MONTHS = buildUpcomingMonthLabels(2);

// The flagged bands, worst first — same colour coding as the condition donut
// and the map pins, read off the taxonomy so all three stay in step.
const AT_RISK_HEALTH: { key: HealthKey; label: string; color: string }[] = CONDITIONS.filter(
  (c) => c.flagged,
).map((c) => ({ key: c.key, label: c.label, color: c.color }));

interface TimelineRangeSliderProps {
  months: string[];
  range: DateRange;
  onChange: (range: DateRange) => void;
  /**
   * The area's timelapse frames, in bucket order — used only for the hover
   * preview thumbnail. Omit and the preview falls back to a date-only pill.
   */
  previewImages?: string[];
  /** Promotional total for the "N of M captures" line — see PROMO_PLANNED_CAPTURES. */
  plannedCaptures?: number;
  /** Total surveyed tree count for each month, same order/length as `months`
   * — drawn as a small trend graph sitting over the track so the range
   * slider also reads as "here's how the population grew," not just a date
   * picker. Omit to hide the graph entirely. */
  treeCountSeries?: number[];
  /** Per-month health-condition counts, same order/length as `months` — drawn
   * in the hover preview so it also answers "how many were struggling that
   * month," not just "what did the plot look like." Omit to hide that row. */
  healthCountsSeries?: Record<HealthKey, number>[];
  /** Fires whenever playback starts/stops — lets other views (the canopy
   * gradient pulse on the map, say) react to "the timeline is animating"
   * without owning the play state themselves. */
  onPlayingChange?: (playing: boolean) => void;
}

type Handle = "start" | "end" | "move";

/** Where a month sits relative to the selection — drives the dot's appearance. */
type DotState = "out" | "in" | "edge";

const PLAY_STEP_MS = 1400;

export default function TimelineRangeSlider({
  months,
  range,
  onChange,
  previewImages,
  plannedCaptures,
  onPlayingChange,
  treeCountSeries,
  healthCountsSeries,
}: TimelineRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);
  const [playing, setPlaying] = useState(false);
  // On mount, the end handle (and the selection band it carries along —
  // wash, fill, chart clip) starts pinned to the start handle's position and
  // grows out to the real range a beat later, so opening the dashboard reads
  // as the timeline sweeping itself in left-to-right rather than the full
  // range just appearing pre-selected. A double rAF, not a single one: the
  // browser needs to actually paint the collapsed state on one frame before
  // the next frame's change has something to transition from — flipping
  // this in the same frame the component first renders would just skip
  // straight to the end state with no visible motion.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRevealed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  const [hovered, setHovered] = useState<number | null>(null);

  // The preview card unmounts instantly when `hovered` clears, which reads
  // as a snap rather than a dismissal. Keeping the last index rendered for
  // one more frame with a `tl-preview--leaving` class lets it play a quick
  // shrink-and-fade before actually leaving the DOM — a dribbble-style
  // pop-in/pop-out rather than pop-in/cut.
  const [displayedHover, setDisplayedHover] = useState<number | null>(null);
  const [previewLeaving, setPreviewLeaving] = useState(false);
  const previewLeaveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (hovered !== null) {
      clearTimeout(previewLeaveTimeout.current);
      setDisplayedHover(hovered);
      setPreviewLeaving(false);
    } else if (displayedHover !== null) {
      setPreviewLeaving(true);
      previewLeaveTimeout.current = setTimeout(() => setDisplayedHover(null), 140);
    }
    return () => clearTimeout(previewLeaveTimeout.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered]);
  const [bannerOpen, setBannerOpen] = useState(false);
  const lastCount = months.length - 1;
  const rangeRef = useRef(range);
  rangeRef.current = range;
  // Captured once when a drag on the filled range bar begins — the delta is
  // measured from this fixed reference rather than accumulated frame to
  // frame, so a jittery pointer can't drift the window from rounding error.
  const moveStartRef = useRef<{ clientX: number; startIndex: number; endIndex: number } | null>(null);

  const indexFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * lastCount);
    },
    [lastCount],
  );

  /** Slides the whole selection forward one month, keeping its width. */
  const stepForward = useCallback(() => {
    const current = rangeRef.current;
    if (current.endIndex >= lastCount) return;
    const width = current.endIndex - current.startIndex;
    const nextStart = current.startIndex + 1;
    onChange({ startIndex: nextStart, endIndex: Math.min(nextStart + width, lastCount) });
  }, [lastCount, onChange]);

  /** Slides the whole selection back one month, keeping its width. */
  const stepBack = useCallback(() => {
    const current = rangeRef.current;
    if (current.startIndex <= 0) return;
    const width = current.endIndex - current.startIndex;
    const nextStart = current.startIndex - 1;
    onChange({ startIndex: nextStart, endIndex: nextStart + width });
  }, [onChange]);

  // Advances a fixed-width window across the whole timeline, one month per
  // tick, until it reaches the end — the standard "temporal controller"
  // playback pattern (ArcGIS/QGIS), not a range that grows from a fixed start.
  // Reads/writes through rangeRef rather than closing over `range` so the
  // interval doesn't need to be torn down and recreated on every tick's own
  // onChange-triggered re-render.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (rangeRef.current.endIndex >= lastCount) {
        setPlaying(false);
        return;
      }
      stepForward();
    }, PLAY_STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, lastCount, stepForward]);

  useEffect(() => {
    onPlayingChange?.(playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Reports "stopped" once, only on actual unmount — not on every `playing`
  // toggle above, which would otherwise fire a spurious false-then-true on
  // every play press and flash the consumer back to its idle state.
  useEffect(() => {
    return () => onPlayingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dragging) return;
    setPlaying(false);

    function handleMove(e: PointerEvent) {
      if (dragging === "move") {
        const track = trackRef.current;
        const start = moveStartRef.current;
        if (!track || !start) return;
        const rect = track.getBoundingClientRect();
        // Rounded once at the end rather than per-pixel, so the window snaps
        // to whole months exactly like the start/end handles do, instead of
        // sub-month positions the rest of the UI (dots, ticks) can't express.
        const deltaIndex = Math.round(((e.clientX - start.clientX) / rect.width) * lastCount);
        const width = start.endIndex - start.startIndex;
        const nextStart = Math.max(0, Math.min(lastCount - width, start.startIndex + deltaIndex));
        onChange({ startIndex: nextStart, endIndex: nextStart + width });
        return;
      }
      const index = indexFromClientX(e.clientX);
      if (dragging === "start") {
        onChange({ startIndex: Math.min(index, range.endIndex), endIndex: range.endIndex });
      } else {
        onChange({ startIndex: range.startIndex, endIndex: Math.max(index, range.startIndex) });
      }
    }
    function handleUp() {
      setDragging(null);
      moveStartRef.current = null;
    }

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, indexFromClientX, onChange, range.startIndex, range.endIndex, lastCount]);

  // Clicking a month moves whichever handle is already nearer to it, so a single
  // click does the obvious thing from either end without the user having to
  // decide which handle they're aiming at. Ties go to the start handle.
  const jumpTo = useCallback(
    (index: number) => {
      setPlaying(false);
      const toStart = Math.abs(index - range.startIndex);
      const toEnd = Math.abs(index - range.endIndex);
      if (toStart <= toEnd) {
        onChange({ startIndex: Math.min(index, range.endIndex), endIndex: range.endIndex });
      } else {
        onChange({ startIndex: range.startIndex, endIndex: Math.max(index, range.startIndex) });
      }
    },
    [onChange, range.startIndex, range.endIndex],
  );

  const startPct = (range.startIndex / lastCount) * 100;
  const endPct = (range.endIndex / lastCount) * 100;
  // Collapsed onto the start handle until the initial reveal has fired (see
  // the `revealed` effect above) — every element that positions itself off
  // `endPct` reads this instead, so the band grows out as one motion rather
  // than the end handle alone detaching from the wash/fill/chart around it.
  const displayEndPct = revealed ? endPct : startPct;
  const atEnd = range.endIndex >= lastCount;
  const atStart = range.startIndex <= 0;

  function dotState(index: number): DotState {
    if (index === range.startIndex || index === range.endIndex) return "edge";
    return index > range.startIndex && index < range.endIndex ? "in" : "out";
  }

  /** Which timelapse frame covers a given month — mirrors overlays.ts's bucketing. */
  function previewFor(index: number): string | undefined {
    if (!previewImages || previewImages.length === 0) return undefined;
    const bucket = Math.min(previewImages.length - 1, Math.floor((index / months.length) * previewImages.length));
    return previewImages[bucket];
  }

  // The rail/fill and the tree-count trend used to be two stacked strips —
  // a thin drag bar with a chart floating just above it. They're now one
  // band: the trend line IS the rail, the selected range is a clipped,
  // saturated segment of that same line over a soft wash rather than a
  // second bar drawn separately. Plotted in a 0–100 x 0–TRACK_HEIGHT viewBox
  // with preserveAspectRatio="none", so x=0..100 lines up exactly with the
  // dots/ticks/handles' own left:0%..100% — no separate scale to keep in
  // sync as the track's actual pixel width changes. The bottom
  // CHART_BOTTOM_PAD is left clear of the line itself so the tick/dot strip
  // anchored to the band's bottom edge never collides with it.
  const TRACK_HEIGHT = 34;
  const CHART_TOP_PAD = 4;
  const CHART_BOTTOM_PAD = 12;
  let sparkLine = "";
  let sparkArea = "";
  if (treeCountSeries && treeCountSeries.length === months.length && treeCountSeries.length > 1) {
    const max = Math.max(...treeCountSeries);
    const min = Math.min(...treeCountSeries);
    const span = max - min || 1;
    const plotHeight = TRACK_HEIGHT - CHART_TOP_PAD - CHART_BOTTOM_PAD;
    const points = treeCountSeries.map((v, i) => {
      const x = (i / lastCount) * 100;
      const y = TRACK_HEIGHT - CHART_BOTTOM_PAD - ((v - min) / span) * plotHeight;
      return [x, y] as const;
    });
    sparkLine = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    sparkArea = `${sparkLine} L100,${TRACK_HEIGHT} L0,${TRACK_HEIGHT} Z`;
  }

  return (
    <div className="relative">
      {/* Its own opaque-ish white, not `.surface-card`'s 12%-opacity wash —
          the timeline drives the whole dashboard's date range, so it reads
          as the most load-bearing control in the header rather than another
          translucent panel among many. */}
      <div
        className="w-full rounded-[var(--r-xl)] shadow-[var(--elev-1)] border border-[rgba(16,16,24,0.08)] pl-[16px] pr-[20px] py-[14px] flex flex-col gap-[5px]"
        style={{ background: "rgba(255, 255, 255, 0.62)" }}
      >
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              stepBack();
            }}
            disabled={atStart}
            aria-label="Jump to previous month"
            title={atStart ? "Already at the start of the timeline" : "Jump to the previous month"}
            className="u-press shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full border border-[#dedee3] text-[#464650] hover:bg-[#ebece7] disabled:text-[#cbcbd2] disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M8.6 0.7v8.6a0.5 0.5 0 0 1-.77.42l-5.6-4.3a0.5 0.5 0 0 1 0-.84l5.6-4.3A0.5 0.5 0 0 1 8.6 0.7z" fill="currentColor" />
              <rect x="0.6" y="0.6" width="1.5" height="8.8" rx="0.7" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={atEnd && !playing}
            aria-label={playing ? "Pause timeline playback" : "Play timeline playback"}
            aria-pressed={playing}
            title={playing ? "Pause" : atEnd ? "Already at the end of the timeline" : "Play through the timeline"}
            className="u-press shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full bg-[#096151] text-white disabled:bg-[#dedee3] disabled:text-[#a6a6b0] disabled:cursor-not-allowed cursor-pointer"
          >
            {playing ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="0.5" y="0.5" width="3" height="9" rx="1" fill="currentColor" />
                <rect x="6.5" y="0.5" width="3" height="9" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 0.6v8.8a0.6 0.6 0 0 0 0.92.51l7-4.4a0.6 0.6 0 0 0 0-1.02l-7-4.4A0.6 0.6 0 0 0 1 0.6z" fill="currentColor" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              stepForward();
            }}
            disabled={atEnd}
            aria-label="Jump to next month"
            title={atEnd ? "Already at the end of the timeline" : "Jump to the next month"}
            className="u-press shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full border border-[#dedee3] text-[#464650] hover:bg-[#ebece7] disabled:text-[#cbcbd2] disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.4 0.7v8.6a0.5 0.5 0 0 0 0.77.42l5.6-4.3a0.5 0.5 0 0 0 0-0.84l-5.6-4.3A0.5 0.5 0 0 0 1.4 0.7z" fill="currentColor" />
              <rect x="7.9" y="0.6" width="1.5" height="8.8" rx="0.7" fill="currentColor" />
            </svg>
          </button>

          {/* Real track + the locked upcoming-months strip side by side, each
              sized by how many month-slots it holds — `flex: {n}` gives every
              slot in either strip the same width without the two needing to
              agree on an actual pixel value. */}
          <div className="flex-1 min-w-0 flex items-stretch gap-[6px] relative">
          {/* `flex-col-reverse` puts the track first in the DOM but the label
              first on screen — the label reads as the heading above the rail. */}
          <div className="min-w-0 flex flex-col-reverse gap-[5px]" style={{ flex: `${lastCount} 1 0%` }}>
            <div
              ref={trackRef}
              className={`tl-track relative select-none touch-none ${dragging ? "tl-track--dragging" : ""}`}
              style={{ height: TRACK_HEIGHT }}
            >
              <div className="tl-rail" />

              {/* Soft wash behind the selected range — the same footprint the
                  old thin fill bar covered, now the full band height so the
                  trend line reads as sitting "inside" the selection rather
                  than floating above a separate control. */}
              <div className="tl-rail__wash" style={{ left: `${startPct}%`, width: `${displayEndPct - startPct}%` }} />

              {/* Trend chart: a muted full-timeline line underneath, and the
                  same line redrawn in the brand colour but clipped to the
                  selected range on top — one continuous line whose "in
                  range" segment is visually brighter, rather than a second
                  chart floating over an unrelated drag bar. */}
              {sparkLine && (
                <svg
                  viewBox={`0 0 100 ${TRACK_HEIGHT}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
                >
                  <defs>
                    <linearGradient id="tl-tree-fill-muted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#71717a" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="tl-tree-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#24A67A" stopOpacity="0.32" />
                      <stop offset="100%" stopColor="#24A67A" stopOpacity="0" />
                    </linearGradient>
                    <clipPath id="tl-range-clip" clipPathUnits="userSpaceOnUse">
                      <rect
                        className={dragging ? "" : "tl-range-clip-rect"}
                        x={startPct}
                        y={0}
                        width={Math.max(0, displayEndPct - startPct)}
                        height={TRACK_HEIGHT}
                      />
                    </clipPath>
                  </defs>
                  <path d={sparkArea} fill="url(#tl-tree-fill-muted)" />
                  <path
                    d={sparkLine}
                    fill="none"
                    stroke="#cbcbd2"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <g clipPath="url(#tl-range-clip)">
                    <path d={sparkArea} fill="url(#tl-tree-fill)" />
                    <path
                      d={sparkLine}
                      fill="none"
                      stroke="#096151"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                </svg>
              )}

              {/* The selected span is itself draggable — grabbing it slides
                  the whole selection left/right, keeping its width, rather
                  than only being able to resize it from the two end
                  handles. Transparent: the wash + chart above already paint
                  the visible selection, this is purely the hit target. */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`Move the selected range — currently ${months[range.startIndex]} to ${months[range.endIndex]}`}
                className={`tl-rail__fill ${dragging === "move" ? "tl-rail__fill--dragging" : ""}`}
                style={{ left: `${startPct}%`, width: `${displayEndPct - startPct}%` }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  moveStartRef.current = { clientX: e.clientX, startIndex: range.startIndex, endIndex: range.endIndex };
                  setDragging("move");
                }}
              />

              {/* A permanent, subtle tick per capture date — separate from
                  .tl-dot's own hover-only mark, so every month reads as a
                  gridline at rest instead of only on interaction. */}
              {months.map((month, index) => (
                <div key={`tick-${month}`} className="tl-tick" style={{ left: `${(index / lastCount) * 100}%` }} />
              ))}

              {/* "Today" — the real track's own right edge is exactly the
                  boundary between the last surveyed month and the locked
                  upcoming strip, so this needs no date math of its own: it
                  just marks where the real data already ends. */}
              <div className="tl-today" aria-hidden="true">
                <span className="tl-today__label">Today</span>
              </div>

              {months.map((month, index) => (
                <button
                  key={month}
                  type="button"
                  className="tl-dot"
                  data-state={dotState(index)}
                  style={{ left: `${(index / lastCount) * 100}%` }}
                  onClick={() => jumpTo(index)}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered((h) => (h === index ? null : h))}
                  aria-label={`Set range boundary to ${month}`}
                >
                  <span className="tl-dot__mark" />
                </button>
              ))}

              <button
                type="button"
                aria-label="Range start"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging("start");
                }}
                // The handle sits exactly on top of its own boundary dot, so
                // without this the dot underneath can never receive a hover —
                // the handle intercepts the pointer first. Whichever month a
                // handle currently marks is exactly the month its preview
                // should show.
                onMouseEnter={() => setHovered(range.startIndex)}
                onMouseLeave={() => setHovered((h) => (h === range.startIndex ? null : h))}
                onFocus={() => setHovered(range.startIndex)}
                onBlur={() => setHovered((h) => (h === range.startIndex ? null : h))}
                className={`tl-handle ${dragging === "start" ? "tl-handle--active" : ""} ${
                  dragging ? "" : "tl-handle--animated"
                }`}
                style={{ left: `${startPct}%` }}
              />
              <button
                type="button"
                aria-label="Range end"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging("end");
                }}
                onMouseEnter={() => setHovered(range.endIndex)}
                onMouseLeave={() => setHovered((h) => (h === range.endIndex ? null : h))}
                onFocus={() => setHovered(range.endIndex)}
                onBlur={() => setHovered((h) => (h === range.endIndex ? null : h))}
                className={`tl-handle ${dragging === "end" ? "tl-handle--active" : ""} ${
                  dragging ? "" : "tl-handle--animated"
                }`}
                style={{ left: `${displayEndPct}%` }}
              />

              {/* Rendered for the hovered dot only, and below the rail rather
                  than above it: these frames are multi-megabyte JPEGs, so one
                  <img> per dot would pull the whole set on mount, and a
                  thumbnail-sized pill above the rail would collide with the
                  fixed top bar. */}
              {displayedHover !== null && !dragging && (
                <div
                  className={`tl-preview ${previewLeaving ? "tl-preview--leaving" : ""}`}
                  style={{
                    left: `${(displayedHover / lastCount) * 100}%`,
                    // The 148px-wide card would overflow the timeline's own
                    // edge for the first/last couple of months if centred —
                    // anchor those to their own side instead.
                    ["--tl-preview-x" as string]:
                      displayedHover <= 1 ? "0%" : displayedHover >= lastCount - 1 ? "-100%" : "-50%",
                  }}
                >
                  {previewFor(displayedHover) ? (
                    <div className="tl-preview__frame">
                      <img src={previewFor(displayedHover)} alt="" className="tl-preview__img" loading="lazy" />
                      {/* A pin glyph, not a caption — this is meant to read as
                          "here's what the map looked like then", the same
                          teardrop marker the map itself uses for a flagged
                          tree, not a generic photo thumbnail. */}
                      <svg width="14" height="18" viewBox="0 0 26 34" fill="none" className="tl-preview__pin">
                        <path
                          d="M13 33.5C13 33.5 24.5 20.8 24.5 13A11.5 11.5 0 1 0 1.5 13C1.5 20.8 13 33.5 13 33.5Z"
                          fill="#096151"
                          stroke="#ffffff"
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                  ) : null}
                  <span className="tl-preview__date">{months[displayedHover]}</span>
                  {healthCountsSeries?.[displayedHover] && (
                    <div className="flex items-center gap-[6px]">
                      {AT_RISK_HEALTH.map(({ key, label, color }) => (
                        <span key={key} className="flex items-center gap-[3px]" title={label}>
                          <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-[9px] font-medium text-white/90 font-['Outfit',sans-serif] tabular-nums whitespace-nowrap">
                            {healthCountsSeries[displayedHover][key]}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* A full month-by-month axis, one tick per timestamp under its
                own dot — only worth the visual weight now that the track
                spans the whole toolbar; at the old ~360px width, 12 labels
                would have overlapped into an unreadable smear. The selected
                range used to also get its own "Mon '26 – Mon '26" line above
                this row — redundant with the row right below it, so the
                range is now highlighted directly here instead: the two
                boundary months pick up the same green/bold treatment that
                line used to own. */}
            <div className="relative h-[13px]">
              {months.map((month, index) => {
                // Centering every label on its dot would clip the first and
                // last against the card's edge padding — anchor those two to
                // their own end instead, everything between stays centered.
                const align = index === 0 ? "translate-x-0" : index === lastCount ? "-translate-x-full" : "-translate-x-1/2";
                const state = dotState(index);
                return (
                  <span
                    key={month}
                    className={`absolute top-0 ${align} text-[10px] font-['Outfit',sans-serif] whitespace-nowrap transition-colors duration-150 ${
                      state === "edge"
                        ? "font-medium text-[#096151]"
                        : state === "out"
                          ? "text-[#a6a6b0]"
                          : "text-[#5b5b66]"
                    }`}
                    style={{ left: `${(index / lastCount) * 100}%` }}
                  >
                    {month}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Locked preview of the next `UPCOMING_MONTHS.length` calendar
              months — no snapshot data exists for these yet, so they render
              as a visibly continued axis (rail, ticks, labels) with none of
              the interactive pieces: no dot buttons, no handles, nothing for
              jumpTo/drag to land on. `aria-hidden` because there's nothing
              here a screen reader user could act on. */}
          {UPCOMING_MONTHS.length > 0 && (
            <div
              className="shrink-0 flex flex-col-reverse gap-[5px] opacity-50"
              style={{ flex: `${UPCOMING_MONTHS.length} 1 0%` }}
              aria-hidden="true"
              title="Not yet available — no imagery captured for these months"
            >
              <div className="relative" style={{ height: TRACK_HEIGHT }}>
                <div className="tl-rail tl-rail--disabled" />
                {UPCOMING_MONTHS.map((_, index) => (
                  <div
                    key={`upcoming-tick-${index}`}
                    className="tl-tick tl-tick--disabled"
                    style={{ left: `${(index / Math.max(1, UPCOMING_MONTHS.length - 1)) * 100}%` }}
                  />
                ))}
              </div>

              <div className="relative h-[13px]">
                {UPCOMING_MONTHS.map((month, index) => {
                  const align =
                    index === 0
                      ? "translate-x-0"
                      : index === UPCOMING_MONTHS.length - 1
                        ? "-translate-x-full"
                        : "-translate-x-1/2";
                  return (
                    <span
                      key={month}
                      className={`absolute top-0 ${align} text-[10px] font-['Outfit',sans-serif] whitespace-nowrap text-[#a6a6b0]`}
                      style={{ left: `${(index / Math.max(1, UPCOMING_MONTHS.length - 1)) * 100}%` }}
                    >
                      {month}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Promo trigger: anchored over the locked upcoming-months strip —
              the pitch is about the very months it's sitting on top of (no
              imagery yet for Oct '26 / Nov '26), not a generic banner
              floating off to the side of the whole timeline. Positioned
              absolutely against this row (not the upcoming column itself,
              which is `aria-hidden` and would swallow the button along with
              it), centred on that column's own horizontal midpoint and
              vertically centred on `tl-track`'s own band — both columns are
              flush at the row's bottom (see the empty spacer comment above),
              so `bottom` reaches the same TRACK_HEIGHT strip `.tl-track`
              itself occupies rather than floating above the whole row.

              Dark chip + white glyph, not the light green outline pill this
              used to be — a small black rounded badge with a white icon, the
              way a promo trigger reads in the moodboard this was restyled
              from, rather than blending in as another data label. */}
          {previewImages && plannedCaptures && UPCOMING_MONTHS.length > 0 ? (
            <button
              type="button"
              onClick={() => setBannerOpen((b) => !b)}
              aria-expanded={bannerOpen}
              className="u-press whats-next-btn absolute bottom-[3px] -translate-x-1/2 flex items-center gap-[7px] pl-[10px] pr-[14px] py-[8px] rounded-full text-white cursor-pointer whitespace-nowrap shadow-[0_4px_14px_-2px_rgba(0,0,0,0.45)] transition-transform duration-150 hover:scale-[1.03]"
              style={{ left: `${((lastCount + UPCOMING_MONTHS.length / 2) / (lastCount + UPCOMING_MONTHS.length)) * 100}%` }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path
                  d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z"
                  fill="white"
                />
              </svg>
              <span className="text-[12px] font-medium font-['Outfit',sans-serif] leading-[16px] whitespace-nowrap">
                What&apos;s next?
              </span>
            </button>
          ) : null}
          </div>
        </div>
      </div>

      {bannerOpen && previewImages && plannedCaptures && (
        <DenseCoverageModal
          previewImages={previewImages}
          plannedCaptures={plannedCaptures}
          onClose={() => setBannerOpen(false)}
        />
      )}
    </div>
  );
}
