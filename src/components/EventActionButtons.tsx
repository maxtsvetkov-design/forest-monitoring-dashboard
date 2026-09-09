/**
 * Three quick actions on every event — list row and detail panel alike, so
 * an action taken from the row and the state shown in the panel can never
 * disagree. Styled conservatively on purpose: a bordered, near-white button
 * with a colored label rather than a solid-fill or gradient CTA — these are
 * routine actions taken on nearly every row, not the one big "commit to a
 * flight" moment `HiResConfirmation` answers, and a loud button repeated on
 * every card in the list would read as every row shouting at once.
 *
 * "Save for later" and "Resolve" are local, session-only toggles (no
 * backing workflow system exists for either) — visual state, not a claim
 * of a real saved-items list or ticketing system. "Request hi-res
 * analysis" reuses the same real hi-res-delivery flow the detail panel's
 * own CTA already drives, where a caller has that handler in scope;
 * without one, it just opens the event (same as clicking the row).
 */
export default function EventActionButtons({
  saved,
  onToggleSave,
  resolved,
  onToggleResolve,
  onRequestHiRes,
  hideHiRes = false,
  compact = false,
}: {
  saved: boolean;
  onToggleSave: () => void;
  resolved: boolean;
  onToggleResolve: () => void;
  onRequestHiRes: () => void;
  /** Once a hi-res pass for this event has actually been requested and
   *  delivered, there's nothing left to request — same "nothing left to
   *  commission" reasoning the old CTA swap used, just applied to this
   *  button instead of replacing it with a different one. */
  hideHiRes?: boolean;
  /** Tighter scale for the list row; full scale for the detail panel. */
  compact?: boolean;
}) {
  // Two borders, not one: the colored `border` (state-dependent) plus a
  // faint neutral `ring` a pixel further out — the ring reads as the
  // button's own edge against any background, while the colored border
  // stays free to carry saved/resolved state without also having to look
  // crisp against white. The shadow stack pairs an outer drop shadow (lift)
  // with an inset top highlight (a soft inner bevel, like a slightly domed
  // key) so the button reads as physical, not just a flat tinted rect.
  const base = `u-press flex-1 min-w-[110px] flex items-center justify-center gap-[6px] font-semibold font-['Outfit',sans-serif] rounded-[10px] border ring-1 ring-[#18181c]/[0.06] ring-offset-1 ring-offset-transparent cursor-pointer transition-all duration-150 shadow-[0_1px_2px_rgba(24,24,28,0.06),inset_0_1px_0_rgba(255,255,255,0.7)] hover:shadow-[0_4px_10px_rgba(24,24,28,0.12),inset_0_1px_0_rgba(255,255,255,0.7)] hover:-translate-y-[1px] hover:ring-[#18181c]/[0.1] active:translate-y-0 active:shadow-[0_1px_2px_rgba(24,24,28,0.06),inset_0_1px_2px_rgba(24,24,28,0.06)] tracking-[0.01em] ${
    compact ? "h-[30px] text-[11px] px-[8px]" : "h-[36px] text-[12.5px] px-[12px]"
  }`;
  const iconSize = compact ? 12 : 13;

  return (
    <div className={`flex flex-wrap ${compact ? "gap-[6px]" : "gap-[8px]"}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSave();
        }}
        aria-pressed={saved}
        className={base}
        style={{
          background: saved ? "#fdf1d8" : "#ffffff",
          borderColor: saved ? "#e8c07a" : "#dedee3",
          color: "#a5690a",
        }}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill={saved ? "currentColor" : "none"}>
          <path
            d="M4 2.5h8a.5.5 0 0 1 .5.5v10.3a.4.4 0 0 1-.63.33L8 11.2l-3.87 2.43a.4.4 0 0 1-.63-.33V3a.5.5 0 0 1 .5-.5Z"
            stroke="currentColor"
            strokeWidth={saved ? 0 : 1.3}
          />
        </svg>
        {saved ? "Saved" : "Save for later"}
      </button>

      {!hideHiRes && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestHiRes();
          }}
          className={base}
          style={{ background: "#ffffff", borderColor: "#dedee3", color: "#464650" }}
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 4.6v3.4l2.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {compact ? "Hi-res analysis" : "Request hi-res analysis"}
        </button>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleResolve();
        }}
        aria-pressed={resolved}
        className={base}
        style={{
          background: resolved ? "#e0f3e6" : "#ffffff",
          borderColor: resolved ? "#a9d9ba" : "#dedee3",
          color: "#227741",
        }}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none">
          <path d="M3.5 8.5 6.3 11.3 12.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {resolved ? "Resolved" : "Resolve"}
      </button>
    </div>
  );
}
