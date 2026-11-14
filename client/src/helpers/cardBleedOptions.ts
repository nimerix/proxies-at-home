import type { CardOption } from "../types/Card";
import {
  CARD_CORNER_RADIUS_MM,
  MAX_SCAN_CORNER_RADIUS_MM,
  MAX_SCAN_INSET_MM,
  type BleedArtworkOptions,
} from "./bleedArtwork";

/** Resolve persisted per-card choices against the current print settings. */
export function cardBleedOptions(
  card: CardOption,
  defaults: BleedArtworkOptions
): BleedArtworkOptions {
  const local = card.bleedArtwork;
  const inset = local?.insetMm,
    radius = local?.cornerRadiusMm;
  return {
    source:
      local?.source === "scan" || local?.source === "square"
        ? local.source
        : defaults.source,
    borders:
      local?.borders === "auto" || local?.borders === "mirror"
        ? local.borders
        : defaults.borders,
    insetMm:
      typeof inset === "number" && Number.isFinite(inset)
        ? Math.max(0, Math.min(MAX_SCAN_INSET_MM, inset))
        : defaults.insetMm,
    cornerRadiusMm:
      typeof radius === "number" && Number.isFinite(radius)
        ? Math.max(
            CARD_CORNER_RADIUS_MM,
            Math.min(MAX_SCAN_CORNER_RADIUS_MM, radius)
          )
        : defaults.cornerRadiusMm,
  };
}
