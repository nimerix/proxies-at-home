import axios from "axios";
import {
  Button,
  Checkbox,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Textarea,
  TextInput,
} from "flowbite-react";
import { useEffect, useRef, useState } from "react";
import { exportProxyPagesToPdf } from "../helpers/ExportProxyPageToPdf";
import fullLogo from "../assets/fullLogo.png";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import SortableCard from "../components/SortableCard";
import LoadingOverlay from "../components/LoadingOverlay";
import EdgeCutLines from "../components/FullPageGuides";
import cardBack from "../assets/cardBack.png";
import { API_BASE } from "../constants";
import Donate from "../components/Donate";
import {
  cardKey,
  parseDeckToInfos,
  type CardInfo,
} from "../helpers/CardInfoHelper";
import { buildDecklist, downloadDecklist } from "../helpers/DecklistHelper";
import { ExportImagesZip } from "../helpers/ExportImagesZip";
import type { CardOption } from "../types/Card";
import {
  addBleedEdge,
  getBleedInPixels,
  getLocalBleedImageUrl,
  pngToNormal,
  trimBleedEdge,
  urlToDataUrl,
} from "../helpers/ImageHelper";
import {
  getMpcImageUrl,
  inferCardNameFromFilename,
  parseMpcText,
  tryParseMpcSchemaXml,
} from "../helpers/Mpc";
import CardCellLazy from "../components/CardCellLazy";
import { useImageProcessing } from "../hooks/useImageProcessing";

