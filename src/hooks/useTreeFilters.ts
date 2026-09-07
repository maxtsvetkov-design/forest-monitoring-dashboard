import { useCallback, useMemo, useState } from "react";
import { heightBucketFor } from "../data/monthlySnapshots";
import type { TreeRecord } from "../data/trees";

export interface TreeFilters {
  query: string;
  setQuery: (query: string) => void;
  healthFilter: Set<string>;
  toggleHealth: (value: string) => void;
  /** Replaces the health selection outright — used when a caller outside the
   * table (the health donut's slices) hands over one specific value, rather
   * than the toggle a chip click performs. Also clears every other facet and
   * the search, so the jump lands on exactly what was clicked with no
   * leftover filters. */
  setHealthOnly: (value: string) => void;
  /** Same handover, but for a whole band of conditions at once — "Total
   * healthy trees" means Normal + Vigorous, and NDVI's own drag is the three
   * flagged bands, neither of which is expressible as a single value. */
  setHealthOnlyMany: (values: string[]) => void;
  speciesFilter: Set<string>;
  toggleSpecies: (value: string) => void;
  speciesOptions: string[];
  /** Crown-radius buckets (b1..b5), matching the treemap's bands. */
  crownFilter: Set<string>;
  toggleCrown: (value: string) => void;
  /** Replaces the crown selection outright — the treemap's bands hand over one
   * specific bucket, the same way the health donut's slices do. */
  setCrownOnly: (value: string) => void;
  /** Trunk-diameter classes, matched against `TreeRecord.diameter` — which is
   * the full display string ("L (>5 m)"), the same text the diameter donut
   * labels its slices with, so a slice hands its own name straight over. */
  diameterFilter: Set<string>;
  toggleDiameter: (value: string) => void;
  setDiameterOnly: (value: string) => void;
  /** Height bands (h1..h3). The record carries a raw metre height, not a
   * band, so this one buckets at filter time via heightBucketFor — the same
   * function monthlySnapshots.ts counts the donut's slices with. */
  heightFilter: Set<string>;
  toggleHeight: (value: string) => void;
  setHeightOnly: (value: string) => void;
  /** Trees losing more canopy than this plot's own average — the ones holding
   * canopy cover (and so the image-composition split) down. A derived
   * threshold, not a hardcoded one: see `canopyLossMean` below. */
  canopyLossOnly: boolean;
  toggleCanopyLoss: () => void;
  setCanopyLossOnly: () => void;
  /** The mean canopy loss across the records passed in, which is what
   * `canopyLossOnly` compares against — surfaced so the UI can say what the
   * filter actually means rather than showing an unexplained toggle. */
  canopyLossMean: number;
  active: boolean;
  clear: () => void;
  /** The records surviving every filter, in the caller's original order. */
  visible: TreeRecord[];
}

/**
 * A filter handed to the Assets view from somewhere else — a dashboard widget
 * that was clicked. One discriminated union rather than a prop pair per
 * dimension: seven widgets now hand filters over, and seven
 * `pendingXFilter` / `onPendingXFilterApplied` pairs threaded through App and
 * AssetsView would be the same code written seven times.
 */
export type PendingAssetFilter =
  | { kind: "health"; values: string[] }
  | { kind: "crown"; value: string }
  | { kind: "diameter"; value: string }
  | { kind: "height"; value: string }
  | { kind: "canopyLoss" };

/** Applies a handed-over filter to a live TreeFilters instance. Lives here,
 * next to the setters it dispatches to, so a new `kind` can't be added to the
 * union without this switch failing to compile. */
