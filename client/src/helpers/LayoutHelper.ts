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

export function validateGridFitsPage(
  pageWidth: number,
  pageHeight: number,
  pageSizeUnit: "mm" | "in",
  columns: number,
  rows: number
): boolean {
  const pageWidthMm = pageSizeUnit === "in" ? pageWidth * 25.4 : pageWidth;
  const pageHeightMm = pageSizeUnit === "in" ? pageHeight * 25.4 : pageHeight;
  
  const totalGridWidthMm = columns * CARD_DIMENSIONS.width;
  const totalGridHeightMm = rows * CARD_DIMENSIONS.height;
  
  return totalGridWidthMm + 2 <= pageWidthMm && totalGridHeightMm + 2 <= pageHeightMm;
}

export function calculateMaxGridSize(
  pageWidth: number,
  pageHeight: number,
  pageSizeUnit: "mm" | "in"
): { maxColumns: number; maxRows: number } {
  const pageWidthMm = pageSizeUnit === "in" ? pageWidth * 25.4 : pageWidth;
  const pageHeightMm = pageSizeUnit === "in" ? pageHeight * 25.4 : pageHeight;
  
  const maxColumns = Math.floor((pageWidthMm - 1) / CARD_DIMENSIONS.width);
  const maxRows = Math.floor((pageHeightMm - 1) / CARD_DIMENSIONS.height);

  return {
    maxColumns: Math.max(1, maxColumns),
    maxRows: Math.max(1, maxRows) 
  };
}