import { terrestrialHabitatContextFor, type TerrestrialContextClass } from "../data/terrestrialHabitatContext";
import type { TreeEvent } from "../data/events";

/**
 * The wider landscape this event's own three-class change sits inside: ten
 * neighbouring terrestrial classes across the surveyed coastline, each with
 * its standing extent and recent drift — context for the change above, not
 * a restatement of it. See `terrestrialHabitatContext.ts` for why these
 * numbers are independent of `HabitatClassChangeBreakdown`'s.
 */

const TICKS = [0, 0.25, 0.5, 0.75, 1];

function swatchStyle(c: TerrestrialContextClass) {
  return c.hatched
    ? {
        backgroundColor: c.color,
        backgroundImage: "repeating-linear-gradient(45deg, rgba(0,0,0,0.55) 0 2px, transparent 2px 5px)",
      }
    : { backgroundColor: c.color };
}

function ContextRow({ c, maxArea }: { c: TerrestrialContextClass; maxArea: number }) {
  const up = c.deltaPct > 0;
  return (
    <div className="flex items-center gap-[8px] py-[3px]">
      <div className="w-[186px] shrink-0 flex items-center gap-[6px] min-w-0">
        <span className="w-[10px] h-[10px] rounded-[2px] border border-black/10 shrink-0" style={swatchStyle(c)} aria-hidden="true" />
        <span className="text-[10.5px] text-[#5b5b66] font-['Outfit',sans-serif] truncate" title={`${c.code} — ${c.label}`}>
          {c.code} — {c.label}
        </span>
      </div>
      <div className="flex-1 relative h-[13px]">
        <span
          className="absolute inset-y-0 left-0 rounded-[2px]"
          style={{ width: `${(c.areaHa / maxArea) * 100}%`, ...swatchStyle(c) }}
        />
      </div>
      <span className="w-[48px] shrink-0 text-right text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] tabular-nums">
        {c.areaHa.toFixed(1)} ha
      </span>
      <span
        className="w-[38px] shrink-0 text-right text-[10px] font-bold font-['Outfit',sans-serif] tabular-nums"
        style={{ color: up ? "#227741" : "#c0392b" }}
      >
        {up ? "▲" : "▼"}
        {Math.abs(c.deltaPct).toFixed(1)}%
      </span>
    </div>
  );
}

export default function TerrestrialHabitatContextChart({ event }: { event: TreeEvent }) {
  const report = terrestrialHabitatContextFor(event);
  if (!report) return null;

  const { classes, totalHa } = report;
  const sorted = [...classes].sort((a, b) => b.areaHa - a.areaHa);
  const maxArea = Math.max(...classes.map((c) => c.areaHa));

  return (
    <div className="rounded-[12px] bg-[#f6f6f8] border border-[#eeeef1] px-[14px] py-[12px] flex flex-col gap-[8px]">
      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-[10.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
          Terrestrial habitat context
        </span>
        <span className="shrink-0 px-[7px] h-[17px] rounded-full bg-[#ececf0] text-[9.5px] font-bold text-[#71717a] font-['Outfit',sans-serif] uppercase tracking-[0.06em] flex items-center">
          Modelled
        </span>
      </div>

      {/* Axis ticks over the bar-track column only, shared by every row below */}
      <div className="flex items-center gap-[8px]">
        <span className="w-[186px] shrink-0" />
        <div className="flex-1 relative h-[11px]">
          {TICKS.map((t) => (
            <span
              key={t}
              className="absolute top-0 text-[8px] text-[#b5b5bd] font-['Outfit',sans-serif] tabular-nums"
              style={{ left: `${t * 100}%`, transform: t === 0 ? undefined : t === 1 ? "translateX(-100%)" : "translateX(-50%)" }}
            >
              {Math.round(t * maxArea)}
            </span>
          ))}
        </div>
        <span className="w-[48px] shrink-0" />
        <span className="w-[38px] shrink-0" />
      </div>

      {/* Gridlines spanning the bar-track column across every row */}
      <div className="relative">
        {/* left = label column (186) + row gap (8); right = gap+area+gap+delta
            (8+48+8+38), matching each row's own `gap-[8px]` flex spacing
            exactly — this has to track ContextRow's layout by hand since it
            lives outside that flex row. */}
        <div className="absolute left-[194px] right-[102px] top-0 bottom-0 flex justify-between pointer-events-none" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} className="w-px bg-[#e4e4e9]" />
          ))}
        </div>
        <div className="flex flex-col divide-y divide-[#eeeef1]">
          {sorted.map((c) => (
            <ContextRow key={c.code} c={c} maxArea={maxArea} />
          ))}
        </div>
      </div>

      <p className="text-[10.5px] text-[#9a9aa4] font-['Outfit',sans-serif] leading-[14px]">
        {totalHa.toFixed(0)} ha surveyed across these ten classes on this coastline. Modelled landscape composition,
        not a measured classification — context for the change above, independent of its own hectare figure.
      </p>
    </div>
  );
}
