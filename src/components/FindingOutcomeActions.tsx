import { OUTCOME_META, type FindingOutcome } from "../data/findingOutcome";

/** Once a finding has an outcome, the three buttons collapse into one chip
 *  naming it — a "Change" link reopens the choice rather than the three
 *  buttons staying visible beside a decision that already answered them. */
function OutcomeChip({ outcome, onReset }: { outcome: FindingOutcome; onReset: () => void }) {
  const meta = OUTCOME_META[outcome];
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="inline-flex items-center gap-[6px] h-[24px] px-[10px] rounded-full text-[11px] font-bold font-['Outfit',sans-serif]"
        style={{ background: meta.bg, color: meta.fg }}
      >
        {outcome === "accepted" && (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {outcome === "false_positive" && (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
        {outcome === "hi_res" && (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="8" cy="8" r="1.6" fill="currentColor" />
          </svg>
        )}
        {meta.label}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onReset();
        }}
        className="u-press text-[11px] font-medium text-[#71717a] hover:text-[#18181c] font-['Outfit',sans-serif] cursor-pointer shrink-0"
      >
        Change
      </button>
    </div>
  );
}

/**
 * The three-way decision every flagged tree/finding needs — full labels for
 * a card or the expanded record, icon-only for a dense table row (see
 * `compact`). Deliberately generic (just an `id` to key the outcome by):
 * Liwa's compliance findings pass their own event id and an `onRequestHiRes`
 * that opens `EvidencePackModal`; a plain flagged tree elsewhere (no
 * compliance record behind it) passes its tree id and omits
 * `onRequestHiRes`, so "Export to inspection system" just sets the outcome
 * directly instead of opening a pack with no farm data to show.
 */
export default function FindingOutcomeActions({
  id,
  outcome,
  onSetOutcome,
  onRequestHiRes,
  compact = false,
}: {
  id: string;
  outcome: FindingOutcome | null;
  onSetOutcome: (id: string, outcome: FindingOutcome | null) => void;
  /** Opens an evidence pack instead of setting the outcome immediately —
   *  omit where there's no such pack to show. */
  onRequestHiRes?: () => void;
  compact?: boolean;
}) {
  const eventId = id;
  const requestHiRes = () => (onRequestHiRes ? onRequestHiRes() : onSetOutcome(eventId, "hi_res"));

  if (outcome) {
    if (compact) {
      const meta = OUTCOME_META[outcome];
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetOutcome(eventId, null);
          }}
          title={`${meta.label} — click to change`}
          className="u-press inline-flex items-center h-[22px] px-[8px] rounded-full text-[10px] font-bold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer"
          style={{ background: meta.bg, color: meta.fg }}
        >
          {meta.shortLabel}
        </button>
      );
    }
    return <OutcomeChip outcome={outcome} onReset={() => onSetOutcome(eventId, null)} />;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-[4px]" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          title="Accept as a finding"
          onClick={() => onSetOutcome(eventId, "accepted")}
          className="u-press w-[22px] h-[22px] flex items-center justify-center rounded-full bg-[#096151] text-white hover:bg-[#0a7761] cursor-pointer transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          title="Dismiss as false positive"
          onClick={() => onSetOutcome(eventId, "false_positive")}
          className="u-press w-[22px] h-[22px] flex items-center justify-center rounded-full bg-[#18181c] text-white hover:bg-[#2c2c33] cursor-pointer transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          title="Export to inspection system"
          onClick={requestHiRes}
          className="u-press w-[22px] h-[22px] flex items-center justify-center rounded-full bg-[#2f6fed] text-white hover:bg-[#4a80f5] cursor-pointer transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path
              d="M2.5 8h9M8 3.5 13 8l-5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-[8px]" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => onSetOutcome(eventId, "accepted")}
        className="u-press flex-1 min-w-[110px] flex items-center justify-center gap-[7px] px-[10px] h-[34px] rounded-full text-[11.5px] font-bold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer bg-[#096151] text-white hover:bg-[#0a7761] transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Accept as a finding
      </button>
      <button
        type="button"
        onClick={() => onSetOutcome(eventId, "false_positive")}
        className="u-press flex-1 min-w-[110px] flex items-center justify-center gap-[7px] px-[10px] h-[34px] rounded-full text-[11.5px] font-bold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer bg-[#18181c] text-white hover:bg-[#2c2c33] transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Dismiss as false positive
      </button>
      <button
        type="button"
        onClick={requestHiRes}
        className="u-press flex-1 min-w-[110px] flex items-center justify-center gap-[7px] px-[10px] h-[34px] rounded-full text-[11.5px] font-bold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer bg-[#2f6fed] text-white hover:bg-[#4a80f5] transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M2.5 8h9M8 3.5 13 8l-5 4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Export to inspection system
      </button>
    </div>
  );
}
