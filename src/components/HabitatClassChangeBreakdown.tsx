import { habitatClassChangeFor, type HabitatClassChange } from "../data/habitatClassChange";
import type { TreeEvent } from "../data/events";

/**
 * The per-classification-code read behind one habitat-change event: which of
 * the reference key's classes gained or lost ground, by how much, and how
 * confidently.
 *
 * Every figure here is modelled rather than measured — nothing in this app
 * classifies imagery into these codes (see `habitatClassChange.ts`). That is
 * stated on the card itself rather than left for the reader to discover:
 * this app's whole convention is that a number says where it came from, and
 * the one place it is invented is the one place that most needs saying so.
 */

function Delta({ value, unit }: { value: number; unit: string }) {
  const up = value > 0;
  return (
    <span
      className="inline-flex items-center gap-[2px] text-[11.5px] font-bold font-['Outfit',sans-serif] tabular-nums"
      style={{ color: up ? "#227741" : "#c0392b" }}
    >
      {up ? "▲" : "▼"}
      {Math.abs(value).toFixed(1)}
      {unit}
    </span>
  );
}

/** Six-point extent series as a plain inline SVG polyline — no charting
 *  library for something this small, the way `LayerCoverageStrip` already
 *  draws its own coverage bars rather than pulling recharts in for them. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const w = 62;
  const h = 20;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * (h - 3) - 1.5}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={w}
        cy={h - ((points[points.length - 1] - min) / span) * (h - 3) - 1.5}
        r="2.1"
        fill={color}
      />
    </svg>
  );
}

/** One class's row: swatch + code/label, its before → after extent, the
 *  signed change, and the trend that got it there. */
function ClassRow({ c, maxExtent }: { c: HabitatClassChange; maxExtent: number }) {
  return (
    <div className="flex flex-col gap-[6px] py-[9px] border-b border-[#eeeef1] last:border-b-0">
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex items-start gap-[7px] min-w-0">
          <span
            className="mt-[3px] shrink-0 w-[12px] h-[12px] rounded-[3px] border border-black/10"
            style={{ background: c.color }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <span className="block text-[12px] font-semibold text-[#2b2b31] font-['Outfit',sans-serif] leading-[15px]">
              {c.code} — {c.label}
            </span>
            <span className="block text-[10.5px] text-[#8a8a94] font-['Outfit',sans-serif] tabular-nums mt-[1px]">
              {c.beforeHa.toFixed(1)} → {c.afterHa.toFixed(1)} ha · {c.confidencePct}% confidence
            </span>
          </div>
        </div>
        <div className="flex items-center gap-[8px] shrink-0">
          <Sparkline points={c.trend} color={c.color} />
          <div className="flex flex-col items-end">
            <Delta value={c.deltaHa} unit=" ha" />
            <span className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] tabular-nums">
              {c.deltaPct > 0 ? "+" : ""}
              {c.deltaPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Before/after extent as paired bars against the widest class, so the
          three rows are comparable to each other rather than each scaled to
          its own maximum. */}
      <div className="flex flex-col gap-[3px] pl-[19px]">
        {(
          [
            ["Before", c.beforeHa, 0.32],
            ["After", c.afterHa, 1],
          ] as const
        ).map(([tag, value, opacity]) => (
          <div key={tag} className="flex items-center gap-[6px]">
            <span className="w-[34px] shrink-0 text-[9.5px] text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
              {tag}
            </span>
            <span className="flex-1 h-[6px] rounded-full bg-[#eeeef1] overflow-hidden">
              <span
                className="block h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${(value / maxExtent) * 100}%`, background: c.color, opacity }}
              />
            </span>
            <span className="w-[42px] shrink-0 text-right text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] tabular-nums">
              {value.toFixed(1)} ha
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HabitatClassChangeBreakdown({ event }: { event: TreeEvent }) {
  const report = habitatClassChangeFor(event);
  if (!report) return null;

  const { classes, totalLostHa, totalGainedHa, netHa, meanConfidencePct, changedCells } = report;
  const maxExtent = Math.max(...classes.flatMap((c) => [c.beforeHa, c.afterHa]));

  return (
    <div className="rounded-[12px] bg-[#f6f6f8] border border-[#eeeef1] px-[14px] py-[12px] flex flex-col gap-[10px]">
      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-[10.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
          Change by habitat class
        </span>
        <span className="shrink-0 px-[7px] h-[17px] rounded-full bg-[#ececf0] text-[9.5px] font-bold text-[#71717a] font-['Outfit',sans-serif] uppercase tracking-[0.06em] flex items-center">
          Modelled
        </span>
      </div>

      {/* Composition — the impacted area split across the three classes, as
          one stacked bar rather than a donut: three shares of a single known
          total read faster as one length divided up than as an arc. */}
      <div className="flex flex-col gap-[5px]">
        <span className="flex h-[10px] rounded-full overflow-hidden">
          {classes.map((c) => (
            <span
              key={c.code}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${c.sharePct}%`, background: c.color }}
              title={`${c.code} — ${c.label}: ${c.sharePct.toFixed(1)}% of the impacted area`}
            />
          ))}
        </span>
        <div className="flex flex-wrap gap-x-[10px] gap-y-[2px]">
          {classes.map((c) => (
            <span
              key={c.code}
              className="flex items-center gap-[4px] text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] tabular-nums"
            >
              <span
                className="w-[7px] h-[7px] rounded-full shrink-0"
                style={{ background: c.color }}
                aria-hidden="true"
              />
              {c.code} · {c.sharePct.toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      {/* Totals across the three classes. */}
      <div className="grid grid-cols-4 gap-x-[8px] gap-y-[6px] py-[8px] border-y border-[#eeeef1]">
        {(
          [
            ["Lost", `${totalLostHa.toFixed(1)} ha`, "#c0392b"],
            ["Gained", `${totalGainedHa.toFixed(1)} ha`, "#227741"],
            ["Net", `${netHa > 0 ? "+" : ""}${netHa.toFixed(1)} ha`, netHa >= 0 ? "#227741" : "#c0392b"],
            ["Cells changed", changedCells.toLocaleString(), "#2b2b31"],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="min-w-0">
            <span className="block text-[9.5px] font-semibold text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.06em] truncate">
              {label}
            </span>
            <span
              className="block text-[13px] font-bold font-['Outfit',sans-serif] tabular-nums"
              style={{ color }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col">
        {classes.map((c) => (
          <ClassRow key={c.code} c={c} maxExtent={maxExtent} />
        ))}
      </div>

      {/* What the three rows amount to, in a sentence — and where the numbers
          came from, which for this one card is the more important half. */}
      <p className="text-[11.5px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px]">
        {netHa < 0
          ? `Net loss of ${Math.abs(netHa).toFixed(1)} ha across the three classified habitats, with ${
              classes.reduce((worst, c) => (c.deltaHa < worst.deltaHa ? c : worst), classes[0]).code
            } giving up the most ground.`
          : `Net gain of ${netHa.toFixed(1)} ha across the three classified habitats, led by ${
              classes.reduce((best, c) => (c.deltaHa > best.deltaHa ? c : best), classes[0]).code
            }.`}{" "}
        Mean classifier confidence {meanConfidencePct}% over {changedCells.toLocaleString()} changed 10 × 10 m cells.
      </p>
      <p className="text-[10.5px] text-[#9a9aa4] font-['Outfit',sans-serif] leading-[14px]">
        Modelled figures, not a measured classification — no raster in this workspace is classified into the
        reference key's codes. Class names and colours are the key's own; the split is apportioned across the
        impacted area this event already reports, and is stable per event rather than regenerated each view.
      </p>
    </div>
  );
}
