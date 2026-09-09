import { useState } from "react";
import { createPortal } from "react-dom";
import { CONDITION_COLOR, CONDITION_LABEL, CONDITIONS } from "../data/taxonomy";
import type { TreeRecord } from "../data/trees";
import ManagerContactToast from "./ManagerContactToast";

/**
 * Everything known about one tree, shown beside its own modelled twin.
 *
 * This is the readout half of the digital twin: the map shows the tree at eye
 * level, this shows the record behind it. Deliberately every field of
 * `TreeRecord` that means something to a reader rather than a curated
 * few — the point of drilling into a single tree is that you stop choosing
 * which of its numbers matter.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * The two things a reader can actually do about the tree they are standing in
 * front of. Phrased and acknowledged as *requests*, not completions — there is
 * no field-scheduling or analysis backend behind either, and the honest answer
 * to a click is "logged, here is what happens next" rather than a fabricated
 * "done" (the same reasoning ManagerContactToast carries in its own header).
 *
 * `detail` takes the tree so the confirmation names what was actually sent,
 * which is the difference between an acknowledgement and a decoration.
 */
const TWIN_ACTIONS: {
  key: string;
  label: string;
  primary?: boolean;
  title: string;
  detail: (tree: TreeRecord) => string;
  icon: React.ReactElement;
}[] = [
  {
    key: "team",
    label: "Send to team",
    primary: true,
    title: "Sent to the field team.",
    detail: (tree) =>
      `We've logged ${tree.species} ${tree.id} for a field visit — expect the team to confirm a window within one business day.`,
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5}>
        <path d="M14 2 7.2 8.8" />
        <path d="M14 2l-4.6 12-2.2-5.2L2 6.6 14 2Z" />
      </svg>
    ),
  },
  {
    key: "analysis",
    label: "Request analysis",
    title: "Analysis requested.",
    detail: (tree) =>
      `We've logged a closer look at ${tree.id}'s canopy history — expect findings within one business day.`,
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5}>
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.4 10.4 14 14" />
      </svg>
    ),
  },
];

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-[10px] py-[5px] border-b border-white/10 last:border-b-0">
      <span className="text-[11px] text-white/55 font-['Outfit',sans-serif] leading-[15px] shrink-0">{label}</span>
      <span
        className={`text-[12px] text-white font-['Outfit',sans-serif] leading-[16px] text-right min-w-0 ${
          mono ? "tabular-nums" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The tree's condition in each month of the window, oldest first — one bar per
 * month in that month's own condition colour.
 *
 * A twelve-band strip rather than a line chart because condition is ordinal,
 * not continuous: there is no meaningful value *between* Sparse and Moderate
 * to draw a slope through, and the colours are the same ones the map, the
 * legend and the table already use for these bands.
 */
function ConditionHistory({ history, months }: { history: TreeRecord["conditionHistory"]; months: string[] }) {
  return (
    <div className="flex gap-[2px] mt-[2px]">
      {history.map((condition, i) => (
        <span
          key={i}
          title={`${months[i] ?? `Month ${i + 1}`} · ${CONDITION_LABEL[condition]}`}
          className="flex-1 h-[16px] rounded-[2px]"
          style={{ background: CONDITION_COLOR[condition] }}
        />
      ))}
    </div>
  );
}

export default function TreeTwinCard({
  tree,
  months,
  onExit,
}: {
  tree: TreeRecord;
  /** Month labels for the window, to name the bands in the history strip. */
  months: string[];
  onExit: () => void;
}) {
  // Which action's acknowledgement is showing, by key — not a boolean, since
  // the two actions promise different things and a shared "requested" toast
  // would tell the reader nothing about which one they pressed.
  const [firedAction, setFiredAction] = useState<string | null>(null);
  const fired = TWIN_ACTIONS.find((a) => a.key === firedAction) ?? null;

  const condition = CONDITIONS.find((c) => c.key === tree.condition);
  const first = tree.conditionHistory[0];
  const now = tree.conditionHistory[tree.conditionHistory.length - 1] ?? tree.condition;
  // Rank, not raw index: CONDITIONS is ordered worst-first, so a *lower*
  // index is a worse band and "improved" means the index went down.
  const rankOf = (key: typeof now) => CONDITIONS.findIndex((c) => c.key === key);
  const drift = rankOf(now) - rankOf(first);

  return (
    <div className="absolute right-[14px] top-[14px] bottom-[14px] z-20 w-[264px] max-w-[calc(100%-28px)] flex flex-col rounded-[14px] bg-black/72 backdrop-blur-[6px] border border-white/12 shadow-[0_18px_44px_rgba(0,0,0,0.45)] overflow-hidden animate-fade-in-up">
      <div className="flex items-start justify-between gap-[8px] px-[14px] pt-[13px] pb-[11px] border-b border-white/12">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.09em] text-white/45 font-['Outfit',sans-serif] leading-[14px]">
            Digital twin
          </p>
          <p className="text-[17px] font-bold text-white font-['Outfit',sans-serif] leading-[22px] tabular-nums">
            {tree.id}
          </p>
        </div>
        <button
          type="button"
          onClick={onExit}
          title="Back to the plot"
          aria-label="Exit the digital twin"
          className="u-press shrink-0 w-[26px] h-[26px] rounded-[8px] flex items-center justify-center border border-white/20 text-white/80 hover:bg-white/12 cursor-pointer"
        >
          <svg width="11" height="11" viewBox="0 0 10 10" {...stroke}>
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-slim px-[14px] py-[11px]">
        <div className="flex items-center gap-[7px]">
          <span
            className="w-[9px] h-[9px] rounded-full shrink-0"
            style={{ background: CONDITION_COLOR[tree.condition] }}
          />
          <span className="text-[13px] font-semibold text-white font-['Outfit',sans-serif] leading-[18px]">
            {CONDITION_LABEL[tree.condition]}
          </span>
          {condition?.flagged && (
            <span className="text-[9px] uppercase tracking-[0.07em] font-bold text-[#ffb4ae] border border-[#ffb4ae]/40 rounded-full px-[6px] py-[1px] font-['Outfit',sans-serif]">
              Flagged
            </span>
          )}
        </div>

        <p className="text-[12px] text-white/70 font-['Outfit',sans-serif] leading-[17px] mt-[4px]">
          {tree.species} · <span className="italic">{tree.scientificName}</span>
        </p>

        <div className="mt-[12px]">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/40 font-['Outfit',sans-serif] leading-[14px]">
            Condition over the window
          </p>
          <ConditionHistory history={tree.conditionHistory} months={months} />
          <p className="text-[11px] text-white/55 font-['Outfit',sans-serif] leading-[15px] mt-[5px]">
            {drift === 0
              ? `Held at ${CONDITION_LABEL[now]} across the window.`
              : drift > 0
                ? `Improved from ${CONDITION_LABEL[first]} to ${CONDITION_LABEL[now]}.`
                : `Declined from ${CONDITION_LABEL[first]} to ${CONDITION_LABEL[now]}.`}
          </p>
        </div>

        <div className="mt-[12px]">
          <Row label="Genus" value={tree.genus} />
          <Row label="Height" value={`${tree.height} m`} mono />
          <Row label="Crown radius" value={`${tree.crownRadius} m`} mono />
          <Row label="Crown class" value={tree.diameter} />
          <Row label="Canopy loss" value={`${tree.canopyLossPct}%`} mono />
          <Row label="Last surveyed" value={tree.lastSurveyed} />
          <Row label="Position" value={`${tree.lat.toFixed(5)}, ${tree.lng.toFixed(5)}`} mono />
          <Row
            label="Dieback block"
            value={tree.declineZoneId === null ? "Outside every block" : `Block ${tree.declineZoneId + 1}`}
          />
        </div>
      </div>

      {/* Actions, pinned below the scrolling record rather than inside it: the
          reader should not have to reach the bottom of a long readout to find
          out that anything can be done about the tree. `shrink-0` keeps them
          out of the flex-1 scroller above. */}
      <div className="shrink-0 flex items-center gap-[7px] px-[14px] py-[11px] border-t border-white/12">
        {TWIN_ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => setFiredAction(action.key)}
            title={`${action.label} — ${tree.id}`}
            className={`u-press flex-1 min-w-0 inline-flex items-center justify-center gap-[5px] h-[30px] px-[8px] rounded-[9px] text-[11px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-150 ${
              action.primary
                ? "bg-white text-[#18181c] hover:bg-white/88"
                : "border border-white/25 text-white/85 hover:bg-white/12"
            }`}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      {fired &&
        // Portalled, like every other caller of this toast: the card sits
        // inside the map container, which sits under a `view-enter-soft`
        // transform — and a transform on any ancestor gives a `fixed` toast a
        // containing block that is not the viewport.
        createPortal(
          <ManagerContactToast
            title={fired.title}
            detail={fired.detail(tree)}
            onDismiss={() => setFiredAction(null)}
          />,
          document.body,
        )}
    </div>
  );
}
