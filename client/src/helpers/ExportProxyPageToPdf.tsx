import { CARD_H_MM, CARD_W_MM } from "@/constants";
import type { LoadingProgressState } from "@/store/loading";
import type { LayoutPreset } from "@/store/settings";
import type { CardOption } from "@/types/Card";
import { saveAs } from "file-saver";
import {
  PdfWriter,
  drawImageOps,
  drawLineOps,
  drawRectangleOps,
  type PdfColor,
} from "./pdfWriter";
import { renderCardImage } from "./renderCardImage";
import { cardSource } from "./cardSources";
import { cardBleedOptions } from "./cardBleedOptions";
import {
  DEFAULT_SCAN_INSET_MM,
  type BleedArtworkOptions,
} from "./bleedArtwork";
import {
  cornerGuideLines,
  edgeGuideLines,
  type GuideLine,
} from "./printGuides";
import { pageSlots } from "./printLayout";

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

const mmToPt = (mm: number) => (mm / MM_PER_INCH) * POINTS_PER_INCH;

function toPdfPoint(pageHeightMm: number, point: { x: number; y: number }) {
  return {
    x: mmToPt(point.x),
    y: mmToPt(pageHeightMm - point.y),
  };
}

function parseHexColor(value: string) {
  const normalized = value.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized.padEnd(6, "0");
  const parsed = Number.parseInt(expanded.slice(0, 6), 16);
  if (Number.isNaN(parsed)) {
    return { r: 0, g: 0, b: 0 };
  }
  const r = (parsed >> 16) & 0xff;
  const g = (parsed >> 8) & 0xff;
  const b = parsed & 0xff;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

function drawGuides(
  page: string[],
  lines: GuideLine[],
  pageHeightMm: number,
  width: number,
  color: PdfColor,
  x = 0,
  y = 0
) {
  for (const line of lines)
    page.push(
      ...drawLineOps(
        toPdfPoint(pageHeightMm, { x: line.x1 + x, y: line.y1 + y }),
        toPdfPoint(pageHeightMm, { x: line.x2 + x, y: line.y2 + y }),
        mmToPt(width),
        color
      )
    );
}

// Renders run one at a time; downloading a few cards ahead hides the network.
const PREFETCH = 3;

function chunkPages<T>(items: readonly T[], size: number): T[][] {
  const chunkSize = Math.max(1, size | 0);
  if (items.length <= chunkSize) return [Array.from(items)];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
}

export async function exportProxyPagesToPdf({
  cards,
  originalSelectedImages,
  uploadedFiles,
  originalSelectedBackImages,
  uploadedBackFiles,
  useCornerGuides,
  bleedEdgeWidthMm,
  guideColor,
  guideWidthPx,
  pageSizeUnit,
  pageWidth,
  pageHeight,
  columns,
  rows,
  cardSpacingMm,
  exportDpi = 600,
  bleedSource = "scan",
  scanInsetMm = DEFAULT_SCAN_INSET_MM,
  borderBleed = "auto",
  scanCornerRadiusMm = 2.5,
  roundedCornerGuides = false,
  cornerGuideOffsetMm = 0,
  useBatching = false,
  pagesPerBatch = 20,
  onProgress,
  abortSignal,
  isBackSide = false,
  customCardbackUrl,
  customCardbackHasBleed = false,
  exportCollated = false,
  disableBackPageGuides = true,
}: {
  cards: CardOption[];
  originalSelectedImages: Record<string, string>;
  uploadedFiles?: Record<string, File>;
  originalSelectedBackImages?: Record<string, string>;
  uploadedBackFiles?: Record<string, File>;
  useCornerGuides: boolean;
  bleedEdgeWidthMm: number;
  guideColor: string;
  guideWidthPx: number;
  pageOrientation: "portrait" | "landscape";
  pageSizePreset: LayoutPreset;
  pageSizeUnit: "mm" | "in";
  pageWidth: number;
  pageHeight: number;
  columns: number;
  rows: number;
  cardSpacingMm: number;
  exportDpi?: number;
  bleedSource?: BleedArtworkOptions["source"];
  scanInsetMm?: number;
  borderBleed?: "auto" | "mirror";
  scanCornerRadiusMm?: number;
  roundedCornerGuides?: boolean;
  cornerGuideOffsetMm?: number;
  useBatching?: boolean;
  pagesPerBatch?: number;
  onProgress?: (progress: LoadingProgressState) => void;
  abortSignal?: AbortSignal;
  isBackSide?: boolean;
  customCardbackUrl?: string;
  customCardbackHasBleed?: boolean;
  exportCollated?: boolean;
  disableBackPageGuides?: boolean;
}) {
  if (!cards.length) return;

  const throwIfAborted = () => {
    if (abortSignal?.aborted) {
      throw new DOMException("Export cancelled", "AbortError");
    }
  };

  throwIfAborted();

  const bleedMm = bleedEdgeWidthMm;
  const contentWidthMm = CARD_W_MM;
  const contentHeightMm = CARD_H_MM;
  const cardWidthMm = contentWidthMm + bleedMm * 2;
  const cardHeightMm = contentHeightMm + bleedMm * 2;
  const spacingMm = cardSpacingMm || 0;

  const pageWidthMm =
    pageSizeUnit === "in" ? pageWidth * MM_PER_INCH : pageWidth;
  const pageHeightMm =
    pageSizeUnit === "in" ? pageHeight * MM_PER_INCH : pageHeight;

  const perPage = Math.max(1, columns * rows);
  const gridWidthMm =
    columns * cardWidthMm + Math.max(0, columns - 1) * spacingMm;
  const gridHeightMm = rows * cardHeightMm + Math.max(0, rows - 1) * spacingMm;
  if (
    ![columns, rows].every((n) => Number.isInteger(n) && n > 0 && n <= 20) ||
    ![bleedMm, spacingMm].every((n) => Number.isFinite(n) && n >= 0) ||
    !Number.isFinite(pageWidthMm) ||
    !Number.isFinite(pageHeightMm) ||
    gridWidthMm > pageWidthMm + 0.001 ||
    gridHeightMm > pageHeightMm + 0.001
  ) {
    throw new Error(
      "The card grid does not fit on this page. Reduce the rows, columns, spacing or bleed."
    );
  }
  const startXmm = Math.max(0, (pageWidthMm - gridWidthMm) / 2);
  const startYmm = Math.max(0, (pageHeightMm - gridHeightMm) / 2);

  // Track whether each page is a front or back page for collated mode
  const pageTypes: ("front" | "back")[] = [];
  const pages: (CardOption | null)[][] = [];

  for (let i = 0; i < cards.length; i += perPage) {
    const slice = cards.slice(i, i + perPage);
    if (!isBackSide || exportCollated) {
      pages.push(pageSlots(slice, columns, rows));
      pageTypes.push("front");
    }
    if (isBackSide || exportCollated) {
      pages.push(pageSlots(slice, columns, rows, true));
      pageTypes.push("back");
    }
  }

  const guideWidthMm = (Math.max(0, guideWidthPx) * 25.4) / 96;
  const guideColorRgb = parseHexColor(guideColor);

  const jpegQuality = exportDpi >= 1200 ? 0.96 : exportDpi >= 900 ? 0.97 : 1.0;
  const pageSize: [number, number] = [
    mmToPt(pageWidthMm),
    mmToPt(pageHeightMm),
  ];
  const effectivePagesPerBatch = useBatching
    ? exportCollated
      ? Math.max(2, Math.floor(pagesPerBatch / 2) * 2)
      : Math.max(1, pagesPerBatch | 0)
    : pages.length || 1;
  const batches = useBatching
    ? chunkPages(pages, effectivePagesPerBatch)
    : [pages];
  const totalBatches = batches.length;
  const dateSlug = new Date().toISOString().slice(0, 10);

  const totalPagesCount = pages.length;
  const totalCardsCount = cards.length * (exportCollated ? 2 : 1);
  let processedCards = 0;
  let currentPageIndex = 0;
  let processedCardsOnPage = 0;
  let currentPageCardCount = pages[0]?.filter(Boolean).length ?? 0;

  const emitProgress = () => {
    throwIfAborted();

    const overallPercent = totalCardsCount
      ? Math.round((processedCards / totalCardsCount) * 100)
      : null;
    const normalizedOverall =
      overallPercent === null
        ? null
        : processedCards >= totalCardsCount
          ? 100
          : Math.min(99, Math.max(0, overallPercent));

    const pagePercent = currentPageCardCount
      ? Math.round((processedCardsOnPage / currentPageCardCount) * 100)
      : totalPagesCount > 0
        ? 100
        : null;
    const normalizedPage =
      pagePercent == null ? null : Math.max(0, Math.min(100, pagePercent));

    onProgress?.({
      overall: normalizedOverall,
      pageProgress: normalizedPage,
      currentPage:
        totalPagesCount > 0
          ? Math.min(totalPagesCount, currentPageIndex + 1)
          : null,
      totalPages: totalPagesCount > 0 ? totalPagesCount : null,
    });
  };

  emitProgress();

  const cardImageSource = (card: CardOption, isBack: boolean) => {
    const { source, hasBakedBleed } = cardSource(
      card,
      {
        originalSelectedImages,
        originalSelectedBackImages,
        uploadedFiles,
        uploadedBackFiles,
      },
      isBack,
      customCardbackUrl,
      customCardbackHasBleed
    );
    const artwork = cardBleedOptions(card, {
      source: bleedSource,
      insetMm: scanInsetMm,
      borders: borderBleed,
      cornerRadiusMm: scanCornerRadiusMm,
    });
    return {
      source,
      hasBakedBleed,
      artwork,
      variantKey: JSON.stringify([hasBakedBleed, artwork]),
    };
  };

  const renderBatch = async (
    batchPages: (CardOption | null)[][],
    batchStartIndex: number
  ) => {
    throwIfAborted();
    const pdf = new PdfWriter();
    const embedded = new Map<string | File, Map<string, number>>();
    const prefetch = new AbortController();
    const signal = abortSignal
      ? AbortSignal.any([abortSignal, prefetch.signal])
      : prefetch.signal;
    type Render = {
      start: () => Promise<Blob>;
      promise?: Promise<Blob>;
    };
    const renders = new Map<string | File, Map<string, Render>>();
    const order: Render[] = [];
    batchPages.forEach((pageCards, pageIndexInBatch) => {
      const isBack = pageTypes[batchStartIndex + pageIndexInBatch] === "back";
      for (const card of pageCards) {
        if (!card) continue;
        const { source, hasBakedBleed, artwork, variantKey } = cardImageSource(
          card,
          isBack
        );
        if (!source || renders.get(source)?.has(variantKey)) continue;
        const render: Render = {
          start: () =>
            (render.promise ??= (async () => {
              const uploadUrl =
                typeof source === "string"
                  ? undefined
                  : URL.createObjectURL(source);
              try {
                const { blob } = await renderCardImage(
                  uploadUrl ?? (source as string),
                  bleedMm,
                  hasBakedBleed,
                  exportDpi,
                  { signal, quality: jpegQuality, artwork }
                );
                return blob;
              } finally {
                if (uploadUrl) URL.revokeObjectURL(uploadUrl);
              }
            })()),
        };
        // Failures are reported when their card is reached, in page order.
        const startAndWatch = render.start;
        render.start = () => {
          const promise = startAndWatch();
          promise.catch(() => {});
          return promise;
        };
        const variants = renders.get(source) ?? new Map<string, Render>();
        variants.set(variantKey, render);
        renders.set(source, variants);
        order.push(render);
      }
    });
    let consumed = 0;
    const startAhead = () => {
      for (const render of order.slice(consumed, consumed + PREFETCH))
        render.start();
    };

    try {
      for (
        let pageIndexInBatch = 0;
        pageIndexInBatch < batchPages.length;
        pageIndexInBatch++
      ) {
        const pageCards = batchPages[pageIndexInBatch];
        const globalPageIndex = batchStartIndex + pageIndexInBatch;
        const currentPageType = pageTypes[globalPageIndex];
        const isCurrentPageBack = currentPageType === "back";

        // Determine if we should show guides on this page
        const shouldShowGuides =
          useCornerGuides && !(isCurrentPageBack && disableBackPageGuides);

        throwIfAborted();
        currentPageCardCount = pageCards.filter(Boolean).length;
        processedCardsOnPage = 0;
        emitProgress();

        const page = drawRectangleOps(0, 0, pageSize[0], pageSize[1], {
          r: 1,
          g: 1,
          b: 1,
        });
        const pageImages = new Map<string, number>();

        for (let idx = 0; idx < pageCards.length; idx++) {
          throwIfAborted();
          const card = pageCards[idx];
          if (!card) continue;
          const col = idx % columns;
          const row = Math.floor(idx / columns);

          const cardXmm = startXmm + col * (cardWidthMm + spacingMm);
          const cardYmm = startYmm + row * (cardHeightMm + spacingMm);

          const { source, variantKey } = cardImageSource(
            card,
            isCurrentPageBack
          );
          if (!source)
            throw new Error(
              `Missing image for “${card.name}”. Choose artwork or upload its image before exporting.`
            );
          try {
            let cardImage = embedded.get(source)?.get(variantKey);
            if (!cardImage) {
              const render = renders.get(source)!.get(variantKey)!;
              consumed = Math.max(consumed, order.indexOf(render) + 1);
              startAhead();
              const blob = await render.start();
              throwIfAborted();
              cardImage = await pdf.addJpeg(blob);
              const variants =
                embedded.get(source) ?? new Map<string, number>();
              variants.set(variantKey, cardImage);
              embedded.set(source, variants);
            }
            throwIfAborted();
            const name = `Image-${cardImage}`;
            pageImages.set(name, cardImage);
            page.push(
              ...drawImageOps(
                name,
                mmToPt(cardXmm),
                mmToPt(pageHeightMm - cardYmm - cardHeightMm),
                mmToPt(cardWidthMm),
                mmToPt(cardHeightMm)
              )
            );
          } catch (error) {
            throwIfAborted();
            throw new Error(
              `Could not export “${card.name}”. Retry or replace its image. ${error instanceof Error ? error.message : ""}`,
              { cause: error }
            );
          }

          if (shouldShowGuides && guideWidthMm > 0) {
            drawGuides(
              page,
              cornerGuideLines(
                bleedMm,
                roundedCornerGuides,
                cornerGuideOffsetMm
              ),
              pageHeightMm,
              guideWidthMm,
              guideColorRgb,
              cardXmm,
              cardYmm
            );
          }

          processedCards += 1;
          processedCardsOnPage += 1;
          emitProgress();
          // Let the browser paint progress and receive cancellation between cards.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }

        if (shouldShowGuides && guideWidthMm > 0) {
          drawGuides(
            page,
            edgeGuideLines({
              pageWidth,
              pageHeight,
              pageSizeUnit,
              columns,
              rows,
              bleedEdgeWidth: bleedMm,
              cardSpacingMm: spacingMm,
            }),
            pageHeightMm,
            guideWidthMm,
            { r: 0, g: 0, b: 0 }
          );
        }

        pdf.addPage(pageSize, page, pageImages);
        currentPageIndex += 1;
      }
    } finally {
      prefetch.abort();
    }

    return pdf.finish();
  };

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchPages = batches[batchIndex];
    const batchStartIndex = batchIndex * effectivePagesPerBatch;
    const blob = await renderBatch(batchPages, batchStartIndex);
    throwIfAborted();
    const fileSuffix =
      totalBatches > 1
        ? `_part-${String(batchIndex + 1).padStart(2, "0")}-of-${String(totalBatches).padStart(2, "0")}`
        : "";
    const backSideSuffix = exportCollated
      ? "_collated"
      : isBackSide
        ? "_backs"
        : "";
    saveAs(
      blob,
      `oops-all-proxies_${dateSlug}${backSideSuffix}${fileSuffix}.pdf`
    );
  }

  onProgress?.({
    overall: 100,
    pageProgress: 100,
    currentPage: totalPagesCount > 0 ? totalPagesCount : null,
    totalPages: totalPagesCount > 0 ? totalPagesCount : null,
  });
}
