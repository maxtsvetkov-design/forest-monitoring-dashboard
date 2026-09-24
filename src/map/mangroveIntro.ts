/**
 * The Mangroves view's opening shot: the camera comes in high over the water,
 * drops to a few metres above the canopy, glides west → east along the stand
 * while the trees sprout ahead of it, then rises and settles on the ordinary
 * overview — exactly the pose the map would otherwise have auto-fitted to, so
 * the intro ends where the view begins rather than somewhere of its own.
 *
 * Keyframes are real camera *positions* (lng/lat + altitude, looking at a
 * point on the stand), converted by MapLibre's own
 * `calculateCameraOptionsFromTo` into center/zoom/pitch/bearing — then the
 * flight interpolates those four through a Catmull-Rom spline, so it passes
 * exactly through every keyframe with no corners between them.
 *
 * Any wheel, pointer or key input ends it on the spot and leaves the camera
 * where it is: the reader taking the map is the one signal that always wins.
 */

import * as maplibregl from "maplibre-gl";
import type { Mangrove } from "../data/mangroves";

export interface CameraPose {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

interface Keyframe extends CameraPose {
  /** ms from the start of the flight. */
  at: number;
}

/** Headroom the low pass needs: MapLibre's defaults (60°, z22) would clamp it. */
export const INTRO_MAX_PITCH = 82;
export const INTRO_MAX_ZOOM = 23.5;

/** When the trees start sprouting after the flight begins, and how long the
 *  wavefront takes to cross the stand — timed so it runs just ahead of the
 *  camera's look-at point on the low pass. */
export const INTRO_GROW_DELAY_MS = 350;
export const INTRO_GROW_SWEEP_MS = 5600;

const M_PER_DEG_LAT = 111_320;

function offsetMetres([lng, lat]: [number, number], east: number, north: number): [number, number] {
  return [lng + east / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)), lat + north / M_PER_DEG_LAT];
}

/** A point on the stand's centre line, `f` of the way west → east — the mean
 *  of the trees nearest that fraction, so it follows the band's real curve. */
function bandPoint(sorted: Mangrove[], f: number): [number, number] {
  const n = sorted.length;
  const k = Math.round(Math.min(1, Math.max(0, f)) * (n - 1));
  const lo = Math.max(0, k - 20);
  const hi = Math.min(n, k + 21);
  let lng = 0;
  let lat = 0;
  for (let i = lo; i < hi; i++) {
    lng += sorted[i].lng;
    lat += sorted[i].lat;
  }
  return [lng / (hi - lo), lat / (hi - lo)];
}

function poseFromTo(
  map: maplibregl.Map,
  from: [number, number],
  fromAlt: number,
  to: [number, number],
  toAlt: number,
): CameraPose {
  const c = map.calculateCameraOptionsFromTo(maplibregl.LngLat.convert(from), fromAlt, maplibregl.LngLat.convert(to), toAlt);
  const center = maplibregl.LngLat.convert(c.center!);
  return { center: [center.lng, center.lat], zoom: c.zoom ?? 18, pitch: c.pitch ?? 60, bearing: c.bearing ?? 0 };
}

export function planMangroveIntro(map: maplibregl.Map, trees: Mangrove[], final: CameraPose): Keyframe[] {
  const sorted = [...trees].sort((a, b) => a.lng - b.lng);
  const frames: Keyframe[] = [
    // In from high over the water, south-west of the stand.
    { at: 0, ...poseFromTo(map, offsetMetres(bandPoint(sorted, 0), -170, -240), 150, bandPoint(sorted, 0.18), 0) },
    // Dropping to canopy height at the western end.
    { at: 2300, ...poseFromTo(map, offsetMetres(bandPoint(sorted, 0.16), 0, -62), 24, bandPoint(sorted, 0.36), 3) },
    // Gliding low along the band, looking ahead.
    { at: 4700, ...poseFromTo(map, offsetMetres(bandPoint(sorted, 0.58), 0, -58), 19, bandPoint(sorted, 0.82), 3) },
    // Rising and pulling back onto the overview.
    { at: 7600, ...final },
  ];
  // Unwrap bearings so the spline never takes the long way round.
  for (let i = 1; i < frames.length; i++) {
    let b = frames[i].bearing;
    while (b - frames[i - 1].bearing > 180) b -= 360;
    while (b - frames[i - 1].bearing < -180) b += 360;
    frames[i].bearing = b;
  }
  return frames;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function sample(frames: Keyframe[], ms: number): CameraPose {
  const total = frames[frames.length - 1].at;
  // Eased over the whole flight, so it leaves and arrives at rest.
  const at = easeInOutSine(Math.min(1, Math.max(0, ms / total))) * total;
  let seg = 0;
  while (seg < frames.length - 2 && at > frames[seg + 1].at) seg++;
  const a = frames[seg];
  const b = frames[seg + 1];
  const t = (at - a.at) / (b.at - a.at);
  const p0 = frames[Math.max(0, seg - 1)];
  const p3 = frames[Math.min(frames.length - 1, seg + 2)];
  const f = (key: (k: CameraPose) => number) => catmullRom(key(p0), key(a), key(b), key(p3), t);
  return {
    center: [f((k) => k.center[0]), f((k) => k.center[1])],
    zoom: f((k) => k.zoom),
    pitch: Math.min(INTRO_MAX_PITCH, Math.max(0, f((k) => k.pitch))),
    bearing: f((k) => k.bearing),
  };
}

/**
 * Flies the plan. Returns a cancel function; `onDone(interrupted)` fires once
 * either way. The camera is left wherever the flight was when it stopped.
 */
export function playMangroveIntro(
  map: maplibregl.Map,
  frames: Keyframe[],
  onDone: (interrupted: boolean) => void,
): () => void {
  const total = frames[frames.length - 1].at;
  const started = performance.now();
  let frame = 0;
  let finished = false;

  const finish = (interrupted: boolean) => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    map.off("mousedown", interrupt);
    map.off("touchstart", interrupt);
    map.off("wheel", interrupt);
    window.removeEventListener("keydown", interrupt);
    onDone(interrupted);
  };
  const interrupt = () => finish(true);

  const tick = () => {
    const ms = performance.now() - started;
    const pose = sample(frames, ms);
    map.jumpTo({ center: pose.center, zoom: pose.zoom, pitch: pose.pitch, bearing: pose.bearing });
    if (ms >= total) return finish(false);
    frame = requestAnimationFrame(tick);
  };

  map.on("mousedown", interrupt);
  map.on("touchstart", interrupt);
  map.on("wheel", interrupt);
  window.addEventListener("keydown", interrupt);
  map.jumpTo(frames[0]);
  frame = requestAnimationFrame(tick);
  return () => finish(true);
}
