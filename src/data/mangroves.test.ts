import { describe, expect, it } from "vitest";
import { areaOverlays, isInsideQuad } from "./overlays";
import { generateMangroves, hasMangroveForest, MANGROVE_COUNT } from "./mangroves";
import { CONDITION_KEYS } from "./taxonomy";

const coordinates = areaOverlays["mangroves"].coordinates;

function metresBetween(a: [number, number], b: [number, number]): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(midLat);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

describe("mangrove stand", () => {
  const trees = generateMangroves(coordinates);

  it("has exactly the requested number of trees", () => {
    expect(MANGROVE_COUNT).toBe(600);
    expect(trees).toHaveLength(MANGROVE_COUNT);
  });

  it("is deterministic, so the stand never reshuffles between reloads", () => {
    expect(generateMangroves(coordinates)).toEqual(trees);
  });

  it("gives every tree a unique id", () => {
    expect(new Set(trees.map((t) => t.id)).size).toBe(trees.length);
    expect(trees[0].id).toBe("MG-001");
    expect(trees[trees.length - 1].id).toBe("MG-600");
  });

  it("keeps every tree inside the plot footprint", () => {
    for (const t of trees) expect(isInsideQuad(coordinates, t.lng, t.lat)).toBe(true);
  });

  it("uses every health level, so the crown colours actually encode something", () => {
    const present = new Set(trees.map((t) => t.condition));
    for (const key of CONDITION_KEYS) expect(present.has(key)).toBe(true);
  });

  it("varies tree size across a believable grey-mangrove range", () => {
    const heights = trees.map((t) => t.heightM);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(1.5);
    expect(Math.min(...heights)).toBeLessThan(3);
    expect(Math.max(...heights)).toBeGreaterThan(6);
    expect(Math.max(...heights)).toBeLessThanOrEqual(8);
  });

  it("grows wider crowns on taller trees (a trend, not a per-pair rule)", () => {
    const n = trees.length;
    const mh = trees.reduce((s, t) => s + t.heightM, 0) / n;
    const mr = trees.reduce((s, t) => s + t.crownRadiusM, 0) / n;
    let cov = 0;
    let vh = 0;
    let vr = 0;
    for (const t of trees) {
      cov += (t.heightM - mh) * (t.crownRadiusM - mr);
      vh += (t.heightM - mh) ** 2;
      vr += (t.crownRadiusM - mr) ** 2;
    }
    expect(cov / Math.sqrt(vh * vr)).toBeGreaterThan(0.6);
  });

  it("never stands two trunks on top of each other", () => {
    let closest = Infinity;
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        closest = Math.min(closest, metresBetween([trees[i].lng, trees[i].lat], [trees[j].lng, trees[j].lat]));
      }
    }
    expect(closest).toBeGreaterThan(1);
  });
});

describe("hasMangroveForest", () => {
  it("is scoped to the Mangroves project only", () => {
    expect(hasMangroveForest("mangroves")).toBe(true);
    expect(hasMangroveForest("al-maha")).toBe(false);
    expect(hasMangroveForest("liwa-crop-monitor")).toBe(false);
    expect(hasMangroveForest(undefined)).toBe(false);
  });
});
