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

export function guessBucketDpiFromHeight(h: number): {
  dpi: number;
  hasBleed: boolean;
} {
  for (const [dpi, dims] of pixelDPIMap) {
    if (Math.abs(h - dims.heightWithBakedBleed) <= 2)
      return { dpi, hasBleed: true };
    if (Math.abs(h - dims.height) <= 2) return { dpi, hasBleed: false };
  }
  return { dpi: 300, hasBleed: false };
}

export const createDpiHelpers = (dpi: number) => ({
  IN_TO_PX: (inches: number) => Math.round(inches * dpi),
  MM_TO_PX: (mm: number) => Math.round(mm * DPMM(dpi)),
});

export function getBleedInPixels(bleedEdgeWidth: number, unit: string): number {
  return Math.round(bleedEdgeWidth * (unit === "in" ? DPI : DPMM(DPI)));
}