export default function ProxyBuilderPage() {
  const [deckText, setDeckText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [cards, setCards] = useState<CardOption[]>([]);
  const [originalSelectedImages, setOriginalSelectedImages] = useState<
    Record<string, string>
  >({});
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>(
    {}
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalCard, setModalCard] = useState<CardOption | null>(null);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [bleedEdge, setBleedEdge] = useState(true);
  const [bleedEdgeWidth, setBleedEdgeWidth] = useState(1);
  const [guideColor, setGuideColor] = useState("#39FF14");
  const [guideWidth, setGuideWidth] = useState(0.5);
  const [isGettingMore, setIsGettingMore] = useState(false);
  const [pageWidthIn, setPageWidthIn] = useState(8.5);
  const [pageHeightIn, setPageHeightIn] = useState(11);
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    cardIndex: null as number | null,
  });
  const [zoom, setZoom] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTask, setLoadingTask] = useState<
    | "Fetching cards"
    | "Processing Images"
    | "Generating PDF"
    | "Uploading Images"
    | "Clearing Images"
    | null
  >(null);
  const unit = "mm";
  const pdfPageColor = "#FFFFFF";
  const bleedPixels = getBleedInPixels(bleedEdgeWidth, unit);
  const guideOffset = `${(bleedPixels * (25.4 / 300)).toFixed(3)}mm`;
  const pageRef = useRef<HTMLDivElement>(null);
  const baseCardWidthMm = 63.5;
  const baseCardHeightMm = 88.9;
  const totalCardWidth = baseCardWidthMm + bleedEdgeWidth * 2;
  const totalCardHeight = baseCardHeightMm + bleedEdgeWidth * 2;
  const gridWidthMm = totalCardWidth * cols;
  const gridHeightMm = totalCardHeight * rows;
  const pageCapacity = cols * rows;
  const { loadingMap, ensureProcessed, reprocessSelectedImages } =
    useImageProcessing({
      unit, 
      bleedEdgeWidth,
      selectedImages,
      setSelectedImages,
      originalSelectedImages,
      setOriginalSelectedImages,
    });
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
    const handler = () =>
      setContextMenu((prev) => ({ ...prev, visible: false }));
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
    const { [cardUuid]: __, ...newOriginalSelectedImages } =
      originalSelectedImages;

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
      pageWidthInches: pageWidthIn,
      pageHeightInches: pageHeightIn,
      pdfPageColor,
      cols,
      rows,
    });
    setIsLoading(false);
    setLoadingTask(null);
  };

  async function processToWithBleed(
    srcBase64: string,
    opts: { hasBakedBleed: boolean }
  ): Promise<{ originalBase64: string; withBleedBase64: string }> {
    const trimmed = opts.hasBakedBleed
      ? await trimBleedEdge(srcBase64)
      : srcBase64;

    const withBleedBase64 = await addBleedEdge(trimmed, bleedEdgeWidth);

    return { originalBase64: srcBase64, withBleedBase64 };
  }

  async function addUploadedFiles(
    files: FileList,
    opts: { hasBakedBleed: boolean }
  ) {
    const fileArray = Array.from(files);
    const startIndex = cards.length;

    const newCards: CardOption[] = fileArray.map((file, i) => ({
      name:
        inferCardNameFromFilename(file.name) ||
        `Custom Art ${startIndex + i + 1}`,
      imageUrls: [],
      uuid: crypto.randomUUID(),
      isUserUpload: true,
      hasBakedBleed: opts.hasBakedBleed,
    }));

    setCards((prev) => [...prev, ...newCards]);

    const originalsUpdate: Record<string, string> = {};
    const processedUpdate: Record<string, string> = {};

    await Promise.all(
      fileArray.map(async (file, i) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        const { originalBase64, withBleedBase64 } = await processToWithBleed(
          base64,
          opts
        );

        const id = newCards[i].uuid;
        originalsUpdate[id] = originalBase64;
        processedUpdate[id] = withBleedBase64;
      })
    );

    setOriginalSelectedImages((prev) => ({ ...prev, ...originalsUpdate }));
    setSelectedImages((prev) => ({ ...prev, ...processedUpdate }));
  }

  const handleUploadMpcFill = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setLoadingTask("Uploading Images");
    setIsLoading(true);
    try {
      const files = e.target.files;
      if (files && files.length) {
        await addUploadedFiles(files, { hasBakedBleed: true });
      }
    } finally {
      if (e.target) e.target.value = "";
      setIsLoading(false);
      setLoadingTask(null);
    }
  };

  const handleUploadStandard = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    console.log("trying");
    setLoadingTask("Uploading Images");
    setIsLoading(true);
    try {
      const files = e.target.files;
      if (!files || !files.length) return;

      const fileArray = Array.from(files);
      const startIndex = cards.length;

      const newCards: CardOption[] = fileArray.map((_, i) => ({
        name: `Custom Art ${startIndex + i + 1}`,
        imageUrls: [],
        uuid: crypto.randomUUID(),
        isUserUpload: true,
        hasBakedBleed: false,
      }));

      console.log(newCards);

      setCards((prev) => [...prev, ...newCards]);

      const base64s = await Promise.all(
        fileArray.map(
          (file) =>
            new Promise<string>((resolve) => {
              const r = new FileReader();
              r.onloadend = () => resolve(r.result as string);
              r.readAsDataURL(file);
            })
        )
      );

      console.log(base64s);
      const newOriginals: Record<string, string> = {};
      const processed: Record<string, string> = {};

      newCards.forEach((c, i) => {
        newOriginals[c.uuid] = base64s[i];
      });

      for (const [uuid, b64] of Object.entries(newOriginals)) {
        console.log(b64);
        const bleedImage = await addBleedEdge(b64);
        console.log(bleedImage);
        processed[uuid] = bleedImage;
      }

      setOriginalSelectedImages((prev) => ({ ...prev, ...newOriginals }));
      setSelectedImages((prev) => ({ ...prev, ...processed }));
    } finally {
      if (e.target) e.target.value = "";
      setIsLoading(false);
      setLoadingTask(null);
    }
  };

  function chunkCards<T>(cards: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < cards.length; i += size) {
      chunks.push(cards.slice(i, i + size));
    }
    return chunks;
  }

  async function readText(file: File): Promise<string> {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result || ""));
      r.readAsText(file);
    });
  }

  const handleImportMpcXml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;

      const raw = await readText(file);
      const schemaItems = tryParseMpcSchemaXml(raw);
      const items =
        schemaItems && schemaItems.length ? schemaItems : parseMpcText(raw);

      const newCards: CardOption[] = [];
      const newOriginals: Record<string, string> = {};

      for (const it of items) {
        for (let i = 0; i < (it.qty || 1); i++) {
          const uuid = crypto.randomUUID();
          const name =
            it.name ||
            (it.filename
              ? inferCardNameFromFilename(it.filename)
              : "Custom Art");

          newCards.push({
            uuid,
            name,
            imageUrls: [],
            isUserUpload: true,
            hasBakedBleed: true,
          });

          const mpcUrl = getMpcImageUrl(it.frontId);
          if (mpcUrl) {
            newOriginals[uuid] = mpcUrl;
          }
        }
      }

      setCards((prev) => [...prev, ...newCards]);
      if (Object.keys(newOriginals).length) {
        setOriginalSelectedImages((prev) => ({ ...prev, ...newOriginals }));
      }
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  const handleSubmit = async () => {
    setLoadingTask("Fetching cards");

    const infos = parseDeckToInfos(deckText);

    const uniqueMap = new Map<string, CardInfo>();
    for (const ci of infos) uniqueMap.set(cardKey(ci), ci);
    const uniqueInfos = Array.from(uniqueMap.values());

    const uniqueNames = Array.from(new Set(uniqueInfos.map((ci) => ci.name)));

    await axios.delete(`${API_BASE}/api/cards/images`);

    const response = await axios.post<CardOption[]>(
      `${API_BASE}/api/cards/images`,
      {
        cardQueries: uniqueInfos,
        cardNames: uniqueNames,
        cardArt: "art",
      }
    );

    const optionByKey: Record<string, CardOption> = {};
    for (const opt of response.data) {
      const k = `${opt.name.toLowerCase()}|${(opt as any).set ?? ""}|${(opt as any).number ?? ""}`;
      optionByKey[k] = opt;
      const nameOnlyKey = `${opt.name.toLowerCase()}||`;
      if (!optionByKey[nameOnlyKey]) optionByKey[nameOnlyKey] = opt;
    }

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

  const handleCopyDecklist = async () => {
    const text = buildDecklist(cards, { style: "withSetNum", sort: "alpha" });
    await navigator.clipboard.writeText(text);
  };

  const handleDownloadDecklist = () => {
    const text = buildDecklist(cards, { style: "withSetNum", sort: "alpha" });
    const date = new Date().toISOString().slice(0, 10);
    downloadDecklist(`decklist_${date}.txt`, text);
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
      setModalCard((prev) => (prev ? { ...prev, imageUrls: urls } : prev));
    } finally {
      setIsGettingMore(false);
    }
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
        <Modal
          show={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          size="4xl"
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
                  if (!newCard.imageUrls?.length) return;

                  const newUuid = crypto.randomUUID();
                  const proxiedUrl = getLocalBleedImageUrl(
                    newCard.imageUrls[0]
                  );
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

                  setSelectedImages((prev) => ({
                    ...prev,
                    [newUuid]: processed,
                  }));
                  setOriginalSelectedImages((prev) => ({
                    ...prev,
                    [newUuid]: newCard.imageUrls[0],
                  }));

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
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = pngUrl;
                        }} // fallback
                        className={`w-full cursor-pointer border-4 ${
                          originalSelectedImages[modalCard.uuid] === pngUrl
                            ? "border-green-500"
                            : "border-transparent"
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

        <div className="w-1/5 dark:bg-gray-700 bg-gray-100 flex flex-col">
          <img src={fullLogo} alt="Proxxied Logo" />
          <div className=" flex-1 min-h-0 overflow-y-auto space-y-4 px-4 pb-4">
            <div className="space-y-2">
              <Label className="block text-gray-700 dark:text-gray-300">
                Upload MPC Images (
                <a
                  href="https://mpcfill.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  MPC Autofill
                </a>
                )
              </Label>

              <label
                htmlFor="upload-mpc"
                className="inline-block w-full text-center cursor-pointer rounded-md bg-gray-300 dark:bg-gray-600 px-4 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                Choose Files
              </label>
              <input
                id="upload-mpc"
                type="file"
                accept="image/*"
                multiple
                onChange={handleUploadMpcFill}
                onClick={(e) => ((e.target as HTMLInputElement).value = "")}
                className="hidden"
              />

              <Label className="block text-gray-700 dark:text-gray-300">
                Import MPC Text (XML)
              </Label>
              <label
                htmlFor="import-mpc-xml"
                className="inline-block w-full text-center cursor-pointer rounded-md bg-gray-300 dark:bg-gray-600 px-4 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                Choose File
              </label>
              <input
                id="import-mpc-xml"
                type="file"
                accept=".xml,.txt,.csv,.log,text/xml,text/plain"
                onChange={handleImportMpcXml}
                onClick={(e) => ((e.target as HTMLInputElement).value = "")}
                className="hidden"
              />

              {/* Standard */}
              <Label className="block text-gray-700 dark:text-gray-300">
                Upload Other Images (mtgcardsmith, custom designs, etc.)
              </Label>
              <label
                htmlFor="upload-standard"
                className="inline-block w-full text-center cursor-pointer rounded-md bg-gray-300 dark:bg-gray-600 px-4 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                Choose Files
              </label>
              <input
                id="upload-standard"
                type="file"
                accept="image/*"
                multiple
                onChange={handleUploadStandard}
                onClick={(e) => ((e.target as HTMLInputElement).value = "")}
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

            <div className="space-y-4">
              <Textarea
                className="h-64"
                placeholder={`1x Sol Ring
2x Counterspell
For specific art include set / CN
eg. Strionic Resonator (lcc)
or Repurposing Bay (dft) 380`}
                value={deckText}
                onChange={(e) => setDeckText(e.target.value)}
              />
              <Button className="bg-blue-800 w-full" onClick={handleSubmit}>
                Fetch Cards
              </Button>
              <Button
                className="bg-red-700 hover:bg-red-700 w-full"
                onClick={handleClear}
              >
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
              <Button
                className="bg-purple-700 w-full mt-[2rem]"
                onClick={addCardBackPage}
              >
                Add Card Backs
              </Button>
            </div>
          </div>
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
                onMouseLeave={() =>
                  setContextMenu({ ...contextMenu, visible: false })
                }
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
                      width: `${pageWidthIn}in`,
                      height: `${pageHeightIn}in`,
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
                        gridTemplateColumns: `repeat(${cols}, ${totalCardWidth}mm)`,
                        gridTemplateRows: `repeat(${rows}, ${totalCardHeight}mm)`,
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
                              bleedEdge={bleedEdge}
                              guideOffset={guideOffset}
                              guideWidth={guideWidth}
                              guideColor={guideColor}
                              setContextMenu={setContextMenu}
                              setModalCard={setModalCard}
                              setModalIndex={setModalIndex}
                              setIsModalOpen={setIsModalOpen}
                            />
                          </CardCellLazy>
                        );
                      })}
                    </div>
                    {bleedEdge && (
                      <EdgeCutLines
                        pageWidthIn={pageWidthIn}
                        pageHeightIn={pageHeightIn}
                        cols={cols}
                        rows={rows}
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
          <Label className="text-lg font-semibold dark:text-gray-300">
            Settings
          </Label>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Page Width (in)</Label>
                <TextInput
                  className="w-full"
                  type="number"
                  step="0.1"
                  min="1"
                  value={pageWidthIn}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) setPageWidthIn(v);
                  }}
                />
              </div>
              <div>
                <Label>Page Height (in)</Label>
                <TextInput
                  className="w-full"
                  type="number"
                  step="0.1"
                  min="1"
                  value={pageHeightIn}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) setPageHeightIn(v);
                  }}
                />
              </div>
            </div>
            <Button
              className="bg-gray-300 text-gray-900 w-full"
              onClick={() => {
                setPageWidthIn((w) => {
                  const h = pageHeightIn;
                  setPageHeightIn(w);
                  return h;
                });
              }}
            >
              Swap Orientation
            </Button>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Columns</Label>
                <TextInput
                  className="w-full"
                  type="number"
                  min={1}
                  max={10}
                  value={cols}
                  onChange={(e) => {
                    const v = Math.max(
                      1,
                      Math.min(10, parseInt(e.target.value || "1", 10))
                    );
                    if (!Number.isNaN(v)) setCols(v);
                  }}
                />
              </div>
              <div>
                <Label>Rows</Label>
                <TextInput
                  className="w-full"
                  type="number"
                  min={1}
                  max={10}
                  value={rows}
                  onChange={(e) => {
                    const v = Math.max(
                      1,
                      Math.min(10, parseInt(e.target.value || "1", 10))
                    );
                    if (!Number.isNaN(v)) setRows(v);
                  }}
                />
              </div>
            </div>

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
                    reprocessSelectedImages(cards, val);
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
                <Button
                  size="xs"
                  className="bg-gray-300 text-gray-900 w-full focus:ring-0"
                  onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
                >
                  -
                </Button>
                <Label className="w-full text-center">{zoom.toFixed(1)}x</Label>
                <Button
                  size="xs"
                  className="bg-gray-300 text-gray-900 w-full focus:ring-0"
                  onClick={() => setZoom((z) => z + 0.1)}
                >
                  +
                </Button>
              </div>
            </div>

            <Button
              className="bg-green-700 w-full"
              color="success"
              onClick={handleExport}
            >
              Export to PDF
            </Button>
            <Button
              className="bg-indigo-700 w-full"
              onClick={() =>
                ExportImagesZip({
                  cards,
                  originalSelectedImages,
                  fileBaseName: "card_images",
                })
              }
            >
              Export Card Images (.zip)
            </Button>
            <Button className="bg-blue-700 w-full" onClick={handleCopyDecklist}>
              Copy Decklist
            </Button>
            <Button
              className="bg-blue-500 w-full mt-2"
              onClick={handleDownloadDecklist}
            >
              Download Decklist (.txt)
            </Button>
          </div>

          <div className="mt-auto space-y-3 pt-4">
            <Donate username="Kaiser-Clipston-1" />
            <a
              href="https://github.com/kclipsto/proxies-at-home"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-md underline text-center text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
            >
              Code by Kaiser Clipston (Github)
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
