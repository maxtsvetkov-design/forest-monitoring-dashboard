import { useEffect, useMemo, useState } from "react";
import { aggregateRange, type DateRange } from "../data/aggregate";
import { monthLabels } from "../data/monthlySnapshots";
import type { MonthSnapshot } from "../data/types";

const FULL_RANGE: DateRange = { startIndex: 0, endIndex: monthLabels.length - 1 };

export function useDateRange(snapshots: MonthSnapshot[]) {
  const [range, setRange] = useState<DateRange>(FULL_RANGE);

  // Switching areas swaps the underlying dataset — reset to the full window
  // so the selection stays valid and reflects the newly selected area.
  useEffect(() => {
    setRange(FULL_RANGE);
  }, [snapshots]);

  const aggregated = useMemo(() => aggregateRange(snapshots, range), [snapshots, range]);

  return {
    months: monthLabels,
    range,
    setRange,
    aggregated,
  };
}
