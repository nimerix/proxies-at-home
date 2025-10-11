import { API_BASE, 
  DPI_MM_RECIP, 
  pixelDPIMap} from "../constants";

const DPI = 300;
const IN = (inches: number) => Math.round(inches * DPI);

export const DPMM = (dpi: number) => dpi * DPI_MM_RECIP;

export function guessBucketDpiFromHeight(h: number) {
  const epsilonMM = 0.1;
  let res = {dpi: 300, hasBleed: false, epsilon: Infinity};

  for (const [dpi, dims] of pixelDPIMap) {
    let err = Math.abs(dims.height - h);
    let errBleed = Math.abs(dims.heightWithBakedBleed - h);
    if (Math.min(err, errBleed) < res.epsilon) res = {dpi, hasBleed: errBleed < err, epsilon: Math.min(err, errBleed)};
    if (res.epsilon < Math.abs(DPMM(dpi) * epsilonMM)) return res; // good enough
  }
  return res;
}

export const createDpiHelpers = (dpi: number) => ({
  IN_TO_PX: (inches: number) => Math.round(inches * dpi),
  MM_TO_PX: (mm: number) => Math.round(mm * DPMM(dpi)),
});

export function toProxied(url: string) {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  const prefix = `${API_BASE}/api/cards/images/proxy?url=`;
  if (url.startsWith(prefix)) return url;
  return `${prefix}${encodeURIComponent(url)}`;
}

export function getBleedInPixels(bleedEdgeWidth: number, unit: string): number {
  return unit === "mm" ? IN(bleedEdgeWidth / 25.4) : IN(bleedEdgeWidth);
}

export function getLocalBleedImageUrl(originalUrl: string): string {
  return toProxied(originalUrl);
}

export async function urlToDataUrl(url: string): Promise<string> {
  const resp = await fetch(toProxied(url));
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export function pngToNormal(pngUrl: string) {
  try {
    const u = new URL(pngUrl);
    u.pathname = u.pathname.replace("/png/", "/normal/").replace(/\.png$/i, ".jpg");
    return u.toString();
  } catch {
    return pngUrl;
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type = "image/png",
  quality?: number
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return (canvas as any).convertToBlob({ type, quality });
  }
  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      type,
      quality
    );
  });
}

async function canvasToObjectUrl(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type = "image/png",
  quality?: number
): Promise<string> {
  const blob = await canvasToBlob(canvas, type, quality);
  return URL.createObjectURL(blob);
}

