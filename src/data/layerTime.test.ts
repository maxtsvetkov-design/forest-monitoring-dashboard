import { describe, expect, it } from "vitest";
import { areas } from "./areas";
import { layerCoverage, PLANNED_TAIL_MONTHS } from "./layerTime";

const alMaha = areas.find((a) => a.id === "al-maha")!;
const MONTHS = alMaha.snapshots.length; // 12

describe("layerCoverage", () => {
  it("marks every month captured for a dense layer", () => {
    const canopy = layerCoverage("canopy", alMaha);
    expect(canopy.capturedCount).toBe(MONTHS);
    expect(canopy.gapCount).toBe(0);
  });

  it("spreads aerial captures into buckets, leaving gaps between them", () => {
    // 5 timelapse images over 12 months: one capture at the start of each bucket.
    const aerial = layerCoverage("aerial", alMaha);
    expect(aerial.capturedCount).toBe(5);
    expect(aerial.gapCount).toBe(MONTHS - 5);
    expect(aerial.kinds[0]).toBe("captured");
  });

  it("gives the generative layer the same coverage as aerial", () => {
    expect(layerCoverage("generative", alMaha).kinds).toEqual(layerCoverage("aerial", alMaha).kinds);
  });

  it("covers only the trailing window for dying trees", () => {
    // areaDyingTreeSequence has 3 frames -> the final 3 months only.
    const dying = layerCoverage("dyingTrees", alMaha);
    expect(dying.capturedCount).toBe(3);
    expect(dying.kinds[MONTHS - 1]).toBe("captured");
    expect(dying.kinds[MONTHS - 3]).toBe("captured");
    expect(dying.kinds[MONTHS - 4]).toBe("gap");
    expect(dying.kinds[0]).toBe("gap");
  });

  it("appends a planned tail of the same length to every layer", () => {
    for (const id of ["aerial", "canopy", "pins", "generative", "dyingTrees"] as const) {
      const coverage = layerCoverage(id, alMaha);
      expect(coverage.plannedCount).toBe(PLANNED_TAIL_MONTHS);
      expect(coverage.kinds).toHaveLength(MONTHS + PLANNED_TAIL_MONTHS);
      expect(coverage.kinds.at(-1)).toBe("planned");
    }
  });

  it("resolves a gap back to the preceding capture", () => {
    const dying = layerCoverage("dyingTrees", alMaha);
    // Month 0 is a gap and nothing precedes it.
    expect(dying.resolve(0)).toBe(-1);
    // The last month is itself a capture.
    expect(dying.resolve(MONTHS - 1)).toBe(MONTHS - 1);
    // A month just before the window start still has nothing behind it.
    expect(dying.resolve(MONTHS - 4)).toBe(-1);
    expect(dying.resolve(MONTHS - 2)).toBe(MONTHS - 2);
  });

  it("reports no captures for an area with no imagery", () => {
    const empty = { ...alMaha, id: "does-not-exist" };
    const aerial = layerCoverage("aerial", empty);
    expect(aerial.capturedCount).toBe(0);
    expect(aerial.gapCount).toBe(MONTHS);
  });
});
