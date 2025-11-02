import { useMemo } from "react";
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
};

export default function SortableCard({
  card,
  index,
  globalIndex,
  imageSrc,
  totalCardWidth,
  totalCardHeight,
  guideOffset,
  setContextMenu,
}: SortableCardProps) {
  const useCornerGuides = useSettingsStore((state) => state.useCornerGuides);
  const guideWidth = useSettingsStore((state) => state.guideWidth);
  const guideColor = useSettingsStore((state) => state.guideColor);
  const roundedCornerGuides = useSettingsStore((state) => state.roundedCornerGuides);
  const cornerGuideOffsetMm = useSettingsStore((state) => state.cornerGuideOffsetMm);
  const bleedEdgeWidth = useSettingsStore((state) => state.bleedEdgeWidth);

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: card.uuid });

  const openArtworkModal = useArtworkModalStore((state) => state.openModal);
  const duplicateCardAt = useCardsStore((state) => state.duplicateCardAt);

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
        src={imageSrc}
        className="cursor-pointer block"
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
      
      {useCornerGuides && roundedCornerGuides && cornerStyles.validCornerPosition && (
        <>
          <div style={cornerStyles.arcLeftUpper} />
          <div style={cornerStyles.arcRightUpper} />
          <div style={cornerStyles.arcLeftLower} />
          <div style={cornerStyles.arcRightLower} />
        </>
      )}
      {useCornerGuides && !roundedCornerGuides && (
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
}
