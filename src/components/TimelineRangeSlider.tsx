import { useCallback, useEffect, useRef, useState } from "react";
import type { DateRange } from "../data/aggregate";
import type { HealthKey } from "../data/types";

// Same colour coding as the health donut and map pins elsewhere on the
// dashboard — a reader who already learned that legend gets it for free here.
const AT_RISK_HEALTH: { key: HealthKey; label: string; color: string }[] = [
  { key: "stressed", label: "Stressed", color: "#F0B429" },
  { key: "declining", label: "Declining", color: "#E55C2F" },
  { key: "dead", label: "Dead", color: "#8C8C8C" },
];

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
  const [hovered, setHovered] = useState<number | null>(null);
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

  // Plotted in a 0–100 x 0–SPARK_HEIGHT viewBox with preserveAspectRatio="none",
  // so x=0..100 lines up exactly with the dots/ticks' own left:0%..100% —
  // no separate scale to keep in sync as the track's actual pixel width changes.
  const SPARK_HEIGHT = 26;
  let sparkLine = "";
  let sparkArea = "";
  if (treeCountSeries && treeCountSeries.length === months.length && treeCountSeries.length > 1) {
    const max = Math.max(...treeCountSeries);
    const min = Math.min(...treeCountSeries);
    const span = max - min || 1;
    const points = treeCountSeries.map((v, i) => {
      const x = (i / lastCount) * 100;
      // A little headroom top/bottom so the line never touches the band's edge.
      const y = SPARK_HEIGHT - 3 - ((v - min) / span) * (SPARK_HEIGHT - 6);
      return [x, y] as const;
    });
    sparkLine = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    sparkArea = `${sparkLine} L100,${SPARK_HEIGHT} L0,${SPARK_HEIGHT} Z`;
  }

  return (
    <div className="relative">
      <div className="w-full bg-white border border-[#e5e5e5] rounded-[8px] pl-[8px] pr-[12px] py-[6px] shadow-[0px_2px_8px_rgba(0,0,0,0.07)] flex flex-col gap-[5px]">
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
            className="u-press shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full border border-[#d9d9d9] text-[#363636] hover:bg-[#f2f2f2] disabled:text-[#c4c4c4] disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
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
            className="u-press shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full bg-[#096151] text-white disabled:bg-[#e5e5e5] disabled:text-[#b4b4b4] disabled:cursor-not-allowed cursor-pointer"
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
            className="u-press shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full border border-[#d9d9d9] text-[#363636] hover:bg-[#f2f2f2] disabled:text-[#c4c4c4] disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.4 0.7v8.6a0.5 0.5 0 0 0 0.77.42l5.6-4.3a0.5 0.5 0 0 0 0-0.84l-5.6-4.3A0.5 0.5 0 0 0 1.4 0.7z" fill="currentColor" />
              <rect x="7.9" y="0.6" width="1.5" height="8.8" rx="0.7" fill="currentColor" />
            </svg>
          </button>

          {/* `flex-col-reverse` puts the track first in the DOM but the label
              first on screen — the label reads as the heading above the rail. */}
          <div className="flex-1 min-w-0 flex flex-col-reverse gap-[5px]">
            <div
              ref={trackRef}
              className={`tl-track relative h-[18px] flex items-center select-none touch-none ${
                dragging ? "tl-track--dragging" : ""
              }`}
            >
              <div className="tl-rail" />
              {/* The filled span is itself draggable — grabbing it slides the
                  whole selection left/right, keeping its width, rather than
                  only being able to resize it from the two end handles. */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`Move the selected range — currently ${months[range.startIndex]} to ${months[range.endIndex]}`}
                className={`tl-rail__fill ${dragging === "move" ? "tl-rail__fill--dragging" : ""}`}
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
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
                  dragging ? "" : "transition-[left] duration-200 ease-out"
                }`}
                style={{ left: `${startPct}%` }}
              >
                <span className="tl-handle__grip" />
              </button>
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
                  dragging ? "" : "transition-[left] duration-200 ease-out"
                }`}
                style={{ left: `${endPct}%` }}
              >
                <span className="tl-handle__grip" />
              </button>

              {/* Rendered for the hovered dot only, and below the rail rather
                  than above it: these frames are multi-megabyte JPEGs, so one
                  <img> per dot would pull the whole set on mount, and a
                  thumbnail-sized pill above the rail would collide with the
                  fixed top bar. */}
              {hovered !== null && !dragging && (
                <div
                  className="tl-preview"
                  style={{
                    left: `${(hovered / lastCount) * 100}%`,
                    // The 148px-wide card would overflow the timeline's own
                    // edge for the first/last couple of months if centred —
                    // anchor those to their own side instead.
                    ["--tl-preview-x" as string]: hovered <= 1 ? "0%" : hovered >= lastCount - 1 ? "-100%" : "-50%",
                  }}
                >
                  {previewFor(hovered) ? (
                    <div className="tl-preview__frame">
                      <img src={previewFor(hovered)} alt="" className="tl-preview__img" loading="lazy" />
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
                  <span className="tl-preview__date">{months[hovered]}</span>
                  {healthCountsSeries?.[hovered] && (
                    <div className="flex items-center gap-[6px]">
                      {AT_RISK_HEALTH.map(({ key, label, color }) => (
                        <span key={key} className="flex items-center gap-[3px]" title={label}>
                          <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-[9px] font-medium text-white/90 font-['Inter',sans-serif] tabular-nums whitespace-nowrap">
                            {healthCountsSeries[hovered][key]}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tree-count trend, sitting directly over the track it shares an
                x-axis with — same 0%..100% coordinate space as the dots/ticks
                below, so a bump in the line always lines up with its month. */}
            {sparkLine && (
              <div className="relative w-full pointer-events-none" style={{ height: SPARK_HEIGHT }}>
                <svg
                  viewBox={`0 0 100 ${SPARK_HEIGHT}`}
                  preserveAspectRatio="none"
                  className="w-full h-full overflow-visible"
                >
                  <defs>
                    <linearGradient id="tl-tree-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#24A67A" stopOpacity="0.32" />
                      <stop offset="100%" stopColor="#24A67A" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={sparkArea} fill="url(#tl-tree-fill)" />
                  <path
                    d={sparkLine}
                    fill="none"
                    stroke="#096151"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            )}

            <div className="flex items-center justify-between px-[1px]">
              <span className="tl-label flex-1 text-[12px] font-normal text-[#363636] font-['Inter',sans-serif] text-center">
                <span className="font-medium text-[#096151]">{months[range.startIndex]}</span>
                {" – "}
                <span className="font-medium text-[#096151]">{months[range.endIndex]}</span>
              </span>
            </div>

            {/* A full month-by-month axis, one tick per timestamp under its
                own dot — only worth the visual weight now that the track
                spans the whole toolbar; at the old ~360px width, 12 labels
                would have overlapped into an unreadable smear. */}
            <div className="relative h-[13px]">
              {months.map((month, index) => {
                // Centering every label on its dot would clip the first and
                // last against the card's edge padding — anchor those two to
                // their own end instead, everything between stays centered.
                const align = index === 0 ? "translate-x-0" : index === lastCount ? "-translate-x-full" : "-translate-x-1/2";
                return (
                  <span
                    key={month}
                    className={`absolute top-0 ${align} text-[10px] font-['Inter',sans-serif] whitespace-nowrap transition-colors duration-150 ${
                      dotState(index) === "out" ? "text-[#b4b4b4]" : "text-[#6b6b6b]"
                    }`}
                    style={{ left: `${(index / lastCount) * 100}%` }}
                  >
                    {month}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Promo trigger: right-aligned in the top row (flex-1 above pushes
              it there) rather than a separate centred row beneath the track —
              reads as a badge advertising more coverage, not a data label. */}
          {previewImages && plannedCaptures ? (
            <button
              type="button"
              onClick={() => setBannerOpen((b) => !b)}
              aria-expanded={bannerOpen}
              className="u-press shrink-0 flex items-center gap-[5px] pl-[6px] pr-[8px] py-[4px] rounded-full bg-[#0961511a] border border-[#09615166] text-[#096151] cursor-pointer"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path
                  d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z"
                  fill="currentColor"
                />
              </svg>
              <span className="text-[10px] font-medium font-['Inter',sans-serif] leading-[14px] whitespace-nowrap">
                {previewImages.length} of {plannedCaptures} captures
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {bannerOpen && previewImages && plannedCaptures && (
        <div className="tl-banner absolute left-0 right-0 top-[calc(100%+8px)] z-[30] bg-[#096151] text-white rounded-[8px] px-[12px] py-[10px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.25)] flex items-start gap-[10px] animate-fade-in">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold font-['Inter',sans-serif] leading-[16px]">
              Denser time coverage available
            </p>
            <p className="text-[11px] font-['Inter',sans-serif] leading-[15px] text-white/80 mt-[2px]">
              {plannedCaptures - previewImages.length} further captures are planned for this plot. Add them to
              step through the recovery week by week instead of month by month.
            </p>
            <button
              type="button"
              className="u-press mt-[8px] px-[10px] py-[4px] rounded-[6px] bg-white text-[#096151] text-[11px] font-medium font-['Inter',sans-serif] cursor-pointer"
            >
              Request imagery
            </button>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setBannerOpen(false)}
            className="u-press shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white cursor-pointer"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
