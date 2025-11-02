import { Label, TextInput } from "flowbite-react";
import { useSettingsStore } from "@/store";
import { useMemo } from "react";
import { CARD_W_MM, IN_TO_MM } from "@/constants";
import { CardDimensionsInMm, PageDimensionsInMm } from "@/helpers/SizeHelpers";


export function GridControls() {
  const columns = useSettingsStore((state) => state.columns);
  const rows = useSettingsStore((state) => state.rows);
  const setColumns = useSettingsStore((state) => state.setColumns);
  const setRows = useSettingsStore((state) => state.setRows);
  const cardSpacingMm = useSettingsStore((state) => state.cardSpacingMm);
  const { pageWidthMm, pageHeightMm } = PageDimensionsInMm();
  const { cardWidthMm, cardHeightMm } = CardDimensionsInMm();

  const gridLimits = useMemo(() => {
    // Calculate max columns and rows based on page and card dimensions
    const effectiveCardWidth = cardWidthMm + cardSpacingMm;
    const effectiveCardHeight = cardHeightMm + cardSpacingMm;

    const maxColumns = Math.floor(
      (pageWidthMm + cardSpacingMm) / effectiveCardWidth
    );
    const maxRows = Math.floor(
      (pageHeightMm + cardSpacingMm) / effectiveCardHeight
    );

    return {
      x: { min: 1, max: maxColumns >= 1 ? maxColumns : 1 },
      y: { min: 1, max: maxRows >= 1 ? maxRows : 1 },
    };

  }, [cardWidthMm, cardHeightMm, pageWidthMm, pageHeightMm, cardSpacingMm]);

  return (<>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Columns</Label>
          <TextInput
            className="w-full"
            type="number"
            min={gridLimits.x.min}
            max={gridLimits.x.max}
            value={columns}
            onChange={(e) => {
              const v = Math.max(gridLimits.x.min, Math.min(gridLimits.x.max, parseInt(e.target.value || "1", 10)));
              if (!Number.isNaN(v)) setColumns(v);
            }}
          />
        </div>
        <div>
          <Label>Rows</Label>
          <TextInput
            className="w-full"
            type="number"
            min={gridLimits.y.min}
            max={gridLimits.y.max}
            value={rows}
            onChange={(e) => {
              const v = Math.max(gridLimits.y.min, Math.min(gridLimits.y.max, parseInt(e.target.value || "1", 10)));
              if (!Number.isNaN(v)) setRows(v);
            }}
          />
        </div>
      </div>
    </div>
  </>
  );
}