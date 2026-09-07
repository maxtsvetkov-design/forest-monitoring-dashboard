import type { Area } from "./areas";
import { getTimelapseImages } from "./overlays";

/**
 * The Story tab's content, carried across from the supplied "Insights panel"
 * prototype. The block sequence, the copy, the KPI values, the donut splits,
 * the capability table and the quarterly capture grid are the prototype's —
 * this module is the prototype's right-hand panel expressed as data so the
 * panel component can render it in this project's own visual language.
 *
 * Two fields are read from the app instead of hard-coded, because they name a
 * specific place and would be plainly wrong otherwise: the hero title and the
 * coordinate chip both follow whichever area is selected. Everything else is
 * verbatim prototype content.
 */

/** Okabe-Ito — the colourblind-safe set the prototype's donuts already use. */
const C = {
  green: "#009e73",
  blue: "#56b4e9",
  orange: "#d55e00",
  yellow: "#ffbc10",
};

export type EventTone = "critical" | "good" | "warning";

export interface StoryEvent {
  title: string;
  /** "Critical · 90 stems flagged, up from 61 in March" */
  subtitle: string;
  tone: EventTone;
  /** Which of the prototype's two spark paths this row draws. */
  trend: "up" | "down";
  thumbnail?: string;
}

export interface StorySlice {
  name: string;
  value: number;
  color: string;
}

export type StoryContent =
  /** A section heading — sits on the panel ground rather than on a card. */
  | { kind: "sectionIntro"; body: string }
  | {
      kind: "summary";
      label: string;
      sublabel: string;
      value: string;
      change: string;
      trend: "up" | "down";
      note: string;
      body: string;
    }
  | { kind: "insights"; cards: StoryInsight[] }
  | { kind: "observability"; kpis: StoryKpi[]; events: StoryEvent[] }
  | { kind: "metrics"; charts: { title: string; data: StorySlice[] }[] }
  | { kind: "resolutions"; imageUrl: string | undefined; tiles: StoryResolution[] }
  | { kind: "dataTypes"; rows: StoryDataTypeRow[] }
  | { kind: "timeline"; body: string; years: StoryYear[]; quarters: string[]; rows: StoryTimelineRow[] };

export interface StoryInsight {
  label: string;
  value: string;
  body: string;
  /** The prototype's second card sits on the accent ground. */
  accent?: boolean;
}

export interface StoryKpi {
  label: string;
  value: string;
}

export interface StoryResolution {
  /** "Drone", "Sentinel", "Global" */
  source: string;
  /** The ground sample distance that source resolves at. */
  resolution: string;
  /** How far to downsample the capture so the tile *shows* what that GSD can
   * resolve. 1 renders the capture untouched. The prototype held three
   * separate photographs; this dataset holds one, so the coarser two are
   * simulated from it — and captioned as the sources they stand for. */
  pixelate: number;
}

export interface StoryDataTypeRow {
  label: string;
  available: string;
  sets: string;
  maxRes: string;
  minRes: string;
}

export interface StoryYear {
  label: string;
  /** How many quarter columns this year spans. */
  span: number;
}

export interface StoryTimelineRow {
  name: string;
  resolution: string;
  /** One entry per quarter column: true where a scene was captured and
   * processed, false where the quarter returned nothing usable. */
  cells: boolean[];
}

export interface StoryBlock {
  id: string;
  section: string;
  name: string;
  /** One line under the title saying what the block holds — the thing that
   * makes a block scannable before it is read. */
  description?: string;
  /** Section headings render as bare headings, not cards. */
  isSectionHead?: boolean;
  content: StoryContent;
}

export interface StorySection {
  id: string;
  label: string;
  /** The prototype greys out "Forest Change": a section the design names but
   * does not yet hold blocks for. Kept, so the panel says what is coming
   * rather than silently omitting it. */
  disabled?: boolean;
}

