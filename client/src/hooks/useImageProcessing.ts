import { useCallback, useEffect, useRef } from "react";
import {
  createTaskQueue,
  blobToDataUrl,
  resolveImageUrl,
  PREVIEW_CARD_DPI,
} from "../helpers/ImageHelper";
import { renderCardImage } from "../helpers/renderCardImage";
import {
  cachedPreview,
  previewSourceKey,
  prunePreviews,
} from "../helpers/previewCache";
import { cardSource } from "../helpers/cardSources";
import { cardBleedOptions } from "../helpers/cardBleedOptions";
import { useCardsStore, usePreviewStore, useSettingsStore } from "../store";
import type { CardOption } from "../types/Card";
import type { BleedArtworkOptions } from "../helpers/bleedArtwork";

type PreviewJob = {
  card: CardOption;
  source: string | File | undefined;
  bleed: number;
  dpi: number;
  hasBakedBleed: boolean;
  bleedSource: BleedArtworkOptions["source"];
  scanInsetMm: number;
  borderBleed: "auto" | "mirror";
  scanCornerRadiusMm: number;
  epoch: number;
  controller: AbortController;
  promise?: Promise<void>;
};
// Downloads overlap; decoding and rendering still take one shared slot.
const queuePreview = createTaskQueue(9);
// Local uploads can be very large and need no download. One at a time.
const queueUploadPreview = createTaskQueue(1);

// The cached render each card slot shows, while the slot still shows it.
const slots = new Map<string, { key: string; src: string }>();
let shown: Set<string> | null = null;
const isShown = (key: string) => {
  if (!shown) {
    const { selectedImages, selectedBackFaceImages } = useCardsStore.getState();
    shown = new Set();
    for (const [slot, value] of slots) {
      const [uuid, back] = slot.split(":");
      const src = (back === "true" ? selectedBackFaceImages : selectedImages)[
        uuid
      ];
      if (src === value.src) shown.add(value.key);
      else slots.delete(slot);
    }
  }
  return shown.has(key);
};
let pruneQueued = false;
useCardsStore.subscribe((state, previous) => {
  if (
    state.selectedImages === previous.selectedImages &&
    state.selectedBackFaceImages === previous.selectedBackFaceImages
  )
    return;
  shown = null;
  if (pruneQueued) return;
  pruneQueued = true;
  setTimeout(() => {
    pruneQueued = false;
    prunePreviews(isShown);
  });
});

