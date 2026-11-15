// Sheets with cards, drag and drop and the card renderer load on demand.
// Imports start loading them early so the sheets are ready when cards arrive.
let loading: Promise<typeof import("../components/SheetGrid")> | null = null;
export function loadSheetGrid() {
  loading ??= import("../components/SheetGrid").catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function preloadSheetGrid() {
  loadSheetGrid().catch(() => {});
}
