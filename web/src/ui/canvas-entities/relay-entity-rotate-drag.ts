import type { RotateDragChrome } from "./snapped-rotate-drag";
import { startSnappedRotateDragAroundPivot } from "./snapped-rotate-drag";

/**
 * Relay outer-band rotation: pivot at relay bbox center, 90° snap.
 */
export function startRelayRotateDrag(opts: {
  ev: MouseEvent;
  entityEl: HTMLElement;
  rotatingRootIds: readonly string[];
  readBaseAngleDeg: (rootId: string) => number;
  writeAngleDeg: (rootId: string, newDeg: number) => void;
  chrome: RotateDragChrome;
}): void {
  const r = opts.entityEl.getBoundingClientRect();
  startSnappedRotateDragAroundPivot({
    ev: opts.ev,
    pivotClientX: r.left + r.width / 2,
    pivotClientY: r.top + r.height / 2,
    snapDegrees: 90,
    rotatingRootIds: opts.rotatingRootIds,
    readAngleDeg: opts.readBaseAngleDeg,
    writeAngleDeg: opts.writeAngleDeg,
    chrome: opts.chrome,
  });
}
