/**
 * Other UAE birds, for Al Maha Forest's Recent Events feed.
 *
 * Same shape and the same honesty split as `coastalBirds.ts`'s equivalent for
 * Abu Al Abyad, applied to a Ghaf-woodland site instead of a coastal one:
 * this app's actual tracked population here is trees, not birds, so these are
 * incidental sightings logged on a given month rather than a second drawn
 * population with its own rings and markers.
 *
 * WHAT IS REAL AND WHAT IS NOT:
 *
 * - Every species below, its habitat fit, and its UAE presence are facts —
 *   these are birds genuinely recorded in the UAE's Ghaf woodland, oasis and
 *   plantation habitat, not invented names.
 * - Which species turns up in which month, and how many, is SYNTHETIC —
 *   seeded from the area id, reproducible, not observed.
 */

import { seededRandom } from "./random";

export interface CoastalSpecies {
  key: string;
  common: string;
  scientific: string;
  habitatNote: string;
}

export const UAE_WOODLAND_SPECIES: CoastalSpecies[] = [
  {
    key: "eurasian-hoopoe",
    common: "Eurasian Hoopoe",
    scientific: "Upupa epops",
    habitatNote: "a resident and winter visitor that forages the open ground beneath Ghaf canopy for insects",
  },
  {
    key: "purple-sunbird",
    common: "Purple Sunbird",
    scientific: "Cinnyris asiaticus",
    habitatNote: "a UAE resident drawn to flowering Ghaf and Samar for nectar",
  },
  {
    key: "laughing-dove",
    common: "Laughing Dove",
    scientific: "Spilopelia senegalensis",
    habitatNote: "the commonest resident dove of UAE oases and tree-shaded ground",
  },
  {
    key: "grey-francolin",
    common: "Grey Francolin",
    scientific: "Francolinus pondicerianus",
    habitatNote: "an established ground-dwelling resident of UAE scrub and plantation edges",
  },
  {
    key: "indian-silverbill",
    common: "Indian Silverbill",
    scientific: "Euodice malabarica",
    habitatNote: "a small flocking finch of open scrub and grassy ground beneath scattered trees",
  },
  {
    key: "southern-grey-shrike",
    common: "Southern Grey Shrike",
    scientific: "Lanius elegans",
    habitatNote: "a resident predator of desert scrub that perches conspicuously in Ghaf and Acacia crowns",
  },
  {
    key: "white-eared-bulbul",
    common: "White-eared Bulbul",
    scientific: "Pycnonotus leucotis",
    habitatNote: "a vocal UAE resident of gardens, oases and wooded wadis",
  },
];

/**
 * Deterministic in `(areaId, monthIndex)` — at most one incidental sighting a
 * month, the same cadence `coastalBirds.ts` uses and for the same reason: a
 * new species every month reads as noise, not a real field log. Fires on
 * roughly two months out of three, rather than one in three, so the feed
 * this backs reads as an active monthly walk-through log instead of an
 * occasional aside.
 */
export function incidentalWoodlandSightingFor(
  areaId: string,
  monthIndex: number,
): { species: CoastalSpecies; count: number } | null {
  const rand = seededRandom(`woodland-incidental:${areaId}:${monthIndex}`);
  if (rand() > 2 / 3) return null;
  const species = UAE_WOODLAND_SPECIES[Math.floor(rand() * UAE_WOODLAND_SPECIES.length)];
  const count = 1 + Math.floor(rand() * 6);
  return { species, count };
}
