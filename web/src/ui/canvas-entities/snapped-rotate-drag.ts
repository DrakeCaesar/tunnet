import { capturePrimaryDragOnWindow } from "../input/pointer-drag";

/** Shared teardown / overlay hooks for builder rotate drags (relay ring, hub centroid, …). */
export type RotateDragChrome = {
  shouldUpdateWiresDuringDrag: boolean;
  scheduleWireOverlayIfDragging: () => void;
  scheduleWireOverlayIfIdle: () => void;
  clearBuilderDragCursor: () => void;
  schedulePersist: () => void;
  renderInspector: () => void;
  setBuilderDragCursor: (cursor: "grabbing" | "crosshair") => void;
  clearDragRenderRaf: () => void;
};

/**
 * 2D rotation in client space around a fixed pivot, with per-step snap in degrees.
 * Used for relay (90°) and hub face (30°) — same math, different pivot + snap.
 */
export function startSnappedRotateDragAroundPivot(opts: {
  ev: MouseEvent;
  pivotClientX: number;
  pivotClientY: number;
  snapDegrees: number;
  rotatingRootIds: readonly string[];
  readAngleDeg: (rootId: string) => number;
  writeAngleDeg: (rootId: string, newDeg: number) => void;
  chrome: RotateDragChrome;
}): void {
  const {
    ev,
    pivotClientX,
    pivotClientY,
    snapDegrees,
    rotatingRootIds,
    readAngleDeg,
    writeAngleDeg,
    chrome,
  } = opts;
  const a0 = Math.atan2(ev.clientY - pivotClientY, ev.clientX - pivotClientX);

  const baseById = new Map<string, number>();
  for (const id of rotatingRootIds) {
    baseById.set(id, readAngleDeg(id));
  }

  ev.preventDefault();
  chrome.setBuilderDragCursor("grabbing");
  capturePrimaryDragOnWindow(ev, {
    onMove: (mv) => {
      const a1 = Math.atan2(mv.clientY - pivotClientY, mv.clientX - pivotClientX);
      const deltaDeg = ((a1 - a0) * 180) / Math.PI;
      let changed = false;
      for (const id of rotatingRootIds) {
        const base = baseById.get(id);
        if (base === undefined) continue;
        let newDeg = base + deltaDeg;
        newDeg = ((newDeg % 360) + 360) % 360;
        newDeg = Math.round(newDeg / snapDegrees) * snapDegrees;
        newDeg = ((newDeg % 360) + 360) % 360;
        const curDeg = readAngleDeg(id);
        if (Math.abs(curDeg - newDeg) < 0.001) continue;
        writeAngleDeg(id, newDeg);
        changed = true;
      }
      if (!changed) return;
      if (chrome.shouldUpdateWiresDuringDrag) {
        chrome.scheduleWireOverlayIfDragging();
      }
    },
    onEnd: () => {
      chrome.clearDragRenderRaf();
      chrome.clearBuilderDragCursor();
      if (!chrome.shouldUpdateWiresDuringDrag) {
        chrome.scheduleWireOverlayIfIdle();
      }
      chrome.schedulePersist();
      chrome.renderInspector();
    },
  });
}
