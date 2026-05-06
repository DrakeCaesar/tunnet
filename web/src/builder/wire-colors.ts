/**
 * Builder wire stroke palette (8 slots). Replace hex values by hand; order matches the color wheel
 * clockwise starting from the top segment.
 */
export const BUILDER_WIRE_COLORS = [
  "#302B2F",
  "#DC5DA4",
  "#B33644",
  "#F7D123",
  "#E7E0CE",
  "#AE605E",
  "#44655E",
  "#3B4A7A",
] as const;

export const BUILDER_WIRE_COLOR_COUNT = BUILDER_WIRE_COLORS.length;

export function clampWireColorIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(BUILDER_WIRE_COLOR_COUNT - 1, Math.floor(index)));
}

/** Resolved stroke for SVG `stroke` (missing / legacy links → slot 0). */
export function builderWireStrokeHex(index: number | undefined): string {
  return BUILDER_WIRE_COLORS[clampWireColorIndex(index ?? 0)]!;
}
