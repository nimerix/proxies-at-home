import { useRef, useState } from "react";
import {
  addBleedEdgeSmartly,
  getLocalBleedImageUrl,
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

  function getOriginalSrcForCard(card: CardOption): string | undefined {
    const o = originalSelectedImages[card.uuid];
    if (o) return o;
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
      const src = getOriginalSrcForCard(card);
      if (!src) return;

      setLoadingMap((m) => ({ ...m, [uuid]: "loading" }));
      try {
        const srcToProcess = /^data:image\//i.test(src) ? src : await urlToDataUrl(src);
        const withBleed = await addBleedEdgeSmartly(srcToProcess, bleedEdgeWidth, {
          unit,
          bleedEdgeWidth,
          hasBakedBleed: card.hasBakedBleed,
        });
        appendSelectedImages({ [uuid]: withBleed });
        if (!originalSelectedImages[uuid]) {
          appendOriginalSelectedImages({ [uuid]: src });
        }
        setLoadingMap((m) => ({ ...m, [uuid]: "idle" }));
      } catch (e) {
        console.error("ensureProcessed error for", card.name, e);
        setLoadingMap((m) => ({ ...m, [uuid]: "error" }));
      } finally {
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
    
    const promises = cards.map(async (card) => {
      const uuid = card.uuid;
      const original = originalSelectedImages[uuid];
      
      if (!original) return;
      
      if (card.isUserUpload) {
        const srcToProcess = /^data:image\//i.test(original) ? original : await urlToDataUrl(original);
        updated[uuid] = await addBleedEdgeSmartly(srcToProcess, newBleedWidth, {
          unit,
          bleedEdgeWidth: newBleedWidth,
          hasBakedBleed: card.hasBakedBleed,
        });
      } else {
        // Scryfall Image -> proxy the URL and add bleed
        const proxiedUrl = getLocalBleedImageUrl(original);
        updated[uuid] = await addBleedEdgeSmartly(proxiedUrl, newBleedWidth, {
          unit,
          bleedEdgeWidth: newBleedWidth,
          hasBakedBleed: false,
        });
      }
    });

    await Promise.allSettled(promises);
    
    if (Object.keys(updated).length > 0) {
      appendSelectedImages(updated);
    }
  }

  return { loadingMap, ensureProcessed, reprocessSelectedImages };
}
