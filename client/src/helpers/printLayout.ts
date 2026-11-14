import { CARD_H_MM, CARD_W_MM, IN_TO_MM } from "../constants";

export type LayoutInput = {
  pageWidth: number;
  pageHeight: number;
  pageSizeUnit: "mm" | "in";
  columns: number;
  rows: number;
  bleedEdgeWidth: number;
  cardSpacingMm: number;
};
export const finiteClamp = (
  value: number,
  min: number,
  max: number,
  fallback = min
) => (Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback);

export function printLayout(s: LayoutInput) {
  const pageWidthMm = s.pageWidth * (s.pageSizeUnit === "in" ? IN_TO_MM : 1);
  const pageHeightMm = s.pageHeight * (s.pageSizeUnit === "in" ? IN_TO_MM : 1);
  const cardWidthMm = CARD_W_MM + s.bleedEdgeWidth * 2;
  const cardHeightMm = CARD_H_MM + s.bleedEdgeWidth * 2;
  const gridWidthMm =
    cardWidthMm * s.columns + Math.max(0, s.columns - 1) * s.cardSpacingMm;
  const gridHeightMm =
    cardHeightMm * s.rows + Math.max(0, s.rows - 1) * s.cardSpacingMm;
  const maxColumns = Math.max(
    1,
    Math.floor(
      (pageWidthMm + s.cardSpacingMm) / (cardWidthMm + s.cardSpacingMm)
    )
  );
  const maxRows = Math.max(
    1,
    Math.floor(
      (pageHeightMm + s.cardSpacingMm) / (cardHeightMm + s.cardSpacingMm)
    )
  );
  const maxSpacing = Math.max(
    0,
    Math.min(
      s.columns > 1
        ? (pageWidthMm - s.columns * cardWidthMm) / (s.columns - 1)
        : Infinity,
      s.rows > 1
        ? (pageHeightMm - s.rows * cardHeightMm) / (s.rows - 1)
        : Infinity,
      50
    )
  );
  const fits =
    gridWidthMm <= pageWidthMm + 0.001 && gridHeightMm <= pageHeightMm + 0.001;
  return {
    pageWidthMm,
    pageHeightMm,
    cardWidthMm,
    cardHeightMm,
    gridWidthMm,
    gridHeightMm,
    maxColumns,
    maxRows,
    maxSpacing,
    fits,
  };
}

export function fitLayout<T extends LayoutInput>(s: T): T {
  const zeroSpacing = printLayout({ ...s, cardSpacingMm: 0 });
  const next = {
    ...s,
    columns: Math.floor(finiteClamp(s.columns, 1, zeroSpacing.maxColumns, 3)),
    rows: Math.floor(finiteClamp(s.rows, 1, zeroSpacing.maxRows, 3)),
  };
  return {
    ...next,
    cardSpacingMm: finiteClamp(
      s.cardSpacingMm,
      0,
      printLayout(next).maxSpacing
    ),
  };
}

// Keep empty positions when mirroring an incomplete row for long-edge duplex.
export function pageSlots<T>(
  cards: readonly T[],
  columns: number,
  rows: number,
  back = false
): (T | null)[] {
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    columns * rows > 400
  )
    throw new Error("Invalid print grid.");
  const slots: (T | null)[] = Array(columns * rows).fill(null);
  cards.slice(0, slots.length).forEach((card, i) => {
    const slot = back
      ? Math.floor(i / columns) * columns + columns - 1 - (i % columns)
      : i;
    slots[slot] = card;
  });
  return slots;
}