export function trimBleedEdge(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement("canvas");

    const timeoutId = setTimeout(() => reject(new Error("Image processing timeout")), 10000);
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";

    img.onload = async () => {
      clearTimeout(timeoutId);
      try {
        let bleedTrim = 76;
        if (img.height >= 2220 && img.height < 2960) bleedTrim = 78;
        if (img.height >= 2960 && img.height < 4440) bleedTrim = 104;
        if (img.height >= 4440) bleedTrim = 156;

        const width = img.width - bleedTrim * 2;
        const height = img.height - bleedTrim * 2;

        if (width <= 0 || height <= 0) {
          return resolve(src);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(src);

        ctx.drawImage(img, bleedTrim, bleedTrim, width, height, 0, 0, width, height);

        const outUrl = await canvasToObjectUrl(canvas, "image/png");

        try {
          const u = new URL(src);
          if (u.protocol === "blob:") URL.revokeObjectURL(src);
        } catch {}

        resolve(outUrl);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = (error) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load image: ${String(error)}`));
    };

    img.src = src.startsWith("http") ? toProxied(src) : src;
  });
}

export function blackenAllNearBlackPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  threshold: number,
  borderThickness = { top: 96, bottom: 400, left: 48, right: 48 }
) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    const topEdge = y < borderThickness.top;
    const botEdge = y >= height - borderThickness.bottom;
    for (let x = 0; x < width; x++) {
      const leftEdge = x < borderThickness.left;
      const rightEdge = x >= width - borderThickness.right;
      if (!(topEdge || botEdge || leftEdge || rightEdge)) continue;

      const index = (y * width + x) * 4;
      const r = data[index], g = data[index + 1], b = data[index + 2];
      if (r < threshold && g < threshold && b < threshold) {
        data[index] = 0; data[index + 1] = 0; data[index + 2] = 0;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function getPatchNearCorner(
  sx: number,
  sy: number,
  w: number,
  h: number,
  patchSize: number,
  tempCtx: CanvasRenderingContext2D
): { sx: number; sy: number } {
  const candidates = [
    [0, 0], [patchSize, 0], [0, patchSize], [-patchSize, 0], [0, -patchSize],
    [patchSize, patchSize], [-patchSize, patchSize], [patchSize, -patchSize], [-patchSize, -patchSize],
  ];

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  for (const [dx, dy] of candidates) {
    const px = clamp(sx + dx, 0, w - patchSize);
    const py = clamp(sy + dy, 0, h - patchSize);
    const data = tempCtx.getImageData(px, py, patchSize, patchSize).data;

    let opaqueCount = 0;
    let notTooWhiteCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a > 10) {
        opaqueCount++;
        if (r < 240 || g < 240 || b < 240) notTooWhiteCount++;
      }
    }
    const total = patchSize * patchSize;
    const opaqueRatio = opaqueCount / total;
    const texturedRatio = opaqueCount ? notTooWhiteCount / opaqueCount : 0;

    if (opaqueRatio >= 0.7 && texturedRatio >= 0.2) return { sx: px, sy: py };
  }

  return {
    sx: Math.max(0, Math.min(w - patchSize, sx)),
    sy: Math.max(0, Math.min(h - patchSize, sy)),
  };
}

export async function addBleedEdge(
  src: string,
  bleedOverride?: number,
  opts?: { unit?: "mm" | "in"; bleedEdgeWidth?: number }
) {
  return new Promise<string>((resolve, reject) => {
    const targetCardWidth = 744;   // 2.48" * 300
    const targetCardHeight = 1040; // 3.47" * 300
    const bleed = Math.round(getBleedInPixels(bleedOverride ?? opts?.bleedEdgeWidth ?? 0, opts?.unit ?? "mm"));

    const finalWidth = targetCardWidth + bleed * 2;
    const finalHeight = targetCardHeight + bleed * 2;

    const blackThreshold = 30;
    const blackToleranceRatio = 0.7;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = finalWidth;
    canvas.height = finalHeight;

    const img = new Image();
    const temp = document.createElement("canvas");

    const timeoutId = setTimeout(() => reject(new Error("Image processing timeout")), 15000);

    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";

    img.onload = async () => {
      try {
        clearTimeout(timeoutId);

        const aspectRatio = img.width / img.height;
        const targetAspect = targetCardWidth / targetCardHeight;

        let drawWidth = targetCardWidth;
        let drawHeight = targetCardHeight;
        let offsetX = 0;
        let offsetY = 0;

        if (aspectRatio > targetAspect) {
          drawHeight = targetCardHeight;
          drawWidth = img.width * (targetCardHeight / img.height);
          offsetX = (drawWidth - targetCardWidth) / 2;
        } else {
          drawWidth = targetCardWidth;
          drawHeight = img.height * (targetCardWidth / img.width);
          offsetY = (drawHeight - targetCardHeight) / 2;
        }

        temp.width = targetCardWidth;
        temp.height = targetCardHeight;
        const ctx2d = temp.getContext("2d", { willReadFrequently: true })!;
        ctx2d.drawImage(img, -offsetX, -offsetY, drawWidth, drawHeight);

        if (bleed === 0) {
          const outUrl = await canvasToObjectUrl(temp, "image/png");
          return resolve(outUrl);
        }

        const cornerSize = 30;
        const sampleInset = 10;
        const patchSize = 20;
        const applySoftBlur = true;

        const ALPHA_EMPTY = 10;
        function cornerNeedsFill(
          ctx2: CanvasRenderingContext2D,
          x: number,
          y: number,
          size: number
        ) {
          const data = ctx2.getImageData(x, y, size, size).data;
          const total = size * size;
          let empty = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i + 3] <= ALPHA_EMPTY) empty++;
          return empty / total >= 0.05;
        }

        const cornerCoords = [
          { x: 0, y: 0 },
          { x: temp.width - cornerSize, y: 0 },
          { x: 0, y: temp.height - cornerSize },
          { x: temp.width - cornerSize, y: temp.height - cornerSize },
        ];

        cornerCoords.forEach(({ x, y }) => {
          if (!cornerNeedsFill(ctx2d, x, y, cornerSize)) return;

          const baseSx = x < temp.width / 2 ? sampleInset : temp.width - sampleInset - patchSize;
          const baseSy = y < temp.height / 2 ? sampleInset : temp.height - sampleInset - patchSize;

          const { sx, sy } = getPatchNearCorner(baseSx, baseSy, temp.width, temp.height, patchSize, ctx2d);

          const prevFilter = ctx2d.filter;
          const prevSmoothing = ctx2d.imageSmoothingEnabled;

          ctx2d.save();
          ctx2d.globalCompositeOperation = "destination-over";
          ctx2d.filter = applySoftBlur ? "blur(0.6px)" : "none";
          ctx2d.imageSmoothingEnabled = true;

          ctx2d.drawImage(temp, sx, sy, patchSize, patchSize, x, y, cornerSize, cornerSize);

          ctx2d.restore();
          ctx2d.filter = prevFilter;
          ctx2d.imageSmoothingEnabled = prevSmoothing;
        });

        // Darken noisy near-black borders before mirroring check
        blackenAllNearBlackPixels(ctx2d, targetCardWidth, targetCardHeight, blackThreshold);

        // Check if left edge is mostly black → choose black-frame mode
        const edgeData = ctx2d.getImageData(0, 0, 1, targetCardHeight).data;
        let blackCount = 0;
        for (let i = 0; i < targetCardHeight; i++) {
          const r = edgeData[i * 4], g = edgeData[i * 4 + 1], b = edgeData[i * 4 + 2];
          if (r < blackThreshold && g < blackThreshold && b < blackThreshold) blackCount++;
        }
        const isMostlyBlack = blackCount / targetCardHeight > blackToleranceRatio;

        const scaledUrl = await canvasToObjectUrl(temp, "image/png");
        const scaledImg = new Image();
        scaledImg.onload = async () => {
          // place core image
          ctx.drawImage(scaledImg, bleed, bleed);

          if (isMostlyBlack) {
            // sample a small slice for solid-ish edges
            const slice = Math.max(8, Math.min(bleed, 64));
            // L
            ctx.drawImage(scaledImg, 0, 0, slice, targetCardHeight, 0, bleed, bleed, targetCardHeight);
            // R
            ctx.drawImage(
              scaledImg,
              targetCardWidth - slice,
              0,
              slice,
              targetCardHeight,
              targetCardWidth + bleed,
              bleed,
              bleed,
              targetCardHeight
            );
            // T
            ctx.drawImage(scaledImg, 0, 0, targetCardWidth, slice, bleed, 0, targetCardWidth, bleed);
            // B
            ctx.drawImage(
              scaledImg,
              0,
              targetCardHeight - slice,
              targetCardWidth,
              slice,
              bleed,
              targetCardHeight + bleed,
              targetCardWidth,
              bleed
            );
            // corners
            ctx.drawImage(scaledImg, 0, 0, slice, slice, 0, 0, bleed, bleed);
            ctx.drawImage(
              scaledImg,
              targetCardWidth - slice,
              0,
              slice,
              slice,
              targetCardWidth + bleed,
              0,
              bleed,
              bleed
            );
            ctx.drawImage(
              scaledImg,
              0,
              targetCardHeight - slice,
              slice,
              slice,
              0,
              targetCardHeight + bleed,
              bleed,
              bleed
            );
            ctx.drawImage(
              scaledImg,
              targetCardWidth - slice,
              targetCardHeight - slice,
              slice,
              slice,
              targetCardWidth + bleed,
              targetCardHeight + bleed,
              bleed,
              bleed
            );
          } else {
            // mirrored edges
            ctx.save(); ctx.scale(-1, 1);
            ctx.drawImage(scaledImg, 0, 0, bleed, targetCardHeight, -bleed, bleed, bleed, targetCardHeight);
            ctx.restore();

            ctx.save(); ctx.scale(-1, 1);
            ctx.drawImage(
              scaledImg,
              targetCardWidth - bleed,
              0,
              bleed,
              targetCardHeight,
              -(targetCardWidth + bleed * 2),
              bleed,
              bleed,
              targetCardHeight
            );
            ctx.restore();

            ctx.save(); ctx.scale(1, -1);
            ctx.drawImage(scaledImg, 0, 0, targetCardWidth, bleed, bleed, -bleed, targetCardWidth, bleed);
            ctx.restore();

            ctx.save(); ctx.scale(1, -1);
            ctx.drawImage(
              scaledImg,
              0,
              targetCardHeight - bleed,
              targetCardWidth,
              bleed,
              bleed,
              -(targetCardHeight + bleed * 2),
              targetCardWidth,
              bleed
            );
            ctx.restore();

            // mirrored corners
            ctx.save(); ctx.scale(-1, -1);
            ctx.drawImage(scaledImg, 0, 0, bleed, bleed, -bleed, -bleed, bleed, bleed); ctx.restore();

            ctx.save(); ctx.scale(-1, -1);
            ctx.drawImage(
              scaledImg,
              targetCardWidth - bleed,
              0,
              bleed,
              bleed,
              -(targetCardWidth + bleed * 2),
              -bleed,
              bleed,
              bleed
            ); ctx.restore();

            ctx.save(); ctx.scale(-1, -1);
            ctx.drawImage(
              scaledImg,
              0,
              targetCardHeight - bleed,
              bleed,
              bleed,
              -bleed,
              -(targetCardHeight + bleed * 2),
              bleed,
              bleed
            ); ctx.restore();

            ctx.save(); ctx.scale(-1, -1);
            ctx.drawImage(
              scaledImg,
              targetCardWidth - bleed,
              targetCardHeight - bleed,
              bleed,
              bleed,
              -(targetCardWidth + bleed * 2),
              -(targetCardHeight + bleed * 2),
              bleed,
              bleed
            ); ctx.restore();
          }

          // Final output as object URL
          const outUrl = await canvasToObjectUrl(canvas, "image/png");

          // Clean up the temporary scaled URL
          try { URL.revokeObjectURL(scaledUrl); } catch {}

          resolve(outUrl);
        };

        scaledImg.onerror = (error) => reject(new Error(`Failed to load scaled image: ${String(error)}`));
        scaledImg.src = scaledUrl;
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = (error) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load image: ${String(error)}`));
    };

    img.src = src.startsWith("http") ? toProxied(src) : src;
  });
}
