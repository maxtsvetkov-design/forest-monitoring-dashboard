import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Full-screen promo for adding denser capture coverage — styled after a
 * reference marketing page (cream ground, oversized black display type, a
 * tilted photo-card stack in a warm accent colour, hand-drawn connecting
 * lines). Replaces the old small dropdown banner: the brief asked for this to
 * read as a moment, not a tooltip.
 *
 * Uses the plot's own real timelapse frames for the photo cards rather than
 * stock imagery or an invented face — the reference's hero photo is a stand-in
 * for "a real person," and the honest equivalent here is "real capture data,"
 * which this app already has.
 */
export default function DenseCoverageModal({
  previewImages,
  plannedCaptures,
  onClose,
}: {
  previewImages: string[];
  plannedCaptures: number;
  onClose: () => void;
}) {
  const [requested, setRequested] = useState(false);
  const additional = plannedCaptures - previewImages.length;
  const earliest = previewImages[0];
  const latest = previewImages[previewImages.length - 1];

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    // Body scroll would fight this modal's own full-viewport layout — same
    // reasoning as every other full-screen overlay in this app.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] overflow-y-auto animate-fade-in"
      style={{ background: "#f3ede1" }}
      role="dialog"
      aria-modal="true"
      aria-label="Denser time coverage available"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="u-press fixed top-6 right-6 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/70 hover:bg-white text-[#18181c] cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 2l12 12M14 2 2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      <div className="min-h-full flex items-center px-8 py-16 md:px-20">
        <div className="w-full max-w-[1200px] mx-auto grid md:grid-cols-2 gap-16 items-center">
          {/* ── Left: the pitch ─────────────────────────────────────────── */}
          <div className="animate-fade-in-up" style={{ animationDelay: "60ms" }}>
            <p className="text-[13px] font-bold tracking-[0.08em] uppercase text-[#096151] mb-4">
              Denser time coverage
            </p>
            <h1 className="text-[52px] md:text-[64px] font-black leading-[0.98] tracking-[-0.02em] text-[#18181c] mb-6">
              See the plot
              <br />
              week by week.
            </h1>
            <p className="text-[17px] leading-[1.5] text-[#464650] max-w-[440px] mb-8">
              {additional} further captures are planned for this plot. Add them to step through the recovery{" "}
              <strong className="text-[#18181c]">week by week</strong> instead of month by month.
            </p>
            <div className="flex items-center gap-6">
              <button
                type="button"
                disabled={requested}
                onClick={() => setRequested(true)}
                className="u-press flex items-center gap-2 px-7 py-4 rounded-full bg-[#18181c] hover:bg-[#2e2e35] disabled:bg-[#0a7761] text-white text-[15px] font-semibold cursor-pointer disabled:cursor-default transition-colors"
              >
                {requested && (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
                    <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {requested ? "Imagery requested" : "Request imagery"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="u-press flex items-center gap-2 text-[15px] font-medium text-[#464650] hover:text-[#18181c] cursor-pointer"
              >
                <span className="w-7 h-7 rounded-full border border-[#18181c]/25 flex items-center justify-center shrink-0">
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </span>
                Maybe later
              </button>
            </div>
          </div>

          {/* ── Right: the photo-card composition ───────────────────────── */}
          {/* Fixed pixel size, not fluid — the squiggle overlay below is an
              SVG with a matching viewBox, and its paths are hand-tuned
              against these exact card positions. A fluid width would stretch
              the paths out of alignment with the cards they're meant to
              connect. */}
          <div className="relative w-[480px] h-[440px] mx-auto md:mx-0 hidden md:block">
            {/* Hand-drawn connecting lines, drawn in on mount. */}
            <svg
              viewBox="0 0 480 440"
              className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
              fill="none"
            >
              <path
                d="M70 150 C 90 168, 95 178, 100 192"
                stroke="#18181c"
                strokeOpacity="0.35"
                strokeWidth="1.5"
                strokeLinecap="round"
                pathLength="1"
                className="dcm-squiggle"
                style={{ animationDelay: "500ms" }}
              />
              <path
                d="M182 232 C 205 262, 220 300, 205 338"
                stroke="#18181c"
                strokeOpacity="0.35"
                strokeWidth="1.5"
                strokeLinecap="round"
                pathLength="1"
                className="dcm-squiggle"
                style={{ animationDelay: "650ms" }}
              />
            </svg>

            {/* Main frame: the plot's most recent real capture, in a dark
                "viewer" chrome echoing the reference's code editor. */}
            <div
              className="absolute top-0 right-0 w-[300px] rounded-[16px] overflow-hidden shadow-[0_20px_48px_-12px_rgba(24,24,28,0.35)] animate-fade-in-up"
              style={{ animationDelay: "160ms" }}
            >
              <div className="h-9 bg-[#18181c] flex items-center gap-2 px-3">
                <span className="w-2.5 h-2.5 rounded-full bg-[#e5484d]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#f0b429]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#24a67a]" />
                <span className="ml-2 text-[11px] font-medium text-white/70 truncate">latest-capture.jpg</span>
              </div>
              <img src={latest} alt="Most recent capture of the plot" className="w-full h-[200px] object-cover block" />
            </div>

            {/* Sticker card: the earliest capture, on the same amber used for
                "Stressed" elsewhere in this app — a warm accent pulled from
                the dashboard's own palette rather than an arbitrary new one.
                Overlaps the main card's bottom-left corner, the same
                interlocking the reference builds its own stack from. */}
            <div
              className="absolute top-[190px] left-0 w-[200px] rounded-[16px] overflow-hidden shadow-[0_16px_36px_-10px_rgba(24,24,28,0.3)] rotate-[-4deg] animate-fade-in-up"
              style={{ background: "#f0b429", animationDelay: "260ms" }}
            >
              <div className="relative">
                <img src={earliest} alt="Earliest capture of the plot" className="w-full h-[135px] object-cover block" />
                <span className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wide text-[#18181c] bg-white/80 rounded-full px-2 py-0.5">
                  Frame 1
                </span>
              </div>
              <div className="px-3 py-2.5 flex items-center gap-2">
                <span className="relative flex w-2.5 h-2.5 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-[#18181c] opacity-40 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-[#18181c]" />
                </span>
                <span className="text-[12px] font-semibold text-[#18181c]">Recording since Oct '25</span>
              </div>
            </div>

            {/* Floating stat callout — the dark speech-bubble equivalent,
                hanging off the main card's left edge. */}
            <div
              className="absolute top-[64px] left-[-24px] w-[170px] bg-[#18181c] text-white rounded-[14px] rounded-bl-[4px] px-4 py-3 shadow-[0_12px_28px_-8px_rgba(24,24,28,0.4)] animate-fade-in-up"
              style={{ animationDelay: "420ms" }}
            >
              <p className="text-[22px] font-black leading-none mb-1">+{additional}</p>
              <p className="text-[12px] leading-[1.4] text-white/75">captures a week apart, not a month apart</p>
            </div>

            {/* Small circular flourish, matching the reference's bottom-right
                accent icon — a shutter glyph, since this whole card stack is
                about additional camera captures. Overlaps the sticker card's
                bottom-right corner. */}
            <div
              className="absolute top-[345px] left-[172px] w-11 h-11 rounded-full flex items-center justify-center shadow-[0_10px_24px_-6px_rgba(240,180,41,0.6)] animate-pop-in"
              style={{ background: "#f0b429", animationDelay: "560ms" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="13" r="4.5" stroke="#18181c" strokeWidth="1.6" />
                <path
                  d="M4 8.5h2.6l1.3-2h8.2l1.3 2H20a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z"
                  stroke="#18181c"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
