/**
 * Three plot-metadata facts — area, most recent survey, last activity — that
 * don't need their own separate KPI tiles the way Total trees or Canopy cover
 * do: none of them trend, compare against a prior period, or carry a change
 * chip. Stacked into one block instead, styled after a reference "big bold
 * number over a small label" stat list rather than three near-empty cards.
 */
export default function MetaStatsCard({
  items,
  delay,
}: {
  items: { label: string; value: string }[];
  delay: number;
}) {
  return (
    <div className="flex-1 min-w-fit animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      {/* items-start + a fixed gap, not justify-between: this card sits in
          a row stretched to match OverallHealthCard's much taller height, and
          spreading the stats evenly across all of that left them looking lost
          rather than compact. Grouped tight at the top instead, side by side,
          with the extra height just going unused below — same as any other
          KPI tile that doesn't fill its row's full height. */}
      <div className="surface-card surface-card--interactive h-full group flex items-start justify-start flex-wrap gap-x-[20px] gap-y-[10px] p-[14px]">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col">
            <span className="text-[20px] font-bold text-[#18181c] leading-[26px] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap">
              {item.value}
            </span>
            <span className="text-[11px] font-normal text-[#5b5b66] leading-[16px] font-['Outfit',sans-serif] whitespace-nowrap">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
