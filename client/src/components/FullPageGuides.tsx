// components/EdgeCutLines.tsx
import React from "react";

type Props = {
  pageWidthIn: number;         // 8.5
  pageHeightIn: number;        // 11
  cols?: number;               // 3
  rows?: number;               // 3
  totalCardWidthMm: number;    // base + 2*bleed
  totalCardHeightMm: number;   // base + 2*bleed
  baseCardWidthMm: number;     // 63.5
  baseCardHeightMm: number;    // 88.9
  bleedEdgeWidthMm: number;    // same as your guideOffset in mm
  guideWidthPx: number;        // match your corner tick thickness
};

const EdgeCutLines: React.FC<Props> = ({
  pageWidthIn,
  pageHeightIn,
  cols = 3,
  rows = 3,
  totalCardWidthMm,
  totalCardHeightMm,
  baseCardWidthMm,
  baseCardHeightMm,
  bleedEdgeWidthMm,
  guideWidthPx,
}) => {
  const pageWidthMm  = pageWidthIn * 25.4;
  const pageHeightMm = pageHeightIn * 25.4;

  const gridWidthMm  = cols * totalCardWidthMm;
  const gridHeightMm = rows * totalCardHeightMm;

  // center the grid
  const startXmm = (pageWidthMm - gridWidthMm) / 2;
  const startYmm = (pageHeightMm - gridHeightMm) / 2;

  // where your corner ticks sit inside each cell:
  const cutInX  = bleedEdgeWidthMm;                    // from cell left
  const cutOutX = bleedEdgeWidthMm + baseCardWidthMm;  // from cell left
  const cutInY  = bleedEdgeWidthMm;                    // from cell top
  const cutOutY = bleedEdgeWidthMm + baseCardHeightMm; // from cell top

  // collect all vertical/horizontal cut positions
  const xCuts = new Set<number>();
  for (let c = 0; c < cols; c++) {
    const cellLeft = startXmm + c * totalCardWidthMm;
    xCuts.add(cellLeft + cutInX);
    xCuts.add(cellLeft + cutOutX);
  }
  const yCuts = new Set<number>();
  for (let r = 0; r < rows; r++) {
    const cellTop = startYmm + r * totalCardHeightMm;
    yCuts.add(cellTop + cutInY);
    yCuts.add(cellTop + cutOutY);
  }

  const els: React.ReactElement[] = [];

  // For each vertical cut, draw two stubs:
  // top: page top -> top corner tick
  // bottom: page bottom -> bottom corner tick
  const stubH = startYmm + cutInY; // distance from page edge to the tick
  [...xCuts].forEach((x, i) => {
    els.push(
      <div
        key={`v-top-${i}`}
        style={{
          position: "absolute",
          left: `${x}mm`,
          top: 0,
          width: `${guideWidthPx}px`,
          height: `${stubH}mm`,
          backgroundColor: "black",
          pointerEvents: "none",
        }}
      />,
      <div
        key={`v-bot-${i}`}
        style={{
          position: "absolute",
          left: `${x}mm`,
          top: `${pageHeightMm - stubH}mm`,
          width: `${guideWidthPx}px`,
          height: `${stubH}mm`,
          backgroundColor: "black",
          pointerEvents: "none",
        }}
      />
    );
  });

  // For each horizontal cut, draw two stubs:
  // left: page left -> left corner tick
  // right: page right -> right corner tick
  const stubW = startXmm + cutInX;
  [...yCuts].forEach((y, i) => {
    els.push(
      <div
        key={`h-left-${i}`}
        style={{
          position: "absolute",
          top: `${y}mm`,
          left: 0,
          height: `${guideWidthPx}px`,
          width: `${stubW}mm`,
          backgroundColor: "black",
          pointerEvents: "none",
        }}
      />,
      <div
        key={`h-right-${i}`}
        style={{
          position: "absolute",
          top: `${y}mm`,
          left: `${pageWidthMm - stubW}mm`,
          height: `${guideWidthPx}px`,
          width: `${stubW}mm`,
          backgroundColor: "black",
          pointerEvents: "none",
        }}
      />
    );
  });

  return <>{els}</>;
};

export default EdgeCutLines;
