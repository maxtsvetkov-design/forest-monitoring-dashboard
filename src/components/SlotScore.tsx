import { useEffect, useState } from "react";

/** One digit of a slot-machine reel: a 0–9 strip that starts parked on "0"
 * and, once `spin` flips true, transform-translates up to land on `digit` —
 * a real spin (every digit rolls through 0-9 on the way there), not a
 * count-up tween, so it reads as a mechanical reel settling rather than a
 * number ticking. Percentage translateY is relative to the track's own
 * height (10 stacked cells), so it lands correctly regardless of the
 * caller's font size — no pixel math tied to any one caller's font size. */
function SlotDigit({ digit, spin, delay }: { digit: number; spin: boolean; delay: number }) {
  return (
    <span className="slot-digit" aria-hidden="true">
      <span
        className="slot-digit__track"
        style={{ transform: `translateY(-${(spin ? digit : 0) * 10}%)`, transitionDelay: `${delay}ms` }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="slot-digit__cell">
            {i}
          </span>
        ))}
      </span>
    </span>
  );
}

/** A score spun in on mount like a casino reel rather than appearing flat —
 * each digit staggered slightly so they don't all land in lockstep. Shared
 * between LandingScreen's hero banner and OverallHealthCard, which show the
 * same underlying site-health score at two different sizes — both inherit
 * font-size/weight/color from the caller's own wrapping element, so this
 * component carries no typography of its own. `aria-hidden` digits plus a
 * real `aria-label` on the wrapper keep the animation purely decorative for
 * assistive tech. */
export default function SlotScore({ value }: { value: number }) {
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSpin(true), 60);
    return () => clearTimeout(t);
  }, []);
  const digits = String(value).split("");
  return (
    <span aria-label={`${value}%`} className="inline-flex">
      {digits.map((d, i) => (
        <SlotDigit key={i} digit={Number(d)} spin={spin} delay={i * 90} />
      ))}
    </span>
  );
}
