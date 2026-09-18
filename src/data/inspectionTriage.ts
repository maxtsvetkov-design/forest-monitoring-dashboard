import { seededRandom } from "./random";
import type { TreeEvent } from "./events";
import type { SeverityLabel } from "./severity";
import { fieldLetterForU } from "./farmFields";
import { COMPLIANCE_DETECTION_OBJECTS } from "./agriculturalCompliance";

/**
 * Liwa Oasis's notifications, read as a ranked, filterable worklist rather
 * than a scrolling card feed — farm/field ID, violation type, confidence,
 * date detected, severity, and a real ground position for spatial
 * clustering. Every field here is derived from data this app already
 * computes for real; nothing is invented for this view specifically.
 *
 * - `farmId` / `field` — there is no real field-boundary survey for Liwa
 *   (see `CropFieldsTable`'s own comment), so the same even four-way split
 *   by each event's own tree's `u` position stands in for "which field" —
 *   the identical grouping the Crop fields table already uses, via the
 *   shared `farmFields.ts`.
 * - `severityLabel` reads off the violation's own real compliance severity
 *   (`COMPLIANCE_DETECTION_OBJECTS`, the reference table `ComplianceLegend`
 *   already presents as the scan's own taxonomy) via the event's title,
 *   which `generateCropEvents` always sets to that same object's `label` —
 *   *not* off the flagged tree's canopy condition. The two used to be
 *   conflated (a WARNING finding whose picked tree happened to be healthy
 *   silently read as INFO), which meant a genuinely CRITICAL finding like
 *   unpermitted housing could show as low-priority purely because of which
 *   tree the generator happened to stand it next to — a land-use breach and
 *   a leaf's colour are unrelated facts, and only the former is what this
 *   card is actually judging.
 * - `confidencePct` is the one genuinely modelled figure here — this app
 *   runs no real CV confidence scoring — seeded per event id so it is
 *   stable across reloads, and its range is set by the same severity this
 *   card already reports, so a CRITICAL finding never reads as a lower
 *   confidence than an INFO one sitting beside it.
 */

/** `event.title` is always `${object.label} ${"confirmed" | "detected"}`
 *  (see `randomComplianceDetection`) — sorting objects longest-label-first
 *  means a label that is itself a prefix of another (e.g. "Vehicle Storage
 *  Area" / none here today, but the class of bug is worth guarding against)
 *  can never shadow the more specific match. */
const COMPLIANCE_OBJECTS_BY_LABEL_LENGTH = [...COMPLIANCE_DETECTION_OBJECTS].sort(
  (a, b) => b.label.length - a.label.length,
);

function severityForEventTitle(title: string): SeverityLabel {
  const match = COMPLIANCE_OBJECTS_BY_LABEL_LENGTH.find((o) => title.startsWith(o.label));
  // Every compliance event's title is built from this same table (see this
  // file's own module comment), so a miss here would mean the two have
  // drifted apart — falling back to INFO rather than throwing keeps a
  // stale/renamed label from taking the whole worklist down with it.
  return match?.severityLabel ?? "INFO";
}

const CONFIDENCE_RANGE: Record<SeverityLabel, [number, number]> = {
  CRITICAL: [90, 97],
  WARNING: [78, 88],
  INFO: [62, 77],
};

export interface TriageEntry {
  event: TreeEvent;
  farmId: string;
  field: string;
  violationType: string;
  severityLabel: SeverityLabel;
  confidencePct: number;
  dateDetected: Date;
  lat: number;
  lng: number;
}

export function buildTriageEntries(events: TreeEvent[]): TriageEntry[] {
  return events.map((event) => {
    const field = fieldLetterForU(event.tree.u);
    const severityLabel = severityForEventTitle(event.title);
    const rand = seededRandom(`triage-confidence:${event.id}`);
    const [lo, hi] = CONFIDENCE_RANGE[severityLabel];
    return {
      event,
      farmId: `LIWA-${field}`,
      field,
      violationType: event.title,
      severityLabel,
      confidencePct: Math.round(lo + rand() * (hi - lo)),
      dateDetected: event.date,
      lat: event.tree.lat,
      lng: event.tree.lng,
    };
  });
}
