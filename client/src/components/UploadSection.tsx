import fullLogo from "@/assets/fullLogo.png";
import { API_BASE, LANGUAGE_OPTIONS } from "@/constants";
import {
  cardKey,
  parseDeckToInfos,
  type CardInfo,
} from "@/helpers/CardInfoHelper";
import {
  addBleedEdgeSmartly,
  getLocalBleedImageUrl
} from "@/helpers/ImageHelper";
import {
  getMpcImageUrl,
  inferCardNameFromFilename,
  parseMpcText,
  tryParseMpcSchemaXml,
} from "@/helpers/Mpc";
import { useCardsStore, useLoadingStore, useSettingsStore } from "@/store";
import type { CardOption } from "@/types/Card";
import axios from "axios";
import {
  Button,
  HelperText,
  HR,
  List,
  ListItem,
  Select,
  Textarea,
} from "flowbite-react";
import { ExternalLink } from "lucide-react";
import React, { useState } from "react";

async function readText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result || ""));
    r.readAsText(file);
  });
}

export function UploadSection() {
  const [deckText, setDeckText] = useState("");
  const bleedEdgeWidth = useSettingsStore((state) => state.bleedEdgeWidth);
  const cards = useCardsStore((state) => state.cards);

  const setLoadingTask = useLoadingStore((state) => state.setLoadingTask);
  const appendCards = useCardsStore((state) => state.appendCards);
  const setCards = useCardsStore((state) => state.setCards);
  const setSelectedImages = useCardsStore((state) => state.setSelectedImages);
  const appendSelectedImages = useCardsStore(
    (state) => state.appendSelectedImages
  );
  const setOriginalSelectedImages = useCardsStore(
    (state) => state.setOriginalSelectedImages
  );
  const appendOriginalSelectedImages = useCardsStore(
    (state) => state.appendOriginalSelectedImages
  );

  const globalLanguage = useCardsStore((s) => s.globalLanguage ?? "en");
  const setGlobalLanguage = useCardsStore((s) => s.setGlobalLanguage ?? (() => { }));

  async function processToWithBleed(
    srcBase64: string,
    opts: { hasBakedBleed: boolean }
  ) {
    const withBleedBase64 = await addBleedEdgeSmartly(srcBase64, bleedEdgeWidth, {
      unit: "mm",
      bleedEdgeWidth,
      hasBakedBleed: opts.hasBakedBleed,
    });

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

    appendCards(newCards);

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

    appendOriginalSelectedImages(originalsUpdate);
    appendSelectedImages(processedUpdate);
  }

  const handleUploadMpcFill = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setLoadingTask("Uploading Images");

    try {
      const files = e.target.files;
      if (files && files.length) {
        await addUploadedFiles(files, { hasBakedBleed: true });
      }
    } finally {
      if (e.target) e.target.value = "";

      setLoadingTask(null);
    }
  };

  const handleUploadStandard = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setLoadingTask("Uploading Images");
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

      appendCards(newCards);

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
            { hasBakedBleed: false }
          );

          const id = newCards[i].uuid;
          originalsUpdate[id] = originalBase64;
          processedUpdate[id] = withBleedBase64;
        })
      );

      appendOriginalSelectedImages(originalsUpdate);
      appendSelectedImages(processedUpdate);
    } finally {
      if (e.target) e.target.value = "";
      setLoadingTask(null);
    }
  };

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

      appendCards(newCards);
      if (Object.keys(newOriginals).length) {
        appendOriginalSelectedImages(newOriginals);
      }
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  const handleSubmit = async () => {
    setLoadingTask("Fetching cards");

    try {
      const infos = parseDeckToInfos(deckText || "");
      if (!infos.length) {
        setLoadingTask(null);
        return;
      }

      const uniqueMap = new Map<string, CardInfo>();
      for (const ci of infos) uniqueMap.set(cardKey(ci), ci);
      const uniqueInfos = Array.from(uniqueMap.values());
      const uniqueNames = Array.from(new Set(uniqueInfos.map((ci) => ci.name)));

      try {
        await axios.delete(`${API_BASE}/api/cards/images`, { timeout: 15000 });
      } catch (e) {
        console.warn("[FetchCards] DELETE failed (continuing):", e);
      }

      let response: { data: CardOption[] } | null = null;
      try {
        response = await axios.post<CardOption[]>(
          `${API_BASE}/api/cards/images`,
          {
            cardQueries: uniqueInfos,
            cardNames: uniqueNames,
            cardArt: "art",
            language: globalLanguage,
          },
          { timeout: 20000 }
        );
      } catch (e: any) {
        console.error("[FetchCards] POST failed:", e);
        throw new Error(
          e?.response?.data?.error ||
          e?.message ||
          "Failed to fetch cards. Check network/CORS."
        );
      }

      const data = Array.isArray(response?.data) ? response!.data : [];
      if (!data.length) {
        throw new Error("No images found for the provided list.");
      }

      const optionByKey: Record<string, CardOption> = {};
      for (const opt of data) {
        if (!opt?.name) continue;
        const k = `${opt.name.toLowerCase()}|${opt.set ?? ""}|${opt.number ?? ""}`;
        optionByKey[k] = opt;
        const nameOnlyKey = `${opt.name.toLowerCase()}||`;
        if (!optionByKey[nameOnlyKey]) optionByKey[nameOnlyKey] = opt;
      }

      const expandedCards: CardOption[] = infos.map((ci) => {
        const k = cardKey(ci);
        const fallbackK = `${ci.name.toLowerCase()}||`;
        const card = optionByKey[k] ?? optionByKey[fallbackK];
        return {
          ...(card ?? { name: ci.name, imageUrls: [] }),
          uuid: crypto.randomUUID(),
        } as CardOption;
      });

      appendCards(expandedCards);

      const newOriginals: Record<string, string> = {};
      for (const card of expandedCards) {
        if (card?.imageUrls?.length > 0) {
          newOriginals[card.uuid] = card.imageUrls[0];
        }
      }
      appendOriginalSelectedImages(newOriginals);

      setLoadingTask(null);

      const processed: Record<string, string> = {};
      for (const [uuid, url] of Object.entries(newOriginals)) {
        try {
          const proxiedUrl = getLocalBleedImageUrl(url);
          const bleedImage = await addBleedEdgeSmartly(proxiedUrl, bleedEdgeWidth, {
            unit: "mm",
            bleedEdgeWidth,
            hasBakedBleed: false,
          });
          processed[uuid] = bleedImage;
        } catch (e) {
          console.warn(`[Bleed] Failed for ${uuid}:`, e);
        }
      }
      if (Object.keys(processed).length) appendSelectedImages(processed);

      setDeckText("");
    } catch (err: any) {
      console.error("[FetchCards] Error:", err);
      alert(err?.message || "Something went wrong while fetching cards.");
    } finally {
      setLoadingTask(null);
    }
  };

  const handleClear = async () => {
    setLoadingTask("Clearing Images");

    try {
      setCards([]);
      setSelectedImages({});
      setOriginalSelectedImages({});

      try {
        await axios.delete(`${API_BASE}/api/cards/images`, { timeout: 15000 });
      } catch (e) {
        console.warn("[Clear] Server cache clear failed (UI already cleared):", e);
      }
    } catch (err: any) {
      console.error("[Clear] Error:", err);
      alert(err?.message || "Failed to clear images.");
    } finally {
      setLoadingTask(null);
    }
  };


  return (
    <div className="w-1/5 dark:bg-gray-700 bg-gray-100 flex flex-col">
      <img src={fullLogo} alt="Proxxied Logo" />

      <div className="flex-1 flex flex-col overflow-y-auto gap-6 px-4 pb-4">
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <h6 className="font-medium dark:text-white">
              Upload MPC Images (
              <a
                href="https://mpcfill.com"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-blue-600 dark:hover:text-blue-400"
              >
                MPC Autofill
                <ExternalLink className="inline-block size-4 ml-1" />
              </a>
              )
            </h6>

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
          </div>

          <div className="space-y-1">
            <h6 className="font-medium dark:text-white">
              Import MPC Text (XML)
            </h6>

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
          </div>

          <div className="space-y-1">
            <h6 className="font-medium dark:text-white">Upload Other Images</h6>
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
            <HelperText>
              You can upload images from mtgcardsmith, custom designs, etc.
            </HelperText>
          </div>
        </div>

        <HR className="my-0 dark:bg-gray-500" />

        <div className="space-y-4">
          <div className="space-y-1">
            <h6 className="font-medium dark:text-white">
              Add Cards (
              <a
                href="https://scryfall.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-600 dark:hover:text-blue-400"
              >
                Scryfall
                <ExternalLink className="inline-block size-4 ml-1" />
              </a>
              )
            </h6>

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
          </div>

          <div className="flex flex-col gap-2">
            <Button color="blue" onClick={handleSubmit}>
              Fetch Cards
            </Button>
            <Button color="red" onClick={handleClear}>
              Clear Cards
            </Button>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h6 className="font-medium dark:text-white">Language</h6>
            </div>
            <HelperText>Used for Scryfall lookups</HelperText>

            <Select
              className="w-full rounded-md bg-gray-300 dark:bg-gray-600 my-2 text-sm text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-500"
              value={globalLanguage}
              onChange={(e) => setGlobalLanguage(e.target.value)}
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <h6 className="font-medium dark:text-white">Tips:</h6>

            <List className="text-sm dark:text-white/60">
              <ListItem>To change a card art - click it</ListItem>
              <ListItem>
                To move a card - drag from the box at the top right
              </ListItem>
              <ListItem>
                To duplicate or delete a card - right click it
              </ListItem>
            </List>
          </div>
        </div>

        <HR className="my-0 dark:bg-gray-500" />
      </div>
    </div>
  );
}
