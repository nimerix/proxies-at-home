import { useCardsStore, useSettingsStore } from "../store";
import type { CardOption } from "../types/Card";
import type { LoadState } from "../hooks/useImageProcessing";

export type BleedPreviewStatus = {
  loadingMap: Record<string, LoadState>;
  errorMap: Record<string, string>;
  onRetry: (card: CardOption, back: boolean) => void;
};

export function BleedArtworkControls({
  card,
  loadingMap,
  errorMap,
  onRetry,
}: { card: CardOption } & BleedPreviewStatus) {
  const bleedArtwork = useCardsStore(
    (s) => s.cards.find((c) => c.uuid === card.uuid)?.bleedArtwork
  );
  const viewMode = useSettingsStore((s) => s.viewMode);
  const previewKey = `${card.uuid}:${viewMode === "back"}`;
  const bleedPreview = useCardsStore(
    (s) =>
      (viewMode === "back" ? s.selectedBackFaceImages : s.selectedImages)[
        card.uuid
      ]
  );
  const report = useCardsStore((s) => s.bleedReports[card.uuid]?.[viewMode]);
  const globalBleedSource = useSettingsStore((s) => s.bleedSource);
  const globalBorder = useSettingsStore((s) => s.borderBleed);
  const globalInset = useSettingsStore((s) => s.scanInsetMm);
  const globalRadius = useSettingsStore((s) => s.scanCornerRadiusMm);
  const isScan = (bleedArtwork?.source ?? globalBleedSource) === "scan";
  const setBleed = (value: NonNullable<CardOption["bleedArtwork"]>) =>
    useCardsStore.getState().setCardBleedArtwork(card.uuid, value);
  return (
    <details>
      <summary>Bleed for this card</summary>
      <p className="hint">
        Overrides apply only to this card’s front and back. The {viewMode}{" "}
        preview updates as you change them.
      </p>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="card-border-bleed">Card border bleed</label>
          <select
            id="card-border-bleed"
            value={bleedArtwork?.borders ?? "inherit"}
            onChange={(e) =>
              setBleed({
                borders:
                  e.target.value === "auto"
                    ? "auto"
                    : e.target.value === "mirror"
                      ? "mirror"
                      : undefined,
              })
            }
          >
            <option value="inherit">
              Use print setting ·{" "}
              {globalBorder === "auto" ? "Auto" : "Mirror artwork"}
            </option>
            <option value="auto">Auto · extend black and white borders</option>
            <option value="mirror">Mirror all artwork</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="card-bleed-source">Card image edges</label>
          <select
            id="card-bleed-source"
            value={bleedArtwork?.source ?? "inherit"}
            onChange={(e) =>
              setBleed({
                source:
                  e.target.value === "scan"
                    ? "scan"
                    : e.target.value === "square"
                      ? "square"
                      : undefined,
              })
            }
          >
            <option value="inherit">
              Use print setting ·{" "}
              {globalBleedSource === "scan" ? "Scanned card" : "Square artwork"}
            </option>
            <option value="scan">Scanned card</option>
            <option value="square">Square artwork</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="card-corner-radius">Card image corner radius</label>
          <select
            id="card-corner-radius"
            disabled={!isScan}
            value={bleedArtwork?.cornerRadiusMm ?? "inherit"}
            onChange={(e) =>
              setBleed({
                cornerRadiusMm:
                  e.target.value === "inherit"
                    ? undefined
                    : Number(e.target.value),
              })
            }
          >
            <option value="inherit">
              Use print setting · {globalRadius} mm
            </option>
            {Array.from({ length: 11 }, (_, i) => (25 + i) / 10).map(
              (radius) => (
                <option key={radius} value={radius}>
                  {radius} mm
                  {radius === 2.5
                    ? " · normal card corners"
                    : radius === 3.2
                      ? " · larger image cutout"
                      : radius === 3.5
                        ? " · largest cutout"
                        : ""}
                </option>
              )
            )}
          </select>
        </div>
        <div className="field">
          <label htmlFor="card-scan-inset">Card shadow removal</label>
          <select
            id="card-scan-inset"
            disabled={!isScan}
            value={bleedArtwork?.insetMm ?? "inherit"}
            onChange={(e) =>
              setBleed({
                insetMm:
                  e.target.value === "inherit"
                    ? undefined
                    : Number(e.target.value),
              })
            }
          >
            <option value="inherit">
              Use print setting · {globalInset} mm
            </option>
            <option value="0">0 mm · keep the rim</option>
            <option value="0.25">0.25 mm</option>
            <option value="0.5">0.5 mm</option>
            <option value="1">1 mm</option>
            {bleedArtwork?.insetMm !== undefined &&
              ![0, 0.25, 0.5, 1].includes(bleedArtwork.insetMm) && (
                <option value={bleedArtwork.insetMm}>
                  {bleedArtwork.insetMm} mm
                </option>
              )}
          </select>
        </div>
      </div>
      <p className="hint">
        Larger radius or shadow removal replaces more corner and edge detail.
        The physical card and cut size stay unchanged.
      </p>
      {bleedPreview && report && (
        <p className="hint" aria-label="Bleed result">
          {report.kind === "none"
            ? "No extra bleed is selected."
            : report.kind === "supplied"
              ? "Keeping the image’s supplied bleed."
              : report.kind === "mirror"
                ? "All edges continue the artwork."
                : `Detected edges: ${Object.entries(report.edges ?? {})
                    .map(
                      ([edge, tone]) =>
                        `${edge}: ${tone === "mixed" ? "black + artwork" : tone}`
                    )
                    .join("; ")}.`}
        </p>
      )}
      {bleedPreview && isScan && report?.suggestedInsetMm && (
        <div className="hint">
          <p>
            Possible edge shadow. Try {report.suggestedInsetMm} mm shadow
            removal.
          </p>
          <button
            type="button"
            onClick={() => setBleed({ insetMm: report.suggestedInsetMm })}
          >
            Use suggested shadow removal
          </button>
        </div>
      )}
      {bleedPreview ? (
        <img
          src={bleedPreview}
          alt="Card bleed preview"
          style={{
            display: "block",
            maxHeight: 240,
            maxWidth: "100%",
            margin: "12px auto",
          }}
        />
      ) : loadingMap[previewKey] === "error" ? (
        <div role="alert">
          <p>Could not prepare the bleed preview. {errorMap[previewKey]}</p>
          <button
            type="button"
            onClick={() => {
              const current = useCardsStore
                .getState()
                .cards.find((c) => c.uuid === card.uuid);
              if (current) onRetry(current, viewMode === "back");
            }}
          >
            Retry bleed preview
          </button>
        </div>
      ) : (
        <p role="status">Preparing bleed preview…</p>
      )}
    </details>
  );
}
