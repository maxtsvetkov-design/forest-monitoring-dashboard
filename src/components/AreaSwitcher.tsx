/** The workspace's own fixed program title, standing in for whichever area's
 * `projectName` this breadcrumb used to read off `data/areas.ts` (that data
 * still carries its real per-area project/area names for the landing
 * screen's groupings, tables, and tab labels — only this one header line
 * reads a fixed title instead, regardless of which area is open). */
const PROGRAM_TITLE = "Terrestrial and Marine Habitat Mapping";
const PROGRAM_SUBTITLE = "Change Detection";

/** The project title in the dashboard's top bar — clicking it goes back to
 * the project overview (LandingScreen), which already lists every area with
 * its own entry point. A dropdown here would have duplicated that list in a
 * second place; this is a breadcrumb back up, not a second area switcher. */
export default function AreaSwitcher({
  onNavigateHome,
}: {
  onNavigateHome: () => void;
}) {
  return (
    <div className="flex items-center gap-[8px] px-2">
      <button
        type="button"
        onClick={onNavigateHome}
        aria-label="Back to project overview map"
        className="u-press flex items-center gap-[8px] rounded-[10px] px-1 py-0.5 hover:bg-[#ebece7]"
      >
        <span className="text-[14px] font-medium text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
          {PROGRAM_TITLE}
        </span>
      </button>
      <span className="text-[14px] font-normal text-[#464650] font-['Outfit',sans-serif] whitespace-nowrap">
        {PROGRAM_SUBTITLE}
      </span>
    </div>
  );
}
