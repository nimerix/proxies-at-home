import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { isUploadedFileToken, makeUploadedFileToken } from "../helpers/ImageHelper";
import type { CardOption } from "../types/Card";

type Store = {
  // ---------- persisted ----------
  cards: CardOption[];

  cachedImageUrls: Record<string, string>;
  setCachedImageUrls: (images: Record<string, string>) => void;
  appendCachedImageUrls: (newImages: Record<string, string>) => void;
  clearCachedForCard: (uuid: string) => void;
  clearCachedForMany: (uuids: string[]) => void;
  resetCachedImageUrls: () => void;

  globalLanguage: string;
  setGlobalLanguage: (lang: string) => void;

  setCards: (cards: CardOption[]) => void;
  appendCards: (newCards: CardOption[]) => void;
  updateCard: (pos: number, updatedCard: Partial<CardOption>) => void;

  // ---------- volatile (NOT persisted) ----------
  selectedImages: Record<string, string>;
  setSelectedImages: (images: Record<string, string>) => void;
  appendSelectedImages: (newImages: Record<string, string>) => void;
  clearSelectedImage: (uuid: string) => void;
  clearManySelectedImages: (uuids: string[]) => void;

  originalSelectedImages: Record<string, string>;
  setOriginalSelectedImages: (images: Record<string, string>) => void;
  appendOriginalSelectedImages: (newImages: Record<string, string>) => void;

  uploadedImages: Record<string, string>;
  setUploadedImages: (images: Record<string, string>) => void;
  appendUploadedImages: (newImages: Record<string, string>) => void;

  uploadedOriginalImages: Record<string, string>;
  setUploadedOriginalImages: (images: Record<string, string>) => void;
  appendUploadedOriginalImages: (newImages: Record<string, string>) => void;

  uploadedFiles: Record<string, File>;
  setUploadedFiles: (files: Record<string, File>) => void;
  appendUploadedFiles: (newFiles: Record<string, File>) => void;

  removeCardAt: (pos: number) => void;
  duplicateCardAt: (pos: number) => void;
  clearVolatileForCard: (uuid: string) => void;
  removeCardsByUuid: (uuids: string[]) => void;
};

