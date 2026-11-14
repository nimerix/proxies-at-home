import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isUploadedFileToken,
  makeUploadedFileToken,
} from "../helpers/ImageHelper";
import {
  createIndexedDBStorage,
  reportStorageError,
  hydrationErrorMessage,
} from "../helpers/IndexedDBStorage";
import { MAX_CARDS } from "../helpers/CardInfoHelper";
import { notify } from "./notifications";
import type { CardOption } from "../types/Card";

type Store = {
  // ---------- persisted ----------
  cards: CardOption[];

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

  selectedBackFaceImages: Record<string, string>;
  setSelectedBackFaceImages: (images: Record<string, string>) => void;
  appendSelectedBackFaceImages: (newImages: Record<string, string>) => void;
  clearSelectedBackFaceImage: (uuid: string) => void;

  originalSelectedImages: Record<string, string>;
  setOriginalSelectedImages: (images: Record<string, string>) => void;
  appendOriginalSelectedImages: (newImages: Record<string, string>) => void;

  uploadedFiles: Record<string, File>;
  setUploadedFiles: (files: Record<string, File>) => void;
  appendUploadedFiles: (newFiles: Record<string, File>) => void;

  uploadedBackFiles: Record<string, File>;
  setUploadedBackFiles: (files: Record<string, File>) => void;
  appendUploadedBackFiles: (newFiles: Record<string, File>) => void;

  originalSelectedBackImages: Record<string, string>;
  setOriginalSelectedBackImages: (images: Record<string, string>) => void;
  appendOriginalSelectedBackImages: (newImages: Record<string, string>) => void;

  clearAll: () => void;
  removeCardAt: (pos: number) => void;
  duplicateCardAt: (pos: number) => void;
  removeCardsByUuid: (uuids: string[]) => void;
};

const emptyImages = () => ({
  selectedImages: {},
  selectedBackFaceImages: {},
  originalSelectedImages: {},
  uploadedFiles: {},
  uploadedBackFiles: {},
  originalSelectedBackImages: {},
});

function strip<T>(map: Record<string, T>, ids: Set<string>) {
  return Object.fromEntries(Object.entries(map).filter(([id]) => !ids.has(id)));
}

function removeImages(state: Store, ids: Set<string>) {
  return {
    selectedImages: strip(state.selectedImages, ids),
    selectedBackFaceImages: strip(state.selectedBackFaceImages, ids),
    originalSelectedImages: strip(state.originalSelectedImages, ids),
    uploadedFiles: strip(state.uploadedFiles, ids),
    uploadedBackFiles: strip(state.uploadedBackFiles, ids),
    originalSelectedBackImages: strip(state.originalSelectedBackImages, ids),
  };
}

