import { API_BASE, CARD_H_MM, CARD_W_MM, pixelDPIMap } from "@/constants";
import type { LoadingProgressState } from "@/store/loading";
import type { LayoutPreset } from "@/store/settings";
import type { CardOption } from "@/types/Card";
import { saveAs } from "file-saver";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import {
  createDpiHelpers,
  getPatchNearCorner,
  guessBucketDpiFromHeight,
  DPMM,
  canvasToBlob,
  isUploadedFileToken,
} from "./ImageHelper";

const NEAR_BLACK = 16;
const NEAR_WHITE = 239;


function getLocalBleedImageUrl(originalUrl: string) {
  return `${API_BASE}/api/cards/images/proxy?url=${encodeURIComponent(originalUrl)}`;
}

const ALPHA_EMPTY = 10; // treat <=10 alpha as transparent-ish

function cornerNeedsFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cornerSize: number
) {
  const data = ctx.getImageData(x, y, cornerSize, cornerSize).data;
  const total = cornerSize * cornerSize;
  let empty = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= ALPHA_EMPTY) empty++;
  }
  // Require at least 5% transparent area to fill
  return empty / total >= 0.05;
}

function detectFlatBorderColor(
  ctx: CanvasRenderingContext2D,
  contentW: number,
  contentH: number,
  cornerX: number,
  cornerY: number,
  sampleLen: number,   // how far inward to sample
  strip: number        // strip thickness
): "black" | "white" | null {
  const leftEdge = cornerX === 0;
  const topEdge = cornerY === 0;
  const rightEdge = cornerX >= contentW - strip;
  const bottomEdge = cornerY >= contentH - strip;

  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (leftEdge) rects.push({ x: 0, y: cornerY, w: strip, h: Math.min(sampleLen, contentH - cornerY) });
  if (topEdge) rects.push({ x: cornerX, y: 0, w: Math.min(sampleLen, contentW - cornerX), h: strip });
  if (rightEdge) rects.push({ x: contentW - strip, y: Math.max(0, cornerY - (sampleLen - strip)), w: strip, h: Math.min(sampleLen, contentH - (cornerY - (sampleLen - strip))) });
  if (bottomEdge) rects.push({ x: Math.max(0, cornerX - (sampleLen - strip)), y: contentH - strip, w: Math.min(sampleLen, contentW - (cornerX - (sampleLen - strip))), h: strip });

  if (!rects.length) return null;

  let black = 0, white = 0, total = 0;
  for (const r of rects) {
    const { data } = ctx.getImageData(r.x, r.y, r.w, r.h);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a <= ALPHA_EMPTY) continue; // ignore transparent
      const R = data[i], G = data[i + 1], B = data[i + 2];
      total++;
      if (R <= NEAR_BLACK && G <= NEAR_BLACK && B <= NEAR_BLACK) black++;
      else if (R >= NEAR_WHITE && G >= NEAR_WHITE && B >= NEAR_WHITE) white++;
    }
  }

  if (total === 0) return null;
  if (black / total >= 0.9) return "black";
  if (white / total >= 0.9) return "white";
  return null;
}

function preferPng(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("scryfall.io") && u.pathname.match(/\.(jpg|jpeg)$/i)) {
      u.pathname = u.pathname.replace(/\.(jpg|jpeg)$/i, ".png");
      return u.toString();
    }
  } catch {
    /* noop */
  }
  return url;
}

