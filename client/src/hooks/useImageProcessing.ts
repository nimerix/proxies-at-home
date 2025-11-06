import { useRef, useState } from "react";
import {
  addBleedEdgeSmartly,
  computeCardPreviewPixels,
  createPreviewDataUrl,
  getLocalBleedImageUrl,
  isUploadedFileToken,
  makeUploadedFileToken,
  processWithConcurrency,
  revokeIfBlobUrl,
  resolveImageProcessingConcurrency,
  urlToDataUrl,
} from "../helpers/ImageHelper";
import { useCardsStore, useSettingsStore } from "../store";
import type { CardOption } from "../types/Card";

export function useImageProcessing({
  unit,
  bleedEdgeWidth,
}: {
  unit: "mm" | "in";
  bleedEdgeWidth: number;
}) {
  const selectedImages = useCardsStore((state) => state.selectedImages);
  const selectedBackFaceImages = useCardsStore((state) => state.selectedBackFaceImages);
  const originalSelectedImages = useCardsStore(
    (state) => state.originalSelectedImages
  );
  const uploadedFiles = useCardsStore((state) => state.uploadedFiles);
  const appendSelectedImages = useCardsStore(
    (state) => state.appendSelectedImages
  );
  const appendSelectedBackFaceImages = useCardsStore(
    (state) => state.appendSelectedBackFaceImages
  );
  const appendOriginalSelectedImages = useCardsStore(
    (state) => state.appendOriginalSelectedImages
  );
  const setIsProcessing = useSettingsStore((state) => state.setIsProcessing);
  const setProcessingProgress = useSettingsStore(
    (state) => state.setProcessingProgress
  );

  const [loadingMap, setLoadingMap] = useState<
    Record<string, "idle" | "loading" | "error">
  >({});
  const inFlight = useRef<Record<string, Promise<void>>>({});
  const jobTokenCounter = useRef(0);
  const activeJobToken = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  function getOriginalSrcForCard(card: CardOption): string | File | undefined {
    const stored = originalSelectedImages[card.uuid];
    if (stored) {
      if (isUploadedFileToken(stored)) {
        return uploadedFiles[card.uuid];
      }
      return stored;
    }

    // Use the current face index if available
    if (card.faces && card.faces.length > 0) {
      const faceIndex = card.currentFaceIndex ?? 0;
      const face = card.faces[faceIndex];
      if (face?.imageUrl) {
        return getLocalBleedImageUrl(face.imageUrl);
      }
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

  async function ensureBackFaceProcessed(card: CardOption): Promise<void> {
    const uuid = card.uuid;
    if (selectedBackFaceImages[uuid]) return;

    // Check if card has a back face
    if (!card.faces || card.faces.length < 2 || !card.faces[1]?.imageUrl) return;

    const backFaceKey = `${uuid}-back`;
    const existing = inFlight.current[backFaceKey];
    if (existing) return existing;

    const p = (async () => {
      const backFaceUrl = getLocalBleedImageUrl(card.faces![1].imageUrl);

      setLoadingMap((m) => ({ ...m, [uuid]: "loading" }));
      try {
        const resolvedSrc = await urlToDataUrl(backFaceUrl);

        let processedUrl: string | null = null;
        try {
          // Back faces from Scryfall don't have baked-in bleed
          processedUrl = await addBleedEdgeSmartly(resolvedSrc, bleedEdgeWidth, {
            unit,
            bleedEdgeWidth,
            hasBakedBleed: false,
          });
          const { width: previewWidth, height: previewHeight } = computeCardPreviewPixels(bleedEdgeWidth);
          const preview = await createPreviewDataUrl(processedUrl, {
            maxWidth: previewWidth,
            maxHeight: previewHeight,
            mimeType: "image/jpeg",
            quality: 0.82,
            background: "#FFFFFF",
          });

          appendSelectedBackFaceImages({ [uuid]: preview });
        } finally {
          revokeIfBlobUrl(processedUrl);
        }

        setLoadingMap((m) => ({ ...m, [uuid]: "idle" }));
      } catch (e) {
        console.error("ensureBackFaceProcessed error for", card.name, e);
        setLoadingMap((m) => ({ ...m, [uuid]: "error" }));
      } finally {
        delete inFlight.current[backFaceKey];
      }
    })();

    inFlight.current[backFaceKey] = p;
    return p;
  }

  async function reprocessSelectedImages(
    cards: CardOption[],
    newBleedWidth: number
  ) {
    const totalCards = cards.length;
    if (totalCards === 0) {
      return;
    }

    // Cancel any existing job
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const token = ++jobTokenCounter.current;
    activeJobToken.current = token;
    setIsProcessing(true);
    setProcessingProgress(0);

    let completed = 0;
    const updated: Record<string, string> = {};
    const { width: previewWidth, height: previewHeight } = computeCardPreviewPixels(newBleedWidth);
    const concurrency = resolveImageProcessingConcurrency();

    const reportProgress = () => {
      if (activeJobToken.current !== token) return;
      completed += 1;
      const percentage = Math.min(100, Math.round((completed / totalCards) * 100));
      setProcessingProgress(percentage);
    };

    try {
      await processWithConcurrency(
        cards,
        async (card) => {
          if (controller.signal.aborted) return;

          const uuid = card.uuid;
          const original = originalSelectedImages[uuid];

          let resolvedSrc: string | undefined;
          let revokeUrl: string | null = null;

          try {
            if (!original) {
              return;
            }

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

            if (!resolvedSrc || controller.signal.aborted) return;

            let processedUrl: string | null = null;
            try {
              processedUrl = await addBleedEdgeSmartly(resolvedSrc, newBleedWidth, {
                unit,
                bleedEdgeWidth: newBleedWidth,
                hasBakedBleed: card.hasBakedBleed,
              });

              if (controller.signal.aborted) return;

              updated[uuid] = await createPreviewDataUrl(processedUrl, {
                maxWidth: previewWidth,
                maxHeight: previewHeight,
                mimeType: "image/jpeg",
                quality: 0.82,
                background: "#FFFFFF",
              });
            } catch (err) {
              if (!controller.signal.aborted) {
                console.warn("[Reprocess] Failed for card", card.name ?? uuid, err);
              }
            } finally {
              revokeIfBlobUrl(processedUrl);
            }
          } finally {
            if (revokeUrl) URL.revokeObjectURL(revokeUrl);
            reportProgress();
          }
        },
        concurrency,
        controller.signal
      );

      if (activeJobToken.current === token && Object.keys(updated).length > 0 && !controller.signal.aborted) {
        appendSelectedImages(updated);
      }
    } finally {
      if (activeJobToken.current === token) {
        setIsProcessing(false);
        setProcessingProgress(0);
        activeJobToken.current = null;
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  return { loadingMap, ensureProcessed, ensureBackFaceProcessed, reprocessSelectedImages };
}