export function useImageProcessing({
  bleedEdgeWidth,
}: {
  unit: "mm" | "in";
  bleedEdgeWidth: number;
}) {
  const customBack = useSettingsStore((s) => s.customCardbackUrl);
  const customHasBleed = useSettingsStore((s) => s.customCardbackHasBleed);
  const highQuality = useSettingsStore((s) => s.useHighQualityPreviews);
  const bleedSource = useSettingsStore((s) => s.bleedSource);
  const scanInsetMm = useSettingsStore((s) => s.scanInsetMm);
  const borderBleed = useSettingsStore((s) => s.borderBleed);
  const scanCornerRadiusMm = useSettingsStore((s) => s.scanCornerRadiusMm);
  const inFlight = useRef(new Map<string, PreviewJob>());
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      for (const job of inFlight.current.values()) job.controller.abort();
    },
    []
  );

  const process = useCallback(
    async (card: CardOption, back: boolean) => {
      const images = useCardsStore.getState();
      if (
        (back ? images.selectedBackFaceImages : images.selectedImages)[
          card.uuid
        ]
      )
        return;
      const { source, hasBakedBleed } = cardSource(
        card,
        images,
        back,
        customBack,
        customHasBleed
      );
      const dpi = highQuality ? 300 : PREVIEW_CARD_DPI;
      const key = `${card.uuid}:${back}`;
      const previous = inFlight.current.get(key);
      if (
        previous?.card === card &&
        previous.epoch === generation.current &&
        previous.source === source &&
        previous.bleed === bleedEdgeWidth &&
        previous.dpi === dpi &&
        previous.bleedSource === bleedSource &&
        previous.scanInsetMm === scanInsetMm &&
        previous.borderBleed === borderBleed &&
        previous.scanCornerRadiusMm === scanCornerRadiusMm &&
        previous.hasBakedBleed === hasBakedBleed
      )
        return previous.promise;
      const epoch = generation.current;
      previous?.controller.abort();
      const job: PreviewJob = {
        card,
        source,
        bleed: bleedEdgeWidth,
        dpi,
        hasBakedBleed,
        bleedSource,
        scanInsetMm,
        borderBleed,
        scanCornerRadiusMm,
        epoch,
        controller: new AbortController(),
      };
      inFlight.current.set(key, job);
      const isCurrent = () => {
        const current = useCardsStore.getState(),
          settings = useSettingsStore.getState();
        const currentSource = cardSource(
          card,
          current,
          back,
          settings.customCardbackUrl,
          settings.customCardbackHasBleed
        );
        return (
          epoch === generation.current &&
          inFlight.current.get(key) === job &&
          current.cards.some((c) => c === card) &&
          settings.bleedEdgeWidth === bleedEdgeWidth &&
          settings.useHighQualityPreviews === highQuality &&
          settings.bleedSource === bleedSource &&
          settings.scanInsetMm === scanInsetMm &&
          settings.borderBleed === borderBleed &&
          settings.scanCornerRadiusMm === scanCornerRadiusMm &&
          currentSource.source === source &&
          currentSource.hasBakedBleed === hasBakedBleed
        );
      };
      const { setStatus } = usePreviewStore.getState();
      setStatus(key, "loading");
      const enqueue =
        typeof source !== "string" || /^(data:|blob:)/.test(source)
          ? queueUploadPreview
          : queuePreview;
      job.promise = enqueue(async () => {
        try {
          if (!isCurrent()) return;
          if (!source)
            throw new Error(
              "Image source is missing. Upload the image again or choose another artwork."
            );
          const artwork = cardBleedOptions(card, {
            source: bleedSource,
            insetMm: scanInsetMm,
            borders: borderBleed,
            cornerRadiusMm: scanCornerRadiusMm,
          });
          const cacheKey = JSON.stringify([
            previewSourceKey(source),
            bleedEdgeWidth,
            hasBakedBleed,
            dpi,
            artwork,
          ]);
          const preview = await cachedPreview(
            cacheKey,
            async (signal) => {
              const uploadUrl =
                typeof source === "string"
                  ? undefined
                  : URL.createObjectURL(source);
              try {
                const { blob, report } = await renderCardImage(
                  uploadUrl ?? resolveImageUrl(source as string),
                  bleedEdgeWidth,
                  hasBakedBleed,
                  dpi,
                  { signal, quality: 0.85, artwork }
                );
                return { src: await blobToDataUrl(blob), report };
              } finally {
                if (uploadUrl) URL.revokeObjectURL(uploadUrl);
              }
            },
            isShown,
            job.controller.signal
          );
          if (!isCurrent()) return;
          slots.set(key, { key: cacheKey, src: preview.src });
          useCardsStore
            .getState()
            .setProcessedImage(card.uuid, back, preview.src, preview.report);
          setStatus(key, "idle");
        } catch (error) {
          if (isCurrent()) {
            console.warn(`Could not prepare ${card.name}`, error);
            setStatus(
              key,
              "error",
              error instanceof Error
                ? error.message
                : "Could not prepare this image. Please try again."
            );
          }
        } finally {
          if (inFlight.current.get(key) === job) inFlight.current.delete(key);
        }
      });
      return job.promise;
    },
    [
      bleedEdgeWidth,
      highQuality,
      customBack,
      customHasBleed,
      bleedSource,
      scanInsetMm,
      borderBleed,
      scanCornerRadiusMm,
    ]
  );

  const ensureProcessed = useCallback(
    (card: CardOption) => process(card, false),
    [process]
  );
  const ensureBackFaceProcessed = useCallback(
    (card: CardOption) => process(card, true),
    [process]
  );
  return { ensureProcessed, ensureBackFaceProcessed };
}
