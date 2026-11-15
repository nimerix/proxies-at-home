import { useEffect, useRef } from "react";
import {
  useCardsStore,
  useLoadingStore,
  usePreviewStore,
  useSettingsStore,
} from "@/store";
import { printLayout } from "@/helpers/printLayout";
import { confirmAction, DELETE_SAVED_DATA } from "@/store/confirm";
import { errorMessage, notify } from "@/store/notifications";
import { useUndoStore } from "@/store/undo";
import { NumberInput } from "../NumberInput";
import { PageSizeControl } from "../LayoutSettings/PageSizeControl";
import { GridControls } from "../LayoutSettings/GridControl";
import { CardbackSettings } from "../LayoutSettings/CardbackSettings";

async function resetAppData() {
  if (!(await confirmAction(DELETE_SAVED_DATA))) return;
  useLoadingStore.getState().setLoadingTask("Clearing workspace");
  try {
    // Zustand's clearStorage() returns void even for async storage. Await the
    // underlying transactions before reporting success or clearing the UI.
    const cards = useCardsStore.persist.getOptions(),
      settings = useSettingsStore.persist.getOptions();
    if (!cards.name || !cards.storage || !settings.name || !settings.storage)
      throw new Error("Browser storage is unavailable. Reload and retry.");
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
    useUndoStore.getState().clear();
    usePreviewStore.getState().clear();
    useSettingsStore.getState().resetSettings();
    notify("Saved workspace cleared.");
  } catch (error) {
    notify(`Could not clear saved data. ${errorMessage(error)}`, "error");
  } finally {
    useLoadingStore.getState().setLoadingTask(null);
  }
}

