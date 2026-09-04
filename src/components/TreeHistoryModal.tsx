import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TreeEvent } from "../data/events";
import { generateTreeHistory } from "../data/treeHistory";
import type { TreeRecord } from "../data/trees";
import type { HealthKey } from "../data/types";
import { CONDITIONS, CONDITION_COLOR } from "../data/taxonomy";

const SEVERITY_COLOR = CONDITION_COLOR;

/** Display label back to its key — the inverse of CONDITION_LABEL, built from
 * it so the two can't drift. */
const HEALTH_KEY: Record<string, HealthKey> = Object.fromEntries(
  CONDITIONS.map((c) => [c.label, c.key]),
);

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Opened from a Recent Events row after MapCanvas has flown to that event's
 * tree (see App.tsx's pendingTreeFocus) — a portal to document.body so it sits
 * above the map and everything else, the same reasoning as MapCanvas's own
 * pin tooltip.
 */
const POPOVER_WIDTH = 360;
const POPOVER_MAX_HEIGHT = 480;
// The ring drawn on the focused tree (.tree-focus in index.css) is 30px
// across; the gap has to clear its radius plus a visible seam, not just be an
// arbitrary margin, or the card's edge lands on top of the ring it's pointing at.
const RING_RADIUS = 15;
const POPOVER_GAP = RING_RADIUS + 10;
const VIEWPORT_PADDING = 12;

/** Clamps the popover's top-left so it stays fully on screen, preferring a
 * position beside (never directly over) the pin it points at. */
function placePopover(anchor: { x: number; y: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Default: to the right of the pin, vertically centred on it.
  let left = anchor.x + POPOVER_GAP;
  let top = anchor.y - POPOVER_MAX_HEIGHT / 2;
  // Flip to the left of the pin if there's no room on the right.
  if (left + POPOVER_WIDTH + VIEWPORT_PADDING > vw) {
    left = anchor.x - POPOVER_GAP - POPOVER_WIDTH;
  }
  left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - POPOVER_WIDTH - VIEWPORT_PADDING));
  top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - POPOVER_MAX_HEIGHT - VIEWPORT_PADDING));
  return { left, top };
}

/** One of the popover's two footer actions. There's no ticketing/mail backend
 * behind either yet, so a click flips the button into a brief confirmed state
 * instead of firing a request — real feedback that something happened, rather
 * than a dead button or a silent no-op. */
function CTAButton({
  label,
  confirmedLabel,
  icon,
  variant,
}: {
  label: string;
  confirmedLabel: string;
  icon: ReactNode;
  variant: "primary" | "secondary";
}) {
  const [sent, setSent] = useState(false);
  return (
    <button
      type="button"
      disabled={sent}
      onClick={() => {
        setSent(true);
        window.setTimeout(() => setSent(false), 2600);
      }}
      className={`u-press flex-1 flex items-center justify-center gap-[6px] px-[10px] py-[8px] rounded-[9px] text-[12px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer disabled:cursor-default ${
        variant === "primary"
          ? "bg-[#096151] text-white hover:bg-[#0a7761] disabled:bg-[#24A67A]"
          : "border border-[#dedee3] text-[#18181c] hover:bg-[#ebece7] disabled:bg-[#f0f9f5] disabled:border-[#bfe3d3] disabled:text-[#096151]"
      }`}
    >
      {sent ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        icon
      )}
      {sent ? confirmedLabel : label}
    </button>
  );
}

/**
 * Compact counterpart to the full modal below — what App.tsx swaps in when a
 * Recent Events-opened modal is collapsed (see its `onCollapse`), so the two
 * views read as one popover switching size rather than unrelated components.
 * Visually mirrors MapCanvas's own pin-click tooltip; kept separate because
 * that one is driven by a `TreePin` (map-only fields) where this is driven by
 * a full `TreeRecord`, and the two aren't worth unifying for one extra prop.
 */
