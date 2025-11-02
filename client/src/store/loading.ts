import { create } from "zustand";

export type LoadingTask =
  | "Fetching cards"
  | "Processing Images"
  | "Generating PDF"
  | "Uploading Images"
  | "Clearing Images"
  | null;

type Store = {
  loadingTask: LoadingTask;
  loadingProgress: number | null;
  setLoadingTask: (loadingTask: LoadingTask) => void;
  setLoadingProgress: (progress: number | null) => void;
};

export const useLoadingStore = create<Store>((set) => ({
  loadingTask: null,
  loadingProgress: null,
  setLoadingTask: (loadingTask) =>
    set(() => ({
      loadingTask,
      loadingProgress: null,
    })),
  setLoadingProgress: (progress) =>
    set(() => ({
      loadingProgress:
        progress == null
          ? null
          : Math.max(0, Math.min(100, Math.round(progress))),
    })),
}));
