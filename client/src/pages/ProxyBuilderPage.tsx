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
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy
} from '@dnd-kit/sortable';
import SortableCard from "../components/SortableCard";
import LoadingOverlay from "../components/LoadingOverlay";
import EdgeCutLines from "../components/FullPageGuides";
import cardBack from "../assets/cardBack.png";
import { API_BASE } from "../constants";
import Donate from "../components/Donate";
import { cardKey, parseDeckToInfos, type CardInfo } from "../helpers/CardInfoHelper";

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
  const [originalSelectedImages, setOriginalSelectedImages] = useState<Record<string, string>>({});
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalCard, setModalCard] = useState<CardOption | null>(null);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [bleedEdge, setBleedEdge] = useState(true);
  const [bleedEdgeWidth, setBleedEdgeWidth] = useState(1);
  const [guideColor, setGuideColor] = useState("#39FF14");
  const [guideWidth, setGuideWidth] = useState(.5);
  const [isGettingMore, setIsGettingMore] = useState(false);
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    cardIndex: null as number | null,
  });
  const [zoom, setZoom] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTask, setLoadingTask] = useState<
    "Fetching cards" |
    "Processing Images" |
    "Generating PDF" |
    "Uploading Images" |
    "Clearing Images" |
    null>(null);
  const unit = "mm";
  const pageWidth = 8.5
  const pageHeight = 11;
  const pdfPageColor = "#FFFFFF";
  const bleedPixels = getBleedInPixels(bleedEdgeWidth, unit);
  const guideOffset = `${(bleedPixels * (25.4 / 300)).toFixed(3)}mm`;
  const pageRef = useRef<HTMLDivElement>(null);
  const baseCardWidthMm = 63.5;
  const baseCardHeightMm = 88.9;
  const totalCardWidth = baseCardWidthMm + bleedEdgeWidth * 2;
  const totalCardHeight = baseCardHeightMm + bleedEdgeWidth * 2;
  const gridWidthMm = totalCardWidth * 3;
  const gridHeightMm = totalCardHeight * 3;
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


  useEffect(() => {
    const handler = () => setContextMenu((prev) => ({ ...prev, visible: false }));
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  function duplicateCard(index: number) {
    const cardToCopy = cards[index];
    const newCard = { ...cardToCopy, uuid: crypto.randomUUID() };

    const newCards = [...cards];
    newCards.splice(index + 1, 0, newCard);
    setCards(newCards);

    const original = originalSelectedImages[cardToCopy.uuid];
    const processed = selectedImages[cardToCopy.uuid];

    setOriginalSelectedImages((prev) => ({
      ...prev,
      [newCard.uuid]: original,
    }));

    setSelectedImages((prev) => ({
      ...prev,
      [newCard.uuid]: processed,
    }));
  }

  function deleteCard(index: number) {
    const cardToRemove = cards[index];
    const cardUuid = cardToRemove.uuid;

    const newCards = cards.filter((_, i) => i !== index);

    const { [cardUuid]: _, ...newSelectedImages } = selectedImages;
    const { [cardUuid]: __, ...newOriginalSelectedImages } = originalSelectedImages;

    setCards(newCards);
    setSelectedImages(newSelectedImages);
    setOriginalSelectedImages(newOriginalSelectedImages);
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

  const reprocessSelectedImages = async (newBleedWidth: number) => {
    const updated: Record<string, string> = {};

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const uuid = card.uuid;

      if (card.isUserUpload) {
        const originalBase64 = originalSelectedImages[uuid];
        if (originalBase64) {
          const trimmed = await trimBleedEdge(originalBase64);
          const bleedImage = await addBleedEdge(trimmed, newBleedWidth);
          updated[uuid] = bleedImage;
        } else if (selectedImages[uuid]) {
          const bleedImage = await addBleedEdge(selectedImages[uuid], newBleedWidth);
          updated[uuid] = bleedImage;
        }
      } else if (originalSelectedImages[uuid]) {
        const proxiedUrl = getLocalBleedImageUrl(originalSelectedImages[uuid]);
        const bleedImage = await addBleedEdge(proxiedUrl, newBleedWidth);
        updated[uuid] = bleedImage;
      }
    }

    setSelectedImages(updated);
  };


  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setLoadingTask("Uploading Images");
    setIsLoading(true);

    const files = event.target.files;
    if (!files) return;

    const fileArray = Array.from(files);
    const currentIndex = cards.length;

    const newCards: CardOption[] = fileArray.map((_, i) => ({
      name: `Custom Art ${currentIndex + i + 1}`,
      imageUrls: [],
      uuid: crypto.randomUUID(),
      isUserUpload: true,
    }));

    setCards((prev) => [...prev, ...newCards]);

    // Process all uploads
    await Promise.all(
      fileArray.map((file, i) => {
        return new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = async () => {
            if (reader.result) {
              const base64 = reader.result as string;

              setOriginalSelectedImages((prev) => ({
                ...prev,
                [newCards[i].uuid]: base64
              }));

              const trimmed = await trimBleedEdge(base64);
              const withBleed = await addBleedEdge(trimmed, bleedEdgeWidth);

              setSelectedImages((prev) => ({
                ...prev,
                [newCards[i].uuid]: withBleed
              }));
            }
            resolve();
          };
          reader.readAsDataURL(file);
        });
      })
    );

    event.target.value = '';
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
    return `${API_BASE}/api/cards/images/proxy?url=${encodeURIComponent(originalUrl)}`;
  }

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
      const targetCardWidth = 750;
      const targetCardHeight = 1050;
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
            ctx.drawImage(scaledImg, 0, 0, slice, targetCardHeight, 0, bleed, bleed, targetCardHeight); // L
            ctx.drawImage(scaledImg, targetCardWidth - slice, 0, slice, targetCardHeight, targetCardWidth + bleed, bleed, bleed, targetCardHeight); // R
            ctx.drawImage(scaledImg, 0, 0, targetCardWidth, slice, bleed, 0, targetCardWidth, bleed); // T
            ctx.drawImage(scaledImg, 0, targetCardHeight - slice, targetCardWidth, slice, bleed, targetCardHeight + bleed, targetCardWidth, bleed); // B

            // Corners
            ctx.drawImage(scaledImg, 0, 0, slice, slice, 0, 0, bleed, bleed); // TL
            ctx.drawImage(scaledImg, targetCardWidth - slice, 0, slice, slice, targetCardWidth + bleed, 0, bleed, bleed); // TR
            ctx.drawImage(scaledImg, 0, targetCardHeight - slice, slice, slice, 0, targetCardHeight + bleed, bleed, bleed); // BL
            ctx.drawImage(scaledImg, targetCardWidth - slice, targetCardHeight - slice, slice, slice, targetCardWidth + bleed, targetCardHeight + bleed, bleed, bleed); // BR
          } else {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(scaledImg, 0, 0, bleed, targetCardHeight, -bleed, bleed, bleed, targetCardHeight);
            ctx.restore();

            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(scaledImg, targetCardWidth - bleed, 0, bleed, targetCardHeight, -(finalWidth), bleed, bleed, targetCardHeight);
            ctx.restore();

            ctx.save();
            ctx.scale(1, -1);
            ctx.drawImage(scaledImg, 0, 0, targetCardWidth, bleed, bleed, -bleed, targetCardWidth, bleed);
            ctx.restore();


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

  // 1) Parse deck text into infos (preserving quantities)
  const infos = parseDeckToInfos(deckText);

  // 2) Unique by (name|set|number) for the fetch
  const uniqueMap = new Map<string, CardInfo>();
  for (const ci of infos) uniqueMap.set(cardKey(ci), ci);
  const uniqueInfos = Array.from(uniqueMap.values());

  // For backward-compat servers that still expect only names
  const uniqueNames = Array.from(
    new Set(uniqueInfos.map((ci) => ci.name))
  );

  await axios.delete(`${API_BASE}/api/cards/images`);

  // 3) Prefer new shape { cardQueries }, but also include { cardNames }
  const response = await axios.post<CardOption[]>(
    `${API_BASE}/api/cards/images`,
    {
      // New: lets server lock onto exact art when set/number present
      cardQueries: uniqueInfos, // [{ name, set?, number? }, ...]
      // Old: servers can ignore cardQueries and just use this for now
      cardNames: uniqueNames,
      cardArt: "art",
    }
  );

  // 4) Build a lookup from response
  // If your server echoes set/number back on CardOption, use that for keying.
  // Fallback to name-only if not present.
  const optionByKey: Record<string, CardOption> = {};
  for (const opt of response.data) {
    const k =
      `${opt.name.toLowerCase()}|${(opt as any).set ?? ""}|${(opt as any).number ?? ""}`;
    optionByKey[k] = opt;
    // Also store by name-only as a fallback:
    const nameOnlyKey = `${opt.name.toLowerCase()}||`;
    if (!optionByKey[nameOnlyKey]) optionByKey[nameOnlyKey] = opt;
  }

  // 5) Expand back out to match quantities in original order
  const expandedCards: CardOption[] = infos.map((ci) => {
    const k = cardKey(ci);
    const fallbackK = `${ci.name.toLowerCase()}||`;
    const card = optionByKey[k] ?? optionByKey[fallbackK];
    return {
      ...card,
      uuid: crypto.randomUUID(),
    };
  });

  setCards((prev) => [...prev, ...expandedCards]);

  // 6) Originals + processing (unchanged)
  const newOriginals: Record<string, string> = {};
  for (const card of expandedCards) {
    if (card?.imageUrls?.length > 0) {
      newOriginals[card.uuid] = card.imageUrls[0];
    }
  }
  setOriginalSelectedImages((prev) => ({ ...prev, ...newOriginals }));

  setLoadingTask("Processing Images");

  const processed: Record<string, string> = {};
  for (const [uuid, url] of Object.entries(newOriginals)) {
    const proxiedUrl = getLocalBleedImageUrl(url);
    const bleedImage = await addBleedEdge(proxiedUrl);
    processed[uuid] = bleedImage;
  }

  setSelectedImages((prev) => ({ ...prev, ...processed }));
  setIsLoading(false);
  setLoadingTask(null);
  setDeckText("");
};

  const handleClear = async () => {
    setLoadingTask("Clearing Images");
    setIsLoading(true);
    await axios.delete(`${API_BASE}/api/cards/images`);
    setCards([]);
    setSelectedImages({});
    setOriginalSelectedImages({});
    setIsLoading(false);
    setLoadingTask(null);
  };

  async function getMoreCards() {
    if (!modalCard) return;
    setIsGettingMore(true);
    try {
      const res = await axios.post<CardOption[]>(
        `${API_BASE}/api/cards/images`,
        { cardNames: [modalCard.name], cardArt: "prints" }
      );

      const urls = res.data?.[0]?.imageUrls ?? [];
      setModalCard(prev => (prev ? { ...prev, imageUrls: urls } : prev));
    } finally {
      setIsGettingMore(false);
    }
  }

  function pngToNormal(pngUrl: string) {
    try {
      const u = new URL(pngUrl);
      u.pathname = u.pathname.replace("/png/", "/normal/").replace(/\.png$/i, ".jpg");
      return u.toString();
    } catch {
      return pngUrl; // fallback if anything looks odd
    }
  }

  async function urlToDataUrl(url: string): Promise<string> {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  const addCardBackPage = async () => {
    setLoadingTask("Uploading Images");
    setIsLoading(true);
    try {
      const base64 = await urlToDataUrl(cardBack);
      const trimmed = await trimBleedEdge(base64);
      const withBleed = await addBleedEdge(trimmed, bleedEdgeWidth);

      const newCards: CardOption[] = Array.from({ length: 9 }).map(() => ({
        uuid: crypto.randomUUID(),
        name: "Default Card Back",
        imageUrls: [],
        isUserUpload: true,
      }));

      setCards((prev) => [...prev, ...newCards]);

      setOriginalSelectedImages((prev) => {
        const next = { ...prev };
        for (const c of newCards) next[c.uuid] = base64;
        return next;
      });
      setSelectedImages((prev) => {
        const next = { ...prev };
        for (const c of newCards) next[c.uuid] = withBleed;
        return next;
      });
    } finally {
      setIsLoading(false);
      setLoadingTask(null);
    }
  };


  return (
    <>
      <h1 className="sr-only">Proxxied — MTG Proxy Builder and Print</h1>
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

                  const newCard = res.data[0]; // shape: { name, imageUrls }
                  if (!newCard.imageUrls?.length) return;

                  const newUuid = crypto.randomUUID();
                  const proxiedUrl = getLocalBleedImageUrl(newCard.imageUrls[0]);
                  const processed = await addBleedEdge(proxiedUrl);

                  setCards((prev) => {
                    const updated = [...prev];
                    updated[modalIndex] = {
                      uuid: newUuid,
                      name: newCard.name,
                      imageUrls: newCard.imageUrls,
                      isUserUpload: false,
                    };
                    return updated;
                  });

                  setModalCard({
                    uuid: newUuid,
                    name: newCard.name,
                    imageUrls: newCard.imageUrls,
                    isUserUpload: false,
                  });

                  setSelectedImages((prev) => ({ ...prev, [newUuid]: processed }));
                  setOriginalSelectedImages((prev) => ({ ...prev, [newUuid]: newCard.imageUrls[0] }));

                  setSearchQuery("");
                }}
              />

            </div>
            {modalCard && (
              <>
                <div className="grid grid-cols-3 md:grid-cols-3 gap-4">
                  {modalCard.imageUrls.map((pngUrl, i) => {
                    const thumbUrl = pngToNormal(pngUrl);
                    return (
                      <img
                        key={i}
                        src={thumbUrl}
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).src = pngUrl; }} // fallback
                        className={`w-full cursor-pointer border-4 ${originalSelectedImages[modalCard.uuid] === pngUrl ? "border-green-500" : "border-transparent"
                          }`}
                        onClick={async () => {
                          const proxiedUrl = getLocalBleedImageUrl(pngUrl);
                          const processed = await addBleedEdge(proxiedUrl);

                          setSelectedImages((prev) => ({
                            ...prev,
                            [modalCard.uuid]: processed,
                          }));

                          setOriginalSelectedImages((prev) => ({
                            ...prev,
                            [modalCard.uuid]: pngUrl,
                          }));

                          setIsModalOpen(false);
                        }}
                      />
                    );
                  })}
                </div>
                <Button
                  className="bg-blue-800 w-full"
                  onClick={getMoreCards}
                  disabled={isGettingMore}
                >
                  {isGettingMore ? "Loading prints..." : "Get All Prints"}
                </Button>
              </>
            )}
          </ModalBody>
        </Modal>

        <div className="w-1/5 p-4 space-y-4 dark:bg-gray-700 bg-gray-100 overflow-hidden">
          <img
            src={fullLogo}
            alt="Proxxied Logo" />

          <div className="space-y-2">
            <Label className="block text-gray-700 dark:text-gray-300">
              Upload Images (
              <a
                href="https://mpcfill.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-600 dark:hover:text-blue-400"
              >
                MPC Autofill
              </a>
              )
            </Label>
            <label
              htmlFor="custom-file-upload"
              className="inline-block w-full text-center cursor-pointer rounded-md bg-gray-300 dark:bg-gray-600 px-4 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-500" >
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
          <Label className="block text-gray-700 dark:text-gray-300">
            Add Cards (
            <a
              href="https://scryfall.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-600 dark:hover:text-blue-400"
            >
              Scryfall
            </a>
            )
          </Label>
          <Textarea
            className="h-64"
            placeholder={`1x Sol Ring
2x Counterspell
For specific art include set / CN
eg. Strionic Resonator (lcc)
or Repurposing Bay (dft) 380`}
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)} />
          <Button className="bg-blue-800 w-full" onClick={handleSubmit}>
            Fetch Cards
          </Button>
          <Button className="bg-red-700 hover:bg-red-700 w-full" onClick={handleClear}>
            Clear Cards
          </Button>
          <Label className="block text-gray-700 dark:text-gray-300">
            Tips:
          </Label>
          <Label className="block text-gray-700 dark:text-gray-300">
            To change a card art - click it
          </Label>
          <Label className="block text-gray-700 dark:text-gray-300">
            To move a card - drag from the box at the top right
          </Label>
          <Label className="block text-gray-700 dark:text-gray-300">
            To duplicate or delete a card - right click it
          </Label>
          <Button className="bg-purple-700 w-full mt-[2rem]" onClick={addCardBackPage}>
            Add Card Backs
          </Button>
        </div>

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
                  className="h-36 mt-[1rem]" />
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
                onMouseLeave={() => setContextMenu({ ...contextMenu, visible: false })} >
                <Button
                  className="bg-gray-400 hover:bg-gray-500 w-full"
                  onClick={() => {
                    duplicateCard(contextMenu.cardIndex!);
                    setContextMenu({ ...contextMenu, visible: false });
                  }} >
                  Duplicate
                </Button>
                <Button
                  className="bg-red-700 hover:bg-red-800 w-full"
                  onClick={() => {
                    deleteCard(contextMenu.cardIndex!);
                    setContextMenu({ ...contextMenu, visible: false });
                  }} >
                  Delete
                </Button>
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
                    reorderImageMap(cards, oldIndex, newIndex, originalSelectedImages)
                  );
                }
              }} >
              <SortableContext items={cards.map((card) => card.uuid)} strategy={rectSortingStrategy}>
                {chunkCards(cards, 9).map((page, pageIndex) => (
                  <div
                    key={pageIndex}
                    className="proxy-page relative bg-white dark:bg-gray-700"
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
                        const img = selectedImages[card.uuid];
                        const noImages =
                          !img &&
                          !(originalSelectedImages[card.uuid]) &&
                          (!(card.imageUrls && card.imageUrls.length));

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
                                setModalCard(card);
                                setModalIndex(globalIndex);
                                setIsModalOpen(true);
                              }}
                              className="flex items-center justify-center border-2 border-dashed border-red-500 bg-gray-50 text-center p-2 select-none"
                              style={{
                                boxSizing: "border-box",
                              }}
                              title={`"${card.name}" not found`}
                            >
                              <div>
                                <div className="font-semibold text-red-700">"{card.name}"</div>
                                <div className="text-xs text-gray-600">not found</div>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <SortableCard
                            key={globalIndex}
                            card={card}
                            index={index}
                            globalIndex={globalIndex}
                            imageSrc={img}
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
                    {bleedEdge && (
                      <EdgeCutLines
                        pageWidthIn={8.5}
                        pageHeightIn={11}
                        cols={3}
                        rows={3}
                        totalCardWidthMm={totalCardWidth}
                        totalCardHeightMm={totalCardHeight}
                        baseCardWidthMm={baseCardWidthMm}
                        baseCardHeightMm={baseCardHeightMm}
                        bleedEdgeWidthMm={bleedEdgeWidth}
                        guideWidthPx={guideWidth}
                      />
                    )}

                  </div>
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        <div className="w-1/4 min-w-[18rem] max-w-[26rem] p-4 bg-gray-100 dark:bg-gray-700 h-full flex flex-col overflow-y-auto">
          <Label className="text-lg font-semibold dark:text-gray-300">Settings</Label>

          <div className="space-y-4">
            <div>
              <Label>Bleed Edge ({unit})</Label>
              <TextInput
                className="w-full"
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
              <Label>Guides Width (px)</Label>
              <TextInput
                className="w-full"
                type="number"
                value={guideWidth}
                step="0.1"
                min="0"
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) setGuideWidth(val);
                }}
              />
            </div>

            <div>
              <Label>Zoom</Label>
              <div className="flex items-center gap-2 justify-between w-full">
                <Button size="xs" className="bg-gray-300 text-gray-900 w-full focus:ring-0"
                  onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>-</Button>
                <Label className="w-full text-center">{zoom.toFixed(1)}x</Label>
                <Button size="xs" className="bg-gray-300 text-gray-900 w-full focus:ring-0"
                  onClick={() => setZoom((z) => z + 0.1)}>+</Button>
              </div>
            </div>

            <Button className="bg-green-700 w-full" color="success" onClick={handleExport}>
              Export to PDF
            </Button>
          </div>

          <div className="mt-auto space-y-3 pt-4">
            <Donate username="Kaiser-Clipston-1" />
            <a
              href="https://github.com/kclipsto/proxies-at-home"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-md underline text-center text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400" >
              Code by Kaiser Clipston (Github)
            </a>
          </div>
        </div>
      </div>
    </>
  );
}