export function applyPendingFilter(filters: TreeFilters, pending: PendingAssetFilter): void {
  switch (pending.kind) {
    case "health":
      filters.setHealthOnlyMany(pending.values);
      return;
    case "crown":
      filters.setCrownOnly(pending.value);
      return;
    case "diameter":
      filters.setDiameterOnly(pending.value);
      return;
    case "height":
      filters.setHeightOnly(pending.value);
      return;
    case "canopyLoss":
      filters.setCanopyLossOnly();
      return;
  }
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Filter state for the Assets view, held above both the table and the map.
 *
 * It lives here rather than inside TreeTable because the map has to honour the
 * same filters: ticking "Defoliated" should leave only defoliated trees on the
 * imagery, not just in the list. Keeping one filter state and deriving both
 * views from it is what stops the two from disagreeing — the same reasoning
 * that put the map's pins and the table's rows on a single generator (see
 * data/trees.ts).
 *
 * Sorting deliberately stays in TreeTable: row order is presentation, and the
 * map has no use for it.
 */
export function useTreeFilters(records: TreeRecord[]): TreeFilters {
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<Set<string>>(new Set());
  const [speciesFilter, setSpeciesFilter] = useState<Set<string>>(new Set());
  const [crownFilter, setCrownFilter] = useState<Set<string>>(new Set());
  const [diameterFilter, setDiameterFilter] = useState<Set<string>>(new Set());
  const [heightFilter, setHeightFilter] = useState<Set<string>>(new Set());
  const [canopyLossOnly, setCanopyLossState] = useState(false);

  const speciesOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.species))).sort(),
    [records],
  );

  // Derived from the trees actually in range, not a fixed number: "worse than
  // average" has to mean worse than *this* selection's average, or narrowing
  // the date range would silently change what the filter claims to show.
  const canopyLossMean = useMemo(() => {
    if (records.length === 0) return 0;
    return records.reduce((sum, t) => sum + t.canopyLossPct, 0) / records.length;
  }, [records]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((t) => {
      if (q && !t.id.toLowerCase().includes(q) && !t.species.toLowerCase().includes(q)) return false;
      // Chips within a facet OR together; the facets AND together.
      if (healthFilter.size > 0 && !healthFilter.has(t.health)) return false;
      if (speciesFilter.size > 0 && !speciesFilter.has(t.species)) return false;
      if (crownFilter.size > 0 && !crownFilter.has(t.crownBucket)) return false;
      if (diameterFilter.size > 0 && !diameterFilter.has(t.diameter)) return false;
      if (heightFilter.size > 0 && !heightFilter.has(heightBucketFor(t.height))) return false;
      if (canopyLossOnly && t.canopyLossPct <= canopyLossMean) return false;
      return true;
    });
  }, [records, query, healthFilter, speciesFilter, crownFilter, diameterFilter, heightFilter, canopyLossOnly, canopyLossMean]);

  // Every "jump in from the dashboard" setter clears the whole filter state
  // first, so the arriving selection is the only thing constraining the view.
  // Kept as one function because forgetting to clear a newly-added facet in
  // one of the setters is exactly the kind of thing that silently strands a
  // filter the user can't see the source of.
  const resetAll = useCallback(() => {
    setQuery("");
    setHealthFilter(new Set());
    setSpeciesFilter(new Set());
    setCrownFilter(new Set());
    setDiameterFilter(new Set());
    setHeightFilter(new Set());
    setCanopyLossState(false);
  }, []);

  return {
    query,
    setQuery,
    healthFilter,
    toggleHealth: useCallback((value) => setHealthFilter((prev) => toggle(prev, value)), []),
    setHealthOnly: useCallback(
      (value: string) => {
        resetAll();
        setHealthFilter(new Set([value]));
      },
      [resetAll],
    ),
    setHealthOnlyMany: useCallback(
      (values: string[]) => {
        resetAll();
        setHealthFilter(new Set(values));
      },
      [resetAll],
    ),
    crownFilter,
    toggleCrown: useCallback((value) => setCrownFilter((prev) => toggle(prev, value)), []),
    setCrownOnly: useCallback(
      (value: string) => {
        resetAll();
        setCrownFilter(new Set([value]));
      },
      [resetAll],
    ),
    speciesFilter,
    toggleSpecies: useCallback((value) => setSpeciesFilter((prev) => toggle(prev, value)), []),
    speciesOptions,
    diameterFilter,
    toggleDiameter: useCallback((value) => setDiameterFilter((prev) => toggle(prev, value)), []),
    setDiameterOnly: useCallback(
      (value: string) => {
        resetAll();
        setDiameterFilter(new Set([value]));
      },
      [resetAll],
    ),
    heightFilter,
    toggleHeight: useCallback((value) => setHeightFilter((prev) => toggle(prev, value)), []),
    setHeightOnly: useCallback(
      (value: string) => {
        resetAll();
        setHeightFilter(new Set([value]));
      },
      [resetAll],
    ),
    canopyLossOnly,
    toggleCanopyLoss: useCallback(() => setCanopyLossState((prev) => !prev), []),
    setCanopyLossOnly: useCallback(() => {
      resetAll();
      setCanopyLossState(true);
    }, [resetAll]),
    canopyLossMean,
    active:
      query.trim() !== "" ||
      healthFilter.size > 0 ||
      speciesFilter.size > 0 ||
      crownFilter.size > 0 ||
      diameterFilter.size > 0 ||
      heightFilter.size > 0 ||
      canopyLossOnly,
    clear: resetAll,
    visible,
  };
}
