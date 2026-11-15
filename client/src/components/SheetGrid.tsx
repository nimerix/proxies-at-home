import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { memo, useEffect, type CSSProperties } from "react";
import CardCellLazy from "./CardCellLazy";
import EdgeCutLines from "./FullPageGuides";
import SortableCard, { type CardState } from "./SortableCard";
import type { CardOption } from "../types/Card";
import { useImageProcessing } from "../hooks/useImageProcessing";
import { useCardsStore, usePreviewStore, useSettingsStore } from "../store";
import { deckEdit } from "../store/undo";
import { pageSlots, type printLayout } from "../helpers/printLayout";

export type RetryPreview = (card: CardOption, back: boolean) => void;

type SheetCardProps = Omit<
  Parameters<typeof SortableCard>[0],
  "imageSrc" | "state" | "onRetry"
> & {
  back: boolean;
  hasSource: boolean;
  ensure: (card: CardOption) => Promise<void>;
};

// Each card follows only its own preview, so finishing one preview does not
// re-render every sheet.
const SheetCard = memo(function SheetCard({
  back,
  hasSource,
  ensure,
  ...props
}: SheetCardProps) {
  const { card } = props;
  const imageSrc = useCardsStore(
    (state) =>
      (back ? state.selectedBackFaceImages : state.selectedImages)[card.uuid] ||
      ""
  );
  const failed = usePreviewStore(
    (state) => state.status[`${card.uuid}:${back}`] === "error"
  );
  const state: CardState = imageSrc
    ? "ready"
    : !hasSource
      ? "missing"
      : failed
        ? "failed"
        : "loading";
  return (
    <CardCellLazy
      card={card}
      hasImage={!!imageSrc}
      hasSource={hasSource}
      ensureProcessed={ensure}
    >
      <SortableCard
        {...props}
        imageSrc={imageSrc}
        state={state}
        onRetry={ensure}
      />
    </CardCellLazy>
  );
});

/** The sheets of a deck with cards, loaded on demand with the card renderer. */
export default function SheetGrid({
  pageCount,
  layout,
  pageStyle,
  frameWidth,
  located,
  indices,
  hasSource,
  onReady,
}: {
  pageCount: number;
  layout: ReturnType<typeof printLayout>;
  pageStyle: CSSProperties;
  frameWidth: number;
  located: string | null;
  indices: Map<string, number>;
  hasSource: (card: CardOption) => boolean;
  onReady: (retry: RetryPreview | null) => void;
}) {
  const s = useSettingsStore();
  const cards = useCardsStore((state) => state.cards);
  const capacity = s.columns * s.rows;
  const back = s.viewMode === "back";
  const { ensureProcessed, ensureBackFaceProcessed } = useImageProcessing({
    unit: "mm",
    bleedEdgeWidth: s.bleedEdgeWidth,
  });
  const ensure = back ? ensureBackFaceProcessed : ensureProcessed;
  useEffect(() => {
    onReady((card, back) => {
      void (back ? ensureBackFaceProcessed : ensureProcessed)(card);
    });
    return () => onReady(null);
  }, [onReady, ensureProcessed, ensureBackFaceProcessed]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const current = useCardsStore.getState().cards;
        const from = current.findIndex((c) => c.uuid === active.id),
          to = current.findIndex((c) => c.uuid === over.id);
        if (from >= 0 && to >= 0)
          deckEdit(`move ${current[from].name}`, () =>
            useCardsStore.getState().setCards(arrayMove(current, from, to))
          );
      }}
    >
      <SortableContext
        items={cards.map((c) => c.uuid)}
        strategy={rectSortingStrategy}
      >
        {Array.from({ length: pageCount }, (_, pageIndex) => (
          <div
            className="sheet-frame"
            key={pageIndex}
            style={{ width: frameWidth }}
          >
            <div className="sheet-label">
              Sheet {pageIndex + 1}
              <span>{back ? "Back" : "Front"}</span>
            </div>
            <div className="proxy-page" style={pageStyle}>
              <div
                className="card-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${s.columns}, ${layout.cardWidthMm}mm)`,
                  gridTemplateRows: `repeat(${s.rows}, ${layout.cardHeightMm}mm)`,
                  gap: `${s.cardSpacingMm}mm`,
                }}
              >
                {pageSlots(
                  cards.slice(pageIndex * capacity, (pageIndex + 1) * capacity),
                  s.columns,
                  s.rows,
                  back
                ).map((card, slot) => {
                  if (!card)
                    return <div key={`empty-${slot}`} aria-hidden="true" />;
                  return (
                    <SheetCard
                      key={`${card.uuid}:${s.viewMode}:${s.bleedEdgeWidth}:${s.useHighQualityPreviews}:${s.customCardbackUrl?.length}:${s.customCardbackHasBleed}`}
                      card={card}
                      back={back}
                      hasSource={hasSource(card)}
                      ensure={ensure}
                      globalIndex={indices.get(card.uuid) ?? -1}
                      located={located === card.uuid}
                      totalCardWidth={layout.cardWidthMm}
                      totalCardHeight={layout.cardHeightMm}
                      viewMode={s.viewMode}
                      disableBackPageGuides={s.disableBackPageGuides}
                    />
                  );
                })}
              </div>
              {!(back && s.disableBackPageGuides) && <EdgeCutLines />}
            </div>
          </div>
        ))}
      </SortableContext>
    </DndContext>
  );
}
