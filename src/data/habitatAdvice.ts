import type { HabitatChangeReport } from "./habitatChange";
import type { StoryMapView } from "./storyMap";
import { CONDITION_COLOR, CONDITION_LABEL } from "./taxonomy";
import { CURRENT_TIER_INDEX, SPEC_ROWS, TIERS } from "./tiers";
import type { CategoryDatum } from "./types";

/**
 * What the assistant says about a habitat change report, and the statistics it
 * says it with.
 *
 * Every answer is a function of the report rather than a stored string, for the
 * same reason the report itself is derived: the panel beside it is showing
 * these numbers, and prose that restated them from memory would drift the
 * moment the interval moved. Move a timeline handle and the advice re-reads.
 *
 * The voice is an ecologist's, and the sequence is a real triage: what is
 * worst, how it compares to the rest of the plot, what is still savable, and
 * finally whether the imagery on this contract can actually confirm any of it —
 * which it cannot, and that is the honest end of the conversation rather than a
 * sales hook bolted onto it. The tier facts behind that last answer are read
 * from `data/tiers.ts`, so the limit quoted is the limit this deployment
 * actually has.
 */

/** One panel of statistics under an answer. Shapes modelled on the Figma
 * analytics cards (node 1818:42795): a labelled breakdown that totals up, a
 * period-over-period stacked comparison with the value written inside each
 * segment, a single headline metric, and a capability table. */
export type AdviceWidget =
  | {
      kind: "breakdown";
      title: string;
      rows: { label: string; value: number; color: string }[];
      totalLabel: string;
    }
  | {
      kind: "compare";
      title: string;
      unit: string;
      columns: { label: string; segments: { label: string; value: number; color: string }[] }[];
    }
  | {
      kind: "metric";
      title: string;
      value: string;
      change?: string;
      trend?: "up" | "down";
      note: string;
    }
  | {
      kind: "capability";
      title: string;
      rows: { label: string; current: string; needed: string; has: boolean }[];
    };

export interface AdviceAnswer {
  body: string;
  widget?: AdviceWidget;
  /** Set on the answer that ends at the resolution limit — the one place the
   * assistant asks for better imagery, because it is the one place it has a
   * reason to. The copy lives here rather than in the component so the
   * resolution it quotes comes off `data/tiers.ts` like every other figure in
   * this file, instead of being retyped next to a button. */
  recommendation?: string;
}

/**
 * What the map should do when a statistics panel is clicked — one view per
 * chart *kind*, because the kind is what carries the meaning: a per-block
 * breakdown is a question about where, a condition mix is a question about
 * proportion, a canopy figure is a question about crowns, and the capability
 * table is a question about pixels. Each therefore wants a different place to
 * stand and a different set of layers lit.
 *
 * The same `StoryMapView` vocabulary the Story tab drives the map with (see
 * storyMap.ts) rather than a second camera API — five named frames, an
 * exhaustive layer set, an optional colour treatment, and a note saying why
 * that view suits these numbers.
 *
 * Module-level constants, and that matters: MapCanvas's story effect keys on
 * the view object's *identity*, so a view built inline during render would
 * re-fly the camera on every keystroke. The advisor spreads these into a fresh
 * object per click, which is exactly the intended firing rate — one flight per
 * deliberate act, and clicking the same chart again re-frames it after the
 * reader has panned away.
 */
export const CHART_MAP_VIEWS: Record<AdviceWidget["kind"], StoryMapView> = {
  // Where the losses are. Pins restricted to the declines are already on this
  // screen, so lighting them over the condition mask puts the count in the
  // panel and the ground it came from in the same view.
  breakdown: {
    frame: "plot",
    layers: ["aerial", "canopy", "pins", "dyingTrees"],
    note: "Flagged stems lit over the canopy-condition mask, so the per-block counts can be read against the ground they came from.",
  },
  // Proportion, not position. The pins come off deliberately: a chart about
  // what share of the plot sits in each band is not answered by where any
  // individual stem stands, and 87 markers would argue otherwise.
  compare: {
    frame: "plot",
    layers: ["aerial", "canopy"],
    note: "The condition mask alone, square on — this comparison is about what share of the plot sits in each band, not where any single stem is.",
  },
  // Canopy cover was measured from crowns, so the view stands where crowns are
  // visible as volume rather than as a flat mask.
  metric: {
    frame: "canopy",
    layers: ["aerial", "generative", "trees3d"],
    note: "Tilted into the modelled canopy, because a cover figure is an area of crowns — and crowns only read as crowns from inside them.",
  },
  // The argument, made visually. Eye level beside one tree with every overlay
  // stripped, so what fills the screen is the raw capture at its own
  // resolution — which is the whole point of the answer above it.
  capability: {
    frame: "twin",
    layers: ["aerial"],
    note: "Down to one crown on the bare capture, every overlay off. What you are looking at is the imagery's real resolution — the reason the condition of a single tree cannot be settled from it.",
  },
};