export const STORY_SECTIONS: StorySection[] = [
  { id: "overview", label: "Overview" },
  { id: "imagery", label: "Imagery" },
  { id: "forest", label: "Forest Change", disabled: true },
  { id: "assessment", label: "Site Assessment" },
];

export interface StoryHeadStat {
  label: string;
  value: string;
  /** Which block this card opens — the prototype wires each stat to the block
   * that explains where its number comes from. */
  gotoBlock: string;
  change?: string;
  trend?: "up" | "down";
  note?: string;
}

export interface StoryHeader {
  title: string;
  chips: string[];
  stats: StoryHeadStat[];
  description: string;
}

export function buildStoryHeader(area: Area): StoryHeader {
  const [lng, lat] = area.center;
  return {
    title: area.name,
    chips: [`${lat.toFixed(6)}, ${lng.toFixed(6)}`, "Monitored since: Apr 2025"],
    stats: [
      { label: "Total area", value: "12 ha", gotoBlock: "resolutions" },
      {
        label: "Greenness (NDVI)",
        value: "0.15",
        change: "-22%",
        trend: "down",
        note: "vs Mar",
        gotoBlock: "insights",
      },
      {
        label: "Carbon stock",
        value: "11.4 Mg C/ha",
        note: "above-ground, 2020",
        gotoBlock: "metrics",
      },
    ],
    description:
      "Al Maha Forest spans 12 hectares with mean NDVI of 0.155, indicating sparse or stressed vegetation typical of arid restoration sites.",
  };
}

const AI_PLACEHOLDER =
  "Well, it's an AI description, Well, it's an AI description, Well, it's an AI description, Well, it's an AI description, Well, it's an AI description, Well, it's an AI description, Well, it's an AI description, Well, it's an AI description,";

const NDVI_NOTE =
  "Al Maha Forest spans 12 hectares with mean NDVI of 0.155, indicating sparse or stressed vegetation typical of arid restoration sites.";

