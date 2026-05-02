import type { BuilderEntityRoot, BuilderLayer } from "../../builder/state";
import { capturePrimaryDragOnWindow } from "../input/pointer-drag";

const EDGE_PAD_PX = 8;

/**
 * Starts a text-note resize drag when the pointer is in the bottom/right resize band.
 * Does not change layout/CSS footprint math — only relocates the interaction implementation.
 */
export function tryStartTextEntityResizeDrag(opts: {
  ev: MouseEvent;
  entityEl: HTMLElement;
  rootEnt: BuilderEntityRoot;
  seg: HTMLElement;
  gridTileXPx: number;
  gridTileYPx: number;
  segmentEntitiesHost: (layer: BuilderLayer, segment: number) => HTMLElement | null | undefined;
  textTileSizeFromEntity: (e: BuilderEntityRoot) => { wTiles: number; hTiles: number };
  setEntityDomPosition: (rootId: string, x: number, y: number) => void;
  setTextEntitySizeDom: (rootId: string, wTiles: number, hTiles: number) => void;
  scheduleWireOverlayRender: () => void;
  clearBuilderDragCursor: () => void;
  schedulePersist: () => void;
  renderInspector: () => void;
  setBuilderDragCursor: (cursor: "grabbing" | "crosshair") => void;
  /** Return true if entity was updated (skip DOM when false / unchanged). */
  mutateTextEntityIfChanged: (
    rootId: string,
    placement: { x: number; y: number; widthTiles: number; heightTiles: number },
  ) => boolean;
}): boolean {
  const { rootEnt } = opts;
  if (rootEnt.templateType !== "text") return false;

  const rect = opts.entityEl.getBoundingClientRect();
  const localX = opts.ev.clientX - rect.left;
  const localY = opts.ev.clientY - rect.top;
  const hitRight = localX >= rect.width - EDGE_PAD_PX;
  const hitBottom = localY >= rect.height - EDGE_PAD_PX;
  const resizeX = hitRight ? 1 : 0;
  const resizeY = hitBottom ? 1 : 0;
  if (resizeX === 0 && resizeY === 0) return false;

  opts.ev.preventDefault();
  const host = opts.segmentEntitiesHost(rootEnt.layer, rootEnt.segmentIndex) ?? opts.seg;
  const hostW = Math.max(1, host.clientWidth);
  const hostH = Math.max(1, host.clientHeight);
  const maxX = Math.max(0, Math.floor(hostW / opts.gridTileXPx) - 1);
  const maxY = Math.max(0, Math.floor(hostH / opts.gridTileYPx) - 1);
  const startX = opts.ev.clientX;
  const startY = opts.ev.clientY;
  const startTiles = opts.textTileSizeFromEntity(rootEnt);
  const startLeft = rootEnt.x;
  const startTop = rootEnt.y;
  const startRight = startLeft + startTiles.wTiles - 1;
  const startBottom = startTop + startTiles.hTiles - 1;

  opts.setBuilderDragCursor("grabbing");
  capturePrimaryDragOnWindow(opts.ev, {
    onMove: (mv) => {
      const dxTiles = Math.round((mv.clientX - startX) / opts.gridTileXPx);
      const dyTiles = Math.round((mv.clientY - startY) / opts.gridTileYPx);
      let left = startLeft;
      let right = startRight;
      let top = startTop;
      let bottom = startBottom;
      if (resizeX < 0) {
        left = Math.max(0, Math.min(startRight - 1, startLeft + dxTiles));
      } else if (resizeX > 0) {
        right = Math.max(startLeft + 1, Math.min(maxX, startRight + dxTiles));
      }
      if (resizeY < 0) {
        top = Math.max(0, Math.min(startBottom - 1, startTop + dyTiles));
      } else if (resizeY > 0) {
        bottom = Math.max(startTop + 1, Math.min(maxY, startBottom + dyTiles));
      }
      const nextW = right - left + 1;
      const nextH = bottom - top + 1;
      const changed = opts.mutateTextEntityIfChanged(rootEnt.id, {
        x: left,
        y: top,
        widthTiles: nextW,
        heightTiles: nextH,
      });
      if (!changed) return;
      opts.setEntityDomPosition(rootEnt.id, left, top);
      opts.setTextEntitySizeDom(rootEnt.id, nextW, nextH);
      opts.scheduleWireOverlayRender();
    },
    onEnd: () => {
      opts.clearBuilderDragCursor();
      opts.schedulePersist();
      opts.renderInspector();
    },
  });
  return true;
}
