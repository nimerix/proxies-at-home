import { useCardsStore, useLoadingStore, useSettingsStore } from "@/store";
import type { ExportDpi } from "@/store/settings";
import { useEffect, useRef } from "react";
import { NumberInput } from "./NumberInput";
import { ExportActions } from "./LayoutSettings/ExportActions";
import { PageSizeControl } from "./LayoutSettings/PageSizeControl";
import { GridControls } from "./LayoutSettings/GridControl";
import { CardbackSettings } from "./LayoutSettings/CardbackSettings";
import { printLayout } from "@/helpers/printLayout";
import { errorMessage, notify } from "@/store/notifications";

export function PageSettingsControls() {
  const s = useSettingsStore();
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    useCardsStore.setState({ selectedImages: {}, selectedBackFaceImages: {} });
  }, [
    s.bleedEdgeWidth,
    s.useHighQualityPreviews,
    s.customCardbackUrl,
    s.customCardbackHasBleed,
  ]);
  const maxSpacing = Math.floor(printLayout(s).maxSpacing * 10) / 10;
  return (
    <aside
      id="settings-panel"
      className="workspace-panel settings-panel"
      aria-labelledby="settings-heading"
    >
      <div className="panel-heading">
        <span className="eyebrow">03 / Make it print ready</span>
        <h2 id="settings-heading">Print settings</h2>
        <p>Actual-size cards. A layout that fits.</p>
      </div>
      <div className="settings-sections">
        <details open>
          <summary>Paper & layout</summary>
          <div className="settings-body">
            <PageSizeControl />
            <GridControls />
            <div className="field-grid">
              <div className="field">
                <label htmlFor="bleed">Bleed (mm)</label>
                <NumberInput
                  id="bleed"
                  min={0}
                  max={5}
                  step={0.5}
                  value={s.bleedEdgeWidth}
                  onCommit={s.setBleedEdgeWidth}
                />
              </div>
              <div className="field">
                <label htmlFor="spacing">Spacing (mm)</label>
                <NumberInput
                  id="spacing"
                  min={0}
                  max={maxSpacing}
                  step={0.5}
                  value={s.cardSpacingMm}
                  onCommit={s.setCardSpacingMm}
                />
              </div>
            </div>
            <p className="hint">
              Grid limits include bleed. Larger bleed or smaller paper may
              reduce the rows or columns to keep every card on the sheet.
            </p>
            <label className="check-field">
              <input
                type="checkbox"
                checked={s.useHighQualityPreviews}
                onChange={(e) => s.setUseHighQualityPreviews(e.target.checked)}
              />{" "}
              Sharper previews <span className="hint">(more memory)</span>
            </label>
          </div>
        </details>
        <details>
          <summary>Cutting guides</summary>
          <div className="settings-body">
            <label className="check-field">
              <input
                type="checkbox"
                checked={s.useCornerGuides}
                onChange={(e) => s.setUseCornerGuides(e.target.checked)}
              />{" "}
              Show cutting guides
            </label>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="guide-color">Color</label>
                <input
                  id="guide-color"
                  type="color"
                  value={s.guideColor}
                  disabled={!s.useCornerGuides}
                  onChange={(e) => s.setGuideColor(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="guide-width">Width (px)</label>
                <NumberInput
                  id="guide-width"
                  min={0.1}
                  max={4}
                  step={0.1}
                  value={s.guideWidth}
                  disabled={!s.useCornerGuides}
                  onCommit={s.setGuideWidth}
                />
              </div>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={s.roundedCornerGuides}
                disabled={!s.useCornerGuides}
                onChange={(e) => s.setRoundedCornerGuides(e.target.checked)}
              />{" "}
              Rounded corner guides
            </label>
            <div className="field">
              <label htmlFor="guide-offset">Corner offset (mm)</label>
              <NumberInput
                id="guide-offset"
                min={-2}
                max={2}
                step={0.1}
                disabled={!s.useCornerGuides || !s.roundedCornerGuides}
                value={s.cornerGuideOffsetMm}
                onCommit={s.setCornerGuideOffsetMm}
              />
              <p className="hint">
                Negative values move guides outward. Guide width uses 96 pixels
                per inch at every export DPI.
              </p>
            </div>
          </div>
        </details>
        <details>
          <summary>Card backs & duplex</summary>
          <div className="settings-body">
            <CardbackSettings />
          </div>
        </details>
        <details>
          <summary>Export quality & files</summary>
          <div className="settings-body">
            <div className="field">
              <label htmlFor="export-dpi">Resolution</label>
              <select
                id="export-dpi"
                value={s.exportDpi}
                onChange={(e) =>
                  s.setExportDpi(Number(e.target.value) as ExportDpi)
                }
              >
                <option value={600}>600 DPI · standard</option>
                <option value={900}>900 DPI · high</option>
                <option value={1200}>1200 DPI · maximum</option>
              </select>
              <p className="hint">
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
              />
              <p className="hint">
                Collated exports keep each front and back pair together.
              </p>
            </div>
            <fieldset>
              <legend>ZIP options</legend>
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
            </fieldset>
          </div>
        </details>
      </div>
      <ExportActions />
      <p className="print-note">
        Print at <strong>100% / actual size</strong>. For collated sheets, use{" "}
        <strong>
          flip on {s.pageOrientation === "portrait" ? "long" : "short"} edge
        </strong>{" "}
        in {s.pageOrientation}. Test one sheet before printing a whole deck.
      </p>
      <div className="panel-footer reset-actions">
        <button
          className="text-button"
          onClick={() => {
            if (
              window.confirm(
                "Restore default print settings, including the custom cardback? Your deck will be kept."
              )
            )
              s.resetSettings();
          }}
        >
          Reset settings
        </button>
        <button
          className="text-button danger"
          onClick={async () => {
            if (
              !window.confirm(
                "Delete all cards, uploaded images and print settings saved in this browser? This cannot be undone."
              )
            )
              return;
            useLoadingStore.getState().setLoadingTask("Clearing workspace");
            try {
              // Zustand's clearStorage() returns void even for async storage. Await the
              // underlying transactions before reporting success or clearing the UI.
              const cards = useCardsStore.persist.getOptions(),
                settings = useSettingsStore.persist.getOptions();
              if (
                !cards.name ||
                !cards.storage ||
                !settings.name ||
                !settings.storage
              )
                throw new Error(
                  "Browser storage is unavailable. Reload and retry."
                );
              await Promise.all([
                cards.storage.removeItem(cards.name),
                settings.storage.removeItem(settings.name),
              ]);
              for (const key of [
                "proxxied:cards:v6",
                "proxxied:cards:v7",
                "proxxied:layout-settings:v2",
              ])
                localStorage.removeItem(key);
              useCardsStore.getState().clearAll();
              s.resetSettings();
              notify("Saved workspace cleared.");
            } catch (error) {
              notify(
                `Could not clear saved data. ${errorMessage(error)}`,
                "error"
              );
            } finally {
              useLoadingStore.getState().setLoadingTask(null);
            }
          }}
        >
          Reset app data
        </button>
      </div>
      <a
        className="project-link"
        href="https://github.com/kclipsto/proxies-at-home"
        target="_blank"
        rel="noreferrer"
      >
        Proxxied on GitHub ↗
      </a>
    </aside>
  );
}
