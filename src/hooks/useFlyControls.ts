import { useEffect, type RefObject } from "react";
import type * as maplibregl from "maplibre-gl";

/**
 * Keyboard flight for the isolated 3D canopy — WASD to move, Q/E to turn,
 * R/F for height, shift to boost.
 *
 * MapLibre has no free camera to drive, so "flying" is the camera controls it
 * does have, moved every frame: the centre walks across the ground along the
 * current bearing, and height is zoom. That reads as flight precisely because
 * the trees are real geometry standing on that ground — they part around the
 * camera on their own.
 *
 * Only worth turning on where there is something to fly *through*, which is
 * why MapCanvas gates it on the 3D canopy being the isolated layer rather than
 * binding WASD globally.
 */

/** MapLibre's own default. Restored on the way out. */
const DEFAULT_PITCH_CAP = 60;
/** MapLibre's hard ceiling. At 60° you look down on the canopy; nearer 85 you
 * stand in it, which is the whole point of the mode. */
const FLY_PITCH_CAP = 85;
/** Ground speed expressed in *screen* pixels per second, converted to metres
 * per frame at the current zoom — so travel feels the same whether you are
 * above the plot or between two crowns, instead of crawling when zoomed in. */
const PAN_PX_PER_SEC = 460;
const TURN_DEG_PER_SEC = 75;
/** Gentle on purpose: a zoom level is a doubling, so even this crosses the
 * whole canopy-to-treetop range in a couple of seconds. At 1.0+ a tap of F
 * dropped straight through the plot and out the far side. */
const ZOOM_PER_SEC = 0.55;
const BOOST = 3;
/** Guards against a huge first step if the tab was backgrounded mid-flight. */
const MAX_FRAME_SECONDS = 0.05;

const HELD = new Set(["w", "a", "s", "d", "q", "e", "r", "f"]);

/** Typing in a search box should type, not fly. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

export function useFlyControls(mapRef: RefObject<maplibregl.Map | null>, active: boolean) {
  useEffect(() => {
    const map = mapRef.current;
    if (!active || !map) return;

    const previousPitchCap = map.getMaxPitch();
    map.setMaxPitch(FLY_PITCH_CAP);

    const held = new Set<string>();
    let boosted = false;
    let raf = 0;
    let last = performance.now();

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      boosted = e.shiftKey;
      const key = e.key.toLowerCase();
      if (!HELD.has(key)) return;
      // Nothing here scrolls the page, but a held key that also reaches the
      // document is a key the map and the browser are both acting on.
      e.preventDefault();
      held.add(key);
    }
    function onKeyUp(e: KeyboardEvent) {
      boosted = e.shiftKey;
      held.delete(e.key.toLowerCase());
    }
    // A key held while the window loses focus never sends its keyup, and the
    // map would fly off on its own until the user pressed and released it again.
    function releaseAll() {
      held.clear();
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      const m = mapRef.current;
      if (!m || held.size === 0) return;

      const centre = m.getCenter();
      const bearing = m.getBearing();
      const speedScale = boosted ? BOOST : 1;

      let bearingNext = bearing;
      if (held.has("q")) bearingNext -= TURN_DEG_PER_SEC * dt * speedScale;
      if (held.has("e")) bearingNext += TURN_DEG_PER_SEC * dt * speedScale;

      let zoomNext = m.getZoom();
      if (held.has("r")) zoomNext -= ZOOM_PER_SEC * dt * speedScale;
      if (held.has("f")) zoomNext += ZOOM_PER_SEC * dt * speedScale;

      // Same (cos bearing, sin bearing) → (lat, lng) convention MapCanvas's
      // own `liftCoordinates` uses for "away from the camera", so forward here
      // is the same direction the overlay lift already treats as up-screen.
      const rad = (bearing * Math.PI) / 180;
      const sideRad = rad + Math.PI / 2;
      let north = 0;
      let east = 0;
      if (held.has("w")) { north += Math.cos(rad); east += Math.sin(rad); }
      if (held.has("s")) { north -= Math.cos(rad); east -= Math.sin(rad); }
      if (held.has("d")) { north += Math.cos(sideRad); east += Math.sin(sideRad); }
      if (held.has("a")) { north -= Math.cos(sideRad); east -= Math.sin(sideRad); }

      let lng = centre.lng;
      let lat = centre.lat;
      const length = Math.hypot(north, east);
      if (length > 0) {
        // Normalised, so holding W+D is not √2 faster than holding W.
        north /= length;
        east /= length;
        const latRad = (lat * Math.PI) / 180;
        const metresPerPixel = (40075016.686 * Math.cos(latRad)) / 2 ** (m.getZoom() + 8);
        const step = PAN_PX_PER_SEC * metresPerPixel * dt * speedScale;
        lat += (north * step) / 111320;
        lng += (east * step) / (111320 * Math.cos(latRad));
      }

      // One jumpTo per frame rather than easeTo: the animation IS the key being
      // held, and an eased move per frame would fight the next frame's.
      m.jumpTo({ center: [lng, lat], bearing: bearingNext, zoom: zoomNext });
    }

    // Drop to a near-ground pitch once the isolate camera has settled. At the
    // 60° the fit leaves behind you are looking down ON the canopy; the mode
    // only reads as flight from inside it. Deliberately a one-shot nudge, and
    // skipped if the pitch is no longer where the fit left it or the user has
    // already taken the controls — whoever moves last wins, and it should
    // never be this.
    const settleIn = window.setTimeout(() => {
      const m = mapRef.current;
      if (!m || held.size > 0 || m.getPitch() > DEFAULT_PITCH_CAP + 2) return;
      m.easeTo({ pitch: 78, duration: 900 });
    }, 1900);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    raf = requestAnimationFrame(frame);

    return () => {
      window.clearTimeout(settleIn);
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      // Restoring the cap also clamps the pitch back down if the user left it
      // above 60 — MapLibre does that itself on setMaxPitch.
      mapRef.current?.setMaxPitch(previousPitchCap ?? DEFAULT_PITCH_CAP);
    };
  }, [active, mapRef]);
}
