import { useMemo, useState } from "react";
import AreaTable, { AREA_ROWS, type SiteRowData } from "./AreaTable";

/**
 * The landing screen's "Table" tab — every monitored site in one full-width
 * table, rather than the same rows squeezed into the overview sidebar.
 *
 * The table itself is the sidebar's own AreaTable, mounted at full width. What
 * this view adds is what the 566px sidebar had no room for: a heading with a
 * live count, and a search box. Search is owned here rather than inside
 * AreaTable so the sidebar mount stays exactly as narrow as it was.
 */

/**
 * Whether a site row survives the current search box.
 *
 * TODO(human): decide what the search actually matches, and implement it.
 */
function matchesQuery(row: SiteRowData, query: string): boolean {
  return true;
}

export default function AreaTableView({ onSelectSite }: { onSelectSite: (areaId: string) => void }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => AREA_ROWS.filter((row) => matchesQuery(row, query)), [query]);

  return (
    <div className="view-enter mx-auto w-full max-w-[1280px] px-[24px] pb-[48px] flex flex-col gap-[16px]">
      <div className="flex items-baseline justify-between gap-[16px] flex-wrap">
        <h1 className="text-[22px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[30px]">
          Monitored sites{" "}
          <span className="font-normal text-[#5b5b66] text-[16px]">
            {visible.length === AREA_ROWS.length
              ? `(${AREA_ROWS.length})`
              : `(${visible.length} of ${AREA_ROWS.length})`}
          </span>
        </h1>
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-[12px] text-[#096151] hover:underline font-['Outfit',sans-serif] shrink-0 cursor-pointer"
          >
            Clear search
          </button>
        )}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search sites or projects…"
        aria-label="Search monitored sites"
        className="w-full max-w-[360px] px-[12px] py-[7px] text-[13px] font-['Outfit',sans-serif] bg-white border border-[#dedee3] rounded-[8px] outline-none focus:border-[#096151] transition-colors duration-150"
      />

      <AreaTable rows={visible} onSelectSite={onSelectSite} />
    </div>
  );
}
