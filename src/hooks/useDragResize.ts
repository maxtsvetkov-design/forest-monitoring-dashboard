import { useCallback, useEffect, useRef, useState } from "react";

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

interface DragResizeOptions {
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Fired once when the pointer is released — e.g. to call `map.resize()`. */
  onEnd?: () => void;
}

/**
 * Pointer-drag along the X axis, mapped to a clamped number.
 *
 * Both resize affordances in the Assets view reduce to this: the split-pane
 * divider drags a percentage, a column's grip drags a pixel width. The only
 * difference is the unit, which the caller supplies as `scale` (value units per
 * pixel of travel) when the drag begins — the split pane can't know its scale
 * until it can measure the container, so it's a `begin` argument rather than
 * config.
 *
 * Listeners live on `document`, not the handle, so the drag survives the pointer
 * leaving the element — releasing anywhere on the page ends it cleanly.
 */
export function useDragResize({ min, max, onChange, onEnd }: DragResizeOptions) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startValue: number; scale: number } | null>(null);

  // The pointer listeners are attached once per drag; reading the callbacks
  // through refs keeps them from going stale without re-subscribing mid-drag.
  const onChangeRef = useRef(onChange);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onChangeRef.current = onChange;
    onEndRef.current = onEnd;
  });

  const begin = useCallback((event: { clientX: number; preventDefault: () => void }, startValue: number, scale = 1) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startValue, scale };
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    function handleMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      onChangeRef.current(clamp(drag.startValue + (e.clientX - drag.startX) * drag.scale, min, max));
    }
    function handleUp() {
      dragRef.current = null;
      setDragging(false);
      onEndRef.current?.();
    }

    // Without this, dragging across the table selects rows of text and the
    // cursor flickers back to the default over every element it crosses.
    document.body.classList.add("is-dragging-resize");
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    return () => {
      document.body.classList.remove("is-dragging-resize");
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, min, max]);

  return { dragging, begin };
}