export function PrintSetupPanel() {
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
    s.bleedSource,
    s.borderBleed,
    s.scanInsetMm,
    s.scanCornerRadiusMm,
    s.useHighQualityPreviews,
    s.customCardbackUrl,
    s.customCardbackHasBleed,
  ]);
  const maxSpacing = Math.floor(printLayout(s).maxSpacing * 10) / 10;
  return (
    <aside
      id="print-panel"
      className="side-panel print-panel"
      data-panel="print"
      aria-labelledby="print-heading"
    >
      <h2 id="print-heading" className="panel-title">
        Print setup
      </h2>
      <section className="setup-group" aria-labelledby="paper-heading">
        <h3 id="paper-heading">Paper</h3>
        <PageSizeControl />
        <GridControls />
      </section>
      <section className="setup-group" aria-labelledby="sides-heading">
        <h3 id="sides-heading">Sides</h3>
        <div className="segmented" role="group" aria-labelledby="sides-heading">
          <button
            type="button"
            aria-pressed={!s.twoSided}
            onClick={() => s.setTwoSided(false)}
          >
            One-sided
          </button>
          <button
            type="button"
            aria-pressed={s.twoSided}
            onClick={() => s.setTwoSided(true)}
          >
            Two-sided
          </button>
        </div>
        {s.twoSided && (
          <p className="hint">
            Flip on the {s.pageOrientation === "landscape" ? "short" : "long"}{" "}
            edge when printing.
          </p>
        )}
      </section>
      <details className="setup-group" open={s.twoSided}>
        <summary>Card backs</summary>
        <div className="setup-body">
          <CardbackSettings />
        </div>
      </details>
      <section className="setup-group" aria-labelledby="cutting-heading">
        <h3 id="cutting-heading">Cutting</h3>
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
              aria-describedby="bleed-help"
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
        <p id="bleed-help" className="hint">
          Bleed extends the artwork past the cut line, so a slightly off cut
          leaves no white edge. More bleed can fit fewer cards on a sheet.
        </p>
        <label className="check-field">
          <input
            type="checkbox"
            checked={s.useCornerGuides}
            onChange={(e) => s.setUseCornerGuides(e.target.checked)}
          />{" "}
          Show cutting guides
        </label>
        {s.useCornerGuides && (
          <>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="guide-color">Color</label>
                <input
                  id="guide-color"
                  type="color"
                  value={s.guideColor}
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
                  onCommit={s.setGuideWidth}
                />
              </div>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={s.roundedCornerGuides}
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
                disabled={!s.roundedCornerGuides}
                value={s.cornerGuideOffsetMm}
                onCommit={s.setCornerGuideOffsetMm}
                aria-describedby="guide-offset-help"
              />
              <p id="guide-offset-help" className="hint">
                Negative values move guides outward. Guide width uses 96 pixels
                per inch at every export DPI.
              </p>
            </div>
          </>
        )}
      </section>
      <details className="setup-group">
        <summary>Advanced: artwork edges</summary>
        <div className="setup-body">
          <div className="field">
            <label htmlFor="border-bleed">Border bleed</label>
            <select
              id="border-bleed"
              value={s.borderBleed}
              onChange={(e) =>
                s.setBorderBleed(
                  e.target.value === "mirror" ? "mirror" : "auto"
                )
              }
              aria-describedby="border-bleed-help"
            >
              <option value="auto">
                Auto · extend black and white borders
              </option>
              <option value="mirror">Mirror all artwork</option>
            </select>
            <p id="border-bleed-help" className="hint">
              Choose Mirror all artwork if a dark area of the art is mistaken
              for a border.
            </p>
          </div>
          <div className="field">
            <label htmlFor="bleed-source">Image edges</label>
            <select
              id="bleed-source"
              value={s.bleedSource}
              onChange={(e) =>
                s.setBleedSource(
                  e.target.value === "square" ? "square" : "scan"
                )
              }
              aria-describedby="bleed-source-help"
            >
              <option value="scan">Scanned cards · rounded corners</option>
              <option value="square">Square artwork · keep image edges</option>
            </select>
            <p id="bleed-source-help" className="hint">
              Choose square artwork for images without rounded scan corners.
            </p>
          </div>
          <div className="field">
            <label htmlFor="scan-corner-radius">Image corner radius (mm)</label>
            <NumberInput
              id="scan-corner-radius"
              min={2.5}
              max={3.5}
              step={0.1}
              value={s.scanCornerRadiusMm}
              onCommit={s.setScanCornerRadiusMm}
              disabled={s.bleedSource !== "scan"}
              aria-describedby="scan-corner-radius-help"
            />
            <p id="scan-corner-radius-help" className="hint">
              Use 3.2 mm if a background sliver remains in the corners.
            </p>
          </div>
          <div className="field">
            <label htmlFor="scan-inset">Shadow removal (mm)</label>
            <NumberInput
              id="scan-inset"
              min={0}
              max={1}
              step={0.05}
              value={s.scanInsetMm}
              onCommit={s.setScanInsetMm}
              disabled={s.bleedSource !== "scan"}
              aria-describedby="scan-inset-help"
            />
            <p id="scan-inset-help" className="hint">
              Rebuilds this much of the outer edge from clean artwork to remove
              a dark scan rim.
            </p>
          </div>
          <details className="edge-guide">
            <summary>How edge cleanup works</summary>
            <div className="hint">
              <p>
                These settings are the defaults for fronts and backs, even with
                zero bleed. Open a card’s artwork picker to override them for
                that card. MPC images keep their supplied 3 mm bleed and skip
                shadow removal.
              </p>
              <p>
                Border bleed: Auto keeps black border sections black and full
                white borders white, with a short transition to match the scan
                tone.
              </p>
              <p>
                Image edges: physical cards have a 2.5 mm corner radius. Corners
                and bleed continue nearby artwork without copying the scan
                background. Use upright scans cropped to the card. Other image
                shapes are center-cropped to fit; transparent areas print white
                in square mode.
              </p>
              <p>
                Image corner radius: start at 2.5 mm. A larger radius, such as
                3.2 mm for an image with a larger rounded cutout, changes the
                repaired image area; the physical cut stays 2.5 mm.
              </p>
              <p>
                Shadow removal: start at 0.25 mm and increase up to 1 mm if a
                dark rim remains. Zero keeps the outer rim. Higher values
                replace more edge detail; wider shadows need a better-cropped
                scan. The card stays 63 × 88 mm.
              </p>
            </div>
          </details>
        </div>
      </details>
      <details className="setup-group">
        <summary>Advanced: preview</summary>
        <div className="setup-body">
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
      <footer className="panel-footer">
        <div className="footer-actions">
          <button
            className="text-button"
            onClick={async (e) => {
              // Safari does not focus buttons on click; the dialog returns focus here.
              e.currentTarget.focus();
              if (
                await confirmAction({
                  title: "Reset print settings?",
                  body: "Paper, cutting, card back and export settings return to their defaults, and the custom cardback is removed. Your deck is kept.",
                  confirmLabel: "Reset settings",
                })
              )
                s.resetSettings();
            }}
          >
            Reset settings
          </button>
          <button
            className="text-button danger"
            onClick={(e) => {
              e.currentTarget.focus();
              void resetAppData();
            }}
          >
            Reset app data
          </button>
        </div>
        <div className="footer-actions">
          <a
            href="https://github.com/nimerix/proxies-at-home"
            target="_blank"
            rel="noreferrer"
          >
            Oops, All Proxies on GitHub
          </a>
        </div>
      </footer>
    </aside>
  );
}