function bucketDpiFromHeight(h: number) {
  if (h >= 4440) return 1200;
  if (h >= 2960) return 800;
  if (h >= 2220) return 600;
  return 300;
}
function calibratedBleedTrimPxForHeight(h: number) {
  const dpi = bucketDpiFromHeight(h);
  if (dpi === 300) return 72;
  if (dpi === 600) return 78;
  if (dpi === 800) return 104;
  return 156;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  // If it’s an http(s) URL, fetch to a blob first to avoid tainting
  if (/^https?:\/\//i.test(src)) {
    const resp = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
    const blob = await resp.blob();
    src = URL.createObjectURL(blob);
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

async function trimExistingBleedIfAny(src: string, bleedTrimPx?: number) {
  const img = await loadImage(src);
  const trim = bleedTrimPx ?? calibratedBleedTrimPxForHeight(img.height);

  const w = img.width - trim * 2;
  const h = img.height - trim * 2;
  if (w <= 0 || h <= 0) return img;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, -trim, -trim);
  const out = new Image();
  out.src = c.toDataURL("image/png");
  await new Promise((r) => (out.onload = r));
  return out;
}

function blackenAllNearBlackPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  threshold: number,
  borderThickness = { top: 192, bottom: 800, left: 96, right: 96 },
  targetDpi: number
) {
  const scale = targetDpi / 300;
  const bt = {
    top: Math.round(borderThickness.top * scale),
    bottom: Math.round(borderThickness.bottom * scale),
    left: Math.round(borderThickness.left * scale),
    right: Math.round(borderThickness.right * scale),
  };

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    const inY = y < bt.top || y >= height - bt.bottom;
    for (let x = 0; x < width; x++) {
      const inX = x < bt.left || x >= width - bt.right;
      if (!(inY || inX)) continue;

      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      if (r < threshold && g < threshold && b < threshold) {
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

async function smartTrimMpcBleed(
  img: HTMLImageElement,
  desiredBleedPx: number,
  targetDpi: number
): Promise<HTMLImageElement | null> {
  const { dpi: sourceDpi, hasBleed } = guessBucketDpiFromHeight(img.height);

  if (!hasBleed) {
    return null;
  }

  const dims = pixelDPIMap.get(sourceDpi);
  if (!dims) {
    return null;
  }

  const MPC_BLEED_MM = 3;
  const desiredBleedMm = desiredBleedPx / DPMM(targetDpi);

  if (desiredBleedMm <= MPC_BLEED_MM) {
    const trimAmountMm = MPC_BLEED_MM - desiredBleedMm;
    const trimPx = Math.round(trimAmountMm * DPMM(sourceDpi));

    if (trimPx > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = img.width - trimPx * 2;
      canvas.height = img.height - trimPx * 2;

      if (canvas.width <= 0 || canvas.height <= 0) {
        return null;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.drawImage(img, trimPx, trimPx, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

      const trimmed = new Image();
      trimmed.src = canvas.toDataURL("image/png");
      await new Promise((r) => (trimmed.onload = r));
      return trimmed;
    }

    return img;
  }

  return null;
}

async function buildCardWithBleed(
  src: string,
  bleedPx: number,
  opts: { isUserUpload: boolean; hasBakedBleed?: boolean },
  dpi: number
) {
  const { MM_TO_PX } = createDpiHelpers(dpi);
  const contentW = MM_TO_PX(CARD_W_MM);
  const contentH = MM_TO_PX(CARD_H_MM);
  const finalW = contentW + bleedPx * 2;
  const finalH = contentH + bleedPx * 2;

  let baseImg = await loadImage(src);

  if (opts.hasBakedBleed && bleedPx > 0) {
    const smartTrimmed = await smartTrimMpcBleed(baseImg, bleedPx, dpi);
    if (smartTrimmed) {
      const scaledCanvas = document.createElement("canvas");
      scaledCanvas.width = finalW;
      scaledCanvas.height = finalH;
      const scaledCtx = scaledCanvas.getContext("2d")!;

      const expectedWidth = MM_TO_PX(CARD_W_MM) + bleedPx * 2;
      const expectedHeight = MM_TO_PX(CARD_H_MM) + bleedPx * 2;

      const scaleX = expectedWidth / smartTrimmed.width;
      const scaleY = expectedHeight / smartTrimmed.height;
      const scale = Math.max(scaleX, scaleY);

      const scaledW = Math.round(smartTrimmed.width * scale);
      const scaledH = Math.round(smartTrimmed.height * scale);
      const offsetX = Math.round((scaledW - expectedWidth) / 2);
      const offsetY = Math.round((scaledH - expectedHeight) / 2);

      scaledCtx.imageSmoothingEnabled = true;
      scaledCtx.imageSmoothingQuality = "high";
      scaledCtx.drawImage(smartTrimmed, -offsetX, -offsetY, scaledW, scaledH);

      return scaledCanvas;
    }
  }

  if (opts.isUserUpload && opts.hasBakedBleed) {
    baseImg = await trimExistingBleedIfAny(src);
  }

  const aspect = baseImg.width / baseImg.height;
  const targetAspect = contentW / contentH;
  let drawW = contentW, drawH = contentH, offX = 0, offY = 0;
  if (aspect > targetAspect) {
    drawH = contentH;
    drawW = Math.round(baseImg.width * (contentH / baseImg.height));
    offX = Math.round((drawW - contentW) / 2);
  } else {
    drawW = contentW;
    drawH = Math.round(baseImg.height * (contentW / baseImg.width));
    offY = Math.round((drawH - contentH) / 2);
  }

  // Base canvas at content size
  const base = document.createElement("canvas");
  base.width = contentW;
  base.height = contentH;
  const bctx = base.getContext("2d", { willReadFrequently: true })!;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(baseImg, -offX, -offY, drawW, drawH);

  const dpiFactor = dpi / 300;
  const cornerSize = Math.round(30 * dpiFactor);
  const sampleInset = Math.round(10 * dpiFactor);
  const patchSize = Math.round(20 * dpiFactor);
  const blurPx = Math.max(1, Math.round(1.5 * dpiFactor));
  const blackThreshold = 30;

  function drawFeatheredPatch(
    dst: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    dw: number,
    dh: number
  ) {
    const buf = document.createElement("canvas");
    buf.width = dw;
    buf.height = dh;
    const bctx2 = buf.getContext("2d")!;
    bctx2.imageSmoothingEnabled = true;
    bctx2.imageSmoothingQuality = "high";
    bctx2.drawImage(dst.canvas, sx, sy, dw, dh, 0, 0, dw, dh);

    dst.save();
    dst.imageSmoothingEnabled = true;
    dst.imageSmoothingQuality = "high";
    // soft base
    dst.filter = `blur(${blurPx}px)`;
    dst.globalAlpha = 0.85;
    dst.drawImage(buf, tx, ty, dw, dh);
    // sharp pass
    dst.filter = "none";
    dst.globalAlpha = 0.9;
    dst.drawImage(buf, tx, ty, dw, dh);
    dst.globalAlpha = 1;
    dst.restore();
  }

  const corners = [
    { x: 0, y: 0 },
    { x: contentW - cornerSize, y: 0 },
    { x: 0, y: contentH - cornerSize },
    { x: contentW - cornerSize, y: contentH - cornerSize },
  ];

  for (const { x, y } of corners) {
    if (!cornerNeedsFill(bctx, x, y, cornerSize)) continue;

    const flat = detectFlatBorderColor(
      bctx,
      contentW,
      contentH,
      x,
      y,
      Math.round(40 * dpiFactor),
      Math.round(6 * dpiFactor)
    );

    if (flat) {
      bctx.save();
      bctx.globalCompositeOperation = "destination-over";
      bctx.fillStyle = flat === "black" ? "#000000" : "#FFFFFF";
      bctx.fillRect(x, y, cornerSize, cornerSize);
      bctx.restore();
      continue;
    }

    const seedX = x < contentW / 2 ? sampleInset : contentW - sampleInset - patchSize;
    const seedY = y < contentH / 2 ? sampleInset : contentH - sampleInset - patchSize;

    const { sx, sy } = getPatchNearCorner(
      seedX,
      seedY,
      contentW,
      contentH,
      patchSize,
      bctx
    );

    bctx.save();
    bctx.globalCompositeOperation = "destination-over";

    for (let ty = y; ty < y + cornerSize; ty += patchSize) {
      for (let tx = x; tx < x + cornerSize; tx += patchSize) {
        const dw = Math.min(patchSize, x + cornerSize - tx);
        const dh = Math.min(patchSize, y + cornerSize - ty);

        const jx = sx + Math.floor((Math.random() - 0.5) * (patchSize * 0.25));
        const jy = sy + Math.floor((Math.random() - 0.5) * (patchSize * 0.25));
        const csx = Math.max(0, Math.min(contentW - dw, jx));
        const csy = Math.max(0, Math.min(contentH - dh, jy));

        drawFeatheredPatch(bctx, csx, csy, tx, ty, dw, dh);
      }
    }

    bctx.restore();
  }

  blackenAllNearBlackPixels(bctx, contentW, contentH, blackThreshold, undefined, dpi);

  const out = document.createElement("canvas");
  out.width = finalW;
  out.height = finalH;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(base, bleedPx, bleedPx);

  if (bleedPx > 0) {
    const mostlyBlack = (() => {
      const edge = bctx.getImageData(0, 0, 1, contentH).data;
      let blackCount = 0;
      for (let i = 0; i < contentH; i++) {
        const idx = i * 4;
        const r = edge[idx], g = edge[idx + 1], b = edge[idx + 2];
        if (r < blackThreshold && g < blackThreshold && b < blackThreshold) blackCount++;
      }
      return blackCount / contentH > 0.7;
    })();

    if (mostlyBlack) {
      const slice = Math.min(8, Math.floor(contentW / 100));
      // L R T B
      ctx.drawImage(base, 0, 0, slice, contentH, 0, bleedPx, bleedPx, contentH);
      ctx.drawImage(base, contentW - slice, 0, slice, contentH, contentW + bleedPx, bleedPx, bleedPx, contentH);
      ctx.drawImage(base, 0, 0, contentW, slice, bleedPx, 0, contentW, bleedPx);
      ctx.drawImage(base, 0, contentH - slice, contentW, slice, bleedPx, contentH + bleedPx, contentW, bleedPx);
      // corners
      ctx.drawImage(base, 0, 0, slice, slice, 0, 0, bleedPx, bleedPx);
      ctx.drawImage(base, contentW - slice, 0, slice, slice, contentW + bleedPx, 0, bleedPx, bleedPx);
      ctx.drawImage(base, 0, contentH - slice, slice, slice, 0, contentH + bleedPx, bleedPx, bleedPx);
      ctx.drawImage(base, contentW - slice, contentH - slice, slice, slice, contentW + bleedPx, contentH + bleedPx, bleedPx, bleedPx);
    } else {
      // mirrored edges + corners
      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(base, 0, 0, bleedPx, contentH, -bleedPx, bleedPx, bleedPx, contentH); ctx.restore();

      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(base, contentW - bleedPx, 0, bleedPx, contentH, -(contentW + 2 * bleedPx), bleedPx, bleedPx, contentH); ctx.restore();

      ctx.save(); ctx.scale(1, -1);
      ctx.drawImage(base, 0, 0, contentW, bleedPx, bleedPx, -bleedPx, contentW, bleedPx); ctx.restore();

      ctx.save(); ctx.scale(1, -1);
      ctx.drawImage(base, 0, contentH - bleedPx, contentW, bleedPx, bleedPx, -(contentH + 2 * bleedPx), contentW, bleedPx); ctx.restore();

      ctx.save(); ctx.scale(-1, -1);
      ctx.drawImage(base, 0, 0, bleedPx, bleedPx, -bleedPx, -bleedPx, bleedPx, bleedPx); ctx.restore();

      ctx.save(); ctx.scale(-1, -1);
      ctx.drawImage(base, contentW - bleedPx, 0, bleedPx, bleedPx, -(contentW + 2 * bleedPx), -bleedPx, bleedPx, bleedPx); ctx.restore();

      ctx.save(); ctx.scale(-1, -1);
      ctx.drawImage(base, 0, contentH - bleedPx, bleedPx, bleedPx, -bleedPx, -(contentH + 2 * bleedPx), bleedPx, bleedPx); ctx.restore();

      ctx.save(); ctx.scale(-1, -1);
      ctx.drawImage(base, contentW - bleedPx, contentH - bleedPx, bleedPx, bleedPx, -(contentW + 2 * bleedPx), -(contentH + 2 * bleedPx), bleedPx, bleedPx); ctx.restore();
    }
  }

  return out;
}

function scaleGuideWidthForDPI(
  screenPx: number,
  screenPPI = 96,
  targetDPI: number
) {
  return Math.round((screenPx / screenPPI) * targetDPI);
}

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

const mmToPt = (mm: number) => (mm / MM_PER_INCH) * POINTS_PER_INCH;

function toPdfPoint(pageHeightMm: number, point: { x: number; y: number }) {
  return {
    x: mmToPt(point.x),
    y: mmToPt(pageHeightMm - point.y),
  };
}

function drawRectTopLeft(
  page: PDFPage,
  pageHeightMm: number,
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number,
  color: ReturnType<typeof rgb>
) {
  if (widthMm <= 0 || heightMm <= 0) return;
  const xPt = mmToPt(xMm);
  const yPt = mmToPt(pageHeightMm - yMm - heightMm);
  page.drawRectangle({
    x: xPt,
    y: yPt,
    width: mmToPt(widthMm),
    height: mmToPt(heightMm),
    color,
  });
}

function parseHexColor(value: string) {
  const normalized = value.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized.padEnd(6, "0");
  const parsed = Number.parseInt(expanded.slice(0, 6), 16);
  if (Number.isNaN(parsed)) {
    return rgb(0, 0, 0);
  }
  const r = (parsed >> 16) & 0xff;
  const g = (parsed >> 8) & 0xff;
  const b = parsed & 0xff;
  return rgb(r / 255, g / 255, b / 255);
}

function drawRoundedCornerGuide(
  page: PDFPage,
  pageHeightMm: number,
  center: { x: number; y: number },
  radiusMm: number,
  startAngle: number,
  endAngle: number,
  color: ReturnType<typeof rgb>,
  guideWidthMm: number
) {
  if (guideWidthMm <= 0 || radiusMm <= 0) return;
  const segments = Math.max(8, Math.ceil(radiusMm * 3));
  let prev = {
    x: center.x + radiusMm * Math.cos(startAngle),
    y: center.y + radiusMm * Math.sin(startAngle),
  };

  for (let i = 1; i <= segments; i++) {
    const theta = startAngle + ((endAngle - startAngle) * i) / segments;
    const next = {
      x: center.x + radiusMm * Math.cos(theta),
      y: center.y + radiusMm * Math.sin(theta),
    };
    const startPt = toPdfPoint(pageHeightMm, prev);
    const endPt = toPdfPoint(pageHeightMm, next);
    page.drawLine({
      start: startPt,
      end: endPt,
      thickness: mmToPt(guideWidthMm),
      color,
    });
    prev = next;
  }
}

function drawCornerGuidesPdf(
  page: PDFPage,
  options: {
    xMm: number;
    yMm: number;
    contentWidthMm: number;
    contentHeightMm: number;
    bleedMm: number;
    guideColor: ReturnType<typeof rgb>;
    guideWidthMm: number;
    pageHeightMm: number;
    rounded: boolean;
    cornerOffsetMm: number;
  }
) {
  const {
    xMm,
    yMm,
    contentWidthMm,
    contentHeightMm,
    bleedMm,
    guideColor,
    guideWidthMm,
    pageHeightMm,
    rounded,
    cornerOffsetMm,
  } = options;

  if (guideWidthMm <= 0) return;

  const guideLenMm = 2;
  const gx = xMm + bleedMm;
  const gy = yMm + bleedMm;

  if (!rounded) {
    // Top-left
    drawRectTopLeft(page, pageHeightMm, gx, gy, guideWidthMm, guideLenMm, guideColor);
    drawRectTopLeft(page, pageHeightMm, gx, gy, guideLenMm, guideWidthMm, guideColor);
    // Top-right
    drawRectTopLeft(page, pageHeightMm, gx + contentWidthMm, gy, guideWidthMm, guideLenMm, guideColor);
    drawRectTopLeft(
      page,
      pageHeightMm,
      gx + contentWidthMm - guideLenMm + guideWidthMm,
      gy,
      guideLenMm,
      guideWidthMm,
      guideColor
    );
    // Bottom-left
    drawRectTopLeft(
      page,
      pageHeightMm,
      gx,
      gy + contentHeightMm - guideLenMm + guideWidthMm,
      guideWidthMm,
      guideLenMm,
      guideColor
    );
    drawRectTopLeft(page, pageHeightMm, gx, gy + contentHeightMm, guideLenMm, guideWidthMm, guideColor);
    // Bottom-right
    drawRectTopLeft(
      page,
      pageHeightMm,
      gx + contentWidthMm,
      gy + contentHeightMm - guideLenMm + guideWidthMm,
      guideWidthMm,
      guideLenMm,
      guideColor
    );
    drawRectTopLeft(
      page,
      pageHeightMm,
      gx + contentWidthMm - guideLenMm + guideWidthMm,
      gy + contentHeightMm,
      guideLenMm,
      guideWidthMm,
      guideColor
    );
    return;
  }

  const cornerRadiusMm = 2.5;
  const diagonalOffsetMm = cornerOffsetMm * Math.SQRT2;

  const corners = [
    {
      center: {
        x: gx + cornerRadiusMm + diagonalOffsetMm,
        y: gy + cornerRadiusMm + diagonalOffsetMm,
      },
      start: Math.PI,
      end: Math.PI * 1.5,
    },
    {
      center: {
        x: gx + contentWidthMm - cornerRadiusMm - diagonalOffsetMm,
        y: gy + cornerRadiusMm + diagonalOffsetMm,
      },
      start: Math.PI * 1.5,
      end: Math.PI * 2,
    },
    {
      center: {
        x: gx + cornerRadiusMm + diagonalOffsetMm,
        y: gy + contentHeightMm - cornerRadiusMm - diagonalOffsetMm,
      },
      start: Math.PI * 0.5,
      end: Math.PI,
    },
    {
      center: {
        x: gx + contentWidthMm - cornerRadiusMm - diagonalOffsetMm,
        y: gy + contentHeightMm - cornerRadiusMm - diagonalOffsetMm,
      },
      start: 0,
      end: Math.PI * 0.5,
    },
  ];

  for (const { center, start, end } of corners) {
    drawRoundedCornerGuide(page, pageHeightMm, center, cornerRadiusMm, start, end, guideColor, guideWidthMm);
  }
}

function drawEdgeStubsPdf(
  page: PDFPage,
  options: {
    pageWidthMm: number;
    pageHeightMm: number;
    startXmm: number;
    startYmm: number;
    columns: number;
    rows: number;
    contentWidthMm: number;
    contentHeightMm: number;
    cardWidthMm: number;
    cardHeightMm: number;
    bleedMm: number;
    guideWidthMm: number;
    spacingMm: number;
  }
) {
  const {
    pageWidthMm,
    pageHeightMm,
    startXmm,
    startYmm,
    columns,
    rows,
    contentWidthMm,
    contentHeightMm,
    cardWidthMm,
    cardHeightMm,
    bleedMm,
    guideWidthMm,
    spacingMm,
  } = options;

  if (guideWidthMm <= 0) return;

  const xCuts: number[] = [];
  for (let col = 0; col < columns; col++) {
    const cellLeft = startXmm + col * (cardWidthMm + spacingMm);
    xCuts.push(cellLeft + bleedMm);
    xCuts.push(cellLeft + bleedMm + contentWidthMm);
  }

  const yCuts: number[] = [];
  for (let row = 0; row < rows; row++) {
    const cellTop = startYmm + row * (cardHeightMm + spacingMm);
    yCuts.push(cellTop + bleedMm);
    yCuts.push(cellTop + bleedMm + contentHeightMm);
  }

  const topStubMm = startYmm + bleedMm;
  const bottomStubMm = startYmm + bleedMm;
  const leftStubMm = startXmm + bleedMm;
  const rightStubMm = startXmm + bleedMm;
  const stubColor = rgb(0, 0, 0);

  for (const xCut of xCuts) {
    drawRectTopLeft(page, pageHeightMm, xCut, 0, guideWidthMm, topStubMm, stubColor);
    drawRectTopLeft(page, pageHeightMm, xCut, pageHeightMm - bottomStubMm, guideWidthMm, bottomStubMm, stubColor);
  }

  for (const yCut of yCuts) {
    drawRectTopLeft(page, pageHeightMm, 0, yCut, leftStubMm, guideWidthMm, stubColor);
    drawRectTopLeft(
      page,
      pageHeightMm,
      pageWidthMm - rightStubMm,
      yCut,
      rightStubMm,
      guideWidthMm,
      stubColor
    );
  }
}

function chunkPages<T>(items: readonly T[], size: number): T[][] {
  const chunkSize = Math.max(1, size | 0);
  if (items.length <= chunkSize) return [Array.from(items)];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
}

export async function exportProxyPagesToPdf({
  cards,
  originalSelectedImages,
  cachedImageUrls,
  uploadedFiles,
  useCornerGuides,
  bleedEdgeWidthMm,
  guideColor,
  guideWidthPx,
  pageSizeUnit,
  pageOrientation: _pageOrientation,
  pageSizePreset: _pageSizePreset,
  pageWidth,
  pageHeight,
  columns,
  rows,
  cardSpacingMm,
  exportDpi = 600,
  roundedCornerGuides = false,
  cornerGuideOffsetMm = 0,
  useBatching = false,
  pagesPerBatch = 20,
  onProgress,
  abortSignal,
}: {
  cards: CardOption[];
  originalSelectedImages: Record<string, string>;
  cachedImageUrls?: Record<string, string>;
  uploadedFiles?: Record<string, File>;
  useCornerGuides: boolean;
  bleedEdgeWidthMm: number;
  guideColor: string;
  guideWidthPx: number;
  pageOrientation: "portrait" | "landscape";
  pageSizePreset: LayoutPreset;
  pageSizeUnit: "mm" | "in";
  pageWidth: number;
  pageHeight: number;
  columns: number;
  rows: number;
  cardSpacingMm: number;
  exportDpi?: number;
  roundedCornerGuides?: boolean;
  cornerGuideOffsetMm?: number;
  useBatching?: boolean;
  pagesPerBatch?: number;
  onProgress?: (progress: LoadingProgressState) => void;
  abortSignal?: AbortSignal;
}) {
  if (!cards.length) return;

  const throwIfAborted = () => {
    if (abortSignal?.aborted) {
      throw new DOMException("Export cancelled", "AbortError");
    }
  };

  throwIfAborted();

  const bleedMm = useCornerGuides ? bleedEdgeWidthMm : 0;
  const contentWidthMm = CARD_W_MM;
  const contentHeightMm = CARD_H_MM;
  const cardWidthMm = contentWidthMm + bleedMm * 2;
  const cardHeightMm = contentHeightMm + bleedMm * 2;
  const spacingMm = cardSpacingMm || 0;

  const pageWidthMm = pageSizeUnit === "in" ? pageWidth * MM_PER_INCH : pageWidth;
  const pageHeightMm = pageSizeUnit === "in" ? pageHeight * MM_PER_INCH : pageHeight;

  const perPage = Math.max(1, columns * rows);
  const gridWidthMm = columns * cardWidthMm + Math.max(0, columns - 1) * spacingMm;
  const gridHeightMm = rows * cardHeightMm + Math.max(0, rows - 1) * spacingMm;
  const startXmm = Math.max(0, (pageWidthMm - gridWidthMm) / 2);
  const startYmm = Math.max(0, (pageHeightMm - gridHeightMm) / 2);

  const pages: CardOption[][] = [];
  for (let i = 0; i < cards.length; i += perPage) {
    pages.push(cards.slice(i, i + perPage));
  }

  const guideWidthPxScaled = scaleGuideWidthForDPI(guideWidthPx, 96, exportDpi);
  const guideWidthMm = guideWidthPxScaled > 0 ? guideWidthPxScaled / DPMM(exportDpi) : 0;
  const guideColorRgb = parseHexColor(guideColor);

  const jpegQuality = exportDpi >= 1200 ? 0.96 : exportDpi >= 900 ? 0.97 : 1.0;
  const pageSize: [number, number] = [mmToPt(pageWidthMm), mmToPt(pageHeightMm)];
  const effectivePagesPerBatch = useBatching ? Math.max(1, pagesPerBatch | 0) : pages.length || 1;
  const batches = useBatching ? chunkPages(pages, effectivePagesPerBatch) : [pages];
  const totalBatches = batches.length;
  const dateSlug = new Date().toISOString().slice(0, 10);

  const totalPagesCount = pages.length;
  const totalCardsCount = cards.length;
  let processedCards = 0;
  let currentPageIndex = 0;
  let processedCardsOnPage = 0;
  let currentPageCardCount = pages[0]?.length ?? 0;

  const emitProgress = () => {
    throwIfAborted();

    const overallPercent = totalCardsCount
      ? Math.round((processedCards / totalCardsCount) * 100)
      : null;
    const normalizedOverall = overallPercent === null
      ? null
      : processedCards >= totalCardsCount
        ? 100
        : Math.min(99, Math.max(0, overallPercent));

    const pagePercent = currentPageCardCount
      ? Math.round((processedCardsOnPage / currentPageCardCount) * 100)
      : totalPagesCount > 0
        ? 100
        : null;
    const normalizedPage = pagePercent == null
      ? null
      : Math.max(0, Math.min(100, pagePercent));

    onProgress?.({
      overall: normalizedOverall,
      pageProgress: normalizedPage,
      currentPage: totalPagesCount > 0 ? Math.min(totalPagesCount, currentPageIndex + 1) : null,
      totalPages: totalPagesCount > 0 ? totalPagesCount : null,
    });
  };

  emitProgress();

  const renderBatch = async (batchPages: CardOption[][]) => {
    throwIfAborted();
    const pdfDoc = await PDFDocument.create();

    for (const pageCards of batchPages) {
      throwIfAborted();
      currentPageCardCount = pageCards.length;
      processedCardsOnPage = 0;
      emitProgress();

      const page = pdfDoc.addPage(pageSize);
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageSize[0],
        height: pageSize[1],
        color: rgb(1, 1, 1),
      });

      for (let idx = 0; idx < pageCards.length; idx++) {
        throwIfAborted();
        const card = pageCards[idx];
        const col = idx % columns;
        const row = Math.floor(idx / columns);

        const cardXmm = startXmm + col * (cardWidthMm + spacingMm);
        const cardYmm = startYmm + row * (cardHeightMm + spacingMm);

        let src =
          (cachedImageUrls && cachedImageUrls[card.uuid]) ||
          originalSelectedImages[card.uuid] ||
          card.imageUrls?.[0] ||
          "";

        let uploadedUrlToRevoke: string | null = null;

        if (isUploadedFileToken(src)) {
          const file = uploadedFiles?.[card.uuid];
          if (!file) {
            console.warn(`Skipping card ${card.name} — missing uploaded file data.`);
            processedCards += 1;
            processedCardsOnPage += 1;
            emitProgress();
            continue;
          }
          const objectUrl = URL.createObjectURL(file);
          uploadedUrlToRevoke = objectUrl;
          src = objectUrl;
        }

        if (!card.isUserUpload && !(cachedImageUrls && cachedImageUrls[card.uuid])) {
          src = getLocalBleedImageUrl(preferPng(src));
        }

        try {
          throwIfAborted();
          const cardCanvas = await buildCardWithBleed(
            src,
            useCornerGuides ? Math.round(bleedMm * DPMM(exportDpi)) : 0,
            {
              isUserUpload: !!card.isUserUpload,
              hasBakedBleed: !!card.hasBakedBleed,
            },
            exportDpi
          );

          const blob = await canvasToBlob(cardCanvas, "image/jpeg", jpegQuality);
          const cardBytes = await blob.arrayBuffer();
          const cardImage = await pdfDoc.embedJpg(cardBytes);

          page.drawImage(cardImage, {
            x: mmToPt(cardXmm),
            y: mmToPt(pageHeightMm - cardYmm - cardHeightMm),
            width: mmToPt(cardWidthMm),
            height: mmToPt(cardHeightMm),
          });
        } finally {
          if (uploadedUrlToRevoke) {
            URL.revokeObjectURL(uploadedUrlToRevoke);
          }
        }

        if (useCornerGuides && guideWidthMm > 0) {
          drawCornerGuidesPdf(page, {
            xMm: cardXmm,
            yMm: cardYmm,
            contentWidthMm,
            contentHeightMm,
            bleedMm,
            guideColor: guideColorRgb,
            guideWidthMm,
            pageHeightMm,
            rounded: roundedCornerGuides,
            cornerOffsetMm: cornerGuideOffsetMm,
          });
        }

        processedCards += 1;
        processedCardsOnPage += 1;
        emitProgress();
      }

      if (useCornerGuides && guideWidthMm > 0) {
        drawEdgeStubsPdf(page, {
          pageWidthMm,
          pageHeightMm,
          startXmm,
          startYmm,
          columns,
          rows,
          contentWidthMm,
          contentHeightMm,
          cardWidthMm,
          cardHeightMm,
          bleedMm,
          guideWidthMm,
          spacingMm,
        });
      }

      currentPageIndex += 1;
    }

    return pdfDoc.save({ useObjectStreams: true });
  };

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchPages = batches[batchIndex];
    const pdfBytes = await renderBatch(batchPages);
    throwIfAborted();
    const fileSuffix =
      totalBatches > 1
        ? `_part-${String(batchIndex + 1).padStart(2, "0")}-of-${String(totalBatches).padStart(2, "0")}`
        : "";
    const bytesCopy = pdfBytes.slice();
    const blob = new Blob([bytesCopy.buffer], { type: "application/pdf" });
    saveAs(blob, `proxxies_${dateSlug}${fileSuffix}.pdf`);
  }

  onProgress?.({
    overall: 100,
    pageProgress: 100,
    currentPage: totalPagesCount > 0 ? totalPagesCount : null,
    totalPages: totalPagesCount > 0 ? totalPagesCount : null,
  });
}
