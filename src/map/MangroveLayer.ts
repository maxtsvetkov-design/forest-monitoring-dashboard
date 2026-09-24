/**
 * A MapLibre custom layer that stands the Mangroves project's trees
 * (data/mangroves.ts) as 3D models, coloured by health, individually pickable
 * under the pointer, and lit like the real place.
 *
 * Built on exactly the same bridge as TreeCanopyLayer — MapLibre's own GL
 * context and camera, a local-metres scene anchored at the stand's centre,
 * `autoClear = false`, `resetState()` every frame, never disposing the
 * renderer, `frustumCulled = false`. docs/3D-CANOPY.md §2–3 explains each of
 * those; they are not repeated here.
 *
 * ## The model
 *
 * - **Wood** — a short trunk plus five arching prop roots, merged into one
 *   geometry authored for a tree of height 1 and scaled uniformly per tree.
 *   The prop roots are a legibility choice, not botany: the Jubail stand is
 *   grey mangrove, whose roots are pencil-like pneumatophores, but stilt roots
 *   are what makes a tree read as "mangrove" at a tilt. Vertex colours darken
 *   the lowest tenth — the wet tide line on the mud.
 * - **Crown** — five overlapping leaf clusters, smooth-shaded, their undersides
 *   flattened, with ambient occlusion baked into vertex colours. The tree's
 *   `CONDITION_COLOR` multiplies over that as the instance colour, so health is
 *   still read from the same five swatches as every legend and tooltip — the
 *   occlusion changes value, never hue.
 * - **Ground occlusion** — a soft multiplied pool under every crown, the sky
 *   light a canopy blocks, so trees sit *in* the ground even on their sunny side.
 *
 * ## Light
 *
 * A late-afternoon sun over Abu Dhabi casting real shadow-mapped shadows onto
 * a ground receiver and between trees, plus image-based light from a sky
 * generated to match it (a PMREM of a gradient dome with the sun's disc
 * baked in), so the shadow side is lit by the sky's colour and the waxy
 * leaves pick up soft sheen and highlights from the right direction.
 *
 * View-dependent shading needs the eye position, and MapLibre only supplies a
 * combined matrix — so `render` recovers the eye from it every frame (see
 * `eyeFromClip`) and hands three a camera that actually stands there.
 *
 * ## Ambient occlusion
 *
 * Screen-space (SSAO), recomputed every frame, since it depends on the view:
 * a full-resolution pre-pass renders the trees and the ground into depth +
 * normals (three `layers` channel 1, `MeshNormalMaterial` override), a
 * 16-sample hemisphere pass reconstructs positions in the layer's own
 * eye-relative space and counts what occludes each one, and a depth-aware
 * 4×4 blur removes the rotation pattern. Tree materials sample the result at
 * `gl_FragCoord` (occluding their sky light fully and their sun partly), and
 * a ground plane multiplies it onto the basemap — so leaf clusters shadow
 * each other, crowns darken the mud beneath them, and roots meet the ground.
 * A post-processing composer can't do this here: MapLibre owns the
 * framebuffer, so every pass is driven by hand inside `render`.
 *
 * ## Hover
 *
 * Eased, not switched: each tree carries an `emphasis` (0..1) and the stand a
 * global `fade`, both chasing their targets with a critically-damped
 * exponential step, so a hover swells and brightens its tree while every other
 * tree dissolves into the haze — and moving to a neighbour cross-fades the two
 * instead of snapping. The fade is a shader mix toward `FADE_COLOR` after tone
 * mapping (see `installFade`): the basemap under the stand is a near-uniform
 * grey, so mixing toward that grey *is* alpha-blending against it, without
 * per-instance transparency's sorting artefacts.
 *
 * ## Picking
 *
 * `pick()` casts a ray through the *same* scene→clip matrix the last frame was
 * drawn with, inverted, and asks three for the nearest instance it hits. Not
 * `map.project()`: that only knows the ground plane.
 */

import * as maplibregl from "maplibre-gl";
import type * as THREE from "three";
import type * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Mangrove } from "../data/mangroves";
import { CONDITION_COLOR } from "../data/taxonomy";

type GeometryUtils = typeof BufferGeometryUtils;

/** Weathered grey-brown bark; vertex colours darken it toward the mud. */
const WOOD_COLOR = 0x7c6f62;
const WOOD_ROUGHNESS = 0.93;
/** Waxy leaves: low specular, a soft velvety sheen at grazing angles. */
const FOLIAGE_ROUGHNESS = 0.7;
const FOLIAGE_SPECULAR = 0.35;
const FOLIAGE_SHEEN = 0.45;

/** Proportions of the unit (height 1) tree the wood geometry is authored at. */
const TRUNK_BASE = 0.2;
const TRUNK_TOP = 0.66;
const ROOT_COUNT = 5;
const ROOT_JOIN = 0.32;
const ROOT_SPREAD = 0.3;
/** Crown half-height as a fraction of tree height — squat on purpose. */
const CROWN_HALF_HEIGHT = 0.2;
/** Leaf clusters in unit-crown space: centre x, y, z, radius, subdivision. */
const CROWN_LOBES: [number, number, number, number, number][] = [
  [0, 0.12, 0, 0.74, 3],
  [0.5, -0.04, 0.12, 0.52, 2],
  [-0.46, 0.02, 0.26, 0.5, 2],
  [0.06, 0.0, -0.52, 0.54, 2],
  [-0.18, 0.3, -0.16, 0.46, 2],
];

/** Late-afternoon Abu Dhabi sun: azimuth clockwise from north, and elevation. */
const SUN_AZIMUTH_DEG = 250;
const SUN_ELEVATION_DEG = 38;
// Tuned so a sunlit crown top lands near its flat `CONDITION_COLOR` swatch:
// a warmer or dimmer sun reads Moderate yellow as olive and Sparse as brown,
// which costs the health encoding more than it gains in mood.
const SUN_COLOR = 0xfff1de;
const SUN_INTENSITY = 3.6;
/** The generated sky's own light, and the hemisphere that stands in for it
 *  if PMREM generation fails on this GPU. */
const ENV_INTENSITY = 0.85;
const FALLBACK_HEMI_INTENSITY = 1.7;
const SKY_ZENITH = [0.42, 0.6, 0.82];
const SKY_HORIZON = [0.9, 0.89, 0.86];
const SKY_GROUND = [0.62, 0.6, 0.55];
/** Shadows are skylight-filled, not black: a cool tint at partial strength. */
const SHADOW_COLOR = 0x1c2633;
const SHADOW_OPACITY = 0.36;
const SHADOW_MAP_SIZE = 4096;
/** Darkest multiply at the centre of a crown's ground-occlusion pool (sRGB). */
const GROUND_AO_DARKEST = 0.7;

/** SSAO: world radius of the sampled hemisphere (m), strength, the angular
 *  bias (a cosine — ignores neighbours within ~3° of the tangent plane), and
 *  how much of the *direct* sun it also occludes on the trees. */
const SSAO_RADIUS_M = 1.8;
const SSAO_INTENSITY = 2.6;
const SSAO_BIAS_M = 0.08;
const SSAO_DIRECT = 0.45;
const SSAO_SAMPLES = 16;

