import { areas } from "./data/areas";

/**
 * Shareable URLs for the workspace.
 *
 * **Hash-based, deliberately.** This app deploys to a GitHub Pages *project*
 * page (`/forest-monitoring-dashboard/`) — a static file server with no
 * rewrite rule. A real path like `/al-maha/story` would 404 on a cold load,
 * because the server goes looking for a file at that path and there isn't
 * one. Everything after `#` never reaches the server at all, so a hash route
 * survives being pasted into a fresh tab — which is the entire point of
 * having one. (The same reason `publicUrl.ts` exists: this deployment's
 * subpath is a real constraint, not an afterthought.)
 *
 * This is NOT a router, and adding one is not the intent. `App.tsx` still
 * owns navigation as plain state (see docs/ARCHITECTURE.md §1). This module
 * only translates that state to and from a string, in both directions.
 *
 *   #/                          the landing screen — the app's own "/"
 *   #/al-maha/story             a site's Story tab
 *   #/al-maha/story/summary     that story, opened on one block
 *   #/abu-al-abyad/maps         any other tab
 */

export interface AppRoute {
  /** `null` means the landing screen, which sits outside the workspace
   *  entirely (it is an early return in App, not a tab). */
  areaId: string | null;
  /** An `App.tsx` tab label — "Recent events", not "events". The slug
   *  translation happens here so nothing else has to know about it. */
  tab: string;
  /** Only meaningful on the Story tab: which block the panel is on. Absent
   *  rather than defaulted, so "the story" and "the story at its first
   *  block" stay distinguishable — only the second should push a reader
   *  somewhere they didn't ask to be. */
  blockId?: string;
}

/** Tab label → URL slug. Labels carry spaces and capitals ("Recent events");
 *  URLs shouldn't. Kept as one table so the two directions can't drift. */
const TAB_SLUG: Record<string, string> = {
  Insights: "insights",
  "Recent events": "events",
  Assets: "assets",
  Maps: "maps",
  Areas: "areas",
  Story: "story",
};

const SLUG_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_SLUG).map(([label, slug]) => [slug, label]),
);

/** The tab a URL naming an area but no tab lands on. Story, because a bare
 *  site link is nearly always someone sharing the narrative — the one view
 *  here that reads as a document rather than a tool. */
const DEFAULT_TAB = "Story";

export const LANDING_ROUTE: AppRoute = { areaId: null, tab: DEFAULT_TAB };

/**
 * Reads a route out of a `window.location.hash` string.
 *
 * Every unknown value falls back rather than throwing: a URL is user input,
 * and a stale link from an older build (a renamed tab, a site that no longer
 * exists) should land the reader *somewhere* real instead of on a blank
 * screen. An unknown area is the one case that falls all the way back to the
 * landing screen — there is no sensible way to show "the Story of a site
 * that isn't here."
 */
export function parseHash(hash: string): AppRoute {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return LANDING_ROUTE;

  const [areaSlug, tabSlug, blockId] = parts;
  const area = areas.find((a) => a.id === areaSlug);
  if (!area) return LANDING_ROUTE;

  const tab = (tabSlug && SLUG_TAB[tabSlug]) || DEFAULT_TAB;
  return {
    areaId: area.id,
    tab,
    // A block only means anything on the Story tab; carrying one on any
    // other tab would be state nothing reads, silently surviving tab
    // switches and reappearing on the next visit to Story.
    blockId: tab === "Story" ? blockId : undefined,
  };
}

/** The inverse — always produces a string `parseHash` reads back identically. */
export function formatRoute(route: AppRoute): string {
  if (!route.areaId) return "#/";
  const slug = TAB_SLUG[route.tab] ?? TAB_SLUG[DEFAULT_TAB];
  const tail = route.tab === "Story" && route.blockId ? `/${route.blockId}` : "";
  return `#/${route.areaId}/${slug}${tail}`;
}

/**
 * Whether two routes are the same *page* — the same area and tab, ignoring
 * which story block is open.
 *
 * This is what decides `pushState` vs `replaceState`. Stepping through a
 * 23-block story would otherwise stack 23 history entries, turning the
 * browser's Back button into "go back one paragraph" — and burying whatever
 * the reader was actually doing before they opened the story.
 */
export function isSamePage(a: AppRoute, b: AppRoute): boolean {
  return a.areaId === b.areaId && a.tab === b.tab;
}
