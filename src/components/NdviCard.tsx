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
}: {
  value: number;
  change?: { change: string; trend: "up" | "down" } | null;
  delay: number;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className="flex-1 min-w-0 bg-white border border-[rgba(0,0,0,0.06)] rounded-[12px] p-[12px] flex flex-col gap-[6px] animate-fade-in-up shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)] hover:shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] transition-shadow duration-200 group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#141414] leading-[22px] font-['Inter',sans-serif]">NDVI</span>
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
      <p className="text-[11px] text-[#6b6b6b] font-['Inter',sans-serif]">Normalized Difference Vegetation Index.</p>
      <div className="flex items-end gap-[6px]">
        <span className="text-[28px] font-bold text-[#141414] leading-none font-['Inter',sans-serif]">
          {value.toFixed(2)}
        </span>
        <span className="text-[12px] text-[#6b6b6b] font-['Inter',sans-serif] mb-[2px]">/ 1.00</span>
      </div>
      <div
        className="relative h-[8px] rounded-full mt-1"
        style={{ background: "linear-gradient(90deg, #E5484D 0%, #F0B429 50%, #24A67A 100%)" }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-[14px] rounded-full bg-[#141414]"
          style={{ left: `${pct}%`, boxShadow: "0 0 0 2px #ffffff" }}
        />
      </div>
    </div>
  );
}
