import type { Area } from "../data/areas";

/** The project title in the dashboard's top bar — clicking it goes back to
 * the project overview (LandingScreen), which already lists every area with
 * its own entry point. A dropdown here would have duplicated that list in a
 * second place; this is a breadcrumb back up, not a second area switcher. */
export default function AreaSwitcher({
  areas,
  activeAreaId,
  onNavigateHome,
}: {
  areas: Area[];
  activeAreaId: string;
  onNavigateHome: () => void;
}) {
  const active = areas.find((a) => a.id === activeAreaId) ?? areas[0];

  return (
    <div className="flex items-center gap-[8px] px-2">
      <button
        type="button"
        onClick={onNavigateHome}
        aria-label="Back to project overview map"
        className="u-press flex items-center gap-[8px] rounded-[10px] px-1 py-0.5 hover:bg-[#ebece7]"
      >
        <span className="text-[14px] font-medium text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
          {active.projectName}
        </span>
      </button>
      <span className="text-[14px] font-normal text-[#464650] font-['Outfit',sans-serif] whitespace-nowrap">
        {active.name}
      </span>
    </div>
  );
}
