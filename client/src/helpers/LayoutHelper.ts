import { CARD_DIMENSIONS } from "@/constants";

export function calculateMaxBleed(
  pageWidth: number,
  pageHeight: number,
  pageSizeUnit: "mm" | "in",
  columns: number,
  rows: number
): number {
  const pageWidthMm = pageSizeUnit === "in" ? pageWidth * 25.4 : pageWidth;
  const pageHeightMm = pageSizeUnit === "in" ? pageHeight * 25.4 : pageHeight;
  
  const bx = (( (pageWidthMm - 2) / columns) - CARD_DIMENSIONS.width ) / 2;
  const by = (( (pageHeightMm - 2) / rows) - CARD_DIMENSIONS.height ) / 2;
  
  return Math.max(0, Math.round(Math.min(bx, by)));
}