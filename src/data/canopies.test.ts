import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { areaOverlays, areaHectares, plotWidthMeters, pointInQuad } from "./overlays";
import { MAX_CROWN_RADIUS_M, treeRng, treeVariation, type Canopy } from "./canopies";

/**
 * The 3D canopy layer's risky part is not the rendering — it is the chain of
 * coordinate conversions that has to put a tree on the crown it was traced
 * from. That chain runs image space → lng/lat → local metres, and every link is
 * pure arithmetic, so it is all testable without a GL context.
 *
 * The crown table is read straight off disk rather than fetched, since these
 * assertions are about the numbers in it, not about how the browser gets them.
 */
const table = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/overlays/al-maha-canopies.json"), "utf8"),
) as { viewBox: [number, number]; count: number; canopies: Canopy[] };

const coordinates = areaOverlays["al-maha"].coordinates;
const WIDTH_M = plotWidthMeters("al-maha");

/** Great-circle-free metre distance — fine at plot scale, and independent of
 * the Mercator maths under test. */
function metresBetween(a: [number, number], b: [number, number]): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(midLat);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

describe("crown table", () => {
  it("was extracted and is non-trivial", () => {
    expect(table.count).toBeGreaterThan(2000);
    expect(table.canopies).toHaveLength(table.count);
    expect(table.viewBox).toEqual([2754, 1537]);
  });

  it("keeps every crown inside the overlay image", () => {
    for (const c of table.canopies) {
      expect(c.u).toBeGreaterThanOrEqual(0);
      expect(c.u).toBeLessThanOrEqual(1);
      expect(c.v).toBeGreaterThanOrEqual(0);
      expect(c.v).toBeLessThanOrEqual(1);
      expect(c.r).toBeGreaterThan(0);
    }
  });

  it("produces plausible real-world crown sizes over the plot footprint", () => {
    const radii = table.canopies.map((c) => c.r * WIDTH_M).sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)];
    // A 1500m-wide plot: a median crown of a couple of metres is a young
    // planting, which is what this dataset describes. If this ever reads as
    // tens of metres, the normalisation lost its denominator somewhere.
    expect(median).toBeGreaterThan(1);
    expect(median).toBeLessThan(6);
  });
});

describe("image space → ground", () => {
  it("lands the plot's crowns inside the overlay footprint", () => {
    const lngs = coordinates.map((c) => c[0]);
    const lats = coordinates.map((c) => c[1]);
    const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
    const [south, north] = [Math.min(...lats), Math.max(...lats)];

    for (const c of table.canopies) {
      const [lng, lat] = pointInQuad(coordinates, c.u, c.v);
      expect(lng).toBeGreaterThanOrEqual(west);
      expect(lng).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
  });

  it("spans the footprint's declared width from edge to edge", () => {
    // The whole conversion rests on `plotWidthMeters` describing the same box
    // `boxAround` built, so assert the two agree to within a metre.
    const left = pointInQuad(coordinates, 0, 0.5);
    const right = pointInQuad(coordinates, 1, 0.5);
    expect(metresBetween(left, right)).toBeCloseTo(WIDTH_M, 0);
  });

  it("keeps the hectare figure consistent with that same box", () => {
    const top = pointInQuad(coordinates, 0.5, 0);
    const bottom = pointInQuad(coordinates, 0.5, 1);
    const heightM = metresBetween(top, bottom);
    expect(Math.round((WIDTH_M * heightM) / 10_000)).toBe(areaHectares("al-maha"));
  });

  it("maps u/v monotonically, so trees cannot land mirrored onto the art", () => {
    // v runs top→bottom in image space; latitude must therefore *decrease*.
    const topLat = pointInQuad(coordinates, 0.5, 0)[1];
    const bottomLat = pointInQuad(coordinates, 0.5, 1)[1];
    expect(topLat).toBeGreaterThan(bottomLat);

    const leftLng = pointInQuad(coordinates, 0, 0.5)[0];
    const rightLng = pointInQuad(coordinates, 1, 0.5)[0];
    expect(rightLng).toBeGreaterThan(leftLng);
  });
});

describe("treeRng", () => {
  it("is deterministic per crown, so the forest does not reshuffle on reload", () => {
    const first = [treeRng(42)(), treeRng(42)(), treeRng(42)()];
    expect(new Set(first).size).toBe(1);
  });

  it("gives neighbouring crowns different draws", () => {
    expect(treeRng(0)()).not.toBe(treeRng(1)());
  });
});

describe("treeVariation", () => {
  const samples = table.canopies.slice(0, 400).map((c, i) => {
    const radiusM = Math.min(c.r * WIDTH_M, MAX_CROWN_RADIUS_M);
    return { radiusM, variation: treeVariation(radiusM, treeRng(i)) };
  });

  it("returns usable proportions for every crown in the plot", () => {
    for (const { variation } of samples) {
      expect(variation.heightM).toBeGreaterThan(0);
      expect(Number.isFinite(variation.heightM)).toBe(true);
      expect(variation.trunkRatio).toBeGreaterThan(0);
      expect(variation.trunkRatio).toBeLessThan(1);
      expect(variation.tint).toBeGreaterThanOrEqual(0);
      expect(variation.tint).toBeLessThanOrEqual(1);
    }
  });

  it("makes bigger crowns carry taller trees", () => {
    // Not per-pair — random spread is the point — but the trend has to hold,
    // or "bigger circle, bigger tree" is not what the map shows.
    const sorted = [...samples].sort((a, b) => a.radiusM - b.radiusM);
    const smallest = sorted.slice(0, 50);
    const largest = sorted.slice(-50);
    const mean = (xs: typeof samples) => xs.reduce((s, x) => s + x.variation.heightM, 0) / xs.length;
    expect(mean(largest)).toBeGreaterThan(mean(smallest) * 1.5);
  });

  it("keeps trees within a believable height range for the plot", () => {
    const heights = samples.map((s) => s.variation.heightM);
    expect(Math.min(...heights)).toBeGreaterThan(0.5);
    expect(Math.max(...heights)).toBeLessThan(40);
  });
});
