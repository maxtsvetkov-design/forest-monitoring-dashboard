import { useEffect, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { imgIcDownload01, imgIcInfoCircle, imgIcLink2 } from "../assets";
import { scatterCategories } from "../data/scatterLayout";
import type { ScatterSeries } from "../data/types";
import ChartActionBtn from "./ChartActionBtn";

const CustomScatterTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { species: string; category: string; z: number } }[];
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white rounded-[12px] px-3 py-2 text-[12px] font-['Outfit',sans-serif] shadow-md">
      <p className="font-medium text-[#18181c]">{d.species}</p>
      <p className="text-[#464650]">{d.category}</p>
      <p className="text-[#5b5b66]">Count: {d.z}</p>
    </div>
  );
};

export default function HealthPerSpeciesChart({
  series,
  delay,
  zMax,
}: {
  series: ScatterSeries[];
  delay: number;
  /** Fixed bubble-size ceiling from the full dataset — see aggregate.ts's
   * maxScatterCount. Without an explicit domain, Recharts auto-scales bubble
   * size relative to whatever's currently passed in, which made narrowing the
   * date range barely change how the chart looked even though the underlying
   * counts shrank a lot — every render just re-normalized to its own min/max. */
  zMax: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay + 300);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className="flex-1 min-w-0 surface-card p-[14px] flex flex-col gap-[10px] animate-fade-in-up surface-card--interactive group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#18181c] leading-[22px] font-['Outfit',sans-serif]">
            Health per species
          </span>
          <img src={imgIcInfoCircle} alt="info" className="w-4 h-4 opacity-50 group-hover:opacity-80 transition-opacity" />
        </div>
        <div className="flex gap-[2px]">
          <ChartActionBtn src={imgIcLink2} alt="link" />
          <ChartActionBtn src={imgIcDownload01} alt="download" />
        </div>
      </div>

      <div className="flex-1 min-h-[170px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 4, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid stroke="#dedee3" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0.5, 4.5]}
              ticks={[1, 2, 3, 4]}
              tickFormatter={(v) => {
                const cat = scatterCategories[v - 1];
                return cat ? cat[0].toUpperCase() + cat.slice(1) : "";
              }}
              tick={{ fontSize: 11, fill: "#5b5b66", fontFamily: "Inter, sans-serif" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis type="number" dataKey="y" hide domain={[0.5, 3.5]} />
            <ZAxis type="number" dataKey="z" domain={[0, zMax]} range={[8, 500]} />
            <Tooltip content={<CustomScatterTooltip />} />
            {series.map((s) => (
              <Scatter
                key={s.name}
                data={mounted ? s.data : []}
                fill={s.color}
                fillOpacity={0.75}
                isAnimationActive={true}
                animationBegin={0}
                animationDuration={800}
                animationEasing="ease-out"
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-[12px] flex-wrap">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-[5px]">
            <div className="w-[10px] h-[10px] rounded-full" style={{ background: s.color }} />
            <span className="text-[11px] text-[#464650] font-['Outfit',sans-serif]">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
