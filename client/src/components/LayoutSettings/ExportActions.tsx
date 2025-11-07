import { buildDecklist, downloadDecklist } from "@/helpers/DecklistHelper";
import { useCardsStore } from "@/store/cards";
import { useLoadingStore } from "@/store/loading";
import { useSettingsStore } from "@/store/settings";
import { Button, Spinner } from "flowbite-react";

export function ExportActions() {
  const setLoadingTask = useLoadingStore((state) => state.setLoadingTask);
  const setLoadingProgress = useLoadingStore((state) => state.setLoadingProgress);

  const cards = useCardsStore((state) => state.cards);
  const originalSelectedImages = useCardsStore(
    (state) => state.originalSelectedImages
  );
  const cachedImageUrls = useCardsStore((state) => state.cachedImageUrls);
  const uploadedFiles = useCardsStore((state) => state.uploadedFiles);

  const isProcessing = useSettingsStore((state) => state.isProcessing);
  const pageOrientation = useSettingsStore((state) => state.pageOrientation);
  const pageSizePreset = useSettingsStore((state) => state.pageSizePreset);
  const pageSizeUnit = useSettingsStore((state) => state.pageSizeUnit);
  const pageWidth = useSettingsStore((state) => state.pageWidth);
  const pageHeight = useSettingsStore((state) => state.pageHeight);
  const columns = useSettingsStore((state) => state.columns);
  const rows = useSettingsStore((state) => state.rows);
  const bleedEdgeWidth = useSettingsStore((state) => state.bleedEdgeWidth);
  const useCornerGuides = useSettingsStore((state) => state.useCornerGuides);
  const guideColor = useSettingsStore((state) => state.guideColor);
  const guideWidth = useSettingsStore((state) => state.guideWidth);
  const cardSpacingMm = useSettingsStore((state) => state.cardSpacingMm);
  const exportDpi = useSettingsStore((state) => state.exportDpi);
  const roundedCornerGuides = useSettingsStore((state) => state.roundedCornerGuides);
  const cornerGuideOffsetMm = useSettingsStore((state) => state.cornerGuideOffsetMm);
  const useExportBatching = useSettingsStore((state) => state.useExportBatching);
  const exportBatchSize = useSettingsStore((state) => state.exportBatchSize);
  const processingProgress = useSettingsStore((state) => state.processingProgress);
  const includeDoubleFacesInZip = useSettingsStore((state) => state.includeDoubleFacesInZip);
  const customCardbackUrl = useSettingsStore((state) => state.customCardbackUrl);
  const customCardbackHasBleed = useSettingsStore((state) => state.customCardbackHasBleed);
  const disableBackPageGuides = useSettingsStore((state) => state.disableBackPageGuides);
  const exportCollated = useSettingsStore((state) => state.exportCollated);

  const handleCopyDecklist = async () => {
    const text = buildDecklist(cards, { style: "withSetNum", sort: "alpha" });
    await navigator.clipboard.writeText(text);
  };

  const handleDownloadDecklist = () => {
    const text = buildDecklist(cards, { style: "withSetNum", sort: "alpha" });
    const date = new Date().toISOString().slice(0, 10);
    downloadDecklist(`decklist_${date}.txt`, text);
  };

  const handleExport = async (isBackSide = false) => {
    if (!cards.length) return;
    if (isProcessing) return;

    const controller = new AbortController();
    const cancelHandler = () => controller.abort();

    const taskName = exportCollated ? "Generating Collated PDF" : (isBackSide ? "Generating Cardback PDF" : "Generating PDF");
    setLoadingTask(taskName, {
      onCancel: cancelHandler,
      cancelLabel: "Cancel export",
    });
    setLoadingProgress({ reset: true, overall: 0, pageProgress: null, currentPage: null, totalPages: null });
    try {
      const { exportProxyPagesToPdf } = await import("@/helpers/ExportProxyPageToPdf");
      await exportProxyPagesToPdf({
        cards,
        originalSelectedImages,
        cachedImageUrls,
        uploadedFiles,
        useCornerGuides: isBackSide && disableBackPageGuides ? false : useCornerGuides,
        bleedEdgeWidthMm: bleedEdgeWidth,
        guideColor,
        guideWidthPx: guideWidth,
        pageOrientation,
        pageSizePreset,
        pageSizeUnit,
        pageWidth,
        pageHeight,
        columns,
        rows,
        cardSpacingMm,
        exportDpi,
        roundedCornerGuides,
        cornerGuideOffsetMm,
        useBatching: useExportBatching,
        pagesPerBatch: exportBatchSize,
        onProgress: (value: any) => setLoadingProgress(value),
        abortSignal: controller.signal,
        isBackSide,
        customCardbackUrl: customCardbackUrl || undefined,
        customCardbackHasBleed,
        exportCollated,
        disableBackPageGuides,
      });
    } catch (err) {
      if (controller.signal.aborted || (err as any)?.name === "AbortError") {
        // Swallow cancellation
      } else {
        console.error("Export failed:", err);
      }
    } finally {
      setLoadingTask(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {!exportCollated ? (
        <>
          <Button color="green" onClick={() => handleExport(false)} disabled={!cards.length || isProcessing}>
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <Spinner size="md" color="purple" />
                <span className="whitespace-nowrap">
                  Processing {processingProgress}%
                </span>
              </span>
            ) : (
              <span>Export Fronts to PDF</span>
            )}
          </Button>

          <Button color="purple" onClick={() => handleExport(true)} disabled={!cards.length || isProcessing}>
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <Spinner size="md" color="purple" />
                <span className="whitespace-nowrap">
                  Processing {processingProgress}%
                </span>
              </span>
            ) : (
              <span>Export Backs to PDF</span>
            )}
          </Button>
        </>
      ) : (
        <Button color="blue" onClick={() => handleExport(false)} disabled={!cards.length || isProcessing}>
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <Spinner size="md" color="purple" />
              <span className="whitespace-nowrap">
                Processing {processingProgress}%
              </span>
            </span>
          ) : (
            <span>Export PDF (Collated)</span>
          )}
        </Button>
      )}

      <Button
        color="indigo"
        onClick={async () => {
          const { ExportImagesZip } = await import("@/helpers/ExportImagesZip");
          ExportImagesZip({
            cards,
            originalSelectedImages,
            cachedImageUrls,
            uploadedFiles,
            fileBaseName: "card_images",
            includeDoubleFaces: includeDoubleFacesInZip,
          });
        }}
        disabled={!cards.length}
      >
        Export Card Images (.zip)
      </Button>

      <Button color="cyan" onClick={handleCopyDecklist} disabled={!cards.length}>
        Copy Decklist
      </Button>

      <Button color="blue" onClick={handleDownloadDecklist} disabled={!cards.length}>
        Download Decklist (.txt)
      </Button>

      <a
        href="https://buymeacoffee.com/kaiserclipston"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button size="sm" className="bg-yellow-500 hover:bg-yellow-600 w-full">
          Buy Me a Coffee
        </Button>
      </a>
    </div>
  );
}
