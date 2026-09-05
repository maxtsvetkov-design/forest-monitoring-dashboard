import { useCallback, useEffect, useMemo, useState } from "react";
import { LAYER_ORDER, type ContentLayerId } from "../components/LayerPanel";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";

type Overrides = Record<ContentLayerId, DateRange | null>;

const NO_OVERRIDES = Object.fromEntries(LAYER_ORDER.map((id) => [id, null])) as Overrides;

export interface LayerTime {
  /** Every layer's effective range — its own override, or the master range. */
  rangeFor: Record<ContentLayerId, DateRange>;
  detachedIds: ContentLayerId[];
  setLayerRange: (id: ContentLayerId, range: DateRange) => void;
  resyncLayer: (id: ContentLayerId) => void;
  resyncAll: () => void;
}

/**
 * Per-layer date-range overrides. `null` means "follow the master range", which
 * is the default for every layer — scrubbing a layer's own strip is what
 * detaches it.
 *
 * Overrides are dropped when the area changes, for the same reason
 * useDateRange resets there: a swapped dataset invalidates a stored selection,
 * and a stale index would point at a month that no longer exists.
 */
export function useLayerTime(area: Area, masterRange: DateRange): LayerTime {
  const [overrides, setOverrides] = useState<Overrides>(NO_OVERRIDES);

  useEffect(() => {
    setOverrides(NO_OVERRIDES);
  }, [area]);

  const rangeFor = useMemo(
    () =>
      Object.fromEntries(LAYER_ORDER.map((id) => [id, overrides[id] ?? masterRange])) as Record<
        ContentLayerId,
        DateRange
      >,
    [overrides, masterRange],
  );

  const detachedIds = useMemo(() => LAYER_ORDER.filter((id) => overrides[id] !== null), [overrides]);

  const setLayerRange = useCallback((id: ContentLayerId, range: DateRange) => {
    setOverrides((prev) => ({ ...prev, [id]: range }));
  }, []);

  const resyncLayer = useCallback((id: ContentLayerId) => {
    setOverrides((prev) => ({ ...prev, [id]: null }));
  }, []);

  const resyncAll = useCallback(() => setOverrides(NO_OVERRIDES), []);

  return { rangeFor, detachedIds, setLayerRange, resyncLayer, resyncAll };
}
