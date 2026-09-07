# The 3D canopy layer

A low-poly tree stands inside every crown the generative artwork traces —
~2,300 of them, rendered by three.js *inside MapLibre's own WebGL context*, so
they hold their place on the imagery through pan, zoom, rotate, pitch and
terrain.

This is the one part of the app that reaches below MapLibre's declarative style
API, so it gets its own document.

---

## 1. Where the trees come from

Not from a model file, and not from the tree records in `data/trees.ts`. They
come from the artwork.

`public/overlays/al-maha-generative.svg` is an Illustrator export: **one**
`<path>` whose `d` holds 2,386 closed subpaths, each traced around a tree crown
in the drone capture. No transforms, no groups — the coordinates sit directly in
the `2754×1537` viewBox, which is the raster's own pixel space.

That matters, because the raster is already georeferenced. Recovering the
crowns as vectors is therefore *free* positioning data, and cost nothing but a
path parser:

```
scripts/extract-canopies.mjs
  ├── split `d` on every M/m          → 2386 subpaths
  ├── sample beziers at t = .25/.5/.75/1
  ├── shoelace area + area-weighted centroid
  ├── radius = √(area/π)              ← equivalent-circle, not bbox
  └── drop r < 1.5px (stipple) and r > min(w,h)/8 (stray frame)
                                      → 2297 crowns
```

Output: `public/overlays/al-maha-canopies.json`, `{ u, v, r }` per crown,
normalised — `u`/`v` across the image, `r` as a fraction of image **width**.

The file is committed. Regenerate it only if the SVG is redrawn:

```sh
node scripts/extract-canopies.mjs
```

**Why the equivalent-circle radius and not half the bounding box?** These crowns
are drawn deliberately ragged. A single spiky lobe inflates a bbox by half again
while barely touching the area, and the tree sizes would then track the artwork's
flourishes rather than its canopies.

**Why only Al Maha?** It is the only plot with a real capture. The other three
reuse that same artwork re-georeferenced to their own footprint (see
`areaOverlays`), so reusing its crowns is not a shortcut — it is the same picture
underneath, and the trees land on the canopies those areas already display.

## 2. Three coordinate spaces

Everything below is converted once, at layer-build time, in
`TreeCanopyLayer.placeTrees`.

| Space | Units | Produced by |
|---|---|---|
| **Image** | `u`,`v` ∈ [0,1]; `r` ÷ image width | the extractor |
| **Ground** | lng/lat | `pointInQuad(coordinates, u, v)` — `data/overlays.ts` |
| **Local** | metres; `+X` east, `+Y` up, `+Z` south | Mercator delta ÷ `meterInMercatorCoordinateUnits()` |

`pointInQuad` is the hinge. It bilinearly interpolates the overlay's four real
corners, so it stays correct for rotated or trapezoidal footprints, not just the
axis-aligned box `boxAround` currently produces — and it is the *same* function
the overlay itself is placed with, which is why the trees cannot drift off the
art.

Ground radius is simply `r × plotWidthMeters(areaId)`, clamped to
`MAX_CROWN_RADIUS_M`. A handful of loops in the artwork enclose a whole thicket;
past that clamp they are treated as a cluster rather than allowed to grow one
absurd trunk.

### Local → clip

MapLibre hands `render()` a `modelViewProjectionMatrix` that maps **Mercator**
space to clip space. The layer composes its own transform underneath it:

```
projection = mvp
           · translate(originMercator)
           · scale(s, −s, s)          // s = metres → Mercator at this latitude
           · rotateX(π/2)             // three's Y-up → the map's Z-up
```

The two sign-flips are the parts worth remembering:

- **`−s` on Y** because Mercator's Y grows *southward* and three's does not.
- **`rotateX(π/2)`** turns a Y-up scene into the map's Z-up world. Together they
  land three's `+Z` on *south*, which is why `field.z` is a straight copy of the
  Mercator Y delta with no negation — a place it is very easy to add one by
  reflex and mirror the whole forest.

