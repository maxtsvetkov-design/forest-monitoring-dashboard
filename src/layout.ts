/**
 * Reserved vertical chrome above and below the Maps/Story/Areas content area.
 * All three sit under the same sticky header (App.tsx) and wrap their own
 * content in the same `mt-[10px]` / outer `pb-6`, so one number serves all
 * three instead of three independently-drifting copies of it (AreasView used
 * to carry this literal three times over, for its map pane, its divider, and
 * its table pane, which all have to agree exactly or the split-pane divider
 * stops lining up with the panes on either side of it).
 *
 * The arithmetic, so a header change has one place to fix rather than three
 * silently-stale guesses:
 *   Above the content: pt-2 (8px) + the sticky header's own min-h-[56px]
 *   spacer + pb-1 (4px) — the header's flow height — plus each view's own
 *   mt-[10px] = 78px.
 *   Below the content: each view's own outer pb-6 = 24px.
 *   Total: 102px.
 *
 * The header's timeline/calendar row contributes NOTHING to this: it is
 * unconditionally `hidden` (display:none — see App.tsx), so it has no flow
 * height, and with only one visible flow child left in the header there's no
 * `gap` being spent reaching it either. This constant used to assume that row
 * was ~72px tall and reserved 150px for it; once it was hidden, every view
 * using the old 150px was reserving space nothing was left standing in,
 * showing up as a dead gray gap at the bottom of the viewport. If that row
 * is ever un-hidden again, this number needs to grow by however tall it
 * renders.
 */
const CONTENT_CHROME_PX = 102;

/**
 * `h-[calc(100vh - 102px)]` as a literal string rather than one built from
 * the constant above via a template: Tailwind's class scanner reads raw
 * source text at build time, so a computed class name is invisible to it and
 * the utility never gets generated. Keeping this string literal (verified
 * against `CONTENT_CHROME_PX` by eye, not by interpolation) is what makes it
 * discoverable.
 */
export const CONTENT_HEIGHT_CLASS = "h-[calc(100vh_-_102px)]";

// Fails loudly in dev if the two ever drift apart, since nothing else checks it.
if (import.meta.env.DEV && !CONTENT_HEIGHT_CLASS.includes(String(CONTENT_CHROME_PX))) {
  throw new Error("layout.ts: CONTENT_HEIGHT_CLASS no longer matches CONTENT_CHROME_PX");
}