export const useCardsStore = create<Store>()(
  persist(
    (set, _) => ({
      // ---------- persisted ----------
      cards: [],

      cachedImageUrls: {},
      setCachedImageUrls: (images) => set({ cachedImageUrls: images }),
      appendCachedImageUrls: (newImages) =>
        set((state) => ({
          cachedImageUrls: { ...state.cachedImageUrls, ...newImages },
        })),
      clearCachedForCard: (uuid) =>
        set((state) => {
          if (!state.cachedImageUrls?.[uuid]) return {};
          const next = { ...state.cachedImageUrls };
          delete next[uuid];
          return { cachedImageUrls: next };
        }),
      clearCachedForMany: (uuids) =>
        set((state) => {
          if (!uuids?.length) return {};
          const next = { ...state.cachedImageUrls };
          for (const id of uuids) delete next[id];
          return { cachedImageUrls: next };
        }),
      resetCachedImageUrls: () => set({ cachedImageUrls: {} }),

      globalLanguage: "en",
      setGlobalLanguage: (lang) => set({ globalLanguage: lang }),

      setCards: (cards) => set({ cards }),
      appendCards: (newCards) =>
        set((state) => ({ cards: [...state.cards, ...newCards] })),
      updateCard: (pos, updatedCard) =>
        set((state) => ({
          cards: state.cards.map((card, index) =>
            index === pos ? { ...card, ...updatedCard } : card
          ),
        })),

      // ---------- volatile ----------
      selectedImages: {},
      setSelectedImages: (images) => set({ selectedImages: images }),
      appendSelectedImages: (newImages) =>
        set((state) => ({
          selectedImages: { ...state.selectedImages, ...newImages },
        })),
      clearSelectedImage: (uuid) =>
        set((state) => {
          const newSelected = { ...state.selectedImages };
          delete newSelected[uuid];
          return { selectedImages: newSelected };
        }),
      clearManySelectedImages: (uuids) =>
        set((state) => {
          const newSelected = { ...state.selectedImages };
          for (const uuid of uuids) delete newSelected[uuid];
          return { selectedImages: newSelected };
        }),

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

      uploadedImages: {},
      setUploadedImages: (images) => set({ uploadedImages: images }),
      appendUploadedImages: (newImages) =>
        set((state) => ({
          uploadedImages: { ...state.uploadedImages, ...newImages },
        })),

      uploadedOriginalImages: {},
      setUploadedOriginalImages: (images) =>
        set({ uploadedOriginalImages: images }),
      appendUploadedOriginalImages: (newImages) =>
        set((state) => ({
          uploadedOriginalImages: {
            ...state.uploadedOriginalImages,
            ...newImages,
          },
        })),

      uploadedFiles: {},
      setUploadedFiles: (files) => set({ uploadedFiles: files }),
      appendUploadedFiles: (newFiles) =>
        set((state) => ({
          uploadedFiles: { ...state.uploadedFiles, ...newFiles },
        })),

      // helpers
      removeCardAt: (pos) =>
        set((state) => {
          const cards = [...state.cards];
          const [removed] = cards.splice(pos, 1);
          if (removed?.uuid) {
            const uuid = removed.uuid;
            const {
              selectedImages,
              originalSelectedImages,
              uploadedImages,
              uploadedOriginalImages,
              uploadedFiles,
              cachedImageUrls,
            } = state;

            delete selectedImages[uuid];
            delete originalSelectedImages[uuid];
            delete uploadedImages[uuid];
            delete uploadedOriginalImages[uuid];
            delete uploadedFiles[uuid];
            delete cachedImageUrls[uuid];

            return {
              cards,
              selectedImages: { ...selectedImages },
              originalSelectedImages: { ...originalSelectedImages },
              uploadedImages: { ...uploadedImages },
              uploadedOriginalImages: { ...uploadedOriginalImages },
              uploadedFiles: { ...uploadedFiles },
              cachedImageUrls: { ...cachedImageUrls },
            };
          }
          return { cards };
        }),

      duplicateCardAt: (pos) =>
        set((state) => {
          const cards = [...state.cards];
          const cardToDuplicate = cards[pos];
          if (!cardToDuplicate) return {};

          const newUuid = crypto.randomUUID();
          const duplicatedCard: CardOption = {
            ...cardToDuplicate,
            uuid: newUuid,
          };

          // Insert the duplicate right after the original
          cards.splice(pos + 1, 0, duplicatedCard);

          // Copy over all associated data with the new UUID
          const oldUuid = cardToDuplicate.uuid;
          const {
            selectedImages,
            originalSelectedImages,
            uploadedImages,
            uploadedOriginalImages,
            uploadedFiles,
            cachedImageUrls,
          } = state;

          const updates: any = { cards };

          if (selectedImages[oldUuid]) {
            updates.selectedImages = {
              ...selectedImages,
              [newUuid]: selectedImages[oldUuid],
            };
          }
          if (originalSelectedImages[oldUuid]) {
            const originalValue = originalSelectedImages[oldUuid];
            updates.originalSelectedImages = {
              ...originalSelectedImages,
              [newUuid]: isUploadedFileToken(originalValue)
                ? makeUploadedFileToken(newUuid)
                : originalValue,
            };
          }
          if (uploadedImages[oldUuid]) {
            updates.uploadedImages = {
              ...uploadedImages,
              [newUuid]: uploadedImages[oldUuid],
            };
          }
          if (uploadedOriginalImages[oldUuid]) {
            updates.uploadedOriginalImages = {
              ...uploadedOriginalImages,
              [newUuid]: uploadedOriginalImages[oldUuid],
            };
          }
          if (uploadedFiles[oldUuid]) {
            updates.uploadedFiles = {
              ...uploadedFiles,
              [newUuid]: uploadedFiles[oldUuid],
            };
          }
          if (cachedImageUrls[oldUuid]) {
            updates.cachedImageUrls = {
              ...cachedImageUrls,
              [newUuid]: cachedImageUrls[oldUuid],
            };
          }

          return updates;
        }),

      clearVolatileForCard: (uuid) =>
        set((state) => {
          const {
            selectedImages,
            originalSelectedImages,
            uploadedImages,
            uploadedOriginalImages,
            uploadedFiles,
            cachedImageUrls,
          } = state;
          delete selectedImages[uuid];
          delete originalSelectedImages[uuid];
          delete uploadedImages[uuid];
          delete uploadedOriginalImages[uuid];
          delete uploadedFiles[uuid];
          delete cachedImageUrls[uuid];

          return {
            selectedImages: { ...selectedImages },
            originalSelectedImages: { ...originalSelectedImages },
            uploadedImages: { ...uploadedImages },
            uploadedOriginalImages: { ...uploadedOriginalImages },
            uploadedFiles: { ...uploadedFiles },
            cachedImageUrls: { ...cachedImageUrls },
          };
        }),

      removeCardsByUuid: (uuids) =>
        set((state) => {
          if (!uuids?.length) return {};
          const removeSet = new Set(uuids);
          const cards = state.cards.filter((card) => !removeSet.has(card.uuid));
          if (cards.length === state.cards.length) {
            return {};
          }

          const strip = (map: Record<string, any>) => {
            if (!map) return map;
            const clone = { ...map };
            for (const id of removeSet) {
              delete clone[id];
            }
            return clone;
          };

          return {
            cards,
            selectedImages: strip(state.selectedImages),
            originalSelectedImages: strip(state.originalSelectedImages),
            uploadedImages: strip(state.uploadedImages),
            uploadedOriginalImages: strip(state.uploadedOriginalImages),
            uploadedFiles: strip(state.uploadedFiles),
            cachedImageUrls: strip(state.cachedImageUrls),
          };
        }),
    }),
    {
      name: "proxxied:cards:v5",
      version: 5,

      partialize: (state) => ({
        cards: state.cards,
        cachedImageUrls: state.cachedImageUrls,
        globalLanguage: state.globalLanguage,
      }),

      storage: createJSONStorage(() => localStorage),

      migrate: (persistedState: any, prevVersion) => {
        if (!persistedState || prevVersion < 5) {
          return {
            cards: [],
            cachedImageUrls: {},
            globalLanguage: "en",
          };
        }
        return persistedState;
      },

      // After rehydrate, remove all legacy keys
      onRehydrateStorage: () => (_state, error) => {
        if (error) return;
        try {
          const toRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("proxxied:") && !k.startsWith("proxxied:cards:v5")) {
              toRemove.push(k);
            }
          }
          toRemove.forEach(k => localStorage.removeItem(k));
        } catch { }
      }
    }
  )
);
