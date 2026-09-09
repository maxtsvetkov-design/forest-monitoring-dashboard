import { useEffect, useState } from "react";
import { imgIcInfoCircle } from "../assets";
import { treePhotoTileFor } from "../data/treePhotoSprite";
import type { TreeEvent } from "../data/events";
import type { AggregatedSnapshot, CategoryDatum } from "../data/types";
import { CONDITION_COLOR } from "../data/taxonomy";
import EventDetailPanel from "./EventDetailPanel";
import HabitatChangeCard from "./HabitatChangeCard";
import EventActionButtons from "./EventActionButtons";
import PermitsList from "./PermitsList";
import CompareStats from "./CompareStats";

// Matches the condition-donut / map-pin colour coding used elsewhere on the
// dashboard, so a reader who already learned that legend gets it for free here.
const SEVERITY_COLOR = CONDITION_COLOR;

/** Photo thumbnail for the tree in question, ringed in the event's severity
 * color. Sliced from the shared tree-photo sprite sheet (see
 * data/treePhotoSprite.ts) rather than its own <img>, so this list's photo
 * column costs zero extra requests beyond the one sprite the page already
 * loads for the Areas tab. */
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

/**
 * A standing notice at the head of the feed — something the programme is doing
 * continuously, rather than something that happened to a tree on a date.
 *
 * Deliberately NOT a TreeEvent. Every event in this list carries a real
 * `TreeRecord` (see events.ts, which says so in as many words), which is what
 * lets a row show that tree's photo, badge it CRITICAL off its actual
 * condition, and fly the map to it when clicked. An ongoing activity has no
 * tree, so squeezing one into that shape would mean inventing the tree — and
 * the row would then offer a photo of, and a jump to, something unrelated to
 * what it says.
 *
 * So it gets its own shape and its own treatment: an icon rather than a
 * portrait, "Ongoing" rather than a relative date, and no click target,
 * because there is nowhere for it to go.
 */
export interface FeedNotice {
  title: string;
  detail: string;
  /** Where the notice leads. Optional — without it the row is a statement
   *  rather than a door, and it stops advertising a click it cannot honour. */
  onSelect?: () => void;
}

