import type { ContentLayerId } from "../components/LayerPanel";
import type { MapColorMode } from "../components/mapColorModes";

/**
 * What the map does while each story block is the one being read.
 *
 * The Story tab shows the narrative and the plot side by side, and until now
 * those two halves ignored each other: you could be reading "972 trees flagged
 * defoliated" with the flagged-tree pins switched off. This module is the
 * missing link — a small vocabulary of map states, one per block, so stepping
 * through the story is also a guided tour of the plot.
 *
 * Only three axes are driven, deliberately:
 *
 *   - the camera (`frame`), because that is what makes a switch feel like a
 *     move rather than a redraw;
 *   - which content layers are lit (`layers`), because a block's numbers come
 *     from specific layers and those are the ones worth showing;
 *   - the whole-map colour treatment (`colorMode`), because some blocks are
 *     about a quantity the true-colour photo simply does not encode (heat,
 *     vegetation vigour).
 *
 * The basemap is *not* driven, even though swapping OSM for satellite would be
 * the biggest visual change available. Swapping it calls MapLibre's `setStyle`,
 * which throws away every source and layer this app added and needs the whole
 * lot rebuilt (see MapCanvas's basemap effect) — far too much teardown to run
 * on a click, and the rebuild flickers. It is also a setting the user owns
 * across every tab. Colour mode achieves a comparable shift for the cost of one
 * CSS `filter`.
 */

/**
 * The five camera archetypes. Kept to five on purpose: each has to be
 * recognisable *as itself* the moment it lands, and a sixth would start
 * shading into one of these rather than reading as a new place to stand.
 */
export type StoryFrame =
  /** Pulled back and flat: the site as a dot in its surroundings. For blocks
   * about cadence, coverage and context rather than about the plot itself. */
  | "context"
  /** The plot's own footprint, square on, top-down. The reference frame — what
   * "the site" means everywhere else in the app. */
  | "plot"
  /** Tilted, with the elevation DEM switched on and exaggerated: the ground
   * itself becomes the subject. Pulled back further than `plot` because 12
   * hectares of desert plain has no relief to show — terrain only reads at
   * regional scale. */
  | "terrain"
  /** Tilted low over the plot with the modelled trees standing in it. For
   * blocks whose numbers were counted from crowns. */
  | "canopy"
  /** Eye level, beside one tree. The narrowest possible reading of the site,
   * for blocks that are about individual organisms rather than about area. */
  | "twin";

export interface StoryMapView {
  frame: StoryFrame;
  /**
   * The layers to light while this block is active. Exhaustive, not additive —
   * anything absent is hidden — so a block never inherits a leftover layer from
   * the block before it and quietly changes meaning.
   *
   * An empty array is meaningful rather than a mistake: it strips the plot back
   * to bare ground, which is exactly right for the terrain blocks.
   */
  layers: ContentLayerId[];
  colorMode?: MapColorMode;
  /**
   * The one line that ties the two halves together: what the map just did, and
   * why that is the right view for *this* block's numbers. Shown under the
   * block's own description — see StoryPanel's `MapNote`.
   *
   * Written as a statement about the data, not as a caption of the animation
   * ("Flagged stems lit over the plot", not "The camera zooms to the plot").
   * The motion is visible; the reason it was chosen is not.
   */
  note: string;
}

/**
 * Keyed by `StoryBlock.id`. Held here rather than inline in story.ts so that
 * the map choreography can be read — and adjusted — as one sequence: the whole
 * point is how these *follow* each other, and that is invisible when they are
 * scattered through six hundred lines of copy.
 *
 * The sequence is composed, not assigned block by block. Forest Monitoring
 * opens the whole tour — the product case, licensed tier and all, before a
 * single site number is shown — and its own camera rhythm is described where
 * it's defined below. Reading the site sections that follow, top to bottom:
 * the tour opens wide, settles onto the plot, drills to individual flagged
 * stems, lifts into the modelled canopy, flattens back out for the imagery
 * section (which is about pixels, so the camera should stop competing), then
 * for Site Assessment alternates ground (`terrain`) and canopy (`canopy`) as
 * the subject alternates between the substrate and what grows on it — and ends
 * at eye level among the trees.
 */
