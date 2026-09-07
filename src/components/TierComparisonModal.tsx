import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CURRENT_TIER_INDEX, PRICE_ROW, SPEC_ROWS, TIER_SECTIONS, TIERS, type TierCoverage } from "../data/tiers";

/** Footer upsell action — no sales backend behind this demo, so a click
 * flips to a brief confirmed state instead of a silent no-op, the same
 * pattern used by the tree popover's own CTAs. */
function UpsellButton({
  label,
  confirmedLabel,
  variant,
}: {
  label: string;
  confirmedLabel: string;
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
      className={`u-press flex items-center justify-center gap-[6px] px-[16px] py-[8px] rounded-full text-[13px] font-bold font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer disabled:cursor-default ${
        variant === "primary"
          ? "bg-[#18181c] text-white hover:bg-[#2c2c33] disabled:bg-[#3f9142]"
          : "border border-[#18181c] text-[#18181c] hover:bg-[#18181c]/5 disabled:bg-[#fff6da] disabled:border-[#f0c869] disabled:text-[#8a6d1f]"
      }`}
    >
      {sent && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {sent ? confirmedLabel : label}
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
      className={`u-press inline-flex items-center gap-[3px] mt-[4px] px-[8px] py-[2px] rounded-full border text-[9px] font-bold tracking-wide cursor-pointer disabled:cursor-default ${
        sent
          ? "bg-[#B4831F] border-[#B4831F] text-white"
          : "border-[#B4831F] text-[#B4831F] hover:bg-[#B4831F]/10"
      }`}
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
    return <span className="text-[13px] text-[#cbcbd2] font-['Outfit',sans-serif]">—</span>;
  }
  if (value === "half") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Partially available">
        <circle cx="7" cy="7" r="6" fill="none" stroke="#096151" strokeWidth="1.4" />
        <path d="M7 1a6 6 0 0 1 0 12Z" fill="#096151" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Fully available">
      <circle cx="7" cy="7" r="7" fill="#096151" />
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

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-[3px] p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Service tier comparison"
        onClick={(e) => e.stopPropagation()}
        className="modal-panel bg-white rounded-[16px] border border-[#dedee3] shadow-[0px_24px_60px_-12px_rgba(0,0,0,0.35)] w-[92vw] max-w-[980px] h-[calc(100vh-32px)] max-h-[880px] flex overflow-hidden"
      >
        <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[#ebece7] shrink-0">
          <div>
            <p className="text-[19px] font-extrabold tracking-tight text-[#18181c] font-['Outfit',sans-serif] leading-[26px]">
              Unlock more with a higher tier
            </p>
            <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px]">
              This contract is on Tier 2. Rows greyed out below need a higher tier.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="u-press shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650] cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="scroll-slim flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px] font-['Outfit',sans-serif]">
            <thead>
              <tr className="bg-[#faf8f4]">
                <th className="text-left font-normal text-[#71717a] px-4 py-3 sticky left-0 bg-[#faf8f4] min-w-[200px]">
                  What you get
                </th>
                {TIERS.map((tier, i) => (
                  <th
                    key={tier.label}
                    className={`px-3 py-3 text-center min-w-[130px] ${
                      i === CURRENT_TIER_INDEX ? "bg-[#eaf3ef]" : ""
                    }`}
                  >
                    <div className="text-[10px] tracking-wide text-[#71717a] font-medium">
                      {tier.label.toUpperCase()}
                    </div>
                    <div className="text-[13px] font-bold text-[#18181c] mt-[2px]">{tier.name}</div>
                    {i === CURRENT_TIER_INDEX && (
                      <div className="inline-block mt-[4px] px-[8px] py-[2px] rounded-full border border-[#096151] text-[#096151] text-[9px] font-bold tracking-wide">
                        YOUR TIER
                      </div>
                    )}
                    {i === TIERS.length - 1 && <AdvancedBadge />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SPEC_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-[#ebece7]">
                  <td className="text-left text-[#5b5b66] px-4 py-3 sticky left-0 bg-white">{row.label}</td>
                  {row.cells.map((cell, i) => (
                    <td
                      key={i}
                      className={`text-center px-3 py-3 text-[#464650] ${i === CURRENT_TIER_INDEX ? "bg-[#f3f9f7]" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}

              {TIER_SECTIONS.map((section) => (
                <Fragment key={section.title}>
                  <tr className="bg-[#f2efe9]">
                    <td
                      colSpan={5}
                      className="text-left text-[10px] tracking-wide text-[#8a8a7a] font-medium uppercase px-4 py-[6px] sticky left-0 bg-[#f2efe9]"
                    >
                      {section.title}
                    </td>
                  </tr>
                  {section.rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-b border-[#ebece7] ${row.id === highlightRowId ? "bg-[#fff6df]" : ""}`}
                    >
                      <td className={`text-left px-4 py-3 sticky ${row.id === highlightRowId ? "bg-[#fff6df]" : "bg-white"} left-0 text-[#18181c]`}>
                        {row.label}
                      </td>
                      {row.cells.map((cell, i) => (
                        <td
                          key={i}
                          className={`text-center px-3 py-3 ${i === CURRENT_TIER_INDEX && row.id !== highlightRowId ? "bg-[#f3f9f7]" : ""}`}
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

              <tr>
                <td className="text-left text-[#5b5b66] px-4 py-3 sticky left-0 bg-white font-medium">
                  {PRICE_ROW.label}
                </td>
                {PRICE_ROW.cells.map((cell, i) => (
                  <td
                    key={i}
                    className={`text-center px-3 py-3 text-[#18181c] font-medium ${i === CURRENT_TIER_INDEX ? "bg-[#f3f9f7]" : ""}`}
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
        <div className="shrink-0 border-t border-[#ebece7] bg-[#faf8f4] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
              Unlock more with a higher tier
            </p>
            <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[1px]">
              Per-tree records and ground-verified data start at Tier 3.
            </p>
          </div>
          <div className="flex items-center gap-[8px] shrink-0">
            <UpsellButton label="Talk to sales" confirmedLabel="Request sent" variant="secondary" />
            <UpsellButton label="Upgrade to Tier 3" confirmedLabel="Upgrade requested" variant="primary" />
          </div>
        </div>
        </div>

        {/* Decorative rail — each tier rendered as a circle that shrinks going
            down, Tier 4 largest at top to Tier 1 smallest at bottom, so the
            "more tier = more coverage" pitch reads at a glance before anyone
            scans the table. Filled green marks tiers this contract already
            has; grey marks the tiers still locked. */}
        <aside className="hidden lg:flex w-[210px] shrink-0 flex-col items-center justify-center gap-[16px] py-10 border-l border-[#ebece7] bg-gradient-to-b from-[#fdf6df] via-[#fce9c4] to-[#f9dcb0] relative overflow-hidden">
          {[...TIERS]
            .map((tier, i) => ({ tier, tierIndex: i }))
            .reverse()
            .map(({ tier, tierIndex }, order) => {
              const size = 92 - order * 18;
              const unlocked = tierIndex <= CURRENT_TIER_INDEX;
              return (
                <div key={tier.label} className="flex flex-col items-center gap-[6px]">
                  <div
                    style={{
                      width: size,
                      height: size,
                      background: unlocked
                        ? "linear-gradient(155deg, #ff9d68 0%, #e3491f 100%)"
                        : undefined,
                    }}
                    className={`rounded-full flex items-center justify-center font-bold font-['Outfit',sans-serif] transition-transform ${
                      unlocked ? "text-white shadow-[0px_6px_16px_-4px_rgba(227,73,31,0.5)]" : "bg-[#f2e6cc] text-[#a8946a]"
                    }`}
                  >
                    <span style={{ fontSize: Math.max(11, size * 0.22) }}>{tierIndex + 1}</span>
                  </div>
                  <span className="text-[9px] tracking-wide text-[#8a7550] font-medium uppercase">
                    {tier.label}
                  </span>
                </div>
              );
            })}
          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[170px] text-[10px] text-center text-[#8a7550] font-['Outfit',sans-serif] leading-[14px]">
            Every tier up adds ground-truth precision
          </p>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
