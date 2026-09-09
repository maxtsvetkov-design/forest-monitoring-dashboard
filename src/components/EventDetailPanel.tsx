import { useEffect, useRef, useState } from "react";
import { CONDITION_LABEL } from "../data/taxonomy";
import { CURRENT_TIER_INDEX, TIERS } from "../data/tiers";
import { PROSE_RESOLUTION } from "../data/habitatAdvice";
import type { TreeEvent } from "../data/events";
import type { CategoryDatum } from "../data/types";
import HiResConfirmation from "./HiResConfirmation";
import HabitatChangeCard from "./HabitatChangeCard";
import HabitatClassChangeBreakdown from "./HabitatClassChangeBreakdown";
import HealthScoreTrendChart from "./HealthScoreTrendChart";
import EventActionButtons from "./EventActionButtons";

/**
 * The scientific read behind one event — what changed, against what
 * baseline, and how much to trust it — plus the one-way door into commissioning
 * a higher-resolution pass over it.
 *
 * Every figure here already exists on `TreeEvent` (see its own field comments)
 * rather than being computed fresh for this panel, so it can't quietly
 * disagree with the row it was opened from. The one thing this panel adds
 * that the row doesn't say is confidence — and that's stated honestly as a
 * property of this deployment's own resolution tier (`tiers.ts`), not as an
 * invented statistical figure this dataset has no basis for.
 */
