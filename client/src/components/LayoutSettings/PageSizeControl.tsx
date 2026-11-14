import { useSettingsStore } from "@/store";
import type { LayoutPreset } from "@/store/settings";
const presets: LayoutPreset[] = [
  "Letter",
  "A4",
  "Legal",
  "Tabloid",
  "A3",
  "SuperB",
  "ArchA",
  "ArchB",
  "A2",
  "A1",
];
export function PageSizeControl() {
  const s = useSettingsStore();
  return (
    <>
      <div className="field">
        <label htmlFor="paper-size">Paper size</label>
        <select
          id="paper-size"
          value={s.pageSizePreset}
          onChange={(e) => s.setPageSizePreset(e.target.value as LayoutPreset)}
        >
          {presets.map((preset) => (
            <option key={preset}>{preset}</option>
          ))}
        </select>
      </div>
      <div className="orientation-row">
        <span className="hint tabular-nums">
          {s.pageWidth} × {s.pageHeight} {s.pageSizeUnit}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={s.swapPageOrientation}
          aria-label={`Switch to ${s.pageOrientation === "portrait" ? "landscape" : "portrait"}`}
        >
          ↻ {s.pageOrientation === "portrait" ? "Portrait" : "Landscape"}
        </button>
      </div>
    </>
  );
}
