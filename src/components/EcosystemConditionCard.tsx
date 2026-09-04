import { useEffect, useState } from "react";
import { imgIcInfoCircle } from "../assets";
import { useCountUp } from "../hooks/useCountUp";
import type { EcosystemCondition } from "../data/types";
import TrendChip from "./TrendChip";

// Mirrors aggregate.ts's CONDITION_TIERS — kept in sync manually since the
// tier bar needs every tier's label/color to render the full 5-segment scale,
// not just the one `condition` currently sits in.
const TIERS = [
  { label: "Critical", color: "#E5484D" },
  { label: "Poor", color: "#E55C2F" },
  { label: "Fair", color: "#F0B429" },
  { label: "Good", color: "#8FBF3F" },
  { label: "Excellent", color: "#24A67A" },
];

export default function EcosystemConditionCard({
  condition,
  delay,
}: {
  condition: EcosystemCondition;
  delay: number;
}) {
  const trend: "up" | "down" | null = condition.change === null ? null : condition.change < 0 ? "down" : "up";
  const changeText = condition.change === null ? null : `${condition.change > 0 ? "+" : ""}${condition.change.toFixed(1)}`;
  const animatedScore = useCountUp(condition.score, 900, delay + 150);

  // Segments pop in one by one, then the caret slides in to point at the
  // active tier once they've all settled — a gauge "spinning up" rather than
  // the scale and its reading appearing simultaneously.
  const [segmentsIn, setSegmentsIn] = useState(false);
  const [markerIn, setMarkerIn] = useState(false);
  useEffect(() => {
    const t1 = window.setTimeout(() => setSegmentsIn(true), delay + 150);
    const t2 = window.setTimeout(() => setMarkerIn(true), delay + 150 + TIERS.length * 70 + 250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [delay]);

  const markerLeftPct = ((condition.tierIndex + 0.5) / TIERS.length) * 100;

  return (
    <div
      className="flex-1 min-w-0 surface-card p-[14px] flex flex-col gap-[6px] animate-fade-in-up surface-card--interactive group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#18181c] leading-[22px] font-['Outfit',sans-serif]">
            Vegetation &amp; Ecosystem Condition
          </span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 opacity-50 group-hover:opacity-80" />
        </div>
        {trend && changeText && (
          <TrendChip
            change={changeText}
            trend={trend}
            title="Change in the blended condition score vs. the prior period"
            className="shrink-0"
          />
        )}
      </div>
      <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif]">
        Blended read on canopy greenness (NDVI) and tree-by-tree health.
      </p>
      <div className="flex items-end gap-[14px]">
        <span className="text-[20px] font-bold leading-none font-['Outfit',sans-serif]" style={{ color: condition.color }}>
          {condition.label}
        </span>
        <span className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] tabular-nums">
          {Math.round(animatedScore)} / 100
        </span>
      </div>

      {/* Tier scale + sliding caret */}
      <div className="relative mt-[14px]">
        <div
          className="absolute bottom-[calc(100%+2px)] flex flex-col items-center pointer-events-none transition-[left,opacity,transform] duration-500"
          style={{
            left: `${markerLeftPct}%`,
            opacity: markerIn ? 1 : 0,
            transform: `translateX(-50%) translateY(${markerIn ? "0" : "4px"})`,
            transitionTimingFunction: "cubic-bezier(0.22, 1.4, 0.36, 1)",
          }}
        >
          <span
            className="text-[9px] font-bold font-['Outfit',sans-serif] px-[6px] py-[1px] rounded-full text-white whitespace-nowrap"
            style={{ background: condition.color }}
          >
            {condition.label}
          </span>
          <svg width="8" height="5" viewBox="0 0 8 5" className="-mt-px">
            <path d="M0 0h8L4 5Z" fill={condition.color} />
          </svg>
        </div>

        <div className="flex gap-[3px]">
          {TIERS.map((t, i) => {
            const active = i === condition.tierIndex;
            return (
              <div
                key={t.label}
                className="relative flex-1 h-[8px] rounded-full"
                style={{
                  background: t.color,
                  opacity: segmentsIn ? (active ? 1 : 0.25) : 0,
                  transform: segmentsIn ? "scaleY(1)" : "scaleY(0.2)",
                  transformOrigin: "center",
                  transitionProperty: "opacity, transform, box-shadow",
                  transitionDuration: "450ms, 450ms, 300ms",
                  transitionTimingFunction: "cubic-bezier(0.22, 1.4, 0.36, 1)",
                  transitionDelay: `${i * 70}ms, ${i * 70}ms, 0ms`,
                  boxShadow: active && markerIn ? `0 0 0 3px ${t.color}33` : "none",
                }}
                title={t.label}
              />
            );
          })}
        </div>
      </div>
      <div className="flex justify-between mt-[1px]">
        <span className="text-[9px] text-[#71717a] font-['Outfit',sans-serif]">Critical</span>
        <span className="text-[9px] text-[#71717a] font-['Outfit',sans-serif]">Excellent</span>
      </div>
    </div>
  );
}
