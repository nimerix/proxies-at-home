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
import { useRef, useState } from "react";
import { exportProxyPagesToPdf } from "../helpers/ExportProxyPageToPdf";

interface CardOption {
  uuid: string;
  name: string;
  imageUrls: string[];
}

export default function ProxyBuilderPage() {
  const [deckText, setDeckText] = useState("");
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
  const [guideWidth, setGuideWidth] = useState(1);
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

  const handleExport = () => {
    const pageElements = document.querySelectorAll('.proxy-page');
    exportProxyPagesToPdf(Array.from(pageElements) as HTMLElement[]);
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

    for (const [index, url] of Object.entries(originalSelectedImages)) { // <-- use original unmodified images
      const proxiedUrl = getLocalBleedImageUrl(url);
      const bleedImage = await addBleedEdge(proxiedUrl, newBleedWidth); // 👈 pass new bleed
      updated[Number(index)] = bleedImage;
    }

    setSelectedImages(updated);
  };


  const addBleedEdge = (src: string, bleedOverride?: number): Promise<string> => {
    return new Promise((resolve) => {
      const targetCardWidth = 745;
      const targetCardHeight = 1045;
      const bleed = Math.round(getBleedInPixels(bleedOverride ?? bleedEdgeWidth, unit));
      const finalWidth = targetCardWidth + bleed * 2;
      const finalHeight = targetCardHeight + bleed * 2;
      const blackThreshold = 20; // max RGB value to still consider "black"
      const blackToleranceRatio = 0.7; // how much of the edge must be black to switch modes

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      canvas.width = finalWidth;
      canvas.height = finalHeight;


      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        // === Step 1: Crop and scale to 745x1045 ===
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

        //Fill in rounded corners
        const cornerSize = 20;
        const sampleInset = 10; // how far inside to sample "nearby" color

        const averageColor = (x: number, y: number, w: number, h: number): string => {
          const data = tempCtx.getImageData(x, y, w, h).data;
          let r = 0, g = 0, b = 0, count = 0;

          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha === 0) continue; // skip transparent
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }

          if (count === 0) return "#000"; // fallback if fully transparent

          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);

          return `rgb(${r}, ${g}, ${b})`;
        };

        const fillIfLight = (r: number, g: number, b: number, a: number): boolean =>
          a === 0 || (r > 200 && g > 200 && b > 200);

        const cornerCoords = [
          { x: 0, y: 0 }, // top-left
          { x: temp.width - cornerSize, y: 0 }, // top-right
          { x: 0, y: temp.height - cornerSize }, // bottom-left
          { x: temp.width - cornerSize, y: temp.height - cornerSize }, // bottom-right
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
            // Sample average color just inside the corner
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

        // === Step 2: Analyze left edge for black pixels ===
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
          // === Draw center ===
          ctx.drawImage(scaledImg, bleed, bleed);

          if (isMostlyBlack) {
            // === REPLICATED BLEED ===
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
            // === MIRRORED BLEED ===

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

          resolve(canvas.toDataURL("image/jpeg"));
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

    const clearCache = await axios.delete("http://localhost:3001/api/cards/images");

    const response = await axios.post<CardOption[]>(
      "http://localhost:3001/api/cards/images",
      { cardNames: uniqueNames }
    );

    const nameToCard: Record<string, CardOption> = {};
    response.data.forEach((card) => {
      nameToCard[card.name] = card;
    });

    // Expand cards by count
    const expandedCards: CardOption[] = names.map((name) => {
      const card = nameToCard[name];
      return {
        ...card,
        uuid: crypto.randomUUID(),
      };
    });

    setCards(expandedCards);

    const defaultSelections: Record<number, string> = {};
    expandedCards.forEach((card, i) => {
      if (card.imageUrls.length > 0) {
        defaultSelections[i] = card.imageUrls[0];
      }
    });
    setOriginalSelectedImages(defaultSelections);

    const processed: Record<number, string> = {};
    for (const [index, url] of Object.entries(defaultSelections)) {
      const proxiedUrl = getLocalBleedImageUrl(url);
      const bleedImage = await addBleedEdge(proxiedUrl);
      processed[Number(index)] = bleedImage;
    }

    setSelectedImages(processed);
  };

  const handleSelectImage = (cardName: string, url: string) => {
    setSelectedImages((prev) => ({
      ...prev,
      [cardName]: url,
    }));
  };

  return (
    <div className="flex flex-row h-screen justify-between overflow-hidden">
      <Modal show={isModalOpen} onClose={() => setIsModalOpen(false)} size="4xl">
        <ModalHeader>Select Artwork</ModalHeader>
        <ModalBody>
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
                    const proxiedUrl = getLocalBleedImageUrl(url);
                    const processed = await addBleedEdge(proxiedUrl);
                    setSelectedImages((prev) => ({
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

      <div className="w-1/4 p-4 space-y-4 bg-gray-100 overflow-hidden">
        <h2 className="text-gray-900 text-lg font-semibold">Decklist</h2>
        <Textarea
          className="h-64"
          placeholder={`1x Sol Ring
2x Counterspell`}
          value={deckText}
          onChange={(e) => setDeckText(e.target.value)}
        />
        <Button className="bg-blue-800 w-full" onClick={handleSubmit}>
          Parse Decklist
        </Button>
      </div>

      <div className="w-1/2 flex-1 overflow-y-auto bg-gray-200 h-full p-6 flex justify-center">
        <div ref={pageRef} className="flex flex-col gap-[1rem]">
          {chunkCards(cards, 9).map((page, pageIndex) => (
            <div
              key={pageIndex}
              className="proxy-page relative bg-white"
              style={{
                zoom:'1.2',
                width: '8.5in',
                height: '11in',
                display: 'flex',
                flexShrink: 0,
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                breakAfter: 'page',
                padding: 0,
                margin: 0,
              }}
            >

              <div
                className="bg-gray-950"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(3, ${totalCardWidth}mm)`,
                  gridTemplateRows: `repeat(3, ${totalCardHeight}mm)`,
                  width: `${gridWidthMm}mm`,
                  height: `${gridHeightMm}mm`,
                  gap: 0
                }}
              >
                {page.map((card, index) => {
                  const globalIndex = pageIndex * 9 + index;
                  return (

                    <div
                      key={`${card.uuid}-${index}`}
                      className="bg-black relative"
                      style={{ width: '${totalCardWidth}mm', height: '${totalCardHeight}mm' }}
                    >
                      <img
                        src={selectedImages[globalIndex]}
                        alt={card.name}
                        className="cursor-pointer block w-full h-full p-0 m-0"
                        style={{ display: 'block', lineHeight: 0 }}
                        onClick={() => {
                          setModalCard(card);
                          setModalIndex(globalIndex);
                          setIsModalOpen(true);
                        }}
                      />

                      {bleedEdge && (
                        <>
                          {/* Top-left */}
                          <div style={{ position: 'absolute', top: guideOffset, left: guideOffset, width: `${guideWidth}px`, height: '4mm', backgroundColor: guideColor }} />
                          <div style={{ position: 'absolute', top: guideOffset, left: guideOffset, width: '4mm', height: `${guideWidth}px`, backgroundColor: guideColor }} />

                          {/* Top-right */}
                          <div style={{ position: 'absolute', top: guideOffset, right: guideOffset, width: `${guideWidth}px`, height: '4mm', backgroundColor: guideColor }} />
                          <div style={{ position: 'absolute', top: guideOffset, right: guideOffset, width: '4mm', height: `${guideWidth}px`, backgroundColor: guideColor }} />

                          {/* Bottom-left */}
                          <div style={{ position: 'absolute', bottom: guideOffset, left: guideOffset, width: `${guideWidth}px`, height: '4mm', backgroundColor: guideColor }} />
                          <div style={{ position: 'absolute', bottom: guideOffset, left: guideOffset, width: '4mm', height: `${guideWidth}px`, backgroundColor: guideColor }} />

                          {/* Bottom-right */}
                          <div style={{ position: 'absolute', bottom: guideOffset, right: guideOffset, width: `${guideWidth}px`, height: '4mm', backgroundColor: guideColor }} />
                          <div style={{ position: 'absolute', bottom: guideOffset, right: guideOffset, width: '4mm', height: `${guideWidth}px`, backgroundColor: guideColor }} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

      </div>

      <div className="w-1/4 p-4 space-y-4 bg-gray-100 overflow-hidden">
        <Label className="text-lg font-semibold">Settings</Label>

        <div>
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
        </div>

        <div>
          <Label>Columns</Label>
          <TextInput
            type="number"
            value={columns}
            onChange={(e) => setColumns(parseInt(e.target.value))}
          />
        </div>

        <div>
          <Label>Bleed Edge ({unit})</Label>
          <TextInput
            type="number"
            value={bleedEdgeWidth}
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
            type="number"
            value={guideWidth}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) setGuideWidth(val);
            }} />
        </div>

        <Button className="bg-green-700 w-full" color="success" onClick={handleExport}>
          Export to PDF
        </Button>
      </div>
    </div>
  );

}
