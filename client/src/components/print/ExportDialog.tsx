import { useEffect, useRef } from "react";
import { Copy, Download, FileText, Files, X } from "lucide-react";
import { buildDecklist, downloadDecklist } from "@/helpers/DecklistHelper";
import { plural } from "@/helpers/plural";
import {
  useCardsStore,
  useLoadingStore,
  useSettingsStore,
  useUiStore,
} from "@/store";
import type { LoadingTask } from "@/store/loading";
import type { ExportDpi } from "@/store/settings";
import { errorMessage, notify } from "@/store/notifications";
import { NumberInput } from "../NumberInput";

export function ExportDialog() {
  const open = useUiStore((s) => s.exportOpen);
  return open ? <ExportPanel /> : null;
}

function ExportPanel() {
  const dialog = useRef<HTMLDialogElement>(null);
  const cards = useCardsStore((s) => s.cards);
  const busy = useLoadingStore((s) => s.loadingTask);
  const s = useSettingsStore();
  const close = () => useUiStore.getState().setExportOpen(false);
  useEffect(() => {
    const el = dialog.current,
      opener = document.activeElement;
    el?.showModal();
    return () => {
      el?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const collated = s.twoSided && s.exportCollated;
  async function run(
    task: LoadingTask,
    work: (signal: AbortSignal) => Promise<void>
  ) {
    if (useLoadingStore.getState().loadingTask || !cards.length) return;
    const controller = new AbortController();
    useLoadingStore.getState().setLoadingTask(task, {
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
      collated
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
          exportCollated: collated,
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
  function start(task: () => unknown) {
    close();
    void task();
  }
  const sheets = Math.ceil(cards.length / (s.columns * s.rows));
  const paper =
    s.pageOrientation === "landscape"
      ? `${s.pageSizePreset} landscape`
      : s.pageSizePreset;
  const summary = `${plural(cards.length, "card", "cards")} on ${plural(
    sheets,
    `${paper} sheet`,
    `${paper} sheets`
  )}, ${s.twoSided ? "two-sided" : "one-sided"}, ${s.bleedEdgeWidth} mm bleed.`;
  const disabled = !cards.length || !!busy;
  const decklist = () =>
    buildDecklist(cards, { style: "withSetNum", sort: "none" });
  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      aria-labelledby="export-title"
      aria-describedby="export-summary"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="dialog-heading">
        <h2 id="export-title">Export</h2>
        <button
          className="icon-button"
          aria-label="Close export"
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="dialog-body export-body">
        <p id="export-summary" className="export-summary">
          {summary}
        </p>
        {s.twoSided && (
          <fieldset>
            <legend>Two-sided output</legend>
            <label className="check-field">
              <input
                type="radio"
                name="two-sided-output"
                checked={s.exportCollated}
                onChange={() => s.setExportCollated(true)}
              />
              One file, fronts and backs alternating
            </label>
            <label className="check-field">
              <input
                type="radio"
                name="two-sided-output"
                checked={!s.exportCollated}
                onChange={() => s.setExportCollated(false)}
              />
              Two files, fronts and backs
            </label>
          </fieldset>
        )}
        <section className="export-section" aria-labelledby="quality-heading">
          <h3 id="quality-heading">Quality</h3>
          <div className="field">
            <label htmlFor="export-dpi">Resolution</label>
            <select
              id="export-dpi"
              value={s.exportDpi}
              onChange={(e) =>
                s.setExportDpi(Number(e.target.value) as ExportDpi)
              }
              aria-describedby="export-dpi-help"
            >
              <option value={600}>600 DPI · standard</option>
              <option value={900}>900 DPI · high</option>
              <option value={1200}>1200 DPI · maximum</option>
            </select>
            <p id="export-dpi-help" className="hint">
              Higher DPI uses more memory and makes larger PDFs. It cannot
              restore detail absent from the original image.
            </p>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={s.useExportBatching}
              onChange={(e) => s.setUseExportBatching(e.target.checked)}
            />{" "}
            Split PDF into smaller files
          </label>
          <div className="field">
            <label htmlFor="batch-size">Pages per file</label>
            <NumberInput
              id="batch-size"
              min={1}
              max={20}
              value={s.exportBatchSize}
              disabled={!s.useExportBatching}
              onCommit={s.setExportBatchSize}
              aria-describedby={collated ? "batch-size-help" : undefined}
            />
            {collated && (
              <p id="batch-size-help" className="hint">
                Collated exports keep each front and back pair together.
              </p>
            )}
          </div>
        </section>
        <section className="export-section" aria-labelledby="checklist-heading">
          <h3 id="checklist-heading">Before you print</h3>
          <ul className="print-checklist">
            <li>Print at 100% (actual size).</li>
            {s.twoSided && (
              <li>
                Flip on the{" "}
                {s.pageOrientation === "landscape" ? "short" : "long"} edge.
              </li>
            )}
            <li>Print one sheet first to check alignment.</li>
          </ul>
        </section>
        <div className="export-buttons">
          <button
            className="primary-button"
            disabled={disabled}
            onClick={() => start(() => exportPdf())}
          >
            <Download size={18} aria-hidden="true" />
            {collated ? "Export collated PDF" : "Export fronts PDF"}
          </button>
          {s.twoSided && !collated && (
            <button
              className="secondary-button"
              disabled={disabled}
              onClick={() => start(() => exportPdf(true))}
            >
              <Files size={17} aria-hidden="true" />
              Export backs PDF
            </button>
          )}
        </div>
        <section className="export-section" aria-labelledby="other-heading">
          <h3 id="other-heading">Other downloads</h3>
          <button
            className="secondary-button"
            disabled={disabled}
            onClick={() =>
              start(() =>
                run("Generating ZIP", async (signal) => {
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
              )
            }
          >
            <FileText size={17} aria-hidden="true" />
            Download original images · ZIP
          </button>
          <details className="zip-options">
            <summary>ZIP filename options</summary>
            <div className="setup-body">
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={s.useOriginalCardNames}
                  onChange={(e) => s.setUseOriginalCardNames(e.target.checked)}
                />{" "}
                Use set–number–name filenames
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={s.prefixIndexToExportNames}
                  onChange={(e) =>
                    s.setPrefixIndexToExportNames(e.target.checked)
                  }
                />{" "}
                Prefix filenames with deck order
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={s.includeDoubleFacesInZip}
                  onChange={(e) =>
                    s.setIncludeDoubleFacesInZip(e.target.checked)
                  }
                />{" "}
                Include double faces and assigned backs
              </label>
            </div>
          </details>
          <div className="list-actions">
            <button
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                start(async () => {
                  try {
                    await navigator.clipboard.writeText(decklist());
                    notify("Decklist copied.", "success");
                  } catch {
                    notify(
                      "Clipboard is unavailable. Use Download list to save the decklist.",
                      "error"
                    );
                  }
                })
              }
            >
              <Copy size={16} aria-hidden="true" />
              Copy list
            </button>
            <button
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                start(() =>
                  downloadDecklist("oops-all-proxies-decklist.txt", decklist())
                )
              }
            >
              <Download size={16} aria-hidden="true" />
              Download list
            </button>
          </div>
        </section>
      </div>
    </dialog>
  );
}
