import { useSettingsStore } from "@/store/settings";
import { Button, Checkbox, FileInput, Label } from "flowbite-react";
import { useCallback, useRef } from "react";

export function CardbackSettings() {
  const customCardbackUrl = useSettingsStore((state) => state.customCardbackUrl);
  const setCustomCardbackUrl = useSettingsStore((state) => state.setCustomCardbackUrl);
  const customCardbackHasBleed = useSettingsStore((state) => state.customCardbackHasBleed);
  const setCustomCardbackHasBleed = useSettingsStore((state) => state.setCustomCardbackHasBleed);
  const disableBackPageGuides = useSettingsStore((state) => state.disableBackPageGuides);
  const setDisableBackPageGuides = useSettingsStore((state) => state.setDisableBackPageGuides);
  const exportCollated = useSettingsStore((state) => state.exportCollated);
  const setExportCollated = useSettingsStore((state) => state.setExportCollated);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create URL for the file
    const url = URL.createObjectURL(file);
    setCustomCardbackUrl(url);
  }, [setCustomCardbackUrl]);

  const handleRemoveCardback = useCallback(() => {
    if (customCardbackUrl) {
      URL.revokeObjectURL(customCardbackUrl);
    }
    setCustomCardbackUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [customCardbackUrl, setCustomCardbackUrl]);

  return (
    <div className="flex flex-col gap-2">
      <Label>Custom Cardback</Label>

      <div>
        <FileInput
          ref={fileInputRef}
          accept="image/*"
          onChange={handleFileChange}
        />
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Upload a custom cardback image (optional)
        </p>
      </div>

      {customCardbackUrl && (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              id="cardback-has-bleed"
              checked={customCardbackHasBleed}
              onChange={(e) => setCustomCardbackHasBleed(e.target.checked)}
            />
            <Label htmlFor="cardback-has-bleed">
              Cardback has MPC bleed (3.5mm on each edge)
            </Label>
          </div>

          <Button
            size="xs"
            color="red"
            onClick={handleRemoveCardback}
          >
            Remove Custom Cardback
          </Button>

          <div className="border border-gray-300 dark:border-gray-600 rounded p-2">
            <img
              src={customCardbackUrl}
              alt="Custom cardback preview"
              className="w-full h-auto"
            />
          </div>
        </>
      )}

      {!customCardbackUrl && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Using default cardback
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <Checkbox
          id="disable-back-page-guides"
          checked={disableBackPageGuides}
          onChange={(e) => setDisableBackPageGuides(e.target.checked)}
        />
        <Label htmlFor="disable-back-page-guides">
          Disable cut guides on back page PDF
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="export-collated"
          checked={exportCollated}
          onChange={(e) => setExportCollated(e.target.checked)}
        />
        <Label htmlFor="export-collated">
          Export collated PDF (alternating front/back pages for duplex printing)
        </Label>
      </div>
    </div>
  );
}
