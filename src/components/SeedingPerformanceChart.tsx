import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { imgIcDownload01, imgIcInfoCircle, imgIcLink2 } from "../assets";
import type { PerfChartData } from "../data/dashboard";
import ChartActionBtn from "./ChartActionBtn";
import TrendChip from "./TrendChip";

/**
 * Normalises one series onto 0–100 using its OWN min/max.
 *
 * The four series share an axis but not a unit — a density in trees/ha sits
 * in the hundreds while three percentages sit under 100, so plotting raw
 * values would press three lines flat against the floor and make the chart
 * about the density alone. Indexing each to its own range restores what the
 * mockup is actually comparing: the SHAPE of four trends over the same
 * months. Real values survive in the tooltip, which is where a reader goes
 * when they want the number rather than the direction.
 *
 * A flat series (min === max) has no range to normalise into; it sits at the
 * midline rather than dividing by zero.
 */
function normalise(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return values.map(() => 50);
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

interface TooltipRow {
  key: string;
  name: string;
  color: string;
  raw: number;
  unit: string;
}

function PerfTooltip({
  active,
  label,
  rowsByLabel,
}: {
  active?: boolean;
  label?: string;
  rowsByLabel: Map<string, TooltipRow[]>;
}) {
  if (!active || !label) return null;
  const rows = rowsByLabel.get(label);
  if (!rows?.length) return null;
  return (
    <div className="perf-tooltip bg-white rounded-[12px] px-3 py-2 shadow-[0px_8px_24px_-6px_rgba(0,0,0,0.18)] border border-[rgba(0,0,0,0.06)] font-['Outfit',sans-serif]">
      <p className="text-[12px] font-semibold text-[#141414] mb-[6px]">{label}</p>
      <div className="flex flex-col gap-[3px]">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-[8px] text-[11px] whitespace-nowrap">
            <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: r.color }} />
            <span className="text-[#6b6b6b] flex-1">{r.name}</span>
            <span className="text-[#141414] font-medium tabular-nums">
              {r.unit === "/ha" ? Math.round(r.raw).toLocaleString() : r.raw.toFixed(1)}
              {r.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "Seeding performance" (Figma node 271:24339) — four trends over the selected
 * months, on one shared, deliberately unlabelled axis.
 *
 * Interactive in three ways the mockup implies but can't show: the legend
 * toggles a series in and out, hovering draws a crosshair and reports every
 * visible series' real value at that month, and each line draws itself in on
 * mount, staggered so they arrive as a sequence rather than a single flash.
 */
export default function SeedingPerformanceChart({ data, delay }: { data: PerfChartData; delay: number }) {
  const [mounted, setMounted] = useState(false);
  // Every series starts visible; clicking a legend row removes it from the
  // plot without removing it from the legend, so it can be brought back.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay + 260);
    return () => clearTimeout(t);
  }, [delay]);

  // One recharts row per month, carrying the normalised value each Line reads
  // plus nothing else — the raw values live in `rowsByLabel` beside it, so the
  // tooltip can report real units without the chart trying to plot them.
  const { rows, rowsByLabel } = useMemo(() => {
    const normalised = data.series.map((s) => ({ key: s.key, values: normalise(s.values) }));
    const rows = data.labels.map((label, i) => {
      const row: Record<string, number | string> = { label };
      normalised.forEach((n) => {
        row[n.key] = n.values[i];
      });
      return row;
    });
    const rowsByLabel = new Map<string, TooltipRow[]>();
    data.labels.forEach((label, i) => {
      rowsByLabel.set(
        label,
        data.series.map((s) => ({ key: s.key, name: s.name, color: s.color, raw: s.values[i], unit: s.unit })),
      );
    });
    return { rows, rowsByLabel };
  }, [data]);

  // Only the visible series belong in the tooltip — a hidden line reporting a
  // value at a month where it isn't drawn is a readout for something the user
  // has explicitly put away.
  const visibleRowsByLabel = useMemo(() => {
    if (hidden.size === 0) return rowsByLabel;
    const next = new Map<string, TooltipRow[]>();
    rowsByLabel.forEach((v, k) => next.set(k, v.filter((r) => !hidden.has(r.key))));
    return next;
  }, [rowsByLabel, hidden]);

  // The header's "to last year" chip: how the headline series (survival) moved
  // across the whole selected window, first month to last.
  const headline = data.series.find((s) => s.key === "survival") ?? data.series[0];
  const first = headline?.values[0] ?? 0;
  const last = headline?.values[headline.values.length - 1] ?? 0;
  const windowChange = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      // Never let the last visible series be hidden — an empty plot with a
      // live crosshair reads as a broken chart, not as a deliberate state.
      if (next.has(key)) next.delete(key);
      else if (prev.size < data.series.length - 1) next.add(key);
      return next;
    });
  }

  return (
    <div
      className="flex-[1.6] min-w-0 surface-card p-[14px] flex flex-col gap-[8px] animate-fade-in-up surface-card--interactive group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-[12px] shrink-0">
        <div className="flex items-center gap-[6px] min-w-0">
          <span className="text-[14px] font-bold text-[#141414] leading-[22px] font-['Outfit',sans-serif] truncate">
            Seeding performance
          </span>
          <img src={imgIcInfoCircle} alt="info" className="u-icon w-4 h-4 shrink-0 opacity-50 group-hover:opacity-80" />
        </div>
        <div className="flex items-center gap-[6px] shrink-0">
          {windowChange !== null && (
            <TrendChip
              change={`${windowChange > 0 ? "+" : ""}${windowChange.toFixed(0)}%`}
              trend={windowChange < 0 ? "down" : "up"}
              title="Survival rate, first to last month of the selected range"
              className="shrink-0"
            />
          )}
          <span className="text-[12px] text-[#6b6b6b] font-['Outfit',sans-serif] whitespace-nowrap hidden sm:inline">
            over range
          </span>
          <ChartActionBtn src={imgIcLink2} alt="link" />
          <ChartActionBtn src={imgIcDownload01} alt="download" />
        </div>
      </div>

      <div className="flex-1 min-h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.06)" strokeDasharray="3 4" vertical horizontal={false} />
            <XAxis dataKey="label" hide />
            {/* Fixed domain, not "auto": every series is already indexed to
                0–100, so letting recharts re-fit the axis to whichever series
                is currently visible would make the remaining lines visibly
                jump when one is toggled off. */}
            <YAxis domain={[-4, 104]} hide />
            <Tooltip
              cursor={{ stroke: "#096151", strokeWidth: 1, strokeDasharray: "4 4" }}
              content={<PerfTooltip rowsByLabel={visibleRowsByLabel} />}
              wrapperStyle={{ outline: "none" }}
            />
            {data.series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                hide={hidden.has(s.key)}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: s.color }}
                isAnimationActive={mounted}
                // Staggered so the four lines draw in one after another —
                // the same "arrives as a sequence" cascade the KPI row and
                // the insight strip use, rather than four simultaneous flashes.
                animationBegin={i * 140}
                animationDuration={900}
                animationEasing="ease-out"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between shrink-0 text-[11px] text-[#8a8a94] font-['Outfit',sans-serif]">
        <span>{data.labels[0]}</span>
        <span>{data.labels[data.labels.length - 1]}</span>
      </div>

      {/* Legend doubles as the series switch. Buttons, not divs, so the whole
          set is reachable and toggleable from the keyboard. */}
      <div className="flex items-center gap-[12px] flex-wrap shrink-0">
        {data.series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              aria-pressed={!off}
              title={off ? `Show ${s.name}` : `Hide ${s.name}`}
              className={`u-press flex items-center gap-[6px] cursor-pointer rounded-[6px] px-[4px] py-[2px] transition-opacity duration-(--dur-2) ease-out hover:bg-white/50 ${
                off ? "opacity-40" : "opacity-100"
              }`}
            >
              <span
                className="w-[10px] h-[10px] rounded-[3px] shrink-0 transition-transform duration-(--dur-2) ease-(--ease-lux)"
                style={{ background: s.color, transform: off ? "scale(0.7)" : "scale(1)" }}
              />
              <span className="text-[12px] text-[#141414] font-['Outfit',sans-serif] whitespace-nowrap">{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
