import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { imgIcDownload01, imgIcInfoCircle, imgIcLink2 } from "../assets";
import { useCountUp } from "../hooks/useCountUp";
import type { CategoryDatum } from "../data/types";
import ChartActionBtn from "./ChartActionBtn";

/**
 * The donut's own readout, sitting in the ring's empty centre — replaces
 * Recharts' default floating tooltip box entirely. Keyed by the caller on
 * whatever it's currently showing (a slice name, or "Total"), so switching
 * slices remounts this and replays its pop-in rather than the number just
 * jump-cutting to a new value with no sense that something changed.
 */
function DonutCenterStat({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: number;
  percent: number | null;
  color: string;
}) {
  const animatedValue = useCountUp(value, 500, 0);
  return (
    <div className="donut-center-pop flex flex-col items-center justify-center pointer-events-none px-2">
      <span
        className="text-[19px] font-bold font-['Inter',sans-serif] leading-none tabular-nums"
        style={{ color }}
      >
        {Math.round(animatedValue).toLocaleString()}
      </span>
      {percent !== null && (
        <span className="text-[10px] font-bold font-['Inter',sans-serif] mt-[1px]" style={{ color }}>
          {percent.toFixed(1)}%
        </span>
      )}
      <span className="text-[9px] text-[#9a9a9a] font-medium font-['Inter',sans-serif] mt-[2px] max-w-[76px] text-center leading-[11px] truncate">
        {label}
      </span>
    </div>
  );
}

export default function AnimatedDonutChart({
  data,
  title,
  delay,
  onSliceClick,
}: {
  data: CategoryDatum[];
  title: string;
  delay: number;
  /** When given, both the wedges and the legend rows become clickable, calling
   * back with that row's `name`. Used by the health chart to jump into Areas
   * pre-filtered to the clicked condition — see App.tsx. */
  onSliceClick?: (name: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay + 200);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className="flex-1 min-w-0 bg-[#f4f2f0] border border-[rgba(0,0,0,0.09)] rounded-[12px] p-[12px] flex flex-col gap-[6px] animate-fade-in-up shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)] hover:shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] transition-shadow duration-200 group"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between w-full shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#141414] leading-[22px] font-['Inter',sans-serif] truncate">
            {title}
          </span>
          <img src={imgIcInfoCircle} alt="info" className="w-4 h-4 opacity-50 group-hover:opacity-80 transition-opacity" />
        </div>
        <div className="flex gap-[2px]">
          <ChartActionBtn src={imgIcLink2} alt="link" />
          <ChartActionBtn src={imgIcDownload01} alt="download" />
        </div>
      </div>

      {/* Chart */}
      <div className="relative flex justify-center items-center w-full">
        <ResponsiveContainer width={154} height={154}>
          <PieChart>
            <Pie
              data={mounted ? data : data.map((d) => ({ ...d, value: 0 }))}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={72}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              isAnimationActive={true}
              animationBegin={0}
              animationDuration={900}
              animationEasing="ease-out"
              stroke="none"
              onMouseEnter={(_, i) => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={onSliceClick ? (_, i) => onSliceClick(data[i].name) : undefined}
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.color}
                  className="transition-[transform,opacity,filter] duration-300"
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    transform: hoveredIndex === i ? "scale(1.12)" : "scale(1)",
                    opacity: hoveredIndex !== null && hoveredIndex !== i ? 0.8 : 1,
                    filter: hoveredIndex === i ? "drop-shadow(0px 4px 8px rgba(0,0,0,0.25))" : "drop-shadow(0px 0px 0px rgba(0,0,0,0))",
                    transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
                    cursor: "pointer",
                  }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Sits in the ring's own empty centre rather than floating a separate
            tooltip box elsewhere on screen — hovering a wedge or a legend row
            changes the number in place, remounting (via `key`) to replay its
            pop-in each time so the change reads as an event, not a jump-cut. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <DonutCenterStat
            key={hoveredIndex !== null ? data[hoveredIndex].name : "__total__"}
            label={hoveredIndex !== null ? data[hoveredIndex].name : "Total"}
            value={hoveredIndex !== null ? data[hoveredIndex].value : total}
            percent={hoveredIndex !== null ? (data[hoveredIndex].value / total) * 100 : null}
            color={hoveredIndex !== null ? data[hoveredIndex].color : "#141414"}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-[4px] w-full">
        {data.map((d, i) => (
          <div
            key={d.name}
            role={onSliceClick ? "button" : undefined}
            tabIndex={onSliceClick ? 0 : undefined}
            onClick={onSliceClick ? () => onSliceClick(d.name) : undefined}
            onKeyDown={
              onSliceClick
                ? (e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSliceClick(d.name);
                  }
                : undefined
            }
            className={`u-press flex items-center gap-[4px] w-full group/item hover:bg-white/50 rounded px-1 py-0.5 ${
              onSliceClick ? "cursor-pointer" : ""
            }`}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex items-center gap-[6px] shrink-0">
              <div className="w-[11px] h-[11px] rounded-sm shrink-0" style={{ background: d.color }} />
              <span className="text-[12px] text-[#141414] font-normal font-['Inter',sans-serif] whitespace-nowrap">
                {d.name}
              </span>
            </div>
            <div className="flex-1 border-t border-dashed border-[#d4d0cd] mx-1" />
            <span className="text-[12px] text-[#141414] font-normal font-['Inter',sans-serif] shrink-0">
              {d.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
