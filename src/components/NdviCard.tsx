import { imgIcInfoCircle } from "../assets";
import TrendChip from "./TrendChip";

/**
 * NDVI (0–1) as a value plus a red -> yellow -> green scale with a marker at
 * the current reading — see aggregate.ts's ndviFor for how this dataset
 * derives the number (no spectral imagery backs it, so it's a stand-in, not
 * a measurement).
 */
export default function NdviCard({
  value,
  change,
  delay,
  onDrillDown,
}: {
  value: number;
  change?: { change: string; trend: "up" | "down" } | null;
  delay: number;
  /** Opens Assets filtered to the flagged trees dragging this reading down —
   * there is no per-tree NDVI to filter on directly (see App.tsx). */
  onDrillDown?: () => void;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      role={onDrillDown ? "button" : undefined}
      tabIndex={onDrillDown ? 0 : undefined}
      onClick={onDrillDown}
      onKeyDown={
        onDrillDown
          ? (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onDrillDown();
            }
          : undefined
      }
      title={onDrillDown ? "Show the flagged trees holding this reading down" : undefined}
      className={`flex-1 min-w-0 surface-card p-[14px] flex flex-col gap-[6px] animate-fade-in-up surface-card--interactive group ${
        onDrillDown ? "u-press cursor-pointer" : ""
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#18181c] leading-[22px] font-['Outfit',sans-serif]">NDVI</span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 opacity-50 group-hover:opacity-80" />
        </div>
        {change && (
          <TrendChip
            change={change.change}
            trend={change.trend}
            title="Change in NDVI vs. the prior period"
            className="shrink-0"
          />
        )}
      </div>
      <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif]">Normalized Difference Vegetation Index.</p>
      <div className="flex items-end gap-[6px]">
        <span className="text-[28px] font-bold text-[#18181c] leading-none font-['Outfit',sans-serif]">
          {value.toFixed(2)}
        </span>
        <span className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] mb-[2px]">/ 1.00</span>
      </div>
      <div
        className="relative h-[8px] rounded-full mt-1"
        style={{ background: "linear-gradient(90deg, #E5484D 0%, #F0B429 50%, #24A67A 100%)" }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-[14px] rounded-full bg-[#18181c]"
          style={{ left: `${pct}%`, boxShadow: "0 0 0 2px #ffffff" }}
        />
      </div>
    </div>
  );
}
