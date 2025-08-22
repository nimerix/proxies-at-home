const LAYOUT_PREFS_KEY = "proxxied:layout-prefs:v1";

export type LayoutPrefs = {
    pageWidthIn: number;
    pageHeightIn: number;
    cols: number;
    rows: number;
    bleedEdgeWidth: number;
    bleedEdge: boolean;
    guideColor: string;
    guideWidth: number;
    zoom: number;
};

export const DEFAULT_PREFS: LayoutPrefs = {
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    cols: 3,
    rows: 3,
    bleedEdgeWidth: 1,
    bleedEdge: true,
    guideColor: "#39FF14",
    guideWidth: 0.5,
    zoom: 1,
};

export function loadPrefs(): LayoutPrefs {
    try {
        const raw = localStorage.getItem(LAYOUT_PREFS_KEY);
        if (!raw) return DEFAULT_PREFS;
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_PREFS, ...parsed };
    } catch {
        return DEFAULT_PREFS;
    }
}

let saveTimer: number | undefined;
export function savePrefs(prefs: LayoutPrefs, debounceMs = 150) {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        try {
            localStorage.setItem(LAYOUT_PREFS_KEY, JSON.stringify(prefs));
        } catch {}
    }, debounceMs);
}
