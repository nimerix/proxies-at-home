import { useSettingsStore } from "../store";
import { printLayout } from "../helpers/printLayout";
import { edgeGuideLines } from "../helpers/printGuides";
import { GuideOverlay } from "./GuideOverlay";

export default function EdgeCutLines() {
  const settings = useSettingsStore();
  if (!settings.useCornerGuides) return null;
  const layout = printLayout(settings);
  return (
    <GuideOverlay
      lines={edgeGuideLines(settings)}
      width={layout.pageWidthMm}
      height={layout.pageHeightMm}
      color="#000000"
      strokeWidth={(settings.guideWidth * 25.4) / 96}
    />
  );
}
