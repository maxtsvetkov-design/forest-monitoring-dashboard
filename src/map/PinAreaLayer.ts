/**
 * A MapLibre custom layer that stands a small, shader-lit "plaza" over every
 * compliance-violation pin — real GPU geometry with a custom `ShaderMaterial`,
 * not a MapLibre `fill-extrusion` faking a gradient with two stacked flat-color
 * layers (the earlier approach; see git history). That approach hit a hard
 * ceiling: `fill-extrusion-color` takes one flat colour per feature, so a true
 * per-fragment gradient, a fresnel rim, and a flowing energy band all had to
 * be either faked by stacking features or animated by reassigning whole paint
 * values every frame — real GPU shading, but through a very narrow straw.
 * This draws straight to the map's own GL context instead, the same way
 * `TreeCanopyLayer` stands the 3D forest — see that file's own header for the
 * coordinate-space and "why a custom layer" background this one reuses
 * unchanged; only the local geometry and the shader are new here.
 */

import * as maplibregl from "maplibre-gl";
import type * as THREE from "three";
import type { TriageEntry } from "../data/inspectionTriage";
import { SEVERITY_STYLE } from "../data/severity";

const BLOB_RADIUS_M = 24;
// Few enough facets, with low jitter, that the footprint reads as an
// irregular square pad rather than a rounded blob — a ground marker, not a
// gemstone. Combined with the flat (non-indexed) normals below for a
// faceted, low-poly finish.
const BLOB_VERTICES = 5;
const BLOB_JITTER = 0.16;
// A hazard pad sitting low on the ground, not a tower — a few metres of
// relief is enough for the gradient/fresnel/mask to read once pitched, and
// keeps the read as "a marked patch of ground" rather than "a structure".
const BLOB_MIN_HEIGHT_M = 2.5;
const BLOB_MAX_HEIGHT_M = 5.5;

/** How aggressively a finding's own severity reads through the material
 *  itself, not just its colour: how much of the surface the generative mask
 *  eats away (sparser = more "eaten", less solid-looking), and how fast the
 *  danger-flicker on top of the base pulse runs. A CRITICAL plaza should
 *  look like it is barely holding together; an INFO one should look almost
 *  solid and calm. */
const DANGER_BY_SEVERITY: Record<TriageEntry["severityLabel"], number> = {
  CRITICAL: 1,
  WARNING: 0.55,
  INFO: 0.22,
};

/** A tiny, dependency-free seeded PRNG (mulberry32) — deterministic per
 *  finding, so a blob's own shape/height/glow phase stays put across
 *  re-renders instead of reshuffling, which would read as a glitch. */
