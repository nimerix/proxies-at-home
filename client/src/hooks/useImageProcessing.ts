import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTaskQueue,
  blobToDataUrl,
  toProxied,
  PREVIEW_CARD_DPI,
} from "../helpers/ImageHelper";
import { renderCardImage } from "../helpers/renderCardImage";
import { cardSource } from "../helpers/cardSources";
import { cardBleedOptions } from "../helpers/cardBleedOptions";
import { useCardsStore, useSettingsStore } from "../store";
import type { CardOption } from "../types/Card";
import type { BleedArtworkOptions } from "../helpers/bleedArtwork";

export type LoadState = "idle" | "loading" | "error";
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
const queuePreview = createTaskQueue(3);
// Uploads and MPC sources can be very large. Decode/render one at a time,
// while ordinary Scryfall cards retain concurrent network loading.
const queueUploadPreview = createTaskQueue(1);

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
  const [loadingMap, setLoadingMap] = useState<Record<string, LoadState>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
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
      setLoadingMap((m) => ({ ...m, [key]: "loading" }));
      setErrorMap((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
      const enqueue =
        hasBakedBleed ||
        typeof source !== "string" ||
        /^(data:|blob:)/.test(source)
          ? queueUploadPreview
          : queuePreview;
      job.promise = enqueue(async () => {
        let uploadUrl: string | undefined;
        try {
          if (!isCurrent()) return;
          if (!source)
            throw new Error(
              "Image source is missing. Upload the image again or choose another artwork."
            );
          const src =
            typeof source === "string"
              ? toProxied(source)
              : (uploadUrl = URL.createObjectURL(source));
          const { blob, report } = await renderCardImage(
            src,
            bleedEdgeWidth,
            hasBakedBleed,
            dpi,
            {
              signal: job.controller.signal,
              quality: 0.85,
              artwork: cardBleedOptions(card, {
                source: bleedSource,
                insetMm: scanInsetMm,
                borders: borderBleed,
                cornerRadiusMm: scanCornerRadiusMm,
              }),
            }
          );
          if (!isCurrent()) return;
          const preview = await blobToDataUrl(blob);
          if (!isCurrent()) return;
          useCardsStore
            .getState()
            .setProcessedImage(card.uuid, back, preview, report);
          setLoadingMap((m) => ({ ...m, [key]: "idle" }));
        } catch (error) {
          if (isCurrent()) {
            console.warn(`Could not prepare ${card.name}`, error);
            setErrorMap((m) => ({
              ...m,
              [key]:
                error instanceof Error
                  ? error.message
                  : "Could not prepare this image. Please try again.",
            }));
            setLoadingMap((m) => ({ ...m, [key]: "error" }));
          }
        } finally {
          if (uploadUrl) URL.revokeObjectURL(uploadUrl);
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
  return { loadingMap, errorMap, ensureProcessed, ensureBackFaceProcessed };
}
