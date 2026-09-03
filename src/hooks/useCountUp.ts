import { useEffect, useRef, useState } from "react";

/** Ease-out-expo — fast start, long soft landing, reads as "counting up" rather
 * than a linear ticker. */
function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Animates a number from 0 up to `target` over `durationMs`, starting after
 * `delayMs`. Re-runs whenever `target` changes (so a filtered/range-changed
 * value re-counts instead of jumping), driven by requestAnimationFrame rather
 * than a setInterval tick so it stays smooth regardless of frame rate.
 */
export function useCountUp(target: number, durationMs = 900, delayMs = 0): number {
  const [value, setValue] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    let raf = 0;
    let startTime: number | null = null;
    const timeout = window.setTimeout(() => {
      function tick(now: number) {
        if (startTime === null) startTime = now;
        const t = Math.min(1, (now - startTime) / durationMs);
        setValue(targetRef.current * easeOutExpo(t));
        if (t < 1) raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, delayMs]);

  return value;
}
