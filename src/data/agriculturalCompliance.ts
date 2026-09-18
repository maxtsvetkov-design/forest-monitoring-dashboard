import type { SeverityLabel } from "./severity";

/**
 * The reference taxonomy behind Liwa Oasis's compliance-monitoring
 * notifications — "2.1.5 Typical Agricultural Compliance Detection
 * Scenarios": five categories a CV pass over a leased agricultural block
 * checks for, each with the specific objects it looks for within it.
 *
 * Purely a reference key, the same way `habitatLegend.ts`'s marine/
 * terrestrial tables are: nothing in this app runs a real CV pass over
 * imagery, so this is presented (in `ComplianceLegend`) as the taxonomy a
 * compliance scan checks against, not a live detector's own output. The
 * notifications drawn from it (`events.ts`'s `randomComplianceDetection`)
 * are the same honesty this app always gives its seeded mock data: stable
 * per event, grounded on a real tree record's position, never claimed to be
 * a live model result.
 *
 * `severityLabel` is a judgement call, not part of the source list — an
 * active fire or an unpermitted structure is categorically worse than an
 * uncovered tank, and the compliance feed's "Important only" filter needs
 * that ranking to mean something. Documented per entry below.
 */
export type ComplianceCategory =
  | "Unhealthy Vegetation"
  | "Waste Burning"
  | "Agricultural Waste"
  | "Non-Agricultural Use"
  | "Irrigation Tank";

export interface ComplianceDetectionObject {
  code: string;
  category: ComplianceCategory;
  label: string;
  severityLabel: SeverityLabel;
  /** One sentence: what finding this object actually means for the block,
   *  read by both the legend (as reference) and the notification's own
   *  description (as the "why this was flagged" line). */
  note: string;
}

export const COMPLIANCE_DETECTION_OBJECTS: ComplianceDetectionObject[] = [
  // Unhealthy Vegetation — the block's own plant health, same condition
  // scale the rest of this app already reads trees against.
  {
    code: "VEG-DEAD",
    category: "Unhealthy Vegetation",
    label: "Dead Tree",
    severityLabel: "WARNING",
    note: "A standing dead tree — remove and replace before the surrounding stand shows secondary stress.",
  },
  {
    code: "VEG-INFECTED",
    category: "Unhealthy Vegetation",
    label: "Infected Vegetation",
    severityLabel: "WARNING",
    note: "Foliage discoloration consistent with disease across a cluster of trees — isolate pending a lab sample.",
  },

  // Waste Burning — open burning and its aftermath, ranked by how recent
  // and how active the finding is.
  {
    code: "BURN-ACTIVE",
    category: "Waste Burning",
    label: "Active Fire Spot",
    severityLabel: "CRITICAL",
    note: "A live burn on the block — a reportable breach requiring an immediate ground response.",
  },
  {
    code: "BURN-SCORCH",
    category: "Waste Burning",
    label: "Waste Scorch Marks",
    severityLabel: "WARNING",
    note: "Ground scorch from a recent, now-extinguished burn — log the incident and confirm no embers remain.",
  },
  {
    code: "BURN-ASH",
    category: "Waste Burning",
    label: "Combustion Residual Ash",
    severityLabel: "INFO",
    note: "Ash from a prior burn still visible — schedule clearance before the next irrigation cycle spreads it.",
  },

  // Agricultural Waste — matter that belongs on a farm, but not left where
  // it was found.
  {
    code: "WASTE-VEGETAL",
    category: "Agricultural Waste",
    label: "Vegetal Waste",
    severityLabel: "INFO",
    note: "Uncollected pruning and frond waste at the block edge — clear before it becomes pest cover.",
  },
  {
    code: "WASTE-ANIMAL",
    category: "Agricultural Waste",
    label: "Animal Remains",
    severityLabel: "WARNING",
    note: "Livestock or wildlife remains on the block — arrange removal under the site's biosecurity procedure.",
  },

  // Non-Agricultural Use — the block's leased purpose is farming; anything
  // else found on it is a land-use compliance question.
  {
    code: "LANDUSE-VEHICLE",
    category: "Non-Agricultural Use",
    label: "Vehicle Storage Area",
    severityLabel: "WARNING",
    note: "Parked vehicles with no agricultural equipment signature — confirm the land permit covers this use.",
  },
  {
    code: "LANDUSE-TRUCK",
    category: "Non-Agricultural Use",
    label: "Truck Storage Area",
    severityLabel: "WARNING",
    note: "Heavy trucks stored on agricultural land — confirm the land permit covers this use before inspection.",
  },
  {
    code: "LANDUSE-HOUSING",
    category: "Non-Agricultural Use",
    label: "Non-agricultural Housing",
    severityLabel: "CRITICAL",
    note: "A built structure with no agricultural function — typically the most serious land-use finding on a lease.",
  },

  // Irrigation Tank — a required fixture, checked for the one condition
  // (a cover) that actually matters for compliance and water loss.
  {
    code: "TANK-COVERED",
    category: "Irrigation Tank",
    label: "Covered Irrigation Tank",
    severityLabel: "INFO",
    note: "The block's irrigation tank is fitted with a cover, as required — logged for the compliance record.",
  },
  {
    code: "TANK-UNCOVERED",
    category: "Irrigation Tank",
    label: "Uncovered Irrigation Tank",
    severityLabel: "WARNING",
    note: "No cover fitted — a standing finding, and a real evaporation loss until one is installed.",
  },
];

export function complianceObjectByCode(code: string): ComplianceDetectionObject {
  const found = COMPLIANCE_DETECTION_OBJECTS.find((o) => o.code === code);
  if (!found) throw new Error(`Unknown compliance detection code: ${code}`);
  return found;
}

/** Every category, in the source list's own order — what `ComplianceLegend`
 *  groups its sections by. */
export const COMPLIANCE_CATEGORIES: ComplianceCategory[] = [
  "Unhealthy Vegetation",
  "Waste Burning",
  "Agricultural Waste",
  "Non-Agricultural Use",
  "Irrigation Tank",
];
