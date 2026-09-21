import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { TriageEntry } from "../data/inspectionTriage";
import { SEVERITY_STYLE } from "../data/severity";
import { CONDITION_COLOR, CROP_CONDITION_LABEL } from "../data/taxonomy";
import { treePhotoTileFor } from "../data/treePhotoSprite";
import {
  COLLAPSE_ANIMATION_MS,
  placePopover,
  playCollapseAnimation,
  POPOVER_MAX_HEIGHT,
  POPOVER_WIDTH,
  VIEWPORT_PADDING,
} from "./TreeHistoryModal";
import FindingOutcomeActions from "./FindingOutcomeActions";
import { OUTCOME_META, type FindingOutcome } from "../data/findingOutcome";
import { cropLabelFor, cropScientificNameFor } from "../data/cropVocabulary";

/**
 * Liwa Oasis's own "expand a violation pin" record — what `TreeHistoryModal`
 * would otherwise show for a clicked pin, but for the one case where that
 * pin is the exact tree a compliance scan actually flagged (see MapCanvas's
 * `violationByTreeId`). A forest condition scorecard has nothing to say
 * about a farm violation; this shows what an inspector deciding whether the
 * finding is real actually needs:
 *
 * - before/after imagery at the detection point — placeholder photos (this
 *   app has no dated satellite archive to pull a genuine pair from), clearly
 *   badged as such rather than presented as a real captured comparison,
 *   captioned with the real baseline/detected months and coordinates,
 * - what changed, read off this exact tree's own real `conditionHistory`
 *   (baseline month vs. the month the finding was logged), not a second
 *   invented number,
 * - this field's own flag history — every compliance finding ever logged
 *   against the same block, so a one-off flag reads differently from a
 *   third recurrence in six months.
 */

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SeverityPill({ label }: { label: TriageEntry["severityLabel"] }) {
  const style = SEVERITY_STYLE[label];
  return (
    <span
      className="inline-flex items-center gap-[5px] px-[8px] h-[20px] rounded-full text-[10.5px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.03em] whitespace-nowrap shrink-0"
      style={{ background: style.bg, color: style.fg }}
    >
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: style.dot }} aria-hidden="true" />
      {label}
    </span>
  );
}

