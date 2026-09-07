import type { Area } from "./areas";
import { getTimelapseImages } from "./overlays";
import { STORY_MAP_VIEWS, type StoryMapView } from "./storyMap";
import { CURRENT_TIER_INDEX, PRICE_ROW, SPEC_ROWS, TIERS, TIER_SECTIONS, type TierCoverage } from "./tiers";

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
  | { kind: "timeline"; body: string; years: StoryYear[]; quarters: string[]; rows: StoryTimelineRow[] }
  | { kind: "tierTable"; tiers: StoryTierColumn[]; activeTier: number; rows: StoryTierRow[] };

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

export interface StoryTierColumn {
  /** "Tier 1", "Tier 2", … */
  label: string;
  /** What that tier configures on top of the platform — "Free satellite",
   * "+ Drone". */
  sublabel: string;
}

export interface StoryTierRow {
  label: string;
  /** One cell per tier, same order as `tiers` — "●", "◐", "—", or a plain
   * value (a resolution, a cadence, a price). Free text rather than a
   * boolean because the same row mixes coverage dots with numbers. */
  values: string[];
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
  /** What the map beside the panel should show while this block is the one
   * being read — attached from STORY_MAP_VIEWS, not written inline, so the
   * choreography can be read as one sequence. See storyMap.ts. */
  map?: StoryMapView;
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
  { id: "monitoring", label: "Forest Monitoring" },
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

/**
 * The product brief's own four-item pitch — "Four things a client can do that
 * they can't today." Exported (not inlined in the block below) so
 * AIAssistant's proactive tip can quote the identical copy rather than a
 * second hand-typed version of the same four lines drifting out of sync.
 */
export const WHAT_IT_CHANGES: StoryInsight[] = [
  {
    label: "Stop watering trees that are gone",
    value: "m³ / surviving tree ↓",
    body: "Dead and missing trees keep drawing water until somebody walks past them. Condition data retires them from the schedule.",
  },
  {
    label: "Catch decline while it's still reversible",
    value: "Time to flag ↓ · survival ↑",
    body: "Stress shows up in the data weeks before it shows up in the canopy — early enough to save the block.",
  },
  {
    label: "Send crews where they change the outcome",
    value: "Crew-hours / ha ↓",
    body: "Ranked, located work instead of a rotation — the same headcount covers more ground that matters.",
  },
  {
    label: "Answer the end client without a site visit",
    value: "Flag → verified fix ↓ · estate on record → 100%",
    body: "Nothing today measures whether a flagged problem actually got fixed — that number is what turns monitoring into a service worth renewing.",
    accent: true,
  },
];

const COVERAGE_GLYPH: Record<TierCoverage, string> = { full: "●", half: "◐", none: "—" };

/** Looks a row up by id rather than by position in TIER_SECTIONS's nested
 * arrays — a magic `[2].rows[1]` breaks silently the next time that table
 * gains or reorders a row; an id that no longer exists throws immediately. */
function tierRow(id: string): StoryTierRow {
  const row = TIER_SECTIONS.flatMap((s) => s.rows).find((r) => r.id === id);
  if (!row) throw new Error(`storyMap: no tier row with id "${id}"`);
  return { label: row.label, values: row.cells.map((c) => COVERAGE_GLYPH[c]) };
}

/**
 * The Forest Monitoring section's tier table, derived from `data/tiers.ts`
 * rather than a second hand-typed copy of the same four columns — the exact
 * bug this replaced: an earlier version of this table hard-coded `activeTier:
 * 2` (Tier 3), which quietly drifted from `CURRENT_TIER_INDEX` (Tier 2, what
 * LayerPanel's own locked-layer section and every "Tier 2" badge elsewhere in
 * the app already say this contract is on). Deriving both from the same
 * source makes that kind of drift structurally impossible instead of merely
 * unlikely.
 */
const MONITORING_TIER_TABLE: Extract<StoryContent, { kind: "tierTable" }> = {
  kind: "tierTable",
  tiers: TIERS.map((t) => ({ label: t.label, sublabel: t.name })),
  activeTier: CURRENT_TIER_INDEX,
  rows: [
    { label: SPEC_ROWS[0].label, values: [...SPEC_ROWS[0].cells] },
    { label: SPEC_ROWS[1].label, values: [...SPEC_ROWS[1].cells] },
    tierRow("stressed-block"),
    tierRow("per-tree-health"),
    tierRow("scada-irrigation"),
    { label: PRICE_ROW.label, values: [...PRICE_ROW.cells] },
  ],
};

export function buildStory(area: Area): StoryBlock[] {
  const captures = getTimelapseImages(area.id);
  const thumb = (i: number) => captures?.[i % (captures.length || 1)];

  const blocks: StoryBlock[] = [
    // The "Forest Monitoring" section — Nabat's own product brief (Strategic
    // Initiative № 2) rendered as a story section, opening the tour: the case
    // for treating everything that follows not as a one-off report but as a
    // recurring NabatOS module, licensed at this contract's actual tier
    // before a single site number is shown. Figures below are the brief's
    // own — the anchor client's documents and an indicative, unsigned price
    // sheet — not this dataset's, so treat them as the business case they are
    // rather than as this area's measured record. The tier table itself is
    // NOT hand-typed here — see MONITORING_TIER_TABLE, derived from
    // data/tiers.ts so it can never disagree with LayerPanel's own "Tier 2"
    // badges elsewhere in the app.
    {
      id: "monitoring",
      section: "monitoring",
      name: "Forest Monitoring",
      isSectionHead: true,
      content: {
        kind: "sectionIntro",
        body: "NabatOS Strategic Initiative № 2, owned by Product. Planted forests in arid climates die quietly — a stressed block looks fine until it isn't, and crews keep watering trees that are already dead. This module watches the forest from above, flags trouble early, sends a crew to the exact coordinates, and records that the fix worked. Anchor client: Al Ain Forestry & Landscaping → the Department of Municipalities & Transport, Abu Dhabi. This walkthrough is licensed at Tier 2 · Commercial satellite — 0.3–0.5 m resolution, refreshed monthly or on demand.",
      },
    },
    {
      id: "monitoring-problem",
      section: "monitoring",
      name: "The problem",
      description:
        "Every large planted-forest operator faces the same three gaps: no visibility between visits, water and crews on a rota instead of on need, and no way to prove survival without walking the estate.",
      content: {
        kind: "insights",
        cards: [
          {
            label: "Estate maintained manually",
            value: "103,000 ha",
            body: "Across 66 sites, judged tree by tree by field staff — roughly 2,300 people, ~1.6M AED in training alone.",
            accent: true,
          },
          {
            label: "Estimated water spend",
            value: "55–150M AED/yr",
            body: "At 15–40 L per tree per day — including trees that are already dead.",
          },
          {
            label: "Deadline vs. manual plan",
            value: "6 mo vs 12–18 mo",
            body: "The mandatory baseline survey's own plan, against the contractual deadline it has to beat.",
          },
        ],
      },
    },
    {
      id: "monitoring-comparison",
      section: "monitoring",
      name: "Manual vs. tech-enabled",
      description:
        "The same five questions an operator has always had to answer, judged the same estate two ways.",
      content: {
        kind: "insights",
        cards: [
          {
            label: "Accuracy",
            value: "±5cm position · ±5–10% height",
            body: "Manual: varies by person and fatigue.",
            accent: true,
          },
          { label: "Coverage", value: "Every tree, every cycle", body: "Manual: partial — trees get missed." },
          { label: "Health rating", value: "Repeatable AI score", body: "Manual: subjective estimate." },
          {
            label: "Evidence",
            value: "Geo-tagged, auditable record",
            body: "Manual: inconsistent notes.",
            accent: true,
          },
          { label: "Field safety", value: "Mostly control-room work", body: "Manual: heat, terrain, wildlife exposure." },
        ],
      },
    },
    {
      id: "monitoring-loop",
      section: "monitoring",
      name: "Close the loop",
      description:
        "Refresh, flag, dispatch, verify — what the client is actually buying is the record this loop leaves behind. Below: this cycle's work orders, the loop caught mid-turn.",
      content: {
        kind: "observability",
        kpis: [
          { label: "i. Refresh", value: "New imagery each cycle" },
          { label: "ii. Flag", value: "Stressed blocks, early" },
          { label: "iii. Dispatch", value: "Crew to exact coordinates" },
          { label: "iv. Verify", value: "Recovery confirmed & recorded" },
        ],
        events: [
          {
            title: "Bu Towq · block 14",
            subtitle: "Flagged · 312 trees · condition index −18% over 3 cycles · likely cause: lateral fault",
            tone: "critical",
            trend: "down",
            thumbnail: thumb(0),
          },
          {
            title: "Al Maha 2 · block 7",
            subtitle: "Dispatched · crew 3 · 2 days ago",
            tone: "warning",
            trend: "up",
            thumbnail: thumb(1),
          },
          {
            title: "Dhebian · block 3",
            subtitle: "Verified recovered · re-checked next cycle",
            tone: "good",
            trend: "up",
            thumbnail: thumb(2),
          },
        ],
      },
    },
    {
      id: "monitoring-roles",
      section: "monitoring",
      name: "Who does what",
      description: "The loop only closes if each of these five jobs can be finished inside the platform.",
      content: {
        kind: "insights",
        cards: [
          {
            label: "Irrigation supervisor",
            value: "Which blocks need water this week",
            body: "— not which blocks are next on the rota.",
          },
          {
            label: "Maintenance crew lead",
            value: "A location, a reason, a way to mark it done",
            body: "So nothing is visited twice and nothing is lost.",
            accent: true,
          },
          {
            label: "Operations manager",
            value: "The whole estate, ranked",
            body: "So limited crews go where they change the outcome.",
          },
          {
            label: "Contract manager",
            value: "A survival record for any site, any date",
            body: "To answer the end client without a site visit.",
            accent: true,
          },
          {
            label: "Ecologist",
            value: "The model's calls, checked against field reality",
            body: "So the scoring earns trust over time.",
          },
        ],
      },
    },
    {
      id: "monitoring-estate",
      section: "monitoring",
      name: "Estate view",
      description: "66 sites, ranked by blocks flagged this cycle — where an operations manager looks first.",
      content: {
        kind: "metrics",
        charts: [
          {
            title: "Blocks flagged · by site",
            data: [
              { name: "Bu Towq", value: 14, color: C.orange },
              { name: "Al Maha 2", value: 9, color: C.yellow },
              { name: "Dhebian", value: 6, color: C.blue },
              { name: "Ghanadha", value: 0, color: C.green },
              { name: "Al Bida", value: 0, color: C.green },
            ],
          },
        ],
      },
    },
    {
      id: "monitoring-tiers",
      section: "monitoring",
      name: "Service tiers",
      description:
        "This deployment runs at Tier 2 — commercial-satellite resolution. Every tier feeds the same NabatOS platform; only the resolution of what lands in it changes.",
      content: MONITORING_TIER_TABLE,
    },
    {
      id: "monitoring-outcomes",
      section: "monitoring",
      name: "What it changes",
      description: "Four things a client can do that they can't today.",
      content: {
        kind: "insights",
        cards: WHAT_IT_CHANGES,
      },
    },
    {
      id: "monitoring-commercial",
      section: "monitoring",
      name: "Commercial",
      description: "Two shapes of deal, plus one subscription that sits underneath both.",
      content: {
        kind: "insights",
        cards: [
          {
            label: "Satellite tiers (1–2) · this contract",
            value: "Pure subscription",
            body: "No baseline survey, no mobilisation — paid per hectare per year for a recurring condition feed.",
            accent: true,
          },
          {
            label: "Drone tiers (3–4)",
            value: "290 AED/ha baseline",
            body: "Then 290–490 AED/ha in recurring monthly updates — the tier above this contract's own.",
          },
          {
            label: "Platform subscription",
            value: "35 AED/ha/yr",
            body: "Sits across all four tiers — the piece that turns any of them into recurring revenue.",
          },
        ],
      },
    },
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

  // Attached in one pass rather than written into each block above: the map
  // views are a sequence that has to be read as a sequence (see storyMap.ts),
  // and a block that gains no view simply leaves the map alone — which is the
  // right default for anything added here later without one.
  return blocks.map((block) => {
    const map = STORY_MAP_VIEWS[block.id];
    return map ? { ...block, map } : block;
  });
}
