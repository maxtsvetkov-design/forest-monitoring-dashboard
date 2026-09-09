/**
 * Reads a delivered raster mask into the two things the stack view needs from
 * it: how much of the frame it paints, and where its separate patches are.
 *
 * Both are properties of the FILE, not of anything this app computes, so the
 * only honest way to report them is to look at the pixels. A table of constants
 * in the source would be a measurement the reader cannot check and that goes
 * quietly stale the moment a mask is replaced.
 *
 * One read, one cache, both answers: an earlier version of this module returned
 * only the total coverage, and adding regions as a second module would have
 * decoded the same 4 MP image twice.
 *
 * Returns `null` on any failure. A missing figure is recoverable in the UI; a
 * fabricated one is not.
 */

/**
 * Alpha above which a pixel counts as painted. Well below these masks' fill
 * alphas (0.27 and 0.45) and well above nothing, so it captures the fill
 * without the faintest antialiasing fringe deciding the total.
 */
const ALPHA_FLOOR = 8;

/**
 * Pixels to sample. A coverage *fraction* is unchanged by uniform
 * downsampling, and a patch centroid barely moves, so there is no reason to
 * walk all 4.2 MP. Scaling does blend the boundary, which nudges the painted
 * count outward by a ring one pixel wide — immaterial for a figure shown to
 * three significant digits where the fill is ~1% of the frame.
 */
const TARGET_PX = 400_000;

/**
 * Patches smaller than this (at sample resolution) are dropped.
 *
 * These masks are traced by hand and their edges leave single-pixel slivers
 * where the two boundaries almost coincide. Those are not places where ground
 * changed; they are the width of a pen. Keeping them would bury the dozen real
 * patches in a hundred specks.
 */
const MIN_REGION_PX = 14;

/**
 * Smallest patch worth calling a patch, in hectares of ground.
 *
 * `MIN_REGION_PX` above is a floor in sampled pixels, which is the wrong unit
 * once a caller knows how much ground the frame covers: the same speck is a
 * different amount of land on a 900 m plot and an 1800 m one. Roughly a few
 * mature crowns' worth — below that the "patch" is an artefact of two
 * hand-drawn boundaries not quite coinciding.
 *
 * Lives here rather than in whichever view filtered first, because more than
 * one surface now counts these patches and two different floors would report
 * two different patch counts for the same file.
 */
export const MIN_REGION_HA = 0.03;

export interface MaskRegion {
  id: string;
  /** Centroid in the image's normalised space — the same u/v the overlays and
   *  the tree population use, so a region can be compared with anything else
   *  pinned to this imagery. */
  u: number;
  v: number;
  /** Share of the whole frame this patch paints. */
  fraction: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export interface MaskAnalysis {
  /** Painted share of the whole frame, all patches together. */
  fraction: number;
  /** Patches, largest first. */
  regions: MaskRegion[];
  /**
   * Which patch covers a point in image space, or null if none does.
   *
   * Closed over the label map, which is why it is handed back rather than the
   * map itself: counting how many trees stand inside a patch needs a
   * point-in-patch test against the actual pixels, and a bounding box is far
   * too coarse for shapes this ragged. The retained buffer is one Int32 per
   * sampled pixel — about 1.6 MB per mask at TARGET_PX.
   */
  regionAt: (u: number, v: number) => string | null;
}

const cache = new Map<string, Promise<MaskAnalysis | null>>();

export function analyseMask(url: string): Promise<MaskAnalysis | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  const pending = read(url);
  cache.set(url, pending);
  return pending;
}

async function read(url: string): Promise<MaskAnalysis | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());

    const ratio = Math.min(1, Math.sqrt(TARGET_PX / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const { data } = ctx.getImageData(0, 0, width, height);
    const total = width * height;

    // 0 = unpainted, -1 = painted but unlabelled, >0 = patch number.
    const labels = new Int32Array(total);
    let painted = 0;
    for (let i = 0; i < total; i++) {
      if (data[i * 4 + 3] > ALPHA_FLOOR) {
        labels[i] = -1;
        painted++;
      }
    }

    // Flood fill each patch iteratively. A recursive fill overflows the stack
    // on a patch a few thousand pixels across, which these are.
    const stack = new Int32Array(total);
    const found: { label: number; count: number; sumX: number; sumY: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
    let label = 0;

    for (let seed = 0; seed < total; seed++) {
      if (labels[seed] !== -1) continue;
      label++;
      let top = 0;
      stack[top++] = seed;
      labels[seed] = label;
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;

      while (top > 0) {
        const at = stack[--top];
        const x = at % width;
        const y = (at - x) / width;
        count++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        // 4-connected: 8-connected would bridge patches that merely touch at a
        // corner, which for a traced boundary means merging two sides of a
        // pen stroke into one "patch".
        if (x > 0 && labels[at - 1] === -1) {
          labels[at - 1] = label;
          stack[top++] = at - 1;
        }
        if (x < width - 1 && labels[at + 1] === -1) {
          labels[at + 1] = label;
          stack[top++] = at + 1;
        }
        if (y > 0 && labels[at - width] === -1) {
          labels[at - width] = label;
          stack[top++] = at - width;
        }
        if (y < height - 1 && labels[at + width] === -1) {
          labels[at + width] = label;
          stack[top++] = at + width;
        }
      }

      found.push({ label, count, sumX, sumY, minX, maxX, minY, maxY });
    }

    const kept = found.filter((r) => r.count >= MIN_REGION_PX).sort((a, b) => b.count - a.count);
    const keptLabels = new Set(kept.map((r) => r.label));

    const regions: MaskRegion[] = kept.map((r) => ({
      id: `r${r.label}`,
      u: r.sumX / r.count / width,
      v: r.sumY / r.count / height,
      fraction: r.count / total,
      uMin: r.minX / width,
      uMax: (r.maxX + 1) / width,
      vMin: r.minY / height,
      vMax: (r.maxY + 1) / height,
    }));

    const regionAt = (u: number, v: number): string | null => {
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
      const x = Math.min(width - 1, Math.floor(u * width));
      const y = Math.min(height - 1, Math.floor(v * height));
      const at = labels[y * width + x];
      return at > 0 && keptLabels.has(at) ? `r${at}` : null;
    };

    return { fraction: painted / total, regions, regionAt };
  } catch {
    return null;
  }
}
