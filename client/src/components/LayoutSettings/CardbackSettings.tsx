import { useSettingsStore } from "@/store/settings";
import { blobToDataUrl } from "@/helpers/imageUtils";
import { errorMessage, notify } from "@/store/notifications";
export function CardbackSettings() {
  const s = useSettingsStore();
  return (
    <>
      <div className="field">
        <label htmlFor="custom-back">Custom cardback</label>
        <input
          id="custom-back"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              if (
                !/^image\/(png|jpeg|webp)$/.test(file.type) ||
                file.size > 30 * 1024 * 1024
              )
                throw new Error(
                  "Choose a PNG, JPEG or WebP image up to 30 MB."
                );
              s.setCustomCardbackUrl(await blobToDataUrl(file));
              notify("Custom cardback saved.", "success");
            } catch (error) {
              notify(errorMessage(error), "error");
            }
          }}
        />
        <p className="hint">Used for cards without an assigned back face.</p>
      </div>
      {s.customCardbackUrl ? (
        <>
          <img
            className="cardback-preview"
            src={s.customCardbackUrl}
            alt="Your custom cardback"
          />
          <label className="check-field">
            <input
              type="checkbox"
              checked={s.customCardbackHasBleed}
              onChange={(e) => s.setCustomCardbackHasBleed(e.target.checked)}
            />{" "}
            Image includes 3 mm MPC bleed
          </label>
          <button
            className="text-button danger"
            onClick={() => {
              s.setCustomCardbackUrl(null);
              s.setCustomCardbackHasBleed(false);
            }}
          >
            Remove custom cardback
          </button>
        </>
      ) : (
        <p className="hint">Using the default cardback.</p>
      )}
      <label className="check-field">
        <input
          type="checkbox"
          checked={s.disableBackPageGuides}
          onChange={(e) => s.setDisableBackPageGuides(e.target.checked)}
        />{" "}
        Hide cutting guides on backs
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={s.exportCollated}
          onChange={(e) => s.setExportCollated(e.target.checked)}
        />{" "}
        Collate fronts and backs in one PDF
      </label>
    </>
  );
}
