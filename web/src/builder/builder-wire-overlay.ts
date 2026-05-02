import { expandLinks } from "./clone-engine";
import type { BuilderState } from "./state";
import { isOuterLeafVoidSegment, isStaticOuterLeafEndpoint } from "./state";

/** Port DOM identity for link dragging (mirrors share rootId). */
export type LinkSourceSelection = {
  rootId: string;
  port: number;
  instanceId: string;
};

export type WirePerfKey = "wire.total" | "wire.expandLinks" | "wire.portResolve" | "wire.lineBuild";

export type BuilderWireOverlayOptions = {
  root: HTMLElement;
  wireOverlayEl: SVGSVGElement;
  canvasEl: HTMLElement;
  getState: () => BuilderState;
  recordPerf: (key: WirePerfKey, ms: number) => void;
  perfCounts: { stateLinks: number; expandedLinks: number };
  /** After wire `innerHTML`; use `performance.now() - overlayPassStartMs` for `wire.total` if desired. */
  afterWireOverlayPaint: (overlayPassStartMs: number) => void;
  setBuilderDragCursor: (cursor: "crosshair") => void;
  clearBuilderDragCursor: () => void;
  /** Called after clearing rubber-band state and refreshing wires once. */
  commitLinkDragResult: (input: {
    from: LinkSourceSelection;
    toPort: HTMLButtonElement | null;
    startedFromPacket: boolean;
  }) => void;
};

const WIRE_PORT_DROP_ZONE_PX = 5;
const WIRE_DRAG_START_THRESHOLD_PX = 3;

function portCacheKey(instanceId: string, port: number): string {
  return `${instanceId}#${port}`;
}

