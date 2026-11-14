import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { CardOption } from "../types/Card";
import { cardSource, type ImageSources } from "./cardSources";
import { processWithConcurrency, toProxied } from "./ImageHelper";

type ExportOpts = ImageSources & {
  cards: CardOption[];
  fileBaseName?: string;
  concurrency?: number;
  includeDoubleFaces?: boolean;
  useOriginalCardNames?: boolean;
  prefixIndexToExportNames?: boolean;
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
};
const sanitize = (name: string) =>
  Array.from(name, (c) => (c.charCodeAt(0) < 32 ? "_" : c))
    .join("")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "card";

export async function ExportImagesZip(opts: ExportOpts) {
  const zip = new JSZip();
  const names = new Map<string, number>();
  const jobs: { source: string | File; filename: string; label: string }[] = [];
  const checkAbort = () => opts.signal?.throwIfAborted();
  for (const [index, card] of opts.cards.entries()) {
    const sides =
      opts.includeDoubleFaces &&
      (opts.originalSelectedBackImages?.[card.uuid] ||
        (card.faces?.length ?? 0) > 1)
        ? [false, true]
        : [false];
    for (const back of sides) {
      const { source } = cardSource(card, opts, back);
      if (!source)
        throw new Error(
          `Missing image for “${card.name}”. Upload it again or choose artwork before exporting.`
        );
      const label = card.name + (back ? " (Back)" : "");
      let base = opts.useOriginalCardNames
        ? [
            card.set,
            card.number,
            label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, ""),
          ]
            .filter(Boolean)
            .join("-")
        : label;
      base = sanitize(base);
      const count = (names.get(base) ?? 0) + 1;
      names.set(base, count);
      const prefix =
        opts.prefixIndexToExportNames === false
          ? ""
          : `${String(index + 1).padStart(3, "0")} - `;
      jobs.push({
        source,
        label,
        filename: `${prefix}${base}${count > 1 ? ` (${count})` : ""}`,
      });
    }
  }
  let completed = 0;
  await processWithConcurrency(
    jobs,
    async ({ source, filename, label }) => {
      checkAbort();
      let blob: Blob;
      if (typeof source !== "string") blob = source;
      else {
        const signal = opts.signal
          ? AbortSignal.any([opts.signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000);
        const response = await fetch(toProxied(source), {
          signal,
          credentials: "omit",
        });
        if (!response.ok)
          throw new Error(
            `Could not download “${label}”. Retry or replace its artwork.`
          );
        blob = await response.blob();
      }
      if (!blob.type.startsWith("image/"))
        throw new Error(
          `“${label}” did not return an image. Choose another artwork and retry.`
        );
      checkAbort();
      const extension =
        (
          {
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/gif": "gif",
            "image/avif": "avif",
          } as Record<string, string>
        )[blob.type] ?? "png";
      zip.file(`${filename}.${extension}`, await blob.arrayBuffer());
      opts.onProgress?.((++completed / jobs.length) * 90);
    },
    opts.concurrency ?? 4,
    opts.signal
  );
  checkAbort();
  const content = await zip.generateAsync({ type: "blob" }, (metadata) => {
    checkAbort();
    opts.onProgress?.(90 + metadata.percent / 10);
  });
  checkAbort();
  saveAs(
    content,
    `${sanitize(opts.fileBaseName || "card_images")}_${new Date().toISOString().slice(0, 10)}.zip`
  );
}