const DEFAULT_GROW_SWEEP_MS = 1100;
const GROW_MS = 750;

/** Hover easing time constants, ms — emphasis rises a touch faster than the
 *  stand fades, so the focused tree leads and the rest follow. */
const EMPHASIS_TAU_MS = 110;
const FADE_TAU_MS = 170;
/** How far other trees dissolve toward the haze, and the haze itself (sRGB). */
const FADE_MAX = 0.8;
const FADE_COLOR: [number, number, number] = [0.925, 0.928, 0.932];
/** The focused tree: colour lift toward white, and swell. */
const HOVER_LIFT = 0.28;
const HOVER_SCALE = 1.08;
/** Wind on the focused tree: peak lean in radians, and the gust period. */
const WIND_LEAN = 0.075;
const WIND_PERIOD_MS = 1300;

function easeOutBack(t: number): number {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Smooth, deterministic pseudo-noise in roughly [-1, 1] — sums of sines, so
 *  neighbouring vertices move together and a lobe stays a lobe. */
function lumpNoise(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 2.7 + 1.3) * Math.sin(y * 3.1 + 0.7) * Math.sin(z * 2.3 + 2.1) +
    0.5 * Math.sin(x * 5.9 + z * 4.3 + 0.4) * Math.sin(y * 4.7 + 1.9)
  );
}

/** When the trees sprout, west → east: an absolute `performance.now()` start
 *  and how long the wavefront takes to cross the stand. */
export interface GrowSchedule {
  startAt: number;
  sweepMs: number;
}

interface MangroveLayerOptions {
  id: string;
  trees: Mangrove[];
  reducedMotion?: boolean;
  /** Supplied by the intro flight so trees sprout ahead of the camera. */
  grow?: GrowSchedule;
}

