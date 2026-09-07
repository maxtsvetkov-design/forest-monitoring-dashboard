import { CONDITION_COLOR, CONDITION_LABEL, CONDITIONS } from "../data/taxonomy";
import type { TreeRecord } from "../data/trees";

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
    </div>
  );
}