## 3. Why a custom layer

A separate three.js canvas positioned over the map could only ever approximate
the camera. The moment the user tilts, trees slide off their crowns. MapLibre's
`CustomLayerInterface` hands the layer *its* GL context and *its* MVP matrix
mid-frame, so the scene is drawn by the map's camera into the map's depth
buffer, between the map's own layers.

Consequences that are easy to trip over:

- `renderer.autoClear = false` — MapLibre has already drawn the basemap into
  this framebuffer.
- `renderer.resetState()` before every render — both libraries cache GL state
  and neither knows about the other.
- The renderer is **never disposed** in `onRemove`. It wraps MapLibre's context;
  disposing would tear down state the map is still using.
- `frustumCulled = false` on every mesh. The projection matrix is not one three
  can reason about, so its own frustum test would cull the entire forest.
- `setViewport` each frame, because a resized container (the Areas split pane)
  changes the drawing buffer without telling three.
- `setStyle` discards custom layers along with everything else, so the effect
  that adds this one depends on `styleVersion` — see `MapCanvas`.

## 4. Why instancing

2,300 trees as individual meshes is 2,300 draw calls a frame and an
uninteractive map. As `InstancedMesh`es it is **four**: one trunk, three foliage
variants. Per-frame work collapses to writing matrices into a buffer.

Each tree is two instances that share a transform:

- **Trunk** — a unit cylinder with its base translated to `y = 0`, so a
  per-instance rotation pivots about the ground. That is what a lean *is*.
- **Crown** — a unit-radius blob, an `IcosahedronGeometry(1, 1)` whose vertices
  are displaced by a hash of their own rounded position (rounded, because the
  geometry is non-indexed: keying on vertex *index* moves each face's copy of a
  shared corner separately and tears the shape open).

The crown has to ride on top of the leaning trunk, so its matrix is
`T(ground) · R(lean) · T(0, crownCentre, 0) · S` — but an `Object3D` only offers
`T · R · S`. Folding `R · (0, crownCentre, 0)` into the translation makes the
two identical:

```ts
vec.set(0, crownCentre, 0).applyQuaternion(q);
dummy.position.set(x + vec.x, y + vec.y, z + vec.z);
```

Colour is per-tree but constant, so it goes into the instance-colour buffer once
at build rather than being rewritten every frame.

## 5. Variation

Per tree, seeded by its own index through `treeRng(i)` — deterministic, so the
forest does not reshuffle every time the layer is toggled, which reads as a
glitch rather than as life.

| Property | Source |
|---|---|
| height, trunk ratio, tint | `treeVariation(radiusM, rand)` — `data/canopies.ts` |
| foliage silhouette | one of three perturbed icosahedra |
| spin (Y rotation) | uniform 0–2π |
| sway phase | uniform 0–2π |
| grow-in delay | `u × 1400ms` + jitter — a west→east wavefront |

`treeVariation` is the single place the "bigger circle → bigger tree" rule
lives, and `src/data/canopies.test.ts` asserts the trend holds across the real
plot rather than per-pair (random spread is the point).

## 6. Motion

Two animations, both driven off `performance.now()` inside `render`:

- **Grow-in** — `easeOutBack` over 900ms, staggered so a wave sweeps across the
  plot. Trees before their turn get a zero-scale matrix parked far below the
  ground: `InstancedMesh` has no per-instance visibility flag.
- **Sway** — amplitude scales with height (`SWAY_RADIANS_AT_10M`), each tree on
  its own phase, on two axes at slightly different rates so the plot ripples
  rather than pulsing in unison.

`map.triggerRepaint()` is called only while something is moving. Without that
guard the map repaints forever, which on a laptop is an audible fan.

`prefers-reduced-motion` suppresses both, and with it the repaint loop — the
trees simply stand still. The layer reads the query once, at add time; see the
`reducedMotion` option.

## 6b. Shadows

Optional, three-way, on the `trees3d` chip: `off` / `contact` / `soft`
(`TreeCanopyLayer.setShadowMode`). They are two different techniques, not two
qualities of one, because the layer does not own its framebuffer.

