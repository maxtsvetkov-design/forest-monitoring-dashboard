// Shared "change vs. prior period" pill — one visual identity for every
// widget that compares the selected range against the one before it (KPI
// cards, the crown-radius treemap, and anywhere else this pattern shows up),
// rather than each widget hand-rolling its own near-identical badge.
const TREND_COLOR: Record<"up" | "down", string> = {
  up: "#24A67A",
  down: "#E5484D",
};

export default function TrendChip({
  change,
  trend,
  title,
  className = "",
}: {
  /** Pre-formatted delta text, e.g. "+12" or "-3.4pp" — callers own the sign
   * and unit, this component only owns the shape and color. */
  change: string;
  trend: "up" | "down";
  /** Tooltip explaining what's being compared, e.g. "vs. the prior period". */
  title?: string;
  /** Extra classes appended after the base pill — e.g. `shrink-0` inside a
   * header row that also has to fit a truncating label. */
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center h-[24px] px-[7px] py-[2px] rounded-full text-[12px] font-medium leading-[18px] font-['Outfit',sans-serif] transition-colors duration-200 ${className}`}
      style={{
        background: `${TREND_COLOR[trend]}14`,
        border: `1px solid ${TREND_COLOR[trend]}33`,
        color: TREND_COLOR[trend],
      }}
      title={title}
    >
      {trend === "up" ? (
        <svg className="w-3 h-3 mr-1 shrink-0" fill="none" viewBox="0 0 16 16">
          <path d="M2 11l4-4 3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="w-3 h-3 mr-1 shrink-0" fill="none" viewBox="0 0 16 16">
          <path d="M2 5l4 4 3-3 5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {change}
    </span>
  );
}
