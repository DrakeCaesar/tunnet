import { BUILDER_WIRE_COLORS, BUILDER_WIRE_COLOR_COUNT, clampWireColorIndex } from "./wire-colors";

/** Shared mutable selection (0 .. BUILDER_WIRE_COLOR_COUNT-1). */
export type BuilderWireColorChoice = { index: number };

function annularSectorPath(
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number,
): string {
  const rad = Math.PI / 180;
  const xo1 = outerR * Math.cos(startDeg * rad);
  const yo1 = outerR * Math.sin(startDeg * rad);
  const xo2 = outerR * Math.cos(endDeg * rad);
  const yo2 = outerR * Math.sin(endDeg * rad);
  const xi1 = innerR * Math.cos(endDeg * rad);
  const yi1 = innerR * Math.sin(endDeg * rad);
  const xi2 = innerR * Math.cos(startDeg * rad);
  const yi2 = innerR * Math.sin(startDeg * rad);
  const span = endDeg - startDeg;
  const largeArc = span > 180 ? 1 : 0;
  return `M ${xo1} ${yo1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${xo2} ${yo2} L ${xi1} ${yi1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi2} ${yi2} Z`;
}

/**
 * Renders an 8-slot donut color picker into `host`. Updates `choice.index` on segment click.
 */
export function mountBuilderWireColorWheel(host: HTMLElement | null, choice: BuilderWireColorChoice): void {
  if (!host) return;

  const gapDeg = 0;
  const wedgeDeg = 360 / BUILDER_WIRE_COLOR_COUNT - gapDeg;
  const innerR = 27;
  const outerR = 54;
  const selectedRadiusOffsetPx = 9;
  const separatorStroke = 4;

  host.innerHTML = "";
  host.classList.add("builder-wire-color-wheel-panel");

  const wrap = document.createElement("div");
  wrap.className = "builder-wire-color-wheel-wrap";
  wrap.setAttribute("role", "radiogroup");
  wrap.setAttribute("aria-label", "Wire color");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-64 -64 128 128");
  svg.setAttribute("width", "118");
  svg.setAttribute("height", "118");
  svg.classList.add("builder-wire-color-wheel-svg");

  const segmentsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  segmentsGroup.classList.add("builder-wire-color-wheel-segments");

  const segmentNodes: { g: SVGGElement; path: SVGPathElement; start: number; end: number }[] = [];

  for (let i = 0; i < BUILDER_WIRE_COLOR_COUNT; i += 1) {
    const mid = -90 + i * (360 / BUILDER_WIRE_COLOR_COUNT);
    const start = mid - wedgeDeg / 2;
    const end = mid + wedgeDeg / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", annularSectorPath(innerR, outerR, start, end));
    path.setAttribute("fill", BUILDER_WIRE_COLORS[i]!);
    path.classList.add("builder-wire-color-wheel-seg");

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.appendChild(path);
    segmentsGroup.appendChild(g);
    segmentNodes.push({ g, path, start, end });

    path.style.cursor = "pointer";

    const pick = (): void => {
      choice.index = clampWireColorIndex(i);
      syncSelection();
    };

    path.addEventListener("click", (e) => {
      e.preventDefault();
      pick();
    });
  }

  svg.appendChild(segmentsGroup);

  // Draw fixed-width radial separators so segment gaps stay visually constant
  // instead of widening toward the outside radius.
  const separators = document.createElementNS("http://www.w3.org/2000/svg", "g");
  separators.setAttribute("pointer-events", "none");
  const sepStartDeg = -90 - 180 / BUILDER_WIRE_COLOR_COUNT;
  for (let i = 0; i < BUILDER_WIRE_COLOR_COUNT; i += 1) {
    const a = ((sepStartDeg + i * (360 / BUILDER_WIRE_COLOR_COUNT)) * Math.PI) / 180;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String((innerR - 1) * Math.cos(a)));
    line.setAttribute("y1", String((innerR - 1) * Math.sin(a)));
    line.setAttribute("x2", String((outerR + selectedRadiusOffsetPx + 1) * Math.cos(a)));
    line.setAttribute("y2", String((outerR + selectedRadiusOffsetPx + 1) * Math.sin(a)));
    line.setAttribute("stroke", "var(--builder-wire-wheel-hole, rgba(15, 19, 27, 0.96))");
    line.setAttribute("stroke-width", String(separatorStroke));
    line.setAttribute("stroke-linecap", "butt");
    separators.appendChild(line);
  }
  svg.appendChild(separators);

  const hole = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hole.setAttribute("r", String(innerR - 2));
  hole.setAttribute("fill", "var(--builder-wire-wheel-hole, rgba(15, 19, 27, 0.96))");
  hole.setAttribute("pointer-events", "none");
  svg.appendChild(hole);

  wrap.appendChild(svg);
  host.appendChild(wrap);

  function syncSelection(): void {
    const sel = clampWireColorIndex(choice.index);
    choice.index = sel;
    for (let i = 0; i < segmentNodes.length; i += 1) {
      const { g, path, start, end } = segmentNodes[i]!;
      const midRad = ((-90 + i * (360 / BUILDER_WIRE_COLOR_COUNT)) * Math.PI) / 180;
      const selected = i === sel;
      g.setAttribute("transform", "translate(0 0)");
      const selectedRadiusOffset = selected ? selectedRadiusOffsetPx : 0;
      path.setAttribute(
        "d",
        annularSectorPath(
          innerR + selectedRadiusOffset,
          outerR + selectedRadiusOffset,
          start,
          end,
        ),
      );
      path.setAttribute("stroke", selected ? "none" : "rgba(0,0,0,0.35)");
      path.setAttribute("stroke-width", selected ? "0" : "0.9");
      path.setAttribute(
        "aria-label",
        selected ? `Wire color ${i + 1}, selected` : `Wire color ${i + 1}`,
      );
    }
  }

  wrap.tabIndex = 0;
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowUp" && e.key !== "ArrowDown") {
      return;
    }
    e.preventDefault();
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    choice.index = clampWireColorIndex(choice.index + delta);
    syncSelection();
  });

  syncSelection();
}
