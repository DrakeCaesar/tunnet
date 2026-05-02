/**
 * Shared window-level drag tracking (builder canvas, etc.).
 *
 * Policy notes:
 * - Prefer **pointer** events when the source is already a PointerEvent (templates, pen/touch).
 * - Keep **mousedown + mousemove + mouseup** path when the gesture starts from a legacy MouseEvent only (some canvas paths still use mousedown).
 * - For row/list picks where timing beats click, use **pointerdown** (see simulator drop board).
 */

/**
 * Attach move/end listeners for a primary-button drag on `window`.
 * @returns `cancel` — removes listeners **without** calling `onEnd` (e.g. hand off to another drag).
 */
export function capturePrimaryDragOnWindow(
  startEvent: MouseEvent | PointerEvent,
  handlers: {
    onMove: (ev: MouseEvent) => void;
    onEnd: (ev: MouseEvent) => void;
  },
): () => void {
  if (startEvent.button !== 0) {
    return (): void => {};
  }
  let cleaned = false;
  const pid = startEvent instanceof PointerEvent ? startEvent.pointerId : -1;

  const detachListeners = (): void => {
    if (startEvent instanceof PointerEvent) {
      window.removeEventListener("pointermove", onMovePtr);
      window.removeEventListener("pointerup", onEndPtr);
      window.removeEventListener("pointercancel", onEndPtr);
    } else {
      window.removeEventListener("mousemove", onMoveMouse);
      window.removeEventListener("mouseup", onEndMouse);
    }
  };

  const finish = (ev: MouseEvent): void => {
    if (cleaned) return;
    cleaned = true;
    detachListeners();
    handlers.onEnd(ev);
  };

  const cancelWithoutEnd = (): void => {
    if (cleaned) return;
    cleaned = true;
    detachListeners();
  };

  const onMovePtr = (ev: PointerEvent): void => {
    if (ev.pointerId !== pid) return;
    handlers.onMove(ev);
  };
  const onEndPtr = (ev: PointerEvent): void => {
    if (ev.pointerId !== pid) return;
    finish(ev);
  };
  const onMoveMouse = (ev: MouseEvent): void => handlers.onMove(ev);
  const onEndMouse = (ev: MouseEvent): void => {
    finish(ev);
  };

  if (startEvent instanceof PointerEvent) {
    window.addEventListener("pointermove", onMovePtr, { passive: false });
    window.addEventListener("pointerup", onEndPtr);
    window.addEventListener("pointercancel", onEndPtr);
  } else {
    window.addEventListener("mousemove", onMoveMouse, { passive: false });
    window.addEventListener("mouseup", onEndMouse);
  }

  return cancelWithoutEnd;
}