export interface AdviceQuestion {
  id: string;
  /** What the reader clicks. Written as they would ask it, not as a menu item. */
  prompt: string;
  answer: (report: HabitatChangeReport) => AdviceAnswer;
}

const CURRENT_TIER = TIERS[CURRENT_TIER_INDEX];
const NEXT_TIER = TIERS[CURRENT_TIER_INDEX + 1] ?? CURRENT_TIER;
const RESOLUTION_ROW = SPEC_ROWS.find((r) => r.label === "Resolution");
const CURRENT_RESOLUTION = RESOLUTION_ROW?.cells[CURRENT_TIER_INDEX] ?? "0.3–0.5 m";
/** The next tier's resolution as the spec table writes it — right for a table
 * cell, wrong mid-sentence ("imagery at Per tree ±5 cm"), which is why the
 * prose below uses PROSE_RESOLUTION instead. */
const NEEDED_RESOLUTION = RESOLUTION_ROW?.cells[CURRENT_TIER_INDEX + 1] ?? "Per tree ±5 cm";
export const PROSE_RESOLUTION = NEEDED_RESOLUTION.replace(/^Per tree\s*/i, "").trim();

function countIn(mix: CategoryDatum[], label: string): number {
  return mix.find((d) => d.name === label)?.value ?? 0;
}

/** The one-line alert the assistant opens with — the single worst thing in the
 * report, named. Deliberately not a summary of everything: an alert that lists
 * six blocks is a report, and a reader dismisses a report. */
export function criticalAlert(report: HabitatChangeReport): { headline: string; body: string } {
  const worst = report.blocks.find((b) => b.declined > 0);
  if (!worst) {
    return {
      headline: "Nothing crossed a threshold.",
      body: `No tree moved into a flagged band between ${report.baselineLabel} and ${report.compareLabel}. Widen the interval if you're looking for slower drift.`,
    };
  }
  return {
    headline: `${worst.label} is failing.`,
    body: `${worst.declined} trees dropped into a flagged band between ${report.baselineLabel} and ${report.compareLabel} — the worst of them now ${CONDITION_LABEL[
      worst.worst
    ].toLowerCase()}. I'd look here before anywhere else on the plot.`,
  };
}

