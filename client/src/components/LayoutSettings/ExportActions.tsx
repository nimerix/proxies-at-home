import { buildDecklist, downloadDecklist } from "@/helpers/DecklistHelper";
import { ExportImagesZip } from "@/helpers/ExportImagesZip";
import { exportProxyPagesToPdf } from "@/helpers/ExportProxyPageToPdf";
import { useCardsStore } from "@/store/cards";
import { useLoadingStore } from "@/store/loading";
import { useSettingsStore } from "@/store/settings";
import { Button } from "flowbite-react";

export function ExportActions() {
  const setLoadingTask = useLoadingStore((state) => state.setLoadingTask);

  const cards = useCardsStore((state) => state.cards);
  const originalSelectedImages = useCardsStore(
    (state) => state.originalSelectedImages
  );
  const cachedImageUrls = useCardsStore((state) => state.cachedImageUrls); // <-- NEW
  const uploadedFiles = useCardsStore((state) => state.uploadedFiles);

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

  const handleCopyDecklist = async () => {
    const text = buildDecklist(cards, { style: "withSetNum", sort: "alpha" });
    await navigator.clipboard.writeText(text);
  };

  const handleDownloadDecklist = () => {
    const text = buildDecklist(cards, { style: "withSetNum", sort: "alpha" });
    const date = new Date().toISOString().slice(0, 10);
    downloadDecklist(`decklist_${date}.txt`, text);
  };

  const handleExport = async () => {
    if (!cards.length) return;

    setLoadingTask("Generating PDF");
    try {
      await exportProxyPagesToPdf({
        cards,
        originalSelectedImages,
        cachedImageUrls,
        uploadedFiles,
        useCornerGuides,
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
      });
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setLoadingTask(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button color="green" onClick={handleExport} disabled={!cards.length}>
        Export to PDF
      </Button>

      <Button
        color="indigo"
        onClick={() =>
          ExportImagesZip({
            cards,
            originalSelectedImages,
            uploadedFiles,
            fileBaseName: "card_images",
            // If your zip helper later supports it, you can pass cachedImageUrls here too.
          })
        }
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
