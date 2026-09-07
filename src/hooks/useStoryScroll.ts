import { useCallback, useEffect, useRef, useState } from "react";

const SHRINK_PX = 180;
const PLAY_STEP_MS = 3200;
/** How long a free scroll has to sit still before it's allowed to change
 * `active` — long enough that flicking past a dozen blocks to get somewhere
 * only settles on the block actually landed on, not each one passed over
 * (which would otherwise fire a map camera transition per block). */
const SCROLL_SETTLE_MS = 140;
/** Read the block whose top has scrolled past this far below the scrollport's
 * own top edge as "the one being read" — a small margin rather than 0 so a
 * block that has *just* started entering at the very top doesn't flip active
 * a frame before its heading is actually legible. */
const ACTIVE_THRESHOLD_PX = 24;

function easeOutExpo(p: number): number {
  return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
}

/**
 * Scrolling for the Story panel.
 *
 * The panel scrolls freely — the wheel is never hijacked. Active changes two
 * ways: an explicit action (clicking a block, the transport buttons, a
 * section chip, an outline entry, or autoplay) animates the scroll position
 * itself (see `goTo`), the same eased step regardless of which one
 * triggered it; a free scroll instead settles onto whichever block its own
 * position rests on once scrolling actually stops (see `SCROLL_SETTLE_MS`),
 * so the section chips, the liquid pill and the map beside the panel all
 * track a plain scroll the same way they track a click — without re-flying
 * the camera for every block a fast scroll merely passes over on the way
 * somewhere else.
 */
export function useStoryScroll(blockCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  /** 0..1 header-collapse progress, driven purely from scrollTop. Deriving it
   * from measured layout instead would loop: the header shrinking changes the
   * body's height, which would change the input that shrank it. */
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);

  const animRef = useRef<number | null>(null);
  const activeRef = useRef(0);
  activeRef.current = active;

  const setBlockRef = useCallback((index: number) => {
    return (el: HTMLElement | null) => {
      blockRefs.current[index] = el;
    };
  }, []);

  /** Distance from the scrollport's top, not offsetTop: a block's offset
   * parent is not the scroller, so offsetTop would silently fold in the
   * header — which itself changes height as `k` moves. */
  const topOf = useCallback((el: HTMLElement) => {
    const scroll = scrollRef.current;
    if (!scroll) return 0;
    return el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 12;
  }, []);

  /** The last block whose own top has scrolled past the read line — same
   * "last one crossed, not nearest one" rule most scrollspy implementations
   * use, since a heading that has scrolled just barely above the top is what
   * the reader is actually looking at, not the one below it that hasn't
   * arrived yet. */
  const activeFromScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return activeRef.current;
    const line = scroll.scrollTop + ACTIVE_THRESHOLD_PX;
    let result = 0;
    for (let i = 0; i < blockRefs.current.length; i++) {
      const el = blockRefs.current[i];
      if (!el || topOf(el) > line) break;
      result = i;
    }
    return result;
  }, [topOf]);

  const syncShrink = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const next = Math.round(Math.min(1, Math.max(0, scroll.scrollTop / SHRINK_PX)) * 100) / 100;
    setK((prev) => (prev === next ? prev : next));
  }, []);

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const animateTo = useCallback(
    (target: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      cancelAnim();
      const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      const to = Math.max(0, Math.min(max, target));
      const from = scroll.scrollTop;
      const delta = to - from;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced || Math.abs(delta) < 1) {
        scroll.scrollTop = to;
        syncShrink();
        return;
      }
      // Duration scales with distance, so a neighbouring block is quick and a
      // jump across the story still reads as one continuous move.
      const duration = Math.min(900, Math.max(440, 340 + Math.abs(delta) * 0.4));
      const start = performance.now();
      const frame = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        scroll.scrollTop = from + delta * easeOutExpo(p);
        syncShrink();
        if (p < 1) animRef.current = requestAnimationFrame(frame);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(frame);
    },
    [cancelAnim, syncShrink],
  );

  const goTo = useCallback(
    (index: number) => {
      const i = Math.max(0, Math.min(blockCount - 1, index));
      const el = blockRefs.current[i];
      if (!el) return;
      setActive(i);
      animateTo(topOf(el));
    },
    [animateTo, blockCount, topOf],
  );

  const step = useCallback((delta: number) => goTo(activeRef.current + delta), [goTo]);

  const stopPlay = useCallback(() => setPlaying(false), []);

  // Scroll drives the header's shrink on every frame (cheap, purely visual),
  // and — once scrolling actually settles — which block is "active" (see
  // activeFromScroll). The settle debounce is what keeps a fast scroll from
  // re-triggering the map's camera transition once per block passed over: an
  // in-flight `goTo`/autoplay animation fires this same listener repeatedly
  // too, but each restart just pushes the timer back, so it never fires
  // before the animation's own final position is the one being read.
  const settleTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        syncShrink();
      });
      if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = null;
        const next = activeFromScroll();
        if (next !== activeRef.current) setActive(next);
      }, SCROLL_SETTLE_MS);
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current);
    };
  }, [syncShrink, activeFromScroll]);

  // Autoplay. The advance is scheduled off the same clock that paints the
  // progress ring (see StoryPanel's `progress`), so the two cannot drift.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (activeRef.current >= blockCount - 1) setPlaying(false);
      else step(1);
    }, PLAY_STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, blockCount, step]);

  useEffect(() => cancelAnim, [cancelAnim]);

  return {
    scrollRef,
    setBlockRef,
    active,
    k,
    goTo,
    step,
    playing,
    setPlaying,
    stopPlay,
    playStepMs: PLAY_STEP_MS,
  };
}
