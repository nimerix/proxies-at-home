import { CARD_H_MM, CARD_W_MM } from "../constants";
import { DPMM } from "./dpiHelpers";
import {
  createCanvas,
  getCanvasContext,
  type DrawingContext,
  type CanvasSurface,
} from "./canvasSurface";
import { describeBleedBorders, type BleedReport } from "./bleedReport";

import { loadImageWithBlobFetch } from "./imageUtils";
import {
  DEFAULT_BLEED_ARTWORK,
  ALPHA_REPAIR_BAND_MM,
  ALPHA_SEARCH_MM,
  repairScanPerimeterAsync,
  type BleedArtworkOptions,
} from "./bleedArtwork";
import {
  detectBorderProfile,
  resolveBleedBorders,
  paintBorderBleed,
  type BorderProfile,
  type CardEdge,
} from "./bleedBorders";

export type CardRenderOptions = {
  signal?: AbortSignal;
  artwork?: BleedArtworkOptions;
  onReport?: (report: BleedReport) => void;
};

type Rect = { x: number; y: number; width: number; height: number };
type ImageSize = { width: number; height: number };
export type PerimeterBandLayout = {
  edge: CardEdge;
  source: Rect;
  clip: Rect;
};
export type PreparedCardSource = ImageSize & {
  kind: "prepared";
  interior: ImageBitmap;
  bands: { edge: CardEdge; bitmap: ImageBitmap }[];
};
type CardRasterSource =
  | (ImageSize & { kind: "original"; image: HTMLImageElement })
  | PreparedCardSource;

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
  options: CardRenderOptions = {}
) {
  const img = await loadImageWithBlobFetch(src, options.signal);
  try {
    await img.decode();
    return (await renderLoadedCard(
      { kind: "original", image: img, width: img.width, height: img.height },
      bleedMm,
      hasBakedBleed,
      dpi,
      options
    )) as HTMLCanvasElement;
  } finally {
    // Release the decoded source once all drawing has copied its pixels.
    img.src = "";
  }
}

export async function renderPreparedCard(
  source: PreparedCardSource,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  options: CardRenderOptions = {}
) {
  return renderLoadedCard(source, bleedMm, hasBakedBleed, dpi, options);
}

/** Preserve the original-image resize filter before transferring to a worker.
 * ImageBitmap resizing uses a different filter in some browsers. */
