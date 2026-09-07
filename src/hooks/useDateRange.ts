import { useEffect, useMemo, useState } from "react";
import { aggregateRange, type DateRange } from "../data/aggregate";
import { monthLabels } from "../data/monthlySnapshots";
import type { MonthSnapshot } from "../data/types";

const FULL_RANGE: DateRange = { startIndex: 0, endIndex: monthLabels.length - 1 };
const LATEST_MONTH_RANGE: DateRange = { startIndex: monthLabels.length - 1, endIndex: monthLabels.length - 1 };

/**
 * @param initial "full" (the default) opens on the entire history — what the
 * map timeline wants, since Maps/Areas/Story are about scrubbing through
 * time. "latest" opens on just the most recent month — what a calendar
 * picker wants, since a KPI dashboard reads as "how are things now" until the
 * viewer deliberately reaches back into history.
 */
export function useDateRange(snapshots: MonthSnapshot[], initial: "full" | "latest" = "full") {
  const initialRange = initial === "latest" ? LATEST_MONTH_RANGE : FULL_RANGE;
  const [range, setRange] = useState<DateRange>(initialRange);

  // Switching areas swaps the underlying dataset — reset to the initial
  // window so the selection stays valid and reflects the newly selected area.
  useEffect(() => {
    setRange(initialRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots]);

  const aggregated = useMemo(() => aggregateRange(snapshots, range), [snapshots, range]);

  return {
    months: monthLabels,
    range,
    setRange,
    aggregated,
  };
}
