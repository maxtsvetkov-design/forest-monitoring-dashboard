/**
 * A MapLibre custom layer that stands a low-poly 3D tree inside every canopy
 * traced in the generative artwork.
 *
 * ## Why a custom layer and not a canvas on top
 *
 * The trees have to obey the same camera as the imagery underneath them —
 * pitch, bearing, zoom, terrain — or they slide off the crowns the moment the
 * user tilts. A separate three.js canvas positioned over the map could only
 * ever approximate that. MapLibre's `CustomLayerInterface` instead hands us
 * *its* WebGL context and *its* model-view-projection matrix mid-frame, so the
 * scene is rendered by the map's own camera, in the map's own depth buffer,
 * between the map's own layers.
 *
 * ## Coordinate spaces
 *
 * Three spaces, converted once at build time:
 *
 * 1. **Image space** — `Canopy.u/v/r`, normalised to the overlay PNG.
 * 2. **Ground space** — lng/lat, via `pointInQuad` against the overlay's four
 *    georeferenced corners. This is what keeps the trees glued to the artwork.
 * 3. **Local metres** — the scene itself, with its origin at the plot centre,
 *    `+X` east, `+Y` up, `+Z` south. Building in metres means tree dimensions
 *    are written as metres and read as metres.
 *
 * The local→clip transform is the standard MapLibre/three.js bridge: translate
 * to the origin's Mercator position, scale by `meterInMercatorCoordinateUnits`
 * (negated on Y, because Mercator's Y grows southward while three's does not),
 * and rotate X by 90° to turn three's Y-up world into the map's Z-up one.
 *
 * ## Why instancing
 *
 * ~2300 trees. As individual meshes that is ~2300 draw calls per frame and the
 * map stops being interactive. As four `InstancedMesh`es — one trunk, three
 * foliage variants — it is four, and the per-frame cost collapses to writing
 * matrices into a buffer.
 *
 * ## three.js is loaded lazily
 *
 * three is ~600KB. It is imported dynamically the first time this layer is
 * actually added, so a user who never turns the layer on never pays for it.
 * `render` no-ops until the import resolves, then triggers one repaint.
 */

import * as maplibregl from "maplibre-gl";
import type * as THREE from "three";
import type { MapOverlay } from "../data/overlays";
import { pointInQuad } from "../data/overlays";
import { MAX_CROWN_RADIUS_M, treeRng, treeVariation, type Canopy } from "../data/canopies";
import { CONDITION_COLOR } from "../data/taxonomy";
import { declineSeverityAt } from "../data/treePopulation";

/** Distinct crown silhouettes. Every tree also gets its own spin, lean, tint
 * and proportions, but three base shapes stop the eye from locking onto one
 * repeated blob in the dense parts of the plot. */
const FOLIAGE_VARIANTS = 3;

/** Foliage palette, dry to healthy — `TreeVariation.tint` interpolates between
 * these. Sampled from the aerial rather than invented: the plot's real canopies
 * run from a pale grey-green to a deep mangrove green. */
const FOLIAGE_DRY: [number, number, number] = [0.55, 0.62, 0.38];
const FOLIAGE_LUSH: [number, number, number] = [0.13, 0.38, 0.24];
const TRUNK_COLOR = 0x6b5540;

/** A hex swatch as a plain 0..1 triple, to match the FOLIAGE_* constants above.
 * Not `new THREE.Color("#rrggbb")`: three takes a numeric constructor as
 * already being in the working colour space but runs an sRGB conversion on a
 * hex string, so mixing the two forms in one lerp shifts the hue. */
