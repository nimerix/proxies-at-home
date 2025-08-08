import axios from "axios";
import {
  Button,
  Checkbox,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Textarea,
  TextInput
} from "flowbite-react";
import { useEffect, useRef, useState } from "react";
import { exportProxyPagesToPdf } from "../helpers/ExportProxyPageToPdf";
import fullLogo from '../assets/fullLogo.png';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import SortableCard from "../components/SortableCard";
import LoadingOverlay from "../components/LoadingOverlay";


export interface CardOption {
  uuid: string;
  name: string;
  imageUrls: string[];
  isUserUpload: boolean;
}

export default function ProxyBuilderPage() {
  const [deckText, setDeckText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [cards, setCards] = useState<CardOption[]>([]);
  const [originalSelectedImages, setOriginalSelectedImages] = useState<Record<number, string>>({});
  const [selectedImages, setSelectedImages] = useState<Record<number, string>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalCard, setModalCard] = useState<CardOption | null>(null);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [columns, setColumns] = useState(3);
  const [bleedEdge, setBleedEdge] = useState(true);
  const [bleedEdgeWidth, setBleedEdgeWidth] = useState(1);
  const [guideColor, setGuideColor] = useState("#FFFFFF");
  const [guideWidth, setGuideWidth] = useState(.5);
  const unit = "mm";
  const [pageWidth, setPageWidth] = useState(8.5);
  const [pageHeight, setPageHeight] = useState(11);
  const bleedPixels = getBleedInPixels(bleedEdgeWidth, unit);
  const guideOffset = `${(bleedPixels * (25.4 / 300)).toFixed(3)}mm`;
  const pageRef = useRef<HTMLDivElement>(null);
  const baseCardWidthMm = 63.5;
  const baseCardHeightMm = 88.9;
  const totalCardWidth = baseCardWidthMm + bleedEdgeWidth * 2;
  const totalCardHeight = baseCardHeightMm + bleedEdgeWidth * 2;
  const gridWidthMm = totalCardWidth * 3;
  const gridHeightMm = totalCardHeight * 3;
  const [pdfPageColor, setPdfPageColor] = useState("#FFFFFF");
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    cardIndex: null as number | null,
  });
  const [zoom, setZoom] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTask, setLoadingTask] = useState<"Fetching cards" | "Processing Images" | "Generating PDF" | null>(null);


  useEffect(() => {
    const handler = () => setContextMenu((prev) => ({ ...prev, visible: false }));
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  function duplicateCard(index: number) {
    const cardToCopy = cards[index];
    const newCard = { ...cardToCopy, uuid: crypto.randomUUID() };

    // Insert the new card
    const newCards = [...cards];
    newCards.splice(index + 1, 0, newCard);

    // Update selectedImages (shift all keys after index)
    const newSelectedImages: Record<number, string> = {};
    for (const [i, url] of Object.entries(selectedImages)) {
      const key = parseInt(i, 10);
      if (key <= index) {
        newSelectedImages[key] = url;
      } else {
        newSelectedImages[key + 1] = url;
      }
    }

    newSelectedImages[index + 1] = selectedImages[index];

    setCards(newCards);
    setSelectedImages(newSelectedImages);
  }

  function deleteCard(index: number) {
    const newCards = cards.filter((_, i) => i !== index);

    const newSelectedImages: Record<number, string> = {};
    for (const [i, url] of Object.entries(selectedImages)) {
      const key = parseInt(i, 10);
      if (key < index) {
        newSelectedImages[key] = url;
      } else if (key > index) {
        newSelectedImages[key - 1] = url;
      }
    }

    setCards(newCards);
    setSelectedImages(newSelectedImages);
  }


  const handleExport = async () => {
    setLoadingTask("Generating PDF");
    setIsLoading(true);
    await exportProxyPagesToPdf({
      cards,
      originalSelectedImages,
      bleedEdge,
      bleedEdgeWidthMm: bleedEdgeWidth,
      guideColor,
      guideWidthPx: guideWidth,
      pageWidthInches: pageWidth,
      pageHeightInches: pageHeight,
      pdfPageColor,
    });
    setIsLoading(false);
    setLoadingTask(null);
  };


  function chunkCards<T>(cards: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < cards.length; i += size) {
      chunks.push(cards.slice(i, i + size));
    }
    return chunks;
  }

  function getLocalBleedImageUrl(originalUrl: string): string {
    return `http://localhost:3001/api/cards/images/proxy?url=${encodeURIComponent(originalUrl)}`;
  }

  const reprocessSelectedImages = async (newBleedWidth: number) => {
    const updated: Record<number, string> = {};

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];

      if (card.isUserUpload) {
        const originalBase64 = originalSelectedImages[i];
        if (originalBase64) {
          const trimmed = await trimBleedEdge(originalBase64);
          const bleedImage = await addBleedEdge(trimmed, newBleedWidth);
          updated[i] = bleedImage;
        } else if (selectedImages[i]) {
          const bleedImage = await addBleedEdge(selectedImages[i], newBleedWidth);
          updated[i] = bleedImage;
        }
      }

      else if (originalSelectedImages[i]) {
        const proxiedUrl = getLocalBleedImageUrl(originalSelectedImages[i]);
        const bleedImage = await addBleedEdge(proxiedUrl, newBleedWidth);
        updated[i] = bleedImage;
      }
    }

    setSelectedImages(updated);
  };


  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const fileArray = Array.from(files);
    const currentIndex = cards.length;

    const newCards: CardOption[] = fileArray.map((file, i) => ({
      name: `Custom Art ${currentIndex + i + 1}`,
      imageUrls: [],
      uuid: crypto.randomUUID(),
      isUserUpload: true,
    }));

    setCards((prev) => [...prev, ...newCards]);

    fileArray.forEach((file, i) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        if (reader.result) {
          const base64 = reader.result as string;

          setOriginalSelectedImages((prev) => ({
            ...prev,
            [currentIndex + i]: base64,
          }));

          const trimmed = await trimBleedEdge(base64);
          const withBleed = await addBleedEdge(trimmed, bleedEdgeWidth);

          setSelectedImages((prev) => ({
            ...prev,
            [currentIndex + i]: withBleed,
          }));
        }
      };
      reader.readAsDataURL(file);
    });

    event.target.value = '';
  };

  function trimBleedEdge(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const bleedTrim = 72;
        const canvas = document.createElement("canvas");
        const width = img.width - bleedTrim * 2;
        const height = img.height - bleedTrim * 2;

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(
            img,
            bleedTrim,
            bleedTrim,
            width,
            height,
            0,
            0,
            width,
            height
          );
          resolve(canvas.toDataURL("image/png"));
        } else {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    });
  }

  function blackenAllNearBlackPixels(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    threshold: number,
    borderThickness = {
      top: 96,
      bottom: 400,
      left: 48,
      right: 48,
    }
  ) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inBorder =
          y < borderThickness.top ||
          y >= height - borderThickness.bottom ||
          x < borderThickness.left ||
          x >= width - borderThickness.right;

        if (!inBorder) continue;

        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];

        if (r < threshold && g < threshold && b < threshold) {
          data[index] = 0;
          data[index + 1] = 0;
          data[index + 2] = 0;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  const addBleedEdge = (src: string, bleedOverride?: number): Promise<string> => {
    return new Promise((resolve) => {
      const targetCardWidth = 745;
      const targetCardHeight = 1045;
      const bleed = Math.round(getBleedInPixels(bleedOverride ?? bleedEdgeWidth, unit));
      const finalWidth = targetCardWidth + bleed * 2;
      const finalHeight = targetCardHeight + bleed * 2;
      const blackThreshold = 30; // max RGB value to still consider "black"
      const blackToleranceRatio = 0.7; // how much of the edge must be black to switch modes

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      canvas.width = finalWidth;
      canvas.height = finalHeight;

      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        const aspectRatio = img.width / img.height;
        const targetAspect = targetCardWidth / targetCardHeight;

        let drawWidth = targetCardWidth;
        let drawHeight = targetCardHeight;
        let offsetX = 0;
        let offsetY = 0;

        if (aspectRatio > targetAspect) {
          drawHeight = targetCardHeight;
          drawWidth = img.width * (targetCardHeight / img.height);
          offsetX = (drawWidth - targetCardWidth) / 2;
        } else {
          drawWidth = targetCardWidth;
          drawHeight = img.height * (targetCardWidth / img.width);
          offsetY = (drawHeight - targetCardHeight) / 2;
        }

        const temp = document.createElement("canvas");
        temp.width = targetCardWidth;
        temp.height = targetCardHeight;
        const tempCtx = temp.getContext("2d")!;
        tempCtx.drawImage(img, -offsetX, -offsetY, drawWidth, drawHeight);

        const cornerSize = 30;
        const sampleInset = 10;

        const averageColor = (x: number, y: number, w: number, h: number): string => {
          const data = tempCtx.getImageData(x, y, w, h).data;
          let r = 0, g = 0, b = 0, count = 0;

          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha === 0) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }

          if (count === 0) return "#000";

          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);

          return `rgb(${r}, ${g}, ${b})`;
        };

        const fillIfLight = (r: number, g: number, b: number, a: number): boolean =>
          a === 0 || (r > 200 && g > 200 && b > 200);

        const cornerCoords = [
          { x: 0, y: 0 },
          { x: temp.width - cornerSize, y: 0 },
          { x: 0, y: temp.height - cornerSize },
          { x: temp.width - cornerSize, y: temp.height - cornerSize },
        ];

        cornerCoords.forEach(({ x, y }) => {
          const imageData = tempCtx.getImageData(x, y, cornerSize, cornerSize).data;
          let shouldFill = false;

          for (let i = 0; i < imageData.length; i += 4) {
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];
            const a = imageData[i + 3];
            if (fillIfLight(r, g, b, a)) {
              shouldFill = true;
              break;
            }
          }

          if (shouldFill) {
            const avgColor = averageColor(
              x < temp.width / 2 ? sampleInset : temp.width - sampleInset - 10,
              y < temp.height / 2 ? sampleInset : temp.height - sampleInset - 10,
              10,
              10
            );

            tempCtx.fillStyle = avgColor;
            tempCtx.fillRect(x, y, cornerSize, cornerSize);
          }
        });

        blackenAllNearBlackPixels(tempCtx, targetCardWidth, targetCardHeight, blackThreshold);

        const edgeData = tempCtx.getImageData(0, 0, 1, targetCardHeight).data;
        let blackCount = 0;

        for (let i = 0; i < targetCardHeight; i++) {
          const r = edgeData[i * 4];
          const g = edgeData[i * 4 + 1];
          const b = edgeData[i * 4 + 2];
          if (r < blackThreshold && g < blackThreshold && b < blackThreshold) {
            blackCount++;
          }
        }

        const isMostlyBlack = blackCount / targetCardHeight > blackToleranceRatio;

        const scaledImg = new Image();
        scaledImg.onload = () => {
          ctx.drawImage(scaledImg, bleed, bleed);

          if (isMostlyBlack) {
            const slice = 8;
            // Edges
            ctx.drawImage(scaledImg, 0, 0, slice, targetCardHeight, 0, bleed, bleed, targetCardHeight); // Left
            ctx.drawImage(scaledImg, targetCardWidth - slice, 0, slice, targetCardHeight, targetCardWidth + bleed, bleed, bleed, targetCardHeight); // Right
            ctx.drawImage(scaledImg, 0, 0, targetCardWidth, slice, bleed, 0, targetCardWidth, bleed); // Top
            ctx.drawImage(scaledImg, 0, targetCardHeight - slice, targetCardWidth, slice, bleed, targetCardHeight + bleed, targetCardWidth, bleed); // Bottom

            // Corners
            ctx.drawImage(scaledImg, 0, 0, slice, slice, 0, 0, bleed, bleed); // TL
            ctx.drawImage(scaledImg, targetCardWidth - slice, 0, slice, slice, targetCardWidth + bleed, 0, bleed, bleed); // TR
            ctx.drawImage(scaledImg, 0, targetCardHeight - slice, slice, slice, 0, targetCardHeight + bleed, bleed, bleed); // BL
            ctx.drawImage(scaledImg, targetCardWidth - slice, targetCardHeight - slice, slice, slice, targetCardWidth + bleed, targetCardHeight + bleed, bleed, bleed); // BR
          } else {

            // Left
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(scaledImg, 0, 0, bleed, targetCardHeight, -bleed, bleed, bleed, targetCardHeight);
            ctx.restore();

            // Right
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(scaledImg, targetCardWidth - bleed, 0, bleed, targetCardHeight, -(finalWidth), bleed, bleed, targetCardHeight);
            ctx.restore();

            // Top
            ctx.save();
            ctx.scale(1, -1);
            ctx.drawImage(scaledImg, 0, 0, targetCardWidth, bleed, bleed, -bleed, targetCardWidth, bleed);
            ctx.restore();

            // Bottom
            ctx.save();
            ctx.scale(1, -1);
            ctx.drawImage(scaledImg, 0, targetCardHeight - bleed, targetCardWidth, bleed, bleed, -(finalHeight), targetCardWidth, bleed);
            ctx.restore();

            // Corners
            ctx.save();
            ctx.scale(-1, -1);
            ctx.drawImage(scaledImg, 0, 0, bleed, bleed, -bleed, -bleed, bleed, bleed);
            ctx.restore();

            ctx.save();
            ctx.scale(-1, -1);
            ctx.drawImage(scaledImg, targetCardWidth - bleed, 0, bleed, bleed, -(finalWidth), -bleed, bleed, bleed);
            ctx.restore();

            ctx.save();
            ctx.scale(-1, -1);
            ctx.drawImage(scaledImg, 0, targetCardHeight - bleed, bleed, bleed, -bleed, -(finalHeight), bleed, bleed);
            ctx.restore();

            ctx.save();
            ctx.scale(-1, -1);
            ctx.drawImage(scaledImg, targetCardWidth - bleed, targetCardHeight - bleed, bleed, bleed, -(finalWidth), -(finalHeight), bleed, bleed);
            ctx.restore();
          }

          resolve(canvas.toDataURL("image/png"));
        };

        scaledImg.src = temp.toDataURL("image/png");
      };

      img.src = src;
    });
  };

  function getBleedInPixels(bleedEdgeWidth: number, unit: string): number {
    if (unit === "mm") {
      return (bleedEdgeWidth / 25.4) * 300;
    } else {
      return bleedEdgeWidth * 300;
    }
  }

  const handleSubmit = async () => {
    setLoadingTask("Fetching cards");
    setIsLoading(true);
    const names: string[] = [];

    deckText.split("\n").forEach((line) => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\d+)x?\s+(.*)/i);
      if (match) {
        const count = parseInt(match[1], 10);
        const cardName = match[2];
        for (let i = 0; i < count; i++) names.push(cardName);
      } else if (trimmed.length > 0) {
        names.push(trimmed);
      }
    });

    const uniqueNames = Array.from(new Set(names));

    await axios.delete("http://localhost:3001/api/cards/images");

    const response = await axios.post<CardOption[]>(
      "http://localhost:3001/api/cards/images",
      { cardNames: uniqueNames }
    );

    const nameToCard: Record<string, CardOption> = {};
    response.data.forEach((card) => {
      nameToCard[card.name] = card;
    });

    const expandedCards: CardOption[] = names.map((name) => {
      const card = nameToCard[name];
      return {
        ...card,
        uuid: crypto.randomUUID(),
      };
    });

    const startIndex = cards.length;
    setCards((prev) => [...prev, ...expandedCards]);

    const newOriginals: Record<number, string> = {};
    expandedCards.forEach((card, i) => {
      if (card.imageUrls.length > 0) {
        newOriginals[startIndex + i] = card.imageUrls[0];
      }
    });
    setOriginalSelectedImages((prev) => ({
      ...prev,
      ...newOriginals,
    }));

    setLoadingTask("Processing Images");

    const processed: Record<number, string> = {};
    for (const [indexStr, url] of Object.entries(newOriginals)) {
      const proxiedUrl = getLocalBleedImageUrl(url);
      const bleedImage = await addBleedEdge(proxiedUrl);
      processed[Number(indexStr)] = bleedImage;
    }

    setSelectedImages((prev) => ({
      ...prev,
      ...processed,
    }));
    setIsLoading(false);
    setLoadingTask(null);
    setDeckText("");
  };


  const handleSelectImage = (cardName: string, url: string) => {
    setSelectedImages((prev) => ({
      ...prev,
      [cardName]: url,
    }));
  };

  const handleClear = async () => {
    await axios.delete("http://localhost:3001/api/cards/images");
    setCards([]);
    setSelectedImages({});
    setOriginalSelectedImages({});
  };
  

  return (
    <>
      {isLoading && loadingTask && <LoadingOverlay task={loadingTask} />}
      <div className="flex flex-row h-screen justify-between overflow-hidden">
        <Modal show={isModalOpen} onClose={() => setIsModalOpen(false)} size="4xl">
          <ModalHeader>Select Artwork</ModalHeader>
          <ModalBody>
            <div className="mb-4">
              <TextInput
                type="text"
                placeholder="Replace with a different card..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && searchQuery.trim() && modalIndex !== null) {
                    const res = await axios.post<CardOption[]>(
                      "http://localhost:3001/api/cards/images",
                      { cardNames: [searchQuery.trim()] }
                    );

                    if (res.data.length > 0) {
                      const newCard = res.data[0];

                      setCards((prev) => {
                        const updated = [...prev];
                        updated[modalIndex] = {
                          uuid: newCard.uuid,
                          name: newCard.name,
                          imageUrls: newCard.imageUrls,
                          isUserUpload: false, // or true if user-uploaded?
                        };
                        return updated;
                      });

                      setModalCard({
                        uuid: newCard.uuid,
                        name: newCard.name,
                        imageUrls: newCard.imageUrls,
                        isUserUpload: false,
                      });

                      const proxiedUrl = getLocalBleedImageUrl(newCard.imageUrls[0]);
                      const processed = await addBleedEdge(proxiedUrl);

                      setSelectedImages((prev) => ({
                        ...prev,
                        [modalIndex]: processed,
                      }));

                      setOriginalSelectedImages((prev) => ({
                        ...prev,
                        [modalIndex]: newCard.imageUrls[0],
                      }));

                      setSearchQuery("");
                    }
                  }
                }}

              />
            </div>
            {modalCard && (
              <div className="grid grid-cols-3 md:grid-cols-3 gap-4">
                {modalCard.imageUrls.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`${modalCard.name} alt ${i}`}
                    className={`w-full cursor-pointer border-4 ${selectedImages[modalIndex!] === url ? "border-green-500" : "border-transparent"
                      }`}
                    onClick={async () => {
                      setOriginalSelectedImages(prev => ({
                        ...prev,
                        [modalIndex!]: url,
                      }));

                      const proxiedUrl = getLocalBleedImageUrl(url);
                      const processed = await addBleedEdge(proxiedUrl);
                      setSelectedImages(prev => ({
                        ...prev,
                        [modalIndex!]: processed,
                      }));

                      setIsModalOpen(false);
                    }}

                  />
                ))}
              </div>
            )}
          </ModalBody>
        </Modal>

        <div className="w-1/6 p-4 space-y-4 dark:bg-gray-700 bg-gray-100 overflow-hidden">
          <div className="bg-white rounded-xl ">
            <img
              src={fullLogo}
              alt="Proxxied Logo"
            />
          </div>

          <div className="space-y-2">
            <Label className="block text-gray-700 dark:text-gray-300">Upload Custom Images</Label>

            <label
              htmlFor="custom-file-upload"
              className="inline-block w-full text-center cursor-pointer rounded-md bg-gray-300 dark:bg-gray-600 px-4 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-500"
            >
              Choose Files
            </label>

            <input
              id="custom-file-upload"
              type="file"
              accept="image/*"
              multiple
              onChange={handleUpload}
              className="hidden"
            />
          </div>
          <Label className="block text-gray-700 dark:text-gray-300">Add Cards from Scryfall</Label>

          <Textarea
            className="h-64"
            placeholder={`1x Sol Ring
2x Counterspell`}
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
          />
          <Button className="bg-blue-800 w-full" onClick={handleSubmit}>
            Fetch Cards
          </Button>
          <Button className="bg-red-700 hover:bg-red-700 w-full" onClick={handleClear}>
  Clear Cards