export const ADVICE_QUESTIONS: AdviceQuestion[] = [
  {
    id: "triage",
    prompt: "What should I deal with first?",
    answer: (report) => {
      const declining = report.blocks.filter((b) => b.declined > 0);
      const worst = declining[0];
      const rest = declining.slice(1).reduce((sum, b) => sum + b.declined, 0);
      return {
        body: worst
          ? `${worst.label}, and not because it has the most trees — because it has the steepest drop into flagged bands over one interval. ${worst.declined} of the ${report.declined} declines on this plot are inside it; the other ${declining.length - 1} blocks account for ${rest} between them. Send the field team to its centre rather than walking the boundary: dieback in these blocks spreads from the middle of the stand, where the canopy closes and the irrigation reaches least.`
          : `Nothing is failing over this interval — ${report.recovered} trees actually climbed out of a flagged band. There is no first thing to deal with; the useful move is to widen the interval and check for slower drift.`,
        widget: declining.length
          ? {
              kind: "breakdown",
              title: "Declines by block",
              rows: declining.map((b) => ({
                label: b.label,
                value: b.declined,
                color: CONDITION_COLOR[b.worst],
              })),
              totalLabel: "Trees declined",
            }
          : undefined,
      };
    },
  },
  {
    id: "context",
    prompt: "How bad is that against the whole plot?",
    answer: (report) => {
      const before = countIn(report.conditionMixBefore, CONDITION_LABEL.defoliated);
      const after = countIn(report.conditionMixAfter, CONDITION_LABEL.defoliated);
      return {
        body: `Bad in a specific way: the plot is not uniformly sliding, it is splitting. ${report.recovered} trees improved over the same interval that ${report.declined} declined — so most of this ground is responding while a few blocks fail hard. Defoliated stems went from ${before} to ${after}. That pattern is a supply problem, not a plot-wide one; a drought or a pest year moves everything at once.`,
        widget: {
          kind: "compare",
          title: "Condition mix",
          unit: "trees",
          columns: [
            {
              label: report.baselineLabel,
              segments: report.conditionMixBefore.map((d) => ({
                label: d.name,
                value: d.value,
                color: d.color,
              })),
            },
            {
              label: report.compareLabel,
              segments: report.conditionMixAfter.map((d) => ({
                label: d.name,
                value: d.value,
                color: d.color,
              })),
            },
          ],
        },
      };
    },
  },
  {
    id: "reversible",
    prompt: "Is any of it still savable?",
    answer: (report) => {
      const sparse = countIn(report.conditionMixAfter, CONDITION_LABEL.sparse);
      const moderate = countIn(report.conditionMixAfter, CONDITION_LABEL.moderate);
      const defoliated = countIn(report.conditionMixAfter, CONDITION_LABEL.defoliated);
      const savable = sparse + moderate;
      const delta = report.canopyCoverDelta;
      return {
        body: `Most of it. ${savable} trees sit in Sparse or Moderate — they are thin, but they still carry leaf area, which means they are still transpiring and will answer to water within a season. The ${defoliated} Defoliated stems are the ones I would not spend the budget on: past a full season with no canopy, what is left is usually structural rather than stressed. Plot-wide canopy cover moved ${delta > 0 ? "+" : ""}${delta}pp over this interval, so the recovering ground is nearly paying for the failing ground — which is exactly why the losses are easy to miss in a headline number.`,
        widget: {
          kind: "metric",
          title: "Canopy cover",
          value: `${delta > 0 ? "+" : ""}${delta}pp`,
          change: `${savable} still savable`,
          trend: delta >= 0 ? "up" : "down",
          note: `${report.baselineLabel} → ${report.compareLabel}, plot-wide. Sparse and Moderate stems retain leaf area; Defoliated is past the point irrigation reaches.`,
        },
      };
    },
  },
  {
    id: "confirm",
    prompt: "Can you confirm this from the current imagery?",
    answer: (report) => ({
      body: `Not to the standard you would act on, and I would rather say so. This deployment runs at ${CURRENT_TIER.label} — ${CURRENT_RESOLUTION} per pixel. A Ghaf crown two metres across is four to six pixels at that scale: enough to measure whether a crown is still there, not what state it is in. So what I have flagged is modelled from canopy extent and its change over time, not read off a leaf. Per-tree health and chlorophyll stress are not capabilities on this tier at all. That matters here specifically, because the one thing I cannot separate at this resolution is a genuine death from a seasonal drop — and those two call for opposite responses. To settle the ${report.declined} declines, I need imagery resolved to ${PROSE_RESOLUTION} per tree — ${NEXT_TIER.label} on this contract.`,
      widget: {
        kind: "capability",
        title: `What ${CURRENT_TIER.label} can and cannot answer`,
        rows: [
          { label: "Canopy extent & change", current: CURRENT_RESOLUTION, needed: "—", has: true },
          { label: "Stressed-block detection", current: "Included", needed: "—", has: true },
          { label: "Per-tree health rating", current: "Not on this tier", needed: NEXT_TIER.label, has: false },
          { label: "Chlorophyll / sparse-cover stress", current: "Not on this tier", needed: NEXT_TIER.label, has: false },
          { label: "Death vs. seasonal drop", current: "Cannot separate", needed: NEEDED_RESOLUTION, has: false },
        ],
      },
      recommendation: `Commission a hi-res pass over the failing blocks before committing a field crew. At ${PROSE_RESOLUTION} I can tell you which of these stems are dead and which are dormant — and that is the difference between replanting and irrigating.`,
    }),
  },
];
