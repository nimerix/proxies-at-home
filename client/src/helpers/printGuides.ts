import { CARD_W_MM, CARD_H_MM } from "../constants";
import { printLayout, type LayoutInput } from "./printLayout";

export type GuideLine = { x1: number; y1: number; x2: number; y2: number };
const line = (x1: number, y1: number, x2: number, y2: number): GuideLine => ({
  x1,
  y1,
  x2,
  y2,
});

// All paths use physical mm, with the stroke centered on the trim line.
// The exact same geometry is rendered by the SVG preview and PDF export.
export function cornerGuideLines(
  bleed: number,
  rounded: boolean,
  offset = 0
): GuideLine[] {
  const lines: GuideLine[] = [];
  const radius = 2.5;
  for (const [right, bottom] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const x = bleed + (right ? CARD_W_MM : 0),
      y = bleed + (bottom ? CARD_H_MM : 0);
    const dx = right ? -1 : 1,
      dy = bottom ? -1 : 1;
    if (!rounded) {
      lines.push(line(x, y, x + dx * 2, y), line(x, y, x, y + dy * 2));
    } else {
      const cx = x + dx * (radius + offset),
        cy = y + dy * (radius + offset);
      const point = (t: number) => ({
        x: cx - dx * radius * Math.cos(t),
        y: cy - dy * radius * Math.sin(t),
      });
      for (let i = 0; i < 12; i++) {
        const a = point((i * Math.PI) / 24),
          b = point(((i + 1) * Math.PI) / 24);
        lines.push(line(a.x, a.y, b.x, b.y));
      }
    }
  }
  return lines;
}

export function edgeGuideLines(settings: LayoutInput): GuideLine[] {
  const layout = printLayout(settings);
  const x = (layout.pageWidthMm - layout.gridWidthMm) / 2;
  const y = (layout.pageHeightMm - layout.gridHeightMm) / 2;
  const xCuts = new Set<number>(),
    yCuts = new Set<number>();
  for (let col = 0; col < settings.columns; col++) {
    const left =
      x +
      col * (layout.cardWidthMm + settings.cardSpacingMm) +
      settings.bleedEdgeWidth;
    xCuts.add(left);
    xCuts.add(left + CARD_W_MM);
  }
  for (let row = 0; row < settings.rows; row++) {
    const top =
      y +
      row * (layout.cardHeightMm + settings.cardSpacingMm) +
      settings.bleedEdgeWidth;
    yCuts.add(top);
    yCuts.add(top + CARD_H_MM);
  }
  const lines: GuideLine[] = [];
  for (const cut of xCuts)
    lines.push(
      line(cut, 0, cut, y + settings.bleedEdgeWidth),
      line(
        cut,
        layout.pageHeightMm - y - settings.bleedEdgeWidth,
        cut,
        layout.pageHeightMm
      )
    );
  for (const cut of yCuts)
    lines.push(
      line(0, cut, x + settings.bleedEdgeWidth, cut),
      line(
        layout.pageWidthMm - x - settings.bleedEdgeWidth,
        cut,
        layout.pageWidthMm,
        cut
      )
    );
  return lines;
}
