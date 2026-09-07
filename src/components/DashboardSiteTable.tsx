import { useMemo, useState } from "react";
import { imgIcHexagon, imgIcPin } from "../assets";
import type { SiteRow } from "../data/dashboard";
import { SortArrow } from "./SortArrow";

type SortKey = "name" | "managedArea" | "saplings" | "seedDispersion" | "extentPct";

const COLUMNS: { key: SortKey | null; label: string; align?: "right" }[] = [
  { key: "name", label: "Name" },
  { key: "managedArea", label: "Managed Area", align: "right" },
  { key: null, label: "Type" },
  { key: "saplings", label: "Saplings", align: "right" },
  { key: "seedDispersion", label: "Seed Dispersion", align: "right" },
  { key: "extentPct", label: "Mangrove Extent", align: "right" },
  { key: null, label: "Estimate range" },
];

/**
 * The dashboard's site table (Figma node 2915:47927) — one row per managed
 * area, with the estimate column drawn as a proportional bar rather than
 * printed as text.
 *
 * Sortable on every quantitative column, and each row drills into that area.
 * The bar's width animates from zero on mount via a CSS transition on an
 * inline width, so the bars fill in as the table lands instead of appearing
 * already full.
 */
export default function DashboardSiteTable({
  rows,
  delay,
  onSelectArea,
  activeAreaId,
}: {
  rows: SiteRow[];
  delay: number;
  onSelectArea?: (areaId: string) => void;
  /** The area the rest of the dashboard is currently scoped to — marked so the
   * table says which row the KPIs above it are describing. */
  activeAreaId?: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "saplings", dir: "desc" });

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      // Nulls (a control plot has no dispersion figure) always sort last,
      // whichever direction the column is pointing — they are "no value",
      // not "the smallest value".
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rows, sort]);

  // The widest estimate in the table sets the bar scale, so every bar is
  // readable against the same ceiling instead of each filling its own cell.
  const maxHigh = Math.max(...rows.map((r) => r.estimateHigh), 1);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  return (
    <div
      className="surface-card overflow-hidden animate-fade-in-up flex flex-col min-h-0"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="overflow-auto scroll-slim min-h-0">
        <table className="w-full border-collapse font-['Outfit',sans-serif]">
          <thead className="sticky top-0 z-[1] bg-[#f4f2f0]">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  scope="col"
                  className={`px-[12px] py-[10px] text-[12px] font-medium text-[#363636] whitespace-nowrap border-b border-[rgba(0,0,0,0.08)] ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {col.key ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key!)}
                      aria-sort={sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      // `group` is load-bearing: SortArrow renders itself at
                      // opacity-0 and reveals on `group-hover`, so an inactive
                      // column's arrow is invisible without a group ancestor.
                      className={`u-press group inline-flex items-center gap-[4px] cursor-pointer hover:text-[#096151] transition-colors duration-(--dur-2) ${
                        col.align === "right" ? "flex-row-reverse" : ""
                      }`}
                    >
                      {col.label}
                      <SortArrow active={sort.key === col.key} dir={sort.dir} />
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const active = row.id === activeAreaId;
              return (
                <tr
                  key={row.id}
                  onClick={onSelectArea ? () => onSelectArea(row.id) : undefined}
                  className={`animate-fade-in-up border-b border-[rgba(0,0,0,0.05)] last:border-b-0 transition-colors duration-(--dur-2) ease-out ${
                    onSelectArea ? "cursor-pointer" : ""
                  } ${active ? "bg-[rgba(9,97,81,0.07)]" : "hover:bg-white/55"}`}
                  // Staggered per row so the table fills top-down with the
                  // same cascade the cards above it use. Capped so a long
                  // table's last row doesn't arrive seconds after its first.
                  style={{ animationDelay: `${delay + Math.min(i, 8) * 45}ms` }}
                >
                  <td className="px-[12px] py-[10px] text-[13px] text-[#141414] whitespace-nowrap">
                    <span className="inline-flex items-center gap-[8px]">
                      <img src={imgIcPin} alt="" className="w-4 h-4 shrink-0 opacity-70" />
                      {row.name}
                    </span>
                  </td>
                  <td className="px-[12px] py-[10px] text-[13px] text-[#141414] text-right tabular-nums whitespace-nowrap">
                    {row.managedArea.toFixed(2)} ha
                  </td>
                  <td className="px-[12px] py-[10px] text-[13px] text-[#363636] whitespace-nowrap">
                    <span className="inline-flex items-center gap-[6px]">
                      <img src={imgIcHexagon} alt="" className="w-4 h-4 shrink-0 opacity-60" />
                      {row.type}
                    </span>
                  </td>
                  <td className="px-[12px] py-[10px] text-[13px] text-right tabular-nums whitespace-nowrap">
                    <span className="text-[#141414]">{row.saplings.toLocaleString()}</span>
                    {row.saplingsDelta !== 0 && (
                      <span className={`ml-[6px] text-[12px] ${row.saplingsDelta > 0 ? "text-[#24A67A]" : "text-[#E5484D]"}`}>
                        {row.saplingsDelta > 0 ? "+" : ""}
                        {row.saplingsDelta.toLocaleString()}
                      </span>
                    )}
                  </td>
                  <td className="px-[12px] py-[10px] text-[13px] text-[#141414] text-right tabular-nums whitespace-nowrap">
                    {row.seedDispersion === null ? <span className="text-[#a0a0a8]">–</span> : row.seedDispersion.toLocaleString()}
                  </td>
                  <td className="px-[12px] py-[10px] text-[13px] text-right tabular-nums whitespace-nowrap">
                    <span className="text-[#141414]">{row.extentPct.toFixed(0)}%</span>
                    <span className="ml-[6px] text-[12px] text-[#6b6b6b]">{row.extentHa} ha</span>
                  </td>
                  <td className="px-[12px] py-[10px] whitespace-nowrap min-w-[180px]">
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[12px] text-[#141414] tabular-nums">
                        {row.saplings.toLocaleString()}{" "}
                        <span className="text-[#6b6b6b]">
                          ({row.estimateLow.toLocaleString()} – {row.estimateHigh.toLocaleString()})
                        </span>
                      </span>
                      {/* The band, drawn to scale: the track is the table's
                          widest upper bound, the filled span is this row's own
                          low→high interval. */}
                      <div className="relative h-[6px] w-full max-w-[140px] rounded-full bg-[rgba(0,0,0,0.07)] overflow-hidden">
                        <div
                          className="absolute top-0 h-full rounded-full bg-[#4A8FC1] transition-[left,width] duration-(--dur-5) ease-(--ease-lux)"
                          style={{
                            left: `${(row.estimateLow / maxHigh) * 100}%`,
                            width: `${((row.estimateHigh - row.estimateLow) / maxHigh) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