export const useCardsStore = create<Store>()(
  persist(
    (set, get) => ({
      ...emptyImages(),
      cards: [],
      globalLanguage: "en",
      setGlobalLanguage: (globalLanguage) => set({ globalLanguage }),
      setCards: (cards) => set({ cards }),
      appendCards: (newCards) =>
        set((s) => ({ cards: [...s.cards, ...newCards] })),
      updateCard: (pos, patch) =>
        set((s) => ({
          cards: s.cards.map((c, i) => (i === pos ? { ...c, ...patch } : c)),
        })),
      clearAll: () => set({ cards: [], ...emptyImages() }),
      setSelectedImages: (selectedImages) => set({ selectedImages }),
      appendSelectedImages: (images) =>
        set((s) => ({ selectedImages: { ...s.selectedImages, ...images } })),
      setSelectedBackFaceImages: (selectedBackFaceImages) =>
        set({ selectedBackFaceImages }),
      appendSelectedBackFaceImages: (images) =>
        set((s) => ({
          selectedBackFaceImages: { ...s.selectedBackFaceImages, ...images },
        })),
      setOriginalSelectedImages: (originalSelectedImages) =>
        set({ originalSelectedImages }),
      appendOriginalSelectedImages: (images) =>
        set((s) => ({
          originalSelectedImages: { ...s.originalSelectedImages, ...images },
        })),
      setUploadedFiles: (uploadedFiles) => set({ uploadedFiles }),
      appendUploadedFiles: (images) =>
        set((s) => ({ uploadedFiles: { ...s.uploadedFiles, ...images } })),
      setUploadedBackFiles: (uploadedBackFiles) => set({ uploadedBackFiles }),
      appendUploadedBackFiles: (images) =>
        set((s) => ({
          uploadedBackFiles: { ...s.uploadedBackFiles, ...images },
        })),
      setOriginalSelectedBackImages: (originalSelectedBackImages) =>
        set({ originalSelectedBackImages }),
      appendOriginalSelectedBackImages: (images) =>
        set((s) => ({
          originalSelectedBackImages: {
            ...s.originalSelectedBackImages,
            ...images,
          },
        })),
      clearSelectedImage: (id) =>
        set((s) => ({
          selectedImages: strip(s.selectedImages, new Set([id])),
        })),
      clearManySelectedImages: (ids) =>
        set((s) => ({ selectedImages: strip(s.selectedImages, new Set(ids)) })),
      clearSelectedBackFaceImage: (id) =>
        set((s) => ({
          selectedBackFaceImages: strip(
            s.selectedBackFaceImages,
            new Set([id])
          ),
        })),
      removeCardsByUuid: (ids) =>
        set((s) => ({
          cards: s.cards.filter((c) => !ids.includes(c.uuid)),
          ...removeImages(s, new Set(ids)),
        })),
      removeCardAt: (pos) => {
        const card = get().cards[pos];
        if (card) get().removeCardsByUuid([card.uuid]);
      },
      duplicateCardAt: (pos) =>
        set((state) => {
          const card = state.cards[pos];
          if (!card) return {};
          if (state.cards.length >= MAX_CARDS) {
            notify(
              "This workspace holds up to 1,000 cards. Remove some cards before duplicating.",
              "error"
            );
            return {};
          }
          const uuid = crypto.randomUUID();
          const cards = [...state.cards];
          cards.splice(pos + 1, 0, { ...card, uuid });
          const copy = <T>(map: Record<string, T>) =>
            map[card.uuid] === undefined
              ? map
              : { ...map, [uuid]: map[card.uuid] };
          const copyOriginal = (map: Record<string, string>) =>
            !map[card.uuid]
              ? map
              : {
                  ...map,
                  [uuid]: isUploadedFileToken(map[card.uuid])
                    ? makeUploadedFileToken(uuid)
                    : map[card.uuid],
                };
          return {
            cards,
            selectedImages: copy(state.selectedImages),
            selectedBackFaceImages: copy(state.selectedBackFaceImages),
            originalSelectedImages: copyOriginal(state.originalSelectedImages),
            uploadedFiles: copy(state.uploadedFiles),
            uploadedBackFiles: copy(state.uploadedBackFiles),
            originalSelectedBackImages: copyOriginal(
              state.originalSelectedBackImages
            ),
          };
        }),
    }),
    {
      onRehydrateStorage: () => (_state, error) =>
        reportStorageError("hydrate:cards", hydrationErrorMessage(error)),
      name: "proxxied:cards:v7",
      version: 8,
      storage: createIndexedDBStorage<Partial<Store>>(["proxxied:cards:v6"]),
      partialize: (s) => ({
        cards: s.cards,
        globalLanguage: s.globalLanguage,
        originalSelectedImages: s.originalSelectedImages,
        originalSelectedBackImages: s.originalSelectedBackImages,
        uploadedFiles: s.uploadedFiles,
        uploadedBackFiles: s.uploadedBackFiles,
      }),
      migrate: (value) => (value ?? {}) as Partial<Store>,
      merge: (value, current) => {
        const saved = (value ?? {}) as Partial<Store> & {
          cachedImageUrls?: Record<string, string>;
        };
        return {
          ...current,
          cards: Array.isArray(saved.cards) ? saved.cards : [],
          globalLanguage:
            typeof saved.globalLanguage === "string"
              ? saved.globalLanguage
              : "en",
          originalSelectedImages: {
            ...saved.cachedImageUrls,
            ...saved.originalSelectedImages,
          },
          originalSelectedBackImages: saved.originalSelectedBackImages ?? {},
          uploadedFiles: saved.uploadedFiles ?? {},
          uploadedBackFiles: saved.uploadedBackFiles ?? {},
        };
      },
    }
  )
);
