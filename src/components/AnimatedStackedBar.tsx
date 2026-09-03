import { useEffect, useState } from "react";
import { useCountUp } from "../hooks/useCountUp";

export interface StackedBarDatum {
  name: string;
  value: number;
  color: string;
}

/**
 * A horizontal stacked bar built for a punchy first impression: segments grow
 * in from zero width (staggered, spring-eased) rather than snapping straight
 * to their final size, a one-shot light sweep crosses the bar once it settles,
 * and hovering a segment (or its legend row — the two are linked) pops it out
 * with a floating value/percent label while the rest dim back. Replaces the
 * old flat, static `<div style={{width}}>` bar in TreeSurveyCard.
 */
export default function AnimatedStackedBar({
  data,
  delay = 0,
  height = 10,
  showLegend = true,
}: {
  data: StackedBarDatum[];
  delay?: number;
  height?: number;
  showLegend?: boolean;
}) {
  const [grown, setGrown] = useState(false);
  const [shimmered, setShimmered] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const GROW_MS = 750;

  useEffect(() => {
    const growTimer = window.setTimeout(() => setGrown(true), delay + 150);
    const shimmerTimer = window.setTimeout(() => setShimmered(true), delay + 150 + GROW_MS + 120);
    return () => {
      window.clearTimeout(growTimer);
      window.clearTimeout(shimmerTimer);
    };
  }, [delay]);

  return (
    <div className="flex flex-col gap-[8px]">
      <div
        className="relative flex w-full rounded-full bg-[#f0eeec] overflow-hidden"
        style={{ height }}
      >
        {data.map((d, i) => {
          const pct = (d.value / total) * 100;
          const isHovered = hovered === i;
          const isDimmed = hovered !== null && !isHovered;
          return (
            <div
              key={d.name}
              className="relative h-full first:rounded-l-full last:rounded-r-full cursor-pointer"
              style={{
                width: grown ? `${pct}%` : "0%",
                background: d.color,
                opacity: isDimmed ? 0.45 : 1,
                transitionProperty: "width, opacity, filter",
                transitionDuration: `${GROW_MS}ms, 200ms, 200ms`,
                transitionTimingFunction: "cubic-bezier(0.22, 1.4, 0.36, 1), ease-out, ease-out",
                transitionDelay: `${i * 90}ms, 0ms, 0ms`,
                filter: isHovered ? "brightness(1.12)" : "brightness(1)",
                boxShadow: isHovered ? `0 0 0 2px white, 0 2px 8px -1px ${d.color}99` : "none",
                zIndex: isHovered ? 2 : 1,
              }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
            >
              {/* One-shot light sweep, per segment so it visibly crosses each
                  color in sequence rather than one flat pass over the whole bar. */}
              {shimmered && (
                <div
                  className="absolute inset-0 pointer-events-none animate-bar-shimmer"
                  style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)" }}
                />
              )}

              {isHovered && (
                <div className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-10 pointer-events-none animate-fade-in">
                  <div className="bg-[#141414] text-white rounded-[6px] px-[8px] py-[4px] whitespace-nowrap shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.3)]">
                    <span className="text-[11px] font-bold font-['Inter',sans-serif]">{d.name}</span>
                    <span className="text-[11px] font-['Inter',sans-serif] text-white/70 ml-[6px]">
                      {d.value.toLocaleString()} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-[6px] h-[6px] bg-[#141414] rotate-45 mx-auto -mt-[3px]" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showLegend && (
        <div className="flex items-center gap-[12px] flex-wrap">
          {data.map((d, i) => (
            <LegendRow
              key={d.name}
              datum={d}
              index={i}
              total={total}
              delay={delay + 150 + GROW_MS + i * 60}
              hovered={hovered === i}
              onHover={(v) => setHovered(v ? i : null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LegendRow({
  datum,
  total,
  delay,
  hovered,
  onHover,
}: {
  datum: StackedBarDatum;
  index: number;
  total: number;
  delay: number;
  hovered: boolean;
  onHover: (v: boolean) => void;
}) {
  const animatedValue = useCountUp(datum.value, 600, delay);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);

  return (
    <div
      className="flex items-center gap-[4px] transition-all duration-300"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(4px)",
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span
        className="w-[6px] h-[6px] rounded-full shrink-0 transition-transform duration-200"
        style={{ background: datum.color, transform: hovered ? "scale(1.6)" : "scale(1)" }}
      />
      <span
        className={`text-[10px] font-['Inter',sans-serif] transition-colors duration-200 ${
          hovered ? "text-[#141414] font-bold" : "text-[#6b6b6b]"
        }`}
      >
        {datum.name} · {Math.round(animatedValue).toLocaleString()} ({((datum.value / total) * 100).toFixed(0)}%)
      </span>
    </div>
  );
}
