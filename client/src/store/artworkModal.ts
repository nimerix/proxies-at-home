import { create } from "zustand";
import type { CardOption } from "../types/Card";

type ArtworkModalData = {
  card: CardOption | null;
  index: number | null;
  autoFetchPrints?: boolean;
};

type Store = {
  open: boolean;
  card: CardOption | null;
  index: number | null;
  autoFetchPrints: boolean;
  openModal: (data: ArtworkModalData) => void;
  closeModal: () => void;
  updateCard: (updatedCard: Partial<CardOption>) => void;
};

export const useArtworkModalStore = create<Store>((set) => ({
  open: false,
  card: null,
  index: null,
  autoFetchPrints: false,
  openModal: (data) => set({ open: true, card: data.card, index: data.index, autoFetchPrints: data.autoFetchPrints ?? false }),
  closeModal: () => set({ open: false, card: null, index: null, autoFetchPrints: false }),
  updateCard: (updatedCard) =>
    set((state) => {
      if (!state.card) return state;

      return { ...state, card: { ...state.card, ...updatedCard } };
    }),
}));
