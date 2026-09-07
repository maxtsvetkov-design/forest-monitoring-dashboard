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
        className="text-[19px] font-bold font-['Outfit',sans-serif] leading-none tabular-nums"
        style={{ color }}
      >
        {Math.round(animatedValue).toLocaleString()}
      </span>
      {percent !== null && (
        <span className="text-[10px] font-bold font-['Outfit',sans-serif] mt-[1px]" style={{ color }}>
          {percent.toFixed(1)}%
        </span>
      )}
      <span className="text-[9px] text-[#71717a] font-medium font-['Outfit',sans-serif] mt-[2px] max-w-[76px] text-center leading-[11px] truncate">
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
  legendColumns = 1,
}: {
  data: CategoryDatum[];
  title: string;
  delay: number;
  /** When given, both the wedges and the legend rows become clickable, calling
   * back with that row's `name`. Used by the health chart to jump into Areas
   * pre-filtered to the clicked condition — see App.tsx. */
  onSliceClick?: (name: string) => void;
  /** 1 (default) stacks the legend as a single list; 2 wraps it into a
   * two-column grid instead — for the species legend, which at 11 rows runs
   * noticeably taller than every other donut on the row otherwise. */
  legendColumns?: 1 | 2;
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
      className="flex-1 min-w-[212px] surface-card p-[14px] flex flex-col gap-[6px] animate-fade-in-up surface-card--interactive group"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between w-full shrink-0 gap-[8px]">
        {/* items-start, not items-center: once the title can wrap, centring
            would float the info icon against the middle of a two-line block. */}
        {/* flex-1 so the title claims the row's free width. Without it the
            wrapped title shrinks to its own content, the four cards in this
            row redistribute, and the longest title ends up in the narrowest
            card — the exact opposite of what it needs. */}
        <div className="flex items-start gap-[6px] min-w-0 flex-1">
          <span className="text-[14px] font-bold text-[#18181c] leading-[19px] font-['Outfit',sans-serif] line-clamp-3 min-h-[38px] flex-1 min-w-0">
            {title}
          </span>
          <img src={imgIcInfoCircle} alt="info" className="w-4 h-4 mt-[2px] shrink-0 opacity-50 group-hover:opacity-80 transition-opacity" />
        </div>
        <div className="flex gap-[2px] shrink-0">
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
            color={hoveredIndex !== null ? data[hoveredIndex].color : "#18181c"}
          />
        </div>
      </div>

      {/* Legend */}
      <div
        className={`w-full ${legendColumns === 2 ? "grid grid-cols-2 gap-x-[8px] gap-y-[4px]" : "flex flex-col gap-[4px]"}`}
      >
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
            className={`u-press flex items-center gap-[4px] min-w-0 w-full group/item hover:bg-white/50 rounded px-1 py-0.5 ${
              onSliceClick ? "cursor-pointer" : ""
            }`}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex items-center gap-[6px] shrink-0">
              <div className="w-[11px] h-[11px] rounded-sm shrink-0" style={{ background: d.color }} />
              <span className="text-[12px] text-[#18181c] font-normal font-['Outfit',sans-serif] whitespace-nowrap">
                {d.name}
              </span>
            </div>
            <div className="flex-1 border-t border-dashed border-[#d4d0cd] mx-1" />
            <span className="text-[12px] text-[#18181c] font-normal font-['Outfit',sans-serif] shrink-0">
              {d.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
