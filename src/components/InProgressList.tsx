import type { TriageEntry } from "../data/inspectionTriage";
import { SEVERITY_STYLE } from "../data/severity";
import { SeverityChip, TreePreview } from "./RecentEventsList";

/**
 * The one place a finding that was pushed to the (mocked) inspection system
 * goes to be tracked — every card here already has its outcome set to
 * `"hi_res"` (see AssetsView's own filter), so unlike `InspectionTriageList`
 * there is nothing left to *decide*, only two ways to end the wait:
 * confirm it's done (`onMarkClosed`, folds it into "accepted" — the same
 * resolved state every other finding reaches) or admit the push was
 * premature (`onTakeBack`, clears the outcome so it reopens in Recent
 * events exactly where it left off).
 */
export default function InProgressList({
  entries,
  onSelectEvent,
  onMarkClosed,
  onTakeBack,
}: {
  entries: TriageEntry[];
  onSelectEvent?: (entry: TriageEntry) => void;
  onMarkClosed: (eventId: string) => void;
  onTakeBack: (eventId: string) => void;
}) {
  return (
    <div className="h-full flex flex-col surface-card overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-[#dedee3] shrink-0">
        <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
          In progress <span className="font-normal text-[#5b5b66]">({entries.length})</span>
        </span>
        <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] mt-[2px]">
          Every finding currently sitting with the inspection system — mark one closed once it's resolved, or take it
          back if it was pushed by mistake.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-slim p-[10px]">
        {entries.length === 0 ? (
          <p className="text-[12px] text-[#71717a] font-['Outfit',sans-serif] py-6 text-center">
            Nothing in progress — findings pushed to the inspection system show up here.
          </p>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {entries.map((entry) => {
              const style = SEVERITY_STYLE[entry.severityLabel];
              return (
                <div
                  key={entry.event.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectEvent?.(entry)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelectEvent?.(entry);
                  }}
                  className="u-press group/card relative flex items-start gap-[14px] pl-[18px] pr-[14px] py-[14px] cursor-pointer rounded-[20px] border border-[rgba(0,0,0,0.06)] bg-white shadow-[0px_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0px_14px_32px_-12px_rgba(0,0,0,0.16)] transition-all duration-200 hover:-translate-y-[1px] overflow-hidden"
                >
                  <span
                    className="absolute left-0 top-0 bottom-0 w-[4px]"
                    style={{ background: "#2f6fed" }}
                    aria-hidden="true"
                  />
                  <TreePreview color={style.accent} eventId={entry.event.id} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[14.5px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[19px]">
                          {entry.violationType}
                        </span>
                        <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px]">
                          {entry.farmId} · Field {entry.field}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-[4px] shrink-0">
                        <span className="text-[10.5px] text-[#a1a1aa] font-['Outfit',sans-serif] whitespace-nowrap">
                          {entry.dateDetected.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <SeverityChip label={entry.severityLabel} color={style.accent} />
                      </div>
                    </div>
                    <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[17px] mt-[6px]">
                      {entry.event.description}
                    </p>
                    <div className="mt-[10px] pt-[10px] border-t border-[rgba(0,0,0,0.06)] flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-[5px] h-[20px] px-[8px] rounded-full text-[10.5px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.03em] bg-[#eaf1fe] text-[#2f6fed] mr-auto"
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M8 5v3.2l2.2 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        Awaiting inspection
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTakeBack(entry.event.id);
                        }}
                        className="u-press flex items-center gap-[5px] h-[26px] px-[9px] rounded-[8px] text-[11px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer border border-[#dedee3] bg-white text-[#5b5b66] hover:bg-[#f0f0f2] transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M6.5 3 3 6.5 6.5 10M3 6.5h6.5A3.5 3.5 0 0 1 13 10v0"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Take back
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkClosed(entry.event.id);
                        }}
                        className="u-press flex items-center gap-[5px] h-[26px] px-[9px] rounded-[8px] text-[11px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer border border-[#dedee3] bg-white text-[#096151] hover:bg-[#e6f2ec] transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M3 8.5l3.2 3.2L13 4.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Mark as closed
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
