import axios from "axios";
import {
  Button,
  Checkbox,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  TextInput,
} from "flowbite-react";
import { useState, useEffect } from "react";
import { API_BASE } from "../constants";
import { pngToNormal, getLocalBleedImageUrl } from "../helpers/ImageHelper";
import { useArtworkModalStore } from "../store";
import { useCardsStore } from "../store/cards";
import type { CardOption } from "../types/Card";

export function ArtworkModal() {
  const [isGettingMore, setIsGettingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [allPrints, setAllPrints] = useState<CardOption[]>([]);

  const isModalOpen = useArtworkModalStore((state) => state.open);
  const modalCard = useArtworkModalStore((state) => state.card);
  const modalIndex = useArtworkModalStore((state) => state.index);
  const autoFetchPrints = useArtworkModalStore((state) => state.autoFetchPrints);
  const closeArtworkModal = useArtworkModalStore((state) => state.closeModal);
  const updateArtworkCard = useArtworkModalStore((state) => state.updateCard);

  const cards = useCardsStore((state) => state.cards);
  const updateCard = useCardsStore((state) => state.updateCard);

  const originalSelectedImages = useCardsStore(
    (state) => state.originalSelectedImages
  );
  const appendOriginalSelectedImages = useCardsStore(
    (state) => state.appendOriginalSelectedImages
  );

  const clearSelectedImage = useCardsStore((state) => state.clearSelectedImage);
  const clearManySelectedImages = useCardsStore(
    (state) => state.clearManySelectedImages
  );

  const appendCachedImageUrls = useCardsStore(
    (state) => state.appendCachedImageUrls
  );

  async function getMoreCards() {
    if (!modalCard) return;
    setIsGettingMore(true);
    try {
      const res = await axios.post<CardOption[]>(
        `${API_BASE}/api/cards/images`,
        { cardNames: [modalCard.name], cardArt: "prints" }
      );

      console.log(`[ArtworkModal] Received ${res.data?.length ?? 0} results for "${modalCard.name}"`);

      if (!res.data || res.data.length === 0) {
        console.warn(`[ArtworkModal] No prints found for "${modalCard.name}"`);
        return;
      }

      // Combine imageUrls from all prints
      const allUrls: string[] = [];
      let firstCardData = res.data[0];

      for (const cardData of res.data) {
        // Extract imageUrls from either the direct property or from faces
        let urls = cardData.imageUrls ?? [];
        if (urls.length === 0 && cardData.faces && cardData.faces.length > 0) {
          urls = cardData.faces.map(face => face.imageUrl).filter(Boolean);
        }
        console.log(`[ArtworkModal] Card ${cardData.set}-${cardData.number}: ${urls.length} images`);
        allUrls.push(...urls);
      }

      console.log(`[ArtworkModal] Total combined URLs: ${allUrls.length}`);

      // Store all prints for later lookup
      setAllPrints(res.data);

      updateArtworkCard({
        imageUrls: allUrls,
        faces: firstCardData.faces,
        layout: firstCardData.layout,
        set: firstCardData.set,
        number: firstCardData.number,
      });
    } finally {
      setIsGettingMore(false);
    }
  }

  // Auto-fetch all prints when modal opens (unless card already has multiple images)
  useEffect(() => {
    if (isModalOpen && modalCard) {
      // Only fetch if we don't already have multiple artwork options
      const hasMultipleOptions = (modalCard.imageUrls?.length ?? 0) > 1;
      if (!hasMultipleOptions || autoFetchPrints) {
        getMoreCards();
      }
    } else {
      // Clear prints data when modal closes
      setAllPrints([]);
    }
  }, [isModalOpen, autoFetchPrints]);

  return (
    <Modal
      show={isModalOpen}
      onClose={() => closeArtworkModal()}
      size="4xl"
      dismissible
    >
      <ModalHeader>Select Artwork</ModalHeader>
      <ModalBody>
        <div className="mb-4">
          <TextInput
            type="text"
            placeholder="Replace with a different card..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();

              const name = searchQuery.trim();
              if (!name || modalIndex === null) return;

              const res = await axios.post<CardOption[]>(
                `${API_BASE}/api/cards/images`,
                { cardNames: [name] } // unique:art default happens server-side
              );

              if (!res.data.length) return;

              const newCard = res.data[0];

              // Extract imageUrls from either the direct property or from faces
              let urls = newCard.imageUrls ?? [];
              if (urls.length === 0 && newCard.faces && newCard.faces.length > 0) {
                urls = newCard.faces.map(face => face.imageUrl).filter(Boolean);
              }

              if (!urls.length) return;

              const newUuid = crypto.randomUUID();
              const firstImageUrl = urls[0];

              updateCard(modalIndex, {
                uuid: newUuid,
                name: newCard.name,
                imageUrls: urls,
                isUserUpload: false,
                faces: newCard.faces,
                layout: newCard.layout,
                set: newCard.set,
                number: newCard.number,
                currentFaceIndex: 0,
              });

              updateArtworkCard({
                uuid: newUuid,
                name: newCard.name,
                imageUrls: urls,
                isUserUpload: false,
                faces: newCard.faces,
                layout: newCard.layout,
                set: newCard.set,
                number: newCard.number,
              });

              appendOriginalSelectedImages({
                [newUuid]: firstImageUrl,
              });

              appendCachedImageUrls({
                [newUuid]: getLocalBleedImageUrl(firstImageUrl),
              });

              clearSelectedImage(newUuid);

              setSearchQuery("");
            }}
          />
        </div>

        {modalCard && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Checkbox
                id="apply-to-all"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
              />
              <Label htmlFor="apply-to-all">
                Apply to all cards named "{modalCard?.name}"
              </Label>
            </div>

            <div className="grid grid-cols-3 md:grid-cols-3 gap-4">
              {modalCard.imageUrls.map((pngUrl, i) => {
                const thumbUrl = pngToNormal(pngUrl);
                return (
                  <img
                    key={i}
                    src={thumbUrl}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = pngUrl;
                    }} // fallback
                    className={`w-full cursor-pointer border-4 ${originalSelectedImages[modalCard.uuid] === pngUrl
                        ? "border-green-500"
                        : "border-transparent"
                      }`}
                    onClick={async (e) => {
                      // Find which print this URL belongs to and which face was clicked
                      let matchingPrint: CardOption | undefined;
                      let clickedFaceIndex = 0;

                      for (const print of allPrints) {
                        const printUrls = print.imageUrls ?? [];
                        const urlIndex = printUrls.indexOf(pngUrl);
                        if (urlIndex !== -1) {
                          matchingPrint = print;
                          // Find which face this URL represents
                          if (print.faces && print.faces.length > 0) {
                            const faceIndex = print.faces.findIndex(f => f.imageUrl === pngUrl);
                            if (faceIndex !== -1) {
                              clickedFaceIndex = faceIndex;
                            }
                          }
                          break;
                        }
                      }

                      // Apply to all if checkbox is checked OR Shift is held
                      if (applyToAll || e.shiftKey) {
                        const newOriginalSelectedImages: Record<
                          string,
                          string
                        > = {};
                        const cachedUpdates: Record<string, string> = {};
                        const uuidsToClear: string[] = [];

                        cards.forEach((card) => {
                          if (card.name === modalCard.name) {
                            newOriginalSelectedImages[card.uuid] = pngUrl;
                            cachedUpdates[card.uuid] =
                              getLocalBleedImageUrl(pngUrl);
                            uuidsToClear.push(card.uuid);

                            // Update card metadata to match the selected print
                            if (matchingPrint && modalIndex !== null) {
                              updateCard(cards.indexOf(card), {
                                faces: matchingPrint.faces,
                                layout: matchingPrint.layout,
                                set: matchingPrint.set,
                                number: matchingPrint.number,
                                currentFaceIndex: clickedFaceIndex,
                              });
                            }
                          }
                        });

                        appendOriginalSelectedImages(
                          newOriginalSelectedImages
                        );
                        appendCachedImageUrls(cachedUpdates);
                        clearManySelectedImages(uuidsToClear);

                      } else {
                        appendOriginalSelectedImages({
                          [modalCard.uuid]: pngUrl,
                        });

                        appendCachedImageUrls({
                          [modalCard.uuid]: getLocalBleedImageUrl(pngUrl),
                        });

                        // Update the card's metadata to match the selected print
                        if (matchingPrint && modalIndex !== null) {
                          updateCard(modalIndex, {
                            faces: matchingPrint.faces,
                            layout: matchingPrint.layout,
                            set: matchingPrint.set,
                            number: matchingPrint.number,
                            currentFaceIndex: clickedFaceIndex,
                          });
                        }

                        clearSelectedImage(modalCard.uuid);
                      }

                      closeArtworkModal();
                    }}
                  />
                );
              })}
            </div>

            <Button
              className="w-full"
              color="blue"
              onClick={getMoreCards}
              disabled={isGettingMore}
            >
              {isGettingMore ? "Loading prints..." : "Get All Prints"}
            </Button>
          </>
        )}
      </ModalBody>
    </Modal>
  );
}