export const STORY_MAP_VIEWS: Record<string, StoryMapView> = {
  // --- Overview ------------------------------------------------------------
  overview: {
    frame: "context",
    layers: ["aerial"],
    note: "The whole 12 ha as flown, set in its surroundings — the extent every number in this section is measured over.",
  },
  summary: {
    frame: "plot",
    layers: ["aerial", "canopy"],
    note: "The health mask over the capture it was derived from. The 74% is this red-to-green surface averaged across the plot, so the patches dragging it down are visible directly.",
  },
  insights: {
    frame: "plot",
    layers: ["aerial", "pins", "dyingTrees"],
    note: "Every flagged stem behind the 972, pinned where it actually stands, with the decline trace underneath. Findings are locations before they are counts.",
  },
  observability: {
    frame: "context",
    layers: ["aerial"],
    colorMode: "grayscale",
    note: "The raw capture alone, desaturated and pulled back — nothing derived. This block scores how dependably the sensor sees the site, not what it found.",
  },
  metrics: {
    frame: "canopy",
    layers: ["trees3d"],
    colorMode: "normal",
    note: "The modelled crowns the composition was counted from. Both donuts are these trees sorted twice over — once by species, once by health class.",
  },

  // --- Imagery -------------------------------------------------------------
  // Flat and still throughout. This section is about resolution and capture
  // cadence, and a camera that keeps moving invites the reader to compare
  // viewpoints when the thing being compared is pixel size.
  imagery: {
    frame: "plot",
    layers: ["aerial"],
    note: "Back to the plain capture, square on. Everything in this section is about the imagery itself rather than what was read out of it.",
  },
  resolutions: {
    frame: "plot",
    layers: ["aerial"],
    note: "The map holds the 3 cm drone capture while the tiles beside it degrade the same hectare to 10 m and 250 m — the map is the leftmost tile, at full size.",
  },
  "data-types": {
    frame: "plot",
    layers: ["aerial", "canopy"],
    note: "Two of the rows below, drawn: the RGB capture and the multispectral product derived from it, stacked as they are held.",
  },
  acquisition: {
    frame: "context",
    layers: ["aerial"],
    note: "Pulled back to the revisit footprint. The gaps in the grid below are quarters where this extent returned no usable scene at all.",
  },

  // --- Site Assessment -----------------------------------------------------
  assessment: {
    frame: "terrain",
    layers: [],
    note: "Everything stripped back to bare, exaggerated terrain. The baseline starts from the ground the site sits on, before anything growing on it.",
  },
  "habitat-land-cover": {
    frame: "terrain",
    layers: ["aerial"],
    note: "The capture draped over the relief it was flown across. Shrubland, sand and sabkha separate by landform, which a flat view hides.",
  },
  "terrain-elevation": {
    frame: "terrain",
    layers: [],
    note: "The DEM alone, vertically exaggerated — the same surface the 142–168 m range and the 3.4° mean slope were computed from.",
  },
  "soil-substrate": {
    frame: "terrain",
    layers: ["aerial"],
    colorMode: "sepia",
    note: "Terrain under a substrate-toned pass, which lifts the sand and salt-crust signature the texture classes were read from.",
  },
  "water-hydrology": {
    frame: "terrain",
    layers: ["aerial"],
    colorMode: "night",
    note: "The relief again, cooled down so drainage lines read. Water here is a function of the slope shown, not of a standing surface.",
  },
  "climate-weather": {
    frame: "context",
    layers: ["aerial"],
    colorMode: "thermal",
    note: "A heat ramp over the wider extent — the regional thermal context behind a −612 mm water balance, which is a climate figure, not a plot one.",
  },
  "vegetation-ecosystem-condition": {
    frame: "plot",
    layers: ["aerial", "canopy"],
    colorMode: "ndvi",
    note: "False-colour vegetation over the health mask. Stressed and declining stems separate here that are indistinguishable in true colour.",
  },
  biodiversity: {
    frame: "canopy",
    layers: ["trees3d", "generative"],
    colorMode: "normal",
    note: "The stand as structure. Richness follows the layering visible here — canopy, understorey and gaps — more closely than it follows area.",
  },
  "biomass-carbon": {
    frame: "canopy",
    layers: ["trees3d"],
    note: "Standing volume, which is what carbon stock is an estimate of. The 11.4 Mg C/ha is these crowns and trunks, converted.",
  },
  "threats-human-pressure": {
    frame: "plot",
    layers: ["aerial", "dyingTrees", "pins"],
    note: "Pressure where it has already left a mark: the decline trace and flagged stems over the capture, so grazing and track damage read as places.",
  },
  "data-quality-coverage": {
    frame: "context",
    layers: ["aerial"],
    colorMode: "grayscale",
    note: "The capture on its own again, as in Observability — the same question asked of the assessment record rather than of the monitoring feed.",
  },
  "area-classification": {
    frame: "plot",
    layers: ["canopy", "generative"],
    note: "The classified surface without the photo beneath it. What the model assigned, separated from what a human would see.",
  },
  impacts: {
    frame: "plot",
    layers: ["aerial", "dyingTrees"],
    note: "True colour at plot scale — grazing trails and vehicle tracks are directly visible in the capture, so nothing derived is needed to count them.",
  },
  "native-fauna": {
    frame: "twin",
    layers: ["trees3d"],
    note: "Eye level among the trees, at the scale the camera traps and field surveys work at. Detections are recorded per animal, not per hectare.",
  },

  // --- Forest Monitoring -----------------------------------------------------
  // A different kind of block, and the tour's opening section rather than its
  // close: this is the product case, not this site's own record, so the
  // camera settles into a slower, wider rhythm — context to open, drilling to
  // the plot only where the pitch is literally about this plot (the loop, the
  // outcomes), and back out before the site-level sections that follow.
  monitoring: {
    frame: "context",
    layers: ["aerial"],
    note: "Pulled back to context before the tour even reaches the plot — this 12 ha is one site inside a monitoring program run across many.",
  },
  "monitoring-problem": {
    frame: "context",
    layers: ["aerial"],
    colorMode: "grayscale",
    note: "The plain capture, desaturated — a stand watched only a few times a year looks fine right up until it doesn't.",
  },
  "monitoring-comparison": {
    frame: "plot",
    layers: ["aerial", "pins"],
    note: "Pins on, aerial on — what 'every tree, every cycle' actually looks like against this same plot, next to a sampled walk.",
  },
  "monitoring-loop": {
    frame: "plot",
    layers: ["aerial", "pins", "dyingTrees"],
    note: "Flagged stems and the decline trace together — this is the block a refresh-flag-dispatch-verify loop closes around.",
  },
  "monitoring-roles": {
    frame: "canopy",
    layers: ["trees3d"],
    colorMode: "normal",
    note: "The modelled stand — the same crowns each of these five roles ultimately reads, from a different seat.",
  },
  "monitoring-estate": {
    frame: "context",
    layers: ["aerial"],
    note: "Zoomed out to where this plot sits among the wider estate the ranked view below is describing — one dot among many.",
  },
  "monitoring-tiers": {
    frame: "terrain",
    layers: [],
    note: "Bare ground: what each tier below adds is resolution on top of this same surface, from block-level satellite up to a per-tree ground survey.",
  },
  "monitoring-outcomes": {
    frame: "plot",
    layers: ["aerial", "canopy"],
    note: "The health mask over the capture — every outcome on the left is a change to this same red-to-green surface.",
  },
  "monitoring-commercial": {
    frame: "context",
    layers: ["aerial"],
    note: "Wide again to close: the commercial shape follows the same split this section opened at — a subscription over the wide view, a survey over the plot.",
  },
};
