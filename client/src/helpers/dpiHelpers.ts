import { CARD_H_MM, CARD_W_MM, DPI_MM_RECIP, pixelDPIMap } from "../constants";

const DPI = 300;

export const DPMM = (dpi: number) => dpi * DPI_MM_RECIP;

export const PREVIEW_CARD_DPI = 200;

export function computeCardPreviewPixels(
  bleedEdgeWidthMm: number,
  dpi: number = PREVIEW_CARD_DPI
) {
  const pxPerMm = DPMM(dpi);
  const widthMm = CARD_W_MM + bleedEdgeWidthMm * 2;
  const heightMm = CARD_H_MM + bleedEdgeWidthMm * 2;
  return {
    width: Math.max(1, Math.round(widthMm * pxPerMm)),
    height: Math.max(1, Math.round(heightMm * pxPerMm)),
  };
}

export function guessBucketDpiFromHeight(h: number) {
  for (const [px, dpi] of Object.entries(pixelDPIMap)) {
    if (h >= Number(px) - 30 && h <= Number(px) + 30) {
      return dpi;
    }
  }
  return 300;
}

export const createDpiHelpers = (dpi: number) => ({
  IN_TO_PX: (inches: number) => Math.round(inches * dpi),
  MM_TO_PX: (mm: number) => Math.round(mm * DPMM(dpi)),
});

export function getBleedInPixels(bleedEdgeWidth: number, unit: string): number {
  return Math.round(bleedEdgeWidth * (unit === "in" ? DPI : DPMM(DPI)));
}
