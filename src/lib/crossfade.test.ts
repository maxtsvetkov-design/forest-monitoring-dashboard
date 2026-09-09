import { describe, expect, it } from "vitest";
import { composedCoverage, smootherstep, underlayOpacity } from "./crossfade";

describe("smootherstep", () => {
  it("pins both ends", () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
  });

  it("clamps out-of-range input", () => {
    // Not defensive tidiness: requestAnimationFrame hands its callback the
    // timestamp of the frame it belongs to, which can predate the
    // performance.now() captured when the fade was scheduled. An unclamped
    // curve returns a negative here, MapLibre refuses a raster-opacity below
    // zero, and the whole map fails to load.
    expect(smootherstep(-0.0001)).toBe(0);
    expect(smootherstep(-5)).toBe(0);
    expect(smootherstep(1.2)).toBe(1);
  });

  it("never leaves 0..1 across its domain", () => {
    for (let i = -20; i <= 120; i++) {
      const v = smootherstep(i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is symmetric about the midpoint", () => {
    for (let i = 0; i <= 50; i++) {
      const t = i / 100;
      expect(smootherstep(t) + smootherstep(1 - t)).toBeCloseTo(1, 12);
    }
  });
});

describe("underlayOpacity", () => {
  it("holds the pair's combined coverage exactly constant", () => {
    // The property the map's dissolve depends on. Fading the under layer
    // linearly to zero instead — the obvious crossfade — dips to 0.75 at the
    // midpoint of a full-strength swap, and that dip is the basemap flashing
    // through the plot.
    for (const target of [1, 0.85, 0.5, 0.25, 0.05]) {
      for (let i = 0; i <= 100; i++) {
        const top = target * smootherstep(i / 100);
        const coverage = composedCoverage(top, underlayOpacity(target, top));
        expect(coverage).toBeCloseTo(target, 10);
      }
    }
  });

  it("shows the naive crossfade really does dip", () => {
    // Guards the reason this module exists: if someone replaces the
    // compensation with a straight fade-down, the test above fails and this
    // one says why it used to.
    const target = 1;
    const top = 0.5;
    const naiveUnder = target - top;
    expect(composedCoverage(top, naiveUnder)).toBeCloseTo(0.75, 10);
    expect(composedCoverage(top, underlayOpacity(target, top))).toBeCloseTo(1, 10);
  });

  it("stays within 0..target, so MapLibre never sees an illegal opacity", () => {
    for (const target of [1, 0.6, 0.2]) {
      for (let i = -10; i <= 110; i++) {
        const under = underlayOpacity(target, target * smootherstep(i / 100));
        expect(under).toBeGreaterThanOrEqual(0);
        expect(under).toBeLessThanOrEqual(target);
      }
    }
  });

  it("retires the under layer once the top one is solid", () => {
    expect(underlayOpacity(1, 1)).toBe(0);
    expect(underlayOpacity(0.4, 1)).toBe(0);
  });

  it("leaves a fully opaque underlay alone for the whole fade", () => {
    // At target 1 the under layer is never dimmed — it is simply covered. That
    // falls out of the formula rather than being a special case, and this is
    // what says so.
    for (let i = 0; i < 100; i++) expect(underlayOpacity(1, i / 100)).toBeCloseTo(1, 12);
  });
});
