import type { CSSProperties } from "react";
import EstateDashboard from "./EstateDashboard";
import DriftListView from "./DriftListView";

/**
 * The floating content of Crop Monitor's Insights/Drift-list pair — both
 * panels are always mounted here, stacked in the same box, and only their
 * transform differs. Switching tabs never touches MapsView's own tree
 * (App.tsx renders one `<MapsView>` for both tabs — see its own comment),
 * so the map keeps its WebGL context and camera exactly as they were; only
 * these two panels move, Insights off to the left as Drift list slides in
 * from the right, and back.
 *
 * One shared duration and easing drives both panels, not a fast exit racing
 * a slower, bouncier entrance — that mismatch is what made the earlier pass
 * read as a yank rather than a morph. The two literally move in lockstep
 * here: whichever is leaving and whichever is arriving trace the same curve
 * over the same span, which is what actually sells "one shape becoming
 * another" instead of "two unrelated things swapping." `--ease-lux`
 * (index.css) is the same long, expensive-feeling glide `.view-enter`
 * already uses for page-level transitions — reusing it is what keeps this
 * pair's motion in the same family as the rest of the app's, rather than
 * introducing a third, one-off feel just for these two tabs.
 *
 * No opacity anywhere — a panel is hidden by being physically carried past
 * the container's `overflow-hidden` edge, not faded out under the one still
 * there.
 *
 * No `filter` on these wrappers either, even though a motion blur was the
 * original plan for the dissolve — CSS `filter` on an ancestor creates a new
 * stacking context that pre-rasterizes everything under it, which breaks
 * `backdrop-filter` (the glass panels' own `backdrop-blur-md`, see
 * glassPanel.ts) from sampling the real map behind it. The panels would
 * flatten from true frosted glass to a near-opaque white block for as long
 * as the ancestor blur was non-zero — a visible white flash right in the
 * middle of the transition every panel is built to avoid elsewhere. `scale`
 * and `skewX` alone carry the morph now; they don't touch compositing the
 * way `filter` does, so the glass stays glass the whole way through.
 *
 * Keeping the inactive panel mounted (off-screen, not unmounted) rather than
 * conditionally rendering it is what makes the motion itself possible — a
 * remounted panel has nothing to animate from.
 */

// Inline `style`, not Tailwind classes, for the transform/transition itself:
// arbitrary-value utilities built for a one-off animation like this one
// (a "%"-based translate a skew and a blur all need to move in exact lockstep)
// are exactly the case Tailwind's JIT scanner is least reliable picking up on
// the first pass — and a transform this specific has no reason to go through
// a class name at all. Layout stays in `className`; only the thing actually
// animating is inline.
const MORPH_TRANSITION = "transform 780ms var(--ease-lux)";

/** `side` picks which edge a hidden panel rests off toward, and which way it
 *  skews getting there — the same shape whether it's mid-motion or already
 *  parked, since the transition just interpolates toward or away from it.
 *  Subtle by design (a few degrees, a soft blur) rather than the sharper
 *  deformation an earlier pass used — "elegant" reads as restraint here, not
 *  more distortion.
 *
 *  110%, not something closer to 60% — `translateX` is a percentage of
 *  *this wrapper's own* width (it's `absolute inset-0`, so the full content
 *  box), not of whichever child happens to be narrower. DriftListView only
 *  fills the left half of that box (`w-1/2` — see its own comment on why),
 *  so a 60% shift left its content's right edge still inside the viewport
 *  on Insights: the summary bar stayed visibly readable when it should have
 *  been fully offscreen. 110% clears the whole wrapper regardless of how
 *  wide its child actually renders. */
function morphLayerStyle(
  active: boolean,
  side: "left" | "right",
): CSSProperties {
  const sign = side === "left" ? -1 : 1;
  return {
    transform: active
      ? "translateX(0) skewX(0deg) scale(1)"
      : `translateX(${sign * 110}%) skewX(${sign * 3}deg) scale(0.95)`,
    transformOrigin: side,
    transition: MORPH_TRANSITION,
    backfaceVisibility: "hidden",
    willChange: "transform",
  };
}

export default function CropMonitorOverlay({
  mode,
  areaName,
  onFocusField,
  selectedField,
  onHoverFields,
}: {
  mode: "insights" | "drift";
  areaName: string;
  /** A Drift list card's field letter ("A"–"D") — toggles that field's
   *  selection (isolating the shared map underneath to it) and, when
   *  selecting rather than deselecting, flies the camera there too. See
   *  App.tsx's `selectDriftField`. */
  onFocusField: (field: string) => void;
  /** Which field's card is currently selected, so DriftListView can ring
   *  it and the map's own isolation stays in sync with what the list shows
   *  as picked. See App.tsx's `selectedDriftField`. */
  selectedField?: string | null;
  /** EstateDashboard's own KPI-card hover — which field band(s) to glow on
   *  the shared map underneath, or `null` to clear. See App.tsx's
   *  `hoveredFieldLetters`. */
  onHoverFields?: (letters: string[] | null) => void;
}) {
  // Both wrappers stay `pointer-events-none` unconditionally, active panel or
  // not — each is `absolute inset-0`, the box's FULL size, even though the
  // real content inside (EstateDashboard's left column, DriftListView's
  // half-width panel) only covers part of it. Making the wrapper itself
  // `pointer-events-auto` for whichever mode is active used to catch clicks
  // and drags across that whole box, including the empty space beside the
  // panel — which is exactly the area the live map underneath needs to stay
  // pannable through. EstateDashboard and DriftListView already flip
  // `pointer-events-auto` back on for their own actual glass cards (see
  // each one's own comment), so nothing here needs to.
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={morphLayerStyle(mode === "insights", "left")}
        aria-hidden={mode !== "insights"}
      >
        <EstateDashboard
          onHoverFields={onHoverFields}
          onFocusField={onFocusField}
          selectedField={selectedField}
        />
      </div>
      <div
        className="absolute inset-0 pointer-events-none"
        style={morphLayerStyle(mode === "drift", "right")}
        aria-hidden={mode !== "drift"}
      >
        <DriftListView
          areaName={areaName}
          onSelectField={onFocusField}
          selectedField={selectedField}
        />
      </div>
    </div>
  );
}
