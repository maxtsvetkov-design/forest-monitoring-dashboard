import { Fragment } from "react";
import { AREA_ROWS } from "./AreaTable";

/**
 * Every monitored site's own aggregate, side by side.
 *
 * Metrics, not rows, own the y-axis here on purpose: the whole point of a
 * comparison is reading one number across every site at a glance ("who has
 * the lowest health score"), which a per-site table (AreaTableView) already
 * does the other way around and isn't trying to make easy.
 *
 * Every value below comes straight off `AREA_ROWS` — the same computed
 * aggregate the Table tab's own rows use — so nothing here can quietly
 * disagree with what that tab, or a site's own workspace dashboard, reports.
 */
interface MetricRow {
  label: string;
  format: (row: (typeof AREA_ROWS)[number]) => string;
  /** Which site currently has the best reading on this metric, so it can be
   *  called out rather than left for the reader to scan for themselves. */
  bestId: string;
}

function bestBy<T>(rows: T[], value: (r: T) => number, direction: "max" | "min"): T {
  return rows.reduce((best, r) => {
    const v = value(r);
    const bv = value(best);
    return direction === "max" ? (v > bv ? r : best) : v < bv ? r : best;
  }, rows[0]);
}

const METRICS: MetricRow[] = [
  {
    label: "Health score",
    format: (r) => `${Math.round(r.healthScore)}%`,
    bestId: bestBy(AREA_ROWS, (r) => r.healthScore, "max").id,
  },
  {
    label: "Canopy trend",
    format: (r) => `${r.trendPct > 0 ? "+" : ""}${r.trendPct}%`,
    bestId: bestBy(AREA_ROWS, (r) => r.trendPct, "max").id,
  },
  {
    label: "Estimated trees",
    format: (r) => r.totalTrees.toLocaleString(),
    bestId: bestBy(AREA_ROWS, (r) => r.totalTrees, "max").id,
  },
  {
    label: "Flagged trees",
    format: (r) => r.flaggedTrees.toLocaleString(),
    // Fewer flagged trees is the better reading here, the one metric in this
    // table where "highest" would be exactly backwards.
    bestId: bestBy(AREA_ROWS, (r) => r.flaggedTrees, "min").id,
  },
  {
    label: "Avg NDVI",
    format: (r) => r.avgNdvi.toFixed(2),
    bestId: bestBy(AREA_ROWS, (r) => r.avgNdvi, "max").id,
  },
];

export default function CompareAreasTable() {
  return (
    <div className="surface-card overflow-x-auto scroll-slim">
      <div
        className="grid min-w-[720px]"
        style={{ gridTemplateColumns: `180px repeat(${AREA_ROWS.length}, minmax(120px, 1fr))` }}
      >
        {/* Header row: metric label column left blank, then one column per site. */}
        <div className="px-4 py-3 border-b border-[#eeeef1]" />
        {AREA_ROWS.map((row) => (
          <div key={row.id} className="px-3 py-3 border-b border-[#eeeef1] border-l">
            <span className="block text-[12.5px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[16px]">
              {row.name}
            </span>
            <span className="block text-[10.5px] text-[#8a8a94] font-['Outfit',sans-serif]">{row.hectares} ha</span>
          </div>
        ))}

        {METRICS.map((metric) => (
          <Fragment key={metric.label}>
            <div className="px-4 py-[10px] border-b border-[#eeeef1] flex items-center text-[12px] font-semibold text-[#464650] font-['Outfit',sans-serif]">
              {metric.label}
            </div>
            {AREA_ROWS.map((row) => {
              const best = row.id === metric.bestId;
              return (
                <div
                  key={`${metric.label}-${row.id}`}
                  className={`px-3 py-[10px] border-b border-l border-[#eeeef1] flex items-center gap-[6px] text-[13px] font-['Outfit',sans-serif] tabular-nums ${
                    best ? "font-bold text-[#096151]" : "font-medium text-[#18181c]"
                  }`}
                >
                  {metric.format(row)}
                  {best && (
                    <span className="px-[6px] h-[16px] rounded-full bg-[#e7f4f2] text-[9px] font-bold text-[#096151] flex items-center uppercase tracking-wide">
                      Best
                    </span>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
