import type { CardOption } from "../types/Card";
import { isUploadedFileToken } from "./imageUtils";

export type ImageSources = {
  originalSelectedImages: Record<string, string>;
  originalSelectedBackImages?: Record<string, string>;
  uploadedFiles?: Record<string, File>;
  uploadedBackFiles?: Record<string, File>;
};
export function cardSource(
  card: CardOption,
  images: ImageSources,
  back = false,
  customBack?: string | null,
  customHasBleed = false
) {
  let source: string | File | undefined;
  let hasBakedBleed = !!card.hasBakedBleed;
  if (back) {
    const chosen = images.originalSelectedBackImages?.[card.uuid];
    if (chosen) {
      source = isUploadedFileToken(chosen)
        ? images.uploadedBackFiles?.[card.uuid]
        : chosen;
      hasBakedBleed = card.backHasBakedBleed ?? false;
    } else if ((card.faces?.length ?? 0) > 1) {
      source =
        card.faces?.[(card.currentFaceIndex ?? 0) === 0 ? 1 : 0]?.imageUrl;
      hasBakedBleed = false;
    } else {
      source = customBack || "/cardback.png";
      hasBakedBleed = !!customBack && customHasBleed;
    }
  } else {
    const chosen = images.originalSelectedImages[card.uuid];
    source = chosen
      ? isUploadedFileToken(chosen)
        ? images.uploadedFiles?.[card.uuid]
        : chosen
      : card.faces?.[card.currentFaceIndex ?? 0]?.imageUrl ||
        card.imageUrls?.[0];
  }
  return { source, hasBakedBleed };
}