export default function ViolationRecordModal({
  entry,
  fieldHistory,
  monthLabels,
  anchor,
  onClose,
  onFlyToPin,
  onCollapse,
  outcome,
  onSetOutcome,
  onRequestHiRes,
  areaId,
}: {
  entry: TriageEntry;
  /** Every violation on record for this same field, newest first — includes
   *  `entry` itself. */
  fieldHistory: TriageEntry[];
  /** This area's month labels, for the baseline/detected captions below. */
  monthLabels: string[];
  anchor: { x: number; y: number };
  onClose: () => void;
  onFlyToPin?: () => void;
  onCollapse?: () => void;
  /** This finding's accept/dismiss/hi-res decision — shared with the ranked
   *  worklist's own copy of the same finding, see MapCanvas's
   *  `findingOutcomes`. */
  outcome: FindingOutcome | null;
  onSetOutcome: (eventId: string, outcome: FindingOutcome | null) => void;
  /** Opens the evidence pack for this finding — see AssetsView's
   *  `evidencePackEntry`. */
  onRequestHiRes: (entry: TriageEntry) => void;
  /** Crop Monitor's own species relabeling (see cropVocabulary.ts) applies
   *  only when this is that area — Liwa Oasis keeps the real botanical
   *  species/scientific name unchanged. */
  areaId?: string;
}) {
  const isCropMonitor = areaId === "liwa-crop-monitor";
  const speciesLabel = isCropMonitor ? cropLabelFor(entry.event.tree.species) : entry.event.tree.species;
  const scientificLabel = isCropMonitor
    ? cropScientificNameFor(entry.event.tree.species)
    : entry.event.tree.scientificName;
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const style = SEVERITY_STYLE[entry.severityLabel];
  // Two distinct placeholder tiles from the same real drone-photo sprite
  // every tree avatar in this app already draws from — seeded off this
  // finding's own event id plus "before"/"after" so the pair is stable
  // across reloads and the two tiles never coincidentally match.
  const beforeTile = treePhotoTileFor(`${entry.event.id}:before`);
  const afterTile = treePhotoTileFor(`${entry.event.id}:after`);

  const detectedIndex = entry.event.monthIndex;
  const baselineIndex = Math.max(0, detectedIndex - 1);
  const history = entry.event.tree.conditionHistory;
  const baselineCondition = history[baselineIndex];
  const detectedCondition = history[detectedIndex];
  const baselineLabel = monthLabels[baselineIndex] ?? "earlier";
  const detectedLabel = monthLabels[detectedIndex] ?? "this month";

  const maxHeight = Math.min(POPOVER_MAX_HEIGHT, window.innerHeight - VIEWPORT_PADDING * 2);
  const { left, top } = placePopover(anchor, maxHeight);

  const dialogRef = useRef<HTMLDivElement>(null);
  // Width/height are handed to the DOM exactly once, imperatively, rather
  // than through React's own `style` prop — `left`/`top` stay reactive
  // (the popover tracks the pin through pan/zoom, see MapCanvas's
  // `onFocusMove`), but a size React re-applied on every render would wipe
  // out the reader's own drag the instant anything else in the record
  // re-rendered (accepting the finding, typing in the outcome, etc). Setting
  // it once and then leaving those two properties alone lets the browser's
  // native `resize` own them for the rest of this popover's life.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.style.width = `${POPOVER_WIDTH}px`;
    el.style.height = `${maxHeight}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-[1100] bg-black/35 backdrop-blur-[4px] pointer-events-auto"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.farmId} violation record`}
        style={{ left, top }}
        className="modal-panel tree-modal pointer-events-auto absolute bg-white rounded-[20px] border border-[#dedee3] shadow-[0px_20px_52px_-12px_rgba(0,0,0,0.3)] max-w-[92vw] max-h-[92vh] min-w-[340px] min-h-[260px] flex flex-col overflow-hidden resize"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[#ebece7] shrink-0"
          style={{ background: `linear-gradient(180deg, ${style.accent}14 0%, rgba(255,255,255,0) 100%)` }}
        >
          <div className="min-w-0">
            <p className="text-[9.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.09em]">
              Compliance finding
            </p>
            <button
              type="button"
              onClick={onFlyToPin}
              disabled={!onFlyToPin}
              className="u-press inline-flex items-center gap-[7px] text-[19px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] hover:text-[#096151] leading-[24px] mt-[1px] cursor-pointer disabled:cursor-default group"
              title={onFlyToPin ? "Re-centre the map on this tree" : undefined}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                className="shrink-0 text-[#096151] group-hover:scale-110 transition-transform"
              >
                <path
                  d="M8 1v3M8 12v3M1 8h3M12 8h3M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <span className="group-hover:underline">{entry.farmId}</span>
            </button>
            <p className="text-[12.5px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[3px] truncate">
              Field {entry.field} · {entry.violationType}
            </p>
          </div>
          <div className="flex items-center gap-[2px] shrink-0">
            {onCollapse && (
              <button
                type="button"
                aria-label="Collapse to compact view"
                title="Collapse to compact view"
                onClick={(e) => {
                  playCollapseAnimation(e.currentTarget);
                  window.setTimeout(onCollapse, COLLAPSE_ANIMATION_MS);
                }}
                className="u-press w-7 h-7 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M6.5 2v3a1.5 1.5 0 0 1-1.5 1.5H2M9.5 2v3A1.5 1.5 0 0 0 11 6.5h3M6.5 14v-3A1.5 1.5 0 0 0 5 9.5H2M9.5 14v-3A1.5 1.5 0 0 1 11 9.5h3"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="u-press w-7 h-7 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="scroll-slim overflow-y-auto px-5 py-3.5 flex flex-col gap-4">
          {/* Confidence + severity — the two headline figures the ranked
              worklist and its cards lead with, given the same scorecard
              weight `TreeScorecard` gives a forest tree's own condition. */}
          <div
            className="animate-fade-in-up rounded-[16px] p-3.5 flex items-center justify-between gap-3"
            style={{ background: `linear-gradient(135deg, ${style.accent}16 0%, rgba(255,255,255,0) 65%)` }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0 w-[52px] h-[52px]">
                <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90">
                  <circle cx="26" cy="26" r="22" fill="none" stroke="#eeeef1" strokeWidth="5" />
                  <circle
                    cx="26"
                    cy="26"
                    r="22"
                    fill="none"
                    stroke={style.accent}
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 22}
                    strokeDashoffset={2 * Math.PI * 22 * (1 - entry.confidencePct / 100)}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[13px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] tabular-nums">
                  {entry.confidencePct}%
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[9.5px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
                  Scan confidence
                </p>
                <SeverityPill label={entry.severityLabel} />
              </div>
            </div>
            <span className="text-[11px] text-[#8a8a94] font-['Outfit',sans-serif] text-right shrink-0">
              Detected
              <br />
              <span className="font-semibold text-[#464650]">{formatDate(entry.dateDetected)}</span>
            </span>
          </div>

          {/* This exact palm's own real horticultural data — nothing
              invented, all read straight off the same tree record the map
              pin itself carries, so a reader gets what's actually being
              flagged, not just an abstract score. */}
          <div className="animate-fade-in-up" style={{ animationDelay: "40ms" }}>
            <p className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">Crop record</p>
            <div className="grid grid-cols-3 gap-[8px]">
              <div className="rounded-[10px] border border-[#eeeef1] bg-[#f9f9fb] px-[10px] py-[8px]">
                <p className="text-[9px] font-semibold text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
                  Species
                </p>
                <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif] mt-[2px] truncate">
                  {speciesLabel}
                </p>
                <p className="text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] italic truncate">
                  {scientificLabel}
                </p>
              </div>
              <div className="rounded-[10px] border border-[#eeeef1] bg-[#f9f9fb] px-[10px] py-[8px]">
                <p className="text-[9px] font-semibold text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
                  Height · crown
                </p>
                <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif] mt-[2px]">
                  {entry.event.tree.height} m <span className="text-[#c4c4cc] font-normal">·</span>{" "}
                  {entry.event.tree.crownRadius} m
                </p>
                <p className="text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif]">{entry.event.tree.diameter}</p>
              </div>
              <div className="rounded-[10px] border border-[#eeeef1] bg-[#f9f9fb] px-[10px] py-[8px]">
                <p className="text-[9px] font-semibold text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
                  Canopy retained
                </p>
                <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif] mt-[2px]">
                  {100 - entry.event.tree.canopyLossPct}%
                </p>
                <p className="text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif]">
                  Last surveyed {entry.event.tree.lastSurveyed}
                </p>
              </div>
            </div>
          </div>

          {/* Before/after imagery at the detection point — placeholder
              photos, clearly badged, since this app has no dated satellite
              archive to pull a genuine pair from. The real numbers (which
              months, what condition) live in the section below this one;
              these tiles are illustrative, not the evidence. */}
          <div className="animate-fade-in-up" style={{ animationDelay: "80ms" }}>
            <p className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">
              Before / after at the detection point
            </p>
            <div className="grid grid-cols-2 gap-[8px]">
              <div>
                <div className="relative w-full aspect-square rounded-[14px] overflow-hidden border border-[#dedee3] bg-[#e5e5e5]">
                  <div className="w-full h-full" style={beforeTile} />
                  <span className="absolute top-[6px] left-[6px] px-[6px] h-[16px] rounded-full bg-black/55 text-white text-[9px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.04em] flex items-center">
                    Placeholder
                  </span>
                </div>
                <p className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] mt-[4px] text-center">
                  Before · {baselineLabel}
                </p>
              </div>
              <div>
                <div className="relative w-full aspect-square rounded-[14px] overflow-hidden border border-[#dedee3] bg-[#e5e5e5]">
                  <div className="w-full h-full" style={afterTile} />
                  <span className="absolute top-[6px] left-[6px] px-[6px] h-[16px] rounded-full bg-black/55 text-white text-[9px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.04em] flex items-center">
                    Placeholder
                  </span>
                </div>
                <p className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] mt-[4px] text-center">
                  After · {detectedLabel}
                </p>
              </div>
            </div>
            <p className="text-[10.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[15px] mt-[6px]">
              Illustrative placeholders — this app has no dated satellite archive for ({entry.lat.toFixed(4)},{" "}
              {entry.lng.toFixed(4)}). The real baseline and detected condition are read from the record below.
            </p>
          </div>

          {/* What changed, against which baseline — this exact tree's own
              real condition history, not a fabricated comparison. */}
          <div className="animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            <p className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">
              What changed, against baseline
            </p>
            <div className="flex items-stretch gap-[10px]">
              <div className="flex-1 rounded-[10px] border border-[#eeeef1] bg-[#f9f9fb] px-[10px] py-[8px]">
                <p className="text-[9.5px] font-semibold text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.08em]">
                  Baseline · {baselineLabel}
                </p>
                <div className="flex items-center gap-[6px] mt-[3px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CONDITION_COLOR[baselineCondition] }} />
                  <span className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
                    {CROP_CONDITION_LABEL[baselineCondition]}
                  </span>
                </div>
              </div>
              <div className="flex items-center text-[#8a8a94]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="flex-1 rounded-[10px] border border-[#eeeef1] bg-[#f9f9fb] px-[10px] py-[8px]">
                <p className="text-[9.5px] font-semibold text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.08em]">
                  Detected · {detectedLabel}
                </p>
                <div className="flex items-center gap-[6px] mt-[3px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CONDITION_COLOR[detectedCondition] }} />
                  <span className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
                    {CROP_CONDITION_LABEL[detectedCondition]}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11.5px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] mt-[8px]">
              {entry.event.description}
            </p>
          </div>

          {/* Farm's flag history — every finding on record for this same
              field, so a one-off reads differently from a pattern. */}
          <div className="animate-fade-in-up" style={{ animationDelay: "160ms" }}>
            <p className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">
              Flag history · Field {entry.field}{" "}
              <span className="font-normal text-[#8a8a94]">
                ({fieldHistory.length} finding{fieldHistory.length === 1 ? "" : "s"} on record)
              </span>
            </p>
            <div className="flex flex-col">
              {fieldHistory.map((h, i) => {
                const isThis = h.event.id === entry.event.id;
                return (
                  <div key={h.event.id} className="relative flex gap-3 pb-2 last:pb-0">
                    <div className="flex flex-col items-center shrink-0 w-[10px]">
                      <span
                        className="w-[8px] h-[8px] rounded-full mt-[3px] shrink-0"
                        style={{ background: SEVERITY_STYLE[h.severityLabel].accent }}
                      />
                      {i < fieldHistory.length - 1 && <span className="w-px flex-1 bg-[#dedee3] mt-[2px]" />}
                    </div>
                    <div className={`min-w-0 pb-1 flex-1 ${isThis ? "rounded-[8px] bg-[#f0f9f5] -mx-[6px] px-[6px]" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-[#18181c] font-['Outfit',sans-serif] truncate">
                          {h.violationType}
                          {isThis && <span className="text-[#096151] font-semibold"> · this finding</span>}
                        </span>
                        <span className="text-[10px] text-[#71717a] font-['Outfit',sans-serif] shrink-0">
                          {formatDate(h.dateDetected)}
                        </span>
                      </div>
                      {isThis && outcome && (
                        <div className="flex items-center gap-[5px] mt-[3px] animate-fade-in">
                          <span
                            className="inline-flex items-center gap-[4px] h-[16px] px-[6px] rounded-full text-[9px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.03em]"
                            style={{ background: OUTCOME_META[outcome].bg, color: OUTCOME_META[outcome].fg }}
                          >
                            {outcome === "hi_res" ? "In progress" : "Closed"}
                          </span>
                          <span className="text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif]">
                            Outcome recorded against the farm — history updated for audit.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* The one decision this record exists to support. */}
        <div className="px-4 py-2.5 border-t border-[#ebece7] shrink-0">
          <FindingOutcomeActions
            id={entry.event.id}
            outcome={outcome}
            onSetOutcome={onSetOutcome}
            onRequestHiRes={() => onRequestHiRes(entry)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
