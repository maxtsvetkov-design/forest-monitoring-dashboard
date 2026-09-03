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
      className="flex-1 min-w-0 bg-white border border-[rgba(0,0,0,0.06)] rounded-[12px] p-[12px] flex flex-col gap-[6px] animate-fade-in-up shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)] hover:shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] transition-shadow duration-200 group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#141414] leading-[22px] font-['Inter',sans-serif]">
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
      <p className="text-[11px] text-[#6b6b6b] font-['Inter',sans-serif]">Individual trees surveyed across the site.</p>
      <span className="text-[28px] font-bold text-[#141414] leading-none font-['Inter',sans-serif] tabular-nums">
        {Math.round(animatedTotal).toLocaleString()}
      </span>
      <div className="mt-1">
        <AnimatedStackedBar data={healthData} delay={delay + 300} height={10} />
      </div>
    </div>
  );
}
