import {
  createCanvas,
  getCanvasContext,
  type DrawingContext,
} from "./canvasSurface";
import type { BleedBorders } from "./bleedBorders";

const fade = (distance: number, width: number) => {
  const t = Math.min(1, distance / Math.max(1, width));
  return t * t * (3 - 2 * t);
};

/** Overlay only outside trim. A 0.2 mm transition matches aged border tones
 * at the cut, then stays canonical black/white for the entire remaining bleed.
 */
export function paintBorderBleed(
  ctx: DrawingContext,
  borders: BleedBorders,
  bleed: number,
  width: number,
  height: number,
  pixelsPerMm: number
) {
  if (bleed <= 0) return;
  const fadePixels = 0.2 * pixelsPerMm;
  const tile = createCanvas();
  ctx.save();
  // Linear interpolation keeps profile weights between their sampled bounds.
  ctx.imageSmoothingQuality = "low";
  try {
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      const weights = borders.weights[edge];
      if (!weights?.some((v) => v > 0)) continue;
      const horizontal = edge === "top" || edge === "bottom";
      tile.width = horizontal ? weights.length : bleed;
      tile.height = horizontal ? bleed : weights.length;
      const tctx = getCanvasContext(tile);
      const pixels = tctx.createImageData(tile.width, tile.height);
      for (let y = 0; y < tile.height; y++)
        for (let x = 0; x < tile.width; x++) {
          const along = horizontal ? x : y;
          const outward = horizontal
            ? edge === "top"
              ? bleed - 1 - y
              : y
            : edge === "left"
              ? bleed - 1 - x
              : x;
          const p = (y * tile.width + x) * 4;
          pixels.data[p] =
            pixels.data[p + 1] =
            pixels.data[p + 2] =
              borders.tone;
          pixels.data[p + 3] = 255 * weights[along] * fade(outward, fadePixels);
        }
      tctx.putImageData(pixels, 0, 0);
      // Profile samples sit on physical endpoints, while canvas pixels are
      // centered. Expand by half a sample on each end and clip to the edge.
      const length = horizontal ? width : height;
      const spacing = length / (weights.length - 1);
      ctx.save();
      ctx.beginPath();
      if (horizontal) {
        ctx.rect(bleed, edge === "top" ? 0 : bleed + height, width, bleed);
        ctx.clip();
        ctx.drawImage(
          tile,
          bleed - spacing / 2,
          edge === "top" ? 0 : bleed + height,
          width + spacing,
          bleed
        );
      } else {
        ctx.rect(edge === "left" ? 0 : bleed + width, bleed, bleed, height);
        ctx.clip();
        ctx.drawImage(
          tile,
          edge === "left" ? 0 : bleed + width,
          bleed - spacing / 2,
          bleed,
          height + spacing
        );
      }
      ctx.restore();
    }
    tile.width = tile.height = bleed;
    const tctx = getCanvasContext(tile);
    for (const right of [false, true])
      for (const bottom of [false, true]) {
        const horizontal = borders.weights[bottom ? "bottom" : "top"],
          vertical = borders.weights[right ? "right" : "left"];
        const h = horizontal?.[right ? horizontal.length - 1 : 0] ?? 0,
          v = vertical?.[bottom ? vertical.length - 1 : 0] ?? 0;
        if (h === 0 && v === 0) continue;
        // A fresh backing surface per corner prevents deferred WebKit copies
        // from observing the alpha pattern written for a later corner.
        tile.width = tile.height = bleed;
        const pixels = tctx.createImageData(bleed, bleed);
        for (let y = 0; y < bleed; y++)
          for (let x = 0; x < bleed; x++) {
            const dx = right ? x : bleed - 1 - x,
              dy = bottom ? y : bleed - 1 - y;
            // Keep each adjacent edge's material across its own sector. Blend
            // only from 30° to 60° instead of smudging color across the corner.
            const sum = dx + dy;
            const t = sum
              ? Math.max(
                  0,
                  Math.min(1, 0.5 + (dy - dx) / (2 * (2 - Math.sqrt(3)) * sum))
                )
              : 0;
            const weight = h === v ? h : v + (h - v) * t * t * (3 - 2 * t);
            const p = (y * bleed + x) * 4;
            pixels.data[p] =
              pixels.data[p + 1] =
              pixels.data[p + 2] =
                borders.tone;
            pixels.data[p + 3] =
              255 * weight * fade(Math.max(dx, dy), fadePixels);
          }
        tctx.putImageData(pixels, 0, 0);
        ctx.drawImage(
          tile,
          right ? bleed + width : 0,
          bottom ? bleed + height : 0
        );
      }
  } finally {
    ctx.restore();
    tile.width = tile.height = 0;
  }
}
