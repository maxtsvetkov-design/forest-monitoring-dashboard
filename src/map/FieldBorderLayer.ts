/**
 * Explicit field boundaries for Crop Monitor's own map — one flowing, liquid-
 * shaded ribbon traced around each of the four field bands (`farmFields.ts`),
 * tinted by that field's own drift status (`fieldDrift.ts`) so the border
 * itself already answers "does this parcel match its filing" before a click
 * ever opens the Drift list row. Same `CustomLayerInterface` + three.js
 * `ShaderMaterial` approach as `PinAreaLayer`'s plazas — see that file's own
 * header for the fuller argument for a custom layer over a flat MapLibre
 * `line` layer: a real fragment stage is what lets the border *flow* rather
 * than just marching dashes.
 *
 * A ribbon, not a plain `THREE.Line` — line width in WebGL is unreliable
 * across GPUs/drivers (many clamp to 1px regardless of `linewidth`), and a
 * flat line has no surface for a fragment shader to paint a gradient or a
 * travelling wave across. Each edge becomes a thin quad instead, wide enough
 * to actually read as a border and to give the liquid shader room to work.
 *
 * The quad's half-width is baked into geometry as a *unit* normal offset,
 * not a metre one — scaling it into real metres happens in the vertex
 * shader instead, from `uHalfWidthM`, recomputed every frame from the map's
 * live zoom (`metersPerPixel`, below). A fixed metre width picked once at
 * build time is what the first version of this layer shipped with, and it
 * was invisible: Liwa's plot spans well over a kilometre, so a couple of
 * metres of real-world ribbon width came out sub-pixel at the zoom this
 * view opens on. MapLibre's own `line-width` sidesteps this entirely by
 * being defined in screen pixels, not world units — this mirrors that.
 */

import * as maplibregl from "maplibre-gl";
import type * as THREE from "three";
import { fieldBoundsUV, FIELD_LETTERS } from "../data/farmFields";
import { pointInQuad, type MapOverlay } from "../data/overlays";
import { driftStatus, DRIFT_STATUS_COLOR, type FieldDrift } from "../data/fieldDrift";

/** Half-width of the ribbon, in *screen pixels* — converted to metres fresh
 *  every frame (see `metersPerPixel`) so it reads the same whether the
 *  camera is sitting on the whole plot or fit tight to one field. */
const RIBBON_HALF_WIDTH_PX = 5;

/** Standard Web Mercator ground resolution at a given zoom/latitude, in
 *  metres per screen pixel (256px tiles, matching MapLibre's own tile
 *  grid) — the same formula behind every "metres per pixel at zoom Z"
 *  slippy-map reference. */
