import { imgIcInfoCircle } from "../assets";
import { formatKpi, type DashboardKpi } from "../data/dashboard";
import { useCountUp } from "../hooks/useCountUp";

/**
 * One cell of the dashboard's KPI row (Figma node 271:24328).
 *
 * Two visual states, matching the mockup: the quiet default, and the pale-red
 * "alert" treatment its fourth card shows. Which one a card gets is decided by
 * `kpiStatus` in data/dashboard.ts, not asserted here — a card that hardcoded
 * its own alarm would keep shouting after the number recovered.
 */
export default function DashboardKpiCard({
  kpi,
  delay,
  onDrillDown,
}: {
  kpi: DashboardKpi;
  delay: number;
  /** Jumps to the Areas tab filtered to the trees this number counts. Absent
   * for metrics with no per-tree equivalent — the card then stays inert
   * rather than offering a drill-down that lands nowhere. */
  onDrillDown?: () => void;
}) {
  // Counts up to the raw value, then formats — so a percentage ticks through
  // "0.0% → 74.2%" rather than counting integers and appending a unit.
  const animated = useCountUp(kpi.value, 900, delay + 120);
  const alert = kpi.status === "alert";
  const interactive = Boolean(onDrillDown);

  const trendDown = kpi.changePct !== null && kpi.changePct < 0;
  const trendColor = trendDown ? "#E5484D" : "#24A67A";

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onDrillDown}
      title={kpi.hint}
      aria-label={interactive ? `${kpi.label}: ${formatKpi(kpi.value, kpi.format)}. Show these trees in Areas` : undefined}
      className={`kpi-tile group animate-fade-in-up flex-1 min-w-[190px] text-left flex flex-col gap-[6px] px-[14px] py-[12px] rounded-[12px] border transition-[transform,box-shadow,background-color,border-color] duration-(--dur-3) ease-(--ease-lux) ${
        alert
          ? "bg-[#fbe3dd] border-[rgba(216,48,32,0.28)]"
          : "bg-[rgba(255,255,255,0.5)] border-[rgba(16,16,24,0.08)]"
      } ${interactive ? "cursor-pointer" : "cursor-default"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-[6px] min-w-0">
        <span
          className={`text-[12px] font-medium font-['Outfit',sans-serif] leading-[18px] truncate ${
            alert ? "text-[#a82b1e]" : "text-[#363636]"
          }`}
        >
          {kpi.label}
        </span>
      </div>

      <div className="flex items-baseline gap-[6px] min-w-0">
        <span
          className={`text-[24px] font-bold font-['Outfit',sans-serif] leading-[30px] tabular-nums truncate ${
            alert ? "text-[#d83020]" : "text-[#141414]"
          }`}
        >
          {formatKpi(animated, kpi.format)}
        </span>
        <img
          src={imgIcInfoCircle}
          alt=""
          className="w-4 h-4 shrink-0 opacity-40 group-hover:opacity-75 transition-opacity duration-(--dur-2)"
        />
      </div>

      <div className="flex items-center gap-[6px] min-w-0">
        {kpi.changePct === null ? (
          <span className="text-[11px] text-[#8a8a94] font-['Outfit',sans-serif]">no prior period</span>
        ) : (
          <>
            <span
              className="inline-flex items-center h-[22px] px-[6px] rounded-full text-[11px] font-medium font-['Outfit',sans-serif] leading-[18px] tabular-nums"
              style={{
                background: `${trendColor}14`,
                border: `1px solid ${trendColor}33`,
                color: trendColor,
              }}
            >
              <svg className="w-3 h-3 mr-[3px] shrink-0" fill="none" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d={trendDown ? "M2 5l4 4 3-3 5 6" : "M2 11l4-4 3 3 5-6"}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {kpi.changePct > 0 ? "+" : ""}
              {kpi.changePct.toFixed(0)}%
            </span>
            <span className="text-[11px] text-[#6b6b6b] font-['Outfit',sans-serif]">QoQ</span>
          </>
        )}
      </div>
    </button>
  );
}
