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

function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
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
        const colour = new three.Color(
          FOLIAGE_DRY[0] + (FOLIAGE_LUSH[0] - FOLIAGE_DRY[0]) * t,
          FOLIAGE_DRY[1] + (FOLIAGE_LUSH[1] - FOLIAGE_DRY[1]) * t,
          FOLIAGE_DRY[2] + (FOLIAGE_LUSH[2] - FOLIAGE_DRY[2]) * t,
        );
        mesh.setColorAt(field.slot[i], colour);
      }
    }

    for (const mesh of this.foliageMeshes) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    this.field = field;
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
