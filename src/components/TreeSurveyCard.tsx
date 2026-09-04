import { imgIcInfoCircle } from "../assets";
import { useCountUp } from "../hooks/useCountUp";
import type { CategoryDatum } from "../data/types";
import AnimatedStackedBar from "./AnimatedStackedBar";
import TrendChip from "./TrendChip";

/**
 * The same "trees logged this period" figure the Total trees KPI card shows,
 * given its own widget — matching the Figma reference's "Tree Survey"
 * section — with a health-mix bar underneath so it reads as more than a
 * repeated number.
 */
export default function TreeSurveyCard({
  totalSurveyed,
  change,
  healthData,
  delay,
}: {
  totalSurveyed: number;
  change?: { change: string; trend: "up" | "down" } | null;
  healthData: CategoryDatum[];
  delay: number;
}) {
  const animatedTotal = useCountUp(totalSurveyed, 1000, delay + 150);
  return (
    <div
      className="flex-1 min-w-0 surface-card p-[14px] flex flex-col gap-[6px] animate-fade-in-up surface-card--interactive group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#18181c] leading-[22px] font-['Outfit',sans-serif]">
            Tree Survey
          </span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 opacity-50 group-hover:opacity-80" />
        </div>
        {change && (
          <TrendChip
            change={change.change}
            trend={change.trend}
            title="Change in trees surveyed vs. the prior period"
            className="shrink-0"
          />
        )}
      </div>
      <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif]">Individual trees surveyed across the site.</p>
      <span className="text-[28px] font-bold text-[#18181c] leading-none font-['Outfit',sans-serif] tabular-nums">
        {Math.round(animatedTotal).toLocaleString()}
      </span>
      <div className="mt-1">
        <AnimatedStackedBar data={healthData} delay={delay + 300} height={10} />
      </div>
    </div>
  );
}