export function createBuilderWireOverlay(opts: BuilderWireOverlayOptions): {
  rebuildPortElementCache: () => void;
  resolveBuilderPortForWireOverlay: (instanceId: string, port: number) => HTMLButtonElement | null;
  builderPortFromClientPoint: (clientX: number, clientY: number) => HTMLButtonElement | null;
  renderWireOverlay: () => void;
  scheduleWireOverlayRender: () => void;
  scheduleWireDragPaint: () => void;
  startLinkDragFromPort: (portEl: HTMLButtonElement, ev: PointerEvent) => void;
  isLinkDragActive: () => boolean;
  clearLinkDrag: () => void;
  attachScrollAndResizeListeners: (wrap: HTMLElement) => void;
} {
  const {
    root,
    wireOverlayEl,
    canvasEl,
    getState,
    recordPerf,
    perfCounts,
    afterWireOverlayPaint,
    setBuilderDragCursor,
    clearBuilderDragCursor,
    commitLinkDragResult,
  } = opts;

  let portElByInstancePort = new Map<string, HTMLButtonElement>();
  let linkDrag: { from: LinkSourceSelection; endClient: { x: number; y: number } } | null = null;
  let wireOverlayRaf: number | null = null;
  let wireDragRaf: number | null = null;

  function rebuildPortElementCache(): void {
    const next = new Map<string, HTMLButtonElement>();
    canvasEl.querySelectorAll<HTMLButtonElement>(".builder-port[data-instance-id][data-port]").forEach((portEl) => {
      const instanceId = portEl.dataset.instanceId ?? "";
      const p = Number(portEl.dataset.port);
      if (!instanceId || Number.isNaN(p)) return;
      next.set(portCacheKey(instanceId, p), portEl);
    });
    portElByInstancePort = next;
  }

  function resolveBuilderPortForWireOverlay(instanceId: string, port: number): HTMLButtonElement | null {
    const byInstance = portElByInstancePort.get(portCacheKey(instanceId, port)) ?? null;
    if (byInstance) return byInstance;
    const m = instanceId.match(/^(.+)@(\d+)$/);
    if (!m) return null;
    const rootId = m[1] ?? "";
    const seg = Number(m[2]);
    if (!Number.isInteger(seg) || seg < 0 || seg > 63) return null;
    const state = getState();
    const ent = state.entities.find((e) => e.id === rootId);
    if (!ent || !isStaticOuterLeafEndpoint(ent) || ent.layer !== "outer64") {
      return null;
    }
    if (isOuterLeafVoidSegment(seg)) {
      return canvasEl.querySelector<HTMLButtonElement>(
        `.builder-segment[data-void-outer="1"] .builder-port[data-instance-id="${instanceId}"][data-port="${port}"]`,
      );
    }
    return canvasEl.querySelector<HTMLButtonElement>(
      `.builder-segment[data-layer="outer64"][data-segment="${seg}"] [data-static-endpoint="1"] .builder-port[data-port="${port}"]`,
    );
  }

  function builderPortFromClientPoint(clientX: number, clientY: number): HTMLButtonElement | null {
    const stackedPort =
      document
        .elementsFromPoint(clientX, clientY)
        .map((node) => node.closest<HTMLButtonElement>(".builder-port"))
        .find((port): port is HTMLButtonElement => port !== null) ?? null;
    if (stackedPort) return stackedPort;

    let closestPort: HTMLButtonElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    canvasEl.querySelectorAll<HTMLButtonElement>(".builder-port[data-instance-id][data-port]").forEach((portEl) => {
      const rect = portEl.getBoundingClientRect();
      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const distance = Math.hypot(dx, dy);
      if (distance > WIRE_PORT_DROP_ZONE_PX || distance >= closestDistance) return;
      closestDistance = distance;
      closestPort = portEl;
    });
    return closestPort;
  }

  function renderWireOverlay(): void {
    const t0 = performance.now();
    const wrap = wireOverlayEl.parentElement;
    if (!wrap) return;
    const scrollbarRightPx = Math.max(0, wrap.offsetWidth - wrap.clientWidth);
    const scrollbarBottomPx = Math.max(0, wrap.offsetHeight - wrap.clientHeight);
    root.style.setProperty("--builder-floating-scrollbar-right", `${scrollbarRightPx}px`);
    root.style.setProperty("--builder-floating-scrollbar-bottom", `${scrollbarBottomPx}px`);
    const state = getState();
    const tExpand0 = performance.now();
    const viewLinks = expandLinks(state.links, state.entities);
    const tExpand1 = performance.now();
    recordPerf("wire.expandLinks", tExpand1 - tExpand0);
    perfCounts.stateLinks = state.links.length;
    perfCounts.expandedLinks = viewLinks.length;
    const wrapRect = wrap.getBoundingClientRect();
    const contentWidth = Math.max(canvasEl.scrollWidth, canvasEl.clientWidth);
    const contentHeight = Math.max(canvasEl.scrollHeight, canvasEl.clientHeight);
    const overlayWidth = Math.max(wrap.clientWidth, contentWidth);
    const overlayHeight = Math.max(wrap.clientHeight, contentHeight);
    wireOverlayEl.setAttribute("width", String(Math.ceil(overlayWidth)));
    wireOverlayEl.setAttribute("height", String(Math.ceil(overlayHeight)));
    wireOverlayEl.style.width = `${Math.ceil(overlayWidth)}px`;
    wireOverlayEl.style.height = `${Math.ceil(overlayHeight)}px`;
    let lineMarkup = "";
    let resolveCost = 0;
    const tLine0 = performance.now();
    const portWireEndpoint = (
      portEl: HTMLButtonElement,
    ): { x: number; y: number; radius: number; clipped: boolean } | null => {
      const viewport = portEl.closest<HTMLElement>(".builder-segment-entities");
      const rect = portEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      let clientX = rect.left + rect.width / 2;
      let clientY = rect.top + rect.height / 2;
      let clipped = false;
      if (viewport) {
        const viewportRect = viewport.getBoundingClientRect();
        if (viewportRect.width <= 0 || viewportRect.height <= 0) return null;
        const clampedX = Math.max(viewportRect.left, Math.min(viewportRect.right, clientX));
        const clampedY = Math.max(viewportRect.top, Math.min(viewportRect.bottom, clientY));
        clipped = clampedX !== clientX || clampedY !== clientY;
        clientX = clampedX;
        clientY = clampedY;
      }
      return {
        x: clientX - wrapRect.left + wrap.scrollLeft,
        y: clientY - wrapRect.top + wrap.scrollTop,
        radius: clipped ? 0 : rect.width / 2,
        clipped,
      };
    };
    const lineEndpointsAtPortEdges = (
      x1: number,
      y1: number,
      r1: number,
      x2: number,
      y2: number,
      r2: number,
    ): { sx: number; sy: number; ex: number; ey: number } => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) {
        return { sx: x1, sy: y1, ex: x2, ey: y2 };
      }
      const ux = dx / d;
      const uy = dy / d;
      const startInset = Math.min(r1, d * 0.45);
      const endInset = Math.min(r2, d * 0.45);
      return {
        sx: x1 + ux * startInset,
        sy: y1 + uy * startInset,
        ex: x2 - ux * endInset,
        ey: y2 - uy * endInset,
      };
    };
    for (const link of viewLinks) {
      const tr0 = performance.now();
      const from = resolveBuilderPortForWireOverlay(String(link.fromInstanceId), link.fromPort);
      const to = resolveBuilderPortForWireOverlay(String(link.toInstanceId), link.toPort);
      resolveCost += performance.now() - tr0;
      if (!from || !to) continue;
      const fromCenter = portWireEndpoint(from);
      const toCenter = portWireEndpoint(to);
      if (!fromCenter || !toCenter) continue;
      if (fromCenter.clipped && toCenter.clipped) continue;
      const e = lineEndpointsAtPortEdges(
        fromCenter.x,
        fromCenter.y,
        fromCenter.radius,
        toCenter.x,
        toCenter.y,
        toCenter.radius,
      );
      lineMarkup += `<line x1="${e.sx}" y1="${e.sy}" x2="${e.ex}" y2="${e.ey}" stroke="#f9e2af" stroke-opacity="0.9" stroke-width="1.5"></line>`;
    }
    recordPerf("wire.portResolve", resolveCost);
    recordPerf("wire.lineBuild", performance.now() - tLine0);
    const drag = linkDrag;
    if (drag) {
      const fromPort =
        resolveBuilderPortForWireOverlay(String(drag.from.instanceId), drag.from.port) ??
        (drag.from.instanceId
          ? null
          : canvasEl.querySelector<HTMLButtonElement>(
              `.builder-port[data-root-id="${drag.from.rootId}"][data-port="${drag.from.port}"]`,
            ));
      if (fromPort) {
        const fromCenter = portWireEndpoint(fromPort);
        if (fromCenter) {
          const x2 = drag.endClient.x - wrapRect.left + wrap.scrollLeft;
          const y2 = drag.endClient.y - wrapRect.top + wrap.scrollTop;
          const e = lineEndpointsAtPortEdges(fromCenter.x, fromCenter.y, fromCenter.radius, x2, y2, 0);
          lineMarkup += `<line x1="${e.sx}" y1="${e.sy}" x2="${e.ex}" y2="${e.ey}" class="builder-wire-drag" pointer-events="none"></line>`;
        }
      }
    }
    wireOverlayEl.innerHTML = lineMarkup;
    afterWireOverlayPaint(t0);
  }

  function scheduleWireOverlayRender(): void {
    if (wireOverlayRaf !== null) return;
    wireOverlayRaf = window.requestAnimationFrame(() => {
      wireOverlayRaf = null;
      renderWireOverlay();
    });
  }

  function scheduleWireDragPaint(): void {
    if (wireDragRaf !== null) return;
    wireDragRaf = window.requestAnimationFrame(() => {
      wireDragRaf = null;
      renderWireOverlay();
    });
  }

  function startLinkDragFromPort(portEl: HTMLButtonElement, ev: PointerEvent): void {
    if (ev.button !== 0 || !ev.isPrimary) return;
    const downClient = { x: ev.clientX, y: ev.clientY };
    const startedFromPacket = ev.target instanceof Element && !!ev.target.closest("circle.builder-packet-dot");
    const rootId = portEl.dataset.rootId!;
    const port = Number(portEl.dataset.port);
    const instanceId = portEl.dataset.instanceId ?? "";
    const from: LinkSourceSelection = { rootId, port, instanceId };
    const wrap = wireOverlayEl.parentElement;
    if (!wrap) return;
    let started = false;
    const beginDrag = (clientX: number, clientY: number): void => {
      if (started) return;
      started = true;
      root.classList.add("builder-wire-dragging");
      linkDrag = { from, endClient: { x: clientX, y: clientY } };
      setBuilderDragCursor("crosshair");
      renderWireOverlay();
    };
    const onMove = (e: PointerEvent): void => {
      e.preventDefault();
      if (!started) {
        const dx = e.clientX - downClient.x;
        const dy = e.clientY - downClient.y;
        if (Math.hypot(dx, dy) < WIRE_DRAG_START_THRESHOLD_PX) return;
        beginDrag(e.clientX, e.clientY);
      }
      linkDrag = { from, endClient: { x: e.clientX, y: e.clientY } };
      scheduleWireDragPaint();
    };
    let ended = false;
    const onEnd = (e: PointerEvent): void => {
      if (ended) return;
      ended = true;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      clearBuilderDragCursor();
      if (wireDragRaf !== null) {
        window.cancelAnimationFrame(wireDragRaf);
        wireDragRaf = null;
      }
      if (!started) {
        root.classList.remove("builder-wire-dragging");
        return;
      }
      e.preventDefault();
      if (startedFromPacket) {
        // Consumed by canvas (suppress packet toggle on pointerup).
      }
      const toPort = builderPortFromClientPoint(e.clientX, e.clientY);
      root.classList.remove("builder-wire-dragging");
      linkDrag = null;
      renderWireOverlay();
      commitLinkDragResult({ from, toPort, startedFromPacket });
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function attachScrollAndResizeListeners(wrap: HTMLElement): void {
    wrap.addEventListener("scroll", scheduleWireOverlayRender, { passive: true });
    window.addEventListener("resize", scheduleWireOverlayRender);
  }

  return {
    rebuildPortElementCache,
    resolveBuilderPortForWireOverlay,
    builderPortFromClientPoint,
    renderWireOverlay,
    scheduleWireOverlayRender,
    scheduleWireDragPaint,
    startLinkDragFromPort,
    isLinkDragActive: () => linkDrag !== null,
    clearLinkDrag: () => {
      linkDrag = null;
    },
    attachScrollAndResizeListeners,
  };
}