function NoticeRow({ notice }: { notice: FeedNotice }) {
  const clickable = Boolean(notice.onSelect);
  return (
    <div
      // Same role/tabIndex/onKeyDown shape as the event rows below rather than
      // a <button>: the row carries a <p>, which is not phrasing content and
      // has no business inside a button element.
      {...(clickable
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: notice.onSelect,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              notice.onSelect?.();
            },
          }
        : {})}
      className={`feed-notice shrink-0 flex items-start gap-[12px] p-[12px] rounded-[16px] ${
        clickable ? "u-press cursor-pointer" : ""
      }`}
    >
      <span className="feed-notice-pulse relative shrink-0 w-11 h-11 rounded-full bg-white border border-[#f0bcb9] flex items-center justify-center">
        {/* A dish sweeping ground, not a tree portrait — the row is about the
            looking, not about any one thing found. The arm turns; the arcs and
            the centre stay put, so the motion reads as a scan rather than as
            the whole icon spinning. */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M13.6 6.4a5.1 5.1 0 0 1 0 7.2" stroke="#E5484D" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M6.4 13.6a5.1 5.1 0 0 1 0-7.2" stroke="#E5484D" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M16.1 3.9a8.6 8.6 0 0 1 0 12.2" stroke="#f0a3a0" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M3.9 16.1a8.6 8.6 0 0 1 0-12.2" stroke="#f0a3a0" strokeWidth="1.4" strokeLinecap="round" />
          <line className="feed-notice-sweep" x1="10" y1="10" x2="10" y2="3.4" stroke="#B4231F" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="10" r="1.9" fill="#B4231F" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[14px] font-bold text-[#B4231F] font-['Outfit',sans-serif] leading-[19px]">
            {notice.title}
          </span>
          <span className="inline-flex items-center gap-[4px] shrink-0 h-[18px] px-[6px] rounded-full bg-[#E5484D] text-white text-[10px] font-bold font-['Outfit',sans-serif] tracking-wide">
            <span className="feed-notice-dot w-[5px] h-[5px] rounded-full bg-white" />
            ONGOING
          </span>
        </div>
        <p className="text-[12px] text-[#5b3230] font-['Outfit',sans-serif] leading-[17px] mt-[2px]">{notice.detail}</p>
        {clickable && (
          <span className="flex items-center gap-[4px] mt-[6px] text-[10px] font-semibold text-[#B4231F] font-['Outfit',sans-serif]">
            Open habitat change detection
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>
    </div>
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

/** The real, range-scoped difference between two habitat-timeline captures —
 *  see App.tsx's `habitatCompareStats` for how it's computed (`aggregateRange`
 *  + a real habitat-event count per window, nothing invented for this card). */
export interface CompareContext {
  labelA: string;
  labelB: string;
  aggA: AggregatedSnapshot;
  aggB: AggregatedSnapshot;
  habitatEventsA: number;
  habitatEventsB: number;
}

export default function RecentEventsList({
  events,
  delay,
  onSelectEvent,
  notice,
  defaultImportantOnly = false,
  detailContext,
  compareContext,
  selectedPermitId,
  onSelectPermit,
  onPanelChange,
}: {
  events: TreeEvent[];
  delay: number;
  /** Jumps to this event's tree on the map — see App.tsx's pendingTreeFocus. */
  onSelectEvent: (event: TreeEvent) => void;
  /** A standing activity to head the feed with. Optional: surfaces where the
   *  feed is the whole view of a plot, absent where it sits beside charts that
   *  already say what is being watched. */
  notice?: FeedNotice;
  /** Opens the list already switched to "Important only" — for a surface
   *  whose whole point is critical events (the landing screen's Alert tab)
   *  rather than the general feed this filter is an option on elsewhere. The
   *  toggle stays live either way; this only seeds where it starts. */
  defaultImportantOnly?: boolean;
  /** Turns on the Recent events / Detail panel switcher — absent everywhere
   *  this list sits beside its own chart or map that already handles clicking
   *  an event, present only where this list is the whole surface (the Recent
   *  Events tab) and clicking a row has nowhere else to send the reader.
   *  `monthLabels` lets the detail view name the baseline month by its own
   *  label rather than an index; `projectName` is what the hi-res receipt
   *  names the commissioned pass over. */
  detailContext?: {
    projectName: string;
    monthLabels: string[];
    /** The same plot-wide health-condition donut and 12-month score trend
     *  Insights already shows — passed through rather than recomputed so the
     *  detail view's own "how critical, against what" context can never
     *  disagree with the numbers Insights is showing for the same area. */
    healthData: CategoryDatum[];
    healthScoreTrend: { label: string; score: number }[];
    /** See `EventDetailPanel`'s own comment — bubbled straight through. */
    speciesData?: CategoryDatum[];
    /** See `EventDetailPanel`'s own comment — bubbled straight through, this
     *  list has nothing of its own to do with it. */
    onHiResDelivered?: () => void;
    /** See `EventDetailPanel`'s own comment — bubbled straight through. */
    areaHa?: number;
  };
  /** Drives the "Compare" panel — present only while a habitat-timeline
   *  compare toggle is active (App.tsx's `habitatCompareIndex`). Switches
   *  this list over to that panel automatically the moment it's set, the
   *  same way selecting an event auto-switches to "Detail panel". */
  compareContext?: CompareContext | null;
  /** Which permit's claimed area is highlighted on the habitat stage —
   *  bubbled straight through to PermitsList, this list has nothing of its
   *  own to do with it. */
  selectedPermitId?: string | null;
  onSelectPermit?: (id: string) => void;
  /** Reports every switch of this list's own list/detail/permits/compare
   *  panel — lets App.tsx show permit areas on the habitat stage only while
   *  the reader is actually looking at the Permits panel, rather than
   *  cluttering every other view with claims that aren't what's on screen. */
  onPanelChange?: (panel: "list" | "detail" | "permits" | "compare") => void;
}) {
  const [importantOnly, setImportantOnly] = useState(defaultImportantOnly);
  const [panel, setPanel] = useState<"list" | "detail" | "permits" | "compare">("list");
  const [selectedEvent, setSelectedEvent] = useState<TreeEvent | null>(null);
  // Session-only, visual state for the three action buttons — no backing
  // saved-items list or ticketing system exists behind either (see
  // EventActionButtons' own comment). Lifted here, not local to each row or
  // to the detail panel, so toggling one from the list and opening the same
  // event's detail panel can never show it disagreeing with itself.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  function toggleSaved(id: string) {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleResolved(id: string) {
    setResolvedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleSelect(event: TreeEvent) {
    onSelectEvent(event);
    if (!detailContext) return;
    setSelectedEvent(event);
    setPanel("detail");
  }

  // Bumped on every "Request hi-res analysis" click from a row — reported
  // to EventDetailPanel so it can open the exact same HiResConfirmation
  // flow the old in-panel CTA opened, rather than the row's click only
  // switching to the detail panel and leaving the reader to ask again.
  const [hiResSignal, setHiResSignal] = useState(0);
  function requestHiResFor(event: TreeEvent) {
    handleSelect(event);
    setHiResSignal((n) => n + 1);
  }

  useEffect(() => {
    if (compareContext) setPanel("compare");
  }, [compareContext]);

  useEffect(() => {
    onPanelChange?.(panel);
  }, [panel, onPanelChange]);
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
      {detailContext ? (
        <div className="flex items-center gap-[2px] bg-[#f6f6f8] border border-[#dedee3] rounded-[10px] p-[2px] shrink-0">
          {(compareContext ? (["list", "detail", "permits", "compare"] as const) : (["list", "detail", "permits"] as const)).map(
            (p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPanel(p)}
                disabled={p === "detail" && !selectedEvent}
                aria-pressed={panel === p}
                className={`u-press flex-1 px-[10px] py-[6px] rounded-[8px] text-[12.5px] font-medium font-['Outfit',sans-serif] whitespace-nowrap transition-colors duration-150 ${
                  panel === p ? "bg-white text-[#18181c] shadow-[0px_1px_2px_rgba(0,0,0,0.08)]" : "text-[#71717a]"
                } ${p === "detail" && !selectedEvent ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
              >
                {p === "list" ? "Recent events" : p === "detail" ? "Detail panel" : p === "permits" ? "Permits" : "Compare"}
              </button>
            ),
          )}
        </div>
      ) : (
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
      )}

      {detailContext && panel === "detail" && selectedEvent ? (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-slim px-[2px]">
          <EventDetailPanel
            event={selectedEvent}
            monthLabels={detailContext.monthLabels}
            projectName={detailContext.projectName}
            healthData={detailContext.healthData}
            healthScoreTrend={detailContext.healthScoreTrend}
            onHiResDelivered={detailContext.onHiResDelivered}
            areaHa={detailContext.areaHa}
            onIssuePermitForTeam={() => setPanel("permits")}
            speciesData={detailContext.speciesData}
            saved={savedIds.has(selectedEvent.id)}
            onToggleSave={() => toggleSaved(selectedEvent.id)}
            resolved={resolvedIds.has(selectedEvent.id)}
            onToggleResolve={() => toggleResolved(selectedEvent.id)}
            hiResRequestSignal={hiResSignal}
          />
        </div>
      ) : detailContext && panel === "permits" ? (
        // See PermitsList's own comment — the design system's Permits mockup
        // content, not a live feed (this workspace has no permitting system
        // wired up).
        <div className="flex-1 min-h-0 overflow-y-auto scroll-slim px-[2px]">
          <PermitsList selectedPermitId={selectedPermitId} onSelectPermit={onSelectPermit} />
        </div>
      ) : detailContext && panel === "compare" && compareContext ? (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-slim px-[2px]">
          <CompareStats context={compareContext} />
        </div>
      ) : (
        <>
          {detailContext && (
            <div className="flex items-center justify-end shrink-0">
              <ImportantSwitch on={importantOnly} onToggle={() => setImportantOnly((v) => !v)} />
            </div>
          )}

          {/* Above the scroller and outside the Important filter, both on
              purpose: it is not an event, so filtering events must not remove
              it, and a statement of what is being watched continuously should
              not scroll away from the list it explains. It is also what keeps
              the empty state honest — "No critical events" beneath a live
              monitoring notice reads as nothing found, which is true, rather
              than as nothing running. */}
          {notice && <NoticeRow notice={notice} />}

          {visibleEvents.length === 0 ? (
        <p className="text-[12px] text-[#71717a] font-['Outfit',sans-serif] py-6 text-center">
          {importantOnly ? "No critical events in the selected range." : "No field events in the selected range."}
        </p>
      ) : (
        <div className="scroll-slim flex flex-col gap-[8px] flex-1 min-h-0 overflow-y-auto p-[2px] -m-[2px]">
          {/* Critical rows sort first and stay pinned to the top of the
              scroller (`sticky top-0`) rather than sitting wherever their own
              date lands them — the same "critical events shouldn't need
              scrolling to find" reasoning the Important-only switch already
              serves, just applied without the reader having to flip it. */}
          {[...visibleEvents]
            .sort((a, b) => Number(b.tree.health === "Defoliated") - Number(a.tree.health === "Defoliated"))
            .map((event, i) => {
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
              onClick={() => handleSelect(event)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                handleSelect(event);
              }}
              className={`u-press flex items-start gap-[12px] p-[12px] animate-fade-in cursor-pointer rounded-[16px] border transition-colors duration-150 ${
                critical
                  ? "sticky top-0 z-[5] bg-[#fdf1f0] border-[#f6d3d1] hover:bg-[#fbe6e4] shadow-[0px_6px_16px_-6px_rgba(180,35,31,0.25)]"
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
                    {critical && !event.habitatImpact && <CriticalBadge />}
                  </div>
                  <span className="text-[11px] text-[#71717a] font-['Outfit',sans-serif] shrink-0 whitespace-nowrap">
                    {formatRelative(event.date)}
                  </span>
                </div>
                {event.habitatImpact ? (
                  // Same shared card EventDetailPanel uses, just in its
                  // compact scale — replaces the generic CRITICAL badge and
                  // "Flagged on map" link: this event's own severity and
                  // location say more than either did.
                  <div className="mt-[6px]">
                    <HabitatChangeCard event={event} habitatImpact={event.habitatImpact} compact />
                  </div>
                ) : (
                  <>
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
                  </>
                )}
                <div className="mt-[8px]">
                  <EventActionButtons
                    saved={savedIds.has(event.id)}
                    onToggleSave={() => toggleSaved(event.id)}
                    resolved={resolvedIds.has(event.id)}
                    onToggleResolve={() => toggleResolved(event.id)}
                    onRequestHiRes={() => requestHiResFor(event)}
                    compact
                  />
                </div>
              </div>
            </div>
            );
          })}
        </div>
          )}
        </>
      )}
    </div>
  );
}
