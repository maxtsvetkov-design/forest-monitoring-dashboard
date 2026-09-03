import { useCallback, useMemo, useState } from "react";
import type { TreeRecord } from "../data/trees";

export interface TreeFilters {
  query: string;
  setQuery: (query: string) => void;
  healthFilter: Set<string>;
  toggleHealth: (value: string) => void;
  /** Replaces the health selection outright — used when a caller outside the
   * table (the health donut's slices) hands over one specific value, rather
   * than the toggle a chip click performs. Also clears species and search, so
   * the jump lands on exactly what was clicked with no leftover filters. */
  setHealthOnly: (value: string) => void;
  speciesFilter: Set<string>;
  toggleSpecies: (value: string) => void;
  speciesOptions: string[];
  /** Crown-radius buckets (b1..b5), matching the treemap's bands. */
  crownFilter: Set<string>;
  toggleCrown: (value: string) => void;
  /** Replaces the crown selection outright — the treemap's bands hand over one
   * specific bucket, the same way the health donut's slices do. */
  setCrownOnly: (value: string) => void;
  active: boolean;
  clear: () => void;
  /** The records surviving every filter, in the caller's original order. */
  visible: TreeRecord[];
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Filter state for the Areas view, held above both the table and the map.
 *
 * It lives here rather than inside TreeTable because the map has to honour the
 * same filters: ticking "Dead" should leave only dead trees on the imagery, not
 * just in the list. Keeping one filter state and deriving both views from it is
 * what stops the two from disagreeing — the same reasoning that put the map's
 * pins and the table's rows on a single generator (see data/trees.ts).
 *
 * Sorting deliberately stays in TreeTable: row order is presentation, and the
 * map has no use for it.
 */
export function useTreeFilters(records: TreeRecord[]): TreeFilters {
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<Set<string>>(new Set());
  const [speciesFilter, setSpeciesFilter] = useState<Set<string>>(new Set());
  const [crownFilter, setCrownFilter] = useState<Set<string>>(new Set());

  const speciesOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.species))).sort(),
    [records],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((t) => {
      if (q && !t.id.toLowerCase().includes(q) && !t.species.toLowerCase().includes(q)) return false;
      // Chips within a facet OR together; the two facets AND together.
      if (healthFilter.size > 0 && !healthFilter.has(t.health)) return false;
      if (speciesFilter.size > 0 && !speciesFilter.has(t.species)) return false;
      if (crownFilter.size > 0 && !crownFilter.has(t.crownBucket)) return false;
      return true;
    });
  }, [records, query, healthFilter, speciesFilter, crownFilter]);

  const clear = useCallback(() => {
    setQuery("");
    setHealthFilter(new Set());
    setSpeciesFilter(new Set());
    setCrownFilter(new Set());
  }, []);

  return {
    query,
    setQuery,
    healthFilter,
    toggleHealth: useCallback((value) => setHealthFilter((prev) => toggle(prev, value)), []),
    setHealthOnly: useCallback((value: string) => {
      setQuery("");
      setSpeciesFilter(new Set());
      setCrownFilter(new Set());
      setHealthFilter(new Set([value]));
    }, []),
    crownFilter,
    toggleCrown: useCallback((value) => setCrownFilter((prev) => toggle(prev, value)), []),
    setCrownOnly: useCallback((value: string) => {
      setQuery("");
      setHealthFilter(new Set());
      setSpeciesFilter(new Set());
      setCrownFilter(new Set([value]));
    }, []),
    speciesFilter,
    toggleSpecies: useCallback((value) => setSpeciesFilter((prev) => toggle(prev, value)), []),
    speciesOptions,
    active: query.trim() !== "" || healthFilter.size > 0 || speciesFilter.size > 0 || crownFilter.size > 0,
    clear,
    visible,
  };
}
