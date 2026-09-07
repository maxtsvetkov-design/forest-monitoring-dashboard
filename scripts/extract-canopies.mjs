/**
 * Extracts one record per tree canopy from the generative-art SVG.
 *
 * `public/overlays/al-maha-generative.svg` is an Illustrator export: a *single*
 * `<path>` whose `d` holds ~2400 closed subpaths, one traced around each tree
 * crown in the drone capture. No transforms, no groups — the coordinates are
 * already in the 2754×1537 viewBox, which is exactly the raster's pixel space,
 * which `overlays.ts` georeferences via `pointInQuad(coords, u, v)`.
 *
 * So the crowns can be recovered as vectors rather than reconstructed with
 * connected-component analysis on the PNG. For each subpath this writes its
 * centroid in normalised u/v (0..1 across the image) and a radius, also
 * normalised to image width — everything downstream needs to place a 3D tree.
 *
 * Run:  node scripts/extract-canopies.mjs
 * Out:  public/overlays/al-maha-canopies.json
 *
 * Regenerate whenever the SVG is redrawn. The output is committed so the app
 * never has to parse 300KB of path data at runtime.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(here, "../public/overlays/al-maha-generative.svg");
const OUT_PATH = resolve(here, "../public/overlays/al-maha-canopies.json");

// Curves are sampled rather than solved: we only need a centroid and a radius,
// so four points along each bezier segment approximates the outline far more
// cheaply than a real flattener, and well within a pixel at these sizes.
const CURVE_SAMPLES = [0.25, 0.5, 0.75, 1];

/** Splits an SVG `d` string into command letters and their numeric arguments.
 * Illustrator packs numbers hard — `.5-1.2` is two of them, `1e-4` is one —
 * so the number pattern has to handle a leading `.`, a sign acting as a
 * separator, and exponents. */
function tokenize(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push({ cmd: m[1] });
    else out.push({ num: parseFloat(m[2]) });
  }
  return out;
}

function sampleCubic(p0, p1, p2, p3, push) {
  for (const t of CURVE_SAMPLES) {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const e = t * t * t;
    push(a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]);
  }
}

function sampleQuad(p0, p1, p2, push) {
  for (const t of CURVE_SAMPLES) {
    const u = 1 - t;
    push(u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]);
  }
}

/**
 * Walks the whole `d` and returns one point array per subpath. A subpath ends
 * where the next `M`/`m` begins — that is the only boundary Illustrator gives
 * us, and it is reliable here because every crown is drawn as its own closed
 * loop.
 */
function subpaths(d) {
  const tokens = tokenize(d);
  const paths = [];
  let current = null;
  let x = 0;
  let y = 0;
  // Subpath start, for Z; and the previous curve's control point, for S/T.
  let startX = 0;
  let startY = 0;
  let lastC = null;
  let lastQ = null;
  let cmd = null;
  let i = 0;

  const push = (px, py) => {
    x = px;
    y = py;
    if (current) current.push(px, py);
  };

  const nums = (n) => {
    const a = [];
    for (let k = 0; k < n; k++) a.push(tokens[i++].num);
    return a;
  };

  while (i < tokens.length) {
    if (tokens[i].cmd) {
      cmd = tokens[i].cmd;
      i++;
      if (cmd === "M" || cmd === "m") {
        // A new subpath begins. Flush the previous one.
        if (current && current.length >= 6) paths.push(current);
        current = [];
        const [dx, dy] = nums(2);
        x = cmd === "M" ? dx : x + dx;
        y = cmd === "M" ? dy : y + dy;
        startX = x;
        startY = y;
        current.push(x, y);
        // Per spec, further coordinate pairs after an M are implicit L's.
        cmd = cmd === "M" ? "L" : "l";
        lastC = lastQ = null;
        continue;
      }
      if (cmd === "Z" || cmd === "z") {
        x = startX;
        y = startY;
        lastC = lastQ = null;
        continue;
      }
    }
    // Implicit repeat: a number where a command letter could be means "run the
    // previous command again", which is most of this file.
    if (tokens[i] === undefined || tokens[i].cmd) continue;

    switch (cmd) {
      case "L": {
        const [px, py] = nums(2);
        push(px, py);
        lastC = lastQ = null;
        break;
      }
      case "l": {
        const [dx, dy] = nums(2);
        push(x + dx, y + dy);
        lastC = lastQ = null;
        break;
      }
      case "H": push(nums(1)[0], y), (lastC = lastQ = null); break;
      case "h": push(x + nums(1)[0], y), (lastC = lastQ = null); break;
      case "V": push(x, nums(1)[0]), (lastC = lastQ = null); break;
      case "v": push(x, y + nums(1)[0]), (lastC = lastQ = null); break;
      case "C":
      case "c": {
        const v = nums(6);
        const rel = cmd === "c";
        const c1 = [rel ? x + v[0] : v[0], rel ? y + v[1] : v[1]];
        const c2 = [rel ? x + v[2] : v[2], rel ? y + v[3] : v[3]];
        const p = [rel ? x + v[4] : v[4], rel ? y + v[5] : v[5]];
        sampleCubic([x, y], c1, c2, p, push);
        lastC = c2;
        lastQ = null;
        break;
      }
      case "S":
      case "s": {
        const v = nums(4);
        const rel = cmd === "s";
        // Reflect the previous cubic's second control point through the current
        // point; with no previous cubic the control point *is* the current point.
        const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const c2 = [rel ? x + v[0] : v[0], rel ? y + v[1] : v[1]];
        const p = [rel ? x + v[2] : v[2], rel ? y + v[3] : v[3]];
        sampleCubic([x, y], c1, c2, p, push);
        lastC = c2;
        lastQ = null;
        break;
      }
      case "Q":
      case "q": {
        const v = nums(4);
        const rel = cmd === "q";
        const c = [rel ? x + v[0] : v[0], rel ? y + v[1] : v[1]];
        const p = [rel ? x + v[2] : v[2], rel ? y + v[3] : v[3]];
        sampleQuad([x, y], c, p, push);
        lastQ = c;
        lastC = null;
        break;
      }
      case "T":
      case "t": {
        const v = nums(2);
        const rel = cmd === "t";
        const c = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const p = [rel ? x + v[0] : v[0], rel ? y + v[1] : v[1]];
        sampleQuad([x, y], c, p, push);
        lastQ = c;
        lastC = null;
        break;
      }
      case "A":
      case "a": {
        // Arc endpoints only — no crown in this file uses arcs, but skipping
        // the parameters correctly keeps a stray one from desyncing the stream.
        const v = nums(7);
        const rel = cmd === "a";
        push(rel ? x + v[5] : v[5], rel ? y + v[6] : v[6]);
        lastC = lastQ = null;
        break;
      }
      default:
        i++;
    }
  }
  if (current && current.length >= 6) paths.push(current);
  return paths;
}

