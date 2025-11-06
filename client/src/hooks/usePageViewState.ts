import { useShallow } from "zustand/react/shallow";
import { useSettingsStore, useCardsStore, useArtworkModalStore } from "../store";

export function usePageViewState() {
  const settings = useSettingsStore(
    useShallow((state) => ({
      pageSizeUnit: state.pageSizeUnit,
      pageWidth: state.pageWidth,
      pageHeight: state.pageHeight,
      columns: state.columns,
      rows: state.rows,
      bleedEdgeWidth: state.bleedEdgeWidth,
      zoom: state.zoom,
      cardSpacingMm: state.cardSpacingMm,
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
      customCardbackUrl: state.customCardbackUrl,
      customCardbackHasBleed: state.customCardbackHasBleed,
      disableBackPageGuides: state.disableBackPageGuides,
    }))
  );

  const cardsState = useCardsStore(
    useShallow((state) => ({
      cards: state.cards,
      selectedImages: state.selectedImages,
      selectedBackFaceImages: state.selectedBackFaceImages,
      originalSelectedImages: state.originalSelectedImages,
      uploadedFiles: state.uploadedFiles,
    }))
  );

  const cardsActions = useCardsStore(
    useShallow((state) => ({
      setCards: state.setCards,
      setSelectedImages: state.setSelectedImages,
      setOriginalSelectedImages: state.setOriginalSelectedImages,
      appendSelectedImages: state.appendSelectedImages,
      appendOriginalSelectedImages: state.appendOriginalSelectedImages,
      appendUploadedFiles: state.appendUploadedFiles,
    }))
  );

  const openArtworkModal = useArtworkModalStore((state) => state.openModal);

  return {
    settings,
    cardsState,
    cardsActions,
    openArtworkModal,
  };
}
