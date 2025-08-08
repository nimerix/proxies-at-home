// /utils/print.ts
import jsPDF from "jspdf";
import type { CardOption } from "../pages/ProxyBuilderPage";

/** 300 DPI conversions */
const DPI = 1200;
const IN = (inches: number) => Math.round(inches * DPI);
const MM_TO_IN = (mm: number) => mm / 25.4;
const MM_TO_PX = (mm: number) => IN(MM_TO_IN(mm));

/** Match your component helper */
function getLocalBleedImageUrl(originalUrl: string): string {
  return `http://localhost:3001/api/cards/images/proxy?url=${encodeURIComponent(originalUrl)}`;
}

/** Prefer PNG assets when given a Scryfall JPG */
function preferPng(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("scryfall.io") && u.pathname.match(/\.(jpg|jpeg)$/i)) {
      u.pathname = u.pathname.replace(/\.(jpg|jpeg)$/i, ".png");
      return u.toString();
    }
  } catch { }
  return url;
}

/** Load an image */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Decide black edge (same heuristic you used) */
function isLeftEdgeMostlyBlack(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, 1, h).data;
  let black = 0;
  const threshold = 20;
  for (let y = 0; y < h; y++) {
    const i = y * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r < threshold && g < threshold && b < threshold) black++;
  }
  return black / h > 0.7;
}

/** Only uploads get trimmed (parity with your preview) */
async function trimExistingBleedIfAny(src: string, bleedTrimPx = 72): Promise<HTMLImageElement> {
  const img = await loadImage(src);
  const w = img.width - bleedTrimPx * 2;
  const h = img.height - bleedTrimPx * 2;
  if (w <= 0 || h <= 0) return img;

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, -bleedTrimPx, -bleedTrimPx);
  const out = new Image();
  out.src = c.toDataURL("image/png");
  await new Promise(r => (out.onload = r));
  return out;
}

function blackenAllNearBlackPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  threshold: number,
  borderThickness = {
    top: 384,
    bottom: 1600,
    left: 192,
    right: 192,
  }
) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder =
        y < borderThickness.top ||
        y >= height - borderThickness.bottom ||
        x < borderThickness.left ||
        x >= width - borderThickness.right;

      if (!isBorder) continue;

      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (r < threshold && g < threshold && b < threshold) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}


/**
 * Build one card @300DPI to match preview math exactly:
 * - content = 63.5mm × 88.9mm
 * - bleed = bleedEdgeWidthMm on all sides
 * - uploads get trimmed first (like preview), fetched art does not
 */