export function TreeMiniPopover({
  tree,
  x,
  y,
  onClose,
  onExpand,
}: {
  tree: TreeRecord;
  x: number;
  y: number;
  onClose: () => void;
  onExpand: () => void;
}) {
  const color = SEVERITY_COLOR[HEALTH_KEY[tree.health]];
  return createPortal(
    <div
      className="fixed z-[1100] -translate-x-1/2 -translate-y-full bg-white rounded-[12px] px-3 py-2 min-w-[160px] shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.12),0px_6px_20px_-4px_rgba(0,0,0,0.12)] font-['Outfit',sans-serif] animate-fade-in"
      style={{ left: x, top: y - 14 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute top-1 right-1 flex items-center gap-[2px]">
        <button
          type="button"
          aria-label="Expand"
          title="Show full history"
          onClick={onExpand}
          className="w-5 h-5 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path
              d="M9.5 2h4.5v4.5M14 2 9 7M6.5 14H2V9.5M2 14l5-5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="text-[13px] font-bold text-[#18181c] mb-1 pr-10">{tree.id}</div>
      <div className="flex items-center gap-[6px] mb-[6px]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[12px] font-medium" style={{ color }}>
          {tree.health}
        </span>
      </div>
      <div className="text-[12px] text-[#464650]">
        Canopy loss: <strong>{tree.canopyLossPct}%</strong>
      </div>
      <div className="text-[11px] text-[#5b5b66] mt-[2px]">Last surveyed {tree.lastSurveyed}</div>
      {/* Pointer tail, mirrors the full modal's own edge cases — points down
          at the pin this is anchored to. */}
      <div className="absolute left-1/2 top-full -translate-x-1/2 -mt-px w-2 h-2 bg-white border-r border-b border-[#dedee3] rotate-45" />
    </div>,
    document.body,
  );
}

export default function TreeHistoryModal({
  tree,
  event,
  anchor,
  onClose,
  onFlyToPin,
  onCollapse,
}: {
  tree: TreeRecord;
  /** The notification that opened this popover, when it was opened from a
   * Recent Events row — omitted when opened by expanding a plain pin click,
   * which has nothing to report beyond the tree itself. */
  event?: TreeEvent | null;
  /** Viewport position of the tree this popover is about — see App.tsx's
   * modalAnchor, kept live by MapCanvas's onFocusMove so this tracks the pin
   * through pan/zoom instead of a one-shot position that drifts. */
  anchor: { x: number; y: number };
  onClose: () => void;
  onFlyToPin?: () => void;
  /** Collapses back to the compact pin popover, in place — omit to hide the
   * affordance for a caller that has no compact form to collapse into. */
  onCollapse?: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const color = SEVERITY_COLOR[HEALTH_KEY[tree.health]];
  const history = generateTreeHistory(tree);
  const { left, top } = placePopover(anchor);

  // No backdrop: this floats beside the pin rather than blocking the map, so
  // the map stays fully interactive — pan, zoom, and other pins keep working
  // with the popover open. `pointer-events-none` on the wrapper (sized to the
  // whole viewport only so `fixed` positioning has a containing block) keeps
  // it from intercepting clicks anywhere outside the card itself.
  return createPortal(
    <div className="fixed inset-0 z-[1100] pointer-events-none">
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`Tree ${tree.id} history`}
        style={{ left, top, width: POPOVER_WIDTH, maxHeight: POPOVER_MAX_HEIGHT }}
        className="tree-modal pointer-events-auto absolute bg-white rounded-[14px] border border-[#dedee3] shadow-[0px_12px_36px_-8px_rgba(0,0,0,0.25)] max-w-[92vw] flex flex-col overflow-hidden animate-fade-in"
        // The pin tooltip this can collapse into stops its own clicks from
        // bubbling for the same reason — a click on a header/footer button
        // here must not reach the map's "click anywhere outside closes the
        // tooltip" listener and immediately close what was just opened.
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: the tree id doubles as the "link to the pin" the modal was
            asked to carry — clicking it re-centres the map in case the user
            panned away while reading. */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-[#ebece7] shrink-0">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onFlyToPin}
              disabled={!onFlyToPin}
              className="u-press inline-flex items-center gap-[6px] text-[15px] font-bold text-[#096151] font-['Outfit',sans-serif] hover:underline cursor-pointer disabled:no-underline disabled:cursor-default"
              title={onFlyToPin ? "Re-centre the map on this tree" : undefined}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path
                  d="M8 1v3M8 12v3M1 8h3M12 8h3M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              {tree.id}
            </button>
            <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px] truncate">
              {tree.species} · {tree.diameter} · {tree.height} m
            </p>
          </div>
          <div className="flex items-center gap-[2px] shrink-0">
            {onCollapse && (
              <button
                type="button"
                aria-label="Collapse to compact view"
                title="Collapse to compact view"
                onClick={onCollapse}
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

        <div className="scroll-slim overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {/* Current status */}
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-[6px] px-[10px] py-[4px] rounded-full text-[13px] font-medium font-['Outfit',sans-serif]"
              style={{ background: `${color}14`, border: `1px solid ${color}33`, color }}
            >
              <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: color }} />
              {tree.health}
            </span>
            <span className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif]">
              Canopy loss: {tree.canopyLossPct}%
            </span>
          </div>

          {/* The notification that opened this modal — absent when opened by
              expanding a plain pin click instead of a Recent Events row. */}
          {event && (
            <div className="bg-[#f6f6f8] border border-[#ebece7] rounded-[10px] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif]">{event.title}</span>
                <span className="text-[11px] text-[#71717a] font-['Outfit',sans-serif] shrink-0">{formatDate(event.date)}</span>
              </div>
              <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[17px] mt-[3px]">{event.description}</p>
            </div>
          )}

          {/* History */}
          <div>
            <p className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-2">History of surveys</p>
            <div className="flex flex-col">
              {history.map((h, i) => (
                <div key={i} className="relative flex gap-3 pb-3 last:pb-0">
                  {/* Timeline rail: a dot per entry, connected by a line — the
                      last entry has no line below it since there's nothing after. */}
                  <div className="flex flex-col items-center shrink-0 w-[10px]">
                    <span className="w-[8px] h-[8px] rounded-full bg-[#096151] mt-[3px] shrink-0" />
                    {i < history.length - 1 && <span className="w-px flex-1 bg-[#dedee3] mt-[2px]" />}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[#18181c] font-['Outfit',sans-serif]">{h.label}</span>
                      <span className="text-[10px] text-[#71717a] font-['Outfit',sans-serif]">{formatDate(h.date)}</span>
                    </div>
                    <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[15px] mt-[1px]">{h.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer actions — the two next steps a flagged tree actually needs:
            loop in a person, or queue it for a second, more certain look. */}
        <div className="flex items-center gap-[8px] px-4 py-3 border-t border-[#ebece7] shrink-0">
          <CTAButton
            label="Contact ecologist"
            confirmedLabel="Request sent"
            variant="primary"
            icon={
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path
                  d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v7A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path d="M2.5 4.5 8 8.5l5.5-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
          <CTAButton
            label="Send for verification"
            confirmedLabel="Queued"
            variant="secondary"
            icon={
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path
                  d="M8 14.5S13 9.8 13 6.3A5 5 0 0 0 3 6.3C3 9.8 8 14.5 8 14.5Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path d="M6 6.3 7.4 7.7 10.3 4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
