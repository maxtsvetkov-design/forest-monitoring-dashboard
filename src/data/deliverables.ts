/**
 * The habitat data products this programme delivers, as a scope catalogue.
 *
 * These are SPECIFICATIONS, not measurements. Most of what they describe —
 * threat pressure, protection coverage, fragmentation, marine water-quality
 * proxies, spatial-optimisation inputs — has no counterpart anywhere in this
 * app's data, and a 2015–2025 series is a decade against the twelve months
 * `monthlySnapshots` actually holds. Quoting a deliverable's scope is fair;
 * rendering a number for it would not be.
 *
 * So every layer carries its own honest availability, and the panel that shows
 * these keeps the two apart: what this plot already has, and what would have to
 * be commissioned. `availability` reuses the vocabulary the tier table already
 * established (see `tiers.ts` — "full" / "half" / "none") because the app
 * already has one way of saying "you do not have this yet" and does not need a
 * second.
 *
 * Where a layer IS backed by real data, `source` names where the reader can
 * already see it, so the catalogue doubles as a map of the product rather than
 * a wish list.
 */

import type { ChangeMetricKey } from "./habitatChange";
import type { HealthIndicatorKey } from "./habitatHealth";
import type { TierCoverage } from "./tiers";

export interface DeliverableLayer {
  label: string;
  /**
   * "full" — this app computes it from real data today.
   * "half" — the inputs are here but the delivered product is more than this.
   * "none" — nothing behind it; commissioned work.
   */
  availability: TierCoverage;
  /** Where it already appears, for "full" and "half" only. */
  source?: string;
  /** Why it is not here, for "none" — so the gap is explained, not just flagged. */
  gap?: string;
  /**
   * The series this app charts the layer with, when there is one — from
   * `habitatHealth.ts` for the health assessment, `habitatChange.ts` for the
   * change-detection dataset.
   *
   * This is the join between the catalogue and the charts, and it runs in this
   * direction on purpose: each panel section counts its own scored rows by
   * looking for this field rather than carrying a second list, so "2 of 6
   * indicators scored" cannot drift away from the six rows printed underneath
   * it. Untagged rows are exactly the ones the sections print as absences.
   */
  indicator?: HealthIndicatorKey | ChangeMetricKey;
}

export interface Deliverable {
  id: string;
  title: string;
  summary: string;
  layers: DeliverableLayer[];
  /** Verbatim from the scope, because a format list is a contractual detail
   *  and paraphrasing one is how a spec drifts. */
  formats: string;
  /** Anything the reader would otherwise mis-read as already on screen. */
  caveat?: string;
}

export const DELIVERABLES: Deliverable[] = [
  {
    id: "condition-threat-protection",
    title: "Habitat condition, threat status & protection level maps",
    summary:
      "Decision-support layers for conservation planning and prioritisation, sized to feed spatial optimisation models such as Marxan or Zonation.",
    layers: [
      {
        label: "Condition map — intact / moderately degraded / highly degraded",
        availability: "half",
        source: "Per-tree condition bands and the plot-wide mix are the input; the delivered map is a three-class habitat polygon, which this plot does not have.",
      },
      {
        label: "Threat assessment — land-use change, pollution, invasive species",
        availability: "none",
        gap: "No pressure data of any kind in this dataset.",
      },
      {
        label: "Protection coverage, with expansion recommendations",
        availability: "none",
        gap: "No protected-area boundaries are held for this site.",
      },
      {
        label: "Optimisation model inputs and outputs",
        availability: "none",
        gap: "Requires targets and cost surfaces that are set during planning, not measured.",
      },
    ],
    formats: "ESRI Geodatabase, model input/output files, maps in high-resolution image/PDF formats.",
  },
  {
    id: "health-assessment",
    title: "Habitat health assessment report & geospatial outputs",
    summary:
      "A scientifically grounded assessment of habitat health across terrestrial and marine systems, focused on critical and sensitive habitats, with a technical report covering methodology, scoring logic and indicator thresholds.",
    layers: [
      {
        label: "Habitat health score / condition index",
        availability: "half",
        source:
          "Scored on this plot as a 0–100 index off the five condition bands — plot-wide as a monthly trend, and per grid cell above. The delivered layer is a habitat polygon at survey resolution, which this plot does not have.",
        indicator: "healthIndex",
      },
      {
        label: "Vegetation density",
        availability: "half",
        source: "Canopy cover has a real month-by-month series behind it — see the Canopy cover card above. Cover is not the same measure as density.",
        indicator: "vegetationDensity",
      },
      {
        label: "Fragmentation",
        availability: "none",
        gap: "Needs patch areas. The delivered extent traces are boundary strokes rather than filled polygons, so they give a patch count and no areas.",
      },
      { label: "Water-quality proxies (marine)", availability: "none", gap: "Terrestrial plot — no marine extent." },
      { label: "Human disturbance", availability: "none", gap: "No disturbance or access data in this dataset." },
      { label: "Ecological function metrics", availability: "none", gap: "Requires field survey." },
    ],
    formats: "ESRI Geodatabase layers, with a written report in PDF and editable (Word) format.",
  },
  {
    id: "change-detection",
    title: "Habitat change detection dataset (2015–2025)",
    summary:
      "A comparative geospatial analysis of change in habitat distribution and extent against the 2015 and 2020 habitat maps, with statistics, methodology and validation results.",
    layers: [
      {
        label: "Change layers — habitat gain and loss",
        availability: "full",
        source: "This screen. The two disagreement masks are exactly gain and loss, with areas measured off the delivered rasters.",
        indicator: "extentChange",
      },
      {
        label: "Habitat transformation — class-to-class conversion",
        availability: "none",
        gap: "There is no habitat-class transition matrix behind the land-cover split, only a single classification.",
      },
      {
        label: "Temporal change statistics",
        availability: "full",
        source: "Every tree is compared against its own earlier condition — see the month-by-month steps and the summary table.",
        indicator: "temporalStats",
      },
      {
        label: "Methodology, thresholds and validation record",
        availability: "none",
        gap: "Written deliverable rather than a layer.",
      },
    ],
    formats: "ESRI Geodatabase with temporal layers, with comparative maps in PDF/PNG formats.",
    caveat:
      "The dataset's window is a decade against the 2015 and 2020 baselines. This plot carries twelve months, so what you see here is the method on a much shorter interval — not the delivered series.",
  },
];
