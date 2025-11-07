import { useMemo, memo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useArtworkModalStore, useSettingsStore } from "../store";
import { useCardsStore } from "../store/cards";
import type { CardOption } from "../types/Card";

type SortableCardProps = {
  card: CardOption;
  index: number;
  globalIndex: number;
  imageSrc: string;
  totalCardWidth: number;
  totalCardHeight: number;
  guideOffset: number | string;
  setContextMenu: (menu: {
    visible: boolean;
    x: number;
    y: number;
    cardIndex: number;
  }) => void;
  viewMode: "front" | "back";
  customCardbackUrl: string | null;
  customCardbackHasBleed: boolean;
  disableBackPageGuides: boolean;
};

const SortableCard = memo(function SortableCard({
  card,
  index,
  globalIndex,
  imageSrc,
  totalCardWidth,
  totalCardHeight,
  guideOffset,
  setContextMenu,
  viewMode,
  customCardbackUrl,
  customCardbackHasBleed,
  disableBackPageGuides,
}: SortableCardProps) {
  const useCornerGuides = useSettingsStore((state) => state.useCornerGuides);
  const guideWidth = useSettingsStore((state) => state.guideWidth);
  const guideColor = useSettingsStore((state) => state.guideColor);
  const roundedCornerGuides = useSettingsStore((state) => state.roundedCornerGuides);
  const cornerGuideOffsetMm = useSettingsStore((state) => state.cornerGuideOffsetMm);
  const bleedEdgeWidth = useSettingsStore((state) => state.bleedEdgeWidth);

  // Determine if we should show guides
  const shouldShowGuides = useCornerGuides && !(viewMode === "back" && disableBackPageGuides);

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: card.uuid });

  const openArtworkModal = useArtworkModalStore((state) => state.openModal);
  const duplicateCardAt = useCardsStore((state) => state.duplicateCardAt);
  const updateCard = useCardsStore((state) => state.updateCard);
  const appendOriginalSelectedImages = useCardsStore((state) => state.appendOriginalSelectedImages);
  const clearSelectedImage = useCardsStore((state) => state.clearSelectedImage);
  const clearSelectedBackFaceImage = useCardsStore((state) => state.clearSelectedBackFaceImage);

  // Check if card has multiple faces (is reversible)
  const isReversible = card.faces && card.faces.length > 1;
  const currentFaceIndex = card.currentFaceIndex ?? 0;

  const handleFlipCard = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isReversible || !card.faces) return;

    const nextFaceIndex = (currentFaceIndex + 1) % card.faces.length;
    const nextFace = card.faces[nextFaceIndex];

    if (nextFace?.imageUrl) {
      // Update the card's current face index
      updateCard(globalIndex, { currentFaceIndex: nextFaceIndex });

      // Update the original selected image to point to the new face
      appendOriginalSelectedImages({ [card.uuid]: nextFace.imageUrl });

      // Clear the processed previews so they get regenerated
      clearSelectedImage(card.uuid);
      clearSelectedBackFaceImage(card.uuid);
    }
  }, [isReversible, currentFaceIndex, card.faces, card.uuid, globalIndex, updateCard, appendOriginalSelectedImages, clearSelectedImage, clearSelectedBackFaceImage]);

  // Determine what image to show based on view mode
  const displayImageSrc = useMemo(() => {
    if (viewMode === "back") {
      // If we have a processed image (either back face or front), use it
      if (imageSrc) {
        return imageSrc;
      }

      // Otherwise show cardback (custom or default)
      return customCardbackUrl || "/cardback.png";
    }

    // Front view - show normal image
    return imageSrc;
  }, [viewMode, imageSrc, customCardbackUrl]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: `${totalCardWidth}mm`,
    height: `${totalCardHeight}mm`,
  };

  const cornerStyles = useMemo(() => {
    const CORNER_RADIUS_MM = 2.5;
    const dxdy = Math.abs(cornerGuideOffsetMm) / Math.SQRT2;
    const validCornerPosition =
      cornerGuideOffsetMm <= 0 &&
      cornerGuideOffsetMm >= -(bleedEdgeWidth / Math.SQRT2 + guideWidth / 2);
    const archRadius =
      cornerGuideOffsetMm > 0
        ? CORNER_RADIUS_MM + guideWidth
        : CORNER_RADIUS_MM + guideWidth + Math.abs(cornerGuideOffsetMm);
    const arcPos = bleedEdgeWidth + cornerGuideOffsetMm - guideWidth / 2;
    const arcBorder = `${guideWidth}mm solid ${guideColor}`;
    const arcBaseStyle = {
      width: `${CORNER_RADIUS_MM - dxdy}mm`,
      height: `${CORNER_RADIUS_MM - dxdy}mm`,
      position: "absolute" as const,
    };

    return {
      validCornerPosition,
      arcLeftUpper: {
        ...arcBaseStyle,
        top: `${arcPos}mm`,
        left: `${arcPos}mm`,
        borderTop: arcBorder,
        borderLeft: arcBorder,
        borderTopLeftRadius: `${archRadius}mm`,
        borderBottom: "none",
        borderRight: "none",
      },
      arcRightLower: {
        ...arcBaseStyle,
        bottom: `${arcPos}mm`,
        right: `${arcPos}mm`,
        borderBottom: arcBorder,
        borderRight: arcBorder,
        borderBottomRightRadius: `${archRadius}mm`,
        borderTop: "none",
        borderLeft: "none",
      },
      arcLeftLower: {
        ...arcBaseStyle,
        bottom: `${arcPos}mm`,
        left: `${arcPos}mm`,
        borderBottom: arcBorder,
        borderLeft: arcBorder,
        borderBottomLeftRadius: `${archRadius}mm`,
        borderTop: "none",
        borderRight: "none",
      },
      arcRightUpper: {
        ...arcBaseStyle,
        top: `${arcPos}mm`,
        right: `${arcPos}mm`,
        borderTop: arcBorder,
        borderRight: arcBorder,
        borderTopRightRadius: `${archRadius}mm`,
        borderBottom: "none",
        borderLeft: "none",
      },
    };
  }, [cornerGuideOffsetMm, bleedEdgeWidth, guideWidth, guideColor]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      key={`${card.uuid}-${index}`}
      className="bg-black relative group"
      style={style}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation();
          duplicateCardAt(globalIndex);
        } else {
          openArtworkModal({ card, index: globalIndex, autoFetchPrints: e.shiftKey });
        }
      }}
    >
      <img
        src={displayImageSrc}
        className="cursor-pointer block"
        style={{
          width: "100%",
          height: "100%",
          objectFit: customCardbackHasBleed && viewMode === "back" && displayImageSrc === customCardbackUrl ? "cover" : "contain"
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            cardIndex: globalIndex,
          });
        }}
      />

      {/* ⠿ Drag Handle */}
      <div
        {...listeners}
        className="absolute right-[4px] top-1 w-4 h-4 bg-white text-green text-xs rounded-sm flex items-center justify-center cursor-move group-hover:opacity-100 opacity-50"
        title="Drag"
      >
        ⠿
      </div>

      {/* Flip Indicator for reversible cards */}
      {isReversible && (
        <div
          onClick={handleFlipCard}
          className="absolute left-1 top-1 w-6 h-6 bg-blue-600 text-white text-xs rounded-sm flex items-center justify-center cursor-pointer group-hover:opacity-100 opacity-75 hover:bg-blue-700 transition-colors"
          title={`Flip to ${card.faces?.[currentFaceIndex === 0 ? 1 : 0]?.name || "other side"}`}
        >
          ⇄
        </div>
      )}

      {shouldShowGuides && roundedCornerGuides && cornerStyles.validCornerPosition && (
        <>
          <div style={cornerStyles.arcLeftUpper} />
          <div style={cornerStyles.arcRightUpper} />
          <div style={cornerStyles.arcLeftLower} />
          <div style={cornerStyles.arcRightLower} />
        </>
      )}
      {shouldShowGuides && !roundedCornerGuides && (
        <>
          <div
            style={{
              position: "absolute",
              top: guideOffset,
              left: guideOffset,
              width: `${guideWidth}px`,
              height: "2mm",
              backgroundColor: guideColor,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: guideOffset,
              left: guideOffset,
              width: "2mm",
              height: `${guideWidth}px`,
              backgroundColor: guideColor,
            }}
          />

          <div
            style={{
              position: "absolute",
              top: guideOffset,
              right: guideOffset,
              width: `${guideWidth}px`,
              height: "2mm",
              backgroundColor: guideColor,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: guideOffset,
              right: guideOffset,
              width: "2mm",
              height: `${guideWidth}px`,
              backgroundColor: guideColor,
            }}
          />

          <div
            style={{
              position: "absolute",
              bottom: guideOffset,
              left: guideOffset,
              width: `${guideWidth}px`,
              height: "2mm",
              backgroundColor: guideColor,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: guideOffset,
              left: guideOffset,
              width: "2mm",
              height: `${guideWidth}px`,
              backgroundColor: guideColor,
            }}
          />

          <div
            style={{
              position: "absolute",
              bottom: guideOffset,
              right: guideOffset,
              width: `${guideWidth}px`,
              height: "2mm",
              backgroundColor: guideColor,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: guideOffset,
              right: guideOffset,
              width: "2mm",
              height: `${guideWidth}px`,
              backgroundColor: guideColor,
            }}
          />
        </>
      )}
    </div>
  );
});

export default SortableCard;