function metersPerPixel(zoom: number, latitude: number): number {
  return (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (256 * Math.pow(2, zoom));
}

function hexToVec3(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

/** Per-fragment: a base→glow ramp across the ribbon's own width (`vSide`,
 *  -1..1 edge to edge), a wave of light travelling along its length
 *  (`vAlong`, real metres from the loop's start) at a speed set by how bad
 *  this field's drift is, and a soft value-noise ripple on top so the flow
 *  reads as liquid rather than a scrolling gradient. Worse drift both moves
 *  faster and pulses harder — the same "this needs attention" read
 *  `PinAreaLayer`'s `uDanger` gives its plazas. */
const FRAGMENT_SHADER = /* glsl */ `
  varying float vAlong;
  varying float vSide;

  uniform vec3 uColorBase;
  uniform vec3 uColorGlow;
  uniform float uTime;
  uniform float uPhase;
  uniform float uOpacity;
  uniform float uDanger;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }

  void main() {
    // Soft-edged ribbon: full colour along the centreline, fading to
    // nothing at vSide = ±1 rather than a hard-edged rectangle.
    float edgeFade = 1.0 - smoothstep(0.55, 1.0, abs(vSide));

    float speed = mix(0.35, 1.6, uDanger);
    float wave = sin(vAlong * 0.35 - uTime * speed + uPhase) * 0.5 + 0.5;
    float ripple = noise1(vAlong * 0.18 + uTime * speed * 0.6 + uPhase);
    float flow = smoothstep(0.35, 1.0, wave * 0.7 + ripple * 0.3);

    float pulse = 0.85 + 0.15 * sin(uTime * mix(0.8, 2.2, uDanger) + uPhase);

    vec3 color = mix(uColorBase, uColorGlow, flow) * pulse;
    float alpha = uOpacity * edgeFade * mix(0.55, 1.0, flow);
    gl_FragColor = vec4(color, alpha);
  }
`;

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aNormal2D;
  attribute float aAlong;
  attribute float aSide;
  varying float vAlong;
  varying float vSide;
  uniform float uHalfWidthM;

  void main() {
    vAlong = aAlong;
    vSide = aSide;
    vec3 offsetPos = aCenter + aNormal2D * (aSide * uHalfWidthM);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPos, 1.0);
  }
`;

interface FieldRibbon {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export interface FieldBorderLayerOptions {
  id: string;
  overlay: MapOverlay;
  fields: FieldDrift[];
  opacity?: number;
  reducedMotion?: boolean;
}

export default class FieldBorderLayer implements maplibregl.CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map: maplibregl.Map | null = null;
  private three: typeof THREE | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;

  private options: FieldBorderLayerOptions;
  private ribbons: FieldRibbon[] = [];
  private removed = false;
  private startedAt = 0;

  // Same shared-origin approach as PinAreaLayer: one local-metres space
  // anchored at the plot's own centre keeps precision high regardless of
  // where on the globe the area sits.
  private originX = 0;
  private originY = 0;
  private originZ = 0;
  private originLat = 0;
  private meterScale = 1;

  private mvpMat: THREE.Matrix4 | null = null;
  private localMat: THREE.Matrix4 | null = null;
  private localScale: THREE.Vector3 | null = null;
  private zUpMat: THREE.Matrix4 | null = null;

  constructor(options: FieldBorderLayerOptions) {
    this.id = options.id;
    this.options = options;
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.removed = false;
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
    for (const { mesh, material } of this.ribbons) {
      mesh.geometry.dispose();
      material.dispose();
    }
    this.ribbons = [];
    this.scene = null;
    // Not disposed: it wraps MapLibre's own GL context — see PinAreaLayer's
    // identical note.
    this.renderer = null;
    this.map = null;
  }

  setFields(fields: FieldDrift[]) {
    this.options = { ...this.options, fields };
    if (this.three) this.buildRibbons(this.three);
  }

  private build(three: typeof THREE, map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.renderer = new three.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;

    this.scene = new three.Scene();
    this.camera = new three.Camera();

    this.mvpMat = new three.Matrix4();
    this.localMat = new three.Matrix4();
    this.localScale = new three.Vector3();
    this.zUpMat = new three.Matrix4().makeRotationX(Math.PI / 2);

    const [cLng, cLat] = pointInQuad(this.options.overlay.coordinates, 0.5, 0.5);
    const origin = maplibregl.MercatorCoordinate.fromLngLat([cLng, cLat], 0);
    this.originX = origin.x;
    this.originY = origin.y;
    this.originZ = origin.z ?? 0;
    this.originLat = cLat;
    this.meterScale = origin.meterInMercatorCoordinateUnits();

    this.buildRibbons(three);
  }

  /** Builds one closed ribbon loop per field, each edge a two-triangle quad
   *  straddling the field's real ground corners — the boundary `fieldBoundsUV`
   *  already defines for every tree and crop-table band in this app, just
   *  traced instead of filled. Each vertex carries its *centreline* position
   *  (`aCenter`) and the edge's unit perpendicular (`aNormal2D`) rather than
   *  a pre-offset position — the vertex shader does the actual offsetting,
   *  scaled by the current zoom's `uHalfWidthM`, so the same geometry stays
   *  correct as the camera zooms in and out instead of needing a rebuild. */
  private buildRibbons(three: typeof THREE) {
    for (const { mesh, material } of this.ribbons) {
      this.scene?.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    }
    this.ribbons = [];
    if (!this.scene) return;

    FIELD_LETTERS.forEach((letter, fieldIndex) => {
      const drift = this.options.fields.find((f) => f.field === letter);
      const driftPct = drift?.driftPct ?? 0;
      const status = driftStatus(driftPct);
      const accent = DRIFT_STATUS_COLOR[status];
      const [ar, ag, ab] = hexToVec3(accent);

      const cornersUV = fieldBoundsUV(fieldIndex);
      const cornersLocal = cornersUV.map(([u, v]) => {
        const [lng, lat] = pointInQuad(this.options.overlay.coordinates, u, v);
        const merc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        return [(merc.x - this.originX) / this.meterScale, (merc.y - this.originY) / this.meterScale] as [number, number];
      });

      const centers: number[] = [];
      const normals: number[] = [];
      const along: number[] = [];
      const sides: number[] = [];
      const indices: number[] = [];
      let cumulative = 0;

      for (let i = 0; i < cornersLocal.length; i++) {
        const [x0, z0] = cornersLocal[i];
        const [x1, z1] = cornersLocal[(i + 1) % cornersLocal.length];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz) || 1;
        // Perpendicular to the edge, in the local XZ ground plane.
        const nx = -dz / len;
        const nz = dx / len;

        const base = centers.length / 3;
        // Both corners of this edge share the same unit normal — two
        // vertices per corner (side +1/-1), the shader offsets each by
        // `uHalfWidthM` along it.
        centers.push(x0, 0, z0, x0, 0, z0, x1, 0, z1, x1, 0, z1);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
        along.push(cumulative, cumulative, cumulative + len, cumulative + len);
        sides.push(1, -1, 1, -1);
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);

        cumulative += len;
      }

      const geometry = new three.BufferGeometry();
      // Three.js's own bookkeeping (bounding sphere, etc.) expects a
      // "position" attribute even though the shader ignores it in favour of
      // `aCenter`/`aNormal2D` — the centreline is a harmless stand-in, since
      // nothing here calls `computeBoundingSphere` or raycasts this mesh.
      geometry.setAttribute("position", new three.Float32BufferAttribute(centers, 3));
      geometry.setAttribute("aCenter", new three.Float32BufferAttribute(centers, 3));
      geometry.setAttribute("aNormal2D", new three.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("aAlong", new three.Float32BufferAttribute(along, 1));
      geometry.setAttribute("aSide", new three.Float32BufferAttribute(sides, 1));
      geometry.setIndex(indices);

      const material = new three.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        // Always-on-top, same call as PinAreaLayer's plazas: a border traced
        // a couple of metres above a flat farm plot has no real occlusion to
        // respect, and depth-testing a transparent mesh against MapLibre's
        // own buffer here is exactly what made that layer disappear.
        depthTest: false,
        depthWrite: false,
        side: three.DoubleSide,
        uniforms: {
          uColorBase: { value: new three.Vector3(ar * 0.5, ag * 0.5, ab * 0.5) },
          uColorGlow: { value: new three.Vector3(Math.min(1, ar + 0.25), Math.min(1, ag + 0.25), Math.min(1, ab + 0.25)) },
          uTime: { value: 0 },
          uPhase: { value: fieldIndex * 1.7 },
          uOpacity: { value: this.options.opacity ?? 0.9 },
          uDanger: { value: driftPct / 100 },
          // Placeholder — set for real every frame in render() from the
          // map's live zoom, once one actually exists.
          uHalfWidthM: { value: 1 },
        },
      });

      const mesh = new three.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.scene?.add(mesh);
      this.ribbons.push({ mesh, material });
    });
  }

  render(gl: WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) {
    const three = this.three;
    const map = this.map;
    if (!three || !map || !this.renderer || !this.scene || !this.camera || this.ribbons.length === 0) return;

    const elapsedSec = this.options.reducedMotion ? 0 : (performance.now() - this.startedAt) / 1000;
    // Recomputed every frame, not cached from build time: this is exactly
    // what keeps the ribbon a constant screen width as `fieldFocusRequest`
    // (MapCanvas.tsx) flies the camera in tight on one field — a metre width
    // fixed at build time would either vanish zoomed out or balloon zoomed in.
    const halfWidthM = RIBBON_HALF_WIDTH_PX * metersPerPixel(map.getZoom(), this.originLat);
    for (const { material } of this.ribbons) {
      material.uniforms.uTime.value = elapsedSec;
      material.uniforms.uHalfWidthM.value = halfWidthM;
    }

    // Same defaultProjectionData/local-space composition as PinAreaLayer's
    // render() — see that file's own comment for why `mainMatrix`, not
    // `modelViewProjectionMatrix`, on this MapLibre version.
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
