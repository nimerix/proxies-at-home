import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LayoutPreset = "A4" | "A3" | "Letter" | "Tabloid" | "Legal" | "ArchA" | "ArchB" | "SuperB" | "A2" | "A1";
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
  columns: number;
  setColumns: (value: number) => void;
  rows: number;
  setRows: (value: number) => void;
  bleedEdgeWidth: number;
  setBleedEdgeWidth: (value: number) => void;
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

const defaultPageSettings = {
  pageSizeUnit: "in",
  pageOrientation: "portrait",
  pageSizePreset: "Letter",
  pageWidth: 8.5,
  pageHeight: 11,
  columns: 3,
  rows: 3,
  bleedEdgeWidth: 2,
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

export const useSettingsStore = create<Store>()(
  persist(
    (set, _) => ({
      ...defaultPageSettings,

      setPageSizePreset: (value) =>
        set(() => {
          const { pageWidth, pageHeight, pageSizeUnit } = layoutPresetsSizes[value];
          return {
            pageSizePreset: value,
            pageOrientation: "portrait", // always reset
            pageWidth,
            pageHeight,
            pageSizeUnit,
          };
        }),

      swapPageOrientation: () =>
        set((state) => ({
          pageOrientation:
            state.pageOrientation === "portrait" ? "landscape" : "portrait",
          pageWidth: state.pageHeight,
          pageHeight: state.pageWidth,
        })),

      setColumns: (columns) => set({ columns }),
      setRows: (rows) => set({ rows }),
      setBleedEdgeWidth: (value) => set({ bleedEdgeWidth: value }),
      setUseCornerGuides: (value) => set({ useCornerGuides: value }),
      setGuideColor: (value) => set({ guideColor: value }),
      setGuideWidth: (value) => set({ guideWidth: value }),
      setZoom: (value) => set({ zoom: value }),
      setCardSpacingMm: (mm) => set({ cardSpacingMm: Math.max(0, mm) }),
      setExportDpi: (dpi) => set({ exportDpi: dpi }),
      setUseExportBatching: (value) => set({ useExportBatching: value }),
      setExportBatchSize: (size) => set({ exportBatchSize: size }),
      setProcessingProgress: (value) =>
        set({ processingProgress: Math.max(0, Math.min(100, value)) }),
      setRoundedCornerGuides: (value) => set({ roundedCornerGuides: value }),
      setCornerGuideOffsetMm: (mm) => set({ cornerGuideOffsetMm: mm }),
      resetSettings: () => set({ ...defaultPageSettings }),
      setIsProcessing: (value) => set({ isProcessing: value }),
      setIncludeDoubleFacesInZip: (value) => set({ includeDoubleFacesInZip: value }),
      setUseOriginalCardNames: (value) => set({ useOriginalCardNames: value }),
      setPrefixIndexToExportNames: (value) => set({ prefixIndexToExportNames: value }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setCustomCardbackUrl: (url) => set({ customCardbackUrl: url }),
      setCustomCardbackHasBleed: (value) => set({ customCardbackHasBleed: value }),
      setDisableBackPageGuides: (value) => set({ disableBackPageGuides: value }),
      setExportCollated: (value) => set({ exportCollated: value }),
      setUseHighQualityPreviews: (value) => set({ useHighQualityPreviews: value }),
    }),
    {
      name: "proxxied:layout-settings:v2",
      version: 1,

      partialize: (state) => {
        const persisted = {
          // Persist all settings except:
          // - Page dimensions (recalculated from preset)
          // - Transient state (isProcessing, processingProgress)
          // - Setter functions (explicitly excluded)
          pageSizePreset: state.pageSizePreset,
          columns: state.columns,
          rows: state.rows,
          bleedEdgeWidth: state.bleedEdgeWidth,
          useCornerGuides: state.useCornerGuides,
          guideColor: state.guideColor,
          guideWidth: state.guideWidth,
          zoom: state.zoom,
          cardSpacingMm: state.cardSpacingMm,
          exportDpi: state.exportDpi,
          useExportBatching: state.useExportBatching,
          exportBatchSize: state.exportBatchSize,
          roundedCornerGuides: state.roundedCornerGuides,
          cornerGuideOffsetMm: state.cornerGuideOffsetMm,
          includeDoubleFacesInZip: state.includeDoubleFacesInZip,
          useOriginalCardNames: state.useOriginalCardNames,
          prefixIndexToExportNames: state.prefixIndexToExportNames,
          viewMode: state.viewMode,
          customCardbackUrl: state.customCardbackUrl,
          customCardbackHasBleed: state.customCardbackHasBleed,
          disableBackPageGuides: state.disableBackPageGuides,
          exportCollated: state.exportCollated,
          useHighQualityPreviews: state.useHighQualityPreviews,
        };
        console.log("[Settings] Persisting state:", persisted);
        return persisted;
      },

      migrate: (persistedState: any, _version) => {
        console.log("[Settings] Migrating from version", _version, "state:", persistedState);
        // Return only properties that exist in the persisted state
        // Missing properties will use defaults from initial state
        const state = persistedState ?? {};
        const migrated: any = {};

        // Only include properties that are defined
        if (state.pageSizePreset !== undefined) migrated.pageSizePreset = state.pageSizePreset;
        if (state.columns !== undefined) migrated.columns = state.columns;
        if (state.rows !== undefined) migrated.rows = state.rows;
        if (state.bleedEdgeWidth !== undefined) migrated.bleedEdgeWidth = state.bleedEdgeWidth;
        if (state.useCornerGuides !== undefined) migrated.useCornerGuides = state.useCornerGuides;
        if (state.guideColor !== undefined) migrated.guideColor = state.guideColor;
        if (state.guideWidth !== undefined) migrated.guideWidth = state.guideWidth;
        if (state.zoom !== undefined) migrated.zoom = state.zoom;
        if (state.cardSpacingMm !== undefined) migrated.cardSpacingMm = state.cardSpacingMm;
        if (state.exportDpi !== undefined) migrated.exportDpi = state.exportDpi;
        if (state.useExportBatching !== undefined) migrated.useExportBatching = state.useExportBatching;
        if (state.exportBatchSize !== undefined) migrated.exportBatchSize = state.exportBatchSize;
        if (state.roundedCornerGuides !== undefined) migrated.roundedCornerGuides = state.roundedCornerGuides;
        if (state.cornerGuideOffsetMm !== undefined) migrated.cornerGuideOffsetMm = state.cornerGuideOffsetMm;
        if (state.includeDoubleFacesInZip !== undefined) migrated.includeDoubleFacesInZip = state.includeDoubleFacesInZip;
        if (state.useOriginalCardNames !== undefined) migrated.useOriginalCardNames = state.useOriginalCardNames;
        if (state.prefixIndexToExportNames !== undefined) migrated.prefixIndexToExportNames = state.prefixIndexToExportNames;
        if (state.viewMode !== undefined) migrated.viewMode = state.viewMode;
        if (state.customCardbackUrl !== undefined) migrated.customCardbackUrl = state.customCardbackUrl;
        if (state.customCardbackHasBleed !== undefined) migrated.customCardbackHasBleed = state.customCardbackHasBleed;
        if (state.disableBackPageGuides !== undefined) migrated.disableBackPageGuides = state.disableBackPageGuides;
        if (state.exportCollated !== undefined) migrated.exportCollated = state.exportCollated;
        if (state.useHighQualityPreviews !== undefined) migrated.useHighQualityPreviews = state.useHighQualityPreviews;

        console.log("[Settings] Migration result:", migrated);
        return migrated;
      },

      onRehydrateStorage: () => (state, error) => {
        console.log("[Settings] Rehydrating storage, error:", error, "state:", state);
        if (error) {
          console.error("[Settings] Rehydration error:", error);
          return;
        }
        // Manually set page dimensions without triggering persist
        // This avoids the setPageSizePreset call which would overwrite other settings
        if (state) {
          const preset = state.pageSizePreset ?? "Letter";
          const { pageWidth, pageHeight, pageSizeUnit } = layoutPresetsSizes[preset];
          console.log("[Settings] Restoring page dimensions for preset:", preset);
          // Directly mutate the state without triggering persist
          state.pageWidth = pageWidth;
          state.pageHeight = pageHeight;
          state.pageSizeUnit = pageSizeUnit;
          state.pageOrientation = "portrait";
        }
      },
    }
  )

);
