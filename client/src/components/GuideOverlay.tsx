import type { GuideLine } from "../helpers/printGuides";
export function GuideOverlay({
  lines,
  width,
  height,
  color,
  strokeWidth,
}: {
  lines: GuideLine[];
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
}) {
  return (
    <svg
      className="card-guides"
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <path
        d={lines.map((l) => `M${l.x1} ${l.y1}L${l.x2} ${l.y2}`).join("")}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
      />
    </svg>
  );
}
