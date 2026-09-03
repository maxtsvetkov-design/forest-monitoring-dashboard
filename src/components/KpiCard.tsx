import { imgIcInfoCircle } from "../assets";
import TrendChip from "./TrendChip";

export default function KpiCard({
  label,
  value,
  secondaryValue,
  change,
  changeNote,
  trend,
  hasInfo,
  delay,
}: {
  label: string;
  value: string;
  /** A second figure shown under the main value, unconditionally — for a card
   * like "trees vs. ground" where there's no meaningful single number, only a
   * pair. Distinct from `changeNote`, which only renders alongside a trend. */
  secondaryValue?: string;
  change?: string | null;
  changeNote?: string;
  trend?: "up" | "down";
  hasInfo?: boolean;
  delay: number;
}) {
  return (
    <div className="flex-1 min-w-0 animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="u-lift bg-[#fafafa] border border-white rounded-[12px] h-full shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04),0px_5.124px_5.915px_0px_rgba(0,0,0,0.01)] group">
        <div className="border border-[#d9d9d9] rounded-[12px] pt-[12px] pb-[8px] px-[12px] h-full">
          <p className="text-[12px] font-normal text-[#363636] leading-[18px] font-['Inter',sans-serif] truncate mb-1">
            {label}
          </p>
          <div className="flex items-center gap-[4px]">
            <p className="text-[16px] font-medium text-[#141414] leading-[24px] font-['Inter',sans-serif] whitespace-nowrap">
              {value}
            </p>
            {hasInfo && (
              <img
                src={imgIcInfoCircle}
                alt="info"
                className="u-icon w-4 h-4 opacity-60 group-hover:opacity-100"
              />
            )}
          </div>
          {secondaryValue && (
            <p className="text-[12px] font-normal text-[#6b6b6b] leading-[16px] font-['Inter',sans-serif] whitespace-nowrap">
              {secondaryValue}
            </p>
          )}
          {change && trend && (
            <div className="flex items-center gap-[4px] mt-1">
              <TrendChip change={change} trend={trend} />
              {changeNote && (
                <span className="text-[10px] text-[#6b6b6b] font-normal font-['Inter',sans-serif]">{changeNote}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