async function buildCardWithBleed(src: string, bleedPx: number, isUserUpload: boolean): Promise<HTMLCanvasElement> {
  const contentW = MM_TO_PX(63.5); // 2.5in @ 300 DPI = 750
  const contentH = MM_TO_PX(88.9); // 3.5in @ 300 DPI = 1050
  const finalW = contentW + bleedPx * 2;
  const finalH = contentH + bleedPx * 2;

  // Load source (uploads get trimmed, fetched art does not)
  const baseImg = isUserUpload ? await trimExistingBleedIfAny(src) : await loadImage(src);

  // Cover-fit into content area
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
  base.width = contentW; base.height = contentH;
  const bctx = base.getContext("2d")!;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(baseImg, -offX, -offY, drawW, drawH);

  // === Corner fill logic (preview parity) ===
  const cornerSize = 120;     // same as preview
  const sampleInset = 40;    // same as preview
  const blackThreshold = 30; // (used later for edge test)
  // Top edge
  const fillIfLight = (r: number, g: number, b: number, a: number) =>
    a === 0 || (r > 200 && g > 200 && b > 200);

  const averageColor = (sx: number, sy: number, w: number, h: number): string => {
    const clampedX = Math.max(0, Math.min(contentW - w, sx));
    const clampedY = Math.max(0, Math.min(contentH - h, sy));
    const data = bctx.getImageData(clampedX, clampedY, w, h).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
    if (count === 0) return "rgb(0,0,0)";
    r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const corners = [
    { x: 0, y: 0 },                                              // TL
    { x: contentW - cornerSize, y: 0 },                          // TR
    { x: 0, y: contentH - cornerSize },                          // BL
    { x: contentW - cornerSize, y: contentH - cornerSize },      // BR
  ];

  corners.forEach(({ x, y }) => {
    const data = bctx.getImageData(x, y, cornerSize, cornerSize).data;
    let shouldFill = false;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (fillIfLight(r, g, b, a)) { shouldFill = true; break; }
    }
    if (shouldFill) {
      const sx = x < contentW / 2 ? sampleInset : contentW - sampleInset - 10;
      const sy = y < contentH / 2 ? sampleInset : contentH - sampleInset - 10;
      bctx.fillStyle = averageColor(sx, sy, 10, 10);
      bctx.fillRect(x, y, cornerSize, cornerSize);
    }
  });
  blackenAllNearBlackPixels(bctx, contentW, contentH, blackThreshold);
  // === Compose final with bleed ===
  const out = document.createElement("canvas");
  out.width = finalW; out.height = finalH;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(base, bleedPx, bleedPx);

  if (bleedPx > 0) {
    // Re-evaluate edge AFTER corner fills (matches your preview order)
    const mostlyBlack = (() => {
      const edge = bctx.getImageData(0, 0, 1, contentH).data;
      let blackCount = 0;
      for (let i = 0; i < contentH; i++) {
        const idx = i * 4;
        const r = edge[idx], g = edge[idx + 1], b = edge[idx + 2];
        if (r < blackThreshold && g < blackThreshold && b < blackThreshold) blackCount++;
      }
      return blackCount / contentH > 0.7; // blackToleranceRatio
    })();

    if (mostlyBlack) {
      const slice = Math.min(8, Math.floor(contentW / 100));
      // sides
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
      // mirrored bleed
      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(base, 0, 0, bleedPx, contentH, -bleedPx, bleedPx, bleedPx, contentH); ctx.restore();
      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(base, contentW - bleedPx, 0, bleedPx, contentH, -(contentW + 2 * bleedPx), bleedPx, bleedPx, contentH); ctx.restore();
      ctx.save(); ctx.scale(1, -1);
      ctx.drawImage(base, 0, 0, contentW, bleedPx, bleedPx, -bleedPx, contentW, bleedPx); ctx.restore();
      ctx.save(); ctx.scale(1, -1);
      ctx.drawImage(base, 0, contentH - bleedPx, contentW, bleedPx, bleedPx, -(contentH + 2 * bleedPx), contentW, bleedPx); ctx.restore();
      // corners
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

function scaleGuideWidthForDPI(screenPx: number, screenPPI = 96, targetDPI = 1200): number {
  return Math.round((screenPx / screenPPI) * targetDPI);
}

/** Draw the same 4mm corner L-guides you render in preview */
function drawCornerGuides(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, contentW: number, contentH: number,
  bleedPx: number, guideColor: string, guideWidthPx: number
) {
  const guideLenPx = MM_TO_PX(4); // 4mm like preview
  const gx = x + bleedPx;         // inset by bleed (guideOffset in preview)
  const gy = y + bleedPx;

  ctx.save();
  ctx.fillStyle = guideColor;

  // TL
  ctx.fillRect(gx, gy, guideWidthPx, guideLenPx);
  ctx.fillRect(gx, gy, guideLenPx, guideWidthPx);
  // TR
  ctx.fillRect(gx + contentW, gy, guideWidthPx, guideLenPx);
  ctx.fillRect(gx + contentW - guideLenPx + guideWidthPx, gy, guideLenPx, guideWidthPx);
  // BL
  ctx.fillRect(gx, gy + contentH - guideLenPx + guideWidthPx, guideWidthPx, guideLenPx);
  ctx.fillRect(gx, gy + contentH, guideLenPx, guideWidthPx);
  // BR
  ctx.fillRect(gx + contentW, gy + contentH - guideLenPx + guideWidthPx, guideWidthPx, guideLenPx);
  ctx.fillRect(gx + contentW - guideLenPx + guideWidthPx, gy + contentH, guideLenPx, guideWidthPx);

  ctx.restore();
}

/**
 * POST EXPORT — matches preview layout exactly
 */
export async function exportProxyPagesToPdf(opts: {
  cards: CardOption[];
  originalSelectedImages: Record<number, string>;
  bleedEdge: boolean;          // previews toggle says "Enable Guide" but we also use it for bleed here
  bleedEdgeWidthMm: number;    // mm
  guideColor: string;          // hex
  guideWidthPx: number;        // px
  pageWidthInches: number;     // 8.5
  pageHeightInches: number;    // 11
  pdfPageColor?: string;       // default white
}) {
  const {
    cards,
    originalSelectedImages,
    bleedEdge,
    bleedEdgeWidthMm,
    guideColor,
    guideWidthPx,
    pageWidthInches,
    pageHeightInches,
    pdfPageColor = "#FFFFFF",
  } = opts;

  // Page @300dpi
  const pageW = IN(pageWidthInches);
  const pageH = IN(pageHeightInches);

  // Card/content sizes in px @300dpi (from mm)
  const contentW = MM_TO_PX(63.5);
  const contentH = MM_TO_PX(88.9);
  const bleedPx = bleedEdge ? MM_TO_PX(bleedEdgeWidthMm) : 0;
  const cardW = contentW + 2 * bleedPx;
  const cardH = contentH + 2 * bleedPx;

  // 3x3 centered grid (preview parity)
  const cols = 3, rows = 3, perPage = cols * rows;
  const gridW = cols * cardW, gridH = rows * cardH;
  const startX = Math.round((pageW - gridW) / 2);
  const startY = Math.round((pageH - gridH) / 2);

  // Chunk cards by 9
  const pages: CardOption[][] = [];
  for (let i = 0; i < cards.length; i += perPage) pages.push(cards.slice(i, i + perPage));

  const pdf = new jsPDF({
    orientation: pageW >= pageH ? "landscape" : "portrait",
    unit: "mm",
    format: [pageWidthInches * 25.4, pageHeightInches * 25.4],
    compress: true,
  });

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageCards = pages[pageIndex];

    // Offscreen page canvas @300dpi
    const canvas = document.createElement("canvas");
    canvas.width = pageW; canvas.height = pageH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = pdfPageColor;
    ctx.fillRect(0, 0, pageW, pageH);

    for (let idx = 0; idx < pageCards.length; idx++) {
      const globalIndex = pageIndex * perPage + idx;
      const card = pageCards[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = startX + col * cardW;
      const y = startY + row * cardH;

      // Resolve full‑res source:
      let src = originalSelectedImages[globalIndex] ?? card.imageUrls?.[0] ?? "";
      if (!src) continue;

      if (!card.isUserUpload) {
        // Fetched art — use your local proxy/cached PNG (no trim)
        src = getLocalBleedImageUrl(preferPng(src));
      }
      // Uploads keep base64 original; will be trimmed inside build

      const cardCanvas = await buildCardWithBleed(src, bleedPx, !!card.isUserUpload);
      ctx.drawImage(cardCanvas, x, y);

      // Corner guides exactly like preview (only if enabled)
      if (bleedEdge) {
        const scaledGuideWidth = scaleGuideWidthForDPI(guideWidthPx, 96, DPI);
        drawCornerGuides(ctx, x, y, contentW, contentH, bleedPx, guideColor, scaledGuideWidth);
      }
    }

    // Add to PDF at native page size (keeps 300dpi)
    const pageImg = canvas.toDataURL("image/jpeg", 0.95);
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(pageImg, "JPEG", 0, 0, pageWidthInches * 25.4, pageHeightInches * 25.4);
  }

  pdf.save(`proxies_${new Date().toISOString().slice(0, 10)}.pdf`);
}