export default function EventDetailPanel({
  event,
  monthLabels,
  projectName,
  healthData,
  healthScoreTrend,
  onHiResDelivered,
  areaHa,
  onIssuePermitForTeam,
  speciesData,
  saved = false,
  onToggleSave,
  resolved = false,
  onToggleResolve,
  hiResRequestSignal,
}: {
  event: TreeEvent;
  /** For the baseline month's own label — absent baseline fields (surveys,
   *  migrations) don't use this. */
  monthLabels: string[];
  projectName: string;
  /** The same plot-wide health-condition donut and 12-month score trend
   *  Insights already renders — reused verbatim, not recomputed, so this
   *  panel's "how does this compare" context can never disagree with what
   *  Insights is showing for the same area at the same moment. Gives a
   *  single flagged event the plot-wide backdrop it's read against: an
   *  isolated critical tree reads differently against a plot trending flat
   *  than one already sliding. */
  healthData: CategoryDatum[];
  healthScoreTrend: { label: string; score: number }[];
  /** Fired when the reader dismisses the hi-res receipt ("Back to the
   *  plot") — lets the habitat stage beside this panel swap in the actual
   *  higher-resolution capture, since this panel itself has no stage of its
   *  own to update. Optional: nothing to call where this panel is opened
   *  without one (there isn't currently such a place, but nothing here
   *  should require it). */
  onHiResDelivered?: () => void;
  /** The area's real hectare figure (`areaHectares(areaId)`) — passed
   *  through to HiResConfirmation's order-summary card. Optional: omitted
   *  rather than guessed if a caller has no area figure in scope. */
  areaHa?: number;
  /** Fired from the CTA that replaces "Get high-resolution analysis" once
   *  this event's hi-res pass has been requested and dismissed — this panel
   *  has no permits surface of its own, so it hands off to whichever one
   *  does (RecentEventsList's own Permits panel). */
  onIssuePermitForTeam?: () => void;
  /** The same real per-species tree count Insights already charts — passed
   *  straight through to HiResConfirmation's own species donut. */
  speciesData?: CategoryDatum[];
  /** Lifted to RecentEventsList (see its own comment) so the row this panel
   *  was opened from and this panel itself can never show the same event
   *  disagreeing on saved/resolved state. */
  saved?: boolean;
  onToggleSave?: () => void;
  resolved?: boolean;
  onToggleResolve?: () => void;
  /** Bumped by RecentEventsList every time its own row-level "Request
   *  hi-res analysis" button is clicked for this event — opens the exact
   *  same HiResConfirmation flow the in-panel button drives, so a request
   *  made from the row doesn't just switch to this panel and leave the
   *  reader to ask again. */
  hiResRequestSignal?: number;
}) {
  const [hiResOpen, setHiResOpen] = useState(false);
  // Local to this panel instance, not global delivery state: once *this*
  // event's own pass has been requested and dismissed, its CTA hands off to
  // commissioning a field crew — a different event opened fresh still gets
  // its own "Get high-resolution analysis" first.
  const [hiResRequested, setHiResRequested] = useState(false);
  // Fixed at 0, NOT read from the prop at mount: this panel mounts for the
  // first time in the very same render that a row's first-ever hi-res
  // click both raises the signal and switches the panel to "detail" — a
  // ref seeded from the prop's own current value would already equal it by
  // the time this effect runs, and the request would silently never open
  // anything. Seeding at the signal's own known starting value (0, see
  // RecentEventsList's `hiResSignal`) means a signal that arrives already
  // non-zero on this first mount still reads as a real change.
  const lastHiResSignalRef = useRef(0);
  useEffect(() => {
    if (hiResRequestSignal === undefined || lastHiResSignalRef.current === hiResRequestSignal) return;
    lastHiResSignalRef.current = hiResRequestSignal;
    setHiResOpen(true);
  }, [hiResRequestSignal]);
  const critical = event.tree.health === "Defoliated";
  const hasConditionBaseline = event.baselineCondition !== undefined;
  const hasExtentBaseline = event.extentBaselinePct !== undefined && event.extentCurrentPct !== undefined;
  const baselineMonthLabel = hasConditionBaseline ? monthLabels[event.monthIndex - 1] : undefined;
  const currentTier = TIERS[CURRENT_TIER_INDEX];

  return (
    <div className="flex flex-col gap-[14px] animate-fade-in-up">
      <div className="flex items-start justify-between gap-[10px]">
        <div className="min-w-0">
          <span className="block text-[15px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[20px]">
            {event.title}
          </span>
          <span className="block text-[11px] text-[#8a8a94] font-['Outfit',sans-serif] mt-[2px]">
            {event.tree.id} · {event.species}
          </span>
        </div>
        {critical && (
          <span className="shrink-0 px-[8px] h-[20px] rounded-full bg-[#fde8e8] text-[10px] font-bold text-[#c0392b] font-['Outfit',sans-serif] flex items-center uppercase tracking-wide">
            Critical
          </span>
        )}
      </div>

      <EventActionButtons
        saved={saved}
        onToggleSave={() => onToggleSave?.()}
        resolved={resolved}
        onToggleResolve={() => onToggleResolve?.()}
        onRequestHiRes={() => setHiResOpen(true)}
        hideHiRes={hiResRequested}
      />

      {/* What changed — a condition transition when this event has one (a
          single record's real before/after), an extent/cover reading when it
          doesn't. Never both invented for an event that only has one. */}
      <div className="rounded-[12px] bg-[#f6f6f8] border border-[#eeeef1] px-[14px] py-[12px] flex flex-col gap-[8px]">
        <span className="text-[10.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
          What changed
        </span>
        {hasConditionBaseline ? (
          <div className="flex items-center gap-[8px]">
            <span className="px-[9px] py-[3px] rounded-full bg-white border border-[#dedee3] text-[12px] font-semibold text-[#464650] font-['Outfit',sans-serif]">
              {CONDITION_LABEL[event.baselineCondition!]}
            </span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#8a8a94]">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="px-[9px] py-[3px] rounded-full bg-[#fde8e8] border border-[#f5c6c6] text-[12px] font-semibold text-[#c0392b] font-['Outfit',sans-serif]">
              {CONDITION_LABEL[event.severity]}
            </span>
            <span className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif]">health decline</span>
          </div>
        ) : hasExtentBaseline ? (
          <div className="flex items-center gap-[8px]">
            <span className="text-[16px] font-bold text-[#18181c] font-['Outfit',sans-serif] tabular-nums">
              {event.extentBaselinePct!.toFixed(0)}%
            </span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#096151]">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[16px] font-bold text-[#096151] font-['Outfit',sans-serif] tabular-nums">
              {event.extentCurrentPct!.toFixed(0)}%
            </span>
            <span className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif]">
              cover {event.extentCurrentPct! >= event.extentBaselinePct! ? "grew" : "shrank"}
            </span>
          </div>
        ) : (
          <p className="text-[12.5px] text-[#3d3d45] font-['Outfit',sans-serif] leading-[18px]">{event.description}</p>
        )}
      </div>

      {/* Habitat change reading — the boundary/permit-conflict narrative and
          every coastal reduction/degradation/extension notification, none of
          which have a per-tree condition or plot-wide extent baseline of
          their own to lead with. Real GPS off the flagged tree/plot record,
          not a fabricated point; area/percent figures grounded the same way
          (see events.ts). */}
      {event.habitatImpact && (
        <HabitatChangeCard event={event} habitatImpact={event.habitatImpact} />
      )}

      {/* Which of the reference key's classes moved, under the card that says
          how much moved in total — modelled, and labelled as such on its own
          face (see HabitatClassChangeBreakdown). Held back until a hi-res
          pass has actually been requested and delivered: this is the kind
          of granular, per-class read a closer capture would newly justify,
          not something to show off the same ±10m imagery every event
          already has. Also renders itself away for any event with no
          hectare figure to apportion. */}
      {event.habitatImpact && hiResRequested && <HabitatClassChangeBreakdown event={event} />}

      {/* Baseline — which month, or which record, this reading is measured
          against. Absent rather than guessed for events with no real one. */}
      <div className="rounded-[12px] bg-[#f6f6f8] border border-[#eeeef1] px-[14px] py-[12px] flex flex-col gap-[4px]">
        <span className="text-[10.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
          Baseline
        </span>
        <p className="text-[12.5px] text-[#3d3d45] font-['Outfit',sans-serif] leading-[18px]">
          {hasConditionBaseline
            ? `Compared against this same record's own ${baselineMonthLabel} reading.`
            : hasExtentBaseline
              ? `Compared against the prior month's plot-wide cover reading.`
              : `This month's own reading — no prior-month baseline applies to this event.`}
        </p>
      </div>

      {/* Confidence — a property of this deployment's own resolution tier,
          not an invented percentage. A per-tree condition transition is a
          measured re-identification (the same record, compared to itself);
          an aggregate milestone or a synthetic count is not, and says so. */}
      <div className="rounded-[12px] bg-[#f6f6f8] border border-[#eeeef1] px-[14px] py-[12px] flex flex-col gap-[4px]">
        <span className="text-[10.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
          Confidence
        </span>
        <p className="text-[12.5px] text-[#3d3d45] font-['Outfit',sans-serif] leading-[18px]">
          {hasConditionBaseline
            ? `High — this is the same identified record compared month over month, a measured transition rather than an inference. At this deployment's current resolution (${currentTier.label}), though, a genuine decline can't be fully separated from a seasonal one — that distinction needs a closer pass.`
            : `Model estimate — this reading comes from ${currentTier.label}'s plot-wide aggregate, not an individually re-identified record.`}
        </p>
      </div>

      {/* Plot-wide backdrop this one event is read against — the same donut
          and trend line Insights already shows for this area, not a fresh
          per-event chart this dataset has no basis for. Only rendered for a
          critical event: an ordinary survey or migration count doesn't need
          "is the whole plot declining too" context the way a flagged
          defoliation does. */}
      {critical && (
        <div className="flex flex-col gap-[10px]">
          <span className="text-[10.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em] px-[2px]">
            Plot-wide context
          </span>
          <HealthScoreTrendChart data={healthScoreTrend} delay={140} minHeight={110} />
        </div>
      )}

      {/* The follow-up CTA — appears once the hi-res pass (requested via
          EventActionButtons' own "Request hi-res analysis" button above)
          has been delivered and dismissed: there's nothing left to
          commission at higher resolution, so the next step this panel can
          put in motion is getting a team out to the ground it flagged. */}
      {hiResRequested && (
        <button
          type="button"
          onClick={() => onIssuePermitForTeam?.()}
          className="u-press mt-[4px] w-full h-[52px] rounded-[16px] flex items-center justify-center gap-[8px] text-white text-[15px] font-bold font-['Outfit',sans-serif] cursor-pointer shadow-[0px_14px_28px_-8px_rgba(34,119,65,0.4)] transition-transform duration-150 hover:-translate-y-[1px]"
          style={{ background: "#227741" }}
        >
          Resolve conflicts with permits
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {hiResOpen && (
        <HiResConfirmation
          projectName={projectName}
          resolution={PROSE_RESOLUTION}
          blockCount={1}
          areaHa={areaHa}
          speciesData={speciesData}
          onDismiss={() => {
            setHiResOpen(false);
            setHiResRequested(true);
            onHiResDelivered?.();
          }}
        />
      )}
    </div>
  );
}
