import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable";
import { Button, Label, Modal, ModalBody, ModalHeader, Checkbox } from "flowbite-react";
import { Copy, Trash, Trash2, Plus, Minus, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import fullLogo from "../assets/fullLogo.png";
import CardCellLazy from "../components/CardCellLazy";
import EdgeCutLines from "../components/FullPageGuides";
import SortableCard from "../components/SortableCard";
import { getBleedInPixels } from "../helpers/ImageHelper";
import { useImageProcessing } from "../hooks/useImageProcessing";
import {
  useArtworkModalStore,
  useCardsStore,
  useSettingsStore,
} from "../store";
import type { CardOption } from "../types/Card";
import { ArtworkModal } from "./ArtworkModal";

type DeleteButtonsProps = {
  cardIndex: number;
  onDelete: (index: number) => void;
  onDeleteAll: (index: number) => void;
};

function DeleteButtons({ cardIndex, onDelete, onDeleteAll }: DeleteButtonsProps) {
  return (
    <div className="flex gap-1">
      <Button
        size="xs"
        color="red"
        onClick={() => onDelete(cardIndex)}
        className="flex-[2]"
      >
        <Trash className="size-3 mr-1" />
        Delete
      </Button>
      
      <Button
        size="xs"
        color="red"
        onClick={() => onDeleteAll(cardIndex)}
        className="flex-1"
      >
        <Trash className="size-3 mr-1" />
        All
      </Button>
    </div>
  );
}

const unit = "mm";
const baseCardWidthMm = 63;
const baseCardHeightMm = 88;

export function PageView() {
  const pageSizeUnit = useSettingsStore((state) => state.pageSizeUnit);
  const pageWidth = useSettingsStore((state) => state.pageWidth);
  const pageHeight = useSettingsStore((state) => state.pageHeight);
  const columns = useSettingsStore((state) => state.columns);
  const rows = useSettingsStore((state) => state.rows);
  const bleedEdgeWidth = useSettingsStore((state) => state.bleedEdgeWidth);
  const offsetX = useSettingsStore((state) => state.offsetX);
  const offsetY = useSettingsStore((state) => state.offsetY);
  const zoom = useSettingsStore((state) => state.zoom);

  const pageRef = useRef<HTMLDivElement>(null);
  const cards = useCardsStore((state) => state.cards);
  const selectedImages = useCardsStore((state) => state.selectedImages);
  const originalSelectedImages = useCardsStore(
    (state) => state.originalSelectedImages
  );
  const uploadedImages = useCardsStore((state) => state.uploadedImages);
  const uploadedOriginalImages = useCardsStore((state) => state.uploadedOriginalImages);
  const uploadedFiles = useCardsStore((state) => state.uploadedFiles);
  const openArtworkModal = useArtworkModalStore((state) => state.openModal);

  const setCards = useCardsStore((state) => state.setCards);
  const setSelectedImages = useCardsStore((state) => state.setSelectedImages);
  const setOriginalSelectedImages = useCardsStore(
    (state) => state.setOriginalSelectedImages
  );
  const appendSelectedImages = useCardsStore(
    (state) => state.appendSelectedImages
  );
  const appendOriginalSelectedImages = useCardsStore(
    (state) => state.appendOriginalSelectedImages
  );
  const appendUploadedImages = useCardsStore(
    (state) => state.appendUploadedImages
  );
  const appendUploadedOriginalImages = useCardsStore(
    (state) => state.appendUploadedOriginalImages
  );
  const appendUploadedFiles = useCardsStore(
    (state) => state.appendUploadedFiles
  );

  const bleedPixels = getBleedInPixels(bleedEdgeWidth, unit);
  const guideOffset = `${(bleedPixels * (25.4 / 300)).toFixed(3)}mm`;
  const totalCardWidth = baseCardWidthMm + bleedEdgeWidth * 2;
  const totalCardHeight = baseCardHeightMm + bleedEdgeWidth * 2;
  const gridWidthMm = totalCardWidth * columns;
  const gridHeightMm = totalCardHeight * rows;
  const pageCapacity = columns * rows;

  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    cardIndex: null as number | null,
    duplicateCount: 1,
  });

  const [deleteModal, setDeleteModal] = useState({
    open: false,
    cardIndex: null as number | null,
    sameName: false,
    sameArtwork: true,
  });

  useEffect(() => {
    const handler = () =>
      setContextMenu((prev) => ({ ...prev, visible: false, duplicateCount: 1 }));
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);


  function deleteCard(index: number) {
    const cardToRemove = cards[index];
    const cardUuid = cardToRemove.uuid;

    const newCards = cards.filter((_, i) => i !== index);

    const { [cardUuid]: _, ...newSelectedImages } = selectedImages;
    const { [cardUuid]: __, ...newOriginalSelectedImages } =
      originalSelectedImages;

    setCards(newCards);
    setSelectedImages(newSelectedImages);
    setOriginalSelectedImages(newOriginalSelectedImages);
  }

  function duplicateCardNTimes(index: number, count: number) {
    if (count <= 0) return;
    
    const cardToCopy = cards[index];
    const newCards = [...cards];
    const newOriginalImages: Record<string, string> = {};
    const newProcessedImages: Record<string, string> = {};
    const newUploadedImages: Record<string, string> = {};
    const newUploadedOriginalImages: Record<string, string> = {};
    const newUploadedFiles: Record<string, File> = {};

    const originalImage = originalSelectedImages[cardToCopy.uuid];
    const processedImage = selectedImages[cardToCopy.uuid];
    const uploadedImage = uploadedImages[cardToCopy.uuid];
    const uploadedOriginalImage = uploadedOriginalImages[cardToCopy.uuid];
    const uploadedFile = uploadedFiles[cardToCopy.uuid];

    for (let i = 0; i < count; i++) {
      const newCard = { ...cardToCopy, uuid: crypto.randomUUID() };
      newCards.splice(index + 1 + i, 0, newCard);

      if (originalImage) {
        newOriginalImages[newCard.uuid] = originalImage;
      }
      if (processedImage) {
        newProcessedImages[newCard.uuid] = processedImage;
      }

      if (uploadedImage) {
        newUploadedImages[newCard.uuid] = uploadedImage;
      }
      if (uploadedOriginalImage) {
        newUploadedOriginalImages[newCard.uuid] = uploadedOriginalImage;
      }
      if (uploadedFile) {
        newUploadedFiles[newCard.uuid] = uploadedFile;
      }
    }

    setCards(newCards);
    
    if (Object.keys(newOriginalImages).length > 0) {
      appendOriginalSelectedImages(newOriginalImages);
    }
    if (Object.keys(newProcessedImages).length > 0) {
      appendSelectedImages(newProcessedImages);
    }
    if (Object.keys(newUploadedImages).length > 0) {
      appendUploadedImages(newUploadedImages);
    }
    if (Object.keys(newUploadedOriginalImages).length > 0) {
      appendUploadedOriginalImages(newUploadedOriginalImages);
    }
    if (Object.keys(newUploadedFiles).length > 0) {
      appendUploadedFiles(newUploadedFiles);
    }
  }

  function deleteCardsByName(index: number, sameArtworkOnly: boolean) {
    const targetCard = cards[index];
    const targetArtwork = originalSelectedImages[targetCard.uuid];

    const uuidsToRemove: string[] = [];
    const newCards = cards.filter((card) => {
      if (card.name === targetCard.name) {
        if (sameArtworkOnly) {
          const cardArtwork = originalSelectedImages[card.uuid];
          if (cardArtwork === targetArtwork) {
            uuidsToRemove.push(card.uuid);
            return false;
          }
        } else {
          uuidsToRemove.push(card.uuid);
          return false;
        }
      }
      return true;
    });

    // Clean up image maps
    const newSelectedImages = { ...selectedImages };
    const newOriginalSelectedImages = { ...originalSelectedImages };
    
    uuidsToRemove.forEach(uuid => {
      delete newSelectedImages[uuid];
      delete newOriginalSelectedImages[uuid];
    });

    setCards(newCards);
    setSelectedImages(newSelectedImages);
    setOriginalSelectedImages(newOriginalSelectedImages);
  }

  const reorderImageMap = (
    cards: CardOption[],
    oldIndex: number,
    newIndex: number,
    map: Record<string, string>
  ) => {
    const uuids = cards.map((c) => c.uuid);
    const reorderedUuids = arrayMove(uuids, oldIndex, newIndex);

    const newMap: Record<string, string> = {};
    reorderedUuids.forEach((uuid) => {
      if (map[uuid]) {
        newMap[uuid] = map[uuid];
      }
    });

    return newMap;
  };

  function chunkCards<T>(cards: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < cards.length; i += size) {
      chunks.push(cards.slice(i, i + size));
    }
    return chunks;
  }

  const { loadingMap, ensureProcessed } = useImageProcessing({
    unit, // "mm" | "in"
    bleedEdgeWidth, // number
  });

  return (
    <div className="w-1/2 flex-1 overflow-y-auto bg-gray-200 h-full p-6 flex justify-center dark:bg-gray-800 ">
      {cards.length === 0 ? (
        <div className="flex flex-col items-center">
          <div className="flex flex-row items-center">
            <Label className="text-7xl justify-center font-bold whitespace-nowrap">
              Welcome to
            </Label>
            <img
              src={fullLogo}
              alt="Proxxied Logo"
              className="h-36 mt-[1rem]"
            />
          </div>
          <Label className="text-xl text-gray-600 justify-center">
            Enter a decklist to the left or Upload Files to get started
          </Label>
        </div>
      ) : null}

      <div ref={pageRef} className="flex flex-col gap-[1rem]">
        {contextMenu.visible && contextMenu.cardIndex !== null && (
          <div
            className="absolute bg-white border rounded-xl border-gray-300 shadow-md z-50 text-sm flex flex-col gap-1 dark:bg-gray-700"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
              padding: "0.25rem",
            }}
          >
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                onClick={() => {
                  duplicateCardNTimes(contextMenu.cardIndex!, contextMenu.duplicateCount);
                  setContextMenu({ ...contextMenu, visible: false });
                }}
                className="flex-1"
              >
                <Copy className="size-3 mr-1" />
                Duplicate
              </Button>
              <div className="flex items-center gap-0.5">
                <Button
                  size="xs"
                  color="gray"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(prev => ({
                      ...prev,
                      duplicateCount: Math.max(1, prev.duplicateCount - 1)
                    }));
                  }}
                  className="p-1 min-w-0"
                  disabled={contextMenu.duplicateCount <= 1}
                >
                  <Minus className="size-3" />
                </Button>
                <span className="text-xs font-medium px-1 min-w-[20px] text-center dark:text-gray-200">
                  {contextMenu.duplicateCount}
                </span>
                <Button
                  size="xs"
                  color="gray"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(prev => ({
                      ...prev,
                      duplicateCount: Math.min(100, prev.duplicateCount + 1)
                    }));
                  }}
                  className="p-1 min-w-0"
                >
                  <Plus className="size-3" />
                </Button>
              </div>
            </div>
            
            <DeleteButtons
              cardIndex={contextMenu.cardIndex!}
              onDelete={(index) => {
                deleteCard(index);
                setContextMenu({ ...contextMenu, visible: false });
              }}
              onDeleteAll={(index) => {
                setDeleteModal({
                  open: true,
                  cardIndex: index,
                  sameName: true,
                  sameArtwork: true,
                });
                setContextMenu({ ...contextMenu, visible: false });
              }}
            />
          </div>
        )}

        <DndContext
          sensors={useSensors(useSensor(PointerSensor))}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (over && active.id !== over.id) {
              const oldIndex = cards.findIndex((c) => c.uuid === active.id);
              const newIndex = cards.findIndex((c) => c.uuid === over.id);
              if (oldIndex === -1 || newIndex === -1) return;

              const updatedCards = arrayMove(cards, oldIndex, newIndex);
              setCards(updatedCards);

              setSelectedImages(
                reorderImageMap(cards, oldIndex, newIndex, selectedImages)
              );
              setOriginalSelectedImages(
                reorderImageMap(
                  cards,
                  oldIndex,
                  newIndex,
                  originalSelectedImages
                )
              );
            }
          }}
        >
          <SortableContext
            items={cards.map((card) => card.uuid)}
            strategy={rectSortingStrategy}
          >
            {chunkCards(cards, pageCapacity).map((page, pageIndex) => (
              <div
                key={pageIndex}
                className="proxy-page relative bg-white dark:bg-gray-700"
                style={{
                  zoom: zoom,
                  width: `${pageWidth}${pageSizeUnit}`,
                  height: `${pageHeight}${pageSizeUnit}`,
                  position: "relative",
                  breakAfter: "page",
                  flexShrink: 0,
                  padding: 0,
                  margin: 0,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, ${totalCardWidth}mm)`,
                    gridTemplateRows: `repeat(${rows}, ${totalCardHeight}mm)`,
                    width: `${gridWidthMm}mm`,
                    height: `${gridHeightMm}mm`,
                    gap: 0,
                    position: "absolute",
                    left: `calc(50% - ${gridWidthMm/2}mm + ${offsetX}mm)`,
                    top: `calc(50% - ${gridHeightMm/2}mm + ${offsetY}mm)`,
                  }}
                >
                  {page.map((card, index) => {
                    const globalIndex = pageIndex * 9 + index;
                    const img = selectedImages[card.uuid];
                    const noImages =
                      !img &&
                      !originalSelectedImages[card.uuid] &&
                      !(card.imageUrls && card.imageUrls.length);

                    if (noImages) {
                      return (
                        <div
                          key={globalIndex}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({
                              visible: true,
                              x: e.clientX,
                              y: e.clientY,
                              cardIndex: globalIndex,
                              duplicateCount: 1,
                            });
                          }}
                          onClick={() => {
                            openArtworkModal({
                              card,
                              index: globalIndex,
                            });
                          }}
                          className="flex items-center justify-center border-2 border-dashed border-red-500 bg-gray-50 text-center p-2 select-none"
                          style={{
                            boxSizing: "border-box",
                          }}
                          title={`"${card.name}" not found`}
                        >
                          <div>
                            <div className="font-semibold text-red-700">
                              "{card.name}"
                            </div>
                            <div className="text-xs text-gray-600">
                              not found
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <CardCellLazy
                        key={globalIndex}
                        card={card}
                        state={loadingMap[card.uuid] ?? "idle"}
                        hasImage={!!selectedImages[card.uuid]}
                        ensureProcessed={ensureProcessed}
                      >
                        <SortableCard
                          key={globalIndex}
                          card={card}
                          index={index}
                          globalIndex={globalIndex}
                          imageSrc={img}
                          totalCardWidth={totalCardWidth}
                          totalCardHeight={totalCardHeight}
                          guideOffset={guideOffset}
                          setContextMenu={setContextMenu}
                        />
                      </CardCellLazy>
                    );
                  })}
                </div>

                <EdgeCutLines
                  totalCardWidthMm={totalCardWidth}
                  totalCardHeightMm={totalCardHeight}
                  baseCardWidthMm={baseCardWidthMm}
                  baseCardHeightMm={baseCardHeightMm}
                  bleedEdgeWidthMm={bleedEdgeWidth}
                  offsetX={offsetX}
                  offsetY={offsetY}
                />
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <ArtworkModal />

      <Modal show={deleteModal.open} onClose={() => setDeleteModal(prev => ({ ...prev, open: false }))}>
        <ModalHeader>Delete Cards</ModalHeader>
        <ModalBody>
          {deleteModal.cardIndex !== null && (
            <div className="space-y-4">
              <div>
                <p className="text-gray-700 dark:text-gray-300">
                  Delete all cards named "{cards[deleteModal.cardIndex]?.name}"?
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="same-artwork"
                  checked={deleteModal.sameArtwork}
                  onChange={(e) => setDeleteModal(prev => ({ ...prev, sameArtwork: e.target.checked }))}
                />
                <Label htmlFor="same-artwork">
                  Only delete cards with the same artwork
                </Label>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {deleteModal.sameArtwork 
                  ? `This will delete cards with the same name and artwork selection.`
                  : `This will delete ALL cards named "${cards[deleteModal.cardIndex]?.name}" regardless of artwork.`
                }
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  color="gray"
                  onClick={() => setDeleteModal(prev => ({ ...prev, open: false }))}
                >
                  Cancel
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    if (deleteModal.cardIndex !== null) {
                      deleteCardsByName(deleteModal.cardIndex, deleteModal.sameArtwork);
                    }
                    setDeleteModal(prev => ({ ...prev, open: false }));
                  }}
                >
                  <Trash2 className="size-4 mr-1" />
                  Delete Cards
                </Button>
              </div>
            </div>
          )}
        </ModalBody>
      </Modal>
    </div>
  );
}