export default class MangroveLayer implements maplibregl.CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private options: MangroveLayerOptions;
  private map: maplibregl.Map | null = null;
  private three: typeof THREE | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private woodMesh: THREE.InstancedMesh | null = null;
  private crownMesh: THREE.InstancedMesh | null = null;
  private aoMesh: THREE.InstancedMesh | null = null;
  private groundShadow: THREE.Mesh | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envPending = true;
  private fadeAttr: THREE.InstancedBufferAttribute | null = null;
  private aoStrength = { value: 1 };
  /** SSAO pipeline — see the header. The three uniform objects are shared by
   *  reference into every patched material, so updating `.value` is enough. */
  private ssao: {
    normalTarget: THREE.WebGLRenderTarget;
    aoTarget: THREE.WebGLRenderTarget;
    blurTarget: THREE.WebGLRenderTarget;
    normalMaterial: THREE.MeshNormalMaterial;
    aoMaterial: THREE.ShaderMaterial;
    blurMaterial: THREE.ShaderMaterial;
    quad: THREE.Mesh;
    quadScene: THREE.Scene;
    quadCamera: THREE.OrthographicCamera;
    ground: THREE.Mesh;
  } | null = null;
  private ssaoTexture: { value: THREE.Texture | null } = { value: null };
  private ssaoSize: { value: THREE.Vector2 | null } = { value: null };
  private ssaoGroundStrength = { value: 1 };

  private originX = 0;
  private originY = 0;
  private originZ = 0;
  private meterScale = 1;
  private originLngLat: [number, number] = [0, 0];
  /** Radius of the stand around its origin, metres — sizes the sun's shadow volume. */
  private standRadius = 1;
  /** Local metres: +X east, +Z south, +Y up (terrain, relative to the origin). */
  private x = new Float32Array(0);
  private z = new Float32Array(0);
  private y = new Float32Array(0);
  /** West→east position across the stand, 0..1 — what the grow wavefront reads. */
  private sweepFrac = new Float32Array(0);

  private grow: GrowSchedule = { startAt: 0, sweepMs: DEFAULT_GROW_SWEEP_MS };
  /** Whether a caller (the intro) chose the schedule — if so, the default
   *  one must never replace it when three finishes loading. */
  private growChosen = false;
  private matricesDirty = true;
  private hasProjection = false;

  private hovered: number | null = null;
  /** Per-tree hover emphasis, eased; `active` holds the few that are non-zero. */
  private emphasis = new Float32Array(0);
  private active = new Set<number>();
  private fade = 0;
  private lastFrameAt = 0;
  private removed = false;

  private dummy: THREE.Object3D | null = null;
  private scratchVec: THREE.Vector3 | null = null;
  private scratchVec4: THREE.Vector4 | null = null;
  private scratchEuler: THREE.Euler | null = null;
  private color: THREE.Color | null = null;
  private white: THREE.Color | null = null;
  private mvpMat: THREE.Matrix4 | null = null;
  private localMat: THREE.Matrix4 | null = null;
  private localScale: THREE.Vector3 | null = null;
  private zUpMat: THREE.Matrix4 | null = null;
  private eyeMat: THREE.Matrix4 | null = null;
  private sceneToClip: THREE.Matrix4 | null = null;
  /** Inverse of the last frame's scene→clip matrix — what `pick` casts through. */
  private clipToScene: THREE.Matrix4 | null = null;
  private raycaster: THREE.Raycaster | null = null;
  private rayOrigin: THREE.Vector3 | null = null;
  private rayFar: THREE.Vector3 | null = null;

  constructor(options: MangroveLayerOptions) {
    this.id = options.id;
    this.options = options;
    if (options.grow) {
      this.grow = options.grow;
      this.growChosen = true;
    }
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.removed = false;
    // Lazy, like TreeCanopyLayer: three only loads for a user who opens this
    // area. The layer draws nothing until it lands.
    Promise.all([import("three"), import("three/examples/jsm/utils/BufferGeometryUtils.js")]).then(
      ([three, utils]) => {
        if (this.removed) return;
        this.three = three;
        this.build(three, utils, map, gl);
        // Only when nobody chose a schedule: the intro sets one before three
        // has loaded, and replacing it here sprouted the whole stand in 1.1 s,
        // long before the camera got low enough to watch it happen.
        if (!this.growChosen) this.grow = { startAt: performance.now(), sweepMs: DEFAULT_GROW_SWEEP_MS };
        map.triggerRepaint();
      },
    );
  }

  onRemove() {
    this.removed = true;
    for (const mesh of [this.woodMesh, this.crownMesh, this.aoMesh, this.groundShadow]) {
      mesh?.geometry.dispose();
      const material = mesh?.material as THREE.MeshBasicMaterial | undefined;
      material?.map?.dispose();
      material?.dispose();
    }
    this.envTarget?.dispose();
    this.envTarget = null;
    if (this.ssao) {
      const s = this.ssao;
      for (const t of [s.normalTarget, s.aoTarget, s.blurTarget]) t.dispose();
      for (const m of [s.normalMaterial, s.aoMaterial, s.blurMaterial]) m.dispose();
      s.quad.geometry.dispose();
      s.ground.geometry.dispose();
      (s.ground.material as THREE.Material).dispose();
      this.ssao = null;
    }
    this.ssaoTexture.value?.dispose();
    this.sun?.shadow.dispose();
    this.sun = null;
    this.woodMesh = null;
    this.crownMesh = null;
    this.aoMesh = null;
    this.groundShadow = null;
    this.scene = null;
    // Not disposed: it wraps MapLibre's own GL context.
    this.renderer = null;
    this.map = null;
  }

  /** Restarts the grow-in on a new schedule — the intro flight's cue. */
  setGrow(grow: GrowSchedule) {
    this.grow = grow;
    this.growChosen = true;
    this.matricesDirty = true;
    this.map?.triggerRepaint();
  }

  /**
   * The index (into `options.trees`) of the tree under a canvas-relative CSS
   * pixel, or null. Uses the projection from the most recent frame, which is
   * the one the reader is actually looking at.
   */
  pick(px: number, py: number): number | null {
    const map = this.map;
    const inverse = this.clipToScene;
    if (!map || !this.hasProjection || !inverse || !this.crownMesh || !this.woodMesh || !this.raycaster) return null;
    const canvas = map.getCanvas();
    const nx = (px / canvas.clientWidth) * 2 - 1;
    const ny = 1 - (py / canvas.clientHeight) * 2;
    const origin = this.rayOrigin!.set(nx, ny, -1).applyMatrix4(inverse);
    const direction = this.rayFar!.set(nx, ny, 1).applyMatrix4(inverse).sub(origin).normalize();
    this.raycaster.set(origin, direction);
    const hit = this.raycaster
      .intersectObjects([this.crownMesh, this.woodMesh], false)
      .find((h) => h.instanceId !== undefined);
    return hit?.instanceId ?? null;
  }

  /**
   * Where a tree's crown top lands on screen, canvas-relative CSS pixels —
   * the tooltip's anchor, so it sits on the tree rather than chasing the
   * cursor. Null before the first frame or if the point is behind the eye.
   */
  anchorOf(index: number): { x: number; y: number } | null {
    const map = this.map;
    const m = this.sceneToClip;
    const t = this.options.trees[index];
    if (!map || !m || !t || !this.hasProjection) return null;
    const top = t.condition === "defoliated" ? TRUNK_TOP : TRUNK_TOP + CROWN_HALF_HEIGHT * 1.35;
    const swell = 1 + (HOVER_SCALE - 1) * (this.emphasis[index] ?? 0);
    const v = this.scratchVec4!.set(this.x[index], this.y[index] + t.heightM * top * swell, this.z[index], 1).applyMatrix4(m);
    if (v.w <= 0) return null;
    const canvas = map.getCanvas();
    return { x: ((v.x / v.w + 1) / 2) * canvas.clientWidth, y: ((1 - v.y / v.w) / 2) * canvas.clientHeight };
  }

  /** Which tree (or none) is focused. The visual change is eased in `render`. */
  setHovered(index: number | null) {
    if (index === this.hovered) return;
    this.hovered = index;
    if (index !== null) this.active.add(index);
    this.matricesDirty = true;
    this.map?.triggerRepaint();
  }

  private paintCrown(i: number) {
    const mesh = this.crownMesh;
    const color = this.color;
    if (!mesh || !color) return;
    color.set(CONDITION_COLOR[this.options.trees[i].condition]);
    const e = this.emphasis[i];
    if (e > 0) color.lerp(this.white!, HOVER_LIFT * e);
    mesh.setColorAt(i, color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Patches a lit tree material with its surface detail and the stand-wide
   * effects. All procedural, keyed on the *object-space* position (so a
   * leaf pattern belongs to its tree and doesn't swim as the camera moves),
   * no textures or UVs:
   * - **Bump**, via screen-space derivatives (Mikkelsen's `perturbNormalArb`
   *   form): leaf clusters on crowns, vertical furrows on bark — detail far
   *   finer than the mesh, at every zoom.
   * - **Leaf colour variation** — value only, so the health hue survives.
   * - **Translucency** (crowns): sunlight through the canopy when the eye
   *   looks toward the sun, plus a wrap term on the shadowed side.
   * - **Bark roughness** varies with the furrows.
   * - SSAO after three's own `aomap_fragment`, and the per-instance haze mix
   *   after tone mapping (so `FADE_COLOR` is the exact on-screen grey).
   */
  private installFade(three: typeof THREE, material: THREE.Material, kind: "leaf" | "bark") {
    const sunDir = this.toSun(three);
    const sunColor = new three.Color(SUN_COLOR).multiplyScalar(SUN_INTENSITY);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeColor = { value: new three.Vector3(...FADE_COLOR) };
      shader.uniforms.uSSAO = this.ssaoTexture;
      shader.uniforms.uSSAOSize = this.ssaoSize;
      shader.uniforms.uSunDir = { value: sunDir };
      shader.uniforms.uSunColor = { value: new three.Vector3(sunColor.r, sunColor.g, sunColor.b) };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float instanceFade;\nvarying float vFade;\nvarying vec3 vObj;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFade = instanceFade;\nvObj = position;");
      const leaf = kind === "leaf";
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform vec3 uFadeColor; varying float vFade; varying vec3 vObj;
          uniform sampler2D uSSAO; uniform vec2 uSSAOSize; uniform vec3 uSunDir; uniform vec3 uSunColor;
          float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float vnoise(vec3 p) {
            vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
          }
          float surfaceHeight(vec3 p) {
            ${leaf
              ? "return vnoise(p * 4.5) * 0.65 + vnoise(p * 10.0) * 0.35;"
              : "float a = atan(p.z, p.x); return 0.6 * abs(sin(a * 9.0 + vnoise(p * 30.0) * 2.5)) + 0.4 * vnoise(p * vec3(60.0, 8.0, 60.0));"}
          }`,
        )
        .replace(
          "#include <color_fragment>",
          leaf
            ? "#include <color_fragment>\ndiffuseColor.rgb *= 0.86 + 0.26 * vnoise(vObj * 5.0);"
            : "#include <color_fragment>\ndiffuseColor.rgb *= 0.8 + 0.35 * surfaceHeight(vObj);",
        )
        .replace(
          "#include <roughnessmap_fragment>",
          leaf ? "#include <roughnessmap_fragment>" : "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (0.5 - surfaceHeight(vObj)) * 0.12, 0.0, 1.0);",
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          {
            vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
            float hC = surfaceHeight(vObj);
            float dhdx = dFdx(hC), dhdy = dFdy(hC);
            vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
            float det = dot(dpdx, r1);
            vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
            normal = normalize(abs(det) * normal - grad * ${leaf ? "0.45" : "0.6"});
          }`,
        )
        .replace(
          "#include <aomap_fragment>",
          `#include <aomap_fragment>
          float ssao = texture2D(uSSAO, gl_FragCoord.xy / uSSAOSize).r;
          reflectedLight.indirectDiffuse *= ssao;
          reflectedLight.indirectSpecular *= ssao;
          reflectedLight.directDiffuse *= mix(1.0, ssao, ${SSAO_DIRECT.toFixed(2)});
          ${leaf ? `{
            vec3 V = normalize(vViewPosition);
            float through = pow(max(dot(-V, uSunDir), 0.0), 4.0) * 0.55;
            float wrap = max(dot(-normal, uSunDir), 0.0) * 0.18;
            reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * RECIPROCAL_PI * (through + wrap) * ssao;
          }` : ""}`,
        )
        .replace("#include <dithering_fragment>", "gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, vFade);\n#include <dithering_fragment>");
    };
    material.customProgramCacheKey = () => `mangrove-${kind}`;
  }

  private build(three: typeof THREE, utils: GeometryUtils, map: maplibregl.Map, gl: WebGL2RenderingContext) {
    const renderer = new three.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    renderer.autoClear = false;
    renderer.toneMapping = three.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = three.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.renderer = renderer;
    this.scene = new three.Scene();
    this.camera = new three.Camera();

    this.dummy = new three.Object3D();
    this.scratchVec = new three.Vector3();
    this.scratchVec4 = new three.Vector4();
    this.scratchEuler = new three.Euler();
    this.color = new three.Color();
    this.white = new three.Color(0xffffff);
    this.mvpMat = new three.Matrix4();
    this.localMat = new three.Matrix4();
    this.localScale = new three.Vector3();
    this.zUpMat = new three.Matrix4().makeRotationX(Math.PI / 2);
    this.eyeMat = new three.Matrix4();
    this.sceneToClip = new three.Matrix4();
    this.clipToScene = new three.Matrix4();
    this.raycaster = new three.Raycaster();
    this.rayOrigin = new three.Vector3();
    this.rayFar = new three.Vector3();

    const count = this.options.trees.length;
    this.emphasis = new Float32Array(count);
    this.fadeAttr = new three.InstancedBufferAttribute(new Float32Array(count), 1);

    const wood = utils.mergeGeometries(this.buildWoodParts(three)) ?? new three.CylinderGeometry(0.03, 0.04, 1, 6);
    wood.setAttribute("instanceFade", this.fadeAttr);
    const woodMaterial = new three.MeshStandardMaterial({
      color: WOOD_COLOR,
      roughness: WOOD_ROUGHNESS,
      metalness: 0,
      vertexColors: true,
    });
    this.installFade(three, woodMaterial, "bark");
    this.woodMesh = new three.InstancedMesh(wood, woodMaterial, count);
    this.woodMesh.frustumCulled = false;
    this.woodMesh.castShadow = true;
    this.woodMesh.receiveShadow = true;
    this.scene.add(this.woodMesh);

    const crown = this.buildCrownGeometry(three, utils);
    crown.setAttribute("instanceFade", this.fadeAttr);
    const crownMaterial = new three.MeshPhysicalMaterial({
      roughness: FOLIAGE_ROUGHNESS,
      metalness: 0,
      specularIntensity: FOLIAGE_SPECULAR,
      sheen: FOLIAGE_SHEEN,
      sheenRoughness: 0.65,
      sheenColor: new three.Color(0xe9ecdf),
      vertexColors: true,
    });
    this.installFade(three, crownMaterial, "leaf");
    this.crownMesh = new three.InstancedMesh(crown, crownMaterial, count);
    this.crownMesh.frustumCulled = false;
    this.crownMesh.castShadow = true;
    this.crownMesh.receiveShadow = true;
    this.scene.add(this.crownMesh);

    // Channel 1 is the SSAO pre-pass: trees and ground only.
    this.woodMesh.layers.enable(1);
    this.crownMesh.layers.enable(1);

    this.placeTrees();
    this.buildLighting(three);
    this.buildGroundOcclusion(three);
    this.buildSSAO(three);
    for (let i = 0; i < count; i++) this.paintCrown(i);
  }

  /**
   * The sun, the ground that catches its shadows, and a fallback sky fill.
   * Sized off `standRadius`, so it must run after `placeTrees`. The image-based
   * sky light itself is generated on the first `render` — see `buildSky`.
   */
  private buildLighting(three: typeof THREE) {
    const scene = this.scene!;
    const toSun = this.toSun(three);

    const R = this.standRadius;
    const reach = R * 2 + 60;
    const sun = new three.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    sun.position.copy(toSun).multiplyScalar(reach);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    // An orthographic volume has no natural extent (three's ±5 m default
    // would leave all but the centre tree unshadowed) — fit it to the stand.
    const shadowCamera = sun.shadow.camera as THREE.OrthographicCamera;
    shadowCamera.left = -R;
    shadowCamera.right = R;
    shadowCamera.top = R;
    shadowCamera.bottom = -R;
    shadowCamera.near = 1;
    shadowCamera.far = reach + R * 2;
    shadowCamera.updateProjectionMatrix();
    sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    scene.add(sun.target);
    scene.add(sun);
    this.sun = sun;

    // Only until the generated sky replaces it (or for good, if it can't be
    // generated) — see `buildSky`.
    const hemi = new three.HemisphereLight(0xd4e4f7, 0xb3ad9f, FALLBACK_HEMI_INTENSITY);
    hemi.name = "fallback-sky";
    scene.add(hemi);

    // The basemap is MapLibre's pixels and can't receive anything, so an
    // invisible plane does: `ShadowMaterial` draws only where it is shadowed.
    const plane = new three.PlaneGeometry(R * 2 + 40, R * 2 + 40);
    plane.rotateX(-Math.PI / 2);
    const ground = new three.Mesh(
      plane,
      new three.ShadowMaterial({ color: SHADOW_COLOR, opacity: SHADOW_OPACITY, depthWrite: false }),
    );
    ground.position.y = 0.03;
    ground.receiveShadow = true;
    ground.frustumCulled = false;
    ground.renderOrder = -1;
    scene.add(ground);
    this.groundShadow = ground;
  }

  private toSun(three: typeof THREE): THREE.Vector3 {
    const az = (SUN_AZIMUTH_DEG * Math.PI) / 180;
    const el = (SUN_ELEVATION_DEG * Math.PI) / 180;
    // Scene axes: +X east, +Y up, +Z south — north is −Z.
    return new three.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  /**
   * Image-based sky light: a gradient dome (zenith blue, hazy horizon, sandy
   * ground) with the sun's disc and glow at the real sun direction, prefiltered
   * into a PMREM. Run inside `render` on the first frame — PMREM generation
   * drives GL itself, and MapLibre only expects foreign GL state changes
   * during a custom layer's render hook, which it cleans up after.
   */
  private buildSky(three: typeof THREE, renderer: THREE.WebGLRenderer) {
    this.envPending = false;
    try {
      const sky = new three.Scene();
      const dome = new three.Mesh(
        new three.SphereGeometry(1, 48, 24),
        new three.ShaderMaterial({
          side: three.BackSide,
          depthWrite: false,
          uniforms: {
            uSun: { value: this.toSun(three) },
            uZenith: { value: new three.Vector3(...SKY_ZENITH) },
            uHorizon: { value: new three.Vector3(...SKY_HORIZON) },
            uGround: { value: new three.Vector3(...SKY_GROUND) },
          },
          vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
          fragmentShader: `
            uniform vec3 uSun, uZenith, uHorizon, uGround; varying vec3 vDir;
            void main() {
              vec3 d = normalize(vDir);
              float up = d.y;
              vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
              vec3 col = up >= 0.0 ? sky : mix(uHorizon, uGround, pow(clamp(-up, 0.0, 1.0), 0.35));
              float s = max(dot(d, normalize(uSun)), 0.0);
              col += vec3(1.0, 0.93, 0.8) * (pow(s, 900.0) * 30.0 + pow(s, 12.0) * 0.35);
              gl_FragColor = vec4(col, 1.0);
            }`,
        }),
      );
      sky.add(dome);
      const pmrem = new three.PMREMGenerator(renderer);
      this.envTarget = pmrem.fromScene(sky, 0.02);
      pmrem.dispose();
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      this.scene!.environment = this.envTarget.texture;
      this.scene!.environmentIntensity = ENV_INTENSITY;
      const fallback = this.scene!.getObjectByName("fallback-sky");
      if (fallback) this.scene!.remove(fallback);
    } catch (err) {
      console.warn("[mangroves] sky lighting unavailable, using hemisphere fill:", err);
    }
  }

  /**
   * One soft pool of ambient occlusion per tree: a radial gradient multiplied
   * onto whatever is under it. Blended `ZERO, SRC_COLOR` on colour and
   * `ZERO, ONE` on alpha — `MultiplyBlending` would multiply the premultiplied
   * canvas's alpha too and brighten the ground (3D-CANOPY.md §6b).
   */
  private buildGroundOcclusion(three: typeof THREE) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const dark = Math.round(GROUND_AO_DARKEST * 255);
    g.addColorStop(0, `rgb(${dark},${dark},${dark})`);
    g.addColorStop(0.55, `rgb(${Math.round((dark + 255) / 2)},${Math.round((dark + 255) / 2)},${Math.round((dark + 255) / 2)})`);
    g.addColorStop(1, "rgb(255,255,255)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new three.CanvasTexture(canvas);
    texture.colorSpace = three.SRGBColorSpace;

    const disc = new three.CircleGeometry(1, 28);
    disc.rotateX(-Math.PI / 2);
    const material = new three.MeshBasicMaterial({
      map: texture,
      blending: three.CustomBlending,
      blendSrc: three.ZeroFactor,
      blendDst: three.SrcColorFactor,
      blendSrcAlpha: three.ZeroFactor,
      blendDstAlpha: three.OneFactor,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    // Faded out with the rest of the stand: mixed toward white (multiply's
    // identity) by one uniform rather than per instance — the pools under a
    // dissolving stand should thin out together.
    const strength = this.aoStrength;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uStrength = strength;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uStrength;")
        .replace("#include <dithering_fragment>", "gl_FragColor.rgb = mix(vec3(1.0), gl_FragColor.rgb, uStrength);\n#include <dithering_fragment>");
    };
    const count = this.options.trees.length;
    const mesh = new three.InstancedMesh(disc, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    const dummy = this.dummy!;
    for (let i = 0; i < count; i++) {
      const r = this.options.trees[i].crownRadiusM * 1.35;
      dummy.position.set(this.x[i], this.y[i] + 0.02, this.z[i]);
      dummy.quaternion.identity();
      dummy.scale.set(r, 1, r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    this.scene!.add(mesh);
    this.aoMesh = mesh;
  }

  /**
   * The SSAO passes' targets, shaders and the ground that receives the result.
   * Targets start 1×1 and are sized to half the canvas on first use.
   */
  private buildSSAO(three: typeof THREE) {
    const white = new three.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    this.ssaoTexture.value = white;
    this.ssaoSize.value = new three.Vector2(1, 1);

    // 32-bit float depth: at 16 bits flat mud 200 m away reconstructs with
    // ±7 cm of jitter — enough relief to occlude itself under SAO.
    const depthTexture = new three.DepthTexture(1, 1);
    depthTexture.type = three.FloatType;
    const normalTarget = new three.WebGLRenderTarget(1, 1, { depthTexture, depthBuffer: true });
    const aoTarget = new three.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const blurTarget = new three.WebGLRenderTarget(1, 1, { depthBuffer: false });

    // A hemisphere kernel, denser near its centre (the classic Crytek /
    // LearnOpenGL distribution), deterministic so AO never flickers between
    // reloads.
    const kernel: THREE.Vector3[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < SSAO_SAMPLES; i++) {
      const v = new three.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand()).normalize();
      const t = i / SSAO_SAMPLES;
      v.multiplyScalar((0.1 + 0.9 * t * t) * (0.5 + 0.5 * rand()));
      kernel.push(v);
    }

    const quadVertex = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
    // Snapped to the depth texel's centre, so the ray and the depth come from
    // the same texel: pairing a sample's exact screen position with its
    // nearest texel's depth put flat ground ~14 cm off its own plane at this
    // grazing tilt (one half-res texel spans ~1 m of mud), which SAO then
    // counted as relief.
    const reconstruct = `
      uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uDepthSize;
      vec3 posAt(vec2 uv) {
        uv = (floor(uv * uDepthSize) + 0.5) / uDepthSize;
        float d = texture2D(tDepth, uv).x;
        vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return p.xyz / p.w;
      }`;
    const aoMaterial = new three.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDepth: { value: depthTexture },
        tNormal: { value: normalTarget.texture },
        uDepthSize: { value: new three.Vector2(1, 1) },
        uProj: { value: new three.Matrix4() },
        uProjInv: { value: new three.Matrix4() },
        uKernel: { value: kernel },
        uRadius: { value: SSAO_RADIUS_M },
        uIntensity: { value: SSAO_INTENSITY },
        uBias: { value: SSAO_BIAS_M },
      },
      vertexShader: quadVertex,
      fragmentShader: `
        ${reconstruct}
        uniform sampler2D tNormal; uniform mat4 uProj; uniform vec3 uKernel[${SSAO_SAMPLES}];
        uniform float uRadius, uIntensity, uBias;
        varying vec2 vUv;
        void main() {
          float depth = texture2D(tDepth, vUv).x;
          if (depth >= 1.0) { gl_FragColor = vec4(1.0); return; }
          vec3 P = posAt(vUv);
          vec3 N = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
          // A 4×4 tiled rotation — removed exactly by the 4×4 blur after.
          vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
          float a = (cell.x + cell.y * 4.0) / 16.0 * 6.2831853;
          vec3 up = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 T0 = normalize(cross(up, N));
          vec3 B0 = cross(N, T0);
          vec3 T = T0 * cos(a) + B0 * sin(a);
          vec3 B = cross(N, T);
          // Scalable Ambient Obscurance (McGuire et al.): each neighbour Q
          // counts by how far it rises above P's own tangent plane — the
          // cosine of v = Q − P against N — cubically faded out by distance.
          // A depth-difference test ("is Q nearer than the sample?") was the
          // first version, and failed on this very view: at a grazing tilt
          // one half-res depth texel spans ~1 m of mud, so flat ground
          // occluded itself (open ground read 0.90, not 1.0). A flat plane
          // gives v·N = 0 exactly, however coarse the depth.
          float r2 = uRadius * uRadius;
          float occlusion = 0.0;
          for (int i = 0; i < ${SSAO_SAMPLES}; i++) {
            vec3 k = uKernel[i];
            vec3 S = P + (T * k.x + B * k.y + N * k.z) * uRadius;
            vec4 c = uProj * vec4(S, 1.0);
            vec2 suv = c.xy / c.w * 0.5 + 0.5;
            if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
            vec3 v = posAt(suv) - P;
            float vv = dot(v, v);
            float falloff = max(r2 - vv, 0.0) / r2;
            occlusion += falloff * falloff * falloff * max(dot(v, N) / sqrt(vv + 1e-4) - uBias, 0.0);
          }
          float ao = pow(clamp(1.0 - uIntensity * 2.0 * occlusion / float(${SSAO_SAMPLES}), 0.0, 1.0), 1.4);
          gl_FragColor = vec4(vec3(ao), 1.0);
        }`,
    });
    const blurMaterial = new three.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tAO: { value: aoTarget.texture },
        tDepth: { value: depthTexture },
        uDepthSize: { value: new three.Vector2(1, 1) },
        uProjInv: { value: new three.Matrix4() },
        uTexel: { value: new three.Vector2(1, 1) },
      },
      vertexShader: quadVertex,
      fragmentShader: `
        ${reconstruct}
        uniform sampler2D tAO; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          float centre = length(posAt(vUv));
          float sum = 0.0, weight = 0.0;
          for (int x = -2; x < 2; x++) for (int y = -2; y < 2; y++) {
            vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
            // Skip taps across a depth edge, so a crown's AO doesn't halo
            // onto the ground behind its silhouette.
            float w = abs(length(posAt(uv)) - centre) < 0.6 ? 1.0 : 0.0;
            sum += texture2D(tAO, uv).r * w;
            weight += w;
          }
          gl_FragColor = vec4(vec3(weight > 0.0 ? sum / weight : 1.0), 1.0);
        }`,
    });

    const quadScene = new three.Scene();
    const quad = new three.Mesh(new three.PlaneGeometry(2, 2), aoMaterial);
    quad.frustumCulled = false;
    quadScene.add(quad);

    // The ground that both feeds the pre-pass (channel 1, as depth/normals)
    // and receives the result in the main pass (channel 0, multiplied onto
    // the basemap). Same `ZERO, SRC_COLOR` / `ZERO, ONE` blend as the pools.
    const R = this.standRadius;
    const plane = new three.PlaneGeometry(R * 2 + 40, R * 2 + 40);
    plane.rotateX(-Math.PI / 2);
    const ground = new three.Mesh(
      plane,
      new three.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: three.CustomBlending,
        blendSrc: three.ZeroFactor,
        blendDst: three.SrcColorFactor,
        blendSrcAlpha: three.ZeroFactor,
        blendDstAlpha: three.OneFactor,
        uniforms: { uSSAO: this.ssaoTexture, uSSAOSize: this.ssaoSize, uStrength: this.ssaoGroundStrength },
        vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `
          uniform sampler2D uSSAO; uniform vec2 uSSAOSize; uniform float uStrength;
          void main() {
            float ao = texture2D(uSSAO, gl_FragCoord.xy / uSSAOSize).r;
            gl_FragColor = vec4(vec3(mix(1.0, ao, uStrength)), 1.0);
          }`,
      }),
    );
    ground.position.y = 0.025;
    ground.frustumCulled = false;
    ground.renderOrder = -1;
    ground.layers.enable(1);
    this.scene!.add(ground);

    this.ssao = {
      normalTarget,
      aoTarget,
      blurTarget,
      normalMaterial: new three.MeshNormalMaterial(),
      aoMaterial,
      blurMaterial,
      quad,
      quadScene,
      quadCamera: new three.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      ground,
    };
  }

  /**
   * Runs the three SSAO passes for this frame's camera and publishes the
   * blurred result through `ssaoTexture`. Any failure (an exotic GPU without
   * depth textures, say) switches SSAO off for good and leaves the white
   * fallback in place, so the stand still renders — just without it.
   */
  private renderSSAO(renderer: THREE.WebGLRenderer, camera: THREE.Camera, canvas: HTMLCanvasElement) {
    const s = this.ssao;
    const scene = this.scene;
    if (!s || !scene) return;
    try {
      const w = Math.max(1, canvas.width);
      const h = Math.max(1, canvas.height);
      if (s.normalTarget.width !== w || s.normalTarget.height !== h) {
        s.normalTarget.setSize(w, h);
        s.aoTarget.setSize(w, h);
        s.blurTarget.setSize(w, h);
      }

      // Pre-pass: depth + normals of the trees and the ground (channel 1).
      // At the *full* depth range: MapLibre squeezes 3D layers into a slice
      // of it (`depthRangeFor3D`, via `gl.depthRange`) before calling us, and
      // depth written under that slice doesn't invert through the projection
      // — measured, it put open ground at ~100 m from an eye 315 m away.
      // The main pass keeps MapLibre's range, so it's restored straight after.
      const gl = renderer.getContext();
      const range = gl.getParameter(gl.DEPTH_RANGE) as Float32Array;
      gl.depthRange(0, 1);
      const override = scene.overrideMaterial;
      scene.overrideMaterial = s.normalMaterial;
      camera.layers.set(1);
      renderer.setRenderTarget(s.normalTarget);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      camera.layers.set(0);
      scene.overrideMaterial = override;
      gl.depthRange(range[0], range[1]);

      const inverse = camera.projectionMatrixInverse;
      (s.aoMaterial.uniforms.uDepthSize.value as THREE.Vector2).set(w, h);
      (s.blurMaterial.uniforms.uDepthSize.value as THREE.Vector2).set(w, h);
      s.aoMaterial.uniforms.uProj.value.copy(camera.projectionMatrix);
      s.aoMaterial.uniforms.uProjInv.value.copy(inverse);
      s.quad.material = s.aoMaterial;
      renderer.setRenderTarget(s.aoTarget);
      renderer.render(s.quadScene, s.quadCamera);

      s.blurMaterial.uniforms.uProjInv.value.copy(inverse);
      (s.blurMaterial.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
      s.quad.material = s.blurMaterial;
      renderer.setRenderTarget(s.blurTarget);
      renderer.render(s.quadScene, s.quadCamera);

      this.ssaoTexture.value = s.blurTarget.texture;
      this.ssaoSize.value!.set(canvas.width, canvas.height);
    } catch (err) {
      console.warn("[mangroves] SSAO unavailable:", err);
      this.ssao = null;
    } finally {
      renderer.setRenderTarget(null);
    }
  }

  /** Trunk plus prop roots, for a tree of height 1 standing at the origin. */
  private buildWoodParts(three: typeof THREE): THREE.BufferGeometry[] {
    const trunk = new three.CylinderGeometry(0.026, 0.038, TRUNK_TOP - TRUNK_BASE, 14, 6);
    trunk.translate(0, (TRUNK_BASE + TRUNK_TOP) / 2, 0);
    const parts: THREE.BufferGeometry[] = [trunk];
    for (let k = 0; k < ROOT_COUNT; k++) {
      const angle = (k / ROOT_COUNT) * Math.PI * 2 + 0.35;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Out almost level first, then down into the mud — the arch is what
      // separates a stilt root from a straight strut.
      const curve = new three.QuadraticBezierCurve3(
        new three.Vector3(0, ROOT_JOIN, 0),
        new three.Vector3(cos * ROOT_SPREAD * 0.75, ROOT_JOIN * 0.95, sin * ROOT_SPREAD * 0.75),
        new three.Vector3(cos * ROOT_SPREAD, -0.02, sin * ROOT_SPREAD),
      );
      parts.push(new three.TubeGeometry(curve, 16, 0.013, 8, false));
    }
    // Wet tide line: the lowest tenth of every part is darker, fading in.
    for (const part of parts) {
      const position = part.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        const shade = 0.5 + 0.5 * smoothstep(0.02, 0.12, position.getY(i));
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
      }
      part.setAttribute("color", new three.BufferAttribute(colors, 3));
    }
    return parts;
  }

  /**
   * A unit crown: overlapping leaf clusters, each an icosphere lumped by
   * smooth noise and welded (`mergeVertices`) so it shades smoothly, merged
   * into one geometry, underside flattened, and normalised so ±1 across and
   * +1 at the top — the per-instance scale then sets real radius and height.
   * Ambient occlusion goes into vertex colours: darker beneath and inside.
   */
  private buildCrownGeometry(three: typeof THREE, utils: GeometryUtils): THREE.BufferGeometry {
    const vec = new three.Vector3();
    const lobes: THREE.BufferGeometry[] = [];
    CROWN_LOBES.forEach(([cx, cy, cz, r, detail], lobeIndex) => {
      let geometry: THREE.BufferGeometry = new three.IcosahedronGeometry(r, detail);
      geometry.deleteAttribute("normal");
      geometry.deleteAttribute("uv");
      geometry = utils.mergeVertices(geometry);
      const position = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        vec.fromBufferAttribute(position, i);
        const n = vec.clone().normalize();
        const d = 1 + 0.16 * lumpNoise(n.x * 2 + lobeIndex, n.y * 2, n.z * 2 - lobeIndex);
        vec.multiplyScalar(d).add(new three.Vector3(cx, cy, cz));
        position.setXYZ(i, vec.x, vec.y, vec.z);
      }
      lobes.push(geometry);
    });
    const crown = utils.mergeGeometries(lobes) ?? lobes[0];

    const position = crown.attributes.position as THREE.BufferAttribute;
    crown.computeBoundingBox();
    const box = crown.boundingBox!;
    const halfWidth = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
    const flattenBelow = -0.08;
    let top = -Infinity;
    for (let i = 0; i < position.count; i++) {
      let y = position.getY(i);
      if (y < flattenBelow) y = flattenBelow + (y - flattenBelow) * 0.45;
      position.setY(i, y);
      top = Math.max(top, y);
    }
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) / halfWidth;
      const y = position.getY(i) / top;
      const z = position.getZ(i) / halfWidth;
      position.setXYZ(i, x, y, z);
      const radial = Math.min(1, Math.hypot(x, z));
      const occlusion = 0.58 + 0.42 * smoothstep(-0.45, 0.85, y + radial * 0.25);
      const jitter = 0.9 + 0.1 * (0.5 + 0.5 * lumpNoise(x * 6.1, y * 5.3, z * 6.7));
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = occlusion * jitter;
    }
    crown.setAttribute("color", new three.BufferAttribute(colors, 3));
    crown.computeVertexNormals();
    crown.computeBoundingSphere();
    return crown;
  }

  private placeTrees() {
    const trees = this.options.trees;
    const count = trees.length;
    const lngs = trees.map((t) => t.lng);
    const lats = trees.map((t) => t.lat);
    const centre: [number, number] = [
      (Math.min(...lngs) + Math.max(...lngs)) / 2,
      (Math.min(...lats) + Math.max(...lats)) / 2,
    ];
    this.originLngLat = centre;
    const origin = maplibregl.MercatorCoordinate.fromLngLat(centre, 0);
    this.originX = origin.x;
    this.originY = origin.y;
    this.originZ = origin.z;
    this.meterScale = origin.meterInMercatorCoordinateUnits();

    this.x = new Float32Array(count);
    this.z = new Float32Array(count);
    this.y = new Float32Array(count);
    this.sweepFrac = new Float32Array(count);
    let minX = Infinity;
    let maxX = -Infinity;
    let radius = 0;
    for (let i = 0; i < count; i++) {
      const merc = maplibregl.MercatorCoordinate.fromLngLat([trees[i].lng, trees[i].lat], 0);
      this.x[i] = (merc.x - this.originX) / this.meterScale;
      // Straight copy, not a negation — see 3D-CANOPY.md §2.
      this.z[i] = (merc.y - this.originY) / this.meterScale;
      minX = Math.min(minX, this.x[i]);
      maxX = Math.max(maxX, this.x[i]);
      radius = Math.max(radius, Math.hypot(this.x[i], this.z[i]) + trees[i].crownRadiusM + trees[i].heightM);
    }
    this.standRadius = radius + 4;
    const span = maxX - minX || 1;
    for (let i = 0; i < count; i++) {
      // West → east, jittered by the tree's own spin so the wavefront is a
      // ragged edge without a second random source.
      this.sweepFrac[i] = (this.x[i] - minX) / span + (trees[i].spin / (Math.PI * 2)) * 0.05;
    }
    this.matricesDirty = true;
  }

  /**
   * Stands the scene on the terrain, every frame. `queryTerrainElevation` is
   * relative to the terrain under the *screen centre*, and so is the matrix
   * MapLibre hands `render` — see 3D-CANOPY.md §9b.
   */
  private updateElevations(map: maplibregl.Map) {
    const trees = this.options.trees;
    const terrain = !!map.getTerrain();
    const originOffset = terrain ? (map.queryTerrainElevation(this.originLngLat) ?? 0) : 0;
    this.originZ = maplibregl.MercatorCoordinate.fromLngLat(this.originLngLat, originOffset).z;
    if (!terrain) return;
    for (let i = 0; i < trees.length; i++) {
      const ground = map.queryTerrainElevation({ lng: trees[i].lng, lat: trees[i].lat }) ?? originOffset;
      const y = ground - originOffset;
      if (Math.abs(y - this.y[i]) > 0.01) {
        this.y[i] = y;
        this.matricesDirty = true;
      }
    }
  }

  /**
   * One damped step of the hover state toward its targets. Returns whether
   * anything is still moving, so `render` knows to ask for another frame.
   */
  private stepHover(dt: number, reduced: boolean): boolean {
    const kEmph = reduced ? 1 : 1 - Math.exp(-dt / EMPHASIS_TAU_MS);
    const kFade = reduced ? 1 : 1 - Math.exp(-dt / FADE_TAU_MS);
    let moving = false;

    const fadeTarget = this.hovered === null ? 0 : 1;
    let fade = this.fade + (fadeTarget - this.fade) * kFade;
    if (Math.abs(fadeTarget - fade) < 0.002) fade = fadeTarget;
    const fadeChanged = fade !== this.fade;
    this.fade = fade;
    if (fade !== fadeTarget) moving = true;

    for (const i of this.active) {
      const target = i === this.hovered ? 1 : 0;
      let e = this.emphasis[i] + (target - this.emphasis[i]) * kEmph;
      if (Math.abs(target - e) < 0.002) e = target;
      if (e !== this.emphasis[i]) {
        this.emphasis[i] = e;
        this.paintCrown(i);
      }
      if (e !== target) moving = true;
      if (e === 0 && target === 0) this.active.delete(i);
    }

    if (fadeChanged || moving) {
      const attr = this.fadeAttr!;
      const values = attr.array as Float32Array;
      for (let i = 0; i < values.length; i++) values[i] = FADE_MAX * this.fade * (1 - this.emphasis[i]);
      attr.needsUpdate = true;
      const shadowMaterial = this.groundShadow?.material as THREE.ShadowMaterial | undefined;
      if (shadowMaterial) shadowMaterial.opacity = SHADOW_OPACITY * (1 - 0.6 * this.fade);
      this.aoStrength.value = 1 - 0.75 * this.fade;
      this.ssaoGroundStrength.value = 1 - 0.7 * this.fade;
    }
    return moving || this.active.size > 0;
  }

  private writeMatrices(now: number, reduced: boolean) {
    const trees = this.options.trees;
    const dummy = this.dummy!;
    const wood = this.woodMesh!;
    const crown = this.crownMesh!;
    const elapsed = now - this.grow.startAt;
    const windPhase = (now / WIND_PERIOD_MS) * Math.PI * 2;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      let grow = 1;
      if (!reduced) {
        const k = (elapsed - this.sweepFrac[i] * this.grow.sweepMs) / GROW_MS;
        grow = k <= 0 ? 0 : k >= 1 ? 1 : easeOutBack(k);
      }
      if (grow <= 0) {
        dummy.position.set(0, -1e6, 0);
        dummy.quaternion.identity();
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        wood.setMatrixAt(i, dummy.matrix);
        crown.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const h = t.heightM * grow;
      const e = this.emphasis[i];
      // Wind scales with emphasis, so it breathes in and out with the hover
      // rather than starting and stopping; pivots at the ground, so the crown
      // swings furthest.
      let leanX = 0;
      let leanZ = 0;
      let flutter = 1;
      if (e > 0 && !reduced) {
        const w = windPhase + t.spin;
        leanZ = WIND_LEAN * e * (Math.sin(w) * 0.75 + Math.sin(w * 2.3 + 1) * 0.25);
        leanX = WIND_LEAN * 0.45 * e * Math.sin(w * 1.7 + 0.5);
        flutter = 1 + 0.025 * e * Math.sin(w * 3.1);
      }
      this.scratchEuler!.set(leanX, t.spin, leanZ);
      dummy.quaternion.setFromEuler(this.scratchEuler!);
      dummy.position.set(this.x[i], this.y[i], this.z[i]);
      dummy.scale.set(h, h, h);
      dummy.updateMatrix();
      wood.setMatrixAt(i, dummy.matrix);

      // A defoliated mangrove is bare wood — no crown at all.
      if (t.condition === "defoliated") {
        dummy.position.set(0, -1e6, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        crown.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const swell = (1 + (HOVER_SCALE - 1) * e) * flutter;
      const half = CROWN_HALF_HEIGHT * h * swell;
      const radius = t.crownRadiusM * grow * swell;
      const up = this.scratchVec!.set(0, TRUNK_TOP * h + half * 0.35, 0).applyQuaternion(dummy.quaternion);
      dummy.position.set(this.x[i] + up.x, this.y[i] + up.y, this.z[i] + up.z);
      dummy.scale.set(radius, half, radius);
      dummy.updateMatrix();
      crown.setMatrixAt(i, dummy.matrix);
    }
    wood.instanceMatrix.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
    // The raycaster tests the instanced mesh's bounding sphere before any
    // instance, and three caches it — stale after every matrix rewrite.
    wood.boundingSphere = null;
    crown.boundingSphere = null;
    // The trees moved, so the sun's view of them is stale too.
    this.renderer!.shadowMap.needsUpdate = true;
  }

  /**
   * Recovers the viewer's position, in scene metres, from a scene→clip matrix.
   * For any perspective projection the eye is the one point that lands at
   * clip-space w = 0 — `inverse · (0, 0, 1, 0)` — independent of depth
   * convention, since only the direction of that vector matters.
   */
  private eyeFromClip(clipToScene: THREE.Matrix4): THREE.Vector3 | null {
    const e = this.scratchVec4!.set(0, 0, 1, 0).applyMatrix4(clipToScene);
    if (Math.abs(e.w) < 1e-12) return null;
    return this.scratchVec!.set(e.x / e.w, e.y / e.w, e.z / e.w);
  }

  render(gl: WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    const camera = this.camera;
    const three = this.three;
    if (!three || !map || !renderer || !this.scene || !camera) return;

    // Captured before anything below drives GL (the sky's PMREM pass, the
    // shadow pass): both leave the framebuffer binding at *null*, which is not
    // necessarily what MapLibre was drawing into (3D-CANOPY.md §6b).
    const boundFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    if (this.envPending) this.buildSky(three, renderer);

    this.updateElevations(map);

    const now = performance.now();
    const dt = this.lastFrameAt ? Math.min(100, now - this.lastFrameAt) : 16;
    this.lastFrameAt = now;
    const reduced = this.options.reducedMotion === true;
    const growing =
      !reduced && now < this.grow.startAt + this.grow.sweepMs * 1.05 + GROW_MS + 200;
    const hoverMoving = this.stepHover(dt, reduced);
    if (growing || hoverMoving || this.matricesDirty) {
      this.writeMatrices(now, reduced);
      this.matricesDirty = growing || hoverMoving;
    }

    // `defaultProjectionData.mainMatrix`, not `modelViewProjectionMatrix` —
    // TreeCanopyLayer.render documents the MapLibre 5 measurement behind this.
    const projection = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix;
    const sceneToClip = this.sceneToClip!.copy(this.mvpMat!.fromArray(projection as unknown as number[])).multiply(
      this.localMat!
        .makeTranslation(this.originX, this.originY, this.originZ)
        .scale(this.localScale!.set(this.meterScale, -this.meterScale, this.meterScale))
        .multiply(this.zUpMat!),
    );
    this.clipToScene!.copy(sceneToClip).invert();
    this.hasProjection = true;

    // Stand three's camera at the real eye, and fold the translation back out
    // of the projection so `projection · view` is still exactly `sceneToClip`
    // — the draw is unchanged, but lighting now sees the true view direction.
    const eye = this.eyeFromClip(this.clipToScene!);
    if (eye) {
      camera.position.copy(eye);
      camera.projectionMatrix.copy(sceneToClip).multiply(this.eyeMat!.makeTranslation(eye.x, eye.y, eye.z));
    } else {
      camera.position.set(0, 0, 0);
      camera.projectionMatrix.copy(sceneToClip);
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    const canvas = map.getCanvas();
    renderer.resetState();
    this.renderSSAO(renderer, camera, canvas);
    renderer.setRenderTarget(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, boundFramebuffer);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.render(this.scene, camera);
    gl.bindFramebuffer(gl.FRAMEBUFFER, boundFramebuffer);

    if (growing || hoverMoving) map.triggerRepaint();
  }
}
