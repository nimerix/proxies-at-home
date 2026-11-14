import type { BleedBorders, CardEdge } from "./bleedBorders";
import { suggestedShadowRemoval, type BorderProfile } from "./bleedBorders";

export type BleedReport = {
  kind: "none" | "supplied" | "mirror" | "auto";
  edges?: Record<CardEdge, "black" | "white" | "artwork" | "mixed">;
  suggestedInsetMm?: number;
};

export function describeBleedBorders(
  borders: BleedBorders,
  profiles?: BorderProfile[]
): BleedReport {
  const edges = {} as NonNullable<BleedReport["edges"]>;
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const weights = borders.weights[edge];
    edges[edge] = !weights?.some((weight) => weight > 0)
      ? "artwork"
      : weights.every((weight) => weight === 1)
        ? borders.tone === 255
          ? "white"
          : "black"
        : "mixed";
  }
  return {
    kind: "auto",
    edges,
    suggestedInsetMm: profiles ? suggestedShadowRemoval(profiles) : undefined,
  };
}
