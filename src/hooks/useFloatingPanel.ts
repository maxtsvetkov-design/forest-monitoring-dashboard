import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "./useDragResize";

export interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FloatingPanelOptions {
  /** Where the panel sits before anyone touches it. Called rather than passed
   * as a value because the default is usually derived from the viewport, which
   * isn't known until the browser has one. */
  initial: () => PanelBox;
  minW: number;
  minH: number;
  /** Keeps this much of the panel on screen at every edge, so a panel dragged
   * to a corner can always be dragged back. */
  margin?: number;
}

/**
 * A panel the reader can move and resize — position and size in viewport
 * coordinates, with two gestures on top.
 *
 * Deliberately NOT an extension of `useDragResize`. That hook maps X-axis
 * pointer travel to a single clamped number, which is exactly right for its
 * three callers (a split-pane percentage, a column's pixel width, a sidebar's
 * width) and exactly wrong here: a floating window moves and resizes in two
 * axes at once, so bolting a Y axis onto the 1-D hook would complicate all
 * three of those call sites to serve this one. What the two do share is the
 * useful part — listeners on `document`, not the handle, so a gesture survives
 * the pointer leaving the element and ends cleanly on release anywhere.
 *
 * Both gestures clamp against the live viewport, and a resize clamps its
 * *edges* rather than its size: dragging the corner can never push the panel's
 * far side off screen, which is the failure that leaves a window with a grip
 * nobody can reach.
 */
export function useFloatingPanel({ initial, minW, minH, margin = 24 }: FloatingPanelOptions) {
  const [box, setBox] = useState<PanelBox>(initial);
  const [mode, setMode] = useState<"idle" | "move" | "resize">("idle");
  const gestureRef = useRef<{ pointerX: number; pointerY: number; box: PanelBox } | null>(null);

  const beginMove = useCallback(
    (event: React.PointerEvent) => {
      // Only the primary button, and never a gesture that started on a control
      // inside the drag handle — a header that eats its own close button is
      // worse than a header that cannot be dragged.
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      gestureRef.current = { pointerX: event.clientX, pointerY: event.clientY, box };
      setMode("move");
    },
    [box],
  );

  const beginResize = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      gestureRef.current = { pointerX: event.clientX, pointerY: event.clientY, box };
      setMode("resize");
    },
    [box],
  );

  const reset = useCallback(() => setBox(initial()), [initial]);

  useEffect(() => {
    if (mode === "idle") return;

    function handleMove(e: PointerEvent) {
      const g = gestureRef.current;
      if (!g) return;
      const dx = e.clientX - g.pointerX;
      const dy = e.clientY - g.pointerY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (mode === "move") {
        setBox({
          ...g.box,
          x: clamp(g.box.x + dx, margin - g.box.w, vw - margin),
          y: clamp(g.box.y + dy, 0, vh - margin),
        });
        return;
      }

      // Resize from the bottom-right: the top-left corner is fixed, so the
      // ceilings are whatever space is left between it and the viewport edge.
      setBox({
        ...g.box,
        w: clamp(g.box.w + dx, minW, Math.max(minW, vw - g.box.x - margin / 2)),
        h: clamp(g.box.h + dy, minH, Math.max(minH, vh - g.box.y - margin / 2)),
      });
    }

    function handleUp() {
      gestureRef.current = null;
      setMode("idle");
    }

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleUp);
    };
  }, [mode, margin, minW, minH]);

  // A window left hanging off screen by a viewport that shrank under it (a
  // rotate, a devtools open) has to be pulled back, or its own drag handle is
  // unreachable and nothing can fix it.
  useEffect(() => {
    function onResize() {
      setBox((prev) => ({
        ...prev,
        x: clamp(prev.x, margin - prev.w, window.innerWidth - margin),
        y: clamp(prev.y, 0, window.innerHeight - margin),
        w: Math.min(prev.w, Math.max(minW, window.innerWidth - margin)),
        h: Math.min(prev.h, Math.max(minH, window.innerHeight - margin)),
      }));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [margin, minW, minH]);

  /** Arrow-key resize, matching the convention every other grip in this app
   * follows (see docs/ARCHITECTURE.md §6: double-click resets, arrows nudge). */
  const nudge = useCallback(
    (event: React.KeyboardEvent, step = 16) => {
      const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
      if (dx === 0 && dy === 0) return;
      event.preventDefault();
      setBox((prev) => ({
        ...prev,
        w: clamp(prev.w + dx, minW, Math.max(minW, window.innerWidth - prev.x - margin / 2)),
        h: clamp(prev.h + dy, minH, Math.max(minH, window.innerHeight - prev.y - margin / 2)),
      }));
    },
    [margin, minW, minH],
  );

  return { box, beginMove, beginResize, reset, nudge, moving: mode === "move", resizing: mode === "resize" };
}