function swatchTriple(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Crown colour for a tree standing on failing ground.
 *
 * Read off the taxonomy's own Sparse swatch rather than picked by eye, for the
 * reason every other colour in this app is: the same tree's map pin, its row in
 * the table and its slice of the condition donut are already this colour, and a
 * 3D crown inventing its own would be a fourth opinion about one fact.
 */
const FOLIAGE_SCORCHED = swatchTriple(CONDITION_COLOR.sparse);

/** How far a severity-1 crown travels toward the scorched red. Short of 1 on
 * purpose: a crown that lands exactly on the pin's flat orange stops reading as
 * foliage at all, and the point is a sick tree, not a marker. */
const DIEBACK_TINT = 0.92;

/** ...and then how much that crown is darkened, in proportion to the same
 * severity, so the worst ground reads as brick-dead rather than as a cheerful
 * autumn orange.
 *
 * A multiply, not a blend toward the Defoliated grey, which was the obvious
 * thing to reach for and is wrong twice over. That swatch is *lighter* than the
 * red in green and blue, so mixing it desaturates a dying crown to tan instead
 * of deadening it — measured, `#b67152` rather than anything you would call
 * red. And switching target past a severity threshold turned the two worst
 * blocks on this plot grey (both are severity 1) while leaving only the milder
 * ones looking red, which is backwards. Scaling brightness keeps the hue and
 * spends it on the thing severity should actually buy: green `#57804f` at rest,
 * `#9c5b33` on the 0.7 blocks, rust `#b24e29` at 1. */
const DIEBACK_DARKEN = 0.18;

/**
 * Sun direction in *scene local* axes — `+X` east, `+Y` up, `+Z` south — as a
 * direction, not a position: mid-morning, high and from the north-west.
 *
 * A single constant on purpose. Lighting reads it, the ground blobs read it,
 * and the shadow-map camera reads it; a shadow pointing somewhere the shading
 * disagrees with is worse than no shadow at all, and that is exactly what a
 * second hand-tuned vector eventually becomes.
 */
const SUN_DIRECTION: [number, number, number] = [-0.6, 1, -0.4];

/** Ground offset per metre of height: where a point at height h casts, given
 * the sun above. Straight similar-triangles — `-dir.xz / dir.y`. */
const SHADOW_OFFSET_PER_M_X = -SUN_DIRECTION[0] / SUN_DIRECTION[1];
const SHADOW_OFFSET_PER_M_Z = -SUN_DIRECTION[2] / SUN_DIRECTION[1];
/** Y rotation that points the disc's own `+Z` down the offset direction, so
 * the ellipse stretches away from the tree rather than across it. */
const SHADOW_AZIMUTH = Math.atan2(SHADOW_OFFSET_PER_M_X, SHADOW_OFFSET_PER_M_Z);
/** A circle lit from an angle projects as an ellipse `1/sin(elevation)` long.
 * With this sun that is a modest 1.23 — enough to read as directional. */
const SHADOW_STRETCH =
  Math.hypot(SUN_DIRECTION[0], SUN_DIRECTION[1], SUN_DIRECTION[2]) / SUN_DIRECTION[1];
/** How far above the ground the blobs sit. Coplanar with the terrain they
 * z-fight; much higher and they visibly detach on a steep tilt. */
const SHADOW_LIFT_M = 0.15;
/**
 * Blob tint, multiplied against whatever MapLibre already drew there.
 *
 * `MultiplyBlending` is the trick that makes a fake shadow work in a shared
 * framebuffer: the destination pixel already holds the correct ground colour,
 * so multiplying by a grey darkens sand, aerial photo and generative artwork
 * alike. An alpha-blended black blob would need one opacity that looks right
 * on all three, and there isn't one.
 */
const SHADOW_TINT: [number, number, number] = [0.47, 0.46, 0.42];

/** Ground blobs, a real shadow map, or neither. See `setShadowMode`. */
export type CanopyShadowMode = "off" | "contact" | "soft";

/** Soft-mode receiver, in metres square. Big enough to catch the whole plot
 * plus the long shadows at its edge. */
const SHADOW_PLANE_M = 4000;
/** Soft-mode opacity of the received shadow. */
const SHADOW_PLANE_DARKNESS = 0.32;

/** Trunk thickness as a fraction of its own height. Ghaf and mangrove trunks
 * are stubby relative to their crowns; thinner than this and they vanish at
 * anything but the closest zoom. */
const TRUNK_SLENDERNESS = 0.09;

/** Grow-in: each tree pops up as a wave sweeps west→east across the plot, so
 * enabling the layer reads as the forest arriving rather than a frame drop. */
const GROW_MS = 900;
const GROW_SWEEP_MS = 1400;

/** Sway: amplitude in radians at a 10m tree, scaled linearly by height, and the
 * period of one full cycle. Deliberately small — this should register as life
 * at the edge of vision, not as a storm. */
const SWAY_RADIANS_AT_10M = 0.035;
const SWAY_PERIOD_MS = 4200;

/**
 * Clearing the stage for one tree: how long a single tree takes to dissolve,
 * and how much longer the far side of the plot takes to start than the
 * subject's own neighbours.
 *
 * The stagger runs *outside-in* — the horizon empties first and the trees
 * standing next to the subject are the last to go — so the shot resolves
 * toward the one tree rather than a hole opening around it.
 */
const DISSOLVE_MS = 520;
const DISSOLVE_SWEEP_MS = 420;

function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** Symmetric ease for the focus dissolve. Deliberately not `easeOutBack`: the
 * grow-in's overshoot is a tree springing up, while a tree being cleared out of
 * shot should not bounce on its way out — or, on the way back, overshoot past
 * full size next to the one tree the reader was just studying. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Sizes the orthographic volume the sun renders its depth map from.
 *
 * Unlike a perspective camera this has no natural extent — three defaults to
 * ±5 metres, which on a plot hundreds of metres across means every tree but
 * the handful at the centre falls outside the volume and casts nothing at all.
 *
 * `light.shadow.camera` is an `OrthographicCamera`; `light.shadow.mapSize` is
 * the depth texture's resolution.
 */
function configureShadowCamera(light: THREE.DirectionalLight, plotWidthM: number) {
  const camera = light.shadow.camera as THREE.OrthographicCamera;
  // TODO(human): set the camera's left/right/top/bottom/near/far and
  // light.shadow.mapSize from plotWidthM, then camera.updateProjectionMatrix().
  void camera;
  void plotWidthM;
}

interface TreeCanopyLayerOptions {
  id: string;
  /** The overlay quad the crowns were traced against — same corners as the
   * generative raster, so the two stay locked together. */
  coordinates: MapOverlay["coordinates"];
  canopies: Canopy[];
  /** The plot's ground width in metres, used to turn normalised crown radii
   * into real sizes. See `PLOT_WIDTH_M` in overlays.ts. */
  widthMeters: number;
  /** 0..1, from the layer panel's opacity slider. */
  opacity?: number;
  /** Set by the caller from `prefers-reduced-motion`; suppresses both the
   * grow-in and the sway, leaving the trees standing still. */
  reducedMotion?: boolean;
  /** Defaults to `"contact"` — one extra draw call, and a map without any
   * ground contact under 2,300 trees reads as a sticker sheet. */
  shadowMode?: CanopyShadowMode;
}

/** Per-tree constants, computed once. Everything the render loop needs and
 * nothing it doesn't — stored as flat typed arrays because this is touched
 * 2300 times a frame and object property lookups there are not free. */
interface TreeField {
  count: number;
  /** Local metres, east. */
  x: Float32Array;
  /** Local metres, south. */
  z: Float32Array;
  /** Terrain elevation in metres, relative to the scene origin. */
  y: Float32Array;
  crownRadiusM: Float32Array;
  heightM: Float32Array;
  trunkRatio: Float32Array;
  /** Y rotation, radians. */
  spin: Float32Array;
  /** Sway phase offset, radians. */
  phase: Float32Array;
  /** Milliseconds this tree waits before growing in. */
  delay: Float32Array;
  /** Which foliage variant mesh owns this tree, and its slot within it. */
  variant: Uint8Array;
  slot: Uint32Array;
  /** lng/lat, kept for terrain resampling after DEM tiles arrive. */
  lngLat: Float64Array;
}

export default class TreeCanopyLayer implements maplibregl.CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map: maplibregl.Map | null = null;
  private three: typeof THREE | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;

  private trunkMesh: THREE.InstancedMesh | null = null;
  private foliageMeshes: THREE.InstancedMesh[] = [];
  /** Contact mode: one flat disc per tree, multiplied onto the ground. */
  private shadowMesh: THREE.InstancedMesh | null = null;
  /** Soft mode: an invisible receiver, and the light that casts onto it. */
  private shadowPlane: THREE.Mesh | null = null;
  private sun: THREE.DirectionalLight | null = null;

  private options: TreeCanopyLayerOptions;
  private field: TreeField | null = null;
  /** Which foliage variant each tree drew, decided in `buildMeshes` because
   * the counts determine each mesh's capacity, and consumed by `placeTrees`. */
  private variantOf: Uint8Array | null = null;

  /** Mercator anchor for the scene origin, and the metre→Mercator scale there. */
  private originX = 0;
  private originY = 0;
  private originZ = 0;
  private meterScale = 1;

  private growStartedAt = 0;
  private removed = false;

  /**
   * Which single tree the scene is currently cleared for, or null for the whole
   * forest — see `setFocusedTree`.
   *
   * The three arrays below are the dissolve's state. `dissolveValue` is
   * per-tree presence (1 standing, 0 gone) carried between frames;
   * `dissolveFrom` snapshots it whenever the focus changes, so reversing
   * mid-animation eases out of where each tree actually was rather than
   * snapping to full size first; `dissolveDelay` is the outside-in stagger.
   */
  private focusIndex: number | null = null;
  private focusChangedAt = 0;
  private dissolveValue: Float32Array | null = null;
  private dissolveFrom: Float32Array | null = null;
  private dissolveDelay: Float32Array | null = null;
  /** Terrain elevations are sampled once DEM tiles have actually arrived;
   * before that `queryTerrainElevation` returns null and every tree would be
   * pinned to sea level. */
  private elevationsSampled = false;

  // Scratch objects, reused every frame — allocating 2300 Vector3s per frame
  // is exactly the kind of churn that turns a smooth pan into a stutter.
  private dummy: THREE.Object3D | null = null;
  private scratchVec: THREE.Vector3 | null = null;
  private scratchEuler: THREE.Euler | null = null;
  /** Camera-matrix scratch, kept separate from `scratchVec`/`scratchMat` used
   * by the instance loop so the two can never quietly stomp each other. */
  private mvpMat: THREE.Matrix4 | null = null;
  private localMat: THREE.Matrix4 | null = null;
  private localScale: THREE.Vector3 | null = null;
  /** The constant Y-up → Z-up rotation. Built once; rebuilding it every frame
   * was 60 allocations a second for a matrix that never changes. */
  private zUpMat: THREE.Matrix4 | null = null;

  constructor(options: TreeCanopyLayerOptions) {
    this.id = options.id;
    this.options = options;
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.removed = false;

    // Dynamic import: see the header note on bundle size. The layer is added
    // synchronously (MapLibre requires that) and simply draws nothing until
    // three lands.
    import("three").then((three) => {
      if (this.removed) return;
      this.three = three;
      this.build(three, map, gl);
      this.growStartedAt = performance.now();
      map.triggerRepaint();
    });
  }

  onRemove() {
    this.removed = true;
    this.trunkMesh?.geometry.dispose();
    (this.trunkMesh?.material as THREE.Material | undefined)?.dispose();
    for (const mesh of this.foliageMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.foliageMeshes = [];
    this.trunkMesh = null;
    this.shadowMesh?.geometry.dispose();
    (this.shadowMesh?.material as THREE.Material | undefined)?.dispose();
    this.shadowMesh = null;
    this.shadowPlane?.geometry.dispose();
    (this.shadowPlane?.material as THREE.Material | undefined)?.dispose();
    this.shadowPlane = null;
    this.sun?.shadow.dispose();
    this.sun = null;
    this.scene = null;
    // The renderer is *not* disposed: it wraps MapLibre's own GL context, and
    // `dispose()` would tear down state the map is still using.
    this.renderer = null;
    this.map = null;
  }

  /** Re-derives every tree's ground position — call after the overlay quad
   * moves (an area switch, or the overlay-height slider's apparent lift). */
  setCoordinates(coordinates: MapOverlay["coordinates"], widthMeters: number) {
    this.options = { ...this.options, coordinates, widthMeters };
    if (!this.three) return;
    this.placeTrees(this.three);
    this.elevationsSampled = false;
    this.map?.triggerRepaint();
  }

  setOpacity(opacity: number) {
    this.options = { ...this.options, opacity };
    this.applyOpacity();
    this.map?.triggerRepaint();
  }

  /**
   * Clears every other tree out of the scene so one of them can be read on its
   * own — what opening a digital twin from the table asks for, since the camera
   * lands at eye level *inside* the canopy and the 2,296 trees between it and
   * the horizon are all in the way of the one being inspected.
   *
   * `index` is a crown index into `options.canopies`, not a tree id from the
   * population table: these trees come from the artwork's traced canopies (see
   * docs/3D-CANOPY.md §1), so the caller has to snap a record's position to the
   * nearest crown first — which `MapCanvas.flyToNearestCrown` already does to
   * decide where to stand. Pass null to bring the forest back.
   *
   * A dissolve, not an alpha fade, and deliberately so: `InstancedMesh` has no
   * per-instance opacity — `instanceColor` is RGB only and `material.opacity`
   * would take the subject down with everything else — so a real fade means
   * patching the material's shader and paying for a sorted transparent pass
   * over every tree. Shrinking each tree away instead rides the `grow` factor
   * the instance loop already multiplies through, which is the same mechanism
   * the grow-in wave uses to hide a tree that has not arrived yet, and it takes
   * each tree's trunk, crown and contact shadow with it for free.
   */
  setFocusedTree(index: number | null) {
    if (this.focusIndex === index) return;
    this.focusIndex = index;
    this.rebuildDissolve();
    this.map?.triggerRepaint();
  }

  /**
   * (Re)computes the dissolve's per-tree state for the current focus.
   *
   * Split out of `setFocusedTree` because it has two callers with different
   * timings. A twin can be opened before this layer's own three.js import has
   * resolved and `placeTrees` has run, so there may be no field to measure
   * distances against yet — in that case the focus is simply remembered and
   * `placeTrees` re-applies it on the way out. `setCoordinates` reaches the
   * same path: the trees have physically moved, so the stagger has to be
   * measured again against their new positions.
   */
  private rebuildDissolve() {
    const field = this.field;
    // Nothing to build if the forest has never been focused and isn't being
    // focused now — leaving the arrays null is what keeps the dissolve out of
    // the instance loop entirely on the ordinary path.
    if (!field || (this.focusIndex === null && !this.dissolveValue)) return;

    const count = field.count;
    if (!this.dissolveValue || this.dissolveValue.length !== count) {
      this.dissolveValue = new Float32Array(count).fill(1);
      this.dissolveFrom = new Float32Array(count).fill(1);
      this.dissolveDelay = new Float32Array(count);
    }
    // Snapshot where every tree is *now* so a reversal (or a jump straight from
    // one subject to another) eases out of the current state instead of
    // restarting from full size and popping.
    this.dissolveFrom!.set(this.dissolveValue);
    this.focusChangedAt = performance.now() - this.growStartedAt;

    // Stagger by distance from the subject, normalised against the farthest
    // tree so the sweep takes the same time on any plot. Reversed for the
    // subject's own sake: see DISSOLVE_SWEEP_MS.
    const delay = this.dissolveDelay!;
    const focus = this.focusIndex;
    if (focus === null) {
      delay.fill(0);
    } else {
      const cx = field.x[focus];
      const cz = field.z[focus];
      let farthest = 1;
      for (let i = 0; i < count; i++) {
        const dx = field.x[i] - cx;
        const dz = field.z[i] - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > farthest) farthest = d2;
      }
      for (let i = 0; i < count; i++) {
        const dx = field.x[i] - cx;
        const dz = field.z[i] - cz;
        // 1 next to the subject, 0 at the horizon — so the near trees wait
        // and the far ones leave first.
        const nearness = 1 - Math.sqrt((dx * dx + dz * dz) / farthest);
        delay[i] = nearness * DISSOLVE_SWEEP_MS;
      }
    }
  }

  /**
   * Switches between no shadows, cheap ground blobs and a real shadow map.
   *
   * The two modes are genuinely different features, not two qualities of one:
   *
   * - `contact` adds a fifth `InstancedMesh` of flat discs, multiplied onto
   *   whatever MapLibre already drew. One extra draw call, no render targets,
   *   no new GL state to fight the map over — which is why it is the default.
   * - `soft` turns on three's shadow map and drops a `ShadowMaterial` plane in
   *   as a receiver, since the basemap is MapLibre's pixels and cannot receive
   *   anything. Accurate, and it costs a full depth pass over all 2,300 trees
   *   every frame with `frustumCulled = false` meaning none of them are
   *   skipped.
   *
   * Never both: the blobs would sit under the cast shadows and double up.
   */
  setShadowMode(mode: CanopyShadowMode) {
    this.options = { ...this.options, shadowMode: mode };
    this.applyShadowMode();
    this.map?.triggerRepaint();
  }

  private applyShadowMode() {
    const mode = this.options.shadowMode ?? "contact";
    if (this.shadowMesh) this.shadowMesh.visible = mode === "contact";
    if (this.shadowPlane) this.shadowPlane.visible = mode === "soft";
    if (this.sun) this.sun.castShadow = mode === "soft";
    if (this.renderer) {
      const wasEnabled = this.renderer.shadowMap.enabled;
      this.renderer.shadowMap.enabled = mode === "soft";
      // Whether shadows exist is compiled into every shader three generates,
      // so flipping the switch invalidates programs that are already built.
      if (wasEnabled !== this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.needsUpdate = true;
        for (const mesh of [this.trunkMesh, ...this.foliageMeshes]) {
          const material = mesh?.material as THREE.Material | undefined;
          if (material) material.needsUpdate = true;
        }
      }
    }
  }

  setReducedMotion(reducedMotion: boolean) {
    this.options = { ...this.options, reducedMotion };
    this.map?.triggerRepaint();
  }

  private applyOpacity() {
    const opacity = this.options.opacity ?? 1;
    const materials: (THREE.Material | undefined)[] = [
      this.trunkMesh?.material as THREE.Material | undefined,
      ...this.foliageMeshes.map((m) => m.material as THREE.Material),
    ];
    for (const material of materials) {
      if (!material) continue;
      material.opacity = opacity;
      // Opaque unless it has to be otherwise: a transparent pass costs sorting
      // and loses depth writes, which on 2300 overlapping crowns is visible.
      material.transparent = opacity < 1;
      material.depthWrite = opacity >= 1;
      material.needsUpdate = true;
    }

    // The blobs fade differently. Under `MultiplyBlending` the alpha channel
    // does nothing at all — the result is `src × dst` — so a "lighter" shadow
    // is one whose colour is closer to white, white being multiply's identity.
    const disc = this.shadowMesh?.material as THREE.MeshBasicMaterial | undefined;
    if (disc) {
      disc.color.setRGB(
        1 - (1 - SHADOW_TINT[0]) * opacity,
        1 - (1 - SHADOW_TINT[1]) * opacity,
        1 - (1 - SHADOW_TINT[2]) * opacity,
      );
    }
    const plane = this.shadowPlane?.material as THREE.ShadowMaterial | undefined;
    if (plane) plane.opacity = SHADOW_PLANE_DARKNESS * opacity;
  }

  private build(three: typeof THREE, map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.renderer = new three.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    // MapLibre has already drawn the basemap into this framebuffer by the time
    // our render hook runs. Clearing would erase it.
    this.renderer.autoClear = false;

    this.scene = new three.Scene();
    // A bare Camera, not a Perspective one: MapLibre supplies the full
    // projection matrix each frame, so any camera intrinsics we set here would
    // be overwritten anyway.
    this.camera = new three.Camera();

    // Warm desert key light plus a sky/ground bounce. Lambert rather than
    // Standard: no metalness or roughness to express on a stylised tree, and
    // Lambert is markedly cheaper across 2300 instances.
    const sun = new three.DirectionalLight(0xfff2dc, 2.6);
    // Pushed out along the sun direction rather than left at unit length:
    // Lambert only cares about the direction, but a shadow camera has to sit
    // outside the geometry it is looking at.
    const reach = this.options.widthMeters;
    sun.position.set(SUN_DIRECTION[0] * reach, SUN_DIRECTION[1] * reach, SUN_DIRECTION[2] * reach);
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun.target);
    this.scene.add(sun);
    this.sun = sun;
    this.scene.add(new three.HemisphereLight(0xcfe4ff, 0xb9a17c, 1.5));

    this.renderer.shadowMap.type = three.PCFSoftShadowMap;
    configureShadowCamera(sun, this.options.widthMeters);

    // Soft mode's receiver. Invisible in itself — `ShadowMaterial` draws only
    // where something shadows it — so it can sit over the basemap without
    // hiding it. `depthWrite: false` keeps it out of the depth buffer the
    // trees and the map share.
    const planeGeometry = new three.PlaneGeometry(SHADOW_PLANE_M, SHADOW_PLANE_M);
    planeGeometry.rotateX(-Math.PI / 2);
    const plane = new three.Mesh(
      planeGeometry,
      new three.ShadowMaterial({ opacity: SHADOW_PLANE_DARKNESS, depthWrite: false }),
    );
    plane.receiveShadow = true;
    plane.frustumCulled = false;
    plane.renderOrder = -1;
    plane.visible = false;
    this.scene.add(plane);
    this.shadowPlane = plane;

    this.dummy = new three.Object3D();
    this.scratchVec = new three.Vector3();
    this.scratchEuler = new three.Euler();
    this.mvpMat = new three.Matrix4();
    this.localMat = new three.Matrix4();
    this.localScale = new three.Vector3();
    this.zUpMat = new three.Matrix4().makeRotationX(Math.PI / 2);

    this.buildMeshes(three);
    this.placeTrees(three);
    this.applyOpacity();
    this.applyShadowMode();
  }

  /**
   * Builds the shared geometry and the four instanced meshes.
   *
   * Both geometries are authored in *unit* space and stretched per instance:
   * the trunk is a unit cylinder with its base at the origin (so a per-instance
   * rotation pivots it about the ground, which is what a lean is), and each
   * foliage variant is a unit-radius blob centred on the origin.
   */
  private buildMeshes(three: typeof THREE) {
    const count = this.options.canopies.length;

    const trunkGeometry = new three.CylinderGeometry(0.62, 1, 1, 6, 1);
    // Cylinders are built centred on the origin; shift so y=0 is the base.
    trunkGeometry.translate(0, 0.5, 0);
    const trunkMaterial = new three.MeshLambertMaterial({ color: TRUNK_COLOR, flatShading: true });
    this.trunkMesh = new three.InstancedMesh(trunkGeometry, trunkMaterial, count);
    this.trunkMesh.castShadow = true;
    this.trunkMesh.receiveShadow = true;
    // Our projection matrix is not one three can reason about, so its own
    // frustum test would cull the whole forest. MapLibre already limits us to
    // what is on screen.
    this.trunkMesh.frustumCulled = false;
    this.scene!.add(this.trunkMesh);

    // How many trees land on each variant, so each InstancedMesh is allocated
    // exactly the capacity it needs rather than `count` slots three times over.
    const variantOf = new Uint8Array(count);
    const variantCounts = new Array(FOLIAGE_VARIANTS).fill(0);
    for (let i = 0; i < count; i++) {
      const v = Math.floor(treeRng(i)() * FOLIAGE_VARIANTS) % FOLIAGE_VARIANTS;
      variantOf[i] = v;
      variantCounts[v]++;
    }

    this.foliageMeshes = [];
    for (let v = 0; v < FOLIAGE_VARIANTS; v++) {
      const geometry = this.buildFoliageGeometry(three, v);
      const material = new three.MeshLambertMaterial({ flatShading: true });
      // Exactly the capacity this variant drew — not a padded minimum, which
      // would leave an unwritten identity-matrix instance sitting as a stray
      // one-metre blob at the plot's centre.
      const mesh = new three.InstancedMesh(geometry, material, variantCounts[v]);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.foliageMeshes.push(mesh);
      this.scene!.add(mesh);
    }

    // Contact shadows: one flat disc per tree. Cheap enough to build
    // unconditionally and simply hide — the alternative is tearing an
    // InstancedMesh down and back up every time the mode changes.
    const discGeometry = new three.CircleGeometry(1, 14);
    discGeometry.rotateX(-Math.PI / 2);
    const discMaterial = new three.MeshBasicMaterial({
      color: new three.Color(...SHADOW_TINT),
      // `MultiplyBlending` would be the obvious choice and is wrong here: it
      // applies `ZERO, SRC_COLOR` to the *alpha* channel too, so every blob
      // also multiplies the framebuffer's alpha down. The map canvas is
      // premultiplied and composited over the page, so the measurable effect
      // of turning shadows on was the plot getting *brighter* (mean luma
      // 159.4 → 163.4 across the plot). Same colour factors, alpha left alone.
      blending: three.CustomBlending,
      blendSrc: three.ZeroFactor,
      blendDst: three.SrcColorFactor,
      blendSrcAlpha: three.ZeroFactor,
      blendDstAlpha: three.OneFactor,
      transparent: true,
      // Drawn before the trees and never written into the depth buffer, so a
      // disc can darken the ground without ever occluding a trunk in front of
      // it. Depth *testing* stays on: a disc genuinely behind a tree should
      // still be hidden by it.
      depthWrite: false,
    });
    const shadowMesh = new three.InstancedMesh(discGeometry, discMaterial, count);
    shadowMesh.frustumCulled = false;
    shadowMesh.renderOrder = -1;
    this.shadowMesh = shadowMesh;
    this.scene!.add(shadowMesh);

    this.variantOf = variantOf;
  }

  /**
   * A unit-radius crown: a subdivided icosahedron whose vertices are pushed in
   * and out by a deterministic hash of their own position.
   *
   * Perturbing the *sphere* rather than modelling branches is the cheap way to
   * read as vegetation at map scale — at the zooms where these are legible, a
   * crown is a lumpy silhouette and nothing more. The seed differs per variant,
   * so the three shapes are genuinely different lumps rather than rotations of
   * one.
   */
  private buildFoliageGeometry(three: typeof THREE, variant: number): THREE.BufferGeometry {
    const geometry = new three.IcosahedronGeometry(1, 1);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const rand = treeRng(9001 + variant * 137);
    // One displacement per *vertex index* would tear the shape apart, because
    // IcosahedronGeometry is non-indexed — the same corner appears once per
    // face. Key the displacement on the rounded position instead so shared
    // corners move together and the surface stays closed.
    const displacementFor = new Map<string, number>();
    const vec = new three.Vector3();
    for (let i = 0; i < position.count; i++) {
      vec.fromBufferAttribute(position, i);
      const key = `${vec.x.toFixed(3)},${vec.y.toFixed(3)},${vec.z.toFixed(3)}`;
      let d = displacementFor.get(key);
      if (d === undefined) {
        d = 0.76 + rand() * 0.42;
        displacementFor.set(key, d);
      }
      vec.multiplyScalar(d);
      position.setXYZ(i, vec.x, vec.y, vec.z);
    }
    // Squash slightly: crowns are wider than they are tall.
    geometry.scale(1, 0.82, 1);
    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Converts every crown from image space to local metres and computes its
   * fixed per-tree properties. Run once at build, and again whenever the
   * overlay quad moves.
   */
  private placeTrees(three: typeof THREE) {
    const { canopies, coordinates, widthMeters } = this.options;
    const count = canopies.length;

    const centreLngLat = pointInQuad(coordinates, 0.5, 0.5);
    const origin = maplibregl.MercatorCoordinate.fromLngLat(centreLngLat, 0);
    this.originX = origin.x;
    this.originY = origin.y;
    this.originZ = origin.z;
    this.meterScale = origin.meterInMercatorCoordinateUnits();

    const variantOf = this.variantOf ?? new Uint8Array(count);
    const slotCursor = new Array(FOLIAGE_VARIANTS).fill(0);

    const field: TreeField = {
      count,
      x: new Float32Array(count),
      z: new Float32Array(count),
      y: new Float32Array(count),
      crownRadiusM: new Float32Array(count),
      heightM: new Float32Array(count),
      trunkRatio: new Float32Array(count),
      spin: new Float32Array(count),
      phase: new Float32Array(count),
      delay: new Float32Array(count),
      variant: variantOf,
      slot: new Uint32Array(count),
      lngLat: new Float64Array(count * 2),
    };

    for (let i = 0; i < count; i++) {
      const canopy = canopies[i];
      const [lng, lat] = pointInQuad(coordinates, canopy.u, canopy.v);
      field.lngLat[i * 2] = lng;
      field.lngLat[i * 2 + 1] = lat;

      const merc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
      field.x[i] = (merc.x - this.originX) / this.meterScale;
      // Mercator Y grows southward, and so does the scene's +Z after the
      // X-rotation in `render` — so this is a straight copy, not a negation.
      field.z[i] = (merc.y - this.originY) / this.meterScale;

      const rand = treeRng(i);
      const radiusM = Math.min(canopy.r * widthMeters, MAX_CROWN_RADIUS_M);
      const variation = treeVariation(radiusM, rand);

      field.crownRadiusM[i] = radiusM;
      field.heightM[i] = variation.heightM;
      field.trunkRatio[i] = variation.trunkRatio;
      field.spin[i] = rand() * Math.PI * 2;
      field.phase[i] = rand() * Math.PI * 2;
      // Sweep west→east across the image, with a little jitter so the wavefront
      // is a ragged edge rather than a ruler.
      field.delay[i] = canopy.u * GROW_SWEEP_MS + rand() * 180;

      const v = variantOf[i];
      field.slot[i] = slotCursor[v]++;

      // Colour is fixed per tree, so it goes into the instance colour buffer
      // once here instead of being rewritten every frame.
      const t = variation.tint;
      const mesh = this.foliageMeshes[v];
      if (mesh) {
        let r = FOLIAGE_DRY[0] + (FOLIAGE_LUSH[0] - FOLIAGE_DRY[0]) * t;
        let g = FOLIAGE_DRY[1] + (FOLIAGE_LUSH[1] - FOLIAGE_DRY[1]) * t;
        let bl = FOLIAGE_DRY[2] + (FOLIAGE_LUSH[2] - FOLIAGE_DRY[2]) * t;

        // Trees on failing ground redden. The severity comes from the same
        // zone rectangles the population's own decline is derived from, read
        // in the same image space these crowns were traced in — so a crown
        // goes red exactly where the pins under it are already flagged, rather
        // than on a second, decorative idea of where the trouble is.
        const severity = declineSeverityAt(canopy.u, canopy.v);
        if (severity > 0) {
          const k = severity * DIEBACK_TINT;
          r += (FOLIAGE_SCORCHED[0] - r) * k;
          g += (FOLIAGE_SCORCHED[1] - g) * k;
          bl += (FOLIAGE_SCORCHED[2] - bl) * k;
          // Then darkened by the same severity — see DIEBACK_DARKEN for why
          // this is a multiply and not a blend toward the Defoliated swatch.
          const dark = 1 - severity * DIEBACK_DARKEN;
          r *= dark;
          g *= dark;
          bl *= dark;
        }

        mesh.setColorAt(field.slot[i], new three.Color(r, g, bl));
      }
    }

    for (const mesh of this.foliageMeshes) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    this.field = field;
    // The field is what the dissolve measures its stagger against, so it has
    // to be (re)derived here: a focus set before this ran had nothing to
    // measure, and one set before a `setCoordinates` was measured against
    // positions these trees no longer stand at.
    this.rebuildDissolve();
  }

  /**
   * Reads terrain height under each tree, once DEM tiles have loaded.
   *
   * `queryTerrainElevation` returns null until the tiles covering a point are
   * decoded, so this is attempted every frame and latches on the first success
   * — sampling at build time would silently pin the whole plot to sea level
   * and sink it into any hill the terrain source puts there.
   */
  private sampleElevations(map: maplibregl.Map) {
    const field = this.field;
    if (!field || this.elevationsSampled) return;
    const probe = map.queryTerrainElevation({
      lng: field.lngLat[0],
      lat: field.lngLat[1],
    });
    if (probe === null || probe === undefined) return;

    const originElevation =
      map.queryTerrainElevation({
        lng: (this.options.coordinates[0][0] + this.options.coordinates[2][0]) / 2,
        lat: (this.options.coordinates[0][1] + this.options.coordinates[2][1]) / 2,
      }) ?? 0;

    for (let i = 0; i < field.count; i++) {
      const elevation = map.queryTerrainElevation({
        lng: field.lngLat[i * 2],
        lat: field.lngLat[i * 2 + 1],
      });
      field.y[i] = (elevation ?? originElevation) - originElevation;
    }
    this.elevationsSampled = true;
  }

  render(gl: WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) {
    const three = this.three;
    const map = this.map;
    const field = this.field;
    if (!three || !map || !field || !this.renderer || !this.scene || !this.camera) return;

    this.sampleElevations(map);

    const now = performance.now();
    const elapsed = now - this.growStartedAt;
    const reduced = this.options.reducedMotion === true;

    const growing = !reduced && elapsed < GROW_SWEEP_MS + GROW_MS + 200;
    // No separate "dissolving" term in the repaint guard below: the dissolve
    // only animates when motion is allowed, and whenever it is, the sway is
    // already asking for every frame anyway. Under reduced motion the dissolve
    // is applied in one step, so there is nothing to keep alive.
    this.writeInstanceMatrices(field, elapsed, reduced);

    // MapLibre hands us world→clip in Mercator space. This composes the
    // scene's own local-metres→Mercator transform underneath it. See the
    // header note on coordinate spaces for why Y is negated and X rotated.
    //
    // `defaultProjectionData.mainMatrix`, NOT `modelViewProjectionMatrix`:
    // since MapLibre 5 the latter is a different convention and no longer maps
    // Mercator [0..1] the way this layer needs. Measured on 6.6 at the pilot
    // plot, a crown MapLibre itself projects to pixel (520, 470) of a 1200px
    // canvas comes out of the two matrices as:
    //   modelViewProjectionMatrix → NDC (-1.538,  1.732, 1.011)  ← off-frame
    //   defaultProjectionData     → NDC (-0.132, -0.319, 0.979)  ← on-frame
    // which is why the whole forest silently rendered outside the frustum.
    // Falls back to the old field so this still runs on MapLibre 4.
    const projection = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix;
    const mvp = this.mvpMat!.fromArray(projection as unknown as number[]);
    const local = this.localMat!
      .makeTranslation(this.originX, this.originY, this.originZ)
      .scale(this.localScale!.set(this.meterScale, -this.meterScale, this.meterScale))
      .multiply(this.zUpMat!);
    this.camera.projectionMatrix.copy(mvp.multiply(local));
    // three never derives this itself when the projection matrix is assigned
    // rather than computed, and some of its internals reach for it.
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    // The renderer was constructed around whatever size the map canvas was at
    // the time. A resized container (the Assets split pane, a window resize)
    // changes the drawing buffer without telling three, which would then draw
    // into a stale viewport.
    const canvas = map.getCanvas();
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);

    // three and MapLibre both own GL state; `resetState` tells three that
    // everything it cached about the context is stale, which it is.
    this.renderer.resetState();

    // Soft mode renders a depth pass into three's own framebuffer first, and
    // restores the binding afterwards to *null* — the default framebuffer.
    // That is only the same thing MapLibre was drawing into when the map is
    // rendering straight to the canvas, which it is not while it composites
    // terrain. Capturing the binding and putting it back is a couple of GL
    // calls, and skips a whole class of "the map went black on tilt" bug.
    const soft = (this.options.shadowMode ?? "contact") === "soft";
    const boundFramebuffer = soft ? gl.getParameter(gl.FRAMEBUFFER_BINDING) : null;
    this.renderer.render(this.scene, this.camera);
    if (soft) gl.bindFramebuffer(gl.FRAMEBUFFER, boundFramebuffer as WebGLFramebuffer | null);

    // Only ask for another frame while something is actually moving. Without
    // this guard the map would repaint forever, which on a laptop is a fan.
    if (growing || !reduced) map.triggerRepaint();
  }

  /**
   * Writes one matrix per tree into each instanced mesh's buffer.
   *
   * The trunk pivots about its base and the crown rides on top of it, which is
   * why the crown's translation is rotated before it is applied: the matrix we
   * want is `T(ground) · R(lean) · T(0, crownCentre, 0) · S`, and an Object3D
   * only offers `T · R · S`. Folding `R · (0, crownCentre, 0)` into the
   * translation makes the two identical — see `scratchVec` below.
   */
  private writeInstanceMatrices(field: TreeField, elapsed: number, reduced: boolean) {
    const dummy = this.dummy!;
    const vec = this.scratchVec!;
    const euler = this.scratchEuler!;
    const trunk = this.trunkMesh!;
    const shadow = this.shadowMesh;
    const dissolveValue = this.dissolveValue;
    const dissolveFrom = this.dissolveFrom;
    const dissolveDelay = this.dissolveDelay;

    const swayT = (elapsed / SWAY_PERIOD_MS) * Math.PI * 2;

    for (let i = 0; i < field.count; i++) {
      const height = field.heightM[i];
      const radius = field.crownRadiusM[i];

      // Grow-in: 0 until this tree's turn, then eased to 1 with a slight
      // overshoot. Reduced motion skips straight to full size.
      let grow = 1;
      if (!reduced) {
        const t = (elapsed - field.delay[i]) / GROW_MS;
        grow = t <= 0 ? 0 : t >= 1 ? 1 : easeOutBack(t);
      }

      // Dissolve, folded into the same factor: a tree cleared out of the way
      // for the focused one is scaled to nothing exactly as a tree that has
      // not grown in yet is, so the early-out below covers both and the
      // trunk, crown and shadow all follow without a second code path.
      if (dissolveValue) {
        const target = this.focusIndex === null || this.focusIndex === i ? 1 : 0;
        let value = target;
        if (!reduced) {
          const t = (elapsed - this.focusChangedAt - dissolveDelay![i]) / DISSOLVE_MS;
          const from = dissolveFrom![i];
          value = t <= 0 ? from : t >= 1 ? target : from + (target - from) * easeInOutCubic(t);
        }
        dissolveValue[i] = value;
        grow *= value;
      }

      if (grow <= 0) {
        // A zero-scale matrix is the cheapest way to hide an instance — there
        // is no per-instance visibility flag in InstancedMesh.
        dummy.position.set(0, -1e6, 0);
        dummy.scale.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        const hiddenMesh = this.foliageMeshes[field.variant[i]];
        if (hiddenMesh) hiddenMesh.setMatrixAt(field.slot[i], dummy.matrix);
        shadow?.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Taller trees sway further, and each has its own phase so the plot
      // ripples instead of pulsing in unison.
      const amplitude = reduced ? 0 : (SWAY_RADIANS_AT_10M * height) / 10;
      const leanZ = amplitude * Math.sin(swayT + field.phase[i]);
      const leanX = amplitude * 0.6 * Math.cos(swayT * 0.83 + field.phase[i]);

      euler.set(leanX, field.spin[i], leanZ);
      dummy.quaternion.setFromEuler(euler);

      const grownHeight = height * grow;
      const trunkHeight = grownHeight * field.trunkRatio[i];
      const trunkRadius = Math.max(0.06, trunkHeight * TRUNK_SLENDERNESS);

      dummy.position.set(field.x[i], field.y[i], field.z[i]);
      dummy.scale.set(trunkRadius, trunkHeight, trunkRadius);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);

      // Crown centre sits above the trunk by its own vertical half-extent, so
      // the foliage rests on the trunk top rather than swallowing it.
      const crownHalfHeight = (grownHeight - trunkHeight) / 2;
      const crownCentre = trunkHeight + crownHalfHeight;
      vec.set(0, crownCentre, 0).applyQuaternion(dummy.quaternion);

      dummy.position.set(field.x[i] + vec.x, field.y[i] + vec.y, field.z[i] + vec.z);
      dummy.scale.set(radius * grow, crownHalfHeight, radius * grow);
      dummy.updateMatrix();
      const mesh = this.foliageMeshes[field.variant[i]];
      if (mesh) mesh.setMatrixAt(field.slot[i], dummy.matrix);

      // The blob lands where the crown centre casts — the same lean the crown
      // just took, so it slides with the sway instead of sitting pinned under
      // a tree that is visibly moving. Written whatever the mode: the mesh is
      // simply `visible = false` when shadows are off, and skipping the write
      // would leave stale matrices to flash on the frame it comes back.
      if (shadow) {
        const cast = crownCentre;
        dummy.position.set(
          field.x[i] + vec.x + cast * SHADOW_OFFSET_PER_M_X,
          field.y[i] + SHADOW_LIFT_M,
          field.z[i] + vec.z + cast * SHADOW_OFFSET_PER_M_Z,
        );
        dummy.rotation.set(0, SHADOW_AZIMUTH, 0);
        dummy.scale.set(radius * grow, 1, radius * grow * SHADOW_STRETCH);
        dummy.updateMatrix();
        shadow.setMatrixAt(i, dummy.matrix);
        // `rotation` and `quaternion` are two views of one value, and the next
        // iteration sets the quaternion from an Euler — leaving this behind
        // would put a spurious azimuth on the following tree's trunk.
        dummy.rotation.set(0, 0, 0);
      }
    }

    trunk.instanceMatrix.needsUpdate = true;
    for (const mesh of this.foliageMeshes) mesh.instanceMatrix.needsUpdate = true;
    if (shadow) shadow.instanceMatrix.needsUpdate = true;
  }
}
