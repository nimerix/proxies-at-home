import { CARD_H_MM, CARD_W_MM } from "@/constants";
import type { LoadingProgressState } from "@/store/loading";
import type { LayoutPreset } from "@/store/settings";
import type { CardOption } from "@/types/Card";
import { saveAs } from "file-saver";
import { PDFDocument, rgb, type PDFPage, type PDFImage } from "pdf-lib";
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
    return rgb(0, 0, 0);
  }
  const r = (parsed >> 16) & 0xff;
  const g = (parsed >> 8) & 0xff;
  const b = parsed & 0xff;
  return rgb(r / 255, g / 255, b / 255);
}

function drawGuides(
  page: PDFPage,
  lines: GuideLine[],
  pageHeightMm: number,
  width: number,
  color: ReturnType<typeof rgb>,
  x = 0,
  y = 0
) {
  for (const line of lines)
    page.drawLine({
      start: toPdfPoint(pageHeightMm, { x: line.x1 + x, y: line.y1 + y }),
      end: toPdfPoint(pageHeightMm, { x: line.x2 + x, y: line.y2 + y }),
      thickness: mmToPt(width),
      color,
    });
}

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

  const renderBatch = async (
    batchPages: (CardOption | null)[][],
    batchStartIndex: number
  ) => {
    throwIfAborted();
    const pdfDoc = await PDFDocument.create();
    const embedded = new Map<string | File, Map<string, PDFImage>>();

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

      const page = pdfDoc.addPage(pageSize);
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageSize[0],
        height: pageSize[1],
        color: rgb(1, 1, 1),
      });

      for (let idx = 0; idx < pageCards.length; idx++) {
        throwIfAborted();
        const card = pageCards[idx];
        if (!card) continue;
        const col = idx % columns;
        const row = Math.floor(idx / columns);

        const cardXmm = startXmm + col * (cardWidthMm + spacingMm);
        const cardYmm = startYmm + row * (cardHeightMm + spacingMm);

        const { source, hasBakedBleed } = cardSource(
          card,
          {
            originalSelectedImages,
            originalSelectedBackImages,
            uploadedFiles,
            uploadedBackFiles,
          },
          isCurrentPageBack,
          customCardbackUrl,
          customCardbackHasBleed
        );
        if (!source)
          throw new Error(
            `Missing image for “${card.name}”. Choose artwork or upload its image before exporting.`
          );
        let uploadUrl: string | undefined;
        const artwork = cardBleedOptions(card, {
          source: bleedSource,
          insetMm: scanInsetMm,
          borders: borderBleed,
          cornerRadiusMm: scanCornerRadiusMm,
        });
        const variantKey = JSON.stringify([hasBakedBleed, artwork]);
        try {
          let cardImage = embedded.get(source)?.get(variantKey);
          if (!cardImage) {
            const src =
              typeof source === "string"
                ? source
                : (uploadUrl = URL.createObjectURL(source));
            const { blob } = await renderCardImage(
              src,
              bleedMm,
              hasBakedBleed,
              exportDpi,
              {
                signal: abortSignal,
                quality: jpegQuality,
                artwork,
              }
            );
            throwIfAborted();
            cardImage = await pdfDoc.embedJpg(await blob.arrayBuffer());
            const variants =
              embedded.get(source) ?? new Map<string, PDFImage>();
            variants.set(variantKey, cardImage);
            embedded.set(source, variants);
          }
          throwIfAborted();
          page.drawImage(cardImage, {
            x: mmToPt(cardXmm),
            y: mmToPt(pageHeightMm - cardYmm - cardHeightMm),
            width: mmToPt(cardWidthMm),
            height: mmToPt(cardHeightMm),
          });
        } catch (error) {
          throwIfAborted();
          throw new Error(
            `Could not export “${card.name}”. Retry or replace its image. ${error instanceof Error ? error.message : ""}`,
            { cause: error }
          );
        } finally {
          if (uploadUrl) URL.revokeObjectURL(uploadUrl);
        }

        if (shouldShowGuides && guideWidthMm > 0) {
          drawGuides(
            page,
            cornerGuideLines(bleedMm, roundedCornerGuides, cornerGuideOffsetMm),
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
          rgb(0, 0, 0)
        );
      }

      currentPageIndex += 1;
    }

    return pdfDoc.save({ useObjectStreams: true });
  };

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchPages = batches[batchIndex];
    const batchStartIndex = batchIndex * effectivePagesPerBatch;
    const pdfBytes = await renderBatch(batchPages, batchStartIndex);
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
    const bytesCopy = pdfBytes.slice();
    const blob = new Blob([bytesCopy.buffer], { type: "application/pdf" });
    saveAs(blob, `oops-all-proxies_${dateSlug}${backSideSuffix}${fileSuffix}.pdf`);
  }

  onProgress?.({
    overall: 100,
    pageProgress: 100,
    currentPage: totalPagesCount > 0 ? totalPagesCount : null,
    totalPages: totalPagesCount > 0 ? totalPagesCount : null,
  });
}
