import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CardOption } from "../types/Card";

type Store = {
  // ---------- persisted ----------
  cards: CardOption[];
  xmlByUuid: Record<string, string>;
  globalXml: string | null;

  globalLanguage: string;
  setGlobalLanguage: (lang: string) => void;

  setCards: (cards: CardOption[]) => void;
  appendCards: (newCards: CardOption[]) => void;
  updateCard: (pos: number, updatedCard: Partial<CardOption>) => void;

  setXmlForCard: (uuid: string, xml: string) => void;
  removeXmlForCard: (uuid: string) => void;
  setGlobalXml: (xml: string | null) => void;

  // ---------- volatile (NOT persisted) ----------
  selectedImages: Record<string, string>;
  setSelectedImages: (images: Record<string, string>) => void;
  appendSelectedImages: (newImages: Record<string, string>) => void;

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
  clearVolatileForCard: (uuid: string) => void;
};

export const useCardsStore = create<Store>()(
  persist(
    (set, _) => ({
      // ---------- persisted ----------
      cards: [],
      xmlByUuid: {},
      globalXml: null,

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

      setXmlForCard: (uuid, xml) =>
        set((state) => ({ xmlByUuid: { ...state.xmlByUuid, [uuid]: xml } })),
      removeXmlForCard: (uuid) =>
        set((state) => {
          const next = { ...state.xmlByUuid };
          delete next[uuid];
          return { xmlByUuid: next };
        }),
      setGlobalXml: (xml) => set({ globalXml: xml }),

      // ---------- volatile ----------
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
              xmlByUuid,
            } = state;

            delete selectedImages[uuid];
            delete originalSelectedImages[uuid];
            delete uploadedImages[uuid];
            delete uploadedOriginalImages[uuid];
            delete uploadedFiles[uuid];

            // also remove persisted XML for that card
            const nextXml = { ...xmlByUuid };
            delete nextXml[uuid];

            return {
              cards,
              selectedImages: { ...selectedImages },
              originalSelectedImages: { ...originalSelectedImages },
              uploadedImages: { ...uploadedImages },
              uploadedOriginalImages: { ...uploadedOriginalImages },
              uploadedFiles: { ...uploadedFiles },
              xmlByUuid: nextXml,
            };
          }
          return { cards };
        }),

      clearVolatileForCard: (uuid) =>
        set((state) => {
          const {
            selectedImages,
            originalSelectedImages,
            uploadedImages,
            uploadedOriginalImages,
            uploadedFiles,
          } = state;
          delete selectedImages[uuid];
          delete originalSelectedImages[uuid];
          delete uploadedImages[uuid];
          delete uploadedOriginalImages[uuid];
          delete uploadedFiles[uuid];

          return {
            selectedImages: { ...selectedImages },
            originalSelectedImages: { ...originalSelectedImages },
            uploadedImages: { ...uploadedImages },
            uploadedOriginalImages: { ...uploadedOriginalImages },
            uploadedFiles: { ...uploadedFiles },
          };
        }),
    }),
    {
      name: "proxxied:cards:v3", // bump to v3 to introduce persisted XML
      version: 3,

      // Persist ONLY lightweight metadata + XML
      partialize: (state) => ({
        cards: state.cards,
        xmlByUuid: state.xmlByUuid,
        globalXml: state.globalXml,
      }),

      storage: createJSONStorage(() => localStorage),

      migrate: (persistedState: any, version) => {
        if (!persistedState) return persistedState;

        // v1/v2 -> v3: ensure XML containers exist, and drop any heavy blobs
        if (version < 3) {
          delete persistedState.selectedImages;
          delete persistedState.originalSelectedImages;
          delete persistedState.uploadedImages;
          delete persistedState.uploadedOriginalImages;
          delete persistedState.uploadedFiles;

          if (!persistedState.xmlByUuid) persistedState.xmlByUuid = {};
          if (!("globalXml" in persistedState)) persistedState.globalXml = null;
        }
        return persistedState;
      },
    }
  )
);
