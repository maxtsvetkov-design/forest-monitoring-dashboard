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
  onDrillDown,
  drillDownLabel,
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
  /** When given, the whole card becomes a button that opens Assets filtered to
   * the trees behind this number — see App.tsx's drillIntoAssets. */
  onDrillDown?: () => void;
  /** What that drill-down lands on, for the card's title/aria text. Without
   * it a screen reader hears only the KPI label and no hint that activating
   * the card navigates anywhere. */
  drillDownLabel?: string;
}) {
  const Tag = onDrillDown ? "button" : "div";
  return (
    <div className="flex-1 min-w-[152px] animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="surface-card surface-card--interactive h-full group">
        {/* `w-full text-left` because a <button> is inline-block and
            centre-aligned by default — without them the card collapses to its
            content width and every label re-centres. */}
        <Tag
          type={onDrillDown ? "button" : undefined}
          onClick={onDrillDown}
          title={drillDownLabel}
          aria-label={drillDownLabel ? `${label} — ${drillDownLabel}` : undefined}
          className={`p-[14px] h-full w-full text-left ${
            onDrillDown ? "u-press cursor-pointer" : ""
          }`}
        >
          <p className="text-[12px] font-normal text-[#464650] leading-[16px] font-['Outfit',sans-serif] line-clamp-2 mb-1">
            {label}
          </p>
          <div className="flex items-center gap-[4px]">
            <p className="text-[20px] font-bold text-[#18181c] leading-[26px] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap">
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
            <p className="text-[12px] font-normal text-[#5b5b66] leading-[16px] font-['Outfit',sans-serif] whitespace-nowrap">
              {secondaryValue}
            </p>
          )}
          {change && trend && (
            <div className="flex items-center gap-[4px] mt-1">
              <TrendChip change={change} trend={trend} />
              {changeNote && (
                <span className="text-[10px] text-[#5b5b66] font-normal font-['Outfit',sans-serif]">{changeNote}</span>
              )}
            </div>
          )}
        </Tag>
      </div>
    </div>
  );
}
