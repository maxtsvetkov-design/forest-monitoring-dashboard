import { imgIcInfoCircle } from "../assets";
import { useCountUp } from "../hooks/useCountUp";

/**
 * The dashboard's single headline number — same source as EcosystemConditionCard
 * (aggregate.ts's ecosystemConditionFor), just given the prominent treatment.
 *
 * Styled after an editorial reference: a pale cream ground, one very heavy
 * near-black numeral set tight, quiet grey supporting copy, and a single solid
 * accent block carrying the only colour on the card. The state is what that
 * block says — orange below the threshold, green above — rather than the whole
 * card changing colour, so a struggling plot reads as "one flag on a calm
 * card" instead of a differently-themed card entirely. The landing screen's
 * banner uses the same three ingredients, so the two agree on sight.
 *
 * 75 is deliberately the same cutoff EcosystemConditionCard's tier bar treats
 * as "Good" or better, and the same one LandingScreen splits on.
 */
const HEALTHY_THRESHOLD = 75;

export default function OverallHealthCard({
  score,
  change,
  delay,
}: {
  score: number;
  change: number | null;
  delay: number;
}) {
  const animatedScore = useCountUp(score, 900, delay + 150);
  const trend: "up" | "down" | null = change === null ? null : change < 0 ? "down" : "up";
  const changeText = change === null ? null : `${change > 0 ? "+" : ""}${change.toFixed(0)}`;

  const healthy = score >= HEALTHY_THRESHOLD;
  const accent = healthy ? "#9ee6bd" : "#f79256";

  return (
    <div className="flex-1 min-w-0 animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="h-full rounded-[16px] border border-[#e2e4d9] bg-[#f2f4ec] p-[14px] flex flex-col">
        <span className="text-[12px] leading-[18px] font-medium text-[#5b5b66] font-['Outfit',sans-serif]">
          Total site health score
        </span>

        {/* The one heavy element on the card. Near-black in both states —
            the accent block below is what carries the colour. */}
        <div className="flex items-start gap-[3px] mt-[6px]">
          <span className="font-['Outfit',sans-serif] font-extrabold text-[44px] leading-[44px] tracking-[-0.03em] text-[#18181c] tabular-nums">
            {Math.round(animatedScore)}%
          </span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 opacity-40 hover:opacity-70 mt-[3px]" />
        </div>

        <span className="text-[11px] leading-[16px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[4px]">
          Overall performance
        </span>

        {trend && changeText && (
          <div
            className="mt-auto flex items-center gap-[6px] self-start px-[9px] py-[5px] rounded-[6px]"
            style={{ background: accent }}
            title="Change in the blended condition score vs. the prior period"
          >
            {trend === "up" ? (
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 16 16">
                <path d="M2 11l4-4 3 3 5-6" stroke="#18181c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 16 16">
                <path d="M2 5l4 4 3-3 5 6" stroke="#18181c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span className="text-[11px] font-semibold leading-[14px] text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
              {changeText} since last survey
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
