import { useEffect } from "react";
import { createPortal } from "react-dom";
import { PRICE_ROW } from "../data/tiers";
import type { CategoryDatum } from "../data/types";

/**
 * The receipt for a commissioned hi-res capture.
 *
 * Every other "we heard you" in this app is `ManagerContactToast` — a small
 * cream strip that slides in and dismisses itself. This one is a card in the
 * middle of the screen that waits to be dismissed, because it is answering the
 * largest thing a reader can set in motion from this workspace: they have just
 * accepted the assistant's argument that the current imagery cannot settle a
 * question, and committed to a flight over the failing ground. An
 * acknowledgement that evaporates on a five-second timer is the wrong weight
 * for that.
 *
 * Styled after the reference the copy arrived with — a white card on a flat
 * ground, a very heavy black headline, and a yellow marker swipe under the
 * part that actually answers the reader's question, *when*. Two deliberate
 * departures from it: the ground is this app's warm off-white rather than the
 * reference's lavender (see SCRIM), and its grey placeholder circles and bar
 * are not reproduced, because they are skeleton furniture in a template and
 * the same space here carries what was actually ordered.
 */

/**
 * The ground behind the card. Warm off-white rather than the reference's
 * lavender: that purple was borrowed from a template and had no relative
 * anywhere else in this app, whereas this sits in the same family as the
 * advisor's own cream (`#F4EFEB`) and the workspace chrome — so the card reads
 * as part of this product rather than as a slide pasted over it.
 *
 * Nearly opaque on purpose. A light scrim at 50% over a busy aerial goes muddy
 * and takes the white card's edge with it; at this alpha the map is a faint
 * presence behind the ground rather than a texture competing with it.
 */
const SCRIM = "#F3EDEA";
const SCRIM_ALPHA = "F0";
const INK = "#0A0A0A";

/** The same "within 2 days" the receipt's own copy has always quoted for
 * this kind of pass — a flavour figure like `DEMO_LAST_SYNC_HOURS_AGO`
 * (LandingScreen), not a measured SLA this app tracks against anything. */
const TURNAROUND_LABEL = "2 days";

/** The per-tree ±5 cm tier's own survey rate off the tier table's real price
 *  row (`PRICE_ROW.cells[2]` — "290 AED/ha survey + 290–490/ha updates") —
 *  just the survey figure, not the recurring-update range, since this
 *  receipt is for the one-off pass, not a subscription. */
const PRICE_PER_HA = PRICE_ROW.cells[2].split(" survey")[0];

