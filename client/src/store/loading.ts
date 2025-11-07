import { create } from "zustand";

export type LoadingTask =
  | "Fetching cards"
  | "Processing Images"
  | "Generating PDF"
  | "Generating Cardback PDF"
  | "Generating Collated PDF"
  | "Uploading Images"
  | "Clearing Images"
  | null;

export type LoadingProgressState = {
  overall: number | null;
  pageProgress: number | null;
  currentPage: number | null;
  totalPages: number | null;
};

type LoadingProgressInput =
  | number
  | null
  | (Partial<LoadingProgressState> & { reset?: boolean });

type LoadingTaskOptions = {
  onCancel?: () => void;
  cancelLabel?: string;
};

type Store = {
  loadingTask: LoadingTask;
  loadingProgress: LoadingProgressState | null;
  cancelLabel: string | null;
  cancelAction: (() => void) | null;
  setLoadingTask: (loadingTask: LoadingTask, options?: LoadingTaskOptions) => void;
  setLoadingProgress: (progress: LoadingProgressInput) => void;
  requestCancel: () => void;
};

function clampPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeProgress(input?: Partial<LoadingProgressState> | null): LoadingProgressState {
  return {
    overall: clampPercent(input?.overall ?? null),
    pageProgress: clampPercent(input?.pageProgress ?? null),
    currentPage: input?.currentPage ?? null,
    totalPages: input?.totalPages ?? null,
  };
}

export const useLoadingStore = create<Store>((set) => ({
  loadingTask: null,
  loadingProgress: null,
  cancelLabel: null,
  cancelAction: null,
  setLoadingTask: (loadingTask, options) =>
    set(() => ({
      loadingTask,
      loadingProgress: null,
      cancelLabel: options?.onCancel ? options?.cancelLabel ?? "Cancel" : null,
      cancelAction: options?.onCancel ?? null,
    })),
  setLoadingProgress: (progress) =>
    set((state) => {
      if (progress == null) {
        return { loadingProgress: null };
      }

      if (typeof progress === "number") {
        return { loadingProgress: normalizeProgress({ overall: progress }) };
      }

      const base = progress.reset ? null : state.loadingProgress;
      const merged: LoadingProgressState = normalizeProgress({
        overall: progress.overall ?? base?.overall ?? null,
        pageProgress: progress.pageProgress ?? base?.pageProgress ?? null,
        currentPage: progress.currentPage ?? base?.currentPage ?? null,
        totalPages: progress.totalPages ?? base?.totalPages ?? null,
      });

      return { loadingProgress: merged };
    }),
  requestCancel: () =>
    set((state) => {
      const action = state.cancelAction;
      if (action) {
        try {
          action();
        } catch (err) {
          console.error("Loading cancel handler threw", err);
        }
      }
      return {
        loadingTask: null,
        loadingProgress: null,
        cancelAction: null,
        cancelLabel: null,
      } as any;
    }),
}));
