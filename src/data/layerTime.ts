import type { ContentLayerId } from "../components/LayerPanel";
import { areaDyingTreeSequence, areaTimelapseImages } from "./overlays";

/**
 * What a layer actually has for a given month. `captured` means a real
 * observation exists; `gap` means the month falls inside the timeline but this
 * layer never saw it; `planned` is the locked future tail past the dataset.
 */
export type CoverageKind = "captured" | "gap" | "planned";

/** Months shown past the end of the real data as a locked preview. Matches the
 * `buildUpcomingMonthLabels(2)` call the full-size timeline already makes. */
export const PLANNED_TAIL_MONTHS = 2;

export interface LayerCoverage {
  /** One entry per real month, followed by PLANNED_TAIL_MONTHS planned entries. */
  kinds: CoverageKind[];
  capturedCount: number;
  gapCount: number;
  plannedCount: number;
  /** Nearest captured index at or before `index`; -1 when none exists. */
  resolve(index: number): number;
}

/**
 * Which month indices a layer genuinely observes.
 *
 * Takes `areaId` and `monthCount` rather than an Area: those are the only two
 * facts it needs, and asking for less lets MapCanvas — which holds an id and a
 * snapshot list, not an Area — call it directly.
 *
 * Every branch reads the same array the map itself renders from, so a strip can
 * never claim coverage the overlay doesn't have. The `dyingTrees` branch is the
 * reason this module exists: `dyingTreeOverlayForRange` already clamps months
 * before its sequence window to the mildest frame, and until now nothing said
 * so — those months are gaps, not observations.
 */
export function layerCoverage(id: ContentLayerId, areaId: string, monthCount: number): LayerCoverage {
  const months = monthCount;
  const kinds: CoverageKind[] = new Array(months).fill("gap");

  switch (id) {
    case "canopy":
    case "pins":
      // Tallied from the population for every month — see monthlySnapshots.ts.
      // Dense by construction: if a month has a snapshot, these layers saw it.
      kinds.fill("captured");
      break;

    case "aerial":
    case "generative": {
      // N frames spread as equal buckets across the window; the capture is the
      // first month of each bucket. This is the inverse of timelapseBucketIndex
      // in overlays.ts, which maps a month to its bucket — keep the two in step
      // or a strip will claim a capture in a month that renders a neighbour's
      // photo. An area with no imagery has imageCount 0, so the loop never runs
      // and every month stays a gap.
      const images = areaTimelapseImages[areaId];
      const imageCount = images?.length ?? 0;
      for (let i = 0; i < imageCount; i++) {
        const index = Math.floor((i * months) / imageCount);
        if (index < months) kinds[index] = "captured";
      }
      break;
    }
    case "dyingTrees": {
      // One frame per one of the FINAL months, not spread across the whole
      // window — see areaDyingTreeSequence's comment. Every month before that
      // window is a genuine gap: dyingTreeOverlayForRange clamps them to its
      // mildest frame, which is a fallback, not an observation.
      const sequence = areaDyingTreeSequence[areaId];
      const frameCount = sequence?.length ?? 0;
      for (let i = Math.max(0, months - frameCount); i < months; i++) {
        kinds[i] = "captured";
      }
      break;
    }
  }

  for (let i = 0; i < PLANNED_TAIL_MONTHS; i++) kinds.push("planned");

  const capturedCount = kinds.filter((k) => k === "captured").length;
  const gapCount = kinds.filter((k) => k === "gap").length;

  return {
    kinds,
    capturedCount,
    gapCount,
    plannedCount: PLANNED_TAIL_MONTHS,
    resolve(index: number) {
      for (let i = Math.min(index, months - 1); i >= 0; i--) {
        if (kinds[i] === "captured") return i;
      }
      return -1;
    },
  };
}

/** The one-line summary under a coverage strip. */
export function coverageCaption(coverage: LayerCoverage): string {
  if (coverage.capturedCount === 0) return "no captures";
  const captures = `${coverage.capturedCount} ${coverage.capturedCount === 1 ? "capture" : "captures"}`;
  return coverage.gapCount === 0 ? captures : `${captures} · ${coverage.gapCount} gaps`;
}
