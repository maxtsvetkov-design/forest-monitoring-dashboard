import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { imgIcDownload01, imgIcInfoCircle, imgIcLink2 } from "../assets";
import ChartActionBtn from "./ChartActionBtn";

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-[8px] px-3 py-2 text-[12px] font-['Inter',sans-serif] shadow-md">
      <p className="font-medium text-[#141414]">{label}</p>
      <p className="text-[#363636]">Health score: {payload[0].value.toFixed(1)}</p>
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
      className="flex-1 min-w-0 bg-white border border-[rgba(0,0,0,0.06)] rounded-[12px] p-[12px] flex flex-col gap-[10px] animate-fade-in-up shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)] hover:shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] transition-shadow duration-200 group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#141414] leading-[22px] font-['Inter',sans-serif]">
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
            <CartesianGrid stroke="#f0eeec" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#6b6b6b", fontFamily: "Inter, sans-serif" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#6b6b6b", fontFamily: "Inter, sans-serif" }}
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
