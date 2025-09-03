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
import { useState } from "react";
import { API_BASE } from "../constants";
import { pngToNormal, getLocalBleedImageUrl } from "../helpers/ImageHelper";
import { useArtworkModalStore } from "../store";
import { useCardsStore } from "../store/cards";
import type { CardOption } from "../types/Card";

export function ArtworkModal() {
  const [isGettingMore, setIsGettingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);

  const isModalOpen = useArtworkModalStore((state) => state.open);
  const modalCard = useArtworkModalStore((state) => state.card);
  const modalIndex = useArtworkModalStore((state) => state.index);
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

  // NEW: cached image url helpers (persisted)
  const appendCachedImageUrls = useCardsStore(
    (state) => state.appendCachedImageUrls
  );
  const clearCachedForMany = useCardsStore((state) => state.clearCachedForMany);
  const clearCachedForCard = useCardsStore((state) => state.clearCachedForCard);

  async function getMoreCards() {
    if (!modalCard) return;
    setIsGettingMore(true);
    try {
      const res = await axios.post<CardOption[]>(
        `${API_BASE}/api/cards/images`,
        { cardNames: [modalCard.name], cardArt: "prints" }
      );

      const urls = res.data?.[0]?.imageUrls ?? [];
      updateArtworkCard({ imageUrls: urls });
    } finally {
      setIsGettingMore(false);
    }
  }

  return (
    <Modal show={isModalOpen} onClose={() => closeArtworkModal()} size="4xl">
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

              const newCard = res.data[0]; // { name, imageUrls }
              if (!newCard.imageUrls?.length) return;

              const newUuid = crypto.randomUUID();

              // Update the card in the grid
              updateCard(modalIndex, {
                uuid: newUuid,
                name: newCard.name,
                imageUrls: newCard.imageUrls,
                isUserUpload: false,
              });

              // Keep the modal's reference in sync
              updateArtworkCard({
                uuid: newUuid,
                name: newCard.name,
                imageUrls: newCard.imageUrls,
                isUserUpload: false,
              });

              // Point original to first art
              appendOriginalSelectedImages({
                [newUuid]: newCard.imageUrls[0],
              });

              // NEW: seed the persisted cache with the proxied/origin URL
              appendCachedImageUrls({
                [newUuid]: getLocalBleedImageUrl(newCard.imageUrls[0]),
              });

              // Clear the processed image so the lazy processor can rebuild
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
                    className={`w-full cursor-pointer border-4 ${
                      originalSelectedImages[modalCard.uuid] === pngUrl
                        ? "border-green-500"
                        : "border-transparent"
                    }`}
                    onClick={async () => {
                      if (applyToAll) {
                        const newOriginalSelectedImages: Record<
                          string,
                          string
                        > = {};
                        const cachedUpdates: Record<string, string> = {};
                        const uuidsToClear: string[] = [];

                        // apply to every card with the same name
                        cards.forEach((card) => {
                          if (card.name === modalCard.name) {
                            newOriginalSelectedImages[card.uuid] = pngUrl;
                            cachedUpdates[card.uuid] =
                              getLocalBleedImageUrl(pngUrl);
                            uuidsToClear.push(card.uuid);
                          }
                        });

                        // update originals + cache, then clear processed images
                        appendOriginalSelectedImages(
                          newOriginalSelectedImages
                        );
                        appendCachedImageUrls(cachedUpdates);
                        clearManySelectedImages(uuidsToClear);

                        // optional: if you prefer to wipe any stale cache first
                        // clearCachedForMany(uuidsToClear); // then appendCachedImageUrls(...)
                      } else {
                        // single-card replace
                        appendOriginalSelectedImages({
                          [modalCard.uuid]: pngUrl,
                        });

                        // NEW: seed cache for this uuid
                        appendCachedImageUrls({
                          [modalCard.uuid]: getLocalBleedImageUrl(pngUrl),
                        });

                        // force the re-process for this card
                        clearSelectedImage(modalCard.uuid);

                        // optional: clear old cache entry first
                        // clearCachedForCard(modalCard.uuid);
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