export function buildStory(area: Area): StoryBlock[] {
  const captures = getTimelapseImages(area.id);
  const thumb = (i: number) => captures?.[i % (captures.length || 1)];

  return [
    {
      id: "overview",
      section: "overview",
      name: "Overview",
      isSectionHead: true,
      content: {
        kind: "sectionIntro",
        body: `Site-level position for ${area.name} this period: one health score, the findings behind it, how dependable the underlying imagery was, and the composition it was measured from.`,
      },
    },
    {
      id: "summary",
      section: "overview",
      name: "Summary",
      description:
        "Headline site health for the current reporting period, scored across canopy cover, greenness and survival, with the movement since the last ground survey.",
      content: {
        kind: "summary",
        label: "Total site health score",
        sublabel: "Overall performance",
        value: "74%",
        change: "+4",
        trend: "up",
        note: "since last survey",
        body: AI_PLACEHOLDER,
      },
    },
    {
      id: "insights",
      section: "overview",
      name: "Insights",
      description:
        "What the model flagged on the latest pass, ordered by how far each finding moves the site score. Highlighted cards need a decision this cycle.",
      content: {
        kind: "insights",
        cards: [
          { label: "Trees flagged defoliated", value: "972", body: NDVI_NOTE },
          { label: "Trees flagged defoliated", value: "972", body: NDVI_NOTE, accent: true },
        ],
      },
    },
    {
      id: "observability",
      section: "overview",
      name: "Observability",
      description:
        "How reliably this site is actually being seen — scene yield, cloud loss and revisit cadence — followed by everything that changed since the last capture.",
      content: {
        kind: "observability",
        kpis: [
          { label: "Usable scenes", value: "142 / 186" },
          { label: "Mean cloud cover", value: "12.4%" },
          { label: "Days since clear", value: "6" },
          { label: "Revisit interval", value: "5.2 days" },
        ],
        events: [
          {
            title: "Defoliation cluster grew in NE block",
            subtitle: "Critical · 90 stems flagged, up from 61 in March",
            tone: "critical",
            trend: "down",
            thumbnail: thumb(0),
          },
          {
            title: "New drone survey processed",
            subtitle: "Good · 12.40 ha at 3 cm, 8 new layers available",
            tone: "good",
            trend: "up",
            thumbnail: thumb(1),
          },
          {
            title: "Sentinel-2 gap — 3 weeks without a clear scene",
            subtitle: "Warning · cloud and haze, next revisit 14 Aug",
            tone: "warning",
            trend: "up",
            thumbnail: thumb(2),
          },
        ],
      },
    },
    {
      id: "metrics",
      section: "overview",
      name: "Metrics",
      description:
        "Composition of the stand, counted from the most recent classified orthomosaic: by species on the left, by health class on the right.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Tree count · by species",
            data: [
              { name: "Ghaf canopy", value: 33, color: C.orange },
              { name: "Sidr underneath", value: 33, color: C.green },
              { name: "Palm beneath both", value: 33, color: C.blue },
            ],
          },
          {
            title: "Health score distribution",
            data: [
              { name: "Healthy", value: 22, color: C.green },
              { name: "Stressed", value: 45, color: C.yellow },
              { name: "Declining", value: 33, color: C.orange },
            ],
          },
        ],
      },
    },
    {
      id: "imagery",
      section: "imagery",
      name: "Imagery",
      isSectionHead: true,
      content: { kind: "sectionIntro", body: AI_PLACEHOLDER },
    },
    {
      id: "resolutions",
      section: "imagery",
      name: "Resolution comparison",
      description:
        "The same hectare rendered at each ground sample distance held for this area, so the detail a given source can genuinely resolve is visible rather than assumed.",
      content: {
        kind: "resolutions",
        imageUrl: captures?.[0],
        tiles: [
          { source: "Drone", resolution: "3 cm", pixelate: 1 },
          { source: "Sentinel", resolution: "10 m", pixelate: 6 },
          { source: "Global", resolution: "250 m", pixelate: 16 },
        ],
      },
    },
    {
      id: "data-types",
      section: "imagery",
      name: "Data types",
      description:
        "Every source held for this area — whether it is currently available, how many sets exist, and the resolution range each one spans.",
      content: {
        kind: "dataTypes",
        rows: [
          { label: "Satellite", available: "Yes", sets: "12", maxRes: "3 cm", minRes: "250 m" },
          { label: "Drone", available: "Yes", sets: "8", maxRes: "3 cm", minRes: "250 m" },
          { label: "RGB", available: "Yes", sets: "14", maxRes: "3 cm", minRes: "250 m" },
          { label: "MSP", available: "Yes", sets: "6", maxRes: "3 cm", minRes: "3 cm" },
          { label: "HSP", available: "No", sets: "0", maxRes: "3 cm", minRes: "3 cm" },
          { label: "LIDAR", available: "Yes", sets: "9", maxRes: "10 m", minRes: "10 m" },
          { label: "Resolution", available: "0.5 m", sets: "—", maxRes: "10 m", minRes: "10 m" },
        ],
      },
    },
    {
      id: "acquisition",
      section: "imagery",
      name: "Acquisition Timeline",
      description:
        "Quarter-by-quarter capture record per sensor. Filled cells are processed and usable; gaps are quarters that returned no clear scene.",
      content: {
        kind: "timeline",
        body: "Monthly visual tracker indicating total captured and processed environmental metrics. Clear representation of sensor gaps over critical summer dust periods.",
        years: [
          { label: "2025", span: 4 },
          { label: "2026", span: 2 },
        ],
        quarters: ["Q1", "Q2", "Q3", "Q4", "Q1", "Q2"],
        rows: [
          {
            name: "Drone Ortho",
            resolution: "3 cm",
            cells: [false, true, false, true, false, true],
          },
          {
            name: "Sentinel-2",
            resolution: "10 m",
            cells: [false, true, true, true, true, false],
          },
          {
            name: "ECOSTRESS",
            resolution: "70 m",
            cells: [true, true, false, true, true, true],
          },
        ],
      },
    },
    // The "Site Assessment" section — a 14-block ecological baseline, each
    // covering one dimension a restoration site is normally profiled on. All
    // figures below are illustrative placeholders (this dataset has no real
    // soil/hydrology/fauna survey backing them yet) — swap them for measured
    // values once that data exists, rather than treating them as reported
    // facts in the meantime.
    {
      id: "assessment",
      section: "assessment",
      name: "Site Assessment",
      isSectionHead: true,
      content: {
        kind: "sectionIntro",
        body: `A full ecological baseline for ${area.name}: habitat and terrain, soil and hydrology, climate context, vegetation and biodiversity condition, carbon stock, human pressure, and how confidently each of these was actually observed.`,
      },
    },
    {
      id: "habitat-land-cover",
      section: "assessment",
      name: "Habitat & Land Cover",
      description:
        "The habitat types and land cover present on site — the baseline for tracking conversion, degradation and restoration over time.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Land cover by class",
            data: [
              { name: "Vegetated shrubland", value: 38, color: C.green },
              { name: "Bare soil / sand", value: 44, color: C.orange },
              { name: "Sabkha / salt flat", value: 12, color: C.blue },
              { name: "Rocky substrate", value: 6, color: C.yellow },
            ],
          },
        ],
      },
    },
    {
      id: "terrain-elevation",
      section: "assessment",
      name: "Terrain & Elevation",
      description:
        "Elevation, slope and drainage patterns — the physical template that shapes habitat distribution and flood risk.",
      content: {
        kind: "insights",
        cards: [
          { label: "Elevation range", value: "142–168 m", body: "Above mean sea level, from the drone-derived DEM." },
          { label: "Mean slope", value: "3.4°", body: "A gentle gradient, consistent with a desert plain." },
          {
            label: "Drainage class",
            value: "Well-drained",
            body: "Runoff channels toward the eastern site boundary.",
            accent: true,
          },
        ],
      },
    },
    {
      id: "soil-substrate",
      section: "assessment",
      name: "Soil & Substrate",
      description:
        "Soil texture, pH, salinity and moisture — the substrate conditions that determine fertility and what vegetation the site can sustain.",
      content: {
        kind: "insights",
        cards: [
          { label: "Soil texture", value: "Sandy loam", body: "Coarse-grained substrate typical of arid restoration sites." },
          { label: "pH", value: "7.8", body: "Mildly alkaline — within tolerance for Ghaf and Sidr." },
          {
            label: "Salinity",
            value: "4.2 dS/m",
            body: "Moderate — a constraint for salt-sensitive seedlings.",
            accent: true,
          },
        ],
      },
    },
    {
      id: "water-hydrology",
      section: "assessment",
      name: "Water & Hydrology",
      description:
        "Surface water extent, seasonality and turbidity — signals of wetland health, flood exposure and water available to ecosystems.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Surface water by season",
            data: [
              { name: "Wet season", value: 18, color: C.blue },
              { name: "Dry season", value: 4, color: C.orange },
              { name: "Ephemeral / none", value: 78, color: C.yellow },
            ],
          },
        ],
      },
    },
    {
      id: "climate-weather",
      section: "assessment",
      name: "Climate & Weather",
      description:
        "Rainfall, temperature and water-balance trends — the climate context behind vegetation stress and long-term site change.",
      content: {
        kind: "insights",
        cards: [
          { label: "Mean annual rainfall", value: "78 mm", body: "Below the 10-year regional average." },
          {
            label: "Mean temperature",
            value: "29.6°C",
            body: "Peak summer exceeds 45°C at midday.",
            accent: true,
          },
          { label: "Water balance", value: "-612 mm", body: "An evapotranspiration deficit driving vegetation stress." },
        ],
      },
    },
    {
      id: "vegetation-ecosystem-condition",
      section: "assessment",
      name: "Vegetation & Ecosystem Condition",
      description:
        "Greenness, moisture, structure and stress indices that track vegetation health and early signs of ecosystem decline.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Vegetation condition",
            data: [
              { name: "Healthy", value: 22, color: C.green },
              { name: "Stressed", value: 45, color: C.yellow },
              { name: "Declining", value: 33, color: C.orange },
            ],
          },
        ],
      },
    },
    {
      id: "biodiversity",
      section: "assessment",
      name: "Biodiversity",
      description:
        "Species presence, richness and threat status — indicators of ecological intactness and conservation priority.",
      content: {
        kind: "insights",
        cards: [
          { label: "Species recorded", value: "64", body: "Across flora and fauna surveys to date." },
          {
            label: "IUCN-listed species",
            value: "3",
            body: "Flagged for conservation priority.",
            accent: true,
          },
          { label: "Endemism rate", value: "11%", body: "Species found nowhere outside this bioregion." },
        ],
      },
    },
    {
      id: "biomass-carbon",
      section: "assessment",
      name: "Biomass & Carbon",
      description:
        "Carbon stored above and below ground, the site's carbon potential and net flux — core metrics of climate mitigation value.",
      content: {
        kind: "insights",
        cards: [
          { label: "Above-ground carbon", value: "11.4 Mg C/ha", body: "2020 baseline estimate." },
          { label: "Below-ground carbon", value: "3.8 Mg C/ha", body: "Root and soil organic carbon." },
          {
            label: "Net carbon flux",
            value: "+0.6 Mg C/ha/yr",
            body: "The site is currently a net carbon sink.",
            accent: true,
          },
        ],
      },
    },
    {
      id: "threats-human-pressure",
      section: "assessment",
      name: "Threats & Human Pressure",
      description:
        "Loss, fire and human footprint pressures — where the site is losing ground and where intervention is most urgent.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Pressure by source",
            data: [
              { name: "Grazing", value: 41, color: C.orange },
              { name: "Fire history", value: 9, color: C.yellow },
              { name: "Human footprint", value: 22, color: C.blue },
              { name: "None detected", value: 28, color: C.green },
            ],
          },
        ],
      },
    },
    {
      id: "data-quality-coverage",
      section: "assessment",
      name: "Data Quality & Coverage",
      description: "How often and how clearly the site can be observed.",
      content: {
        kind: "observability",
        kpis: [
          { label: "Usable scenes", value: "98 / 120" },
          { label: "Mean cloud cover", value: "9.8%" },
          { label: "Days since clear", value: "4" },
          { label: "Revisit interval", value: "6.1 days" },
        ],
        events: [],
      },
    },
    {
      id: "area-classification",
      section: "assessment",
      name: "Area Classification",
      description: "Manual labelling combined with AI classification to identify the land cover across the site.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Area Classification",
            data: [
              { name: "AI-classified", value: 82, color: C.green },
              { name: "Manually verified", value: 14, color: C.blue },
              { name: "Unclassified", value: 4, color: C.orange },
            ],
          },
        ],
      },
    },
    {
      id: "impacts",
      section: "assessment",
      name: "Impacts",
      description: "Visible human impacts across the site.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Impacts",
            data: [
              { name: "Grazing trails", value: 36, color: C.orange },
              { name: "Vehicle tracks", value: 24, color: C.blue },
              { name: "Waste / debris", value: 9, color: C.yellow },
              { name: "None visible", value: 31, color: C.green },
            ],
          },
        ],
      },
    },
    {
      id: "native-fauna",
      section: "assessment",
      name: "Native Fauna",
      description: "Native animal species detected across the site.",
      content: {
        kind: "insights",
        cards: [
          { label: "Species detected", value: "19", body: "Confirmed via camera trap and field survey." },
          {
            label: "Individual sightings",
            value: "1,332",
            body: "Total recorded detections this reporting period.",
            accent: true,
          },
          { label: "Threatened species", value: "2", body: "Flagged under the UAE national red list." },
        ],
      },
    },
  ];
}
