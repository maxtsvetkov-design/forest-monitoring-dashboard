import { useState } from "react";
import { imgIcInfoCircle } from "../assets";
import { treePhotoTileFor } from "../data/treePhotoSprite";
import type { TreeEvent } from "../data/events";
import type { HealthKey } from "../data/types";
import { CONDITION_COLOR } from "../data/taxonomy";

// Matches the condition-donut / map-pin colour coding used elsewhere on the
// dashboard, so a reader who already learned that legend gets it for free here.
const SEVERITY_COLOR = CONDITION_COLOR;

/** Photo thumbnail for the tree in question, ringed in the event's severity
 * color. Sliced from the shared tree-photo sprite sheet (see
 * data/treePhotoSprite.ts) rather than its own <img>, so this list's photo
 * column costs zero extra requests beyond the one sprite the page already
 * loads for the Assets tab. */
function TreePreview({ color, eventId }: { color: string; eventId: string }) {
  return (
    <div
      className="w-11 h-11 rounded-full overflow-hidden shrink-0 bg-[#dedee3]"
      style={{ boxShadow: `inset 0 0 0 2px ${color}`, ...treePhotoTileFor(eventId), backgroundSize: "auto" }}
    />
  );
}

/** Compact on/off switch, styled to match the dashboard's other small
 * controls rather than a browser-default checkbox. */
function ImportantSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="u-press flex items-center gap-[6px] shrink-0"
    >
      <span className="text-[11px] font-medium text-[#5b5b66] font-['Outfit',sans-serif] whitespace-nowrap">
        Important only
      </span>
      <span
        className={`relative w-[28px] h-[16px] rounded-full transition-colors duration-150 ${
          on ? "bg-[#E5484D]" : "bg-[#dedee3]"
        }`}
      >
        <span
          className="absolute top-[2px] left-[2px] w-[12px] h-[12px] rounded-full bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-150"
          style={{ transform: on ? "translateX(12px)" : "translateX(0)" }}
        />
      </span>
    </button>
  );
}

/** Small red pill flagging a fully-defoliated-tree event as needing attention
 * now, not just another log line — the same #E5484D used for "Defoliated"
 * everywhere else on the dashboard (donuts, map pins), just louder here. */
function CriticalBadge() {
  return (
    <span className="inline-flex items-center shrink-0 h-[18px] px-[6px] rounded-full text-[10px] font-bold font-['Outfit',sans-serif] tracking-wide bg-[#E5484D] text-white">
      CRITICAL
    </span>
  );
}

function formatRelative(date: Date): string {
  const diffDays = Math.round((date.getTime() - Date.now()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, "day");
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, "month");
  return rtf.format(Math.round(diffMonths / 12), "year");
}

