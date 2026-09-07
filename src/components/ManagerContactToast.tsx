import { useEffect, useState } from "react";

/** How long the toast stays before dismissing itself. */
const AUTO_DISMISS_MS = 5200;
/** Must match `.toast-exit`'s own animation-duration in index.css — the
 * unmount is deferred by exactly this long so the exit animation gets to
 * finish playing before React actually removes the element. */
const EXIT_MS = 480;

/**
 * "Our manager will contact you soon" — the one confirmation this demo's
 * sales-adjacent actions share (requesting denser imagery, upgrading a tier):
 * there's no real sales backend behind either, so a click gets an honest
 * acknowledgement instead of a silent no-op or a fabricated "done".
 *
 * Cream-on-cream chrome with a thin hairline border rather than a green
 * success banner or a browser-native alert — first built for
 * DenseCoverageModal's own reference page, and pulled out here once
 * TierComparisonModal needed the identical confirmation rather than a second,
 * subtly different one.
 *
 * Leaves the way it arrived: `onDismiss` (from either the auto-timer or the
 * close button) doesn't unmount this immediately — it plays `.toast-exit`
 * first and only tells the parent to unmount once that finishes. A plain
 * `hidden && null` on the parent's own state would have cut the animation off
 * on frame one; the component owns its own exit precisely so the parent's
 * state and this component's own visible lifetime don't have to be the same
 * thing.
 */
export default function ManagerContactToast({
  detail,
  onDismiss,
}: {
  /** The second line — what was actually requested, stated plainly rather
   * than a generic "we'll be in touch". */
  detail: string;
  onDismiss: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  // Auto-dismisses on its own timer, but only while still mounted and not
  // already leaving — a fast double-click on the close button (or the timer
  // firing right as the button is pressed) must not restart the exit.
  useEffect(() => {
    if (leaving) return;
    const t = window.setTimeout(() => setLeaving(true), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(onDismiss, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving, onDismiss]);

  return (
    <div role="status" className="fixed bottom-8 inset-x-0 z-[1300] flex justify-center px-4 pointer-events-none">
      {/* Stops its own clicks bubbling — TierComparisonModal's backdrop closes
          the whole modal on any click that reaches it, and this toast is a
          sibling inside that same backdrop, not a child of the card it
          confirms. Without this, clicking to read the toast (anywhere but
          its own dismiss button) silently closed the tier modal underneath. */}
      <div
        className={`pointer-events-auto flex items-start gap-4 max-w-[400px] w-full bg-[#f3ede1] border border-[#18181c]/20 rounded-[18px] shadow-[0_20px_48px_-12px_rgba(24,24,28,0.25)] px-5 py-4 ${
          leaving ? "toast-exit" : "animate-fade-in-up"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* A diamond mark rather than a generic checkmark — echoes the
            reference image's own pinwheel-style nav glyph, so the "we heard
            you" confirmation carries a little of that page's identity
            instead of a stock success icon. */}
        <span className="w-10 h-10 rounded-full bg-[#18181c] flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.5c1.6 2.2 3 3.6 5.2 5.2-2.2 1.6-3.6 3-5.2 5.2-1.6-2.2-3-3.6-5.2-5.2 2.2-1.6 3.6-3 5.2-5.2Z"
              fill="white"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-[#18181c]">Our manager will contact you soon.</p>
          <p className="text-[13px] leading-[1.4] text-[#464650] mt-1">{detail}</p>
        </div>
        <button
          type="button"
          onClick={() => setLeaving(true)}
          aria-label="Dismiss"
          className="u-press shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[#464650]/60 hover:text-[#18181c] hover:bg-[#18181c]/5 cursor-pointer"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
