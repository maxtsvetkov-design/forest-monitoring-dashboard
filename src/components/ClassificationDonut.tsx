import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { imgFilterFunnel01, imgIcDownload01, imgIcInfoCircle, imgIcLink2 } from "../assets";
import type { CategoryDatum } from "../data/types";
import { useCountUp } from "../hooks/useCountUp";
import ChartActionBtn from "./ChartActionBtn";

/**
 * What sits in the ring's hollow centre.
 *
 * At rest it's the period delta — the mockup's "-22% / to last year". On
 * hover it becomes the hovered slice's own readout. Keyed by the caller so
 * each change remounts and replays the pop-in, making the swap read as an
 * event rather than a jump-cut, exactly as AnimatedDonutChart does.
 */
function DonutCentre({
  primary,
  secondary,
  color,
  countTo,
}: {
  primary: string;
  secondary: string;
  color: string;
  /** When given, `primary` is ignored and this number is counted up to. */
  countTo?: number;
}) {
  const animated = useCountUp(countTo ?? 0, 550, 0);
  return (
    <div className="donut-center-pop flex flex-col items-center justify-center pointer-events-none px-2 text-center">
      <span className="text-[15px] font-bold font-['Outfit',sans-serif] leading-none tabular-nums" style={{ color }}>
        {countTo === undefined ? primary : `${animated.toFixed(1)}%`}
      </span>
      <span className="text-[10px] text-[#6b6b6b] font-['Outfit',sans-serif] mt-[3px] leading-[13px] max-w-[84px] truncate">
        {secondary}
      </span>
    </div>
  );
}

/**
 * The two classification donuts on the dashboard's analytics row (Figma nodes
 * 271:24341 and 271:24344) — "Flora classification" and "Land cover
 * classification".
 *
 * Distinct from `AnimatedDonutChart` (Insights tab) rather than a variant of
 * it: this one puts its legend beside the ring instead of under it, shows a
 * percentage split rather than raw counts, and carries the mockup's
 * three-button action cluster. Sharing one component across both would mean a
 * prop for every one of those differences.
 */
export default function ClassificationDonut({
  title,
  data,
  delay,
  changePct,
  onSliceClick,
}: {
  title: string;
  data: CategoryDatum[];
  delay: number;
  /** Period move shown in the ring's centre at rest. Null hides the chip and
   * shows the total instead. */
  changePct: number | null;
  onSliceClick?: (name: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay + 200);
    return () => clearTimeout(t);
  }, [delay]);

  const hoveredDatum = hovered !== null ? data[hovered] : null;
  const trendColor = changePct !== null && changePct < 0 ? "#E5484D" : "#24A67A";

  return (
    <div
      className="flex-1 min-w-[212px] surface-card p-[14px] flex flex-col gap-[10px] animate-fade-in-up surface-card--interactive group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-[8px] shrink-0">
        <div className="flex items-start gap-[6px] min-w-0 flex-1">
          <span className="text-[14px] font-bold text-[#141414] leading-[19px] font-['Outfit',sans-serif] line-clamp-3 min-h-[38px] flex-1 min-w-0">
            {title}
          </span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 shrink-0 opacity-50 group-hover:opacity-80" />
        </div>
        <div className="flex gap-[2px] shrink-0">
          <ChartActionBtn src={imgFilterFunnel01} alt="filter" />
          <ChartActionBtn src={imgIcLink2} alt="link" />
          <ChartActionBtn src={imgIcDownload01} alt="download" />
        </div>
      </div>

      <div className="flex-1 flex items-center gap-[10px] min-h-0">
        {/* Ring */}
        <div className="relative shrink-0 w-[132px] h-[132px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={mounted ? data : data.map((d) => ({ ...d, value: 0 }))}
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={62}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                paddingAngle={1.5}
                isAnimationActive
                animationBegin={0}
                animationDuration={900}
                animationEasing="ease-out"
                stroke="none"
                onMouseEnter={(_, i) => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={onSliceClick ? (_, i) => onSliceClick(data[i].name) : undefined}
              >
                {data.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color}
                    className="transition-[transform,opacity,filter] duration-300"
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      transform: hovered === i ? "scale(1.09)" : "scale(1)",
                      opacity: hovered !== null && hovered !== i ? 0.75 : 1,
                      filter: hovered === i ? "drop-shadow(0px 4px 8px rgba(0,0,0,0.22))" : "none",
                      transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
                      cursor: onSliceClick ? "pointer" : "default",
                    }}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {hoveredDatum ? (
              <DonutCentre
                key={hoveredDatum.name}
                primary=""
                secondary={hoveredDatum.name}
                color={hoveredDatum.color}
                countTo={total > 0 ? (hoveredDatum.value / total) * 100 : 0}
              />
            ) : (
              <DonutCentre
                key="__rest__"
                primary={changePct === null ? total.toLocaleString() : `${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%`}
                secondary={changePct === null ? "total" : "to last period"}
                color={changePct === null ? "#141414" : trendColor}
              />
            )}
          </div>
        </div>

        {/* Legend — hovering a row drives the same highlight as hovering its
            wedge, so the two halves of the widget are one control. */}
        <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
          {data.map((d, i) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0;
            return (
              <button
                key={d.name}
                type="button"
                disabled={!onSliceClick}
                onClick={onSliceClick ? () => onSliceClick(d.name) : undefined}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                className={`u-press flex items-center gap-[7px] min-w-0 w-full rounded-[6px] px-[4px] py-[2px] text-left transition-[background-color,opacity] duration-(--dur-2) ease-out hover:bg-white/50 ${
                  onSliceClick ? "cursor-pointer" : "cursor-default"
                } ${hovered !== null && hovered !== i ? "opacity-55" : "opacity-100"}`}
              >
                <span
                  className="w-[11px] h-[11px] rounded-[3px] shrink-0 transition-transform duration-(--dur-2) ease-(--ease-lux)"
                  style={{ background: d.color, transform: hovered === i ? "scale(1.2)" : "scale(1)" }}
                />
                <span className="text-[12px] text-[#141414] font-['Outfit',sans-serif] truncate flex-1 min-w-0">
                  {d.name}
                </span>
                <span className="text-[11px] text-[#6b6b6b] font-['Outfit',sans-serif] tabular-nums shrink-0">
                  {pct.toFixed(0)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
