/** Padding around measured text so stroke / antialiasing stay inside the rect. */
export const PACKET_LABEL_BG_PAD_X_PX = 8;
export const PACKET_LABEL_BG_PAD_Y_PX = 5;

/**
 * Sizes and positions the label background from the rendered text bounding box.
 * Falls back to fixed origin + `fallbackSize` when measurement is unavailable.
 */
export function layoutPacketLabelBackgroundRect(
  text: SVGTextElement,
  bg: SVGRectElement,
  fallbackSize: { width: number; height: number },
  fallbackOrigin: { x: number; y: number },
): void {
  try {
    const b = text.getBBox();
    if (Number.isFinite(b.x) && Number.isFinite(b.y) && b.width > 0.25 && b.height > 0.25) {
      const x = b.x - PACKET_LABEL_BG_PAD_X_PX;
      const y = b.y - PACKET_LABEL_BG_PAD_Y_PX;
      const w = b.width + 2 * PACKET_LABEL_BG_PAD_X_PX;
      const h = b.height + 2 * PACKET_LABEL_BG_PAD_Y_PX;
      bg.setAttribute("x", x.toFixed(2));
      bg.setAttribute("y", y.toFixed(2));
      bg.setAttribute("width", w.toFixed(2));
      bg.setAttribute("height", h.toFixed(2));
      return;
    }
  } catch {
    // Detached or not laid out yet.
  }
  bg.setAttribute("x", fallbackOrigin.x.toFixed(2));
  bg.setAttribute("y", fallbackOrigin.y.toFixed(2));
  bg.setAttribute("width", fallbackSize.width.toFixed(2));
  bg.setAttribute("height", fallbackSize.height.toFixed(2));
}
