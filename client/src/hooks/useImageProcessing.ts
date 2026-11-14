import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTaskQueue,
  renderCardCanvas,
  toProxied,
  PREVIEW_CARD_DPI,
} from "../helpers/ImageHelper";
import { cardSource } from "../helpers/cardSources";
import { useCardsStore, useSettingsStore } from "../store";
import type { CardOption } from "../types/Card";

type LoadState = "idle" | "loading" | "error";
type PreviewJob = {
  card: CardOption;
  source: string | File | undefined;
  bleed: number;
  dpi: number;
  hasBakedBleed: boolean;
  epoch: number;
  promise?: Promise<void>;
};
const queuePreview = createTaskQueue(3);

export function useImageProcessing({
  bleedEdgeWidth,
}: {
  unit: "mm" | "in";
  bleedEdgeWidth: number;
}) {
  const customBack = useSettingsStore((s) => s.customCardbackUrl);
  const customHasBleed = useSettingsStore((s) => s.customCardbackHasBleed);
  const highQuality = useSettingsStore((s) => s.useHighQualityPreviews);
  const [loadingMap, setLoadingMap] = useState<Record<string, LoadState>>({});
  const inFlight = useRef(new Map<string, PreviewJob>());
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
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
        previous.hasBakedBleed === hasBakedBleed
      )
        return previous.promise;
      const epoch = generation.current;
      const job: PreviewJob = {
        card,
        source,
        bleed: bleedEdgeWidth,
        dpi,
        hasBakedBleed,
        epoch,
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
          currentSource.source === source &&
          currentSource.hasBakedBleed === hasBakedBleed
        );
      };
      setLoadingMap((m) => ({ ...m, [key]: "loading" }));
      job.promise = queuePreview(async () => {
        let uploadUrl: string | undefined;
        let canvas: HTMLCanvasElement | undefined;
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
          canvas = await renderCardCanvas(
            src,
            bleedEdgeWidth,
            hasBakedBleed,
            dpi
          );
          if (!isCurrent()) return;
          const preview = canvas.toDataURL("image/jpeg", 0.85);
          if (preview === "data:,")
            throw new Error("The browser could not prepare the preview.");
          const current = useCardsStore.getState();
          if (back)
            current.appendSelectedBackFaceImages({ [card.uuid]: preview });
          else current.appendSelectedImages({ [card.uuid]: preview });
          setLoadingMap((m) => ({ ...m, [key]: "idle" }));
        } catch (error) {
          if (isCurrent()) {
            console.warn(`Could not prepare ${card.name}`, error);
            setLoadingMap((m) => ({ ...m, [key]: "error" }));
          }
        } finally {
          if (uploadUrl) URL.revokeObjectURL(uploadUrl);
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          if (inFlight.current.get(key) === job) inFlight.current.delete(key);
        }
      });
      return job.promise;
    },
    [bleedEdgeWidth, highQuality, customBack, customHasBleed]
  );

  const ensureProcessed = useCallback(
    (card: CardOption) => process(card, false),
    [process]
  );
  const ensureBackFaceProcessed = useCallback(
    (card: CardOption) => process(card, true),
    [process]
  );
  return { loadingMap, ensureProcessed, ensureBackFaceProcessed };
}
