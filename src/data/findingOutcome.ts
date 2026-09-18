/**
 * The one decision every compliance finding on Liwa Oasis eventually needs —
 * accepted, waved off as a false positive, or sent for a closer look —
 * shared by the ranked worklist (cards + table) and the map's own violation
 * record so setting it in one place is reflected everywhere the same finding
 * shows up (they're keyed by the same `TreeEvent.id`, held in one map by
 * whichever view mounted them both — see AssetsView's `findingOutcomes`).
 *
 * Session-only, like this app's other action buttons (`EventActionButtons`'s
 * own save/resolve toggles) — there is no ticketing backend behind this
 * either, just a visible record of the choice for as long as the tab stays
 * open.
 */
export type FindingOutcome = "accepted" | "false_positive" | "hi_res";

export const OUTCOME_META: Record<
  FindingOutcome,
  { label: string; shortLabel: string; bg: string; fg: string }
> = {
  accepted: { label: "Accepted as a finding", shortLabel: "Accepted", bg: "#e6f2ec", fg: "#096151" },
  false_positive: { label: "Dismissed — false positive", shortLabel: "False positive", bg: "#f0f0f2", fg: "#5b5b66" },
  hi_res: { label: "In progress — evidence pack sent", shortLabel: "In progress", bg: "#eaf1fe", fg: "#2f6fed" },
};
