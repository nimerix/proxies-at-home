import { describe, expect, it } from "vitest";
import { fitLayout, pageSlots, printLayout } from "./printLayout";

describe("duplex print slots", () => {
  for (const count of [1, 2, 3, 8, 9, 10, 11]) {
    it(`mirrors ${count} cards without duplicates or shifting partial rows`, () => {
      const cards = Array.from({ length: count }, (_, i) => i);
      for (let start = 0; start < count; start += 9) {
        const front = pageSlots(cards.slice(start, start + 9), 3, 3);
        const back = pageSlots(cards.slice(start, start + 9), 3, 3, true);
        for (let i = 0; i < 9; i++)
          expect(back[Math.floor(i / 3) * 3 + 2 - (i % 3)]).toBe(front[i]);
        expect(back.filter((v) => v !== null).sort()).toEqual(
          cards.slice(start, start + 9).sort()
        );
      }
    });
  }
  it("handles custom grids and rejects zero capacity", () => {
    expect(pageSlots(["A", "B", "C"], 2, 2, true)).toEqual([
      "B",
      "A",
      null,
      "C",
    ]);
    expect(() => pageSlots([], 0, 3)).toThrow();
  });
});
it("fits the grid including bleed, independently of guides", () => {
  const layout = fitLayout({
    pageWidth: 8.5,
    pageHeight: 11,
    pageSizeUnit: "in" as const,
    columns: 5,
    rows: 4,
    bleedEdgeWidth: 5,
    cardSpacingMm: 20,
  });
  expect(layout.columns).toBe(2);
  expect(layout.rows).toBe(2);
  expect(printLayout(layout).fits).toBe(true);
});

it("keeps guide trim dimensions independent of bleed", async () => {
  const { cornerGuideLines } = await import("./printGuides");
  for (const bleed of [0, 1, 2, 5]) {
    const guides = cornerGuideLines(bleed, false);
    const xs = guides.flatMap((l) => [l.x1, l.x2]),
      ys = guides.flatMap((l) => [l.y1, l.y2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(63);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(88);
    expect(Math.min(...xs)).toBe(bleed);
    expect(Math.min(...ys)).toBe(bleed);
  }
});
