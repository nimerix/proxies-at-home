import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createIndexedDBStorage,
  reportStorageError,
  hydrationErrorMessage,
} from "../helpers/IndexedDBStorage";
import { finiteClamp, fitLayout } from "../helpers/printLayout";
import {
  DEFAULT_SCAN_INSET_MM,
  MAX_SCAN_INSET_MM,
  CARD_CORNER_RADIUS_MM,
  MAX_SCAN_CORNER_RADIUS_MM,
  type BleedArtworkOptions,
} from "../helpers/bleedArtwork";

export type LayoutPreset =
  | "A4"
  | "A3"
  | "Letter"
  | "Tabloid"
  | "Legal"
  | "ArchA"
  | "ArchB"
  | "SuperB"
  | "A2"
  | "A1";
export type PageOrientation = "portrait" | "landscape";
export type ExportDpi = 600 | 900 | 1200;
export type ViewMode = "front" | "back";

type Store = {
  pageSizeUnit: "mm" | "in";
  pageOrientation: PageOrientation;
  pageSizePreset: LayoutPreset;
  setPageSizePreset: (value: LayoutPreset) => void;
  pageWidth: number;
  pageHeight: number;
  swapPageOrientation: () => void;
  gridMode: "auto" | "custom";
  preferredColumns: number;
  preferredRows: number;
  fitMaximumCards: () => void;
  columns: number;
  setColumns: (value: number) => void;
  rows: number;
  setRows: (value: number) => void;
  bleedEdgeWidth: number;
  setBleedEdgeWidth: (value: number) => void;
  bleedSource: BleedArtworkOptions["source"];
  setBleedSource: (value: BleedArtworkOptions["source"]) => void;
  borderBleed: "auto" | "mirror";
  setBorderBleed: (value: "auto" | "mirror") => void;
  scanInsetMm: number;
  setScanInsetMm: (value: number) => void;
  scanCornerRadiusMm: number;
  setScanCornerRadiusMm: (value: number) => void;
  useCornerGuides: boolean;
  setUseCornerGuides: (value: boolean) => void;
  guideColor: string;
  setGuideColor: (value: string) => void;
  guideWidth: number;
  setGuideWidth: (value: number) => void;
  zoom: number;
  setZoom: (value: number) => void;
  resetSettings: () => void;
  cardSpacingMm: number;
  setCardSpacingMm: (mm: number) => void;
  exportDpi: ExportDpi;
  setExportDpi: (dpi: ExportDpi) => void;
  useExportBatching: boolean;
  setUseExportBatching: (value: boolean) => void;
  exportBatchSize: number;
  setExportBatchSize: (size: number) => void;
  processingProgress: number;
  setProcessingProgress: (value: number) => void;
  roundedCornerGuides: boolean;
  setRoundedCornerGuides: (value: boolean) => void;
  cornerGuideOffsetMm: number;
  setCornerGuideOffsetMm: (mm: number) => void;
  isProcessing: boolean;
  setIsProcessing: (value: boolean) => void;
  includeDoubleFacesInZip: boolean;
  setIncludeDoubleFacesInZip: (value: boolean) => void;
  useOriginalCardNames: boolean;
  setUseOriginalCardNames: (value: boolean) => void;
  prefixIndexToExportNames: boolean;
  setPrefixIndexToExportNames: (value: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  customCardbackUrl: string | null;
  setCustomCardbackUrl: (url: string | null) => void;
  customCardbackHasBleed: boolean;
  setCustomCardbackHasBleed: (value: boolean) => void;
  disableBackPageGuides: boolean;
  setDisableBackPageGuides: (value: boolean) => void;
  exportCollated: boolean;
  setExportCollated: (value: boolean) => void;
  useHighQualityPreviews: boolean;
  setUseHighQualityPreviews: (value: boolean) => void;
};

export const defaultPageSettings = {
  pageSizeUnit: "in",
  pageOrientation: "portrait",
  pageSizePreset: "Letter",
  pageWidth: 8.5,
  pageHeight: 11,
  gridMode: "auto",
  preferredColumns: 3,
  preferredRows: 3,
  columns: 3,
  rows: 3,
  bleedEdgeWidth: 2,
  bleedSource: "scan",
  borderBleed: "auto",
  scanInsetMm: DEFAULT_SCAN_INSET_MM,
  scanCornerRadiusMm: CARD_CORNER_RADIUS_MM,
  useCornerGuides: true,
  guideColor: "#39FF14",
  guideWidth: 0.5,
  cardSpacingMm: 0,
  zoom: 1,
  exportDpi: 600,
  useExportBatching: false,
  exportBatchSize: 20,
  processingProgress: 0,
  roundedCornerGuides: false,
  cornerGuideOffsetMm: -0.5,
  isProcessing: false,
  includeDoubleFacesInZip: false,
  useOriginalCardNames: false,
  prefixIndexToExportNames: true,
  viewMode: "front",
  customCardbackUrl: null,
  customCardbackHasBleed: false,
  disableBackPageGuides: true,
  exportCollated: false,
  useHighQualityPreviews: false,
} as Store;

const layoutPresetsSizes: Record<
  LayoutPreset,
  { pageWidth: number; pageHeight: number; pageSizeUnit: "in" | "mm" }
> = {
  Letter: { pageWidth: 8.5, pageHeight: 11, pageSizeUnit: "in" },
  Tabloid: { pageWidth: 11, pageHeight: 17, pageSizeUnit: "in" },
  A4: { pageWidth: 210, pageHeight: 297, pageSizeUnit: "mm" },
  A3: { pageWidth: 297, pageHeight: 420, pageSizeUnit: "mm" },
  Legal: { pageWidth: 8.5, pageHeight: 14, pageSizeUnit: "in" },
  ArchA: { pageWidth: 9, pageHeight: 12, pageSizeUnit: "in" },
  ArchB: { pageWidth: 12, pageHeight: 18, pageSizeUnit: "in" },
  SuperB: { pageWidth: 13, pageHeight: 19, pageSizeUnit: "in" },
  A2: { pageWidth: 420, pageHeight: 594, pageSizeUnit: "mm" },
  A1: { pageWidth: 594, pageHeight: 841, pageSizeUnit: "mm" },
};

function fitPreferredGrid(s: Store): Store {
  return fitLayout({
    ...s,
    columns: s.gridMode === "auto" ? 20 : s.preferredColumns,
    rows: s.gridMode === "auto" ? 20 : s.preferredRows,
  });
}

function restoreSettings(value: unknown): Partial<Store> {
  const saved =
    value && typeof value === "object" ? (value as Partial<Store>) : {};
  const result = { ...defaultPageSettings };
  for (const key of Object.keys(defaultPageSettings) as (keyof Store)[]) {
    const candidate = saved[key];
    if (
      candidate !== undefined &&
      typeof candidate === typeof defaultPageSettings[key]
    ) {
      Object.assign(result, { [key]: candidate });
    }
  }
  const preset =
    saved.pageSizePreset &&
    Object.hasOwn(layoutPresetsSizes, saved.pageSizePreset)
      ? saved.pageSizePreset
      : "Letter";
  const size = layoutPresetsSizes[preset];
  const landscape = saved.pageOrientation === "landscape";
  Object.assign(result, {
    gridMode:
      saved.gridMode === "auto"
        ? "auto"
        : saved.gridMode === "custom" || saved.columns !== undefined
          ? "custom"
          : "auto",
    preferredColumns: Math.floor(
      finiteClamp(saved.preferredColumns ?? saved.columns ?? 3, 1, 20, 3)
    ),
    preferredRows: Math.floor(
      finiteClamp(saved.preferredRows ?? saved.rows ?? 3, 1, 20, 3)
    ),
    pageSizePreset: preset,
    pageOrientation: landscape ? "landscape" : "portrait",
    pageSizeUnit: size.pageSizeUnit,
    pageWidth: landscape ? size.pageHeight : size.pageWidth,
    pageHeight: landscape ? size.pageWidth : size.pageHeight,
    bleedEdgeWidth: finiteClamp(result.bleedEdgeWidth, 0, 5, 2),
    bleedSource: saved.bleedSource === "square" ? "square" : "scan",
    borderBleed: saved.borderBleed === "mirror" ? "mirror" : "auto",
    scanInsetMm: finiteClamp(
      result.scanInsetMm,
      0,
      MAX_SCAN_INSET_MM,
      DEFAULT_SCAN_INSET_MM
    ),
    scanCornerRadiusMm: finiteClamp(
      result.scanCornerRadiusMm,
      CARD_CORNER_RADIUS_MM,
      MAX_SCAN_CORNER_RADIUS_MM,
      CARD_CORNER_RADIUS_MM
    ),
    guideWidth: finiteClamp(result.guideWidth, 0.1, 4, 0.5),
    guideColor: /^#[0-9a-f]{6}$/i.test(result.guideColor)
      ? result.guideColor
      : "#39FF14",
    zoom: finiteClamp(result.zoom, 0.1, 3, 1),
    exportDpi: [600, 900, 1200].includes(result.exportDpi)
      ? result.exportDpi
      : 600,
    exportBatchSize: Math.round(finiteClamp(result.exportBatchSize, 1, 20, 20)),
    cornerGuideOffsetMm: finiteClamp(result.cornerGuideOffsetMm, -2, 2, -0.5),
    customCardbackUrl:
      typeof saved.customCardbackUrl === "string" &&
      !saved.customCardbackUrl.startsWith("blob:")
        ? saved.customCardbackUrl
        : null,
    viewMode: saved.viewMode === "back" ? "back" : "front",
    isProcessing: false,
    processingProgress: 0,
  });
  return fitPreferredGrid(result);
}

export const useSettingsStore = create<Store>()(
  persist(
    (set) => ({
      ...defaultPageSettings,
      setPageSizePreset: (value) =>
        set((s) =>
          fitPreferredGrid({
            ...s,
            ...layoutPresetsSizes[value],
            pageSizePreset: value,
            pageOrientation: "portrait",
          })
        ),
      swapPageOrientation: () =>
        set((s) =>
          fitPreferredGrid({
            ...s,
            pageOrientation:
              s.pageOrientation === "portrait" ? "landscape" : "portrait",
            pageWidth: s.pageHeight,
            pageHeight: s.pageWidth,
          })
        ),
      fitMaximumCards: () =>
        set((s) => fitPreferredGrid({ ...s, gridMode: "auto" })),
      setColumns: (columns) =>
        set((s) =>
          fitPreferredGrid({
            ...s,
            gridMode: "custom",
            preferredColumns: Math.floor(
              finiteClamp(columns, 1, 20, s.columns)
            ),
            preferredRows: s.gridMode === "auto" ? s.rows : s.preferredRows,
          })
        ),
      setRows: (rows) =>
        set((s) =>
          fitPreferredGrid({
            ...s,
            gridMode: "custom",
            preferredRows: Math.floor(finiteClamp(rows, 1, 20, s.rows)),
            preferredColumns:
              s.gridMode === "auto" ? s.columns : s.preferredColumns,
          })
        ),
      setBleedEdgeWidth: (value) =>
        set((s) =>
          fitPreferredGrid({
            ...s,
            bleedEdgeWidth: finiteClamp(value, 0, 5, 2),
          })
        ),
      setCardSpacingMm: (cardSpacingMm) =>
        set((s) => fitPreferredGrid({ ...s, cardSpacingMm })),
      setBleedSource: (bleedSource) => set({ bleedSource }),
      setBorderBleed: (borderBleed) => set({ borderBleed }),
      setScanCornerRadiusMm: (value) =>
        set({
          scanCornerRadiusMm: finiteClamp(
            value,
            CARD_CORNER_RADIUS_MM,
            MAX_SCAN_CORNER_RADIUS_MM,
            CARD_CORNER_RADIUS_MM
          ),
        }),
      setScanInsetMm: (value) =>
        set({
          scanInsetMm: finiteClamp(
            value,
            0,
            MAX_SCAN_INSET_MM,
            DEFAULT_SCAN_INSET_MM
          ),
        }),
      setUseCornerGuides: (useCornerGuides) => set({ useCornerGuides }),
      setGuideColor: (guideColor) => set({ guideColor }),
      setGuideWidth: (value) =>
        set({ guideWidth: finiteClamp(value, 0.1, 4, 0.5) }),
      setZoom: (value) => set({ zoom: finiteClamp(value, 0.1, 3, 1) }),
      setExportDpi: (exportDpi) => set({ exportDpi }),
      setUseExportBatching: (useExportBatching) => set({ useExportBatching }),
      setExportBatchSize: (value) =>
        set({ exportBatchSize: Math.round(finiteClamp(value, 1, 20, 20)) }),
      setProcessingProgress: (value) =>
        set({ processingProgress: finiteClamp(value, 0, 100) }),
      setRoundedCornerGuides: (roundedCornerGuides) =>
        set({ roundedCornerGuides }),
      setCornerGuideOffsetMm: (value) =>
        set({ cornerGuideOffsetMm: finiteClamp(value, -2, 2, -0.5) }),
      resetSettings: () => set({ ...defaultPageSettings }),
      setIsProcessing: (isProcessing) => set({ isProcessing }),
      setIncludeDoubleFacesInZip: (includeDoubleFacesInZip) =>
        set({ includeDoubleFacesInZip }),
      setUseOriginalCardNames: (useOriginalCardNames) =>
        set({ useOriginalCardNames }),
      setPrefixIndexToExportNames: (prefixIndexToExportNames) =>
        set({ prefixIndexToExportNames }),
      setViewMode: (viewMode) => set({ viewMode }),
      setCustomCardbackUrl: (customCardbackUrl) => set({ customCardbackUrl }),
      setCustomCardbackHasBleed: (customCardbackHasBleed) =>
        set({ customCardbackHasBleed }),
      setDisableBackPageGuides: (disableBackPageGuides) =>
        set({ disableBackPageGuides }),
      setExportCollated: (exportCollated) => set({ exportCollated }),
      setUseHighQualityPreviews: (useHighQualityPreviews) =>
        set({ useHighQualityPreviews }),
    }),
    {
      onRehydrateStorage: () => (_state, error) =>
        reportStorageError("hydrate:settings", hydrationErrorMessage(error)),
      name: "proxxied:layout-settings:v2",
      version: 3,
      storage: createIndexedDBStorage<Partial<Store>>(),
      partialize: (state) => {
        const saved: Partial<Store> = {};
        for (const key of Object.keys(defaultPageSettings) as (keyof Store)[]) {
          if (key !== "isProcessing" && key !== "processingProgress")
            Object.assign(saved, { [key]: state[key] });
        }
        return saved;
      },
      migrate: restoreSettings,
      merge: (saved, current) => ({ ...current, ...restoreSettings(saved) }),
    }
  )
);
