import { buildDecklist, downloadDecklist } from "@/helpers/DecklistHelper";
import { useCardsStore, useLoadingStore, useSettingsStore } from "@/store";
import type { LoadingTask } from "@/store/loading";
import { errorMessage, notify } from "@/store/notifications";
import { Download, Files, Copy, FileText } from "lucide-react";

export function ExportActions() {
  const cards = useCardsStore((s) => s.cards);
  const busy = useLoadingStore((s) => s.loadingTask);
  const s = useSettingsStore();
  async function run(
    task: LoadingTask,
    work: (signal: AbortSignal) => Promise<void>
  ) {
    if (useLoadingStore.getState().loadingTask || !cards.length) return;
    const controller = new AbortController();
    useLoadingStore
      .getState()
      .setLoadingTask(task, {
        onCancel: () => controller.abort(),
        cancelLabel: "Cancel export",
      });
    try {
      await work(controller.signal);
      notify("Export ready. Your download has started.", "success");
    } catch (error) {
      notify(
        controller.signal.aborted
          ? "Export cancelled. Any batches already downloaded are kept."
          : `Export stopped. ${errorMessage(error)}`,
        controller.signal.aborted ? "info" : "error"
      );
    } finally {
      useLoadingStore.getState().setLoadingTask(null);
    }
  }
  async function exportPdf(back = false) {
    await run(
      s.exportCollated
        ? "Generating Collated PDF"
        : back
          ? "Generating Cardback PDF"
          : "Generating PDF",
      async (signal) => {
        const { exportProxyPagesToPdf } = await import(
          "@/helpers/ExportProxyPageToPdf"
        );
        const images = useCardsStore.getState();
        await exportProxyPagesToPdf({
          ...s,
          ...images,
          bleedEdgeWidthMm: s.bleedEdgeWidth,
          guideWidthPx: s.guideWidth,
          useBatching: s.useExportBatching,
          pagesPerBatch: s.exportBatchSize,
          isBackSide: back,
          customCardbackUrl: s.customCardbackUrl ?? undefined,
          onProgress: useLoadingStore.getState().setLoadingProgress,
          abortSignal: signal,
        });
      }
    );
  }
  const disabled = !cards.length || !!busy;
  return (
    <section className="export-actions" aria-labelledby="export-heading">
      <div className="export-heading">
        <h3 id="export-heading">Ready to print</h3>
        <span className="hint">{s.exportDpi} DPI</span>
      </div>
      <button
        className="primary-button w-full"
        disabled={disabled}
        onClick={() => void exportPdf()}
      >
        <Download size={18} aria-hidden="true" />
        {s.exportCollated ? "Export collated PDF" : "Export fronts PDF"}
      </button>
      {!s.exportCollated && (
        <button
          className="secondary-button w-full"
          disabled={disabled}
          onClick={() => void exportPdf(true)}
        >
          <Files size={17} aria-hidden="true" />
          Export backs PDF
        </button>
      )}
      <button
        className="secondary-button w-full"
        disabled={disabled}
        onClick={() =>
          void run("Generating ZIP", async (signal) => {
            const { ExportImagesZip } = await import(
              "@/helpers/ExportImagesZip"
            );
            await ExportImagesZip({
              ...useCardsStore.getState(),
              includeDoubleFaces: s.includeDoubleFacesInZip,
              useOriginalCardNames: s.useOriginalCardNames,
              prefixIndexToExportNames: s.prefixIndexToExportNames,
              signal,
              onProgress: useLoadingStore.getState().setLoadingProgress,
            });
          })
        }
      >
        <FileText size={17} aria-hidden="true" />
        Download original images · ZIP
      </button>
      <div className="field-grid">
        <button
          className="text-button"
          disabled={disabled}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                buildDecklist(cards, { style: "withSetNum", sort: "none" })
              );
              notify("Decklist copied.", "success");
            } catch {
              notify(
                "Clipboard is unavailable. Use Download list to save the decklist.",
                "error"
              );
            }
          }}
        >
          <Copy size={14} aria-hidden="true" />
          Copy list
        </button>
        <button
          className="text-button"
          disabled={disabled}
          onClick={() =>
            downloadDecklist(
              "proxxied-decklist.txt",
              buildDecklist(cards, { style: "withSetNum", sort: "none" })
            )
          }
        >
          Download list
        </button>
      </div>
      <a
        className="project-link"
        href="https://buymeacoffee.com/kaiserclipston"
        target="_blank"
        rel="noreferrer"
      >
        Support Proxxied ↗
      </a>
    </section>
  );
}
