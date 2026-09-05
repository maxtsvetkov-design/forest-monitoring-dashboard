import { useCallback, useEffect, useRef, useState } from "react";
import type { DateRange } from "../data/aggregate";

export type ScrubHandle = "start" | "end" | "move";

const DEFAULT_PLAY_STEP_MS = 1400;

/**
 * The range-selection engine behind both the full-size TimelineRangeSlider and
 * the compact per-layer coverage strips: index <-> x math, pointer dragging of
 * either handle or the whole band, click-to-jump, and month-by-month playback.
 *
 * Extracted so the two skins cannot drift apart on clamping or snapping rules.
 * Every comment below explains a behaviour that was tuned in place in the
 * original slider — preserve them.
 */
export function useRangeScrub({
  trackRef,
  count,
  range,
  onChange,
  playStepMs = DEFAULT_PLAY_STEP_MS,
  onPlayingChange,
}: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  count: number;
  range: DateRange;
  onChange: (range: DateRange) => void;
  playStepMs?: number;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const [dragging, setDragging] = useState<ScrubHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const lastCount = count - 1;

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
    [lastCount, trackRef],
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
    }, playStepMs);
    return () => window.clearInterval(id);
  }, [playing, lastCount, stepForward, playStepMs]);

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

  /** Arms a drag. For "move" it also captures the fixed reference the delta is
   * measured from — see moveStartRef above. */
  const beginDrag = useCallback((handle: ScrubHandle, clientX: number) => {
    if (handle === "move") {
      const current = rangeRef.current;
      moveStartRef.current = { clientX, startIndex: current.startIndex, endIndex: current.endIndex };
    }
    setDragging(handle);
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
  }, [dragging, indexFromClientX, onChange, range.startIndex, range.endIndex, lastCount, trackRef]);

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

  /** Position of a month index along the track, as a percentage. */
  const pctFor = useCallback((index: number) => (index / lastCount) * 100, [lastCount]);

  return {
    dragging,
    beginDrag,
    playing,
    setPlaying,
    stepForward,
    stepBack,
    jumpTo,
    pctFor,
    atStart: range.startIndex <= 0,
    atEnd: range.endIndex >= lastCount,
  };
}
