import { CONDITION_LABEL, type ConditionKey } from "./taxonomy";
import type { TreeRecord } from "./trees";

export interface TreeHistoryEntry {
  date: Date;
  label: string;
  detail: string;
}

const CONDITION_NOTE: Record<ConditionKey, string> = {
  vigorous: "Full crown, strong new growth.",
  normal: "Canopy healthy, no visible stress.",
  moderate: "Some thinning and leaf discolouration.",
  sparse: "Significant crown thinning observed.",
  defoliated: "No live canopy remaining.",
};

/**
 * This tree's actual survey history, read straight off its condition timeline.
 *
 * It used to fabricate one: there was no longitudinal record behind a mock
 * tree, because the old data model rebuilt a fresh batch of trees every month,
 * so "this tree last March" did not exist as a thing to look up. All this
 * function could do was walk a plausible-looking decline backwards from the
 * tree's current state and hope it read as a history.
 *
 * With a persistent population (see treePopulation.ts) the history is real:
 * every tree carries the condition it was actually in for each month of the
 * window, and those are the same values the donut counted and the map pinned.
 * So the modal now reports what happened to this individual rather than a
 * story invented at the moment it was opened — and for a tree in the dieback
 * zone, that history genuinely shows a year of recovery followed by the
 * collapse of the last three months.
 *
 * Returns newest-last (oldest first), matching how the modal renders it.
 */
export function generateTreeHistory(
  tree: TreeRecord,
  /**
   * Real date per month index, oldest first. Optional: the window always ends
   * at the current calendar month, so counting back from today reproduces the
   * same dates — a caller deep in the component tree doesn't have to drill the
   * snapshots down just to label a timeline.
   */
  monthDates: Date[] = [],
  surveyCount = 6,
): TreeHistoryEntry[] {
  const history = tree.conditionHistory;
  if (history.length === 0) return [];

  // The window ends at the month this record is from, so opening a tree while
  // the timeline sits in March shows its history up to March, not a spoiler of
  // the months after it.
  const end = Math.min(tree.monthIndex, history.length - 1);
  const start = Math.max(0, end - surveyCount + 1);

  const entries: TreeHistoryEntry[] = [];
  for (let m = start; m <= end; m++) {
    const condition = history[m];
    const previous = m > 0 ? history[m - 1] : null;
    const changed = previous !== null && previous !== condition;

    entries.push({
      // Falls back to a computed month if the caller didn't pass dates, so this
      // never renders an Invalid Date.
      date: monthDates[m] ?? monthFallback(history.length - 1 - m),
      label:
        m === end ? "Most recent survey" : changed ? `Condition changed to ${CONDITION_LABEL[condition]}` : "Field survey",
      detail:
        `Condition recorded as ${CONDITION_LABEL[condition]}. ${CONDITION_NOTE[condition]}` +
        (changed ? ` Previously ${CONDITION_LABEL[previous]}.` : ""),
    });
  }
  return entries;
}

function monthFallback(monthsBack: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsBack);
  date.setDate(15);
  return date;
}
