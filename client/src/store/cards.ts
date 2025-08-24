import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CardOption } from "../types/Card";

type Store = {
  // persisted
  cards: CardOption[];
  setCards: (cards: CardOption[]) => void;
  appendCards: (newCards: CardOption[]) => void;
  updateCard: (pos: number, updatedCard: Partial<CardOption>) => void;

  // volatile (NOT persisted)
  selectedImages: Record<string, string>;
  setSelectedImages: (images: Record<string, string>) => void;
  appendSelectedImages: (newImages: Record<string, string>) => void;

  originalSelectedImages: Record<string, string>;
  setOriginalSelectedImages: (images: Record<string, string>) => void;
  appendOriginalSelectedImages: (newImages: Record<string, string>) => void;
};

export const useCardsStore = create<Store>()(
  persist(
    (set, get) => ({
      cards: [],
      setCards: (cards) => set({ cards }),
      appendCards: (newCards) =>
        set((state) => ({ cards: [...state.cards, ...newCards] })),
      updateCard: (pos, updatedCard) =>
        set((state) => ({
          cards: state.cards.map((card, index) =>
            index === pos ? { ...card, ...updatedCard } : card
          ),
        })),

      selectedImages: {},
      setSelectedImages: (images) => set({ selectedImages: images }),
      appendSelectedImages: (newImages) =>
        set((state) => ({
          selectedImages: { ...state.selectedImages, ...newImages },
        })),

      originalSelectedImages: {},
      setOriginalSelectedImages: (images) =>
        set({ originalSelectedImages: images }),
      appendOriginalSelectedImages: (newImages) =>
        set((state) => ({
          originalSelectedImages: {
            ...state.originalSelectedImages,
            ...newImages,
          },
        })),
    }),
    {
      name: "proxxied:cards:v2",
      version: 2,

      // Persist ONLY lightweight card metadata
      partialize: (state) => ({
        cards: state.cards,
      }),

      // (optional) explicitly choose storage; localStorage is fine since it's tiny now
      storage: createJSONStorage(() => localStorage),

      // migrate any older payloads by dropping image maps if they existed
      migrate: (persistedState: any, version) => {
        if (!persistedState) return persistedState;
        if (version < 2) {
          delete persistedState.selectedImages;
          delete persistedState.originalSelectedImages;
        }
        return persistedState;
      },
    }
  )
);