/** Shoelace area (absolute) and the area-weighted centroid of a closed polygon.
 * Falls back to the vertex mean for degenerate (zero-area) loops. */
function polygonStats(pts) {
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const n = pts.length / 2;
  for (let k = 0; k < n; k++) {
    const x0 = pts[k * 2];
    const y0 = pts[k * 2 + 1];
    const j = (k + 1) % n;
    const x1 = pts[j * 2];
    const y1 = pts[j * 2 + 1];
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
    if (x0 < minX) minX = x0;
    if (x0 > maxX) maxX = x0;
    if (y0 < minY) minY = y0;
    if (y0 > maxY) maxY = y0;
  }
  const area = Math.abs(area2) / 2;
  if (area < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < n; k++) {
      sx += pts[k * 2];
      sy += pts[k * 2 + 1];
    }
    return { area, cx: sx / n, cy: sy / n, minX, minY, maxX, maxY };
  }
  return { area, cx: cx / (3 * area2), cy: cy / (3 * area2), minX, minY, maxX, maxY };
}

const svg = readFileSync(SVG_PATH, "utf8");
const viewBox = /viewBox="([\d.\s-]+)"/.exec(svg);
const [, , vbW, vbH] = viewBox[1].trim().split(/\s+/).map(Number);

const dAttrs = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
const loops = dAttrs.flatMap((d) => subpaths(d));

const raw = loops.map((pts) => {
  const s = polygonStats(pts);
  // Equivalent-circle radius: the radius a circle of the same area would have.
  // Steadier than half the bbox diagonal, which a single spiky lobe inflates —
  // and these crowns are deliberately drawn ragged.
  const r = Math.sqrt(s.area / Math.PI);
  return { cx: s.cx, cy: s.cy, r, area: s.area, w: s.maxX - s.minX, h: s.maxY - s.minY };
});

// Drop specks and any accidental frame-sized loop. The lower bound is in image
// pixels: below ~1.5px radius there is nothing a 3D tree could usefully stand
// for, and those entries are mostly stipple dots in the artwork.
const MIN_R = 1.5;
const MAX_R = Math.min(vbW, vbH) / 8;
const kept = raw.filter((c) => c.r >= MIN_R && c.r <= MAX_R);

const radii = kept.map((c) => c.r).sort((a, b) => a - b);
const pct = (p) => radii[Math.floor(radii.length * p)];

const canopies = kept.map((c) => ({
  // Normalised image space: u left→right, v top→bottom — the exact convention
  // `pointInQuad` in src/data/overlays.ts consumes.
  u: +(c.cx / vbW).toFixed(5),
  v: +(c.cy / vbH).toFixed(5),
  // Radius as a fraction of image *width*, so it stays isotropic on the ground
  // (the overlay quad preserves the image's aspect ratio).
  r: +(c.r / vbW).toFixed(6),
}));

writeFileSync(
  OUT_PATH,
  JSON.stringify({
    source: "al-maha-generative.svg",
    viewBox: [vbW, vbH],
    count: canopies.length,
    canopies,
  }),
);

console.log(`subpaths parsed : ${raw.length}`);
console.log(`kept            : ${kept.length}  (r ${MIN_R}–${MAX_R.toFixed(0)}px)`);
console.log(`radius px  min  : ${radii[0].toFixed(2)}`);
console.log(`           p25  : ${pct(0.25).toFixed(2)}`);
console.log(`           p50  : ${pct(0.5).toFixed(2)}`);
console.log(`           p75  : ${pct(0.75).toFixed(2)}`);
console.log(`           p95  : ${pct(0.95).toFixed(2)}`);
console.log(`           max  : ${radii[radii.length - 1].toFixed(2)}`);
console.log(`wrote ${OUT_PATH}`);
