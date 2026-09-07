import { useCallback, useEffect, useRef, useState } from "react";

const SHRINK_PX = 180;
const PLAY_STEP_MS = 3200;

function easeOutExpo(p: number): number {
  return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
}

/**
 * Scrolling for the Story panel.
 *
 * The panel scrolls freely — the wheel is never hijacked, and merely passing
 * a block while scrolling does not make it "active". Active only changes
 * through an explicit action: clicking a block, the transport buttons, a
 * section chip, an outline entry, or autoplay. All of those animate the
 * scroll position themselves (see `goTo`), the same eased step regardless of
 * which one triggered it.
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

  // Scroll only drives the header's shrink — never `active`. A free scroll
  // that passed over five blocks to reach the sixth is not a click on any of
  // them.
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
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [syncShrink]);

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
