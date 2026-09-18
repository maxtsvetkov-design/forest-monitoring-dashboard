import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TriageEntry } from "../data/inspectionTriage";
import { SEVERITY_STYLE } from "../data/severity";
import { treePhotoTileFor } from "../data/treePhotoSprite";

/**
 * What "Export to inspection system" actually opens — the package an
 * inspector would hand off (or a real inspection system would ingest): the
 * finding's own geo-tagged imagery, farm id, detection date and violation
 * type, with one action that pushes it out and moves the finding to "in
 * progress" (see `findingOutcome.ts`'s own `hi_res` meta). Nothing here is a
 * live export — no ticketing/GIS backend exists behind this app — so the
 * push is the same session-only confirm-then-set-state pattern every other
 * action button in this app already uses (`EventActionButtons`).
 */

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Same field-row language every other record in this app already reads
 *  (`ViolationRecordModal`'s own rows) — a light hairline, not a rule — just
 *  set bolder: the label a touch heavier and wider-tracked, the value large
 *  and extrabold on its own line rather than sharing the row, so this pack's
 *  own data reads with more weight than a plain label/value pair without
 *  reaching for a different visual language than the rest of the app. */
function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-[8px] border-b border-[#eeeef1] last:border-b-0">
      <span className="text-[9.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.1em]">
        {label}
      </span>
      <p className="text-[15px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[19px] mt-[2px]">
        {value}
      </p>
    </div>
  );
}

export default function EvidencePackModal({
  entry,
  onClose,
  onPushed,
}: {
  entry: TriageEntry;
  onClose: () => void;
  /** Fires once the push "completes" — the caller sets the real outcome
   *  (`hi_res`) and closes the pack; this component owns none of that state
   *  itself. */
  onPushed: () => void;
}) {
  const [pushing, setPushing] = useState(false);
  // Session-only, like every other action here (see this file's own
  // top comment) — there's no inspection-system API behind this to persist
  // it to, so it rides along in the pack only as long as this instance does.
  const [comment, setComment] = useState("");
  const style = SEVERITY_STYLE[entry.severityLabel];
  const imageryTile = treePhotoTileFor(`${entry.event.id}:evidence`);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pushing) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, pushing]);

  function handlePush() {
    setPushing(true);
    // A brief, real state change to look at (the same "flip to confirmed"
    // beat every other action button here uses) before the pack actually
    // hands off — not a network wait, since there is nothing on the other
    // end to wait for.
    window.setTimeout(onPushed, 700);
  }

  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-[1200] bg-black/45 backdrop-blur-[6px] flex items-center justify-center p-4"
      onClick={() => !pushing && onClose()}
    >
      <div
        role="dialog"
        aria-label="Evidence pack"
        className="modal-panel tree-modal pointer-events-auto bg-white rounded-[20px] border border-[#dedee3] shadow-[0px_20px_52px_-12px_rgba(0,0,0,0.3)] w-[640px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[#ebece7] shrink-0"
          style={{ background: `linear-gradient(180deg, ${style.accent}14 0%, rgba(255,255,255,0) 100%)` }}
        >
          <div className="min-w-0">
            <p className="text-[9.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.09em]">
              Export to inspection system
            </p>
            <span className="text-[22px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[26px] mt-[1px] block tracking-[-0.01em]">
              Evidence pack
            </span>
            <p className="text-[12.5px] font-semibold text-[#5b5b66] font-['Outfit',sans-serif] mt-[3px] truncate">
              {entry.farmId} · {entry.violationType}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={pushing}
            onClick={onClose}
            className="u-press w-7 h-7 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] cursor-pointer disabled:opacity-40 disabled:cursor-default shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Two columns split by a light vertical rule — the evidence itself
            on the left, the record and the reviewer's own note on the
            right — the same hairline language as `FieldRow`'s own borders,
            just standing vertically instead of horizontally. */}
        <div className="scroll-slim overflow-y-auto px-5 py-4 grid grid-cols-2 gap-x-[22px]">
          <div className="flex flex-col gap-[10px] min-w-0">
            <div className="relative w-full h-[200px] rounded-[14px] overflow-hidden border border-[#dedee3] bg-[#e5e5e5]">
              <div className="w-full h-full" style={imageryTile} />
              <span className="absolute top-[6px] left-[6px] px-[6px] h-[16px] rounded-full bg-black/55 text-white text-[9px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.04em] flex items-center">
                Placeholder
              </span>
              <span className="absolute bottom-[6px] right-[6px] px-[7px] h-[18px] rounded-full bg-black/55 text-white text-[10px] font-['Outfit',sans-serif] tabular-nums flex items-center gap-[4px]">
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                  <path d="M8 14.5s5-4.4 5-8.2A5 5 0 0 0 3 6.3c0 3.8 5 8.2 5 8.2Z" stroke="white" strokeWidth="1.3" />
                  <circle cx="8" cy="6.2" r="1.7" fill="white" />
                </svg>
                {entry.lat.toFixed(4)}, {entry.lng.toFixed(4)}
              </span>
            </div>
            <p className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif]">
              Geo-tagged imagery — illustrative placeholder, tagged to this finding's own real detection coordinates.
            </p>
            <span
              className="inline-flex items-center gap-[5px] h-[22px] px-[9px] rounded-full text-[10.5px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.05em] w-fit"
              style={{ background: style.bg, color: style.fg }}
            >
              <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: style.dot }} aria-hidden="true" />
              {entry.severityLabel}
            </span>
          </div>

          <div className="flex flex-col min-w-0 pl-[22px] border-l border-[#eeeef1]">
            <FieldRow label="Farm ID" value={entry.farmId} />
            <FieldRow label="Field" value={entry.field} />
            <FieldRow label="Violation type" value={entry.violationType} />
            <FieldRow label="Detection date" value={formatDate(entry.dateDetected)} />
            <FieldRow label="Confidence" value={`${entry.confidencePct}%`} />

            <div className="pt-[10px]">
              <label
                htmlFor="evidence-pack-comment"
                className="text-[9.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.1em]"
              >
                Reviewer comment
              </label>
              <textarea
                id="evidence-pack-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={pushing}
                placeholder="Add context for the inspection team…"
                rows={4}
                className="mt-[6px] w-full resize-none rounded-[10px] border border-[#dedee3] px-[9px] py-[7px] text-[12.5px] font-medium text-[#18181c] font-['Outfit',sans-serif] placeholder:text-[#a1a1aa] focus:outline-none focus:ring-2 focus:ring-[#096151] disabled:opacity-50 disabled:cursor-default"
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#ebece7] shrink-0">
          <button
            type="button"
            disabled={pushing}
            onClick={handlePush}
            className="u-press w-full flex items-center justify-center gap-[7px] h-[40px] rounded-[10px] text-[13.5px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.04em] cursor-pointer disabled:cursor-default transition-colors bg-[#096151] text-white hover:bg-[#0a7761] disabled:bg-[#24A67A]"
          >
            {pushing ? (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Pushed — status set to in progress
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2.5 8h9M8 3.5 13 8l-5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Push to inspection system
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