export default function RecentEventsList({
  events,
  delay,
  onSelectEvent,
}: {
  events: TreeEvent[];
  delay: number;
  /** Jumps to this event's tree on the map — see App.tsx's pendingTreeFocus. */
  onSelectEvent: (event: TreeEvent) => void;
}) {
  const [importantOnly, setImportantOnly] = useState(false);
  // "Important" mirrors the CRITICAL badge below — fully defoliated trees,
  // ground-truthed off the tree record rather than the event's own narrative
  // severity, for the same reason the badge does (see the comment at the map
  // site below). Was stuck checking health === "Dead", a label from the old
  // health scale that the taxonomy rewrite retired — every event silently
  // failed this check forever, so "Important only" always showed nothing.
  const visibleEvents = importantOnly ? events.filter((e) => e.tree.health === "Defoliated") : events;

  return (
    <div
      // A viewport-relative max-height rather than h-full: the row that holds
      // this sidebar and the main charts column has no definite height (the
      // page relies on document-level scroll, not an inner bounded scroll
      // region), so a percentage height here has nothing definite to resolve
      // against and the event list's full content height leaks into the
      // layout instead, stretching the whole row to match it. Anchoring to
      // 100vh sidesteps that and lets the list scroll internally instead.
      // No `surface-card--interactive` here: the lift is tuned for small
      // cards you sweep across, and on a full-height sidebar it reads as the
      // whole page shifting under the pointer.
      className="max-h-[calc(100vh-160px)] min-h-0 min-w-0 surface-card flex flex-col gap-[10px] animate-fade-in-up group"
      // Inline, not a `p-[8px]` utility class: `.surface-card`'s own
      // `padding: 1px` rule (its hairline background reveal) sits later in
      // the stylesheet than Tailwind's utilities and wins any class-vs-class
      // tie, so a padding utility here would be silently ignored.
      style={{ animationDelay: `${delay}ms`, padding: "8px" }}
    >
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[6px]">
          <span className="text-[14px] font-bold text-[#18181c] leading-[22px] font-['Outfit',sans-serif]">
            Recent events
          </span>
          <img src={imgIcInfoCircle} alt="info" className="w-4 h-4 opacity-50 group-hover:opacity-80 transition-opacity" />
        </div>
        <div className="flex items-center gap-[10px]">
          <ImportantSwitch on={importantOnly} onToggle={() => setImportantOnly((v) => !v)} />
        </div>
      </div>

      {visibleEvents.length === 0 ? (
        <p className="text-[12px] text-[#71717a] font-['Outfit',sans-serif] py-6 text-center">
          {importantOnly ? "No critical events in the selected range." : "No field events in the selected range."}
        </p>
      ) : (
        <div className="scroll-slim flex flex-col gap-[8px] flex-1 min-h-0 overflow-y-auto p-[2px] -m-[2px]">
          {visibleEvents.map((event, i) => {
            // Ground-truthed against the actual tree record, not the event's
            // own narrative `severity` field: `event.severity` is picked to
            // match the story ("decline flagged" vs "confirmed dead") but its
            // matching tree can fall back to a looser pick when no tree of
            // the exact wanted health exists that month (see events.ts's
            // pickTreeForEvent), so the two can drift apart. `event.tree.health`
            // is the same field treePins.ts reads to decide whether — and in
            // what color — this exact tree gets a pin on the map, so keying
            // off it here is what actually keeps this badge truthful to what
            // clicking the row flies you to.
            const critical = event.tree.health === "Defoliated";
            return (
            <div
              key={event.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectEvent(event)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onSelectEvent(event);
              }}
              className={`u-press flex items-start gap-[12px] p-[12px] animate-fade-in cursor-pointer rounded-[16px] border transition-colors duration-150 ${
                critical
                  ? "bg-[#fdf1f0] border-[#f6d3d1] hover:bg-[#fbe6e4]"
                  : "bg-white border-[rgba(0,0,0,0.06)] hover:bg-[#fbfbfa]"
              }`}
              style={{ animationDelay: `${delay + Math.min(i, 10) * 40}ms` }}
            >
              <TreePreview color={SEVERITY_COLOR[event.severity]} eventId={event.id} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  {/* The title wraps rather than truncating: "Tree fully
                      defoliated" clipped to "Tree fully def..." beside a
                      CRITICAL badge loses the one word that says what
                      happened. The badge drops to the next line when the two
                      cannot share one. */}
                  <div className="flex items-start flex-wrap gap-x-[6px] gap-y-[3px] min-w-0">
                    <span
                      className={`text-[14px] font-bold font-['Outfit',sans-serif] leading-[19px] ${
                        critical ? "text-[#B4231F]" : "text-[#18181c]"
                      }`}
                    >
                      {event.title}
                    </span>
                    {critical && <CriticalBadge />}
                  </div>
                  <span className="text-[11px] text-[#71717a] font-['Outfit',sans-serif] shrink-0 whitespace-nowrap">
                    {formatRelative(event.date)}
                  </span>
                </div>
                <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[17px] mt-[2px]">
                  {event.description}
                </p>
                {critical && (
                  <div className="flex items-center gap-[4px] mt-[6px]">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M5 9.2S8.5 6 8.5 3.7A3.5 3.5 0 0 0 1.5 3.7C1.5 6 5 9.2 5 9.2Z"
                        stroke="#B4231F"
                        strokeWidth="1"
                      />
                      <circle cx="5" cy="3.6" r="1.2" fill="#B4231F" />
                    </svg>
                    <span className="text-[10px] font-medium text-[#B4231F] font-['Outfit',sans-serif]">
                      Flagged on map — {event.tree.id}
                    </span>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
