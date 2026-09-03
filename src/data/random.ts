/**
 * Deterministic PRNG (mulberry32) shared by the mock-data generators.
 *
 * Mock data must be reproducible: pins stand for specific surveyed trees and
 * the monthly snapshots back a trend the user reads off the timeline, so a
 * fresh `Math.random()` draw on every render or reload would make positions
 * jump and the trend wobble. Seeding by a stable string (an area id, say) keeps
 * each area's data distinct but fixed.
 */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Draws one key from `weights` with probability proportional to its value. */
export function pickWeighted<K extends string>(rand: () => number, weights: Record<K, number>): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0) || 1;
  let r = rand() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}
