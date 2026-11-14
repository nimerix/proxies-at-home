import { CARD_H_MM, CARD_W_MM } from "../constants";
import { DPMM } from "./dpiHelpers";
import { loadImageWithBlobFetch } from "./imageUtils";

export async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type = "image/png",
  quality?: number
): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error(
                "The browser could not encode this image. Try a lower export DPI."
              )
            ),
      type,
      quality
    )
  );
}

// MPC inputs represent a 63 × 88 mm card surrounded by 3 mm of baked bleed.
// Deriving each crop from physical dimensions also handles nonstandard resolutions.
export function bakedBleedCrop(
  width: number,
  height: number,
  desiredBleedMm: number
) {
  const trim = Math.max(0, 3 - desiredBleedMm);
  const x = (width * trim) / (CARD_W_MM + 6);
  const y = (height * trim) / (CARD_H_MM + 6);
  return { x, y, width: width - 2 * x, height: height - 2 * y };
}

export async function renderCardCanvas(
  src: string,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  signal?: AbortSignal
) {
  const img = await loadImageWithBlobFetch(src, signal);
  const pixelsPerMm = DPMM(dpi);
  const width = Math.round(CARD_W_MM * pixelsPerMm);
  const height = Math.round(CARD_H_MM * pixelsPerMm);
  const bleed = Math.round(bleedMm * pixelsPerMm);
  const output = document.createElement("canvas");
  output.width = width + 2 * bleed;
  output.height = height + 2 * bleed;
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable. Try another browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, output.width, output.height);
  if (hasBakedBleed && bleedMm <= 3) {
    const crop = bakedBleedCrop(img.width, img.height, bleedMm);
    ctx.drawImage(
      img,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      output.width,
      output.height
    );
    return output;
  }
  const base = document.createElement("canvas");
  base.width = width;
  base.height = height;
  const bctx = base.getContext("2d", { willReadFrequently: true });
  if (!bctx) throw new Error("Canvas is unavailable. Try another browser.");
  bctx.imageSmoothingQuality = "high";
  const crop = hasBakedBleed
    ? bakedBleedCrop(img.width, img.height, 0)
    : { x: 0, y: 0, width: img.width, height: img.height };
  const scale = Math.max(width / crop.width, height / crop.height);
  bctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    (width - crop.width * scale) / 2,
    (height - crop.height * scale) / 2,
    crop.width * scale,
    crop.height * scale
  );
  // Fill transparent rounded corners behind the original artwork, without altering it.
  bctx.globalCompositeOperation = "destination-over";
  const sample = bctx.getImageData(
    Math.min(width - 1, Math.round(3 * pixelsPerMm)),
    Math.min(height - 1, Math.round(3 * pixelsPerMm)),
    1,
    1
  ).data;
  bctx.fillStyle = `rgb(${sample[0]}, ${sample[1]}, ${sample[2]})`;
  bctx.fillRect(0, 0, width, height);
  bctx.globalCompositeOperation = "source-over";
  if (bleed > 0) {
    const edge = bctx.getImageData(0, 0, 1, height).data;
    let dark = 0;
    for (let i = 0; i < edge.length; i += 4)
      if (edge[i] < 30 && edge[i + 1] < 30 && edge[i + 2] < 30) dark++;
    if (dark / height > 0.7) {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, output.width, output.height);
    } else {
      // Reflected tiles meet continuously at each card edge, including corners.
      for (const x of [-1, 0, 1])
        for (const y of [-1, 0, 1]) {
          ctx.save();
          ctx.translate(
            bleed + (x === 1 ? 2 * width : 0),
            bleed + (y === 1 ? 2 * height : 0)
          );
          ctx.scale(x === 0 ? 1 : -1, y === 0 ? 1 : -1);
          ctx.drawImage(base, 0, 0);
          ctx.restore();
        }
    }
  }
  ctx.drawImage(base, bleed, bleed);
  base.width = 0;
  base.height = 0;
  return output;
}