**`contact`** (the default) is a fifth `InstancedMesh` — one flat disc per
tree, offset to where its crown centre casts, rotated to the sun's azimuth and
stretched `1/sin(elevation)` along it. One extra draw call, no render targets.

It blends with an explicit `CustomBlending` of `ZERO, SRC_COLOR` on colour and
`ZERO, ONE` on alpha — *not* `MultiplyBlending`, which looks identical in a
normal three.js scene and is wrong here. `MultiplyBlending` applies the same
factors to alpha, and the map canvas is premultiplied and composited over the
page, so the measured effect of enabling shadows was the plot getting
**brighter** (mean luma 159.4 → 163.4). With alpha left alone it darkens, as it
should (160.4 → 153.1).

Multiplying rather than alpha-blending black is what lets one blob look right on
sand, on the aerial photo and on the generative artwork at once: the destination
pixel already holds the correct ground colour.

**`soft`** turns on three's shadow map plus a `ShadowMaterial` plane as a
receiver — the basemap is MapLibre's pixels and cannot receive anything.
Accurate, and it costs a depth pass over all 2,300 trees every frame, since
`frustumCulled = false` means none are skipped. Two traps: the shadow pass
restores the framebuffer binding to `null`, which is not what MapLibre was
drawing into while it composites terrain (hence the explicit save/restore in
`render`), and `light.shadow.camera` is orthographic with no natural extent —
three's ±5 m default leaves everything but the plot centre casting nothing.

## 7. Terrain

`queryTerrainElevation` returns `null` until the DEM tiles covering a point are
decoded, so sampling at build time would silently pin the whole plot to sea
level and sink it into any hill the terrain source puts there. Instead
`sampleElevations` is attempted every frame and latches on the first success.
Heights are stored *relative to the scene origin*, since the origin is already
the scene's zero.

## 8. Cost

three.js is ~724KB (185KB gzipped), and it is **dynamically imported by the
layer itself**, on `onAdd`. It lands in its own chunk (confirm with
`pnpm build` — `dist/assets/three.module-*.js`). A user who never turns the
layer on never fetches it.

The crown table (~100KB of JSON) loads wherever the generative artwork exists,
*not* only while the layer is visible — the layer panel hides the chip until the
table arrives, so gating the fetch on visibility would strand a user who turned
the layer off: no chip, and therefore no way back on.

## 9. Files

| File | Role |
|---|---|
| `scripts/extract-canopies.mjs` | build-time SVG → crown table |
| `public/overlays/al-maha-canopies.json` | the committed crown table |
| `src/data/canopies.ts` | loader, per-tree variation, seeded RNG |
| `src/data/canopies.test.ts` | the coordinate chain and the size rule |
| `src/map/TreeCanopyLayer.ts` | the MapLibre custom layer |
| `src/components/MapCanvas.tsx` | lifecycle, opacity, style-swap re-add |
| `src/components/LayerPanel.tsx` | the `trees3d` chip |

## 10. Verifying a change

The extraction is checkable without a browser — render the derived circles back
over the source art and look at them:

```python
import json
from PIL import Image, ImageDraw
d = json.load(open('public/overlays/al-maha-canopies.json'))
W, H = d['viewBox']
img = Image.open('public/overlays/al-maha-generative.png').convert('RGB').resize((W, H))
dr = ImageDraw.Draw(img)
for c in d['canopies']:
    x, y, r = c['u'] * W, c['v'] * H, c['r'] * W
    dr.ellipse([x - r, y - r, x + r, y + r], outline=(0, 255, 80), width=2)
img.crop((300, 150, 1100, 600)).resize((1600, 900)).save('/tmp/verify.png')
```

Every blue crown outline should contain one green circle of matching size. A
few merged loops (two crowns drawn as one) legitimately get a single larger
circle.

The coordinate chain itself is covered by `pnpm test`. Rendering is not — that
needs the browser.
