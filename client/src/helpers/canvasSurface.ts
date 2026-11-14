/** The same renderer runs on DOM canvases and on a dedicated worker. */
export type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
export type DrawingContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export function createCanvas(width = 0, height = 0): CanvasSurface {
  if (typeof document === "undefined")
    return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function getCanvasContext(
  canvas: CanvasSurface,
  options?: CanvasRenderingContext2DSettings
): DrawingContext {
  const ctx = canvas.getContext("2d", options) as DrawingContext | null;
  if (!ctx) throw new Error("Canvas is unavailable. Try another browser.");
  return ctx;
}
