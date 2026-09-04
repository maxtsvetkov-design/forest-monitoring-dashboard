import { CONDITION_KEYS, SPECIES, speciesInfo, type ConditionKey, type SpeciesKey } from "./taxonomy";

// Fixed plot position for each species/condition bubble, generated once at
// module load so bubbles only grow/shrink (their z / count) as the selected
// range changes — they never jump around the chart.

/** Worst-to-best, matching CONDITIONS' own order, so the x axis reads as a
 * severity gradient left to right. */
export const scatterCategories: ConditionKey[] = CONDITION_KEYS;

const categoryX: Record<ConditionKey, number> = Object.fromEntries(
  CONDITION_KEYS.map((key, i) => [key, i + 1]),
) as Record<ConditionKey, number>;

const speciesYBase: Record<SpeciesKey, number> = Object.fromEntries(
  SPECIES.map((s, i) => [s.key, i + 1]),
) as Record<SpeciesKey, number>;

export const speciesLabel: Record<SpeciesKey, string> = Object.fromEntries(
  SPECIES.map((s) => [s.key, s.common]),
) as Record<SpeciesKey, string>;

export const speciesColor: Record<SpeciesKey, string> = Object.fromEntries(
  SPECIES.map((s) => [s.key, s.color]),
) as Record<SpeciesKey, string>;

/** Full "Common (Scientific)" label, for tooltips and the table's species
 * column where the botanical name earns its space. */
export function speciesFullLabel(key: SpeciesKey): string {
  const info = speciesInfo(key);
  return info.scientific === "Unidentified" ? info.common : `${info.common} (${info.scientific})`;
}

const positions = new Map<string, { x: number; y: number }>();
(Object.keys(speciesYBase) as SpeciesKey[]).forEach((species) => {
  scatterCategories.forEach((category) => {
    positions.set(`${species}:${category}`, {
      x: categoryX[category] + (Math.random() - 0.5) * 0.3,
      y: speciesYBase[species] + (Math.random() - 0.5) * 0.4,
    });
  });
});

export function scatterPosition(species: SpeciesKey, category: ConditionKey): { x: number; y: number } {
  return positions.get(`${species}:${category}`)!;
}
