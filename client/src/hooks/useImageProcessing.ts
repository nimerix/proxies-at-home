import { useRef, useState } from "react";
import {
  addBleedEdgeSmartly,
  computeCardPreviewPixels,
  createPreviewDataUrl,
  getLocalBleedImageUrl,
  isUploadedFileToken,
  makeUploadedFileToken,
  revokeIfBlobUrl,
  urlToDataUrl,
} from "../helpers/ImageHelper";
import { useCardsStore } from "../store";
import type { CardOption } from "../types/Card";

export function useImageProcessing({
  unit,
  bleedEdgeWidth,
}: {
  unit: "mm" | "in";
  bleedEdgeWidth: number;
}) {
  const selectedImages = useCardsStore((state) => state.selectedImages);
  const originalSelectedImages = useCardsStore(
    (state) => state.originalSelectedImages
  );
  const uploadedFiles = useCardsStore((state) => state.uploadedFiles);
  const appendSelectedImages = useCardsStore(
    (state) => state.appendSelectedImages
  );
  const appendOriginalSelectedImages = useCardsStore(
    (state) => state.appendOriginalSelectedImages
  );

  const [loadingMap, setLoadingMap] = useState<
    Record<string, "idle" | "loading" | "error">
  >({});
  const inFlight = useRef<Record<string, Promise<void>>>({});

  function getOriginalSrcForCard(card: CardOption): string | File | undefined {
    const stored = originalSelectedImages[card.uuid];
    if (stored) {
      if (isUploadedFileToken(stored)) {
        return uploadedFiles[card.uuid];
      }
      return stored;
    }
    if (card.imageUrls?.length) {
      return getLocalBleedImageUrl(card.imageUrls[0]);
    }
    return undefined;
  }

  async function ensureProcessed(card: CardOption): Promise<void> {
    const uuid = card.uuid;
    if (selectedImages[uuid]) return;

    const existing = inFlight.current[uuid];
    if (existing) return existing;

    const p = (async () => {
      const source = getOriginalSrcForCard(card);
      if (!source) return;

      setLoadingMap((m) => ({ ...m, [uuid]: "loading" }));
      let revokeUrl: string | null = null;
      try {
        let resolvedSrc: string;

        if (source instanceof File) {
          resolvedSrc = URL.createObjectURL(source);
          revokeUrl = resolvedSrc;
        } else if (/^(data:|blob:)/i.test(source)) {
          resolvedSrc = source;
        } else {
          resolvedSrc = await urlToDataUrl(source);
        }

        let processedUrl: string | null = null;
        try {
          processedUrl = await addBleedEdgeSmartly(resolvedSrc, bleedEdgeWidth, {
            unit,
            bleedEdgeWidth,
            hasBakedBleed: card.hasBakedBleed,
          });
          const { width: previewWidth, height: previewHeight } = computeCardPreviewPixels(bleedEdgeWidth);
          const preview = await createPreviewDataUrl(processedUrl, {
            maxWidth: previewWidth,
            maxHeight: previewHeight,
            mimeType: "image/jpeg",
            quality: 0.82,
            background: "#FFFFFF",
          });

          appendSelectedImages({ [uuid]: preview });
        } finally {
          revokeIfBlobUrl(processedUrl);
        }

        if (!originalSelectedImages[uuid]) {
          if (source instanceof File) {
            appendOriginalSelectedImages({ [uuid]: makeUploadedFileToken(uuid) });
          } else {
            appendOriginalSelectedImages({ [uuid]: source });
          }
        }
        setLoadingMap((m) => ({ ...m, [uuid]: "idle" }));
      } catch (e) {
        console.error("ensureProcessed error for", card.name, e);
        setLoadingMap((m) => ({ ...m, [uuid]: "error" }));
      } finally {
        if (revokeUrl) URL.revokeObjectURL(revokeUrl);
        delete inFlight.current[uuid];
      }
    })();

    inFlight.current[uuid] = p;
    return p;
  }

  async function reprocessSelectedImages(
    cards: CardOption[],
    newBleedWidth: number
  ) {
    const updated: Record<string, string> = {};
    const { width: previewWidth, height: previewHeight } = computeCardPreviewPixels(newBleedWidth);
    
    const promises = cards.map(async (card) => {
      const uuid = card.uuid;
      const original = originalSelectedImages[uuid];
      
      if (!original) return;

      let resolvedSrc: string | undefined;
      let revokeUrl: string | null = null;

      if (isUploadedFileToken(original)) {
        const file = uploadedFiles[uuid];
        if (!file) return;
        resolvedSrc = URL.createObjectURL(file);
        revokeUrl = resolvedSrc;
      } else if (/^(data:|blob:)/i.test(original)) {
        resolvedSrc = original;
      } else if (card.isUserUpload) {
        resolvedSrc = await urlToDataUrl(original);
      } else {
        resolvedSrc = getLocalBleedImageUrl(original);
      }

      if (!resolvedSrc) return;

      let processedUrl: string | null = null;
      try {
        processedUrl = await addBleedEdgeSmartly(resolvedSrc, newBleedWidth, {
          unit,
          bleedEdgeWidth: newBleedWidth,
          hasBakedBleed: card.hasBakedBleed,
        });
        updated[uuid] = await createPreviewDataUrl(processedUrl, {
          maxWidth: previewWidth,
          maxHeight: previewHeight,
          mimeType: "image/jpeg",
          quality: 0.82,
          background: "#FFFFFF",
        });
      } finally {
        revokeIfBlobUrl(processedUrl);
        if (revokeUrl) URL.revokeObjectURL(revokeUrl);
      }
    });

    await Promise.allSettled(promises);
    
    if (Object.keys(updated).length > 0) {
      appendSelectedImages(updated);
    }
  }

  return { loadingMap, ensureProcessed, reprocessSelectedImages };
}
