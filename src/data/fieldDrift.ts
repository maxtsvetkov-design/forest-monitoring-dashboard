/**
 * Field A-D's registration-drift status, shared between `DriftListView` (the
 * table) and `FieldBorderLayer` (the map's own liquid-shader boundary) so the
 * two can never disagree on which field is flagged. `DriftListView` still
 * owns the parcel/crop/note detail that only its table shows — this is just
 * the one number (and the threshold that turns it into a status) both places
 * need.
 */
export const CORRECTION_THRESHOLD_PCT = 15;

export interface FieldDrift {
  /** A field letter, matching `farmFields.ts`'s `FIELD_LETTERS`. */
  field: string;
  /** Share of the parcel's mapped area that doesn't match its registered
   *  crop, 0 when the scan confirms the filing exactly. */
  driftPct: number;
}

export const FIELD_DRIFT: FieldDrift[] = [
  { field: "A", driftPct: 0 },
  { field: "B", driftPct: 22 },
  { field: "C", driftPct: 100 },
  { field: "D", driftPct: 9 },
];

/** Same three-way read `DriftBadge` (DriftListView.tsx) renders as a pill —
 *  shared so the map's border colour and the table's badge never diverge. */
export function driftStatus(driftPct: number): "matches" | "minor" | "correction" {
  if (driftPct === 0) return "matches";
  return driftPct >= CORRECTION_THRESHOLD_PCT ? "correction" : "minor";
}

/** Hex accents lifted straight from `DriftBadge`'s own pill colours — the
 *  border reads as the same three-way signal the table already teaches. */
export const DRIFT_STATUS_COLOR: Record<ReturnType<typeof driftStatus>, string> = {
  matches: "#0f9d68",
  minor: "#c98a1a",
  correction: "#d1483a",
};
