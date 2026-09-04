import type { MapOverlay } from "./overlays";
import { CONDITION_COLOR, isFlaggedCondition, type ConditionKey } from "./taxonomy";
import { generateTreeRecordsAt } from "./trees";
import type { MonthSnapshot } from "./types";

/** A pin's severity is the tree's condition, restricted to the flagged bands —
 * Moderate, Sparse and Defoliated all earn a marker. */
export type PinSeverity = ConditionKey;

export interface TreePin {
  id: string;
  lng: number;
  lat: number;
  /** Position in the overlay image's own space: 0→1 left→right. */
  u: number;
  /** Position in the overlay image's own space: 0→1 top→bottom. */
  v: number;
  /**
   * Condition per month, or null in months this tree was healthy enough not to
   * be flagged. One pin per TREE, not per (tree, month): a tree stands in one
   * place for the whole window, so it wants exactly one marker whose colour and
   * visibility change as the timeline moves.
   *
   * Modelling it the other way — a marker per flagged month — put 2,206 markers
   * on the map for a 340-tree plot, and since MapLibre re-transforms every
   * marker it owns on every frame, panning collapsed to roughly two frames a
   * second.
   */
  severityByMonth: (PinSeverity | null)[];
  /** Canopy loss per month, paired with severityByMonth. */
  canopyLossByMonth: number[];
  /** Month labels, so a tooltip can name the month it is describing. */
  monthLabels: string[];
}

export const SEVERITY_COLOR: Record<PinSeverity, string> = CONDITION_COLOR;

/** This tree's severity in a given month, or null if it wasn't flagged then. */
export function pinSeverityAt(pin: TreePin, monthIndex: number): PinSeverity | null {
  return pin.severityByMonth[monthIndex] ?? null;
}

/**
 * Projects the population (see treePopulation.ts, the single source of truth)
 * down to the trees the map draws as pins.
 *
 * This generates nothing of its own: a pin *is* a table row that reaches a
 * flagged condition at some point in the window, so the count on the map and
 * the flagged rows in the table are the same trees by construction.
 *
 * Trees never flagged in any month are dropped entirely — they would be a
 * permanently hidden marker paying MapLibre's per-frame transform cost forever.
 */
export function generateTreePins(
  overlay: MapOverlay,
  areaId: string,
  snapshots: MonthSnapshot[],
  scale = 1,
): TreePin[] {
  const monthLabels = snapshots.map((s) => s.label);
  const byId = new Map<string, TreePin>();

  snapshots.forEach((_, monthIndex) => {
    for (const record of generateTreeRecordsAt(overlay, areaId, snapshots, monthIndex, scale)) {
      let pin = byId.get(record.id);
      if (!pin) {
        pin = {
          id: record.id,
          lng: record.lng,
          lat: record.lat,
          u: record.u,
          v: record.v,
          severityByMonth: new Array(snapshots.length).fill(null),
          canopyLossByMonth: new Array(snapshots.length).fill(0),
          monthLabels,
        };
        byId.set(record.id, pin);
      }
      pin.canopyLossByMonth[monthIndex] = record.canopyLossPct;
      if (isFlaggedCondition(record.condition)) {
        pin.severityByMonth[monthIndex] = record.condition;
      }
    }
  });

  return [...byId.values()].filter((pin) => pin.severityByMonth.some((s) => s !== null));
}
