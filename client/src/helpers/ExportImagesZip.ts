import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { CardOption } from "../types/Card";

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\/\\?%*:|"<>]/g, "_") // illegal on most filesystems
      .replace(/\s+/g, " ")
      .trim() || "card"
  );
}

export async function ExportImagesZip(opts: {
  cards: CardOption[];
  originalSelectedImages: Record<string, string>;
  fileBaseName?: string; // default: original_images_YYYY-MM-DD
}) {
  const { cards, originalSelectedImages, fileBaseName } = opts;

  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const url = originalSelectedImages[c.uuid];
    if (!url) continue; // skip empty slots

    const baseName = sanitizeFilename(c.name || `Card ${i + 1}`);
    const count = (usedNames.get(baseName) ?? 0) + 1;
    usedNames.set(baseName, count);

    const idx = String(i + 1).padStart(3, "0");
    const suffix = count > 1 ? ` (${count})` : "";
    const filename = `${idx} - ${baseName}${suffix}.png`;

    // Fetch image as blob
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Export skipped] Could not fetch: ${url}`);
      continue;
    }
    const blob = await res.blob();
    zip.file(filename, blob);
  }

  const date = new Date().toISOString().slice(0, 10);
  const outName = `${fileBaseName || "card_images"}_${date}.zip`;
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, outName);
}
