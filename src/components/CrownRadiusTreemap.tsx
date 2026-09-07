import { useMemo, useState } from "react";
import { imgIcInfoCircle } from "../assets";
import type { CrownBucketDatum } from "../data/types";
import TrendChip from "./TrendChip";

// A wide date range sums crown counts across many months, so raw tree counts
// per bucket can run into the thousands — one DOM node per tree at that scale
// is both wasteful and, since every bucket would then blow past a flat cap
// alike, indistinguishable from its neighbours. Instead the *largest* bucket
// is scaled down to roughly this many dots (enough to still read as a filled
// field at the 3px pitch below), and every bucket shares that same divisor —
// so a bucket with half the trees still visibly draws about half the dots.
const MAX_DOTS_IN_LARGEST_BUCKET = 700;

/** One tree, drawn as a small dot — the box's own count made countable rather
 * than just a percentage. `divisor` scales raw tree counts down to a dot
 * count that fits the box without one DOM node per tree at large ranges. */
function CrownDotField({ count, divisor }: { count: number; divisor: number }) {
  const dots = Math.max(1, Math.round(count / divisor));
  return (
    <div
      className="absolute inset-0 flex flex-wrap content-start gap-[3px] p-[14px] pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className="w-[3px] h-[3px] rounded-full bg-white/45 shrink-0" />
      ))}
    </div>
  );
}

export default function CrownRadiusTreemap({
  data,
  delay,
  trend,
  onSelectBucket,
}: {
  data: CrownBucketDatum[];
  delay: number;
  /** Clicking a band jumps to Assets filtered to that crown-radius bucket.
   * Receives the band's index, which maps 1:1 onto b1..b5. */
  onSelectBucket?: (bucketIndex: number) => void;
  /** Change in the share of trees in the two largest crown-radius buckets vs
   * the prior period — see aggregate.ts's crownMaturePct. Null with no prior
   * period to compare against (same convention as the KPI cards). */
  trend?: { change: string; trend: "up" | "down" } | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const dotDivisor = useMemo(() => {
    const maxCount = Math.max(1, ...data.map((d) => d.count));
    return Math.max(1, Math.round(maxCount / MAX_DOTS_IN_LARGEST_BUCKET));
  }, [data]);

  return (
    <div
      className="flex-1 min-w-0 surface-card p-[14px] flex flex-col gap-[10px] animate-fade-in-up surface-card--interactive group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#18181c] leading-[22px] font-['Outfit',sans-serif]">
            Tree count - by crown radius
          </span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 opacity-50 group-hover:opacity-80" />
        </div>
        {trend && (
          <TrendChip
            change={trend.change}
            trend={trend.trend}
            title="Change in trees with a large (0.6–1.2 m) crown radius vs. the prior period"
            className="shrink-0"
          />
        )}
      </div>

      {/* A single wrapping flow rather than a fixed 2-then-rest split: each
          box's basis is its own share of trees (min 15% so a sliver bucket
          still reads instead of collapsing to a hairline), so the browser
          packs as many boxes as actually fit a row — small buckets share a
          row three or four wide, a dominant bucket claims a row on its own. */}
      <div className="flex-1 flex flex-wrap content-start gap-[4px] min-h-[170px]">
        {data.map((d, i) => (
          <div
            key={d.label}
            role={onSelectBucket ? "button" : undefined}
            tabIndex={onSelectBucket ? 0 : undefined}
            aria-label={onSelectBucket ? `Show trees with crown radius ${d.label} m — ${d.pct}% of trees` : undefined}
            onClick={onSelectBucket ? () => onSelectBucket(i) : undefined}
            onKeyDown={
              onSelectBucket
                ? (e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelectBucket(i);
                  }
                : undefined
            }
            className="relative flex items-end p-3 rounded-[10px] cursor-pointer transition-all duration-200 overflow-hidden basis-[15%]"
            style={{
              flexGrow: d.pct,
              flexBasis: `${Math.max(d.pct, 15)}%`,
              minHeight: "78px",
              background: d.color,
              opacity: hovered && hovered !== d.label ? 0.75 : 1,
              transform: hovered === d.label ? "scale(1.01)" : "scale(1)",
            }}
            onMouseEnter={() => setHovered(d.label)}
            onMouseLeave={() => setHovered(null)}
          >
            <CrownDotField count={d.count} divisor={dotDivisor} />
            <div className="absolute top-3 left-3">
              <span className="text-white text-[12px] font-medium font-['Outfit',sans-serif]">{d.label}</span>
            </div>
            <span className="text-white text-[18px] font-bold font-['Outfit',sans-serif]">{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
