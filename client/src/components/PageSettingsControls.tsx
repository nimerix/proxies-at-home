import { useImageProcessing } from "@/hooks/useImageProcessing";
import { useCardsStore, useSettingsStore } from "@/store";
import type { CardOption } from "@/types/Card";
import { Button, Checkbox, HR, Label, TextInput } from "flowbite-react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import Donate from "./Donate";
import { ExportActions } from "./LayoutSettings/ExportActions";
import { PageSizeControl } from "./LayoutSettings/PageSizeControl";
import { calculateMaxBleed, calculateMaxGridSize } from "@/helpers/LayoutHelper";

const unit = "mm";

export function PageSettingsControls() {
  const cards = useCardsStore((state) => state.cards);

  const columns = useSettingsStore((state) => state.columns);
  const rows = useSettingsStore((state) => state.rows);
  const bleedEdgeWidth = useSettingsStore((state) => state.bleedEdgeWidth);
  const bleedEdge = useSettingsStore((state) => state.bleedEdge);
  const guideColor = useSettingsStore((state) => state.guideColor);
  const guideWidth = useSettingsStore((state) => state.guideWidth);
  const zoom = useSettingsStore((state) => state.zoom);
  const pageWidth = useSettingsStore((state) => state.pageWidth);
  const pageHeight = useSettingsStore((state) => state.pageHeight);
  const pageSizeUnit = useSettingsStore((state) => state.pageSizeUnit);

  const setColumns = useSettingsStore((state) => state.setColumns);
  const setRows = useSettingsStore((state) => state.setRows);
  const setBleedEdgeWidth = useSettingsStore(
    (state) => state.setBleedEdgeWidth
  );
  const setBleedEdge = useSettingsStore((state) => state.setBleedEdge);
  const setGuideColor = useSettingsStore((state) => state.setGuideColor);
  const setGuideWidth = useSettingsStore((state) => state.setGuideWidth);
  const setZoom = useSettingsStore((state) => state.setZoom);
  const resetSettings = useSettingsStore((state) => state.resetSettings);

  const maxBleedMm = calculateMaxBleed(pageWidth, pageHeight, pageSizeUnit, columns, rows);
  const { maxColumns, maxRows } = calculateMaxGridSize(pageWidth, pageHeight, pageSizeUnit);

  const { reprocessSelectedImages } = useImageProcessing({
    unit, // "mm" | "in"
    bleedEdgeWidth, // number
  });

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedReprocess = useCallback(
    (cards: CardOption[], newBleedWidth: number) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        reprocessSelectedImages(cards, newBleedWidth);
      }, 500); // 500ms delay
    },
    [reprocessSelectedImages]
  );

  useEffect(() => {
    let needsUpdate = false;
    let newColumns = columns;
    let newRows = rows;
    let newBleed = bleedEdgeWidth;

    if (columns > maxColumns) {
      newColumns = maxColumns;
      needsUpdate = true;
    }
    if (rows > maxRows) {
      newRows = maxRows;
      needsUpdate = true;
    }

    const adjustedMaxBleed = calculateMaxBleed(pageWidth, pageHeight, pageSizeUnit, newColumns, newRows);
    
    if (bleedEdgeWidth > adjustedMaxBleed) {
      newBleed = adjustedMaxBleed;
      needsUpdate = true;
    }

    if (needsUpdate) {
      if (newColumns !== columns) setColumns(newColumns);
      if (newRows !== rows) setRows(newRows);
      if (newBleed !== bleedEdgeWidth) {
        setBleedEdgeWidth(newBleed);
        debouncedReprocess(cards, newBleed);
      }
    }
  }, [pageWidth, pageHeight, pageSizeUnit, maxColumns, maxRows, columns, rows, bleedEdgeWidth, setColumns, setRows, setBleedEdgeWidth, cards, debouncedReprocess]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="w-1/4 min-w-[18rem] max-w-[26rem] p-4 bg-gray-100 dark:bg-gray-700 h-full flex flex-col gap-4 overflow-y-auto">
      <h2 className="text-2xl font-semibold dark:text-white">Settings</h2>

      <div className="space-y-4">
        <PageSizeControl />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Columns</Label>
            <TextInput
              className="w-full"
              type="number"
              min={1}
              max={maxColumns}
              value={columns}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const v = Math.max(
                  1,
                  Math.min(maxColumns, parseInt(e.target.value || "1", 10))
                );
                if (!Number.isNaN(v)) setColumns(v);
              }}
            />
          </div>
          <div>
            <Label>Rows</Label>
            <TextInput
              className="w-full"
              type="number"
              min={1}
              max={maxRows}
              value={rows}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const v = Math.max(
                  1,
                  Math.min(maxRows, parseInt(e.target.value || "1", 10))
                );
                if (!Number.isNaN(v)) setRows(v);
              }}
            />
          </div>
        </div>

        <div>
          <Label>Bleed Edge ({unit})</Label>
          <TextInput
            className="w-full"
            type="number"
            value={bleedEdgeWidth}
            max={maxBleedMm}
            step="0.25"
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value);
              if (isNaN(parsed)) return;
              const val = parsed > maxBleedMm ? maxBleedMm : parsed;
              setBleedEdgeWidth(val);
              debouncedReprocess(cards, val);
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="bleed-edge"
            checked={bleedEdge}
            onChange={(e) => setBleedEdge(e.target.checked)}
          />
          <Label htmlFor="bleed-edge">Enable Guide</Label>
        </div>

        <div>
          <Label>Guides Color</Label>
          <input
            type="color"
            value={guideColor}
            disabled={!bleedEdge}
            onChange={(e) => setGuideColor(e.target.value)}
            className="w-full h-10 p-0 border rounded"
          />
        </div>

        <div>
          <Label>Guides Width (px)</Label>
          <TextInput
            className="w-full"
            type="number"
            value={guideWidth}
            step="0.1"
            min="0"
            disabled={!bleedEdge}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) setGuideWidth(val);
            }}
          />
        </div>

        <div>
          <Label>Zoom</Label>
          <div className="flex items-center gap-2 justify-between w-full">
            <Button
              size="xs"
              className="w-full"
              color="blue"
              onClick={() => setZoom(Math.max(0.1, zoom - 0.1))}
            >
              <ZoomOut className="size-4" />
            </Button>
            <Label className="w-full text-center">{zoom.toFixed(1)}x</Label>
            <Button
              size="xs"
              className="w-full"
              color="blue"
              onClick={() => setZoom(zoom + 0.1)}
            >
              <ZoomIn className="size-4" />
            </Button>
          </div>
        </div>

        <HR className="dark:bg-gray-500" />

        <ExportActions />
      </div>

      <div className="w-full flex justify-center">
        <span
          className="text-gray-400 hover:underline cursor-pointer text-sm font-medium"
          onClick={resetSettings}
        >
          Reset Settings
        </span>
      </div>

      <div className="mt-auto space-y-3 pt-4">
        <Donate username="Kaiser-Clipston-1" />
        <a
          href="https://github.com/kclipsto/proxies-at-home"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-md underline text-center text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
        >
          Code by Kaiser Clipston (Github)
        </a>
      </div>
    </div>
  );
}
