import type { HealthKey, SpeciesKey } from "./types";

// Fixed plot position for each species/category bubble, generated once at
// module load so bubbles only grow/shrink (their z / count) as the selected
// range changes — they never jump around the chart.

export const scatterCategories: HealthKey[] = ["healthy", "stressed", "declining", "dead"];

const categoryX: Record<HealthKey, number> = {
  healthy: 1,
  stressed: 2,
  declining: 3,
  dead: 4,
};

const speciesYBase: Record<SpeciesKey, number> = {
  palm: 1,
  ghaf: 2,
  sidr: 3,
};

export const speciesLabel: Record<SpeciesKey, string> = {
  ghaf: "Ghaf canopy",
  sidr: "Sidr underneath",
  palm: "Palm beneath",
};

export const speciesColor: Record<SpeciesKey, string> = {
  ghaf: "#E07B39",
  sidr: "#CF7EC5",
  palm: "#5BA4CF",
};

const positions = new Map<string, { x: number; y: number }>();
(Object.keys(speciesYBase) as SpeciesKey[]).forEach((species) => {
  scatterCategories.forEach((category) => {
    positions.set(`${species}:${category}`, {
      x: categoryX[category] + (Math.random() - 0.5) * 0.3,
      y: speciesYBase[species] + (Math.random() - 0.5) * 0.4,
    });
  });
});

export function scatterPosition(species: SpeciesKey, category: HealthKey): { x: number; y: number } {
  return positions.get(`${species}:${category}`)!;
}
