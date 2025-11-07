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
import { Button, Label } from "flowbite-react";
import { Copy, Trash } from "lucide-react";
import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import fullLogo from "../assets/fullLogo.png";
import CardCellLazy from "../components/CardCellLazy";
import EdgeCutLines from "../components/FullPageGuides";
import SortableCard from "../components/SortableCard";
import {
  addBleedEdgeSmartly,
  getBleedInPixels,
  isUploadedFileToken,
  makeUploadedFileToken,
  urlToDataUrl,
} from "../helpers/ImageHelper";
import { useImageProcessing } from "../hooks/useImageProcessing";
import { usePageViewState } from "../hooks/usePageViewState";
import type { CardOption } from "../types/Card";

const ArtworkModal = lazy(() => import("./ArtworkModal").then(module => ({ default: module.ArtworkModal })));

const unit = "mm";
const baseCardWidthMm = 63;
const baseCardHeightMm = 88;

export function PageView() {
  const { settings, cardsState, cardsActions, openArtworkModal } = usePageViewState();
  const {
    pageSizeUnit,
    pageWidth,
    pageHeight,
    columns,
    rows,
    bleedEdgeWidth,
    zoom,
    cardSpacingMm,
    viewMode,
    setViewMode,
    customCardbackUrl,
    customCardbackHasBleed,
    disableBackPageGuides
  } = settings;
  const { cards, selectedImages, selectedBackFaceImages, originalSelectedImages, uploadedFiles } = cardsState;
  const {
    setCards,
    setSelectedImages,
    setOriginalSelectedImages,
    appendSelectedImages,
    appendOriginalSelectedImages,
    appendUploadedFiles,
  } = cardsActions;

  const pageRef = useRef<HTMLDivElement>(null);

  const bleedPixels = getBleedInPixels(bleedEdgeWidth, unit);
  const guideOffset = `${(bleedPixels * (25.4 / 300)).toFixed(3)}mm`;
  const totalCardWidth = baseCardWidthMm + bleedEdgeWidth * 2;
  const totalCardHeight = baseCardHeightMm + bleedEdgeWidth * 2;
  const pageCapacity = columns * rows;

  const gridWidthMm =
    totalCardWidth * columns + Math.max(0, columns - 1) * cardSpacingMm;
  const gridHeightMm =
    totalCardHeight * rows + Math.max(0, rows - 1) * cardSpacingMm;

  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    cardIndex: null as number | null,
  });

  useEffect(() => {
    const handler = () =>
      setContextMenu((prev) => ({ ...prev, visible: false }));
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  const duplicateCard = useCallback((index: number) => {
    const cardToCopy = cards[index];
    if (!cardToCopy) return;

    const newUuid = crypto.randomUUID();
    const newCard = { ...cardToCopy, uuid: newUuid };

    const newCards = [...cards];
    newCards.splice(index + 1, 0, newCard);
    setCards(newCards);

    const original = originalSelectedImages[cardToCopy.uuid];
    if (original) {
      appendOriginalSelectedImages({
        [newUuid]: isUploadedFileToken(original)
          ? makeUploadedFileToken(newUuid)
          : original,
      });
    }

    const processed = selectedImages[cardToCopy.uuid];
    if (processed) {
      appendSelectedImages({
        [newUuid]: processed,
      });
    }

    if (original && isUploadedFileToken(original)) {
      const file = uploadedFiles[cardToCopy.uuid];
      if (file) {
        appendUploadedFiles({ [newUuid]: file });
      }
    }
  }, [cards, setCards, originalSelectedImages, appendOriginalSelectedImages, selectedImages, appendSelectedImages, uploadedFiles, appendUploadedFiles]);

  const deleteCard = useCallback((index: number) => {
    const cardToRemove = cards[index];
    const cardUuid = cardToRemove.uuid;

    const newCards = cards.filter((_: CardOption, i: number) => i !== index);

    const { [cardUuid]: _, ...newSelectedImages } = selectedImages;
    const { [cardUuid]: __, ...newOriginalSelectedImages } =
      originalSelectedImages;

    setCards(newCards);
    setSelectedImages(newSelectedImages);
    setOriginalSelectedImages(newOriginalSelectedImages);
  }, [cards, selectedImages, originalSelectedImages, setCards, setSelectedImages, setOriginalSelectedImages]);

  const reorderImageMap = useCallback((
    cards: CardOption[],
    oldIndex: number,
    newIndex: number,
    map: Record<string, string>
  ) => {
    const uuids = cards.map((c: CardOption) => c.uuid);
    const reorderedUuids = arrayMove(uuids, oldIndex, newIndex);

    const newMap: Record<string, string> = {};
    reorderedUuids.forEach((uuid) => {
      if (map[uuid]) {
        newMap[uuid] = map[uuid];
      }
    });

    return newMap;
  }, []);

  function chunkCards<T>(cards: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < cards.length; i += size) {
      chunks.push(cards.slice(i, i + size));
    }
    return chunks;
  }

  const { loadingMap, ensureProcessed, ensureBackFaceProcessed } = useImageProcessing({
    unit, // "mm" | "in"
    bleedEdgeWidth, // number
  });

  // Process custom cardback to add bleed if needed
  const [processedCardbackUrl, setProcessedCardbackUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let blobUrlToRevoke: string | null = null;

    if (!customCardbackUrl) {
      setProcessedCardbackUrl(null);
      return;
    }

    if (customCardbackHasBleed) {
      // Use as-is if it already has bleed
      setProcessedCardbackUrl(customCardbackUrl);
      return;
    }

    // Process the cardback to add bleed
    (async () => {
      try {
        const resolvedSrc = await urlToDataUrl(customCardbackUrl);
        if (cancelled) return;

        const processedUrl = await addBleedEdgeSmartly(resolvedSrc, bleedEdgeWidth, {
          unit,
          bleedEdgeWidth,
          hasBakedBleed: false,
        });

        if (cancelled) {
          if (processedUrl) URL.revokeObjectURL(processedUrl);
          return;
        }

        blobUrlToRevoke = processedUrl;
        setProcessedCardbackUrl(processedUrl);
      } catch (err) {
        console.error("Failed to process custom cardback:", err);
        setProcessedCardbackUrl(customCardbackUrl); // Fallback to original
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlToRevoke) {
        URL.revokeObjectURL(blobUrlToRevoke);
      }
    };
  }, [customCardbackUrl, customCardbackHasBleed, bleedEdgeWidth, unit]);

  return (
    <div className="w-1/2 flex-1 overflow-y-auto bg-gray-200 h-full p-6 flex flex-col items-center dark:bg-gray-800 ">
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

      {cards.length > 0 && (
        <div className="mb-4 flex gap-2">
          <Button
            size="sm"
            color={viewMode === "front" ? "blue" : "gray"}
            onClick={() => setViewMode("front")}
          >
            Front View
          </Button>
          <Button
            size="sm"
            color={viewMode === "back" ? "blue" : "gray"}
            onClick={() => setViewMode("back")}
          >
            Back View
          </Button>
        </div>
      )}

      <div ref={pageRef} className="flex flex-col gap-[1rem]">
        {contextMenu.visible && contextMenu.cardIndex !== null && (
          <div
            className="absolute bg-white border rounded-xl border-gray-300 shadow-md z-50 text-sm flex flex-col gap-1"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
              padding: "0.25rem",
            }}
            onMouseLeave={() =>
              setContextMenu({ ...contextMenu, visible: false })
            }
          >
            <Button
              size="xs"
              onClick={() => {
                duplicateCard(contextMenu.cardIndex!);
                setContextMenu({ ...contextMenu, visible: false });
              }}
            >
              <Copy className="size-3 mr-1" />
              Duplicate
            </Button>
            <Button
              size="xs"
              color="red"
              onClick={() => {
                deleteCard(contextMenu.cardIndex!);
                setContextMenu({ ...contextMenu, visible: false });
              }}
            >
              <Trash className="size-3 mr-1" />
              Delete
            </Button>
          </div>
        )}

        <DndContext
          sensors={useSensors(
            useSensor(PointerSensor, {
              activationConstraint: {
                distance: 8,
              },
            })
          )}
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
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
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
                    gap: `${cardSpacingMm}mm`,
                  }}
                >
                  {page.map((card, index) => {
                    const globalIndex = pageIndex * 9 + index;

                    // Determine which image to show based on view mode
                    let img: string | undefined = selectedImages[card.uuid];
                    const hasBackFace = card.faces && card.faces.length > 1 && card.faces[1]?.imageUrl;

                    if (viewMode === "back") {
                      if (hasBackFace) {
                        // Use the processed back face image
                        img = selectedBackFaceImages[card.uuid];
                      } else {
                        // Single-faced card in back view - don't show front image, let SortableCard show cardback
                        img = undefined;
                      }
                    }

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
                        hasImage={!!img || (viewMode === "back" && !hasBackFace)}
                        ensureProcessed={viewMode === "back" && hasBackFace ? ensureBackFaceProcessed : ensureProcessed}
                      >
                        <SortableCard
                          key={globalIndex}
                          card={card}
                          index={index}
                          globalIndex={globalIndex}
                          imageSrc={img || ""}
                          totalCardWidth={totalCardWidth}
                          totalCardHeight={totalCardHeight}
                          guideOffset={guideOffset}
                          setContextMenu={setContextMenu}
                          viewMode={viewMode}
                          customCardbackUrl={processedCardbackUrl || customCardbackUrl}
                          customCardbackHasBleed={customCardbackHasBleed}
                          disableBackPageGuides={disableBackPageGuides}
                        />
                      </CardCellLazy>
                    );
                  })}
                </div>

                {!(viewMode === "back" && disableBackPageGuides) && (
                  <EdgeCutLines
                    totalCardWidthMm={totalCardWidth}
                    totalCardHeightMm={totalCardHeight}
                    baseCardWidthMm={baseCardWidthMm}
                    baseCardHeightMm={baseCardHeightMm}
                    bleedEdgeWidthMm={bleedEdgeWidth}
                  />
                )}
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <Suspense fallback={null}>
        <ArtworkModal />
      </Suspense>
    </div>
  );
}
