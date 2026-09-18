/**
 * The three-step severity scale shared by every "flagged detection" reading
 * in this app — a habitat-change event's `severityLabel`, and now a
 * compliance-detection object's own severity (`agriculturalCompliance.ts`).
 *
 * One table rather than two: `HabitatChangeCard` and `ComplianceLegend` both
 * need identical colours for "CRITICAL", so a reader learns the palette once
 * and it means the same thing everywhere it appears, rather than each card
 * quietly keeping its own copy that could drift.
 */
export type SeverityLabel = "CRITICAL" | "WARNING" | "INFO";

export const SEVERITY_STYLE: Record<SeverityLabel, { bg: string; fg: string; dot: string; accent: string }> = {
  CRITICAL: { bg: "#fde8e8", fg: "#c0392b", dot: "#e5484d", accent: "#e5484d" },
  WARNING: { bg: "#fdf1d8", fg: "#a5690a", dot: "#e8a33d", accent: "#e8a33d" },
  INFO: { bg: "#e6f2ec", fg: "#096151", dot: "#2e9b6f", accent: "#2e9b6f" },
};
