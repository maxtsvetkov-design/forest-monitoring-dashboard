/**
 * The marine/terrestrial habitat classification key, transcribed from the
 * reference sheet supplied for Al Maha Forest.
 *
 * Lives here rather than inside `HabitatLegend.tsx` because it is no longer
 * only a legend: the per-class change breakdown in the event detail panel
 * reads its codes, labels and swatch colours from this same table (see
 * `habitatClassChange.ts`). Two copies would let a class's colour in the
 * legend drift from the same class's colour in a chart — the exact failure
 * `taxonomy.ts` already keeps one table to avoid.
 *
 * This app has no raster actually classified into these codes, so the legend
 * presents itself as a reference key rather than a live, queryable layer.
 */
export interface LegendEntry {
  code: string;
  label: string;
  /** Absent for the one reference row with no printed swatch (16200) — shown
   *  as an outlined box rather than a guessed fill color. */
  color?: string;
  /** True for the one hatched swatch (1041) — a diagonal stripe pattern
   *  rather than a flat fill, reproduced rather than flattened to a color. */
  hatched?: boolean;
}

export const MARINE_HABITAT: LegendEntry[] = [
  { code: "11100", label: "Fringing reef", color: "#E24FC0" },
  { code: "11110", label: "Fringing reef with macroalgae", color: "#D9A17E" },
  { code: "11200", label: "Patch reef", color: "#5C0E3A" },
  { code: "11210", label: "Patch reef with macroalgae", color: "#E38EE0" },
  { code: "12000", label: "Seagrass bed", color: "#2D6B1E" },
  { code: "13000", label: "Hard-bottom", color: "#9B9B9B" },
  { code: "13010", label: "Hard-bottom with macroalgae", color: "#B7A83A" },
  { code: "14000", label: "Unconsolidated bottom", color: "#D4F5E9" },
  { code: "14100", label: "Unconsolidated bottom with macroalgae", color: "#D6F17A" },
  { code: "15100", label: "Rock armouring / artificial reef", color: "#9C3B25" },
  { code: "15200", label: "Marine structure", color: "#1F4EA6" },
  { code: "16100", label: "Dredged seabed", color: "#6B4423" },
  { code: "16200", label: "Dredged area wall" },
  { code: "17000", label: "Deep sub-tidal seabed", color: "#8EC8F2" },
];

export const TERRESTRIAL_HABITAT: LegendEntry[] = [
  { code: "1010", label: "Mudflats and sand exposed at low tide", color: "#B7B4EA" },
  { code: "1020", label: "Sheltered tidal flats with cyanobacterial mats", color: "#A8D9BE" },
  { code: "1030", label: "Saltmarsh", color: "#D8D6F5" },
  { code: "1040", label: "Mangroves", color: "#2ECC71" },
  { code: "1041", label: "Mangrove plantation", color: "#2ECC71", hatched: true },
  { code: "1050", label: "Storm beach ridges", color: "#8C8A4E" },
  { code: "1060", label: "Sandy beaches", color: "#8C7355" },
  { code: "1070", label: "Beach rock and gravelly beaches", color: "#5C3317" },
  { code: "2011", label: "Coastal plains on well-drained sandy ground", color: "#D9D9D9" },
  { code: "2012", label: "Coastal plains on well-drained rocky or gravelly terrain", color: "#8C8C8C" },
  { code: "2020", label: "Coastal sand sheets and low dunes", color: "#EAEAEA" },
  { code: "2030", label: "Coastal cliffs, headlands, rocky slopes and wadis in coastal situations", color: "#3A1F5C" },
  { code: "3100", label: "Coastal sabkha, including sabkha matti", color: "#B8A83A" },
  { code: "4110", label: "Sand sheets and dunes with tree cover", color: "#C4D94A" },
  { code: "4120", label: "Sand sheets and dunes with shrub cover", color: "#E8C93A" },
  { code: "4130", label: "Sand sheets and dunes with dwarf shrub cover", color: "#F5F03A" },
  { code: "4140", label: "Sand sheets and dunes with perennial herbs and graminoids", color: "#F5F5B8" },
  { code: "4200", label: "Mega-dunes", color: "#E0902E" },
];

/** One class by its code, from either table — so a caller naming a code gets
 *  that class's real printed label and swatch colour rather than restating
 *  either. Throws rather than returning a placeholder: a code that isn't in
 *  the key is a typo in the caller, not a runtime condition to paper over. */
export function habitatClassByCode(code: string): LegendEntry {
  const found = [...MARINE_HABITAT, ...TERRESTRIAL_HABITAT].find((e) => e.code === code);
  if (!found) throw new Error(`Unknown habitat classification code: ${code}`);
  return found;
}