export function prepareCardInterior(
  img: HTMLImageElement,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  artwork = DEFAULT_BLEED_ARTWORK
) {
  const scale = DPMM(dpi);
  const supplied = hasBakedBleed ? Math.round(Math.min(3, bleedMm) * scale) : 0;
  const canvas = createCanvas(
    Math.round(CARD_W_MM * scale) + 2 * supplied,
    Math.round(CARD_H_MM * scale) + 2 * supplied
  );
  const ctx = getCanvasContext(canvas);
  ctx.imageSmoothingQuality = "high";
  if (hasBakedBleed) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const crop = hasBakedBleed
    ? bakedBleedCrop(img.width, img.height, bleedMm)
    : artworkCrop(img.width, img.height, artwork.source);
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

async function renderLoadedCard(
  source: CardRasterSource,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  options: CardRenderOptions
) {
  const { signal, artwork = DEFAULT_BLEED_ARTWORK } = options;
  const extendBorders = artwork.borders !== "mirror";
  options.onReport?.({
    kind:
      bleedMm <= 0
        ? "none"
        : hasBakedBleed && bleedMm <= 3
          ? "supplied"
          : "mirror",
  });
  signal?.throwIfAborted();
  const pixelsPerMm = DPMM(dpi);
  const width = Math.round(CARD_W_MM * pixelsPerMm);
  const height = Math.round(CARD_H_MM * pixelsPerMm);
  const bleed = Math.round(bleedMm * pixelsPerMm);
  const output = createCanvas();
  output.width = width + 2 * bleed;
  output.height = height + 2 * bleed;
  const ctx = getCanvasContext(output);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, output.width, output.height);
  if (hasBakedBleed && bleedMm <= 3) {
    if (source.kind === "prepared") {
      ctx.drawImage(source.interior, 0, 0);
      return output;
    }
    const crop = bakedBleedCrop(source.width, source.height, bleedMm);
    ctx.drawImage(
      source.image,
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
  signal?.throwIfAborted();
  // Baked bleed is already artwork. Keep the full supplied 3 mm ring and
  // reflect only the extra width requested beyond it.
  if (hasBakedBleed) {
    const provided = createCanvas();
    try {
      const baked = Math.round(3 * pixelsPerMm);
      provided.width = width + 2 * baked;
      provided.height = height + 2 * baked;
      const pctx = getCanvasContext(provided);
      pctx.imageSmoothingQuality = "high";
      pctx.fillStyle = "#FFFFFF";
      pctx.fillRect(0, 0, provided.width, provided.height);
      // Match the 3 mm rendering at the same origin, then copy it at 1:1.
      // Resizing the source under a translated transform can round differently.
      if (source.kind === "prepared") pctx.drawImage(source.interior, 0, 0);
      else
        pctx.drawImage(
          source.image,
          0,
          0,
          source.width,
          source.height,
          0,
          0,
          provided.width,
          provided.height
        );
      drawReflectedArtwork(
        ctx,
        provided,
        width + 2 * baked,
        height + 2 * baked,
        bleed - baked
      );
      if (extendBorders) {
        const profiles = await preparePerimeter(
          ctx,
          source,
          { x: 0, y: 0, width: source.width, height: source.height },
          {
            inset: artwork.insetMm,
            cleanup: false,
            signal,
            dimensions: { width: CARD_W_MM + 6, height: CARD_H_MM + 6 },
          }
        );
        const borders = resolveBleedBorders(profiles);
        options.onReport?.(describeBleedBorders(borders));
        paintBorderBleed(
          ctx,
          borders,
          bleed - baked,
          width + 2 * baked,
          height + 2 * baked,
          pixelsPerMm
        );
      }
      return output;
    } catch (error) {
      output.width = output.height = 0;
      throw error;
    } finally {
      provided.width = provided.height = 0;
    }
  }

  const base = createCanvas();
  base.width = width;
  base.height = height;
  const bctx = getCanvasContext(base);
  bctx.imageSmoothingQuality = "high";
  try {
    const crop = artworkCrop(source.width, source.height, artwork.source);
    // The interior is drawn directly from the original. Only four small
    // native-resolution bands are copied and repaired before being resized.
    if (source.kind === "prepared") bctx.drawImage(source.interior, 0, 0);
    else
      bctx.drawImage(
        source.image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        width,
        height
      );
    const profiles =
      artwork.source === "scan" || (bleed > 0 && extendBorders)
        ? await preparePerimeter(bctx, source, crop, {
            inset: artwork.insetMm,
            cleanup: artwork.source === "scan",
            signal,
            cornerRadiusMm: artwork.cornerRadiusMm,
            analyzeBorders: bleed > 0 && extendBorders,
          })
        : [];
    signal?.throwIfAborted();
    drawReflectedArtwork(ctx, base, width, height, bleed);
    if (bleed > 0 && extendBorders) {
      const borders = resolveBleedBorders(profiles);
      options.onReport?.(
        describeBleedBorders(
          borders,
          artwork.source === "scan" ? profiles : undefined
        )
      );
      paintBorderBleed(ctx, borders, bleed, width, height, pixelsPerMm);
    }
    return output;
  } catch (error) {
    output.width = output.height = 0;
    throw error;
  } finally {
    base.width = base.height = 0;
  }
}

/** Near-aspect scans retain every original row; other shapes keep cover fitting. */
export function artworkCrop(
  width: number,
  height: number,
  source: BleedArtworkOptions["source"]
) {
  const nearCard =
    Math.abs(width / height / (CARD_W_MM / CARD_H_MM) - 1) <= 0.02;
  if (source === "scan" && nearCard) return { x: 0, y: 0, width, height };
  const scale = Math.min(width / CARD_W_MM, height / CARD_H_MM);
  const w = Math.max(1, Math.round(CARD_W_MM * scale)),
    h = Math.max(1, Math.round(CARD_H_MM * scale));
  return {
    x: Math.floor((width - w) / 2),
    y: Math.floor((height - h) / 2),
    width: w,
    height: h,
  };
}

/** The native bands used by both direct rendering and worker preparation. */
function perimeterBandLayout(
  crop: Rect,
  target: ImageSize
): PerimeterBandLayout[] {
  const { width, height } = crop;
  const sx = target.width / width,
    sy = target.height / height;
  // Keep resampling support outside the painted band. No strip-edge clamping
  // may affect its join with the unchanged interior, even in a small preview.
  const guardX = Math.ceil(4 / sx) + 2,
    guardY = Math.ceil(4 / sy) + 2;
  const paintX = Math.min(
    width,
    Math.ceil((ALPHA_REPAIR_BAND_MM * width) / CARD_W_MM) + guardX
  );
  const paintY = Math.min(
    height,
    Math.ceil((ALPHA_REPAIR_BAND_MM * height) / CARD_H_MM) + guardY
  );
  const readX = Math.min(
    width,
    paintX + guardX + Math.ceil((ALPHA_SEARCH_MM * width) / CARD_W_MM)
  );
  const readY = Math.min(
    height,
    paintY + guardY + Math.ceil((ALPHA_SEARCH_MM * height) / CARD_H_MM)
  );
  const paintW = Math.ceil(paintX * sx),
    paintH = Math.ceil(paintY * sy);
  const targetW = target.width,
    targetH = target.height;
  return [
    {
      edge: "top",
      source: { x: 0, y: 0, width, height: readY },
      clip: { x: 0, y: 0, width: targetW, height: paintH },
    },
    {
      edge: "bottom",
      source: { x: 0, y: height - readY, width, height: readY },
      clip: { x: 0, y: targetH - paintH, width: targetW, height: paintH },
    },
    {
      edge: "left",
      source: { x: 0, y: 0, width: readX, height },
      clip: { x: 0, y: 0, width: paintW, height: targetH },
    },
    {
      edge: "right",
      source: { x: width - readX, y: 0, width: readX, height },
      clip: { x: targetW - paintW, y: 0, width: paintW, height: targetH },
    },
  ];
}

/** Select exactly the bands the renderer will consume; supplied MPC bleed and
 * square mirrored artwork do not need any native perimeter pixels. */
export function cardPerimeterPlan(
  nativeSize: ImageSize,
  bleedMm: number,
  hasBakedBleed: boolean,
  dpi: number,
  artwork = DEFAULT_BLEED_ARTWORK
): { crop: Rect; bands: PerimeterBandLayout[] } | null {
  const scale = DPMM(dpi);
  const bleed = Math.round(bleedMm * scale);
  const extendBorders = artwork.borders !== "mirror";
  if (
    hasBakedBleed
      ? bleedMm <= 3 || !extendBorders
      : artwork.source !== "scan" && !(bleed > 0 && extendBorders)
  )
    return null;
  const crop = hasBakedBleed
    ? { x: 0, y: 0, ...nativeSize }
    : artworkCrop(nativeSize.width, nativeSize.height, artwork.source);
  // The baked >3 mm analysis runs against the full output context. Regular
  // scan repair runs against the trim-sized interior context.
  const target = {
    width: Math.round(CARD_W_MM * scale) + (hasBakedBleed ? 2 * bleed : 0),
    height: Math.round(CARD_H_MM * scale) + (hasBakedBleed ? 2 * bleed : 0),
  };
  return { crop, bands: perimeterBandLayout(crop, target) };
}

async function preparePerimeter(
  ctx: DrawingContext,
  raster: CardRasterSource,
  crop: Rect,
  {
    inset,
    cleanup,
    signal,
    cornerRadiusMm,
    dimensions = { width: CARD_W_MM, height: CARD_H_MM },
    analyzeBorders = true,
  }: {
    inset: number;
    cleanup: boolean;
    signal?: AbortSignal;
    cornerRadiusMm?: number;
    dimensions?: { width: number; height: number };
    analyzeBorders?: boolean;
  }
) {
  const { width, height } = crop;
  const targetW = ctx.canvas.width,
    targetH = ctx.canvas.height;
  const sx = targetW / width,
    sy = targetH / height;
  const bands = perimeterBandLayout(crop, { width: targetW, height: targetH });
  const band = createCanvas();
  const profiles: BorderProfile[] = [];
  try {
    for (const { edge, source, clip } of bands) {
      const { x, y, width: w, height: h } = source;
      const { x: clipX, y: clipY, width: clipW, height: clipH } = clip;
      if (width * height > 4_000_000)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      band.width = w;
      band.height = h;
      const bctx = getCanvasContext(band, { willReadFrequently: true });
      // Integer source crop, 1:1 copy: never resample an untrusted scan pixel.
      if (raster.kind === "original")
        bctx.drawImage(raster.image, crop.x + x, crop.y + y, w, h, 0, 0, w, h);
      else {
        const prepared = raster.bands.find(
          (item) => item.edge === edge
        )?.bitmap;
        if (!prepared || prepared.width !== w || prepared.height !== h)
          throw new Error(
            "The prepared image perimeter does not match this render."
          );
        bctx.drawImage(prepared, 0, 0);
      }
      const pixels = bctx.getImageData(0, 0, w, h);
      const spans = cleanup
        ? await repairScanPerimeterAsync(
            pixels,
            inset,
            { x, y, fullWidth: width, fullHeight: height },
            signal,
            cornerRadiusMm
          )
        : [];
      if (analyzeBorders)
        profiles.push(
          detectBorderProfile(
            pixels,
            { x, y, fullWidth: width, fullHeight: height },
            edge,
            dimensions,
            cleanup ? inset : 0
          )
        );
      if (!cleanup) continue;
      bctx.putImageData(pixels, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, clipY, clipW, clipH);
      ctx.clip();
      // Paint only repaired pixels and their resampling footprint. Browser
      // filters can differ for image and canvas sources, so redrawing whole
      // bands would unnecessarily change otherwise untouched fine artwork.
      const supportX = Math.max(2, Math.ceil(3 / sx)),
        supportY = Math.max(2, Math.ceil(3 / sy));
      ctx.beginPath();
      for (const span of spans) {
        const y0 = Math.floor((span.y - supportY) * sy),
          y1 = Math.ceil((span.y + span.height + supportY) * sy);
        if (span.left > 0)
          ctx.rect(0, y0, Math.ceil((span.left + supportX) * sx), y1 - y0);
        if (span.right < width) {
          const x0 = Math.floor((span.right - supportX) * sx);
          ctx.rect(x0, y0, targetW - x0, y1 - y0);
        }
      }
      ctx.clip();
      ctx.clearRect(clipX, clipY, clipW, clipH);
      ctx.drawImage(band, x * sx, y * sy, w * sx, h * sy);
      ctx.restore();
    }
    return profiles;
  } finally {
    band.width = band.height = 0;
  }
}

function drawReflectedArtwork(
  ctx: DrawingContext,
  source: HTMLImageElement | ImageBitmap | CanvasSurface,
  width: number,
  height: number,
  bleed: number
) {
  // Every tile shares the same repaired artwork, including all four corners.
  // No global black-border guess and no independent flat corner fills.
  for (const x of bleed > 0 ? [-1, 0, 1] : [0])
    for (const y of bleed > 0 ? [-1, 0, 1] : [0]) {
      ctx.save();
      ctx.translate(
        bleed + (x === 1 ? 2 * width : 0),
        bleed + (y === 1 ? 2 * height : 0)
      );
      ctx.scale(x === 0 ? 1 : -1, y === 0 ? 1 : -1);
      ctx.drawImage(
        source,
        0,
        0,
        source.width,
        source.height,
        0,
        0,
        width,
        height
      );
      ctx.restore();
    }
}
