import { API_BASE, LANGUAGE_OPTIONS } from "@/constants";
import { cardKey, MAX_CARDS, parseDeckToInfos } from "@/helpers/CardInfoHelper";
import {
  makeUploadedFileToken,
  processWithConcurrency,
} from "@/helpers/ImageHelper";
import {
  getMpcImageUrl,
  inferCardNameFromFilename,
  parseMpcText,
  tryParseMpcSchemaXml,
} from "@/helpers/Mpc";
import { useCardsStore, useLoadingStore } from "@/store";
import { errorMessage, notify } from "@/store/notifications";
import { useStorageStatus } from "@/helpers/IndexedDBStorage";
import { copyUpload } from "@/helpers/uploads";
import type { CardOption } from "@/types/Card";
import axios from "axios";
import { FileImage, ListPlus, Upload, Trash2 } from "lucide-react";
import { useState, type ChangeEvent } from "react";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
function commitCards(
  cards: CardOption[],
  originals: Record<string, string>,
  files: Record<string, File> = {},
  backs: Record<string, string> = {}
) {
  const previous = useCardsStore.getState();
  if (previous.cards.length + cards.length > MAX_CARDS)
    throw new Error(
      "This workspace holds up to 1,000 cards. Export or clear some cards before adding more."
    );
  useCardsStore.setState({
    cards: [...previous.cards, ...cards],
    originalSelectedImages: {
      ...previous.originalSelectedImages,
      ...originals,
    },
    originalSelectedBackImages: {
      ...previous.originalSelectedBackImages,
      ...backs,
    },
    uploadedFiles: { ...previous.uploadedFiles, ...files },
  });
}
export function UploadSection() {
  const pendingSave = useStorageStatus((s) => s.pending > 0);
  const saveError = useStorageStatus((s) => s.error);
  const savingDisabled = useStorageStatus((s) => s.savingDisabled);
  const [deckText, setDeckText] = useState("");
  const cards = useCardsStore((s) => s.cards);
  const language = useCardsStore((s) => s.globalLanguage);
  const setLanguage = useCardsStore((s) => s.setGlobalLanguage);
  const loading = useLoadingStore((s) => s.loadingTask);

  async function importDeck() {
    if (loading) return;
    const controller = new AbortController();
    try {
      const infos = parseDeckToInfos(deckText);
      if (!infos.length) {
        notify("Paste at least one card name to start.");
        return;
      }
      if (cards.length + infos.length > MAX_CARDS)
        throw new Error(
          "This workspace holds up to 1,000 cards. Reduce the list or clear some cards first."
        );
      const unique = [
        ...new Map(infos.map((ci) => [cardKey(ci), ci])).values(),
      ];
      const batches = Array.from(
        { length: Math.ceil(unique.length / 75) },
        (_, i) => unique.slice(i * 75, (i + 1) * 75)
      );
      useLoadingStore.getState().setLoadingTask("Fetching cards", {
        onCancel: () => controller.abort(),
        cancelLabel: "Cancel import",
      });
      const results = new Map<string, CardOption>();
      let completed = 0;
      await processWithConcurrency(
        batches,
        async (batch) => {
          const response = await axios.post<CardOption[]>(
            `${API_BASE}/api/cards/images`,
            { cardQueries: batch, language, cardArt: "art" },
            { signal: controller.signal, timeout: 180000 }
          );
          for (const [i, card] of response.data.entries())
            results.set(cardKey(card.query ?? batch[i]), card);
          useLoadingStore
            .getState()
            .setLoadingProgress((++completed / batches.length) * 100);
        },
        2,
        controller.signal
      );
      controller.signal.throwIfAborted();
      const originals: Record<string, string> = {};
      const newCards = infos.map((ci) => {
        const result = results.get(cardKey(ci));
        const card: CardOption = {
          ...result,
          name: ci.name,
          uuid: crypto.randomUUID(),
          imageUrls: result?.imageUrls ?? [],
          isUserUpload: false,
          hasBakedBleed: false,
          currentFaceIndex: 0,
        };
        const source = card.imageUrls[0] || card.faces?.[0]?.imageUrl;
        if (source) originals[card.uuid] = source;
        return card;
      });
      commitCards(newCards, originals);
      const missing = newCards.filter((c) => !originals[c.uuid]);
      setDeckText("");
      notify(
        missing.length
          ? `Added ${newCards.length} cards. ${missing.length} need artwork: ${missing
              .slice(0, 4)
              .map((c) => c.name)
              .join(", ")}. Select each missing card to search again.`
          : `Added ${newCards.length} cards. Select a card to change its artwork.`,
        missing.length ? "info" : "success"
      );
    } catch (error) {
      if (!controller.signal.aborted) notify(errorMessage(error), "error");
    } finally {
      useLoadingStore.getState().setLoadingTask(null);
    }
  }

  async function uploadImages(
    event: ChangeEvent<HTMLInputElement>,
    hasBakedBleed: boolean
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (useLoadingStore.getState().loadingTask) return;
    const controller = new AbortController();
    try {
      if (files.length + useCardsStore.getState().cards.length > MAX_CARDS)
        throw new Error("This workspace holds up to 1,000 cards.");
      if (
        files.some(
          (file) =>
            !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type) ||
            file.size > MAX_IMAGE_BYTES
        )
      )
        throw new Error(
          "Choose PNG, JPEG, WebP, GIF or AVIF images up to 30 MB each."
        );
      const originals: Record<string, string> = {},
        uploaded: Record<string, File> = {};
      useLoadingStore
        .getState()
        .setLoadingTask("Uploading Images", {
          onCancel: () => controller.abort(),
          cancelLabel: "Cancel upload",
        });
      const added: CardOption[] = new Array(files.length);
      let completed = 0;
      await processWithConcurrency(
        files,
        async (source, index) => {
          const file = await copyUpload(source);
          const uuid = crypto.randomUUID();
          originals[uuid] = makeUploadedFileToken(uuid);
          uploaded[uuid] = file;
          added[index] = {
            uuid,
            name: inferCardNameFromFilename(file.name),
            imageUrls: [],
            isUserUpload: true,
            hasBakedBleed,
          };
          useLoadingStore
            .getState()
            .setLoadingProgress((++completed / files.length) * 100);
        },
        3,
        controller.signal
      );
      controller.signal.throwIfAborted();
      commitCards(added, originals, uploaded);
      notify(
        `Added ${added.length} image${added.length === 1 ? "" : "s"}. Original files stay in this browser.`,
        "success"
      );
    } catch (error) {
      if (!controller.signal.aborted) notify(errorMessage(error), "error");
    } finally {
      useLoadingStore.getState().setLoadingTask(null);
    }
  }

  async function importMpc(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Choose an MPC XML or text file under 2 MB.");
      const raw = await file.text();
      const items = tryParseMpcSchemaXml(raw) ?? parseMpcText(raw);
      if (!items.length || items.some((item) => !item.frontId))
        throw new Error(
          "No usable MPC images found. Choose an MPCFill XML with public Google Drive image IDs."
        );
      const count = items.reduce((sum, item) => sum + item.qty, 0);
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count + cards.length > MAX_CARDS
      )
        throw new Error(
          "Import up to 1,000 cards in this workspace. Check the MPC file quantities."
        );
      const originals: Record<string, string> = {},
        backs: Record<string, string> = {};
      const added: CardOption[] = [];
      for (const item of items)
        for (let i = 0; i < item.qty; i++) {
          const uuid = crypto.randomUUID();
          originals[uuid] = getMpcImageUrl(item.frontId)!;
          if (item.backId) backs[uuid] = getMpcImageUrl(item.backId)!;
          added.push({
            uuid,
            name: item.name,
            imageUrls: [],
            isUserUpload: true,
            hasBakedBleed: true,
            hasBackImage: !!item.backId,
            backHasBakedBleed: true,
          });
        }
      commitCards(added, originals, {}, backs);
      notify(
        `Imported ${added.length} MPC cards, including their assigned backs.`,
        "success"
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  return (
    <aside
      className="workspace-panel import-panel"
      aria-labelledby="add-heading"
      id="add-panel"
    >
      <div className="panel-heading">
        <span className="eyebrow">01 / Build your deck</span>
        <h2 id="add-heading">Add cards</h2>
        <p>Bring your next deck to the table.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void importDeck();
        }}
        className="space-y-4"
      >
        <div className="field">
          <label htmlFor="decklist">Decklist</label>
          <textarea
            id="decklist"
            rows={8}
            placeholder={
              "1 Sol Ring\n2 Counterspell\n1 Lightning Bolt (m11) 146"
            }
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
            aria-describedby="deck-hint"
          />
          <p id="deck-hint" className="hint">
            One card per line. Include a quantity, set or collector number if
            you like.
          </p>
        </div>
        <div className="field">
          <label htmlFor="language">Card language</label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          className="primary-button w-full"
          disabled={!deckText.trim() || !!loading}
        >
          <ListPlus size={18} aria-hidden="true" /> Add to deck
        </button>
      </form>
      <div className="section-divider">
        <span>Or use your own art</span>
      </div>
      <div className="upload-options">
        <label className="upload-option">
          <FileImage size={20} aria-hidden="true" />
          <span>
            <strong>Card images</strong>
            <small>Standard artwork without bleed</small>
          </span>
          <input
            aria-label="Upload card images"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            disabled={!!loading}
            onChange={(e) => void uploadImages(e, false)}
          />
        </label>
        <label className="upload-option">
          <Upload size={20} aria-hidden="true" />
          <span>
            <strong>MPC images</strong>
            <small>Artwork with 3 mm baked bleed</small>
          </span>
          <input
            aria-label="Upload MPC images"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={!!loading}
            onChange={(e) => void uploadImages(e, true)}
          />
        </label>
        <div className="field">
          <label htmlFor="mpc-xml">MPCFill XML or text</label>
          <input
            id="mpc-xml"
            type="file"
            accept=".xml,.txt,.csv,.log"
            disabled={!!loading}
            onChange={(e) => void importMpc(e)}
          />
        </div>
      </div>
      <div className="tip-box">
        <strong>Make it yours</strong>
        <p>
          Select a card to choose art. Use its drag handle to reorder, or its
          menu to duplicate, move or remove it.
        </p>
      </div>
      <div className="panel-footer">
        <span className="tabular-nums">
          {cards.length} / {MAX_CARDS} cards
        </span>
        <button
          className="text-button danger"
          disabled={!cards.length || !!loading}
          onClick={() => {
            if (
              window.confirm(
                `Remove all ${cards.length} cards and their uploaded images from this workspace?`
              )
            ) {
              useCardsStore.getState().clearAll();
              notify("Deck cleared. Your print settings are unchanged.");
            }
          }}
        >
          <Trash2 size={15} aria-hidden="true" /> Clear deck
        </button>
      </div>
      <p className="hint" aria-live="polite">
        {savingDisabled
          ? "Temporary workspace · saving disabled"
          : saveError
            ? "Changes not saved"
            : pendingSave
              ? "Saving workspace…"
              : "Saved in this browser"}
      </p>
    </aside>
  );
}
