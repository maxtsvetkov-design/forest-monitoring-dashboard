import type { SeverityLabel } from "./severity";

export interface FarmDetection {
  headline: string;
  detail: string;
  tone: "amber" | "red";
  severity: SeverityLabel;
  detectedOn: string;
  confidencePct: number;
  baseline: string;
  current: string;
  change: string;
  recommendation: string;
}

/** RFP satellite-imagery detection examples, shared by the farm cards and
 * their map-anchored popups so both surfaces always report the same finding. */
export const FARM_DETECTIONS: Record<string, FarmDetection> = {
  A: {
    headline: "3 new farm structures detected",
    detail: "Type: protected — farm structure area increase from 50 sqm to 150 sqm",
    tone: "amber",
    severity: "WARNING",
    detectedOn: "Sep 18, 2026",
    confidencePct: 93,
    baseline: "1 protected structure · 50 sqm",
    current: "4 protected structures · 150 sqm",
    change: "+3 structures · +100 sqm",
    recommendation: "Confirm permits and compare the new footprints with the registered farm plan.",
  },
  B: {
    headline: "Increase in cultivated area detected",
    detail: "Alfalfa forage (89% confidence) — total cultivated area now 95% of total farm area",
    tone: "red",
    severity: "CRITICAL",
    detectedOn: "Sep 18, 2026",
    confidencePct: 89,
    baseline: "82% cultivated area",
    current: "95% cultivated area",
    change: "+13 percentage points",
    recommendation: "Validate the expanded alfalfa strip and update the registered cultivated boundary.",
  },
  C: {
    headline: "Decrease in cultivated area detected",
    detail: "Fallow land now 15% of total farm area",
    tone: "amber",
    severity: "WARNING",
    detectedOn: "Sep 18, 2026",
    confidencePct: 91,
    baseline: "94% cultivated · 6% fallow",
    current: "85% cultivated · 15% fallow",
    change: "−9 percentage points cultivated",
    recommendation: "Review the newly fallow plots for abandonment, water stress, or crop-cycle transition.",
  },
};
