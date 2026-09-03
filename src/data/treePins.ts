import type { MapOverlay } from "./overlays";
import { generateTreeRecords, type TreeRecord } from "./trees";
import type { MonthSnapshot } from "./types";

export type PinSeverity = "Dead" | "Declining" | "Stressed";

export interface TreePin {
  id: string;
  lng: number;
  lat: number;
  /** Position in the overlay image's own space: 0→1 left→right. */
  u: number;
  /** Position in the overlay image's own space: 0→1 top→bottom. */
  v: number;
  severity: PinSeverity;
  canopyLossPct: number;
  lastSurveyed: string;
  /** Index into the snapshots array this pin's flag was raised in. */
  monthIndex: number;
}

export const SEVERITY_COLOR: Record<PinSeverity, string> = {
  Dead: "#8C8C8C",
  Declining: "#E55C2F",
  Stressed: "#F0B429",
};

/** A pin is just a tree that isn't healthy. */
function isFlagged(record: TreeRecord): boolean {
  return record.health !== "Healthy";
}

/**
 * Projects the area's tree records (see `generateTreeRecords`, the single
 * source of truth) down to the flagged subset the map draws as pins.
 *
 * This deliberately generates nothing of its own. Pins and the Areas table rows
 * are the same records — a pin *is* a table row that happens not to be Healthy —
 * so the flagged count on the map and the Declining/Dead/Stressed rows in the
 * table can never disagree for a given date range.
 *
 * Pin density still tracks the recovery curve, but now as an emergent property:
 * each month logs a fixed-size survey batch whose health mix is drawn from that
 * month's own healthCounts, so a badly degraded month leaves ~7 trees flagged
 * and a mostly-recovered one ~2.
 *
 * Every pin carries the `monthIndex` it was raised in. Callers (MapCanvas)
 * filter this pool against the selected date range and toggle each marker's
 * visibility accordingly, so pins appear and disappear as the timeline moves
 * instead of showing a single fixed snapshot regardless of range.
 */
export function generateTreePins(overlay: MapOverlay, areaId: string, snapshots: MonthSnapshot[]): TreePin[] {
  return generateTreeRecords(overlay, areaId, snapshots)
    .filter(isFlagged)
    .map((record) => ({
      id: record.id,
      lng: record.lng,
      lat: record.lat,
      u: record.u,
      v: record.v,
      // Safe: `isFlagged` has already excluded "Healthy", leaving exactly the
      // three values PinSeverity allows.
      severity: record.health as PinSeverity,
      canopyLossPct: record.canopyLossPct,
      lastSurveyed: record.lastSurveyed,
      monthIndex: record.monthIndex,
    }));
}
