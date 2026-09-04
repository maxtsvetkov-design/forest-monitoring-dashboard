// The botanical vocabulary for the whole app — species, the genus and
// scientific name each one implies, and the five-step canopy condition scale.
//
// Everything here is a lookup, never a stored duplicate: a tree record carries
// only its `species` key, and its genus / scientific name are resolved through
// this table. That is deliberate — genus and scientific name are *functions* of
// the species, so storing them on the record would create three fields that can
// drift out of agreement (a "Ghaf" row claiming genus Ziziphus) with nothing to
// stop it. One key in, everything else derived.

export type SpeciesKey =
  | "arak"
  | "ghaf"
  | "ghuwayf"
  | "marakh"
  | "nakhlah"
  | "salam"
  | "samar"
  | "sidr"
  | "talha"
  | "tarfa"
  | "unidentified";

export interface SpeciesInfo {
  key: SpeciesKey;
  /** The local (Arabic) common name — what the field survey records. */
  common: string;
  genus: string;
  scientific: string;
  /** Chart colour, held here so the donut, the scatter and the table legend
   * can never assign the same species two different colours. */
  color: string;
  /** Share of the planted population. Sums to 1 across the table. */
  share: number;
  /**
   * How far this species lags the plot-wide recovery, 0–1. Irrigation reached
   * the established ghaf and sidr stands first; the replanted palms and the
   * scrubbier acacias came later, so their curves arrive behind the others
   * instead of every species tracing one identical line.
   */
  lag: number;
}

/**
 * Ordered as the survey sheet lists them (alphabetically by common name), with
 * "Unidentified" last since it isn't a species so much as the absence of one.
 */
export const SPECIES: SpeciesInfo[] = [
  { key: "arak", common: "Arak", genus: "Salvadora", scientific: "Salvadora persica", color: "#3AAD8A", share: 0.09, lag: 0.2 },
  { key: "ghaf", common: "Ghaf", genus: "Prosopis", scientific: "Prosopis cineraria", color: "#E07B39", share: 0.24, lag: 0 },
  { key: "ghuwayf", common: "Ghuwayf", genus: "Prosopis", scientific: "Prosopis juliflora", color: "#C8B420", share: 0.03, lag: 0.1 },
  { key: "marakh", common: "Marakh", genus: "Leptadenia", scientific: "Leptadenia pyrotechnica", color: "#7E5BEF", share: 0.05, lag: 0.4 },
  { key: "nakhlah", common: "Nakhlah", genus: "Phoenix", scientific: "Phoenix dactylifera", color: "#5BA4CF", share: 0.11, lag: 0.45 },
  { key: "salam", common: "Salam", genus: "Vachellia", scientific: "Vachellia flava", color: "#CF5A9E", share: 0.04, lag: 0.3 },
  { key: "samar", common: "Samar", genus: "Vachellia", scientific: "Vachellia tortilis", color: "#2E9B6F", share: 0.13, lag: 0.15 },
  { key: "sidr", common: "Sidr", genus: "Ziziphus", scientific: "Ziziphus spina-christi", color: "#1A9E7A", share: 0.16, lag: 0.1 },
  { key: "talha", common: "Talha", genus: "Vachellia", scientific: "Vachellia seyal", color: "#D4A61A", share: 0.07, lag: 0.25 },
  { key: "tarfa", common: "Tarfa", genus: "Tamarix", scientific: "Tamarix aphylla", color: "#4A8FC1", share: 0.06, lag: 0.35 },
  { key: "unidentified", common: "Unidentified", genus: "Unidentified", scientific: "Unidentified", color: "#86868f", share: 0.02, lag: 0.5 },
];

const SPECIES_BY_KEY = new Map<SpeciesKey, SpeciesInfo>(SPECIES.map((s) => [s.key, s]));

export function speciesInfo(key: SpeciesKey): SpeciesInfo {
  const found = SPECIES_BY_KEY.get(key);
  if (!found) throw new Error(`Unknown species key: ${key}`);
  return found;
}

export const SPECIES_KEYS: SpeciesKey[] = SPECIES.map((s) => s.key);

/** Every genus present, de-duplicated and sorted — Prosopis and Vachellia each
 * cover more than one species, so this is shorter than SPECIES. */
export const GENERA: string[] = [...new Set(SPECIES.map((s) => s.genus))].sort();

/** Every scientific name, sorted — a 1:1 mapping onto SPECIES. */
export const SCIENTIFIC_NAMES: string[] = SPECIES.map((s) => s.scientific).sort();

// ── Condition ────────────────────────────────────────────────────────────────

/**
 * Canopy condition, worst to best. Ordered deliberately: the array index *is*
 * the severity rank, so "is this worse than that" is an index comparison rather
 * than a lookup table someone has to keep in sync.
 */
export type ConditionKey = "defoliated" | "sparse" | "moderate" | "normal" | "vigorous";

export interface ConditionInfo {
  key: ConditionKey;
  label: string;
  color: string;
  /**
   * Lower bound of the vigour score (0–1) that lands a tree in this band. See
   * treePopulation.ts: each tree carries a continuous score per month and this
   * is what turns it into the categorical value the UI shows.
   */
  min: number;
  /** Whether a tree in this condition earns a map pin and counts as "needs
   * attention" — the three worst bands do. */
  flagged: boolean;
}

export const CONDITIONS: ConditionInfo[] = [
  { key: "defoliated", label: "Defoliated", color: "#8C8C8C", min: 0, flagged: true },
  { key: "sparse", label: "Sparse", color: "#E55C2F", min: 0.2, flagged: true },
  { key: "moderate", label: "Moderate", color: "#F0B429", min: 0.42, flagged: true },
  { key: "normal", label: "Normal", color: "#24A67A", min: 0.62, flagged: false },
  { key: "vigorous", label: "Vigorous", color: "#0A7761", min: 0.82, flagged: false },
];

export const CONDITION_KEYS: ConditionKey[] = CONDITIONS.map((c) => c.key);

const CONDITION_BY_KEY = new Map<ConditionKey, ConditionInfo>(CONDITIONS.map((c) => [c.key, c]));

export function conditionInfo(key: ConditionKey): ConditionInfo {
  const found = CONDITION_BY_KEY.get(key);
  if (!found) throw new Error(`Unknown condition key: ${key}`);
  return found;
}

export const CONDITION_LABEL: Record<ConditionKey, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.key, c.label]),
) as Record<ConditionKey, string>;

export const CONDITION_COLOR: Record<ConditionKey, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.key, c.color]),
) as Record<ConditionKey, string>;

/** Turns a continuous 0–1 vigour score into its condition band. Walks from the
 * best band down, so the first threshold the score clears wins. */
export function conditionForVigour(vigour: number): ConditionKey {
  for (let i = CONDITIONS.length - 1; i >= 0; i--) {
    if (vigour >= CONDITIONS[i].min) return CONDITIONS[i].key;
  }
  return "defoliated";
}

export function isFlaggedCondition(key: ConditionKey): boolean {
  return conditionInfo(key).flagged;
}
