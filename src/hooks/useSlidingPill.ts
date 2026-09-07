import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The top bar's Insights/Areas/Maps/Assets/Story tabs use one pill that
 * slides and liquid-morphs between the active button rather than the active
 * colour jumping from one to another (see `.seg-track`/`.tab-pill` in
 * index.css). This is that same measurement-and-morph machinery, pulled out
 * of App.tsx so any other segmented control — the Areas view's Trees
 * table/Recent events switch, say — reads as the same physical object
 * moving, not a second, subtly different animation that happens to look
 * similar.
 *
 * Left out on purpose: App.tsx's one-shot "welcome" glow on first landing.
 * That is specific to the very first view of the dashboard, not to sliding
 * pills in general, so it stays local to App.tsx, layered on top of this
 * hook's own `ready` the same way it always was.
 */
export function useSlidingPill<Key extends string>(activeKey: Key, resizeDeps: readonly unknown[] = []) {
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Partial<Record<Key, HTMLElement | null>>>({});
  const [pill, setPill] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);

  function measure() {
    const el = itemRefs.current[activeKey];
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }

  // Layout effect, not effect: measuring after paint would show the pill at
  // its old position for a frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [activeKey, ...resizeDeps]);

  // The track resizing (a font finishing load, the window resizing, a panel
  // being dragged narrower) changes the buttons' widths; a pill measured once
  // would then sit slightly off its label.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, ...resizeDeps]);

  // Transitions stay off until the first real measurement lands, otherwise
  // the pill visibly flies in from x=0 on mount.
  useEffect(() => {
    if (pill.width === 0) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [pill.width]);

  // Squash-and-stretch wobble layered on top of the left/width slide — see
  // `.tab-pill--morphing` in index.css. Skipped on the very first render
  // (nothing has moved yet to wobble about).
  const [morphing, setMorphing] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setMorphing(true);
    const t = setTimeout(() => setMorphing(false), 650);
    return () => clearTimeout(t);
  }, [activeKey]);

  function setItemRef(key: Key) {
    return (el: HTMLElement | null) => {
      itemRefs.current[key] = el;
    };
  }

  return { trackRef, setItemRef, pill, ready, morphing };
}