export default function HiResConfirmation({
  projectName,
  resolution,
  blockCount,
  areaHa,
  speciesData,
  onDismiss,
}: {
  projectName: string;
  /** As the tier table writes it, e.g. "±5 cm" — passed in rather than
   * restated so this card cannot disagree with the argument that produced it. */
  resolution: string;
  /** How many failing blocks the pass covers. */
  blockCount: number;
  /** The real hectare figure behind this pass — `areaHectares(areaId)` or a
   * caller's own already-computed plot size. Optional: the order-summary row
   * it backs is omitted rather than guessed where a caller has no area
   * figure in scope. */
  areaHa?: number;
  /** The same real per-species tree count Insights already charts
   *  (`aggregated.speciesData`) — shown here so the receipt says *what* the
   *  pass is over, not just how big and how much. Optional: omitted where a
   *  caller has no species breakdown in scope, same as `areaHa`. */
  speciesData?: CategoryDatum[];
  onDismiss: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hi-res capture requested"
      className="fixed inset-0 z-[1400] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: `${SCRIM}${SCRIM_ALPHA}`, backdropFilter: "blur(6px)" }}
      onClick={onDismiss}
    >
      <div
        className="modal-panel relative w-[560px] max-w-full rounded-[30px] overflow-hidden border shadow-[0_36px_80px_-18px_rgba(43,32,26,0.34),0_6px_18px_-6px_rgba(43,32,26,0.16)]"
        style={{
          // The bottom tint follows the scrim's own hue rather than the
          // reference's lavender, so the card and its ground are the same
          // temperature.
          background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 62%, #FBF7F5 100%)",
          borderColor: "rgba(43,32,26,0.10)",
        }}
        // The backdrop dismisses; the card must not, or reading it closes it.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-[40px] pt-[34px] pb-[30px]">
          {/* Alma's mark, top-left, where the reference puts its logo. */}
          <span
            className="flex items-center justify-center w-[38px] h-[38px] rounded-full"
            style={{ background: INK }}
            aria-hidden="true"
          >
            <svg width="20" height="20" viewBox="0 0 16 16">
              <path
                d="M8 1.6c.9 2.3 1.7 3.3 3.9 4.3-2.2 1-3 2-3.9 4.3-.9-2.3-1.7-3.3-3.9-4.3 2.2-1 3-2 3.9-4.3Z"
                fill="#E0654A"
              />
              <path
                d="M8 10.6c.6 1.6 1.1 2.2 2.6 2.9-1.5.7-2 1.3-2.6 2.9-.6-1.6-1.1-2.2-2.6-2.9 1.5-.7 2-1.3 2.6-2.9Z"
                fill="#E0654A"
                opacity="0.55"
              />
            </svg>
          </span>

          <h2
            className="mt-[52px] font-extrabold tracking-[-0.035em] leading-[1.04] text-[44px]"
            style={{ color: INK }}
          >
            A new hi-res <span className="hires-marker">0.5 m capture was provided</span>
          </h2>

          <p className="mt-[22px] text-[15px] leading-[23px]" style={{ color: "rgba(10,10,10,0.62)" }}>
            A {resolution} capture over the {blockCount} failing {blockCount === 1 ? "block" : "blocks"} at{" "}
            {projectName} has landed in this workspace, on the same layer you were looking at — so the detections have
            already re-run against it, nothing further to import.
          </p>

          {/* Order summary — every figure here already exists elsewhere in
              this app (the tier table's own price and resolution rows, a
              caller's own hectare figure); nothing is computed fresh just to
              fill this card. */}
          <div
            className="mt-[22px] rounded-[16px] border grid grid-cols-2 gap-x-[16px] gap-y-[14px]"
            style={{ borderColor: "rgba(10,10,10,0.08)", padding: "18px 20px" }}
          >
            {areaHa !== undefined && (
              <div>
                <span className="block text-[11px] font-medium" style={{ color: "rgba(10,10,10,0.45)" }}>
                  Area
                </span>
                <span className="block mt-[2px] text-[15px] font-bold tabular-nums" style={{ color: INK }}>
                  {areaHa} ha
                </span>
              </div>
            )}
            <div>
              <span className="block text-[11px] font-medium" style={{ color: "rgba(10,10,10,0.45)" }}>
                Resolution
              </span>
              <span className="block mt-[2px] text-[15px] font-bold tabular-nums" style={{ color: INK }}>
                {resolution}
              </span>
            </div>
            <div>
              <span className="block text-[11px] font-medium" style={{ color: "rgba(10,10,10,0.45)" }}>
                Est. turnaround
              </span>
              <span className="block mt-[2px] text-[15px] font-bold" style={{ color: INK }}>
                {TURNAROUND_LABEL}
              </span>
            </div>
            <div>
              <span className="block text-[11px] font-medium" style={{ color: "rgba(10,10,10,0.45)" }}>
                Price per ha
              </span>
              <span className="block mt-[2px] text-[15px] font-bold tabular-nums" style={{ color: INK }}>
                {PRICE_PER_HA}
              </span>
            </div>
          </div>
          {/* What each figure above actually is — the numbers read fine on
              their own, but "why is resolution ±5cm and not the 0.5m this
              stage's own reference photo claims" is a fair question the card
              should answer rather than leave the reader to reconcile. */}
          <p className="mt-[10px] text-[11.5px] leading-[16px]" style={{ color: "rgba(10,10,10,0.4)" }}>
            Resolution and price per ha come straight off this deployment's own service-tier table — the same
            figures the layer panel's "Tier N+" badges and the assistant's own advice quote, not numbers computed
            for this receipt alone. Area is this site's real surveyed footprint.
          </p>
        </div>

        <div
          className="flex items-center justify-between gap-[16px] px-[40px] py-[22px] border-t"
          style={{ borderColor: "rgba(10,10,10,0.08)" }}
        >
          <span className="text-[13px] font-medium" style={{ color: "rgba(10,10,10,0.45)" }}>
            Logged · nothing further needed from you
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="u-press shrink-0 inline-flex items-center gap-[7px] h-[44px] px-[22px] rounded-full text-[15px] font-semibold cursor-pointer transition-transform duration-150 hover:-translate-y-[1px]"
            style={{ background: INK, color: "#fff" }}
          >
            Back to the plot
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 3.5 10.5 8 6 12.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
