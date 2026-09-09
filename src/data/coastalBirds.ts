/**
 * Other UAE coastal bird species, for Abu Al Abyad's Recent Events feed.
 *
 * The Crab-plover census (`crabPlovers.ts`) stays the one species with a real
 * drawn population — ringed individuals, survey blocks, markers on the
 * imagery — because that is the feature this app actually built out. This
 * file is deliberately smaller: incidental sightings, logged as a count on a
 * given month rather than as individually tracked birds, the same
 * distinction a field notebook draws between "the colony we monitor" and
 * "what else came through this month."
 *
 * WHAT IS REAL AND WHAT IS NOT, same disclosure crabPlovers.ts makes:
 *
 * - Every species below, its habitat fit, and its UAE coastal presence are
 *   facts — these are birds genuinely recorded on the UAE's Arabian Gulf
 *   coast and islands, not invented names.
 * - Which species turns up in which month, and how many, is SYNTHETIC —
 *   seeded from the area id, reproducible, not observed. No real survey
 *   produced these counts.
 */

import { seededRandom } from "./random";

export interface CoastalSpecies {
  key: string;
  common: string;
  scientific: string;
  /** Why this species fits an incidental sighting here — carried so an event
   *  description can say more than a bare species name. */
  habitatNote: string;
}

export const UAE_COASTAL_SPECIES: CoastalSpecies[] = [
  {
    key: "socotra-cormorant",
    common: "Socotra Cormorant",
    scientific: "Phalacrocorax nigrogularis",
    habitatNote: "a Gulf-endemic seabird that breeds colonially on undisturbed offshore islands",
  },
  {
    key: "greater-flamingo",
    common: "Greater Flamingo",
    scientific: "Phoenicopterus roseus",
    habitatNote: "forages the shallow lagoon margins for the same crustaceans the island's tidal flats hold",
  },
  {
    key: "western-reef-heron",
    common: "Western Reef Heron",
    scientific: "Egretta gularis",
    habitatNote: "a resident wader of rocky and sandy Gulf shorelines",
  },
  {
    key: "osprey",
    common: "Osprey",
    scientific: "Pandion haliaetus",
    habitatNote: "a wintering fish-eating raptor that perches along exposed coastal spits",
  },
  {
    key: "caspian-tern",
    common: "Caspian Tern",
    scientific: "Hydroprogne caspia",
    habitatNote: "the largest tern on this coast, fishing the channel between the cay and the mainland",
  },
  {
    key: "kentish-plover",
    common: "Kentish Plover",
    scientific: "Anarhynchus alexandrinus",
    habitatNote: "a small shorebird that nests directly on open sand alongside the Crab-plover colony",
  },
];

/**
 * Deterministic in `(areaId, monthIndex)`: which species turned up that
 * month, and roughly how many. At most one per month — a feed reporting a
 * new species every single month would read as noise rather than a real
 * incidental log.
 */
export function incidentalSightingFor(
  areaId: string,
  monthIndex: number,
): { species: CoastalSpecies; count: number } | null {
  const rand = seededRandom(`coastal-incidental:${areaId}:${monthIndex}`);
  // Roughly 1 in 3 months has a loggable incidental sighting — frequent
  // enough to give the feed real variety, sparse enough that it still reads
  // as "logged," not as a running species list.
  if (rand() > 1 / 3) return null;
  const species = UAE_COASTAL_SPECIES[Math.floor(rand() * UAE_COASTAL_SPECIES.length)];
  const count = 1 + Math.floor(rand() * 8);
  return { species, count };
}
