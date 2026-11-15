import { cardKey, MAX_CARDS, parseDeckToInfos } from "@/helpers/CardInfoHelper";
import { makeUploadedFileToken } from "@/helpers/imageUtils";
import { processWithConcurrency } from "@/helpers/concurrency";
import { preloadSheetGrid } from "@/helpers/sheetGridLoader";
import {
  getMpcImageUrl,
  inferCardNameFromFilename,
  parseMpcText,
  tryParseMpcSchemaXml,
} from "@/helpers/Mpc";
import { plural } from "@/helpers/plural";
import { findCardsArt } from "@/helpers/scryfall";
import { copyUpload } from "@/helpers/uploads";
import { useCardsStore, useLoadingStore } from "@/store";
import { errorMessage, notify } from "@/store/notifications";
import { deckEdit } from "@/store/undo";
import type { CardOption } from "@/types/Card";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif|avif)$/;
export const MPC_FILE = /\.(xml|txt|csv|log)$/i;

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
  deckEdit(`add ${plural(cards.length, "card", "cards")}`, () =>
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
    })
  );
}

const LISTED_MISSING = 4;

export function importNotice(added: number, missing: string[]): string {
  const notice = `Added ${plural(added, "card", "cards")}.`;
  if (!missing.length) return notice;
  const names = missing.slice(0, LISTED_MISSING).join(", ");
  const rest = missing.length - LISTED_MISSING;
  const list =
    rest > 0 ? `${names} and ${rest.toLocaleString("en")} more` : names;
  const need = plural(missing.length, "card needs", "cards need");
  return `${notice} ${need} artwork: ${list}. Use Find artwork in the Deck panel.`;
}

export async function importDecklist(
  text: string,
  language: string
): Promise<boolean> {
  if (useLoadingStore.getState().loadingTask) return false;
  preloadSheetGrid();
  const controller = new AbortController();
  try {
    const infos = parseDeckToInfos(text);
    if (!infos.length) {
      notify("Paste at least one card name to start.");
      return false;
    }
    if (useCardsStore.getState().cards.length + infos.length > MAX_CARDS)
      throw new Error(
        "This workspace holds up to 1,000 cards. Reduce the list or clear some cards first."
      );
    const unique = [...new Map(infos.map((ci) => [cardKey(ci), ci])).values()];
    useLoadingStore.getState().setLoadingTask("Fetching cards", {
      onCancel: () => controller.abort(),
      cancelLabel: "Cancel import",
    });
    const results = await findCardsArt(
      unique,
      language,
      true,
      controller.signal,
      (done, total) =>
        useLoadingStore.getState().setLoadingProgress((done / total) * 100)
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
    notify(
      importNotice(
        newCards.length,
        missing.map((c) => c.name)
      ),
      missing.length ? "info" : "success"
    );
    return true;
  } catch (error) {
    if (!controller.signal.aborted) notify(errorMessage(error), "error");
    return false;
  } finally {
    useLoadingStore.getState().setLoadingTask(null);
  }
}

export async function uploadImages(
  files: File[],
  hasBakedBleed: boolean
): Promise<boolean> {
  if (!files.length) return false;
  if (useLoadingStore.getState().loadingTask) return false;
  preloadSheetGrid();
  const controller = new AbortController();
  try {
    if (files.length + useCardsStore.getState().cards.length > MAX_CARDS)
      throw new Error("This workspace holds up to 1,000 cards.");
    if (
      files.some(
        (file) => !IMAGE_TYPE.test(file.type) || file.size > MAX_IMAGE_BYTES
      )
    )
      throw new Error(
        "Choose PNG, JPEG, WebP, GIF or AVIF images up to 30 MB each."
      );
    const originals: Record<string, string> = {},
      uploaded: Record<string, File> = {};
    useLoadingStore.getState().setLoadingTask("Uploading Images", {
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
      `Added ${plural(added.length, "image", "images")}. Original files stay in this browser.`,
      "success"
    );
    return true;
  } catch (error) {
    if (!controller.signal.aborted) notify(errorMessage(error), "error");
    return false;
  } finally {
    useLoadingStore.getState().setLoadingTask(null);
  }
}

export async function importMpcFile(file: File): Promise<boolean> {
  preloadSheetGrid();
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
      count + useCardsStore.getState().cards.length > MAX_CARDS
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
      `Imported ${plural(added.length, "MPC card", "MPC cards")}, including their assigned backs.`,
      "success"
    );
    return true;
  } catch (error) {
    notify(errorMessage(error), "error");
    return false;
  }
}
