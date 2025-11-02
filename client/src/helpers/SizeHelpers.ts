import { CARD_H_MM, CARD_W_MM, IN_TO_MM } from "@/constants";
import { useSettingsStore } from "@/store";

export function CardDimensionsInMm() {
  const useCornerGuides = useSettingsStore((state) => state.useCornerGuides);
  const bleedEdgeWidth = useSettingsStore((state) => state.bleedEdgeWidth);
  
  const cardWidthMm = CARD_W_MM + (useCornerGuides ? 2 * bleedEdgeWidth : 0);
  const cardHeightMm = CARD_H_MM + (useCornerGuides ? 2 * bleedEdgeWidth : 0);
  return { cardWidthMm, cardHeightMm };
}

export function PageDimensionsInMm() {
  const pageWidth = useSettingsStore((state) => state.pageWidth);
  const pageHeight = useSettingsStore((state) => state.pageHeight);
  const pageUnit = useSettingsStore((s) => s.pageSizeUnit);

  const pageWidthMm =
    pageUnit === "mm" ? pageWidth : IN_TO_MM * pageWidth;
  const pageHeightMm =
    pageUnit === "mm" ? pageHeight : IN_TO_MM * pageHeight;

  return { pageWidthMm, pageHeightMm };
}

export function InToMm(inches: number) {
  return inches * IN_TO_MM;
}

export function MmToIn(mm: number) {
  return mm / IN_TO_MM;
}