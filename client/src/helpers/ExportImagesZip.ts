import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { CardOption } from "../types/Card";
import { API_BASE } from "@/constants";
import { isUploadedFileToken } from "./ImageHelper";

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\/\\?%*:|"<>]/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "card"
  );
}

function getLocalBleedImageUrl(originalUrl: string) {
  return `${API_BASE}/api/cards/images/proxy?url=${encodeURIComponent(originalUrl)}`;
}

// Scryfall thumbs sometimes come as .jpg; prefer .png for fewer artifacts
function preferPng(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("scryfall.io") && u.pathname.match(/\.(jpg|jpeg)$/i)) {
      u.pathname = u.pathname.replace(/\.(jpg|jpeg)$/i, ".png");
      return u.toString();
    }
  } catch {
    /* noop */
  }
  return url;
}

type ExportOpts = {
  cards: CardOption[];
  originalSelectedImages: Record<string, string>;
  cachedImageUrls?: Record<string, string>;   // <-- NEW
  uploadedFiles?: Record<string, File>;
  fileBaseName?: string; // default: card_images_YYYY-MM-DD
  concurrency?: number;  // default: 6
};

export async function ExportImagesZip(opts: ExportOpts) {
  const {
    cards,
    originalSelectedImages,
    cachedImageUrls,
    uploadedFiles,
    fileBaseName,
    concurrency = 6,
  } = opts;

  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  // Build a work list that resolves the best URL for each card
  const tasks = cards.map((c, i) => {
    // Choose the best source (cached > originalSelected > first imageUrl)
    const rawSource =
      (cachedImageUrls && cachedImageUrls[c.uuid]) ||
      originalSelectedImages[c.uuid] ||
      c.imageUrls?.[0] ||
      "";

    let source:
      | { kind: "file"; file: File }
      | { kind: "url"; url: string }
      | null = null;

    if (isUploadedFileToken(rawSource)) {
      const file = uploadedFiles?.[c.uuid];
      if (!file) {
        console.warn(`[Export skipped] Missing uploaded file for card ${c.name}`);
        return async () => null;
      }
      source = { kind: "file", file };
    } else {
      let url = rawSource;
      if (!url) {
        return async () => null;
      }

      if (!c.isUserUpload && !(cachedImageUrls && cachedImageUrls[c.uuid])) {
        url = getLocalBleedImageUrl(preferPng(url));
      }
      source = { kind: "url", url };
    }

    const baseName = sanitizeFilename(c.name || `Card ${i + 1}`);
    const idx = String(i + 1).padStart(3, "0");

    return async () => {
      try {
        let blob: Blob;
        if (source?.kind === "file") {
          blob = source.file;
        } else if (source?.kind === "url") {
          const res = await fetch(source.url, { mode: "cors", credentials: "omit" });
          if (!res.ok) {
            console.warn(`[Export skipped] Could not fetch: ${source.url}`);
            return null;
          }
          blob = await res.blob();
        } else {
          return null;
        }

        // de-dupe filenames per printed order
        const count = (usedNames.get(baseName) ?? 0) + 1;
        usedNames.set(baseName, count);
        const suffix = count > 1 ? ` (${count})` : "";

        // Try to keep the right extension if we know it; default to .png
        const ext =
          blob.type === "image/jpeg"
            ? "jpg"
            : blob.type === "image/webp"
              ? "webp"
              : blob.type === "image/png"
                ? "png"
                : "png";

        const filename = `${idx} - ${baseName}${suffix}.${ext}`;
        zip.file(filename, blob);
        return true;
      } catch (err) {
        const descriptor = source?.kind === "url" ? source.url : "uploaded file";
        console.warn(`[Export skipped] Error fetching ${descriptor}`, err);
        return null;
      }
    };
  });

  // Simple concurrency limiter
  async function runWithConcurrency<T>(jobs: Array<() => Promise<T>>, limit: number) {
    const results: T[] = [];
    let next = 0;

    async function worker() {
      while (next < jobs.length) {
        const cur = next++;
        results[cur] = await jobs[cur]();
      }
    }

    const workers = Array.from({ length: Math.max(1, limit) }, worker);
    await Promise.all(workers);
    return results;
  }

  await runWithConcurrency(tasks, concurrency);

  const date = new Date().toISOString().slice(0, 10);
  const outName = `${fileBaseName || "card_images"}_${date}.zip`;
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, outName);
}
