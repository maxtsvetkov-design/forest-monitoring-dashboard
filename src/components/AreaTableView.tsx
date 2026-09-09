import { useMemo, useState } from "react";
import { imgFilterFunnel01, imgIcSettings, imgUpload01 } from "../assets";
import ToolbarBtn from "./ToolbarBtn";
import AreaTable, { AREA_ROWS, type SiteRowData } from "./AreaTable";

/**
 * The landing screen's "Table" tab — every monitored site in one full-width
 * table, rather than the same rows squeezed into the overview sidebar.
 *
 * The table itself is the sidebar's own AreaTable, mounted at full width with
 * `variant="full"` — which is what actually adds the extra columns (Estimated
 * trees, Insights, Avg NDVI, Dates active) modelled on the Figma "Monitored
 * areas" table (node 2993:47329); see AreaTable's own file header for which
 * of that mockup's columns this dataset can't honestly back (Saplings, Hive
 * capacity, per-site Control/Seeding type) and why they're left out rather
 * than filled with placeholder numbers. This view adds what the 566px sidebar
 * had no room for even in "compact": a heading, a search box, and the toolbar
 * row above the table (Filters/Reset on the left, Export/Customize on the
 * right). The reference's two date-range fields aren't ported either — they
 * filter that mockup's own "dates active" column, and two date pickers that
 * filter nothing would be worse chrome than none. Filters/Customize/Export
 * are the same decorative ToolbarBtn already used in App.tsx's own top bar
 * rather than a new button style invented for this one screen.
 */

/**
 * Whether a site row survives the current search box.
 *
 * TODO(human): decide what the search actually matches, and implement it.
 */
function matchesQuery(row: SiteRowData, query: string): boolean {
  return true;
}

export default function AreaTableView({
  onSelectSite,
  onOpenHabitatChange,
}: {
  onSelectSite: (areaId: string) => void;
  /** Opens the habitat change detection screen — see AreaTable's own prop. */
  onOpenHabitatChange: (areaId: string, projectName: string) => void;
}) {
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
      </div>

      {/* Toolbar: search + Filters/Reset on the left, Export/Customize on the
          right — the same two-group arrangement the Figma reference uses,
          minus its two date-range fields (see the file header for why). */}
      <div className="flex items-center justify-between gap-[12px] flex-wrap">
        <div className="flex items-center gap-[8px] flex-wrap">
          <label className="relative flex items-center shrink-0">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className="absolute left-[10px] text-[#8a8a94] pointer-events-none"
            >
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M9.5 9.5 12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sites or projects…"
              aria-label="Search monitored sites"
              className="w-[240px] pl-[30px] pr-[12px] py-[8px] text-[13px] font-['Outfit',sans-serif] bg-white border border-[#dedee3] rounded-[9px] outline-none focus:border-[#096151] transition-colors duration-150"
            />
          </label>
          <ToolbarBtn src={imgFilterFunnel01} label="Filters" />
          <button
            type="button"
            onClick={() => setQuery("")}
            disabled={!query}
            className="u-press px-[12px] py-[8px] text-[13px] text-[#5b5b66] font-['Outfit',sans-serif] rounded-[9px] border border-[#dedee3] bg-white hover:text-[#18181c] hover:bg-[#f6f6f8] disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors duration-150"
          >
            Reset
          </button>
        </div>
        <div className="flex items-center gap-[4px] shrink-0">
          <ToolbarBtn src={imgUpload01} label="Export" />
          <ToolbarBtn src={imgIcSettings} label="Customize" />
        </div>
      </div>

      <AreaTable
        rows={visible}
        onSelectSite={onSelectSite}
        onOpenHabitatChange={onOpenHabitatChange}
        variant="full"
      />
    </div>
  );
}
