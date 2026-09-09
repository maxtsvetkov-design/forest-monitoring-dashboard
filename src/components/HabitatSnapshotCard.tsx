import { useEffect, useRef, useState } from "react";
import { smootherstep, underlayOpacity } from "../lib/crossfade";

/**
 * A small floating habitat photo, layered over the Al Maha map rather than
 * replacing it — the map itself still carries the layer panel, the 3D
 * canopy, the timeline scrubber and everything else built on MapCanvas; this
 * is one extra reference image sitting on top of it, with its own tiny
 * timeline (three dots, not a full scrubber) to step through the three
 * delivered frames.
 *
 * Dissolves between frames on the same compensated crossfade the map's own
 * raster swap and Abu Al Abyad's `AreaImageStage` use — see `lib/crossfade.ts`
 * — so a click here feels like the rest of the app rather than a hard cut.
 */
// Exported rather than duplicated: the Recent Events tab's own habitat stage
// (App.tsx) shows the same three frames, and a second hardcoded copy of this
// list is exactly the kind of literal this app's own conventions ask not to
// duplicate.
export const HABITAT_FRAMES = ["/overlays/habitat_1.jpg", "/overlays/habitat_2.jpg", "/overlays/habitat_3.jpg"];
const FADE_MS = 550;

export default function HabitatSnapshotCard() {
  const [shown, setShown] = useState(0);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [topOpacity, setTopOpacity] = useState(1);
  const rafRef = useRef<number | null>(null);

  function goTo(index: number) {
    if (index === shown) return;
    setOutgoing(shown);
    setShown(index);
    setTopOpacity(0);

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const step = (now: number) => {
      // Clamped low as well as high — see MapCanvas's own fade for why an
      // unclamped rAF timestamp can go negative here.
      const t = Math.min(1, Math.max(0, (now - start) / FADE_MS));
      setTopOpacity(smootherstep(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      rafRef.current = null;
      setOutgoing(null);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-[5] w-[132px] rounded-[10px] overflow-hidden shadow-[0px_10px_24px_-8px_rgba(0,0,0,0.45)] border border-white/40 bg-[#0e1a24]">
      <div className="relative w-full h-[76px]">
        {outgoing !== null && (
          <img
            src={HABITAT_FRAMES[outgoing]}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: underlayOpacity(1, topOpacity) }}
          />
        )}
        <img
          src={HABITAT_FRAMES[shown]}
          alt="Habitat reference capture"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: topOpacity }}
        />
      </div>
      <div className="flex items-center justify-center gap-[5px] py-[6px] bg-[rgba(10,10,10,0.5)]">
        {HABITAT_FRAMES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Habitat capture ${i + 1} of ${HABITAT_FRAMES.length}`}
            aria-pressed={i === shown}
            className="u-press w-[6px] h-[6px] rounded-full cursor-pointer transition-colors duration-150"
            style={{ background: i === shown ? "#FFFFFF" : "rgba(255,255,255,0.4)" }}
          />
        ))}
      </div>
    </div>
  );
}
