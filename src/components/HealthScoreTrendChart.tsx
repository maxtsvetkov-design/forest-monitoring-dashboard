import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { imgIcDownload01, imgIcInfoCircle, imgIcLink2 } from "../assets";
import ChartActionBtn from "./ChartActionBtn";

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-[12px] px-3 py-2 text-[12px] font-['Outfit',sans-serif] shadow-md">
      <p className="font-medium text-[#18181c]">{label}</p>
      <p className="text-[#464650]">Health score: {payload[0].value.toFixed(1)}</p>
    </div>
  );
}

/**
 * Always plots the full 12-month timeline regardless of the selected date
 * range — "per month" is inherently a trend across the whole window, the
 * same way the range slider itself always shows all 12 months. See
 * aggregate.ts's healthScoreSeries.
 */
export default function HealthScoreTrendChart({
  data,
  delay,
}: {
  data: { label: string; score: number }[];
  delay: number;
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
            Average health score
          </span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 opacity-50 group-hover:opacity-80" />
        </div>
        <div className="flex gap-[2px]">
          <ChartActionBtn src={imgIcLink2} alt="link" />
          <ChartActionBtn src={imgIcDownload01} alt="download" />
        </div>
      </div>

      <div className="flex-1 min-h-[170px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={mounted ? data : []} margin={{ top: 4, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid stroke="#dedee3" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#5b5b66", fontFamily: "Inter, sans-serif" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#5b5b66", fontFamily: "Inter, sans-serif" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#24A67A"
              strokeWidth={2}
              dot={{ r: 3, fill: "#24A67A", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive
              animationDuration={800}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
