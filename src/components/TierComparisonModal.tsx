import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ManagerContactToast from "./ManagerContactToast";
import { CURRENT_TIER_INDEX, PRICE_ROW, SPEC_ROWS, TIER_SECTIONS, TIERS, type TierCoverage } from "../data/tiers";

/**
 * Palette lifted from a reference cap-table dashboard: white ground, deep
 * teal as the "owned" accent, a bright chartreuse as the pop accent, warm
 * beige for texture, and near-black for text and hairline borders — one
 * bright colour, not the previous version's three (purple/orange/yellow),
 * so it reads as a clean product surface rather than a poster.
 */
const TEAL = "#123f3c";
const LIME = "#e7f24a";
const BEIGE = "#ded6c2";
const INK = "#16181a";

/**
 * Footer upsell action. Was two buttons (a lime "Upgrade" and an outlined
 * "Talk to sales"), each flipping to its own brief confirmed state — dropped
 * to this one now that both led to the identical outcome: no sales backend
 * behind either, so both just confirmed the click. One honest button beats
 * two that quietly did the same thing.
 */
function UpsellButton({ label, onSent }: { label: string; onSent: () => void }) {
  const [sent, setSent] = useState(false);
  return (
    <button
      type="button"
      disabled={sent}
      onClick={() => {
        setSent(true);
        onSent();
        window.setTimeout(() => setSent(false), 2600);
      }}
      className="u-press flex items-center justify-center gap-[6px] px-[20px] py-[12px] rounded-full text-[14px] font-bold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer disabled:cursor-default transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_24px_-8px_rgba(18,63,60,0.45)] text-[#16181a] disabled:text-[#16181a]"
      style={{ background: sent ? "#bfe37a" : LIME }}
      onMouseEnter={(e) => {
        if (!sent) e.currentTarget.style.background = "#d9ea5e";
      }}
      onMouseLeave={(e) => {
        if (!sent) e.currentTarget.style.background = LIME;
      }}
    >
      {sent && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {sent ? "Upgrade requested" : label}
    </button>
  );
}

/** Sits under the top tier's own column header — a second, more targeted
 * pitch than the footer's "one step up" framing: for a reader who wants the
 * full ground-verified picture, not just the next notch. */
function AdvancedBadge() {
  const [sent, setSent] = useState(false);
  return (
    <button
      type="button"
      disabled={sent}
      onClick={(e) => {
        e.stopPropagation();
        setSent(true);
        window.setTimeout(() => setSent(false), 2600);
      }}
      className={`u-press inline-flex items-center gap-[3px] mt-[6px] px-[9px] py-[3px] rounded-full text-[9px] font-bold tracking-wide cursor-pointer disabled:cursor-default transition-colors ${
        sent ? "text-[#16181a]" : "text-[#16181a] hover:brightness-95"
      }`}
      style={{ background: LIME }}
    >
      {sent ? (
        "REQUESTED"
      ) : (
        <>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
            <path d="M5 0l1.3 3.2L10 3.8 7.3 6.2 8 10 5 7.9 2 10l.7-3.8L0 3.8l3.7-.6Z" />
          </svg>
          ADVANCED
        </>
      )}
    </button>
  );
}

/** ● full / ◐ half / — none, matching the shared pricing table's own iconography. */
function CoverageDot({ value }: { value: TierCoverage }) {
  if (value === "none") {
    return <span className="text-[14px] font-medium text-[#c7c2b4] font-['Outfit',sans-serif]">—</span>;
  }
  if (value === "half") {
    return (
      <svg width="16" height="16" viewBox="0 0 14 14" aria-label="Partially available">
        <circle cx="7" cy="7" r="6" fill="none" stroke={TEAL} strokeWidth="1.6" />
        <path d="M7 1a6 6 0 0 1 0 12Z" fill={TEAL} />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" aria-label="Fully available">
      <circle cx="7" cy="7" r="7" fill={TEAL} />
    </svg>
  );
}

export default function TierComparisonModal({
  highlightRowId,
  onClose,
}: {
  /** The locked-layer row that was clicked to open this — gets a highlighted background so the reader can find it in the table immediately. */
  highlightRowId?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const [showConfirmation, setShowConfirmation] = useState(false);
  // Upgrading answers the only question the comparison table was open to
  // settle, so the click closes the panel itself rather than leaving it
  // sitting open behind the confirmation. Kept separate from `onClose` (which
  // tells the parent to unmount this whole component): closing that way
  // immediately would tear down the toast below it before it ever got to
  // render, since both are children of the same portal.
  const [panelOpen, setPanelOpen] = useState(true);

  // Every table row gets a tiny stagger so the surface reads as *arriving*
  // rather than just appearing — see .tier-row in index.css. A running index
  // across sections (not reset per-section) so the stagger keeps climbing
  // all the way down instead of restarting and briefly reversing at each
  // section break.
  let rowOrder = 0;

  return createPortal(
    <>
    {panelOpen && (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#16181a]/50 backdrop-blur-[4px] p-3 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Service tier comparison"
        onClick={(e) => e.stopPropagation()}
        className="modal-panel bg-white rounded-[24px] border border-[#e2ded4] shadow-[0px_40px_90px_-16px_rgba(22,24,26,0.35)] w-[94vw] max-w-[1060px] h-[calc(100vh-16px)] max-h-[1040px] flex overflow-hidden"
      >
        <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 px-7 pt-7 pb-5 border-b border-[#ececec] shrink-0 bg-white">
          <div>
            <p className="text-[30px] font-bold tracking-tight text-[#16181a] font-['Outfit',sans-serif] leading-[34px]">
              Unlock more with a higher tier.
            </p>
            <p className="text-[13px] text-[#6b6b70] font-['Outfit',sans-serif] mt-[6px]">
              This contract is on Tier 2. Rows greyed out below need a higher tier.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="u-press shrink-0 w-9 h-9 flex items-center justify-center rounded-full border border-[#e2ded4] bg-white text-[#16181a] hover:border-[#16181a] hover:bg-[#f7f6f2] cursor-pointer transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="scroll-slim flex-1 overflow-auto">
          <table className="w-full border-collapse text-[13px] font-['Outfit',sans-serif]">
            <thead>
              <tr>
                <th className="text-left font-semibold text-[#6b6b70] px-7 py-4 sticky left-0 bg-white min-w-[210px] border-b border-[#ececec]">
                  What you get
                </th>
                {TIERS.map((tier, i) => {
                  const current = i === CURRENT_TIER_INDEX;
                  return (
                    <th
                      key={tier.label}
                      className={`relative px-3 py-4 text-center min-w-[136px] border-b border-l border-[#ececec] overflow-hidden ${
                        current ? "bg-[#123f3c]" : ""
                      }`}
                    >
                      {current && (
                        <div
                          className="tier-sheen absolute inset-y-0 left-0 w-1/3 pointer-events-none"
                          style={{ background: "linear-gradient(100deg, transparent, rgba(231,242,74,0.28), transparent)" }}
                        />
                      )}
                      <div className={`relative text-[10px] tracking-wide font-bold ${current ? "text-white/60" : "text-[#a3a09a]"}`}>
                        {tier.label.toUpperCase()}
                      </div>
                      <div className={`relative text-[16px] font-bold mt-[2px] ${current ? "text-white" : "text-[#16181a]"}`}>
                        {tier.name}
                      </div>
                      {current && (
                        <div
                          className="relative inline-block mt-[6px] px-[9px] py-[3px] rounded-full text-[9px] font-bold tracking-wide text-[#16181a]"
                          style={{ background: LIME }}
                        >
                          YOUR TIER
                        </div>
                      )}
                      {i === TIERS.length - 1 && <AdvancedBadge />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {SPEC_ROWS.map((row) => (
                <tr key={row.label} className="tier-row border-b border-[#ececec]" style={{ animationDelay: `${rowOrder++ * 25}ms` }}>
                  <td className="text-left font-medium text-[#6b6b70] px-7 py-3 sticky left-0 bg-white">{row.label}</td>
                  {row.cells.map((cell, i) => (
                    <td
                      key={i}
                      className={`text-center px-3 py-3 border-l border-[#ececec] font-semibold text-[#16181a] ${
                        i === CURRENT_TIER_INDEX ? "bg-[#f0f5ef]" : ""
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}

              {TIER_SECTIONS.map((section) => (
                <Fragment key={section.title}>
                  <tr className="tier-row" style={{ animationDelay: `${rowOrder++ * 25}ms` }}>
                    <td
                      colSpan={5}
                      className="text-left text-[10px] tracking-[0.08em] text-[#6b6b70] font-bold uppercase px-7 py-[8px] sticky left-0 bg-[#faf9f6]"
                    >
                      {section.title}
                    </td>
                  </tr>
                  {section.rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`tier-row border-b border-[#ececec] ${row.id === highlightRowId ? "bg-[#f9f6dd]" : ""}`}
                      style={{ animationDelay: `${rowOrder++ * 25}ms` }}
                    >
                      <td
                        className={`text-left font-semibold px-7 py-3 sticky ${
                          row.id === highlightRowId ? "bg-[#f9f6dd]" : "bg-white"
                        } left-0 text-[#16181a]`}
                      >
                        {row.label}
                      </td>
                      {row.cells.map((cell, i) => (
                        <td
                          key={i}
                          className={`text-center px-3 py-3 border-l border-[#ececec] ${
                            i === CURRENT_TIER_INDEX && row.id !== highlightRowId ? "bg-[#f0f5ef]" : ""
                          }`}
                        >
                          <div className="flex items-center justify-center">
                            <CoverageDot value={cell} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}

              <tr className="tier-row" style={{ animationDelay: `${rowOrder++ * 25}ms` }}>
                <td className="text-left text-[#16181a] px-7 py-4 sticky left-0 bg-white font-bold">
                  {PRICE_ROW.label}
                </td>
                {PRICE_ROW.cells.map((cell, i) => (
                  <td
                    key={i}
                    className={`text-center px-3 py-4 border-l border-[#ececec] text-[#16181a] font-bold text-[15px] ${
                      i === CURRENT_TIER_INDEX ? "bg-[#f0f5ef]" : ""
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Promo footer — the actual "buy more" moment this table exists to
            lead up to. Two tiers, two pitches: Tier 3 is the direct next
            step up from where this contract sits; Tier 4 ("Advanced") is
            framed as its own destination for a reader who wants the full
            ground-verified picture, not just one notch up. */}
        <div className="shrink-0 border-t border-[#ececec] bg-[#faf9f6] px-7 py-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[17px] font-bold text-[#16181a] font-['Outfit',sans-serif]">
              Unlock more with a higher tier
            </p>
            <p className="text-[12px] text-[#6b6b70] font-['Outfit',sans-serif] mt-[2px]">
              Per-tree records and ground-verified data start at Tier 3.
            </p>
          </div>
          <div className="flex items-center gap-[10px] shrink-0">
            <UpsellButton
              label="Upgrade to Tier 3"
              onSent={() => {
                setShowConfirmation(true);
                setPanelOpen(false);
              }}
            />
          </div>
        </div>
        </div>

        {/* Decorative rail — each tier rendered as a circle that shrinks going
            down, Tier 4 largest at top to Tier 1 smallest at bottom, so the
            "more tier = more coverage" pitch reads at a glance before anyone
            scans the table. Teal-to-lime marks tiers this contract already
            has; a beige outline marks the tiers still locked. Three floating
            geometric shapes (triangle, slab, chevron) echo the reference
            image's own promo-card composition and drift slowly so the panel
            never sits fully still while it's open. */}
        <aside className="hidden lg:flex w-[250px] shrink-0 flex-col items-center justify-center gap-[22px] py-10 border-l border-[#ececec] bg-[#faf9f6] relative overflow-hidden">
          <div
            className="tier-shape absolute w-[130px] h-[130px] pointer-events-none"
            style={{
              top: "8%",
              left: "-18%",
              background: LIME,
              clipPath: "polygon(0 0, 100% 30%, 40% 100%)",
              animationDelay: "0ms",
            }}
          />
          <div
            className="tier-shape absolute w-[70px] h-[110px] pointer-events-none"
            style={{
              bottom: "14%",
              right: "-10%",
              background: INK,
              transform: "rotate(18deg)",
              animationDelay: "1400ms",
            }}
          />
          <div
            className="tier-shape absolute w-[90px] h-[90px] pointer-events-none"
            style={{
              bottom: "-6%",
              left: "10%",
              background: BEIGE,
              clipPath: "polygon(0 40%, 50% 0, 100% 40%, 50% 100%)",
              animationDelay: "2800ms",
            }}
          />

          {[...TIERS]
            .map((tier, i) => ({ tier, tierIndex: i }))
            .reverse()
            .map(({ tier, tierIndex }, order) => {
              const size = 100 - order * 20;
              const unlocked = tierIndex <= CURRENT_TIER_INDEX;
              // Bottom-to-top pop, so the rail climbs the same direction the
              // pitch does — Tier 1 (last in this reversed list) arrives
              // first. See .tier-circle in index.css.
              const popOrder = TIERS.length - 1 - order;
              return (
                <div key={tier.label} className="relative flex flex-col items-center gap-[7px]">
                  <div
                    className="tier-circle relative flex items-center justify-center rounded-full font-bold font-['Outfit',sans-serif] border border-[#e2ded4]"
                    style={{
                      width: size,
                      height: size,
                      background: unlocked ? `linear-gradient(150deg, ${LIME} 0%, ${TEAL} 100%)` : "white",
                      color: unlocked ? "#16181a" : "#16181a",
                      boxShadow: unlocked ? "0px 10px 24px -8px rgba(18,63,60,0.45)" : "none",
                      animationDelay: `${popOrder * 90}ms`,
                    }}
                  >
                    <span style={{ fontSize: Math.max(13, size * 0.24) }}>{tierIndex + 1}</span>
                  </div>
                  <span
                    className="tier-circle text-[10px] tracking-wide text-[#16181a] font-bold uppercase bg-white border border-[#e2ded4] rounded-full px-[8px] py-[2px]"
                    style={{ animationDelay: `${popOrder * 90 + 60}ms` }}
                  >
                    {tier.label}
                  </span>
                </div>
              );
            })}
          <p className="tier-circle relative w-[188px] text-[11px] text-center text-[#6b6b70] font-['Outfit',sans-serif] font-medium leading-[15px] mt-[6px]" style={{ animationDelay: "480ms" }}>
            Every tier up adds ground-truth precision.
          </p>
        </aside>
      </div>
    </div>
    )}

      {/* Rendered outside the panelOpen block above, not as its child: the
          panel closes the instant "Upgrade" is clicked, but the toast that
          confirms the click has its own longer, self-timed exit (see
          ManagerContactToast) and would be torn down mid-animation if it were
          nested inside the thing that just disappeared. */}
      {showConfirmation && (
        <ManagerContactToast
          detail="We've logged the upgrade to Tier 3 — expect an email within one business day to confirm billing and turn on per-tree records."
          onDismiss={() => {
            setShowConfirmation(false);
            onClose();
          }}
        />
      )}
    </>,
    document.body,
  );
}
