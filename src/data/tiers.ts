/**
 * Static service-tier comparison data — mirrors the pricing/coverage table
 * the product team shared (Tier 1 free satellite through Tier 4 + ground
 * survey). Powers the "Unavailable at your tier" section of LayerPanel and
 * the TierComparisonModal it opens: which capabilities are locked is
 * derived directly from this table (a row locked at the current tier is
 * whichever row's cell for CURRENT_TIER_INDEX is "none"), not maintained as
 * a separate list that could drift out of sync with it.
 */

export type TierCoverage = "full" | "half" | "none";

export interface TierInfo {
  label: string;
  name: string;
}

export interface TierRow {
  id: string;
  label: string;
  cells: [TierCoverage, TierCoverage, TierCoverage, TierCoverage];
}

export interface TierSection {
  title: string;
  rows: TierRow[];
}

export const TIERS: TierInfo[] = [
  { label: "Tier 1", name: "Free satellite" },
  { label: "Tier 2", name: "Commercial satellite" },
  { label: "Tier 3", name: "+ Drone" },
  { label: "Tier 4", name: "+ Ground survey" },
];

/** This app's demo contract sits on Tier 2 — see LayerPanel's locked-layer
 * section and the modal's "Your tier" badge. */
export const CURRENT_TIER_INDEX = 1;

export const SPEC_ROWS: { label: string; cells: [string, string, string, string] }[] = [
  { label: "Resolution", cells: ["Block level 10–30 m", "0.3–0.5 m", "Per tree ±5 cm", "Field-verified"] },
  { label: "Cadence", cells: ["Weekly–monthly", "Monthly / on demand", "Monthly–annual", "Annual / on request"] },
];

export const TIER_SECTIONS: TierSection[] = [
  {
    title: "Forest condition",
    rows: [
      { id: "stressed-block", label: "Stressed-block detection", cells: ["full", "full", "full", "full"] },
      { id: "canopy-cover-change", label: "Canopy & cover change", cells: ["full", "full", "full", "full"] },
      { id: "carbon-stock", label: "Carbon stock estimate", cells: ["half", "full", "full", "full"] },
      { id: "irrigation-efficiency", label: "Irrigation-efficiency map", cells: ["half", "full", "full", "full"] },
    ],
  },
  {
    title: "Tree-level asset record",
    rows: [
      { id: "tree-count-density", label: "Tree count & density", cells: ["none", "half", "full", "full"] },
      { id: "height-crown-diameter", label: "Height & crown diameter", cells: ["none", "half", "full", "full"] },
      { id: "species-id", label: "Species identification", cells: ["none", "none", "full", "full"] },
      { id: "per-tree-health", label: "Per-tree health rating & photo", cells: ["none", "none", "full", "full"] },
      { id: "chlorophyll-stress", label: "Chlorophyll / sparse-cover stress", cells: ["none", "none", "full", "full"] },
    ],
  },
  {
    title: "Ground & infrastructure",
    rows: [
      { id: "invasive-species", label: "Invasive species", cells: ["none", "none", "half", "full"] },
      { id: "soil-salinity", label: "Soil salinity & moisture", cells: ["none", "none", "none", "full"] },
      { id: "scada-irrigation", label: "SCADA irrigation integration", cells: ["none", "none", "none", "full"] },
    ],
  },
  {
    title: "Every tier",
    rows: [
      { id: "platform-access", label: "Forest Monitoring platform access", cells: ["full", "full", "full", "full"] },
      {
        id: "alerts-tracking",
        label: "Alerts with coordinates & action tracking",
        cells: ["full", "full", "full", "full"],
      },
      { id: "gis-export", label: "Export to client GIS / asset system", cells: ["full", "full", "full", "full"] },
    ],
  },
];

export const PRICE_ROW: { label: string; cells: [string, string, string, string] } = {
  label: "Indicative price",
  cells: [
    "40–120 AED/ha/yr",
    "Tier 1 + imagery pass-through",
    "290 AED/ha survey + 290–490/ha updates",
    "Tier 3 + field crew day rate",
  ],
};

/** Every row not fully available at CURRENT_TIER_INDEX — backs the layer
 * panel's locked-layer chips, one per row, in table order. */
export const LOCKED_AT_CURRENT_TIER: TierRow[] = TIER_SECTIONS.flatMap((s) => s.rows).filter(
  (row) => row.cells[CURRENT_TIER_INDEX] !== "full",
);

/** Which tier first fully unlocks a row — used for the layer panel's "Tier N+" badge. */
export function firstFullTierIndex(row: TierRow): number {
  return row.cells.findIndex((c) => c === "full");
}
