/**
 * The arithmetic behind dissolving one full-frame raster into another.
 *
 * Pulled out of MapCanvas because it is neither about MapLibre nor about React
 * — it is a statement about how two stacked translucent images compose — and
 * because being pure is what lets it be proved rather than eyeballed. The map's
 * own animation is unmeasurable by screenshot: a breathing glow layer changes
 * the picture every frame regardless of what the rasters are doing, so a
 * frame-to-frame diff cannot see the dissolve at all. A test can.
 */

/**
 * Smootherstep — zero velocity AND zero acceleration at both ends.
 *
 * The vanishing second derivative is the point: there is no moment where the
 * dissolve visibly starts or visibly stops. Linear has a hard edge at both
 * ends, and even a cubic ease still enters with a detectable kick.
 */
export function smootherstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * How opaque the layer UNDERNEATH must be to hold a stacked pair's combined
 * coverage exactly constant while the top one fades up.
 *
 * This is the whole reason the map's swap needed rewriting. Two rasters of the
 * same footprint compose as `top + under·(1 − top)`, so fading one down as the
 * other comes up — the obvious crossfade, and what the map used to do — dips in
 * the middle: at the halfway point of a full-strength swap the pair covers 0.75
 * instead of 1, and a quarter of the basemap flashes through the plot. Solving
 * that composition for `under` gives this.
 *
 * At `target` 1 it returns 1 throughout, so the under layer simply stays put
 * and is revealed to be redundant at the end. That is the correct answer rather
 * than a special case, which is why there is no branch for it.
 */
export function underlayOpacity(target: number, top: number): number {
  if (top >= 1) return 0;
  const under = (target - top) / (1 - top);
  return under < 0 ? 0 : under > target ? target : under;
}

/**
 * What the pair actually covers — the composition above, written out.
 *
 * Exported for the test rather than used by the map, because the property
 * worth asserting is "these two functions agree with the compositing rule",
 * and stating the rule in the test file instead would let it drift into
 * agreeing with a private copy of itself.
 */
export function composedCoverage(top: number, under: number): number {
  return top + under * (1 - top);
}