</Button>
        </div>

        <div className="w-1/2 flex-1 overflow-y-auto bg-gray-200 h-full p-6 flex justify-center  dark:bg-gray-800 ">
          {cards.length === 0 ? (
            <div className="flex flex-col items-center">
              <div className="flex flex-row items-center">
                <Label className="text-7xl justify-center font-bold">
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
                className="absolute bg-white border border-gray-300 rounded shadow-md z-50 text-sm space-y-1"
                style={{
                  top: contextMenu.y,
                  left: contextMenu.x,
                  padding: "0.25rem",
                }}
                onMouseLeave={() => setContextMenu({ ...contextMenu, visible: false })}
              >
                <Button
                  className="bg-gray-400 hover:bg-gray-500 w-full"
                  onClick={() => {
                    duplicateCard(contextMenu.cardIndex!);
                    setContextMenu({ ...contextMenu, visible: false });
                  }}
                >
                  Duplicate
                </Button>
                <Button
                  className="bg-red-700 hover:bg-red-800 w-full"
                  onClick={() => {
                    deleteCard(contextMenu.cardIndex!);
                    setContextMenu({ ...contextMenu, visible: false });
                  }}
                >
                  Delete
                </Button>
              </div>
            )}
            <DndContext
              sensors={useSensors(useSensor(PointerSensor))}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                const { active, over } = event;
                if (over && active.id !== over.id) {
                  const oldIndex = Number(active.id);
                  const newIndex = Number(over.id);

                  const updated = arrayMove(cards, oldIndex, newIndex);
                  setCards(updated);

                  const reorderImageMap = (map: Record<number, string>) => {
                    const entries = cards.map((_, i) => map[i]); // Get old order
                    const newEntries = arrayMove(entries, oldIndex, newIndex); // Reorder
                    const newMap: Record<number, string> = {};
                    newEntries.forEach((img, i) => {
                      if (img) newMap[i] = img;
                    });
                    return newMap;
                  };

                  setSelectedImages(reorderImageMap(selectedImages));
                  setOriginalSelectedImages(reorderImageMap(originalSelectedImages));
                }
              }}
            >
              <SortableContext items={cards.map((_, i) => i)} strategy={rectSortingStrategy}>
                {chunkCards(cards, 9).map((page, pageIndex) => (
                  <div
                    key={pageIndex}
                    className="proxy-page relative bg-white"
                    style={{
                      zoom: zoom,
                      width: '8.5in',
                      height: '11in',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      breakAfter: 'page',
                      flexShrink: 0,
                      padding: 0,
                      margin: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(3, ${totalCardWidth}mm)`,
                        gridTemplateRows: `repeat(3, ${totalCardHeight}mm)`,
                        width: `${gridWidthMm}mm`,
                        height: `${gridHeightMm}mm`,
                        gap: 0,
                      }}
                    >
                      {page.map((card, index) => {
                        const globalIndex = pageIndex * 9 + index;
                        return (
                          <SortableCard
                            key={globalIndex}
                            card={card}
                            index={index}
                            globalIndex={globalIndex}
                            imageSrc={selectedImages[globalIndex]}
                            totalCardWidth={totalCardWidth}
                            totalCardHeight={totalCardHeight}
                            bleedEdge={bleedEdge}
                            guideOffset={guideOffset}
                            guideWidth={guideWidth}
                            guideColor={guideColor}
                            setContextMenu={setContextMenu}
                            setModalCard={setModalCard}
                            setModalIndex={setModalIndex}
                            setIsModalOpen={setIsModalOpen}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </SortableContext>
            </DndContext>

          </div>

        </div>
        <div className="w-1/4 p-4 space-y-4 bg-gray-100 overflow-hidden dark:bg-gray-700 ">
          <Label className="text-lg font-semibold dark:text-gray-300">Settings</Label>
          {/* <div>
          <Label>Page Width ({unit})</Label>
          <TextInput
            type="number"
            value={pageWidth}
            onChange={(e) => setPageWidth(parseFloat(e.target.value))}
          />
        </div>

        <div>
          <Label>Page Height ({unit})</Label>
          <TextInput
            type="number"
            value={pageHeight}
            onChange={(e) => setPageHeight(parseFloat(e.target.value))}
          />
        </div> */}

          {/* <div>
          <Label>Columns</Label>
          <TextInput
            type="number"
            value={columns}
            onChange={(e) => setColumns(parseInt(e.target.value))}
          />
        </div> */}
          <div>
            <Label>Bleed Edge ({unit})</Label>
            <TextInput
              type="number"
              value={bleedEdgeWidth}
              max={2}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) {
                  setBleedEdgeWidth(val);
                  reprocessSelectedImages(val);
                }
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="bleed-edge"
              checked={bleedEdge}
              onChange={(e) => setBleedEdge(e.target.checked)}
            />
            <Label htmlFor="bleed-edge">Enable Guide</Label>
          </div>

          <div>
            <Label>Guides Color</Label>
            <input
              type="color"
              value={guideColor}
              onChange={(e) => setGuideColor(e.target.value)}
              className="w-full h-10 p-0 border rounded"
            />
          </div>

          <div>
            <Label>Guides Width (mm)</Label>
            <TextInput
              type="number"
              value={guideWidth}
              step="0.1"
              min="0"
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) setGuideWidth(val);
              }} />
          </div>
          <div>
            <Label>Zoom</Label>
            <div className="flex items-center gap-2 jutify-space-between w-full">

              <Button size="xs" className="bg-gray-300 text-gray-900 w-full focus:ring-0" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>-</Button>
              <Label className="w-full text-center">{zoom.toFixed(1)}x</Label>

              <Button size="xs" className="bg-gray-300 text-gray-900 w-full focus:ring-0" onClick={() => setZoom((z) => z + 0.1)}>+</Button>
            </div>
          </div>

          <Button className="bg-green-700 w-full" color="success" onClick={handleExport}>
            Export to PDF
          </Button>
        </div>
      </div>
    </>
  );
}