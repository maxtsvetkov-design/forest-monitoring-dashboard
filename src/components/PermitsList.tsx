import { useState } from "react";
import { imgIcInfoCircle, imgIcPin } from "../assets";
import { treePhotoTileFor } from "../data/treePhotoSprite";
import { PERMIT_SECTIONS, type PermitEntry } from "../data/permits";

/**
 * The Permits list — built from the design system's own mockup (Figma node
 * 3781:106159) rather than the honest-empty-state card this replaces
 * elsewhere in the app. See `data/permits.ts`'s own comment: no permitting
 * system is actually wired up, so this is example content matching what the
 * design shows, not a live feed.
 *
 * Grouped by status (Approved / Rejected / Incoming) — see `data/permits.ts`.
 *
 * Reuses this app's existing avatar-tile pattern (`treePhotoTileFor`, the
 * same texture `RecentEventsList`'s own row avatars use) rather than
 * importing the mockup's own stock photo — keeps every photo-shaped thing in
 * this app drawing from one deterministic source instead of a second,
 * one-off image dependency.
 */
function PermitAvatar({ seed, ringColor }: { seed: string; ringColor: string }) {
  return (
    <div
      className="w-11 h-11 rounded-full overflow-hidden shrink-0 bg-[#dedee3]"
      style={{ boxShadow: `inset 0 0 0 2px ${ringColor}`, ...treePhotoTileFor(seed), backgroundSize: "auto" }}
    />
  );
}

/** Session-only, visual outcome of an Approve/Reject click — no backing
 *  permitting system exists behind either (same honesty as `data/permits.ts`
 *  own disclaimer), so this never persists past a reload. Recolors the
 *  entry and gives it the same "APPROVED" pill / rejected ring the real
 *  Approved/Rejected entries already carry, so a decided permit reads as
 *  belonging to its new section rather than a still-incoming one that just
 *  changed color. */
function decidedEntry(entry: PermitEntry, decision: "approved" | "rejected"): PermitEntry {
  return decision === "approved"
    ? { ...entry, title: "Access permit issued", approved: true, timestamp: "just now", ringColor: "#8c8c8c" }
    : { ...entry, title: "Access permit rejected", approved: false, timestamp: "just now", ringColor: "#c0392b" };
}

export default function PermitsList({
  selectedPermitId,
  onSelectPermit,
}: {
  /** Which permit's claimed area is highlighted on the habitat stage right
   *  now — see App.tsx's `focusedPermitId`. */
  selectedPermitId?: string | null;
  /** Focuses (or unfocuses, on a second click) this permit's area on the
   *  habitat stage — absent where this list isn't shown beside a map that
   *  can do anything with the selection. */
  onSelectPermit?: (id: string) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, "approved" | "rejected">>({});

  // PERMIT_SECTIONS itself never changes — a decided Incoming permit moves
  // sections only in this derived view, built fresh from the static data
  // plus this session's own decisions each render.
  const sections = PERMIT_SECTIONS.map((section) => {
    if (section.status === "Incoming") {
      return { ...section, entries: section.entries.filter((e) => !decisions[e.id]) };
    }
    const wantDecision = section.status === "Approved" ? "approved" : section.status === "Rejected" ? "rejected" : null;
    if (!wantDecision) return section;
    const moved = PERMIT_SECTIONS.find((s) => s.status === "Incoming")!.entries.filter(
      (e) => decisions[e.id] === wantDecision,
    );
    return { ...section, entries: [...moved.map((e) => decidedEntry(e, wantDecision)), ...section.entries] };
  });

  return (
    <div className="flex flex-col gap-[10px] animate-fade-in-up">
      <div className="flex items-center gap-[6px]">
        <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">Permits</span>
        <img src={imgIcInfoCircle} alt="" className="w-4 h-4 opacity-50" />
      </div>

      <div className="flex flex-col gap-[24px]">
        {sections.map((section) => (
          <div key={section.status} className="flex flex-col gap-[8px]">
            <span className="px-[8px] text-[11px] font-semibold text-[#666] font-['Outfit',sans-serif] tracking-[0.5px] uppercase">
              {section.status}
            </span>
            {section.entries.length === 0 && (
              <p className="px-[8px] text-[12px] text-[#8a8a94] font-['Outfit',sans-serif]">
                No {section.status.toLowerCase()} permits right now.
              </p>
            )}
            {section.entries.map((entry) => {
              const selected = selectedPermitId === entry.id;
              return (
              <div
                key={entry.id}
                role={onSelectPermit ? "button" : undefined}
                tabIndex={onSelectPermit ? 0 : undefined}
                onClick={onSelectPermit ? () => onSelectPermit(entry.id) : undefined}
                onKeyDown={
                  onSelectPermit
                    ? (e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        onSelectPermit(entry.id);
                      }
                    : undefined
                }
                className={`flex gap-[12px] p-[12px] rounded-[16px] border transition-colors duration-150 ${
                  onSelectPermit ? "u-press cursor-pointer" : ""
                } ${
                  selected
                    ? "bg-[#eef3fe] border-[#2f6fed]"
                    : entry.approved
                      ? "bg-white border-[#cce5d4]"
                      : "bg-white border-[rgba(0,0,0,0.06)]"
                }`}
              >
                <PermitAvatar seed={entry.id} ringColor={entry.ringColor} />
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center flex-wrap gap-x-[6px] gap-y-[3px] min-w-0">
                      <span className="text-[14px] font-bold text-[#363636] font-['Outfit',sans-serif] leading-[19px] whitespace-nowrap">
                        {entry.title}
                      </span>
                      {entry.approved && (
                        <span className="px-[6px] h-[18px] rounded-full bg-[#e0f3e6] text-[10px] font-bold text-[#227741] font-['Outfit',sans-serif] tracking-[0.25px] flex items-center">
                          APPROVED
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-[#71717a] font-['Outfit',sans-serif] shrink-0 whitespace-nowrap">
                      {entry.timestamp}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[17px] mt-[2px]">
                    {entry.description}
                  </p>
                  {entry.viewPermitId && (
                    <div className="flex items-center gap-[4px] mt-[6px]">
                      <img src={imgIcPin} alt="" className="w-[10px] h-[10px]" />
                      <span className="text-[10px] font-medium text-[#33668c] font-['Outfit',sans-serif]">
                        View permit — {entry.viewPermitId}
                      </span>
                    </div>
                  )}
                  {onSelectPermit && (
                    <div className="flex items-center gap-[4px] mt-[6px]">
                      <img src={imgIcPin} alt="" className="w-[10px] h-[10px]" />
                      <span className="text-[10px] font-medium text-[#2f6fed] font-['Outfit',sans-serif]">
                        {selected ? "Hide area on map" : "View area on map"}
                      </span>
                    </div>
                  )}
                  {section.status === "Incoming" && (
                    <div className="flex items-center gap-[8px] mt-[8px]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDecisions((prev) => ({ ...prev, [entry.id]: "approved" }));
                        }}
                        className="u-press flex-1 h-[30px] rounded-[9px] text-[11.5px] font-bold font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150"
                        style={{ background: "#227741", color: "#ffffff" }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDecisions((prev) => ({ ...prev, [entry.id]: "rejected" }));
                        }}
                        className="u-press flex-1 h-[30px] rounded-[9px] text-[11.5px] font-bold font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150"
                        style={{ background: "#fde8e8", color: "#c0392b" }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
