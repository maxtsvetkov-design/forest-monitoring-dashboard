import { useCallback, useEffect, useRef, useState } from "react";

const SHRINK_PX = 180;
const PLAY_STEP_MS = 3200;

function easeOutExpo(p: number): number {
  return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
}

/**
 * Scrolling for the Story panel.
 *
 * The panel is a scrollspy: whichever block sits at the read line — a fixed
 * distance below the sticky header — is the active one, so scrolling *is*
 * turning the page and the map follows the reader without a click. Clicking a
 * block, the transport buttons, a section chip, an outline entry or a deep
 * link all still work, and all of them *scroll* to their target (see `goTo`)
 * rather than setting `active` directly — the scrollspy is what actually
 * flips it, once the scroll (animated or not) carries the target block across
 * the read line. That keeps there being exactly one thing that decides which
 * block is active, however it was reached.
 *
 * The read line sits near the top of the viewport, not its centre: a block
 * becomes active as soon as its heading is the thing being read, not once
 * it's swept past the middle of the panel.
 *
 * Scroll also still drives `k` (the header's collapse), which is purely
 * visual and has no reader-facing consequence beyond the panel's own chrome.
 */
const READ_LINE_PX = 96;
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

  /** Which block is at the read line right now — the last one whose heading
   *  has already crossed it. Pinned to the last block once the scroller has
   *  hit bottom, since the tail padding (see StoryPanel) means the final
   *  block's own top may never reach the line. */
  const syncActive = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
    if (atBottom) {
      setActive(blockRefs.current.length - 1);
      return;
    }
    const scrollTop = scroll.getBoundingClientRect().top;
    let next = 0;
    for (let i = 0; i < blockRefs.current.length; i++) {
      const el = blockRefs.current[i];
      if (!el) continue;
      if (el.getBoundingClientRect().top - scrollTop <= READ_LINE_PX) next = i;
      else break;
    }
    setActive((prev) => (prev === next ? prev : next));
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
        syncActive();
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
        syncActive();
        if (p < 1) animRef.current = requestAnimationFrame(frame);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(frame);
    },
    [cancelAnim, syncActive, syncShrink],
  );

  const goTo = useCallback(
    (index: number, opts?: { immediate?: boolean }) => {
      const i = Math.max(0, Math.min(blockCount - 1, index));
      const el = blockRefs.current[i];
      if (!el) return;
      // Set eagerly so a click feels instant rather than waiting on the
      // scroll to carry the target across the read line — the scrollspy
      // below re-derives the same value once it gets there, or corrects it
      // if the block is too short/near the end to ever reach the line.
      setActive(i);
      // `immediate` is for arriving at a block rather than travelling to one
      // — a deep link opens *at* its block, and animating there from the top
      // would play the reader a journey they didn't take.
      if (opts?.immediate) {
        const scroll = scrollRef.current;
        if (scroll) {
          cancelAnim();
          scroll.scrollTop = topOf(el);
          syncShrink();
        }
        return;
      }
      animateTo(topOf(el));
    },
    [animateTo, blockCount, cancelAnim, syncShrink, topOf],
  );

  const step = useCallback((delta: number) => goTo(activeRef.current + delta), [goTo]);

  const stopPlay = useCallback(() => setPlaying(false), []);

  // Scroll drives the header's shrink and, via the scrollspy, which block is
  // active — see this hook's own comment. rAF-batched so a fling of wheel
  // events costs one measurement per frame rather than one per event.
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
        syncActive();
      });
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [syncActive, syncShrink]);

  // Turns a wheel notch into a page turn: one tick, one slide, regardless of
  // how hard the trackpad was flicked. A native `wheel` listener rather than
  // React's `onWheel` because React's is passive and can't `preventDefault`
  // — without that, the browser's own free scroll would run at the same time
  // as `goTo`'s animation and the two would fight over `scrollTop`.
  //
  // Locked for the length of one `goTo` animation (plus a little), not just
  // until the next tick, so a trackpad's inertia — which keeps emitting wheel
  // events long after the finger lifts — can't queue up several page turns
  // for one gesture. Dragging the scrollbar or a touch swipe is untouched:
  // those free-scroll and settle on the nearest slide via CSS snap instead,
  // same as any other scrollable pane.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let locked = false;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      if (locked) return;
      locked = true;
      stopPlay();
      step(e.deltaY > 0 ? 1 : -1);
      window.setTimeout(() => {
        locked = false;
      }, 650);
    };
    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [step, stopPlay]);

  // Arrow-key paging when the panel has focus, for the same reason PowerPoint
  // and Keynote's web viewers bind them: a slide deck is read one slide at a
  // time, and the keyboard is the accessible path to that when a pointer
  // (wheel or touch) isn't in use. Space is included because it's the
  // convention every slide-viewer and `<video>` share for "advance".
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const advance = e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ";
      const back = e.key === "ArrowUp" || e.key === "PageUp";
      if (!advance && !back) return;
      e.preventDefault();
      stopPlay();
      step(advance ? 1 : -1);
    };
    scroll.addEventListener("keydown", onKeyDown);
    return () => scroll.removeEventListener("keydown", onKeyDown);
  }, [step, stopPlay]);

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
