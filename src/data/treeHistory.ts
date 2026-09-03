import { seededRandom } from "./random";
import type { TreeRecord } from "./trees";

export interface TreeHistoryEntry {
  date: Date;
  label: string;
  detail: string;
}

const HEALTH_ORDER: TreeRecord["health"][] = ["Healthy", "Stressed", "Declining", "Dead"];

const HEALTH_NOTE: Record<TreeRecord["health"], string> = {
  Healthy: "Canopy full, no visible stress.",
  Stressed: "Early leaf discolouration noted.",
  Declining: "Significant crown thinning observed.",
  Dead: "No live canopy remaining.",
};

/**
 * Synthesizes a plausible prior-survey timeline for one tree, ending exactly
 * at its actual recorded health — there is no real longitudinal record behind
 * a mock tree, so this fabricates one deterministically rather than leaving
 * the tree modal's history section empty. Seeded by the tree's own id, so
 * reopening the same tree always shows the same timeline instead of
 * reshuffling on every click.
 *
 * The walk moves backward from the current health toward "Healthy" one rank
 * at a time, so a "Dead" tree reads as a decline over several visits rather
 * than a single unexplained jump.
 */
export function generateTreeHistory(tree: TreeRecord, surveyCount = 4): TreeHistoryEntry[] {
  const rand = seededRandom(`history:${tree.id}`);
  const targetRank = HEALTH_ORDER.indexOf(tree.health);

  let rank = targetRank;
  const ranks: number[] = [rank];
  for (let i = 1; i < surveyCount; i++) {
    if (rank > 0 && rand() < 0.7) rank -= 1;
    ranks.push(rank);
  }
  ranks.reverse(); // oldest first

  // Surveys land roughly monthly, spaced back from today.
  return ranks.map((r, i) => {
    const monthsBack = surveyCount - 1 - i;
    const date = new Date();
    date.setMonth(date.getMonth() - monthsBack);
    date.setDate(1 + Math.floor(rand() * 26));
    const health = HEALTH_ORDER[r];
    return {
      date,
      label: i === surveyCount - 1 ? "Most recent survey" : "Field survey",
      detail: `Condition recorded as ${health}. ${HEALTH_NOTE[health]}`,
    };
  });
}
