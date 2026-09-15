import { describe, expect, it } from "vitest";
import { areas } from "./data/areas";
import { formatRoute, isSamePage, LANDING_ROUTE, parseHash, type AppRoute } from "./routes";

const AREA = areas[0].id;

describe("parseHash", () => {
  it("reads an empty or root hash as the landing screen", () => {
    expect(parseHash("")).toEqual(LANDING_ROUTE);
    expect(parseHash("#")).toEqual(LANDING_ROUTE);
    expect(parseHash("#/")).toEqual(LANDING_ROUTE);
  });

  it("reads an area and tab", () => {
    expect(parseHash(`#/${AREA}/maps`)).toEqual({ areaId: AREA, tab: "Maps", blockId: undefined });
  });

  it("translates the one slug that isn't its own label", () => {
    expect(parseHash(`#/${AREA}/events`).tab).toBe("Recent events");
  });

  it("reads a story block", () => {
    expect(parseHash(`#/${AREA}/story/summary`)).toEqual({ areaId: AREA, tab: "Story", blockId: "summary" });
  });

  // A link is user input and can outlive the build that produced it.
  it("falls back to the landing screen for an area that no longer exists", () => {
    expect(parseHash("#/not-a-site/story")).toEqual(LANDING_ROUTE);
  });

  it("falls back to the default tab for a tab that no longer exists", () => {
    expect(parseHash(`#/${AREA}/gone`).tab).toBe("Story");
  });

  it("drops a block id on tabs that have no blocks", () => {
    expect(parseHash(`#/${AREA}/maps/summary`).blockId).toBeUndefined();
  });
});

describe("formatRoute", () => {
  it("writes the landing screen as the app's own root", () => {
    expect(formatRoute(LANDING_ROUTE)).toBe("#/");
    expect(formatRoute({ areaId: null, tab: "Maps" })).toBe("#/");
  });

  it("omits the block segment when there is no block", () => {
    expect(formatRoute({ areaId: AREA, tab: "Story" })).toBe(`#/${AREA}/story`);
  });

  it("omits a block id on tabs that have no blocks", () => {
    expect(formatRoute({ areaId: AREA, tab: "Maps", blockId: "summary" })).toBe(`#/${AREA}/maps`);
  });
});

describe("round trip", () => {
  // The two directions are only useful if they agree — a URL the app writes
  // has to be one it can read back into the same state, or sharing a link
  // silently lands the recipient somewhere else.
  const cases: AppRoute[] = [
    LANDING_ROUTE,
    { areaId: AREA, tab: "Story", blockId: undefined },
    { areaId: AREA, tab: "Story", blockId: "habitat-land-cover" },
    { areaId: AREA, tab: "Recent events", blockId: undefined },
    { areaId: areas[1].id, tab: "Assets", blockId: undefined },
  ];
  for (const route of cases) {
    it(`survives ${formatRoute(route)}`, () => {
      expect(parseHash(formatRoute(route))).toEqual(route);
    });
  }
});

describe("isSamePage", () => {
  it("ignores the block, so stepping through a story doesn't stack history", () => {
    const a: AppRoute = { areaId: AREA, tab: "Story", blockId: "summary" };
    const b: AppRoute = { areaId: AREA, tab: "Story", blockId: "metrics" };
    expect(isSamePage(a, b)).toBe(true);
  });

  it("separates tabs and areas, which should stack", () => {
    expect(isSamePage({ areaId: AREA, tab: "Story" }, { areaId: AREA, tab: "Maps" })).toBe(false);
    expect(isSamePage({ areaId: AREA, tab: "Story" }, { areaId: areas[1].id, tab: "Story" })).toBe(false);
    expect(isSamePage(LANDING_ROUTE, { areaId: AREA, tab: "Story" })).toBe(false);
  });
});