function seededRandom(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i++) state = (Math.imul(31, state) + seed.charCodeAt(i)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToVec3(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** Per-fragment: a base→top colour ramp (the actual severity meaning), a
 *  flowing diagonal energy band that travels up the surface on a sine of
 *  height and time, a fresnel rim that brightens every silhouette edge the
 *  camera grazes, and — the material's own read of *how dangerous this is* —
 *  a generative value-noise mask that eats holes through the surface,
 *  drifting over time rather than sitting static. `uDanger` (CRITICAL 1 down
 *  to INFO 0.22) drives three things at once: how much coverage the mask
 *  leaves standing (sparser for a worse finding — it should look like it is
 *  barely holding together), how fast the danger-flicker runs on top of the
 *  base pulse, and how strongly the glow itself reads. None of this — the
 *  gradient, the mask, the rim — has an equivalent in a flat
 *  `fill-extrusion-color`, which has no fragment stage of its own to run any
 *  of it in. `uPhase` desyncs one plaza's shimmer (and its mask drift) from
 *  the next so a field of them never pulses in lockstep. */
const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vHeightFrac;
  varying vec2 vLocalXZ;

  uniform vec3 uColorBase;
  uniform vec3 uColorTop;
  uniform vec3 uColorGlow;
  uniform float uTime;
  uniform float uPhase;
  uniform float uOpacity;
  uniform float uDanger;

  // Cheap hash-based value noise — no texture lookup, so the mask costs
  // nothing to keep resident and nothing to stream, at the scale (a dozen
  // small plazas) this layer ever draws.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // Three octaves, each its own frequency AND its own drift direction/speed
  // — not one noise field sliding sideways, but three overlapping ones
  // crossing each other, which is what actually reads as texture churning
  // in place rather than a single pattern being dragged across the surface.
  float fbm(vec2 p, float t) {
    float sum = 0.0;
    sum += valueNoise(p * 1.0 + vec2(t * 0.12, -t * 0.08)) * 0.55;
    sum += valueNoise(p * 2.3 + vec2(-t * 0.24, t * 0.19)) * 0.30;
    sum += valueNoise(p * 4.6 + vec2(t * 0.41, t * 0.33)) * 0.16;
    return sum;
  }

  void main() {
    // Height folded into the sampling coordinate, not just XZ, so the
    // texture reads as one continuous field wrapping the whole 3D surface —
    // genuinely spatial, not a flat decal stamped the same way on every
    // face regardless of where on the mass it sits.
    vec2 spatialCoord = vLocalXZ * 0.42 + vec2(vHeightFrac * 2.1, -vHeightFrac * 1.3) + uPhase;
    float mask = fbm(spatialCoord, uTime);
    // More danger → less coverage left standing (0.86 down to 0.5).
    float coverage = mix(0.86, 0.5, uDanger);
    float edge = 0.08;
    float maskAlpha = 1.0 - smoothstep(coverage - edge, coverage + edge, mask);
    if (maskAlpha < 0.04) discard;

    vec3 ramp = mix(uColorBase, uColorTop, smoothstep(0.0, 1.0, vHeightFrac));

    float flow = sin(vHeightFrac * 9.0 - uTime * 1.7 + uPhase);
    float band = smoothstep(0.82, 1.0, flow);

    // DoubleSide draws both faces of every triangle — including the
    // extrusion's inner walls, now that the mask punches real holes through
    // to them — but the geometric normal never flips for a backface, so
    // without this the fresnel and lighting on anything seen "from inside"
    // read as inverted. gl_FrontFacing is GLSL's own per-fragment answer to
    // which side the rasteriser actually drew.
    vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 v = normalize(vViewDir);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.4);

    // A worse finding flickers faster and harder — the same "unstable"
    // read the sparser mask gives, now in time as well as space.
    float pulseSpeed = mix(1.0, 2.6, uDanger);
    float pulseDepth = mix(0.12, 0.3, uDanger);
    float pulse = (1.0 - pulseDepth * 0.5) + pulseDepth * sin(uTime * pulseSpeed + uPhase);

    float glowStrength = mix(0.5, 1.15, uDanger);
    vec3 color = ramp + uColorGlow * band * 0.7 * glowStrength + uColorGlow * fresnel * 0.65 * glowStrength;
    gl_FragColor = vec4(color * pulse, uOpacity * maskAlpha);
  }
`;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vHeightFrac;
  varying vec2 vLocalXZ;
  uniform float uMaxHeight;

  void main() {
    vHeightFrac = clamp(position.y / max(uMaxHeight, 0.001), 0.0, 1.0);
    vLocalXZ = position.xz;
    vNormal = normalMatrix * normal;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

interface PlazaMesh {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  phase: number;
  lng: number;
  lat: number;
}

export interface PinAreaLayerOptions {
  id: string;
  entries: TriageEntry[];
  opacity?: number;
  reducedMotion?: boolean;
}

export default class PinAreaLayer implements maplibregl.CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map: maplibregl.Map | null = null;
  private three: typeof THREE | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;

  private options: PinAreaLayerOptions;
  private plazas: PlazaMesh[] = [];
  private removed = false;
  private startedAt = 0;

  // Scene origin — the average of every entry's own position, so the local
  // metre space this layer draws in stays small and precision stays high
  // regardless of where on the plot the pins happen to sit.
  private originX = 0;
  private originY = 0;
  private originZ = 0;
  private originLng = 0;
  private originLat = 0;
  private meterScale = 1;
  /** `map.queryTerrainElevation` returns null until the DEM tiles covering a
   *  point are decoded, so this is attempted every frame and latches on the
   *  first success — sampling once at build time would silently pin every
   *  plaza to sea level and sink it under Liwa's real dune relief, which is
   *  exactly what made the very first version of this layer invisible: the
   *  meshes were rendering, correctly, several metres *underground*. Same
   *  fix `TreeCanopyLayer` already applies to its own forest — see that
   *  file's `sampleElevations`. */
  private elevationsSampled = false;

  private mvpMat: THREE.Matrix4 | null = null;
  private localMat: THREE.Matrix4 | null = null;
  private localScale: THREE.Vector3 | null = null;
  private zUpMat: THREE.Matrix4 | null = null;

  constructor(options: PinAreaLayerOptions) {
    this.id = options.id;
    this.options = options;
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.removed = false;
    // Dynamic import: three is only paid for once a farm with real findings
    // actually turns 3D on — see TreeCanopyLayer's own header for the same
    // reasoning at greater length. The layer draws nothing until it resolves.
    import("three").then((three) => {
      if (this.removed) return;
      this.three = three;
      this.build(three, map, gl);
      this.startedAt = performance.now();
      map.triggerRepaint();
    });
  }

  onRemove() {
    this.removed = true;
    for (const { mesh, material } of this.plazas) {
      mesh.geometry.dispose();
      material.dispose();
    }
    this.plazas = [];
    this.scene = null;
    // Not disposed: the renderer wraps MapLibre's own GL context, and
    // disposing it would tear down state the map is still using.
    this.renderer = null;
    this.map = null;
  }

  /** Rebuilds every plaza from a fresh set of findings — call whenever
   *  `violationByTreeId` changes while the layer is mounted. */
  setEntries(entries: TriageEntry[]) {
    this.options = { ...this.options, entries };
    if (this.three) this.placePlazas(this.three);
  }

  setOpacity(opacity: number) {
    this.options = { ...this.options, opacity };
    for (const { material } of this.plazas) material.uniforms.uOpacity.value = opacity;
  }

  private build(three: typeof THREE, _map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.renderer = new three.WebGLRenderer({ canvas: _map.getCanvas(), context: gl, antialias: true });
    // MapLibre has already drawn the basemap into this framebuffer by the
    // time our render hook runs — clearing would erase it.
    this.renderer.autoClear = false;

    this.scene = new three.Scene();
    // A bare Camera: MapLibre supplies the full projection matrix every
    // frame, so any intrinsics set here would just be overwritten.
    this.camera = new three.Camera();

    this.mvpMat = new three.Matrix4();
    this.localMat = new three.Matrix4();
    this.localScale = new three.Vector3();
    this.zUpMat = new three.Matrix4().makeRotationX(Math.PI / 2);

    this.placePlazas(three);
  }

  /** (Re)builds one extruded, shader-lit mesh per finding, all positioned in
   *  one shared local-metres space anchored on the entries' own centroid. */
  private placePlazas(three: typeof THREE) {
    for (const { mesh, material } of this.plazas) {
      this.scene?.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    }
    this.plazas = [];
    this.elevationsSampled = false;

    const entries = this.options.entries;
    if (!this.scene || entries.length === 0) return;

    const centroidLng = entries.reduce((sum, e) => sum + e.lng, 0) / entries.length;
    const centroidLat = entries.reduce((sum, e) => sum + e.lat, 0) / entries.length;
    const origin = maplibregl.MercatorCoordinate.fromLngLat([centroidLng, centroidLat], 0);
    this.originX = origin.x;
    this.originY = origin.y;
    this.originZ = origin.z ?? 0;
    this.originLng = centroidLng;
    this.originLat = centroidLat;
    this.meterScale = origin.meterInMercatorCoordinateUnits();

    for (const entry of entries) {
      const rand = seededRandom(entry.event.id);
      const accent = SEVERITY_STYLE[entry.severityLabel].accent;
      const [ar, ag, ab] = hexToVec3(accent);
      const height = BLOB_MIN_HEIGHT_M + rand() * (BLOB_MAX_HEIGHT_M - BLOB_MIN_HEIGHT_M);
      const phase = rand() * Math.PI * 2;

      const shape = new three.Shape();
      for (let i = 0; i < BLOB_VERTICES; i++) {
        const angle = (i / BLOB_VERTICES) * Math.PI * 2;
        const r = BLOB_RADIUS_M * (1 + (rand() - 0.5) * 2 * BLOB_JITTER);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();

      let geometry: THREE.BufferGeometry = new three.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
      // ExtrudeGeometry extrudes the shape's XY plane along +Z; rotating -90°
      // about X carries that depth axis onto world +Y (up), landing the base
      // ring at y=0 and the top ring at y=height — see the header note this
      // mirrors in TreeCanopyLayer for the same Y-up/Z-up swap.
      geometry.rotateX(-Math.PI / 2);
      // Non-indexed before computing normals: each triangle then owns its own
      // unshared vertices, so `computeVertexNormals` has nothing to average
      // across a shared corner and every face reads as one flat facet — the
      // low-poly, crystalline look the sparser `BLOB_VERTICES` count is
      // going for, in place of the smooth, rounded shading a shared-vertex
      // normal would give the same silhouette.
      geometry = geometry.toNonIndexed();
      geometry.computeVertexNormals();

      const danger = DANGER_BY_SEVERITY[entry.severityLabel];
      const material = new three.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        // Both off, deliberately: with depth testing on, these plazas render
        // — correctly, verified by inspecting their actual clip-space output
        // — but lose the depth comparison against whatever MapLibre's own
        // passes leave in the shared depth buffer at this pitch, and vanish
        // completely; TreeCanopyLayer's meshes never hit this because they
        // stay opaque (depthWrite tied to opacity) rather than transparent.
        // A plaza is a small, deliberately abstract marker floating over its
        // pin, not real terrain-occluded geometry, so always-on-top is the
        // correct read here, not a workaround for a bug still open.
        depthTest: false,
        depthWrite: false,
        side: three.DoubleSide,
        uniforms: {
          uMaxHeight: { value: height },
          uColorBase: { value: new three.Vector3(ar * 0.42, ag * 0.42, ab * 0.42) },
          uColorTop: { value: new three.Vector3(Math.min(1, ar * 1.25 + 0.15), Math.min(1, ag * 1.25 + 0.15), Math.min(1, ab * 1.25 + 0.15)) },
          uColorGlow: { value: new three.Vector3(Math.min(1, ar + 0.35), Math.min(1, ag + 0.35), Math.min(1, ab + 0.35)) },
          uTime: { value: 0 },
          uPhase: { value: phase },
          uOpacity: { value: this.options.opacity ?? 0.58 },
          uDanger: { value: danger },
        },
      });

      const mesh = new three.Mesh(geometry, material);
      mesh.frustumCulled = false;

      const merc = maplibregl.MercatorCoordinate.fromLngLat([entry.lng, entry.lat], 0);
      mesh.position.set((merc.x - this.originX) / this.meterScale, 0, (merc.y - this.originY) / this.meterScale);

      this.scene.add(mesh);
      this.plazas.push({ mesh, material, phase, lng: entry.lng, lat: entry.lat });
    }
  }

  /** Reads real terrain height under each plaza, once DEM tiles have
   *  actually loaded — offsetting every mesh's own Y so it sits on the
   *  ground Liwa's terrain source describes instead of at the Mercator
   *  sea-level plane the scene origin starts from. */
  private sampleElevations(map: maplibregl.Map) {
    if (this.elevationsSampled || this.plazas.length === 0) return;
    const originElevation = map.queryTerrainElevation({ lng: this.originLng, lat: this.originLat });
    if (originElevation === null || originElevation === undefined) return;
    for (const plaza of this.plazas) {
      const elevation = map.queryTerrainElevation({ lng: plaza.lng, lat: plaza.lat });
      plaza.mesh.position.y = (elevation ?? originElevation) - originElevation;
    }
    this.elevationsSampled = true;
  }

  render(gl: WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) {
    const three = this.three;
    const map = this.map;
    if (!three || !map || !this.renderer || !this.scene || !this.camera || this.plazas.length === 0) return;

    this.sampleElevations(map);

    const elapsedSec = this.options.reducedMotion ? 0 : (performance.now() - this.startedAt) / 1000;
    for (const { material } of this.plazas) material.uniforms.uTime.value = elapsedSec;

    // See TreeCanopyLayer's own render() for why `defaultProjectionData` and
    // not `modelViewProjectionMatrix` — the latter is off-frame on MapLibre
    // 6.6's projection convention, verified there against a known pixel.
    const projection = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix;
    const mvp = this.mvpMat!.fromArray(projection as unknown as number[]);
    const local = this.localMat!
      .makeTranslation(this.originX, this.originY, this.originZ)
      .scale(this.localScale!.set(this.meterScale, -this.meterScale, this.meterScale))
      .multiply(this.zUpMat!);
    this.camera.projectionMatrix.copy(mvp.multiply(local));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    const canvas = map.getCanvas();
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);

    if (!this.options.reducedMotion) map.triggerRepaint();
  }
}
