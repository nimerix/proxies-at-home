import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import type { CardOption } from "../pages/ProxyBuilderPage";

type SortableCardProps = {
  card: CardOption;
  index: number;
  globalIndex: number;
  imageSrc: string;
  totalCardWidth: number;
  totalCardHeight: number;
  bleedEdge: boolean;
  guideOffset: number | string;
  guideWidth: number;
  guideColor: string;
  setContextMenu: (menu: {
    visible: boolean;
    x: number;
    y: number;
    cardIndex: number;
  }) => void;
  setModalCard: (card: CardOption) => void;
  setModalIndex: (index: number) => void;
  setIsModalOpen: (open: boolean) => void;
};

export default function SortableCard({
  card,
  index,
  globalIndex,
  imageSrc,
  totalCardWidth,
  totalCardHeight,
  bleedEdge,
  guideOffset,
  guideWidth,
  guideColor,
  setContextMenu,
  setModalCard,
  setModalIndex,
  setIsModalOpen,
}: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
  useSortable({ id: card.uuid });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: `${totalCardWidth}mm`,
    height: `${totalCardHeight}mm`,
  };


  return (
    <div
      ref={setNodeRef}
      {...attributes}
      key={`${card.uuid}-${index}`}
      className="bg-black relative group"
      style={style}
    >

      <img
        src={imageSrc}
        alt={card.name}
        className="cursor-pointer block w-full h-full p-0 m-0"
        style={{ display: "block", lineHeight: 0 }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            cardIndex: globalIndex,
          });
        }}
        onClick={() => {
          setModalCard(card);
          setModalIndex(globalIndex);
          setIsModalOpen(true);
        }}
      />

      {/* ⠿ Drag Handle */}
      <div
        {...listeners}
        style={{ right: "4px", top: "4px", position: "absolute" }}
        className="w-4 h-4 bg-white text-green text-xs rounded-sm flex items-center justify-center cursor-move group-hover:opacity-100 opacity-50"
        title="Drag"
      >
        ⠿
      </div>

      {bleedEdge && (
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
