import { useRef, useState } from "react";
import type { CardOption } from "../types/Card";
import { addBleedEdge, getLocalBleedImageUrl, trimBleedEdge, urlToDataUrl } from "../helpers/ImageHelper";

export function useImageProcessing(params: {
  unit: "mm" | "in";
  bleedEdgeWidth: number;
  selectedImages: Record<string, string>;
  setSelectedImages: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  originalSelectedImages: Record<string, string>;
  setOriginalSelectedImages: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const { unit, bleedEdgeWidth, selectedImages, setSelectedImages, originalSelectedImages, setOriginalSelectedImages } = params;

  const [loadingMap, setLoadingMap] = useState<Record<string, 'idle' | 'loading' | 'error'>>({});
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

      setLoadingMap(m => ({ ...m, [uuid]: 'loading' }));
      try {
        let base: string;
        if (/^data:image\//i.test(src)) {
          base = card.hasBakedBleed ? await trimBleedEdge(src) : src;
        } else {
          const dataUrl = await urlToDataUrl(src);
          base = card.hasBakedBleed ? await trimBleedEdge(dataUrl) : dataUrl;
        }
        const withBleed = await addBleedEdge(base, bleedEdgeWidth, { unit, bleedEdgeWidth });
        setSelectedImages(prev => ({ ...prev, [uuid]: withBleed }));
        if (!originalSelectedImages[uuid]) {
          setOriginalSelectedImages(prev => ({ ...prev, [uuid]: src }));
        }
        setLoadingMap(m => ({ ...m, [uuid]: 'idle' }));
      } catch (e) {
        console.error('ensureProcessed error for', card.name, e);
        setLoadingMap(m => ({ ...m, [uuid]: 'error' }));
      } finally {
        delete inFlight.current[uuid];
      }
    })();

    inFlight.current[uuid] = p;
    return p;
  }

  async function reprocessSelectedImages(cards: CardOption[], newBleedWidth: number) {
    const updated: Record<string, string> = {};
    for (const card of cards) {
      const uuid = card.uuid;
      if (card.isUserUpload) {
        const original = originalSelectedImages[uuid];
        if (!original && selectedImages[uuid]) {
          updated[uuid] = await addBleedEdge(selectedImages[uuid], newBleedWidth, { unit, bleedEdgeWidth: newBleedWidth });
          continue;
        }
        if (original) {
          const base = card.hasBakedBleed ? await trimBleedEdge(original) : original;
          updated[uuid] = await addBleedEdge(base, newBleedWidth, { unit, bleedEdgeWidth: newBleedWidth });
        }
      } else if (originalSelectedImages[uuid]) {
        const proxiedUrl = getLocalBleedImageUrl(originalSelectedImages[uuid]);
        updated[uuid] = await addBleedEdge(proxiedUrl, newBleedWidth, { unit, bleedEdgeWidth: newBleedWidth });
      }
    }
    setSelectedImages(updated);
  }

  return { loadingMap, ensureProcessed, reprocessSelectedImages };
}
