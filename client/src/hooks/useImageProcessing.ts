import { useRef, useState } from "react";
import {
  addBleedEdge,
  getLocalBleedImageUrl,
  trimBleedEdge,
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
        let base: string;
        if (/^data:image\//i.test(src)) {
          base = card.hasBakedBleed ? await trimBleedEdge(src) : src;
        } else {
          const dataUrl = await urlToDataUrl(src);
          base = card.hasBakedBleed ? await trimBleedEdge(dataUrl) : dataUrl;
        }
        const withBleed = await addBleedEdge(base, bleedEdgeWidth, {
          unit,
          bleedEdgeWidth,
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
        let base: string;
        if (/^data:image\//i.test(original)) {
          base = card.hasBakedBleed ? await trimBleedEdge(original) : original;
        } else {
          const dataUrl = await urlToDataUrl(original);
          base = card.hasBakedBleed ? await trimBleedEdge(dataUrl) : dataUrl;
        }
        updated[uuid] = await addBleedEdge(base, newBleedWidth, {
          unit,
          bleedEdgeWidth: newBleedWidth,
        });
      } else {
        // Scryfall Image -> proxy the URL and add bleed
        const proxiedUrl = getLocalBleedImageUrl(original);
        updated[uuid] = await addBleedEdge(proxiedUrl, newBleedWidth, {
          unit,
          bleedEdgeWidth: newBleedWidth,
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
