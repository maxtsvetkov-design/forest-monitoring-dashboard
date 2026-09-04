export type MapColorMode = "normal" | "grayscale" | "night" | "thermal" | "sepia" | "ndvi";

/**
 * Whole-map CSS filter recipes, keyed by mode — the same "filter over the
 * isolated map container" trick the original thermal-only toggle used,
 * generalised to a small set of the color modes most GIS/imagery viewers
 * ship (true color, grayscale, night, thermal/heat, sepia, an NDVI-style
 * vegetation false-color). None of these bake in their own contrast; the
 * user's contrast slider (MapCanvas's mapContrast state) is appended on top
 * of whichever recipe is active, so it works the same way in every mode.
 */
export const MAP_COLOR_MODES: { id: MapColorMode; label: string; filter: string; swatch: string }[] = [
  { id: "normal", label: "Normal", filter: "none", swatch: "linear-gradient(135deg, #7fb88f, #b7d8a0)" },
  { id: "grayscale", label: "Grayscale", filter: "grayscale(1)", swatch: "linear-gradient(135deg, #5b5b66, #dedee3)" },
  {
    id: "night",
    label: "Night",
    filter: "brightness(0.55) saturate(0.75) hue-rotate(180deg)",
    swatch: "linear-gradient(135deg, #0b1f3a, #1b3a63)",
  },
  {
    id: "thermal",
    label: "Thermal",
    filter: "grayscale(1) sepia(1) hue-rotate(-18deg) saturate(4.5) brightness(1.05)",
    swatch: "linear-gradient(135deg, #7a1a0a, #f2a53a)",
  },
  {
    id: "sepia",
    label: "Sepia",
    filter: "sepia(0.75) saturate(1.1) brightness(1.02)",
    swatch: "linear-gradient(135deg, #8a6a3a, #d8bd8a)",
  },
  {
    id: "ndvi",
    label: "Vegetation (NDVI)",
    filter: "invert(1) hue-rotate(60deg) saturate(1.6) brightness(0.95)",
    swatch: "linear-gradient(135deg, #c23a6b, #e0568a)",
  },
];

export const DEFAULT_MAP_CONTRAST = 1;
export const MAP_CONTRAST_MIN = 0.5;
export const MAP_CONTRAST_MAX = 2;

/** Composes a mode's own recipe with the user's contrast multiplier into the
 * single `filter` value applied to the map container. */
export function buildMapFilter(mode: MapColorMode, contrast: number): string {
  const recipe = MAP_COLOR_MODES.find((m) => m.id === mode)?.filter ?? "none";
  const contrastTerm = `contrast(${contrast})`;
  return recipe === "none" ? contrastTerm : `${recipe} ${contrastTerm}`;
}
